/**
 * Parsed code entity from AST
 */
export interface CodeEntity {
  /** Entity type */
  type: 'function' | 'class' | 'method' | 'variable' | 'import'
  /** Entity name */
  name: string
  /** Start line (1-indexed) */
  startLine: number
  /** End line (1-indexed) */
  endLine: number
  /** Start column */
  startColumn: number
  /** End column */
  endColumn: number
  /** Docstring or comment */
  documentation?: string
  /** Parameters for functions/methods */
  parameters?: string[]
  /** Return type annotation */
  returnType?: string
  /** Parent entity (for methods) */
  parent?: string
}

/**
 * Result of parsing a file
 */
export interface ParseResult {
  /** Detected language */
  language: string
  /** Extracted entities */
  entities: CodeEntity[]
  /** Import statements */
  imports: Array<{ module: string; names: string[] }>
  /** Parsing errors */
  errors: string[]
}

/**
 * AST Parser using tree-sitter
 *
 * Extracts code structure for dependency analysis and semantic lifting.
 */
export class ASTParser {
  private parsers: Map<string, unknown> = new Map()

  constructor() {
    // TODO: Initialize tree-sitter parsers
  }

  /**
   * Parse a source file
   */
  async parse(source: string, language: string): Promise<ParseResult> {
    // TODO: Implement tree-sitter parsing
    return {
      language,
      entities: [],
      imports: [],
      errors: [],
    }
  }

  /**
   * Parse a file from path
   */
  async parseFile(filePath: string): Promise<ParseResult> {
    const file = Bun.file(filePath)
    const source = await file.text()
    const language = this.detectLanguage(filePath)
    return this.parse(source, language)
  }

  /**
   * Detect language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase()
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      kt: 'kotlin',
      dart: 'dart',
    }
    return langMap[ext ?? ''] ?? 'unknown'
  }
}
