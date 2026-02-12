import type { ConsolaInstance } from 'consola'
import { createConsola, LogLevels } from 'consola'

// Root instance — children inherit its level
export const logger: ConsolaInstance = createConsola({ level: LogLevels.info })

// Scoped logger with [tag] prefix
export function createLogger(tag: string): ConsolaInstance {
  return logger.withTag(tag)
}

// Stderr-only logger for MCP server (stdout reserved for JSON-RPC)
export function createStderrLogger(tag: string): ConsolaInstance {
  return createConsola({
    level: LogLevels.info,
    stdout: process.stderr,
    stderr: process.stderr,
  }).withTag(tag)
}

// Set global log level (affects all createLogger children)
export function setLogLevel(level: number): void {
  logger.level = level
}

export { LogLevels } from 'consola'
