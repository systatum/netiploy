# Netiploy

**Netiploy** is a Bun-optimized CLI tool for deploying static files to Cloudflare R2 (or any S3-compatible storage) without paying for Netlify.

## Installation

```bash
# Run directly with Bun (no global install required)
bun run src/cli.ts deploy ...

# Or link globally
bun run build
bun link
netiploy deploy ...
```

## Setup

### Credentials

Netiploy authenticates with an access key + secret key.

You can provide credentials in either format:

1. Combined token string via `--token`:

```
accessKeyId:secretAccessKey
```

2. Environment variables:

```bash
NETIPLOY_ACCESS_KEY_ID=...
NETIPLOY_SECRET_ACCESS_KEY=...

# aliases also supported
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

For Cloudflare R2, generate API credentials from the Cloudflare dashboard to get
an Access Key ID and Secret Access Key.

### Endpoint and Region

Netiploy detects the endpoint automatically based on the given provider. So, if you try to deploy to `r2/my-bucket/sub-folder-name`, then the constructed endpoint will be:

```bash
# r2 → cloudflare R2.
# for this to work, you still need `R2_ACCOUNT_ID` env var or `--access-token` argument to be present.
https://<account_id>.r2.cloudflarestorage.com` (region: `auto`)
```

As such, there is no need to manually supply the endpoint, for convenience!

---

## Usage

```bash
netiploy deploy <source-folder> [to] <provider>/<bucket>[/<prefix>] [options]
```

The `to` keyword is optional, both of the following are equivalent:

```bash
netiploy deploy dist to r2/my-bucket/web
netiploy deploy dist r2/my-bucket/web
```

Currently, the only supported provider is `r2` but we also plan to support `s3` (AWS instances) in the future.

### Options

| Flag                 | Default     | Description                                              |
| -------------------- | ----------- | -------------------------------------------------------- |
| `--token <token>`    | -           | `accessKeyId:secretAccessKey`.                           |
| `--account-id <id>`  | -           | Cloudflare R2 account ID (required if provider is` r2`)  |
| `--worker <n>`       | `5`         | Number of concurrent upload workers.                     |
| `--subfolder <mode>` | `none`      | See subfolder modes below.                               |
| `--strategy <mode>`  | `overwrite` | Deploy strategy (`overwrite` deletes destination first). |
| `-v, --version`      | -           | Print `Systatum Netiploy VERSION` and exit.              |
| `--help`             | -           | Show help text and exit.                                 |

### Subfolder modes

| Mode          | Behaviour                                                       |
| ------------- | --------------------------------------------------------------- |
| `none`        | Upload directly into the destination prefix.                    |
| `generate`    | Append a random 8-character nanoid to the prefix.               |
| `hash:<word>` | Append the XXH32 hex hash of `<word>` - deterministic per word. |

`<word>` must not contain spaces. An empty word (`hash:`) is valid and hashes
the empty string.

### Destination path behavior

Uploaded object keys are always built as:

```text
<destination-prefix>/<resolved-subfolder>/<source-dir-name>/<relative-file-path>
```

If `--subfolder=none`, the subfolder segment is omitted.

### Examples

```bash
# Deploy dist/ to the root of my-bucket
netiploy deploy dist to r2/my-bucket --token="$ACCESS_KEY_ID":"$SECRET_ACCESS_KEY"

# Deploy with a random preview subfolder
netiploy deploy dist to r2/my-bucket/previews \
  --subfolder=generate --token="$ACCESS_KEY_ID":"$SECRET_ACCESS_KEY"
# → uploads to r2/my-bucket/previews/<8chars>/dist/

# Deploy PR to a deterministic folder based on PR name
netiploy deploy dist to r2/my-bucket/prs \
  --subfolder=hash:pr-42 --token="$ACCESS_KEY_ID":"$SECRET_ACCESS_KEY"
# → always deploys to r2/my-bucket/prs/<xxh32("pr-42")>/dist/

# Also supports inline environment variables
S3_ACCESS_KEY_ID="$ACCESS_KEY_ID" \
S3_SECRET_ACCESS_KEY="$SECRET_ACCESS_KEY" \
netiploy deploy dist to r2/my-bucket \
  --subfolder=none
```

### GitHub Actions: CI/CD example

```yaml
- name: Deploy storybook to R2
  run: |
    pnpm build-storybook
    netiploy deploy storybook-static to r2/my-bucket \
      --subfolder=hash:${{ github.head_ref || github.ref_name }} \
      --token="${{ secrets.ACCESS_KEY_ID }}:${{ secrets.SECRET_ACCESS_KEY }}" \
```

---

## Error codes

| Code     | Meaning                                                                 |
| -------- | ----------------------------------------------------------------------- |
| `ERR100` | Generic internal error (unexpected crash).                              |
| `ERR101` | Command-line argument error (bad flag, missing required value, etc.).   |
| `ERR110` | Source file or directory not found.                                     |
| `ERR200` | Generic remote / server-side error.                                     |
| `ERR210` | Cannot connect to the storage endpoint (token revoked, network error…). |

On success the process exits with code `0` and prints:

```
Deployment successful!
Public URL: https://bucketname.dev/some-sub-folder-if-any/foldername.
```

---

## R2 configuration: serving `index.html` automatically for SPAs

By default, visiting `https://your-domain.com/some-route` on an R2-backed site
returns a 404 because R2 serves raw objects and does not automatically append
`/index.html` to directory paths.

To fix this, add a **Transform Rule** in the Cloudflare dashboard:

1. Go to **Cloudflare dashboard → your domain → Rules → Transform Rules**.
2. Create a new **URL Rewrite** rule.
3. Set the **Expression** to match requests that do not already end with a file
   extension:
   ```
   not (http.request.uri.path matches "\\.[a-zA-Z0-9]+$")
   ```
4. Set the **Path → Rewrite to… (Dynamic)** value to:
   ```
   concat(http.request.uri.path, "/index.html")
   ```

This tells Cloudflare to transparently rewrite e.g. `/my-route` → `/my-route/index.html`
before forwarding the request to R2, which makes SPAs work correctly.

> **Screenshot of the Transform Rule configuration in the Cloudflare dashboard:**
>
> ![R2 Transform Rule for SPA index.html](https://global.discourse-cdn.com/cloudflare/original/3X/f/e/fe637d9dbbff30785bc246b488a533df47dab9c0.png)
>
> _Source: [Cloudflare Community — Index.html as Root Object for SPA](https://community.cloudflare.com/t/index-html-as-root-object-for-spa/581177)_

---

## Development & testing

```bash
# Run E2E tests (requires Docker)
docker compose up -d          # start localstack
bun test tests/e2e.test.ts    # run E2E suite
docker compose down           # stop localstack
```

## Acknowledgements

The XXH32 implementation bundled in `src/xxh32.ts` is adapted from
[cgiosy/xxh32](https://github.com/cgiosy/xxh32): a fast, zero-dependency
JavaScript implementation of the XXH32 hash algorithm by Yushin Cho (cgiosy).
Full credit and thanks to the original author.
