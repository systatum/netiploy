export function isUnconnectableError(err: unknown) {
  const msg = String(err)

  let networkErrorClass: boolean = false
  if (err instanceof Error) {
    networkErrorClass ||=
      err.name === "S3Error" ||
      err.name === "NetworkError" ||
      err.name === "FetchError"
  }

  return (
    networkErrorClass ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("InvalidAccessKeyId") ||
    msg.includes("InvalidClientTokenId") ||
    msg.includes("SignatureDoesNotMatch")
  )
}
