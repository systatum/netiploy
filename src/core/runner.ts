import type { S3Client } from "bun"
import { readdir } from "fs/promises"
import { join, relative, sep } from "path"
import type { UploadTask, UploadWorkerConfig } from "./worker"
import { createSpinner } from "../utils"
import { type ResolvedClientConfig } from "."

type TaskResult =
  | { ok: true; key: string }
  | { ok: false; path: string; error: string }

type WorkerMessage =
  | { type: "ready" }
  | { type: "uploaded"; key: string }
  | { type: "failed"; path: string; error: string }

class UploadWorker {
  private readonly worker: Worker
  private pendingResolve: ((result: TaskResult) => void) | null = null
  private pendingReject: ((err: Error) => void) | null = null
  private readyResolve: (() => void) | null = null
  private readyReject: ((err: Error) => void) | null = null

  constructor(config: UploadWorkerConfig) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url).href)
    this.worker.onmessage = (e: MessageEvent<WorkerMessage>) =>
      this.handleMessage(e.data)
    this.worker.onerror = (e: ErrorEvent) => this.handleError(e)
    this.worker.postMessage({ type: "configure", config })
  }

  private handleMessage(msg: WorkerMessage): void {
    if (msg.type === "ready") {
      this.readyResolve?.()
      this.readyResolve = null
      this.readyReject = null
      return
    }
    const resolve = this.pendingResolve
    this.pendingResolve = null
    this.pendingReject = null
    if (msg.type === "uploaded") resolve?.({ ok: true, key: msg.key })
    else if (msg.type === "failed")
      resolve?.({ ok: false, path: msg.path, error: msg.error })
  }

  private handleError(e: ErrorEvent): void {
    const err = new Error(`Worker crashed: ${e.message}`)
    this.readyReject?.(err)
    this.pendingReject?.(err)
    this.readyResolve = null
    this.readyReject = null
    this.pendingResolve = null
    this.pendingReject = null
  }

  waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
  }

  send(task: UploadTask): Promise<TaskResult> {
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve
      this.pendingReject = reject
      this.worker.postMessage({ type: "upload", task })
    })
  }

  terminate(): void {
    this.worker.terminate()
  }
}

interface UploadOutcome {
  completed: number
  failed: number
}

interface RunUploadWorkerArgs {
  workerCount: number
  config: UploadWorkerConfig
  tasks: UploadTask[]
}

async function runUploadWorkers(
  args: RunUploadWorkerArgs,
): Promise<UploadOutcome> {
  const { workerCount, config, tasks } = args
  if (tasks.length === 0) return { completed: 0, failed: 0 }
  const taskQueue = [...tasks]

  let completed = 0
  let failed = 0

  const spinner = createSpinner(`Uploading files...`)

  async function runWorker(): Promise<void> {
    const worker = new UploadWorker(config)
    await worker.waitForReady()

    while (taskQueue.length > 0) {
      const task = taskQueue.shift()!
      const result = await worker.send(task)

      if (result.ok) completed++
      else failed++

      spinner.progress(completed, tasks.length)
    }

    worker.terminate()
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker()),
  ).catch((err) => {
    spinner.stop("error", `Upload failed: ${err.message}`)
    throw err
  })

  spinner.stop(failed > 0 ? "partial" : "ok")

  return { completed, failed }
}

async function deleteAllObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<void> {
  const path = `${bucket}/${prefix}`
  const spinner = createSpinner(`Clearing existing objects from ${path}...`)

  try {
    let continuationToken: string | undefined
    let count = 0
    let total = 0

    do {
      const response = await client.list({
        prefix,
        continuationToken,
        maxKeys: 1000,
      })
      total += response.keyCount ?? 0
      for (const obj of response.contents ?? []) {
        await client.delete(obj.key)
        count++
        spinner.progress(count, total)
      }
      continuationToken = response.nextContinuationToken
    } while (continuationToken)

    spinner.stop("ok")
  } catch (err) {
    spinner.stop("error", `Failed to clear objects from ${path}`)
    throw err
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)))
      continue
    }

    if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

export interface RunnerContext {
  client: S3Client
  source: string
  clientConfig: ResolvedClientConfig
  workerCount?: number
}

export interface DeployRunner {
  execute(ctx: RunnerContext): Promise<void>
}

export class OverwriteStrategy implements DeployRunner {
  async execute(ctx: RunnerContext): Promise<void> {
    const prefixForDelete = ctx.clientConfig.prefix
      ? `${ctx.clientConfig.prefix}/`
      : ""
    if (prefixForDelete) {
      await deleteAllObjects(
        ctx.client,
        ctx.clientConfig.bucket,
        prefixForDelete,
      )
    }

    const files = await collectFiles(ctx.source)

    const uploadTasks: UploadTask[] = files.map((absolutePath, id) => {
      const relativePath = relative(ctx.source, absolutePath)
      const s3RelPath = relativePath.split(sep).join("/")
      const s3Key = ctx.clientConfig.prefix
        ? `${ctx.clientConfig.prefix}/${s3RelPath}`
        : s3RelPath

      return {
        id,
        absolutePath,
        s3Key,
      }
    })

    const effectiveWorkerCount = Math.max(
      1,
      Math.min(ctx.workerCount ?? 1, uploadTasks.length),
    )

    const result = await runUploadWorkers({
      workerCount: effectiveWorkerCount,
      config: {
        endpoint: ctx.clientConfig.endpoint,
        region: ctx.clientConfig.region,
        accessKeyId: ctx.clientConfig.token.accessKeyId,
        secretAccessKey: ctx.clientConfig.token.secretAccessKey,
        bucket: ctx.clientConfig.bucket,
      },
      tasks: uploadTasks,
    })

    if (result.failed > 0) {
      throw new Error(`${result.failed} file(s) failed to upload`)
    }
  }
}
