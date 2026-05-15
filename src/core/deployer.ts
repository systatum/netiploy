import { S3Client } from "bun"
import { readdir, stat } from "fs/promises"
import { nanoid } from "nanoid"
import { ErrorCode } from "./error"
import { xxh32 } from "./xxh32"
import { basename, join, relative, sep } from "path"

export const SubfolderMode = {
  None: "none",
  Generate: "generate",
  HashPrefix: "hash",
} as const

export type SubfolderMode =
  | (typeof SubfolderMode)[keyof typeof SubfolderMode]
  | `hash:${string}`

export const DeployStrategy = {
  Overwrite: "overwrite", // clears the destination prefix before uploading
} as const

export type DeployStrategy =
  (typeof DeployStrategy)[keyof typeof DeployStrategy]

interface UploadTask {
  id: number
  absolutePath: string
  s3Key: string
}

interface UploadWorkerConfig {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

interface UploadOutcome {
  completed: number
  failed: number
}

async function runUploadWorkers(args: {
  workerCount: number
  config: UploadWorkerConfig
  tasks: UploadTask[]
}): Promise<UploadOutcome> {
  const { workerCount, config, tasks } = args
  if (tasks.length === 0) {
    return { completed: 0, failed: 0 }
  }

  const effectiveWorkerCount = Math.max(1, Math.min(workerCount, tasks.length))
  const workerUrl = new URL("./worker.ts", import.meta.url).href
  const workers: Worker[] = []

  let completed = 0
  let failed = 0
  let nextTaskIndex = 0
  let pending = 0
  let settled = false

  return await new Promise<UploadOutcome>((resolve, reject) => {
    const finishIfDone = () => {
      if (settled) {
        return
      }

      const noMoreTasks = nextTaskIndex >= tasks.length
      if (!noMoreTasks || pending > 0) {
        return
      }

      settled = true
      for (const worker of workers) {
        worker.postMessage({ type: "shutdown" })
        worker.terminate()
      }
      resolve({ completed, failed })
    }

    const fail = (message: string) => {
      if (settled) {
        return
      }
      settled = true
      for (const worker of workers) {
        try {
          worker.postMessage({ type: "shutdown" })
          worker.terminate()
        } catch {
          // no-op
        }
      }
      reject(new Error(message))
    }

    const assignTask = (worker: Worker) => {
      if (nextTaskIndex >= tasks.length) {
        finishIfDone()
        return
      }

      const task = tasks[nextTaskIndex++]
      pending++
      worker.postMessage({ type: "upload", task })
    }

    for (let i = 0; i < effectiveWorkerCount; i++) {
      const worker = new Worker(workerUrl, { type: "module" })
      workers.push(worker)

      worker.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data as
          | { type: "ready" }
          | { type: "uploaded"; key: string }
          | { type: "failed"; path: string; error: string }

        if (message.type === "ready") {
          assignTask(worker)
          return
        }

        if (message.type === "uploaded") {
          pending--
          completed++
          console.log(`  ✓ ${message.key}`)
          assignTask(worker)
          finishIfDone()
          return
        }

        if (message.type === "failed") {
          pending--
          failed++
          console.error(`  ✗ ${message.path}: ${message.error}`)
          assignTask(worker)
          finishIfDone()
        }
      }

      worker.onerror = (event: ErrorEvent) => {
        fail(`Upload worker crashed: ${event.message}`)
      }

      worker.postMessage({ type: "configure", config })
    }
  })
}

export interface S3Token {
  accessKeyId: string
  secretAccessKey: string
}

export interface S3Destination {
  provider: "r2" | "s3"
  bucket: string
  prefix: string
}

function resolveSubfolder(subfolder: SubfolderMode): string {
  if (subfolder === SubfolderMode.None) return ""
  if (subfolder === SubfolderMode.Generate) return nanoid(8)
  if (subfolder.startsWith("hash:")) {
    const word = subfolder.slice(5)
    return xxh32(word).toString(16)
  }
  return ""
}

