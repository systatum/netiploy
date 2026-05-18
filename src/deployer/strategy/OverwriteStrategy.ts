import { relative, sep } from "path"
import { DeployRunner } from "."
import type { RunnerContext } from ".."
import { printInfo } from "../../utils"
import { collectFilesPath, deleteAllObjects } from "../files"
import type { UploadTask } from "../worker"

export class OverwriteStrategy extends DeployRunner {
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

    const files = await collectFilesPath(ctx.source)
    printInfo(`Collected ${files.length} files to upload`)
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

    const result = await this.runUploadWorkers({
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
