#!/usr/bin/env bun

import { InvalidArgumentError, Option, program } from "commander"
import { resolve } from "node:path"
import { VERSION } from "."
import { deploy, DeployStrategy } from "./deployer"
import { ClientProvider, type ClientToken } from "./deployer/config"
import { SubfolderMode } from "./deployer/files"
import { buildErrorMessage, ErrorCode } from "./error"
import {
  formatDurationMs,
  printBanner,
  printError,
  printInfo,
  printMeta,
  printSummary,
} from "./utils"

interface DeployOptions {
  token?: ClientToken
  accountId?: string
  worker: number
  subfolder: SubfolderMode
  strategy: DeployStrategy
  publicUrl?: string
}

program
  .name("netiploy")
  .description("Deploy static files to Cloudflare R2 storage")
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
    (value) => parseAPIToken(value),
  )
  .option(
    "--account-id <id>",
    "Cloudflare R2 account ID (overrides R2_ACCOUNT_ID)",
    process.env["R2_ACCOUNT_ID"],
  )
  .option(
    "--worker <n>",
    "Number of concurrent upload workers (default: 5)",
    (value) => parseNumberOfWorkers(value),
    5,
  )
  .option(
    "--subfolder <mode>",
    "Subfolder mode: none | generate | hash:<word> (default: none)",
    (value) => value,
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
  .addOption(
    new Option(
      "--public-url <url>",
      "Public URL of the bucket to be printed in place of the bucket's private URL",
    ).default(""),
  )
  .action(
    async (
      source: string,
      destinationArgs: string[],
      options: DeployOptions,
    ) => {
      const { token, strategy, subfolder, worker, accountId, publicUrl } =
        options

      // resolve carefully if "/*" is provided
      if (source.endsWith("/*")) {
        source = `${resolve(source.replace("/*", ""))}/*`
      } else {
        source = resolve(source)
      }

      const destStr: string = parseDestinationArgs(destinationArgs)
      const parts = destStr.split("/")
      if (parts.length < 2) {
        throw new InvalidArgumentError(
          "Destination must be in format '{provider}/{bucket}' or '{provider}/{bucket}/{prefix}'",
        )
      }

      const [provider, bucket, ...prefixParts] = parts

      const providers = Object.values(ClientProvider)
      if (!providers.includes(provider as ClientProvider)) {
        throw new InvalidArgumentError(
          `Unsupported provider "${provider}". Supported providers: ${providers.join(", ")}`,
        )
      }

      const accessKeyId =
        token?.accessKeyId ||
        process.env["NETIPLOY_ACCESS_KEY_ID"] ||
        process.env["S3_ACCESS_KEY_ID"]
      const secretAccessKey =
        token?.secretAccessKey ||
        process.env["NETIPLOY_SECRET_ACCESS_KEY"] ||
        process.env["S3_SECRET_ACCESS_KEY"]

      if (!accessKeyId || !secretAccessKey) {
        throw new InvalidArgumentError(
          "Missing or invalid credentials. Provide via --token or environment variables.",
        )
      }

      // Validate provider-specific requirements
      if (provider === ClientProvider.R2) {
        // Require account ID for R2
        const resolvedAccountId = accountId || process.env["R2_ACCOUNT_ID"]
        if (!resolvedAccountId) {
          throw new InvalidArgumentError(
            "Missing Cloudflare R2 account ID. Provide via --account-id or R2_ACCOUNT_ID env var.",
          )
        }
      } else if (provider === ClientProvider.S3) {
        // S3 is allowed (supports LocalStack)
      } else {
        throw new InvalidArgumentError(
          `Provider '${provider}' is not supported. Supported: ${Object.values(ClientProvider).join(", ")}`,
        )
      }

      if (!bucket) {
        throw new InvalidArgumentError("Bucket name is required in destination")
      }

      printBanner(`Netiploy Deploy v${VERSION}`)

      printInfo(
        `Deploying ${source} to ${provider}/${bucket}/${prefixParts.join("/")}`,
      )

      const startedAt = Date.now()
      const result = await deploy({
        strategy: strategy as DeployStrategy,
        source: source,
        subfolder: subfolder as SubfolderMode,
        worker: worker,
        publicUrl: publicUrl,
        clientConfig: {
          token: token ?? {
            accessKeyId: accessKeyId,
            secretAccessKey: secretAccessKey,
          },
          provider: provider as ClientProvider,
          bucket: bucket,
          accountId: accountId,
          prefix: prefixParts.join("/"),
        },
      })
      const deployDuration = Date.now() - startedAt

      if (result.ok) {
        printSummary(
          `Deployment successful! (${formatDurationMs(deployDuration)})`,
        )
        printMeta("Public URL", result.publicUrl ?? "N/A")
      } else {
        printSummary(`Deployment failed! (${formatDurationMs(deployDuration)})`)
        throw new Error(result.message ?? "Deployment failed", {
          cause: result.errCode ?? ErrorCode.InternalError,
        })
      }
    },
  )

program.action(() => program.help())

program.on("command:*", (unknownCmds: string[]) => {
  throw new InvalidArgumentError(`Unknown command: ${unknownCmds.join(" ")}`)
})

program.parseAsync().catch((err: Error & { cause?: ErrorCode }) => {
  if (err instanceof InvalidArgumentError) {
    printError(buildErrorMessage(ErrorCode.CmdLineError, err.message))
    process.exit(err.exitCode)
  }
  const code = err.cause ?? ErrorCode.InternalError
  printError(buildErrorMessage(code, err.message))
  process.exit(code)
})

function parseAPIToken(value: string) {
  const colonIdx = value.indexOf(":")
  if (colonIdx === -1) {
    throw new InvalidArgumentError(
      "Token must be in format 'accessKeyId:secretAccessKey'",
    )
  }
  return <ClientToken>{
    accessKeyId: value.slice(0, colonIdx),
    secretAccessKey: value.slice(colonIdx + 1),
  }
}

function parseNumberOfWorkers(value: string) {
  const n = parseInt(value, 10)
  if (isNaN(n) || n < 1) {
    throw new InvalidArgumentError(
      `--worker must be a positive integer, got "${value}"`,
    )
  }
  return n
}

function parseDestinationArgs(destinationArgs: string[]) {
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

  return destStr
}
