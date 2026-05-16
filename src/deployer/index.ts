import { S3Client } from "bun"
import { stat } from "fs/promises"
import { SubfolderMode } from "../deployer/files"
import { ErrorCode } from "../error"
import { printInfo } from "../utils"
import { isUnconnectableError } from "../utils/checker"
import {
  ClientProvider,
  resolveConfig,
  type ClientConfig,
  type ResolvedClientConfig,
} from "./config"
import { type DeployRunner } from "./strategy"
import { OverwriteStrategy } from "./strategy/OverwriteStrategy"

export interface RunnerContext {
  client: S3Client
  source: string
  clientConfig: ResolvedClientConfig
  workerCount?: number
}

export const DeployStrategy = {
  Overwrite: "overwrite", // clears the destination prefix before uploading
} as const

export type DeployStrategy =
  (typeof DeployStrategy)[keyof typeof DeployStrategy]

export interface DeployArgs {
  strategy: DeployStrategy
  source: string
  subfolder: SubfolderMode
  worker: number
  clientConfig: ClientConfig
}

export interface DeployResult {
  ok: boolean
  errCode?: ErrorCode
  message?: string
  publicUrl?: string
}

function resolveStrategy(strategy: string): DeployRunner {
  switch (strategy) {
    case "overwrite":
      return new OverwriteStrategy()
    default:
      throw new Error(`Unknown deploy strategy: ${strategy}`)
  }
}

function buildPublicUrl(config: ResolvedClientConfig): string {
  const { provider, bucket, prefix, endpoint } = config
  const pathSegment = prefix ? `/${prefix}` : ""

  switch (provider) {
    case ClientProvider.R2:
      return `https://${bucket}.r2.dev${pathSegment}`
    default:
      return `${endpoint}/${bucket}${pathSegment}`
  }
}

export async function deploy(args: DeployArgs): Promise<DeployResult> {
  const { source, strategy } = args

  // Confirm input directory exists
  try {
    const info = await stat(source)
    if (!info.isDirectory()) {
      return {
        ok: false,
        errCode: ErrorCode.IOError,
        message: `Not a directory: ${source}`,
      }
    }
  } catch {
    return {
      ok: false,
      errCode: ErrorCode.IOError,
      message: `Directory not found: ${source}`,
    }
  }

  const resolvedConfig = resolveConfig(args)

  try {
    const client = new S3Client({
      endpoint: resolvedConfig.endpoint,
      region: resolvedConfig.region,
      accessKeyId: resolvedConfig.token.accessKeyId,
      secretAccessKey: resolvedConfig.token.secretAccessKey,
      bucket: resolvedConfig.bucket,
    })

    await client.list({ maxKeys: 0 }) // warm up the client to fail fast on auth/network errors

    printInfo(`Using strategy: ${strategy}`)
    const runner = resolveStrategy(strategy)
    await runner.execute({
      client,
      source,
      clientConfig: resolvedConfig,
      workerCount: args.worker,
    })

    return {
      ok: true,
      publicUrl: buildPublicUrl(resolvedConfig),
    }
  } catch (err) {
    const msg = String(err)
    const isUnc = isUnconnectableError(err)

    return {
      ok: false,
      errCode: isUnc ? ErrorCode.Unconnectable : ErrorCode.InternalError,
      message: msg,
    }
  }
}
