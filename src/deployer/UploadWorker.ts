import type { UploadTask, UploadWorkerConfig } from "../worker"

type TaskResult =
  | { ok: true; key: string }
  | { ok: false; path: string; error: string }

type WorkerMessage =
  | { type: "ready" }
  | { type: "uploaded"; key: string }
  | { type: "failed"; path: string; error: string }

export class UploadWorker {
  private readonly worker: Worker
  private pendingResolve: ((result: TaskResult) => void) | null = null
  private pendingReject: ((err: Error) => void) | null = null
  private readyResolve: (() => void) | null = null
  private readyReject: ((err: Error) => void) | null = null

  constructor(config: UploadWorkerConfig) {
    this.worker = new Worker("./worker.ts")
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
