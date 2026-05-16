export const ErrorCode = {
  // Generic unknown self-side/internal error (program crashes, that's not covered by any specific error)
  InternalError: 100,
  // Command-line argument error (for whatever reason)
  CmdLineError: 101,
  // File/folder not found
  IOError: 110,
  // Generic unknown server-side/remote error
  ServerError: 200,
  // Unconnectable (the end server can no longer be communicated with for whatever reason,
  // ie token revoked/invalid, connection reset by peer, etc)
  Unconnectable: 210,
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

function defaultMessage(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.InternalError:
      return "An unexpected error has occurred"
    case ErrorCode.CmdLineError:
      return "Invalid command-line arguments"
    case ErrorCode.IOError:
      return "File or directory not found"
    case ErrorCode.ServerError:
      return "A server-side error occurred"
    case ErrorCode.Unconnectable:
      return "Could not connect to the remote endpoint"
  }
}

export function buildErrorMessage(code: ErrorCode, details?: string): string {
  const msg = details || defaultMessage(code)
  return `ERR${code}. ${msg}`.trim()
}
