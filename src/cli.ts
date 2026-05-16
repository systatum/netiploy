import { InvalidArgumentError, Option, program } from "commander"
import { resolve } from "node:path"
import {
  deploy,
  DeployStrategy,
  SubfolderMode,
  ErrorCode,
  NetiployProvider,
  type NetiployDestination,
  type NetiployToken,
} from "./core"
import { VERSION } from "."
import { buildErrorMessage } from "./error"
import {
  printBanner,
  printMeta,
  printSummary,
  formatDurationMs,
  printInfo,
  printError,
  printWarn,
} from "./utils"

interface DeployOptions {
  token?: NetiployToken
  endpoint?: string
  region?: string
  worker: number
  subfolder: SubfolderMode | string
  strategy: DeployStrategy
}

program
  .name("netiploy")
  .description("Deploy static files to Cloudflare R2 or S3-compatible storage")
  .version(`Systatum Netiploy ${VERSION}`, "-v, --version")
  .configureOutput({
    writeErr: (str) => {
      printError(buildErrorMessage(ErrorCode.CmdLineError, str))
    },
  })

program
  .command("deploy")
  .description("Deploy a local folder to a remote bucket")
  .argument("<source>", "Local folder to deploy")
  .argument(
    "<destination...>",
    'Destination in format "r2/{bucket}" or "r2/{bucket}/{prefix}"',
  )
  .option(
    "--token <token>",
    "Auth token in accessKeyId:secretAccessKey format",
    (value) => {
      const colonIdx = value.indexOf(":")
      if (colonIdx === -1) {
        throw new InvalidArgumentError(
          "Token must be in format 'accessKeyId:secretAccessKey'",
        )
      }
      return <NetiployToken>{
        accessKeyId: value.slice(0, colonIdx),
        secretAccessKey: value.slice(colonIdx + 1),
      }
    },
  )
  .option(
    "--endpoint <url>",
    "S3-compatible endpoint URL (e.g. https://<id>.r2.cloudflarestorage.com)",
    process.env["NETIPLOY_ENDPOINT"] ?? process.env["S3_ENDPOINT"],
  )
  .option(
    "--region <name>",
    "S3 region (default: auto-detect or us-east-1)",
    process.env["NETIPLOY_REGION"] ?? process.env["S3_REGION"],
  )
  .option(
    "--worker <n>",
    "Number of concurrent upload workers (default: 5)",
    (value) => {
      const n = parseInt(value, 10)
      if (isNaN(n) || n < 1) {
        throw new InvalidArgumentError(
          `--worker must be a positive integer, got "${value}"`,
        )
      }
      return n
    },
    5,
  )
  .option(
    "--subfolder <mode>",
    "Subfolder mode: none | generate | hash:<word> (default: none)",
    (value) => {
      if (value === SubfolderMode.None || value === SubfolderMode.Generate) {
        return value
      }
      if (value.startsWith("hash:")) {
        const word = value.slice(5)
        if (word.includes(" ")) {
          throw new InvalidArgumentError(
            `--subfolder hash word must not contain spaces: "${word}"`,
          )
        }
        return value
      }
      throw new InvalidArgumentError(
        `Invalid --subfolder value "${value}". Expected: none | generate | hash:<word>`,
      )
    },
    SubfolderMode.None,
  )
  .addOption(
    new Option(
      "--strategy <mode>",
      "Deploy strategy: overwrite (default: overwrite)",
    )
      .choices(Object.values(DeployStrategy))
      .default(DeployStrategy.Overwrite),
  )
  .action(
    async (
      source: string,
      destinationArgs: string[],
      options: DeployOptions,
    ) => {
      let destStr: string
      if (destinationArgs.length === 2 && destinationArgs[0] === "to") {
        destStr = destinationArgs[1]!
      } else if (destinationArgs.length === 1 && destinationArgs[0] !== "to") {
        destStr = destinationArgs[0]!
      } else if (destinationArgs.length === 1) {
        throw new InvalidArgumentError(
          `Missing destination. Usage: netiploy deploy <source> [to] <provider>/<bucket>[/<prefix>]`,
        )
      } else {
        throw new InvalidArgumentError(
          `Unexpected arguments: ${destinationArgs.join(" ")}. ` +
            `Usage: netiploy deploy <source> [to] <provider>/<bucket>[/<prefix>]`,
        )
      }

      const parts = destStr.split("/")
      if (parts.length < 2) {
        throw new InvalidArgumentError(
          "Destination must be in format '{provider}/{bucket}' or '{provider}/{bucket}/{prefix}'",
        )
      }

      const [provider, bucket, ...prefixParts] = parts

      const providers = Object.values(NetiployProvider)
      if (!providers.includes(provider as NetiployProvider)) {
        throw new InvalidArgumentError(
          `Unsupported provider "${provider}". Supported providers: ${providers.join(", ")}`,
        )
      }

      const destination: NetiployDestination = {
        provider: provider as NetiployProvider,
        bucket: bucket!,
        prefix: prefixParts.join("/"),
      }

      const { token, endpoint, region, strategy, subfolder, worker } = options
      const inputDir = resolve(source)

      const accessKeyId =
        token?.accessKeyId ??
        process.env["NETIPLOY_ACCESS_KEY_ID"] ??
        process.env["S3_ACCESS_KEY_ID"]
      const secretAccessKey =
        token?.secretAccessKey ??
        process.env["NETIPLOY_SECRET_ACCESS_KEY"] ??
        process.env["S3_SECRET_ACCESS_KEY"]

      if (!accessKeyId || !secretAccessKey) {
        throw new InvalidArgumentError(
          "Missing or invalid credentials. Provide via --token or environment variables.",
        )
      }

      if (!endpoint) {
        throw new InvalidArgumentError(
          "Missing endpoint URL. Provide via --endpoint or environment variables.",
        )
      }

      printInfo(
        `Deploying ${inputDir} to ${destination.provider}/${destination.bucket}/${destination.prefix}...`,
      )

      // Temporary warning (remove once we fully support S3)
      if (provider !== NetiployProvider.R2) {
        printWarn(
          `Using "${provider}" may not work correctly. Currently, only "r2" provider is fully supported.`,
        )
      }

      const startedAt = Date.now()
      const result = await deploy({
        token: token ?? {
          accessKeyId: accessKeyId,
          secretAccessKey: secretAccessKey,
        },
        endpoint,
        workerCount: worker,
        source: inputDir,
        destination,
        subfolder: subfolder as Parameters<typeof deploy>[0]["subfolder"],
        strategy: strategy as Parameters<typeof deploy>[0]["strategy"],
        region,
      })

      if (result.ok) {
        const prefix = result.deployedPrefix ?? ""
        printSummary(
          `Deployment successful! (${formatDurationMs(Date.now() - startedAt)})`,
        )
        printMeta("Bucket", result.bucket ?? "")
        printMeta(
          "Prefix",
          [result.bucket ?? "", prefix].filter(Boolean).join("/"),
        )
      } else {
        throw new Error(result.message ?? "Deployment failed", {
          cause: result.errCode ?? ErrorCode.InternalError,
        })
      }
    },
  )

program.on("command:*", (unknownCmds: string[]) => {
  throw new InvalidArgumentError(`Unknown command: ${unknownCmds.join(" ")}`)
})

printBanner(`Netiploy v${VERSION}`)

program.parseAsync().catch((err: Error & { cause?: ErrorCode }) => {
  if (err instanceof InvalidArgumentError) {
    printError(buildErrorMessage(ErrorCode.CmdLineError, err.message))
    process.exit(err.exitCode)
  }
  const code = err.cause ?? ErrorCode.InternalError
  printError(buildErrorMessage(code, err.message))
  process.exit(code)
})
