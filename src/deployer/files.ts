import { readdir } from "fs/promises"
import { join } from "path"

import type { S3Client } from "bun"
import { nanoid } from "nanoid"
import { createSpinner } from "../utils"
import { xxh32 } from "../utils/xxh32"

export const SubfolderMode = {
  None: "none",
  Generate: "generate",
} as const

export type SubfolderMode =
  | (typeof SubfolderMode)[keyof typeof SubfolderMode]
  | `hash:${string}`

/**
 * Determine the target folder in the remote machine as the target of deployment
 */
export function resolveSubfolder(mode: SubfolderMode): string {
  switch (mode) {
    case SubfolderMode.None:
      return ""
    case SubfolderMode.Generate:
      return nanoid(8)
    default:
      if (mode.startsWith("hash:")) {
        const word = mode.slice(5)
        return xxh32(word).toString(16)
      }

      throw new Error("Unknown mode is given: " + mode)
  }
}

/**
 * Get a list of directory, returning the paths of each file and folder
 * inside the said directory.
 */
export async function collectFilesPath(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectFilesPath(fullPath)))
      continue
    }

    if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

export async function deleteAllObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<void> {
  const path = `${bucket}/${prefix}`
  const spinner = createSpinner(`Clearing existing objects from ${path}...`)

  try {
    let continuationToken: string | undefined
    let count = 0
    let total = 0

    do {
      const response = await client.list({
        prefix,
        continuationToken,
        maxKeys: 1000,
      })
      total += response.keyCount ?? 0
      for (const obj of response.contents ?? []) {
        await client.delete(obj.key)
        count++
        spinner.progress(count, total)
      }
      continuationToken = response.nextContinuationToken
    } while (continuationToken)

    spinner.stop("ok")
  } catch (err) {
    spinner.stop("error", `Failed to clear objects from ${path}`)
    throw err
  }
}
