import type { LanguageConfig, SupportedLanguage } from '../types'
import { pythonConfig } from './python'
import { javascriptConfig, typescriptConfig } from './typescript'

/**
 * Language configurations for all supported languages
 * Maps language names to their AST parsing configurations
 */
export const LANGUAGE_CONFIGS: Partial<Record<SupportedLanguage, LanguageConfig>> = {
  typescript: typescriptConfig,
  javascript: javascriptConfig,
  python: pythonConfig,
} as const

export { pythonConfig } from './python'
/**
 * Re-export individual language configs
 */
export { javascriptConfig, typescriptConfig } from './typescript'
