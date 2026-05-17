import { S3Client } from "bun"
import { stat } from "fs/promises"
import { nanoid } from "nanoid"
import { ErrorCode } from "../error"
import { xxh32 } from "../utils/xxh32"
import { basename } from "path"
import { OverwriteStrategy, type DeployRunner } from "./runner"
import { ClientProvider, type ClientConfig, type ResolvedClientConfig } from "."
import { printInfo } from "../utils"

export const SubfolderMode = {
  None: "none",
  Generate: "generate",
} as const

export type SubfolderMode =
  | (typeof SubfolderMode)[keyof typeof SubfolderMode]
  | `hash:${string}`

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

// Resolves the nullable properties of ClientConfig and applies provider-specific defaults
function resolveConfig(args: DeployArgs): ResolvedClientConfig {
  const sourceDirName = basename(args.source)
  const resolvedSubfolder = resolveSubfolder(args.subfolder)

  const prefix = [args.clientConfig.prefix, resolvedSubfolder, sourceDirName]
    .filter(Boolean)
    .join("/")

  let endpoint = args.clientConfig.endpoint
  let region = args.clientConfig.region
  let accountId = args.clientConfig.accountId ?? "default-account"

  switch (args.clientConfig.provider) {
    case ClientProvider.R2:
      endpoint = `https://${accountId}.r2.cloudflarestorage.com/`
      region = "auto"
      break
    case ClientProvider.S3:
      // For S3, assume LocalStack on localhost port 4566
      endpoint = "http://localhost:4566"
      region = "us-east-1"
      break
    default:
      throw new Error(`Unsupported provider: ${args.clientConfig.provider}`)
  }

  return {
    ...args.clientConfig,
    accountId,
    endpoint,
    region,
    prefix,
  }
}

function resolveSubfolder(subfolder: SubfolderMode): string {
  switch (subfolder) {
    case SubfolderMode.None:
      return ""
    case SubfolderMode.Generate:
      return nanoid(8)
    default:
      if (subfolder.startsWith("hash:")) {
        const word = subfolder.slice(5)
        return xxh32(word).toString(16)
      }
      return ""
  }
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

    // Classify network/auth errors without fragile substring matching.
    // Bun's S3Client surfaces these as specific error names or HTTP status codes.
    const isAuthOrNetworkError =
      (err instanceof Error &&
        (err.name === "S3Error" ||
          err.name === "NetworkError" ||
          err.name === "FetchError")) ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("InvalidAccessKeyId") ||
      msg.includes("InvalidClientTokenId") ||
      msg.includes("SignatureDoesNotMatch")

    return {
      ok: false,
      errCode: isAuthOrNetworkError
        ? ErrorCode.Unconnectable
        : ErrorCode.InternalError,
      message: msg,
    }
  }
}
