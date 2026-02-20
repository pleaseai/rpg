import type { SupportedLanguage } from '@pleaseai/rpg-utils/ast'
import type Parser from 'tree-sitter'
import type { CallSite, ReceiverKind } from './dependency-graph'
import { LANGUAGE_CONFIGS } from '@pleaseai/rpg-utils/ast'

interface CallInfo {
  symbol: string | null
  receiver?: string
  receiverKind?: ReceiverKind
}

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
    let callInfo: CallInfo = { symbol: null }

    if (language === 'typescript' || language === 'javascript') {
      callInfo = this.extractTSCall(node)
    }
    else if (language === 'python') {
      callInfo = this.extractPythonCall(node)
    }
    else if (language === 'java') {
      callInfo = this.extractJavaCall(node)
    }
    else if (language === 'rust') {
      callInfo = this.extractRustCall(node)
    }
    else if (language === 'go') {
      callInfo = this.extractGoCall(node)
    }

    if (callInfo.symbol) {
      calls.push({
        calleeSymbol: callInfo.symbol,
        callerFile: filePath,
        callerEntity: currentContext,
        line: node.startPosition.row + 1,
        receiver: callInfo.receiver,
        receiverKind: callInfo.receiverKind,
      })
    }
  }

  /**
   * Classify a receiver node into self/super/variable
   */
  private classifyReceiver(obj: Parser.SyntaxNode): { receiver: string, receiverKind: 'self' | 'super' | 'variable' } {
    const type = obj.type
    const text = obj.text

    if (type === 'super' || text === 'super') {
      return { receiver: 'super', receiverKind: 'super' }
    }
    // Python: super() call as receiver
    if (type === 'call' && obj.childForFieldName('function')?.text === 'super') {
      return { receiver: 'super', receiverKind: 'super' }
    }
    if (type === 'this' || text === 'this' || text === 'self') {
      return { receiver: text, receiverKind: 'self' }
    }
    return { receiver: text, receiverKind: 'variable' }
  }

  // ===================== TypeScript / JavaScript =====================

  private extractTSMemberCall(fn: Parser.SyntaxNode): CallInfo {
    const objNode = fn.childForFieldName('object')
    const propNode = fn.childForFieldName('property')
    if (!propNode)
      return { symbol: null }
    const symbol = propNode.text
    if (!objNode)
      return { symbol, receiverKind: 'none' }
    return { symbol, ...this.classifyReceiver(objNode) }
  }

  private extractTSCall(node: Parser.SyntaxNode): CallInfo {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function')
      if (!fn)
        return { symbol: null }

      if (fn.type === 'member_expression')
        return this.extractTSMemberCall(fn)

      const symbol = this.resolveSymbol(fn)
      return symbol ? { symbol, receiverKind: 'none' } : { symbol: null }
    }
    if (node.type === 'new_expression') {
      const ctor = node.childForFieldName('constructor')
      if (!ctor)
        return { symbol: null }
      const symbol = this.resolveSymbol(ctor)
      return symbol ? { symbol, receiverKind: 'none' } : { symbol: null }
    }
    return { symbol: null }
  }

  // ===================== Python =====================

  private extractPythonCall(node: Parser.SyntaxNode): CallInfo {
    if (node.type !== 'call')
      return { symbol: null }
    const fn = node.childForFieldName('function')
    if (!fn)
      return { symbol: null }

    // attribute: obj.method → extract method name + receiver
    if (fn.type === 'attribute') {
      const objNode = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      const symbol = attr?.text ?? null
      if (!symbol)
        return { symbol: null }
      if (!objNode)
        return { symbol, receiverKind: 'none' }
      return { symbol, ...this.classifyReceiver(objNode) }
    }

    // identifier: direct call
    if (fn.type === 'identifier') {
      return { symbol: fn.text, receiverKind: 'none' }
    }

    return { symbol: null }
  }

  // ===================== Java =====================

  private extractJavaCall(node: Parser.SyntaxNode): CallInfo {
    if (node.type === 'method_invocation') {
      const name = node.childForFieldName('name')
      const symbol = name?.text ?? null
      if (!symbol)
        return { symbol: null }
      const objNode = node.childForFieldName('object')
      if (!objNode)
        return { symbol, receiverKind: 'none' }
      return { symbol, ...this.classifyReceiver(objNode) }
    }
    if (node.type === 'object_creation_expression') {
      const type = node.childForFieldName('type')
      const symbol = type?.text ?? null
      return symbol ? { symbol, receiverKind: 'none' } : { symbol: null }
    }
    return { symbol: null }
  }

  // ===================== Rust =====================

  private extractRustCall(node: Parser.SyntaxNode): CallInfo {
    if (node.type !== 'call_expression')
      return { symbol: null }
    const fn = node.childForFieldName('function')
    if (!fn)
      return { symbol: null }

    if (fn.type === 'identifier') {
      return { symbol: fn.text, receiverKind: 'none' }
    }
    // field_expression: obj.method
    if (fn.type === 'field_expression') {
      const valueNode = fn.childForFieldName('value')
      const field = fn.childForFieldName('field')
      const symbol = field?.text ?? null
      if (!symbol)
        return { symbol: null }
      if (!valueNode)
        return { symbol, receiverKind: 'none' }
      return { symbol, ...this.classifyReceiver(valueNode) }
    }
    // scoped_identifier: Foo::new
    if (fn.type === 'scoped_identifier') {
      const name = fn.childForFieldName('name')
      const symbol = name?.text ?? null
      return symbol ? { symbol, receiverKind: 'none' } : { symbol: null }
    }

    return { symbol: null }
  }

  // ===================== Go =====================

  private extractGoCall(node: Parser.SyntaxNode): CallInfo {
    if (node.type !== 'call_expression')
      return { symbol: null }
    const fn = node.childForFieldName('function')
    if (!fn)
      return { symbol: null }

    if (fn.type === 'identifier') {
      return { symbol: fn.text, receiverKind: 'none' }
    }
    // selector_expression: obj.Method
    if (fn.type === 'selector_expression') {
      const operandNode = fn.childForFieldName('operand')
      const field = fn.childForFieldName('field')
      const symbol = field?.text ?? null
      if (!symbol)
        return { symbol: null }
      if (!operandNode)
        return { symbol, receiverKind: 'none' }
      return { symbol, ...this.classifyReceiver(operandNode) }
    }

    return { symbol: null }
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
