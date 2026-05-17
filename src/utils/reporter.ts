import { formatDurationMs } from "."

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
  const line = "─".repeat(Math.max(30, title.length + 8))
  console.log(colored(line, ANSI.dim))
  console.log(colored(`  ${title}`, ANSI.bold))
  console.log(colored(line, ANSI.dim))
}

function levelTag(level: ReporterLevel): string {
  switch (level) {
    case "info":
      return colored("i", ANSI.cyan)
    case "ok":
      return colored("\u2713", ANSI.green)
    case "warn":
      return colored("!", ANSI.yellow)
    case "error":
      return colored("X", ANSI.red)
  }
}

export function print(level: ReporterLevel, message: string): void {
  message = level === "error" ? colored(message, ANSI.red) : message
  console.log(`${levelTag(level)} ${message}`)
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
  message: string
  progress(current: number, total: number): void
  stop(status: Status, finalMessage?: string): void
}

export function createSpinner(initialMessage?: string): Spinner {
  const baseLabel = initialMessage ?? "..."
  let currentMessage = baseLabel
  let stopped = false
  let lastProgress: { current: number; total: number } | null = null
  const startTime = Date.now()

  function resolveStopMessage(finalMessage?: string): string {
    if (finalMessage !== undefined) return finalMessage
    if (lastProgress !== null) {
      const elapsed = formatDurationMs(Date.now() - startTime)
      return `${baseLabel} [${lastProgress.current}/${lastProgress.total}] (${elapsed})`
    }
    return currentMessage
  }

  if (!process.stdout.isTTY) {
    process.stdout.write(`◐ ${currentMessage}\n`)

    const spinner: Spinner = {
      get message(): string {
        return currentMessage
      },
      set message(value: string) {
        currentMessage = value
      },

      progress(current: number, total: number): void {
        lastProgress = { current, total }
        currentMessage = `${baseLabel} [${current}/${total}]`
      },

      stop(status: Status, finalMessage?: string): void {
        if (stopped) return
        stopped = true
        const resolvedStatus = status === "partial" ? "warn" : status
        const msg = resolveStopMessage(finalMessage)
        process.stdout.write(`${levelTag(resolvedStatus)} ${msg}\n`)
      },
    }

    return spinner
  }

  // For TTY output, render an animated spinner on the same line.

  let frameIndex = 0

  function renderFrame(): void {
    const frame = colored(
      SPINNER_FRAMES[frameIndex++ % SPINNER_FRAMES.length]!,
      ANSI.cyan,
    )
    process.stdout.write(`\r${frame} ${currentMessage}\x1b[K`)
  }

  const interval = setInterval(renderFrame, 80)

  renderFrame()

  const spinner: Spinner = {
    get message(): string {
      return currentMessage
    },
    set message(value: string) {
      currentMessage = value
    },

    progress(current: number, total: number): void {
      lastProgress = { current, total }
      currentMessage = `${baseLabel} [${current}/${total}]`
    },

    stop(status: Status, finalMessage?: string): void {
      if (stopped) return
      stopped = true
      clearInterval(interval)

      const resolvedStatus = status === "partial" ? "warn" : status
      const msg = resolveStopMessage(finalMessage)

      // Overwrite the spinner line with the final status, then newline.
      process.stdout.write(`\r${levelTag(resolvedStatus)} ${msg}\x1b[K\n`)
    },
  }

  return spinner
}
