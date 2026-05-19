import { S3Client } from "bun"

export interface UploadWorkerConfig {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export interface UploadTask {
  id: number
  absolutePath: string
  s3Key: string
}

type WorkerIncomingMessage =
  | { type: "configure"; config: UploadWorkerConfig }
  | { type: "upload"; task: UploadTask }

declare var self: Worker

function postFail(error: Error | string | unknown, path: string): void {
  error = error instanceof Error ? error.message : String(error)
  self.postMessage({
    type: "failed",
    path,
    error,
  })
}

let client: S3Client | null = null

self.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  const message = event.data

  switch (message.type) {
    case "configure":
      client = new S3Client({
        endpoint: message.config.endpoint,
        region: message.config.region,
        accessKeyId: message.config.accessKeyId,
        secretAccessKey: message.config.secretAccessKey,
        bucket: message.config.bucket,
      })
      self.postMessage({ type: "ready" })
      break
    case "upload":
      if (!client) {
        postFail("Worker not configured", message.task.absolutePath)
        break
      }

      try {
        const localFile = Bun.file(message.task.absolutePath)
        const remoteFile = client.file(message.task.s3Key, {
          type: localFile.type,
        })
        await remoteFile.write(localFile)
        self.postMessage({ type: "uploaded", key: message.task.s3Key })
      } catch (err) {
        postFail(err, message.task.s3Key)
      }
      break
  }
}