function resolveRegion(endpoint: string): string {
  const envRegion = process.env["NETIPLOY_REGION"] ?? process.env["S3_REGION"]
  if (envRegion) {
    return envRegion
  }

  try {
    const host = new URL(endpoint).hostname.toLowerCase()
    if (host.endsWith(".r2.cloudflarestorage.com")) {
      return "auto"
    }
  } catch {
    // Keep a sensible default if endpoint is malformed.
  }

  return "us-east-1"
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

async function deleteAllObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<void> {
  console.log(`Clearing ${bucket}/${prefix} ...`)

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

  console.log(`Deleted ${count} existing object(s)`)
}

export interface DeployArgs {
  token: S3Token
  endpoint: string
  worker: number
  source: string
  destination: S3Destination
  subfolder: SubfolderMode
  strategy: DeployStrategy
}

export interface DeployResult {
  ok: boolean
  errCode?: ErrorCode
  message?: string
  bucket?: string
  deployedPrefix?: string
}

export async function deploy(args: DeployArgs): Promise<DeployResult> {
  const { endpoint, worker, source, destination, subfolder, strategy, token } =
    args
  const region = resolveRegion(endpoint)

  // Confirm input directory exists
  try {
    const info = await stat(source)
    if (!info.isDirectory()) {
      return {
        ok: false,
        errCode: ErrorCode.FileNotFound,
        message: `Not a directory: ${source}`,
      }
    }
  } catch {
    return {
      ok: false,
      errCode: ErrorCode.FileNotFound,
      message: `Directory not found: ${source}`,
    }
  }

  const sourceDirName = basename(source)
  const resolvedSubfolder = resolveSubfolder(subfolder)
  const effectivePrefix = [destination.prefix, resolvedSubfolder, sourceDirName]
    .filter(Boolean)
    .join("/")

  const client = new S3Client({
    endpoint,
    region,
    accessKeyId: token.accessKeyId,
    secretAccessKey: token.secretAccessKey,
    bucket: destination.bucket,
  })

  try {
    if (strategy === DeployStrategy.Overwrite) {
      const prefixForDelete = effectivePrefix ? `${effectivePrefix}/` : ""
      if (prefixForDelete) {
        await deleteAllObjects(client, destination.bucket, prefixForDelete)
      }
    }

    const files = await collectFiles(source)
    console.log(
      `Uploading ${files.length} file(s) with ${worker} worker(s) ...`,
    )

    const uploadTasks: UploadTask[] = files.map((absolutePath, id) => {
      const relativePath = relative(source, absolutePath)
      const s3RelPath = relativePath.split(sep).join("/")
      const s3Key = effectivePrefix
        ? `${effectivePrefix}/${s3RelPath}`
        : s3RelPath

      return {
        id,
        absolutePath,
        s3Key,
      }
    })

    const uploadResult = await runUploadWorkers({
      workerCount: worker,
      config: {
        endpoint,
        region,
        accessKeyId: token.accessKeyId,
        secretAccessKey: token.secretAccessKey,
        bucket: destination.bucket,
      },
      tasks: uploadTasks,
    })

    if (uploadResult.failed > 0) {
      return {
        ok: false,
        errCode: ErrorCode.ServerError,
        message: `${uploadResult.failed} file(s) failed to upload`,
      }
    }

    return {
      ok: true,
      bucket: destination.bucket,
      deployedPrefix: effectivePrefix,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isConnError =
      msg.includes("ECONNREFUSED") ||
      msg.includes("ECONNRESET") ||
      msg.includes("InvalidCredentials") ||
      msg.includes("403") ||
      msg.includes("401")

    return {
      ok: false,
      errCode: isConnError ? ErrorCode.Unconnectable : ErrorCode.InternalError,
      message: msg,
    }
  }
}
