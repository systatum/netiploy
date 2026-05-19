import type { RunnerContext } from ".."
import { createSpinner } from "../../utils"
import { UploadWorker } from "../UploadWorker"
import type { UploadTask, UploadWorkerConfig } from "../worker"

export abstract class DeployRunner {
  abstract execute(ctx: RunnerContext): Promise<void>

  protected async runUploadWorkers(
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
}

interface RunUploadWorkerArgs {
  workerCount: number
  config: UploadWorkerConfig
  tasks: UploadTask[]
}

interface UploadOutcome {
  completed: number
  failed: number
}
