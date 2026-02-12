import type { ConsolaInstance } from 'consola'
import { createConsola, LogLevels } from 'consola'

// Root instance — createLogger children inherit its level via .withTag()
export const logger: ConsolaInstance = createConsola({ level: LogLevels.info })

// Scoped logger with [tag] prefix
export function createLogger(tag: string): ConsolaInstance {
  return logger.withTag(tag)
}

// Stderr-only logger for MCP server (stdout reserved for JSON-RPC).
// Creates an independent root because MCP servers must never write to stdout.
const stderrRoots: ConsolaInstance[] = []

export function createStderrLogger(tag: string): ConsolaInstance {
  const root = createConsola({
    level: LogLevels.info,
    stdout: process.stderr,
    stderr: process.stderr,
  })
  stderrRoots.push(root)
  return root.withTag(tag)
}

// Set global log level (affects all loggers: createLogger children + createStderrLogger instances)
export function setLogLevel(level: number): void {
  logger.level = level
  for (const root of stderrRoots) {
    root.level = level
  }
}

export { LogLevels } from 'consola'
