import { basename } from "path"
import type { DeployArgs } from "."
import { resolveSubfolder } from "../deployer/files"

// todo: rename to StorageProvider
export const ClientProvider = {
  R2: "r2",
  S3: "s3",
} as const

export type ClientProvider =
  (typeof ClientProvider)[keyof typeof ClientProvider]

export interface ClientToken {
  accessKeyId: string
  secretAccessKey: string
}

export interface ClientConfig {
  token: ClientToken
  provider: ClientProvider
  accountId?: string
  endpoint?: string
  region?: string
  bucket: string
  prefix: string
}

export type ResolvedClientConfig = Required<ClientConfig>

// Resolves the nullable properties of ClientConfig and applies provider-specific defaults
export function resolveConfig(args: DeployArgs): ResolvedClientConfig {
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
