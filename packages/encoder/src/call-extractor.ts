import type { SupportedLanguage } from '@pleaseai/rpg-utils/ast'
import type Parser from 'tree-sitter'
import type { CallSite } from './dependency-graph'
import { LANGUAGE_CONFIGS } from '@pleaseai/rpg-utils/ast'

/**
 * Extracts function/method call sites from source code using tree-sitter AST parsing.
 *
 * Supports TypeScript, JavaScript, Python, Java, Rust, and Go.
 */
export class CallExtractor {
  private readonly parser: Parser

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TreeSitter = require('tree-sitter')
    this.parser = new TreeSitter()
  }

  private isSupportedLanguage(language: string): language is SupportedLanguage {
    return language in LANGUAGE_CONFIGS && LANGUAGE_CONFIGS[language as SupportedLanguage] !== undefined
  }

  extract(source: string, language: string, filePath: string): CallSite[] {
    const calls: CallSite[] = []

    if (!source.trim()) {
      return calls
    }

    if (!this.isSupportedLanguage(language)) {
      return calls
    }

    const config = LANGUAGE_CONFIGS[language]

    try {
      this.parser.setLanguage(
        config.parser as Parameters<typeof this.parser.setLanguage>[0],
      )

      const tree = this.parser.parse(source)

      if (!tree.rootNode) {
        return calls
      }

      this.walkNode(tree.rootNode, filePath, language, calls)
    }
    catch {
      return calls
    }

    return calls
  }

  private walkNode(
    node: Parser.SyntaxNode,
    filePath: string,
    language: string,
    calls: CallSite[],
    currentContext?: string,
  ): void {
    this.extractFromNode(node, filePath, language, calls, currentContext)

    const contextUpdate = this.updateContext(node, language, currentContext)

    for (const child of node.children) {
      this.walkNode(child, filePath, language, calls, contextUpdate)
    }
  }

  /**
   * Extract call site from a node if it matches a call pattern for the language
   */
  private extractFromNode(
    node: Parser.SyntaxNode,
    filePath: string,
    language: string,
    calls: CallSite[],
    currentContext?: string,
  ): void {
    let symbol: string | null = null

    if (language === 'typescript' || language === 'javascript') {
      symbol = this.extractTSCall(node)
    }
    else if (language === 'python') {
      symbol = this.extractPythonCall(node)
    }
    else if (language === 'java') {
      symbol = this.extractJavaCall(node)
    }
    else if (language === 'rust') {
      symbol = this.extractRustCall(node)
    }
    else if (language === 'go') {
      symbol = this.extractGoCall(node)
    }

    if (symbol) {
      calls.push({
        calleeSymbol: symbol,
        callerFile: filePath,
        callerEntity: currentContext,
        line: node.startPosition.row + 1,
      })
    }
  }

  // ===================== TypeScript / JavaScript =====================

  private extractTSCall(node: Parser.SyntaxNode): string | null {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function')
      if (!fn)
        return null
      return this.resolveSymbol(fn)
    }
    if (node.type === 'new_expression') {
      const ctor = node.childForFieldName('constructor')
      if (!ctor)
        return null
      return this.resolveSymbol(ctor)
    }
    return null
  }

  // ===================== Python =====================

  private extractPythonCall(node: Parser.SyntaxNode): string | null {
    if (node.type !== 'call')
      return null
    const fn = node.childForFieldName('function')
    if (!fn)
      return null

    // attribute: obj.method → extract method name
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      return attr?.text ?? null
    }

    // identifier: direct call
    if (fn.type === 'identifier') {
      return fn.text
    }

    return null
  }

  // ===================== Java =====================

  private extractJavaCall(node: Parser.SyntaxNode): string | null {
    if (node.type === 'method_invocation') {
      const name = node.childForFieldName('name')
      return name?.text ?? null
    }
    if (node.type === 'object_creation_expression') {
      const type = node.childForFieldName('type')
      return type?.text ?? null
    }
    return null
  }

  // ===================== Rust =====================

  private extractRustCall(node: Parser.SyntaxNode): string | null {
    if (node.type !== 'call_expression')
      return null
    const fn = node.childForFieldName('function')
    if (!fn)
      return null

    if (fn.type === 'identifier') {
      return fn.text
    }
    // field_expression: obj.method
    if (fn.type === 'field_expression') {
      const field = fn.childForFieldName('field')
      return field?.text ?? null
    }
    // scoped_identifier: Foo::new
    if (fn.type === 'scoped_identifier') {
      const name = fn.childForFieldName('name')
      return name?.text ?? null
    }

    return null
  }

  // ===================== Go =====================

  private extractGoCall(node: Parser.SyntaxNode): string | null {
    if (node.type !== 'call_expression')
      return null
    const fn = node.childForFieldName('function')
    if (!fn)
      return null

    if (fn.type === 'identifier') {
      return fn.text
    }
    // selector_expression: obj.Method
    if (fn.type === 'selector_expression') {
      const field = fn.childForFieldName('field')
      return field?.text ?? null
    }

    return null
  }

  // ===================== Symbol Resolution Helpers =====================

  /**
   * Resolve a symbol name from a TS/JS AST node
   */
  private resolveSymbol(node: Parser.SyntaxNode): string | null {
    if (node.type === 'identifier') {
      return node.text
    }
    if (node.type === 'member_expression') {
      const prop = node.childForFieldName('property')
      if (!prop)
        return null
      let symbol = prop.text
      if (symbol.startsWith('?.')) {
        symbol = symbol.slice(2)
      }
      return symbol
    }
    if (node.type === 'generic_type') {
      const typeNode = node.childForFieldName('type') ?? node.children[0]
      if (typeNode?.type === 'identifier') {
        return typeNode.text
      }
    }
    return null
  }

  // ===================== Context Tracking =====================

  /**
   * Update caller context when entering class/function definitions
   */
  private updateContext(
    node: Parser.SyntaxNode,
    _language: string,
    currentContext?: string,
  ): string | undefined {
    const contextNodeTypes = [
      'class_declaration',
      'class_definition',
      'function_declaration',
      'method_definition',
      'function_definition',
      'method_declaration',
      'function_item',
      'impl_item',
    ]

    if (contextNodeTypes.includes(node.type)) {
      const nameNode = node.childForFieldName('name') ?? node.childForFieldName('type')
      if (!nameNode)
        return currentContext
      return currentContext ? `${currentContext}.${nameNode.text}` : nameNode.text
    }

    // TS/JS arrow functions assigned to variables
    if (node.type === 'arrow_function') {
      const parent = node.parent
      if (parent?.type === 'variable_declarator') {
        const nameNode = parent.childForFieldName('name')
        if (nameNode) {
          return currentContext ? `${currentContext}.${nameNode.text}` : nameNode.text
        }
      }
    }

    return currentContext
  }
}
