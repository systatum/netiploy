const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
}

export type ReporterLevel = "info" | "ok" | "warn" | "error"

function colored(text: string, color: string): string {
  if (!process.stdout.isTTY) return text
  return `${color}${text}${ANSI.reset}`
}

export function printBanner(title: string): void {
  const line = "-".repeat(Math.max(30, title.length + 8))
  console.log(colored(line, ANSI.dim))
  console.log(colored(`  ${title}`, ANSI.bold))
  console.log(colored(line, ANSI.dim))
}

function levelTag(level: ReporterLevel): string {
  switch (level) {
    case "info":
      return colored("\u2139", ANSI.cyan)
    case "ok":
      return colored("\u2713", ANSI.green)
    case "warn":
      return colored("\u26A0", ANSI.yellow)
    case "error":
      return colored("\u2716", ANSI.red)
  }
}

export function print(level: ReporterLevel, message: string): void {
  message = level === "error" ? colored(message, ANSI.red) : message
  console.log(`${levelTag(level)} ${message}`)
}

export function printMeta(label: string, value: string | number): void {
  const paddedLabel = `${label}:`.padEnd(12, " ")
  console.log(`  ${colored(paddedLabel, ANSI.dim)}${String(value)}`)
}

export function printHeader(message: string): void {
  console.log(message)
}

export function printSummary(message: string): void {
  console.log(colored(message, ANSI.bold))
}

const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const

export type Status = "ok" | "error" | "partial"

export interface Spinner {
  stop(status: Status, finalMessage?: string): void
}

export function createSpinner(message: string): Spinner {
  if (!process.stdout.isTTY) {
    process.stdout.write(`◐ ${message}\n`)
    return {
      stop(status: Status, finalMessage?: string) {
        console.log(
          `${levelTag(status === "partial" ? "warn" : status)} ${finalMessage ?? message}`,
        )
      },
    }
  }

  let i = 0
  const interval = setInterval(() => {
    const frame = colored(
      SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]!,
      ANSI.cyan,
    )
    process.stdout.write(`\r${frame} ${message}`)
  }, 80)

  return {
    stop(status: Status, finalMessage?: string) {
      clearInterval(interval)
      const msg = (finalMessage ?? message).padEnd(message.length + 4, " ")
      process.stdout.write(
        `\r${levelTag(status === "partial" ? "warn" : status)} ${msg}\n`,
      )
    },
  }
}
