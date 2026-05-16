import type { S3Client } from "bun"
import { readdir } from "fs/promises"
import { join, relative, sep } from "path"
import type { UploadTask, UploadWorkerConfig } from "./worker"
import { createSpinner, formatDurationMs } from "../utils"
import { type DeployArgs } from "."

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
    this.worker = new Worker("./src/core/worker.ts")
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

  async function runWorker(): Promise<void> {
    const worker = new UploadWorker(config)
    await worker.waitForReady()

    while (taskQueue.length > 0) {
      const task = taskQueue.shift()!
      const result = await worker.send(task)
      if (result.ok) completed++
      else failed++
    }

    worker.terminate()
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

  return { completed, failed }
}

async function deleteAllObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<void> {
  const spinner = createSpinner(`Clearing ${bucket}/${prefix}`)
  const clearStart = Date.now()

  try {
    let continuationToken: string | undefined
    let count = 0

    do {
      const response = await client.list({
        prefix,
        continuationToken,
        maxKeys: 1000,
      })
      for (const obj of response.contents ?? []) {
        await client.delete(obj.key)
        count++
      }
      continuationToken = response.nextContinuationToken
    } while (continuationToken)

    spinner.stop(
      "ok",
      `Cleared ${count} object(s) (${formatDurationMs(Date.now() - clearStart)})`,
    )
  } catch (err) {
    spinner.stop("error", "Failed to clear objects")
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

export interface DeployRunner {
  execute(client: S3Client, args: DeployArgs): Promise<void>
}

export class OverwriteStrategy implements DeployRunner {
  async execute(client: S3Client, args: DeployArgs): Promise<void> {
    const prefixForDelete = args.destination.prefix
      ? `${args.destination.prefix}/`
      : ""
    if (prefixForDelete) {
      await deleteAllObjects(client, args.destination.bucket, prefixForDelete)
    }

    const files = await collectFiles(args.source)

    const uploadTasks: UploadTask[] = files.map((absolutePath, id) => {
      const relativePath = relative(args.source, absolutePath)
      const s3RelPath = relativePath.split(sep).join("/")
      const s3Key = args.destination.prefix
        ? `${args.destination.prefix}/${s3RelPath}`
        : s3RelPath

      return {
        id,
        absolutePath,
        s3Key,
      }
    })

    const effectiveWorkerCount = Math.max(
      1,
      Math.min(args.workerCount, uploadTasks.length),
    )

    const spinner = createSpinner(
      `Uploading ${uploadTasks.length} files with ${effectiveWorkerCount} worker(s)...`,
    )

    try {
      const { completed, failed } = await runUploadWorkers({
        workerCount: effectiveWorkerCount,
        config: {
          endpoint: args.endpoint,
          region: args.region!,
          accessKeyId: args.token.accessKeyId,
          secretAccessKey: args.token.secretAccessKey,
          bucket: args.destination.bucket,
        },
        tasks: uploadTasks,
      })

      spinner.stop(
        failed > 0 ? "partial" : "ok",
        `Uploaded ${completed} file(s), ${failed} failed`,
      )

      if (failed > 0) {
        throw new Error(`${failed} file(s) failed to upload`)
      }
    } catch (err) {
      // immediately stop the spinner on worker error
      spinner.stop("error", err instanceof Error ? err.message : String(err))

      // rethrow to trigger proper error reporting
      throw err
    }
  }
}
