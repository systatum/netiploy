import { S3Client } from "bun"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { beforeEach } from "node:test"
import { deploy, DeployStrategy } from "../src/deployer"
import { ClientProvider } from "../src/deployer/config"
import { SubfolderMode } from "../src/deployer/files"
import { ErrorCode } from "../src/error"

const LOCALSTACK_ENDPOINT = "http://localhost:4566"
const TEST_BUCKET = "netiploy-test"
const TEST_TOKEN = {
  accessKeyId: "test",
  secretAccessKey: "test",
} // localstack accepts any credentials

const client = new S3Client({
  endpoint: LOCALSTACK_ENDPOINT,
  accessKeyId: "test",
  secretAccessKey: "test",
  bucket: TEST_BUCKET,
  region: "us-east-1",
})

async function ensureBucket(): Promise<void> {
  try {
    await client.write(".init", "")
    await client.delete(".init")
  } catch {
    // Bucket may already have the sentinel; that's fine.
  }
}

/** Remove every object inside a prefix (best-effort, for cleanup). */
async function purgePrefix(prefix: string): Promise<void> {
  const response = await client.list({ prefix })
  for (const obj of response.contents ?? []) {
    await client.delete(obj.key)
  }
}

/** Build a temporary local directory filled with sample files. */
async function buildFixtureDir(name: string): Promise<string> {
  const dir = join(import.meta.dir, ".tmp", name)
  await mkdir(join(dir, "assets"), { recursive: true })
  await writeFile(join(dir, "index.html"), "<html><body>Hello</body></html>")
  await writeFile(join(dir, "style.css"), "body { margin: 0; }")
  await writeFile(join(dir, "assets", "logo.svg"), "<svg/>")
  return dir
}

// ---------------------------------------------------------------------------

