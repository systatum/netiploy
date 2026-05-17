export { xxh32 } from "./xxh32"
export {
  printBanner,
  print,
  printInfo,
  printOk,
  printError,
  printWarn,
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
