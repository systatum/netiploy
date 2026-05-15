export const ErrorCode = {
  InternalError: 100,
  CmdLineError: 101,
  FileNotFound: 110,
  ServerError: 200,
  Unconnectable: 210,
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]
