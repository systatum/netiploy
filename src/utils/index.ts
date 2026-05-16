import { print } from "./reporter"

export { xxh32 } from "./xxh32"
export {
  printBanner,
  print,
  printMeta,
  printHeader,
  printSummary,
  createSpinner,
} from "./reporter"
export type { ReporterLevel, Spinner } from "./reporter"

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function printOk(message: string): void {
  print("ok", message)
}

export function printInfo(message: string): void {
  print("info", message)
}

export function printError(message: string): void {
  print("error", message)
}

export function printWarn(message: string): void {
  print("warn", message)
}
