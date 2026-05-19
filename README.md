# Netiploy

**Netiploy** is an open-source Go CLI tool for deploying static files to Cloudflare R2 (or any S3-compatible storage) without paying for Netlify.

## Installation

```bash
make build
./build/netiploy deploy ...
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
# for this to work, you still need `R2_ACCOUNT_ID` env var or `--account-id` argument to be present.
https://<account_id>.r2.cloudflarestorage.com` (region: `auto`)
```

As such, there is no need to manually supply the endpoint, for convenience!

---

## Usage / How to Use

Basically:

```bash
netiploy deploy <source-folder> [to] <provider>/<bucket>[/<prefix>] [options]
```

The `to` keyword is optional, both of the following are equivalent:

```bash
netiploy deploy dist to r2/my-bucket/web
netiploy deploy dist r2/my-bucket/web
```

Had deloyment succeeded, the command above deploy `dist` to within the `web` subfolder of the `my-bucket` bucket. So the result URL of the deployment command:

```bash
R2_ACCOUNT_ID=something netiploy deploy example to r2/systatum-dev/coneto --token="keyid:secret"
```

Result in this URL: `https://systatum-dev.r2.dev/coneto/example`. As evident, the `example` folder is deployed within `coneto` (the subfolder) of the `systatum-dev` bucket.

It is possible that you want just to copy the content of the `example` folder, without needing to create the `example` folder in the target bucket. In that case, instead of passing `example` as argument, pass `"example/*"`. So, the command below results in a URL like: `Public URL: https://systatum-dev.r2.dev/coneto/ad034ed3`.

```bash
R2_ACCOUNT_ID=something netiploy deploy example to r2/systatum-dev/coneto --subfolder=hash:localhostadam --token="x:y"
```

The `ad034ed3` subfolder is automatically created as result of the `--subfolder=hash` argument. Had `--subfolder==hash` is not provided/given, the content of the deloyment will be just at `https://systatum-dev.r2.dev/coneto`.

Finally, it is possible to overwrite the printed public URL:

```bash
R2_ACCOUNT_ID=something netiploy deploy "example/*" to r2/systatum-dev/coneto --subfolder=hash:localhostadam --token="keyid:secret" --public-url="https://coneto.systatum.com"

i Deploying /home/someuser/Documents/works/netiploy/example/* to r2/systatum-dev/coneto
i Using strategy: overwrite
✓ Clearing existing objects from systatum-dev/coneto/ad034ed3/... [1/1] (592ms)
i Collected 1 files to upload
✓ Uploading files... [1/1] (273ms)
Deployment successful! (1.56s)
  Public URL: https://coneto.systatum.com/coneto/ad034ed3
```

As can be seen, with `public-url`, `https://coneto.systatum.com` is printed instead of what normally would be `https://systatum-dev.r2.dev/coneto`.

For detail of the arguments, please look at the table below.

### Options

| Flag                 | Default     | Description                                              |
| -------------------- | ----------- | -------------------------------------------------------- |
| `--token <token>`    | -           | `accessKeyId:secretAccessKey`.                           |
| `--account-id <id>`  | -           | Cloudflare R2 account ID (required if provider is` r2`)  |
| `--worker <n>`       | `5`         | Number of concurrent upload workers.                     |
| `--subfolder <mode>` | `none`      | See subfolder modes below.                               |
| `--strategy <mode>`  | `overwrite` | Deploy strategy (`overwrite` deletes destination first). |
| `--public-url <url>` | -           | Public URL of the bucket to be printed (for display)     |
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

## How to configure Cloudflare R2: serving `index.html` automatically for SPAs

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

## How to Test

```bash
go test ./...
```

## How to Build

```bash
# Current platform
make build

# Linux, macOS, and Windows binaries matching the old build:bin:all output names
make build-bin-all
```

## How to Publish

**NOTE:** Make sure to bump the `version` field in `package.json` and the
default `version` variable in `cmd/netiploy/main.go`. Release builds also set
the binary version from the Git tag via `-ldflags`.

### GitHub Releases

1. Run the build command for outputting binaries.

```
make build-bin-all
```

2. Upload to GitHub Releases with the approriate tag.

## Acknowledgements

The XXH32 implementation bundled in `internal/netiploy/xxh32.go` is adapted from
[cgiosy/xxh32](https://github.com/cgiosy/xxh32): a fast, zero-dependency
JavaScript implementation of the XXH32 hash algorithm by Yushin Cho (cgiosy).
Full credit and thanks to the original author.
