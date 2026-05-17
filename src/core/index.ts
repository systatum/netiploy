export { ErrorCode } from "../error"
export {
  type DeployArgs,
  type DeployResult,
  DeployStrategy,
  SubfolderMode,
  deploy,
} from "./deployer"

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
