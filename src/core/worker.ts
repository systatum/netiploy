import { S3Client } from "bun"

interface UploadWorkerConfig {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

interface UploadTask {
  id: number
  absolutePath: string
  s3Key: string
}

type WorkerIncomingMessage =
  | { type: "configure"; config: UploadWorkerConfig }
  | { type: "upload"; task: UploadTask }
  | { type: "shutdown" }

interface WorkerRuntime {
  onmessage: ((event: MessageEvent<WorkerIncomingMessage>) => void) | null
  postMessage: (message: unknown) => void
  close: () => void
}

const runtime = globalThis as unknown as WorkerRuntime

let client: S3Client | null = null

runtime.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  const message = event.data

  if (message.type === "configure") {
    client = new S3Client({
      endpoint: message.config.endpoint,
      region: message.config.region,
      accessKeyId: message.config.accessKeyId,
      secretAccessKey: message.config.secretAccessKey,
      bucket: message.config.bucket,
    })
    runtime.postMessage({ type: "ready" })
    return
  }

  if (message.type === "upload") {
    if (!client) {
      runtime.postMessage({
        type: "failed",
        path: message.task.absolutePath,
        error: "Worker not configured",
      })
      return
    }

    try {
      const localFile = Bun.file(message.task.absolutePath)
      const remoteFile = client.file(message.task.s3Key, {
        type: localFile.type,
      })
      await remoteFile.write(localFile)
      runtime.postMessage({ type: "uploaded", key: message.task.s3Key })
    } catch (err) {
      runtime.postMessage({
        type: "failed",
        path: message.task.absolutePath,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }

  if (message.type === "shutdown") {
    runtime.close()
  }
}