describe("deploy", () => {
  let fixtureDir: string

  beforeAll(async () => {
    await ensureBucket()
    fixtureDir = await buildFixtureDir("site")
  })

  afterAll(async () => {
    await purgePrefix("site/")
    await purgePrefix("")
    await rm(join(import.meta.dir, ".tmp"), { recursive: true, force: true })
  })

  beforeEach(async () => {
    await purgePrefix("site/")
    await purgePrefix("")
  })

  test("subfolder=none uploads directory to the bucket root", async () => {
    let listed = await client.list({ prefix: "" })
    let keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).toBeEmpty() // ensure nothing in the folder

    const result = await deploy({
      worker: 3,
      source: fixtureDir,
      clientConfig: {
        token: TEST_TOKEN,
        endpoint: LOCALSTACK_ENDPOINT,
        provider: ClientProvider.S3,
        region: "us-east-1",
        bucket: TEST_BUCKET,
        prefix: "",
      },
      subfolder: SubfolderMode.None,
      strategy: DeployStrategy.Overwrite,
    })

    expect(result.ok).toBe(true)
    expect(result.publicUrl).toContain(`/${TEST_BUCKET}/site`)

    // Verify the files actually exist in S3
    listed = await client.list({ prefix: "" })
    keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).toContain("site/index.html")
    expect(keys).toContain("site/style.css")
    expect(keys).toContain("site/assets/logo.svg")
  })

  test("subfolder=none uploads content of directory to the bucket root", async () => {
    let listed = await client.list({ prefix: "" })
    let keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).toBeEmpty() // ensure nothing in the folder

    const sourceDir = `${fixtureDir}/*`
    const result = await deploy({
      worker: 3,
      source: sourceDir,
      clientConfig: {
        token: TEST_TOKEN,
        endpoint: LOCALSTACK_ENDPOINT,
        provider: ClientProvider.S3,
        region: "us-east-1",
        bucket: TEST_BUCKET,
        prefix: "",
      },
      subfolder: SubfolderMode.None,
      strategy: DeployStrategy.Overwrite,
    })

    expect(result.ok).toBe(true)
    listed = await client.list({ prefix: "" })
    keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).not.toContain("site/stale.txt")
    expect(keys).toEqual(["assets/logo.svg", "index.html", "style.css"])
  })

  test("overwrite strategy deletes existing objects before uploading", async () => {
    let listed = await client.list({ prefix: "" })
    let keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).toBeEmpty() // ensure nothing in the folder

    // Plant a stale file that should be removed
    await client.write("site/stale.txt", "old content")

    const result = await deploy({
      worker: 2,
      source: fixtureDir,
      clientConfig: {
        token: TEST_TOKEN,
        endpoint: LOCALSTACK_ENDPOINT,
        provider: ClientProvider.S3,
        region: "us-east-1",
        bucket: TEST_BUCKET,
        prefix: "",
      },
      subfolder: SubfolderMode.None,
      strategy: DeployStrategy.Overwrite,
    })

    expect(result.ok).toBe(true)
    listed = await client.list({ prefix: "site/" })
    keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).not.toContain("site/stale.txt")
    expect(keys).toEqual([
      "site/assets/logo.svg",
      "site/index.html",
      "site/style.css",
    ])
  })

  test("subfolder=generate appends an 8-char nanoid to the prefix", async () => {
    let listed = await client.list({ prefix: "" })
    let keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).toBeEmpty() // ensure nothing in the folder

    const result = await deploy({
      worker: 2,
      source: fixtureDir,
      clientConfig: {
        token: TEST_TOKEN,
        endpoint: LOCALSTACK_ENDPOINT,
        provider: ClientProvider.S3,
        region: "us-east-1",
        bucket: TEST_BUCKET,
        prefix: "previews",
      },
      subfolder: SubfolderMode.Generate,
      strategy: DeployStrategy.Overwrite,
    })

    expect(result.ok).toBe(true)
    const url = result.publicUrl ?? ""
    const prefix = url.split(`/${TEST_BUCKET}/`)[1] ?? ""
    expect(prefix).toMatch(/^previews\/.{8}\/site$/)

    listed = await client.list({ prefix: "" })
    keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys.length).toEqual(3)

    // Cleanup
    await purgePrefix(prefix + "/")
  })

  test("subfolder=generate uploads content of directory to the generated directory", async () => {
    let listed = await client.list({ prefix: "" })
    let keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).toBeEmpty() // ensure nothing in the folder

    const result = await deploy({
      worker: 2,
      source: `${fixtureDir}/*`,
      clientConfig: {
        token: TEST_TOKEN,
        endpoint: LOCALSTACK_ENDPOINT,
        provider: ClientProvider.S3,
        region: "us-east-1",
        bucket: TEST_BUCKET,
        prefix: "previews",
      },
      subfolder: SubfolderMode.Generate,
      strategy: DeployStrategy.Overwrite,
    })

    expect(result.ok).toBe(true)
    const url = result.publicUrl ?? ""
    const prefix = url.split(`/${TEST_BUCKET}/`)[1] ?? ""
    expect(prefix).toMatch(/^previews\/.{8}$/)

    listed = await client.list({ prefix: "" })
    keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys.length).toEqual(3)

    // Cleanup
    await purgePrefix(prefix + "/")
  })

  test("subfolder=hash:<word> produces a deterministic xxh32 hex subfolder", async () => {
    const word = "pr-123"

    const result1 = await deploy({
      worker: 2,
      source: fixtureDir,
      clientConfig: {
        token: TEST_TOKEN,
        endpoint: LOCALSTACK_ENDPOINT,
        provider: ClientProvider.S3,
        region: "us-east-1",
        bucket: TEST_BUCKET,
        prefix: "prs",
      },
      subfolder: `hash:${word}`,
      strategy: DeployStrategy.Overwrite,
    })
    const result2 = await deploy({
      worker: 2,
      source: fixtureDir,
      clientConfig: {
        token: TEST_TOKEN,
        endpoint: LOCALSTACK_ENDPOINT,
        provider: ClientProvider.S3,
        region: "us-east-1",
        bucket: TEST_BUCKET,
        prefix: "prs",
      },
      subfolder: `hash:${word}`,
      strategy: DeployStrategy.Overwrite,
    })

    expect(result1.ok).toBe(true)
    expect(result2.ok).toBe(true)
    // Both deployments must land in the same prefix
    const prefix1 = (result1.publicUrl ?? "").split(`/${TEST_BUCKET}/`)[1] ?? ""
    const prefix2 = (result2.publicUrl ?? "").split(`/${TEST_BUCKET}/`)[1] ?? ""
    expect(prefix1).toBe(prefix2)

    // Cleanup
    await purgePrefix(prefix1 + "/")
  })

  test("subfolder=hash:<word> uploads content of directory to the generated directory", async () => {
    let listed = await client.list({ prefix: "" })
    let keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).toBeEmpty() // ensure nothing in the folder

    const word = "pr-123"

    const result1 = await deploy({
      worker: 2,
      source: `${fixtureDir}/*`,
      clientConfig: {
        token: TEST_TOKEN,
        endpoint: LOCALSTACK_ENDPOINT,
        provider: ClientProvider.S3,
        region: "us-east-1",
        bucket: TEST_BUCKET,
        prefix: "prs",
      },
      subfolder: `hash:${word}`,
      strategy: DeployStrategy.Overwrite,
    })
    const result2 = await deploy({
      worker: 2,
      source: `${fixtureDir}/*`,
      clientConfig: {
        token: TEST_TOKEN,
        endpoint: LOCALSTACK_ENDPOINT,
        provider: ClientProvider.S3,
        region: "us-east-1",
        bucket: TEST_BUCKET,
        prefix: "prs",
      },
      subfolder: `hash:${word}`,
      strategy: DeployStrategy.Overwrite,
    })

    listed = await client.list({ prefix: "" })
    keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).toEqual([
      "prs/ce1506b9/assets/logo.svg",
      "prs/ce1506b9/index.html",
      "prs/ce1506b9/style.css",
    ]) // ensure nothing in the folder

    expect(result1.ok).toBe(true)
    expect(result2.ok).toBe(true)
    // Both deployments must land in the same prefix
    const prefix1 = (result1.publicUrl ?? "").split(`/${TEST_BUCKET}/`)[1] ?? ""
    const prefix2 = (result2.publicUrl ?? "").split(`/${TEST_BUCKET}/`)[1] ?? ""
    expect(prefix1).toBe(prefix2)

    // Cleanup
    await purgePrefix(prefix1 + "/")
  })

  test("subfolder=hash:<word> does not allow space in the word", async () => {
    const word = "pr 123"

    expect(
      async () =>
        await deploy({
          worker: 2,
          source: fixtureDir,
          clientConfig: {
            token: TEST_TOKEN,
            endpoint: LOCALSTACK_ENDPOINT,
            provider: ClientProvider.S3,
            region: "us-east-1",
            bucket: TEST_BUCKET,
            prefix: "prs",
          },
          subfolder: `hash:${word}`,
          strategy: DeployStrategy.Overwrite,
        }),
    ).toThrowError("String to hash must not contain spaces")
  })

  test("specifying publicUrl", async () => {
    let listed = await client.list({ prefix: "" })
    let keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).toBeEmpty() // ensure nothing in the folder

    const result = await deploy({
      worker: 3,
      source: fixtureDir,
      publicUrl: "https://coneto.systatum.com",
      clientConfig: {
        token: TEST_TOKEN,
        endpoint: LOCALSTACK_ENDPOINT,
        provider: ClientProvider.S3,
        region: "us-east-1",
        bucket: TEST_BUCKET,
        prefix: "",
      },
      subfolder: SubfolderMode.None,
      strategy: DeployStrategy.Overwrite,
    })

    expect(result.ok).toBe(true)
    expect(result.publicUrl).toEqual("https://coneto.systatum.com/site")

    // Verify the files actually exist in S3
    listed = await client.list({ prefix: "" })
    keys = (listed.contents ?? []).map((o) => o.key)
    expect(keys).toContain("site/index.html")
    expect(keys).toContain("site/style.css")
    expect(keys).toContain("site/assets/logo.svg")
  })

  test("returns FileNotFound error for non-existent source dir", async () => {
    const result = await deploy({
      worker: 2,
      source: "/tmp/does-not-exist-netiploy",
      clientConfig: {
        token: TEST_TOKEN,
        endpoint: LOCALSTACK_ENDPOINT,
        provider: ClientProvider.S3,
        region: "us-east-1",
        bucket: TEST_BUCKET,
        prefix: "",
      },
      subfolder: SubfolderMode.None,
      strategy: DeployStrategy.Overwrite,
    })

    expect(result.ok).toBe(false)
    expect(result.errCode).toBe(ErrorCode.IOError)
  })
})
