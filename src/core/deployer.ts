import { S3Client } from "bun"
import { stat } from "fs/promises"
import { nanoid } from "nanoid"
import { ErrorCode } from "../error"
import { xxh32 } from "../utils/xxh32"
import { basename } from "path"
import { OverwriteStrategy, type DeployRunner } from "./runner"

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

export const NetiployProvider = {
  R2: "r2",
  S3: "s3",
} as const

export type NetiployProvider =
  (typeof NetiployProvider)[keyof typeof NetiployProvider]

export interface NetiployToken {
  accessKeyId: string
  secretAccessKey: string
}

export interface NetiployDestination {
  provider: NetiployProvider
  bucket: string
  prefix: string
}

export interface DeployArgs {
  token: NetiployToken
  endpoint: string
  region?: string
  workerCount: number
  source: string
  destination: NetiployDestination
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

function resolveRegion(endpoint: string): string {
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

export async function deploy(args: DeployArgs): Promise<DeployResult> {
  const { endpoint, region, source, destination, subfolder, strategy, token } =
    args

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

  const effectiveRegion = region ?? resolveRegion(endpoint)
  const sourceDirName = basename(source)
  const resolvedSubfolder = resolveSubfolder(subfolder)
  const effectivePrefix = [destination.prefix, resolvedSubfolder, sourceDirName]
    .filter(Boolean)
    .join("/")
  const effectiveDest = <NetiployDestination>{
    provider: destination.provider,
    bucket: destination.bucket,
    prefix: effectivePrefix,
  }

  const client = new S3Client({
    endpoint,
    region: effectiveRegion,
    accessKeyId: token.accessKeyId,
    secretAccessKey: token.secretAccessKey,
    bucket: effectiveDest.bucket,
  })

  try {
    const runner = resolveStrategy(strategy)
    await runner.execute(client, {
      ...args,
      destination: effectiveDest,
      region: effectiveRegion,
    })

    return {
      ok: true,
      bucket: effectiveDest.bucket,
      deployedPrefix: effectivePrefix,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
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
