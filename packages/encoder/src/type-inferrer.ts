import type { SupportedLanguage } from '@pleaseai/rpg-utils/ast'
import type Parser from 'tree-sitter'
import type { CallSite, EntityNode, InheritanceRelation } from './dependency-graph'
import { LANGUAGE_CONFIGS } from '@pleaseai/rpg-utils/ast'
import { COMMON_METHOD_BLOCKLIST } from './type-inference-patterns'

/**
 * TypeInferrer resolves receiver types in CallSite objects to produce
 * qualified call names (e.g. "ClassName.methodName").
 *
 * It builds in-memory indices from EntityNode[] and InheritanceRelation[],
 * supports depth-first MRO traversal with cycle detection, and falls back
 * to fuzzy global matching for unresolved receivers (rejecting common names).
 *
 * Languages with manual AST traversal: python, typescript, javascript, java.
 * Rust and Go have INFERENCE_PATTERNS entries but no traversal branches yet.
 */

/**
 * Languages with manual AST traversal implementations in findLocalVarType / findAttributeType.
 */
const INFERENCE_SUPPORTED_LANGUAGES = new Set(['python', 'typescript', 'javascript', 'java'])

export class TypeInferrer {
  private readonly classIndex: Map<string, EntityNode>
  private readonly parentIndex: Map<string, string[]>
  private readonly methodIndex: Map<string, string[]>
  private parser: Parser | undefined

  constructor(entities: EntityNode[], inheritances: InheritanceRelation[]) {
    this.classIndex = new Map()
    this.parentIndex = new Map()
    this.methodIndex = new Map()
    this.buildIndices(entities, inheritances)
  }

  private buildIndices(entities: EntityNode[], inheritances: InheritanceRelation[]): void {
    for (const entity of entities) {
      this.classIndex.set(entity.className, entity)
      for (const method of entity.methods) {
        const classes = this.methodIndex.get(method) ?? []
        classes.push(entity.className)
        this.methodIndex.set(method, classes)
      }
    }

    for (const rel of inheritances) {
      const parents = this.parentIndex.get(rel.childClass) ?? []
      parents.push(rel.parentClass)
      this.parentIndex.set(rel.childClass, parents)
    }
  }

  /**
   * Depth-first MRO chain starting from className (includes itself).
   * Handles cycles via visited set.
   */
  getMROChain(className: string): string[] {
    const chain: string[] = []
    const visited = new Set<string>()
    this.dfs(className, chain, visited)
    return chain
  }

  private dfs(className: string, chain: string[], visited: Set<string>): void {
    if (visited.has(className))
      return
    visited.add(className)
    chain.push(className)
    for (const parent of this.parentIndex.get(className) ?? []) {
      this.dfs(parent, chain, visited)
    }
  }

  /**
   * Walk the MRO chain from startClass (at startIdx) looking for methodName.
   * Returns "ClassName.methodName" on the first match, or null.
   */
  private findMethodInMRO(startClass: string, methodName: string, startIdx = 0): string | null {
    const mro = this.getMROChain(startClass)
    for (let i = startIdx; i < mro.length; i++) {
      const cls = mro[i]
      if (!cls)
        continue
      const entity = this.classIndex.get(cls)
      if (entity?.methods.includes(methodName)) {
        return `${cls}.${methodName}`
      }
    }
    return null
  }

  /**
   * Parse source code for the given language, returning null on failure.
   */
  private parseSource(source: string, language: string): Parser.Tree | null {
    const parser = this.getParser(language)
    if (!parser)
      return null
    try {
      return parser.parse(source)
    }
    catch {
      return null
    }
  }

  /**
   * Infer the type of a local variable from constructor assignments in source code.
   * e.g. `x = Foo()` → 'Foo', `const x = new Bar()` → 'Bar'
   *
   * Supported languages: python, typescript, javascript, java.
   */
  inferLocalVarType(source: string, language: string, varName: string): string | null {
    if (!INFERENCE_SUPPORTED_LANGUAGES.has(language))
      return null
    const tree = this.parseSource(source, language)
    if (!tree)
      return null
    return this.findLocalVarType(tree.rootNode, language, varName)
  }

  private matchPythonLocalVarType(node: Parser.SyntaxNode, varName: string): string | null {
    if (node.type !== 'assignment')
      return null
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (left?.text === varName && right?.type === 'call') {
      const fn = right.childForFieldName('function')
      if (fn?.type === 'identifier')
        return fn.text
    }
    return null
  }

  private matchTSJSLocalVarType(node: Parser.SyntaxNode, varName: string): string | null {
    if (node.type !== 'variable_declarator')
      return null
    const nameNode = node.childForFieldName('name')
    const valueNode = node.childForFieldName('value')
    if (nameNode?.text === varName && valueNode?.type === 'new_expression') {
      const ctor = valueNode.childForFieldName('constructor')
      if (ctor)
        return ctor.text
    }
    return null
  }

  private matchJavaLocalVarType(node: Parser.SyntaxNode, varName: string): string | null {
    if (node.type !== 'local_variable_declaration')
      return null
    for (const child of node.children) {
      if (child.type === 'variable_declarator') {
        const nameNode = child.childForFieldName('name')
        const valueNode = child.childForFieldName('value')
        if (nameNode?.text === varName && valueNode?.type === 'object_creation_expression') {
          const type = valueNode.childForFieldName('type')
          if (type)
            return type.text
        }
      }
    }
    return null
  }

  private findLocalVarType(node: Parser.SyntaxNode, language: string, varName: string): string | null {
    let matched: string | null = null
    if (language === 'python')
      matched = this.matchPythonLocalVarType(node, varName)
    else if (language === 'typescript' || language === 'javascript')
      matched = this.matchTSJSLocalVarType(node, varName)
    else if (language === 'java')
      matched = this.matchJavaLocalVarType(node, varName)

    if (matched)
      return matched

    for (const child of node.children) {
      const result = this.findLocalVarType(child, language, varName)
      if (result)
        return result
    }
    return null
  }

  /**
   * Infer the type of an instance attribute from constructor assignments.
   * e.g. `self.field = Bar()` → 'Bar', `this.field = new Bar()` → 'Bar'
   *
   * Supported languages: python, typescript, javascript.
   */
  inferAttributeType(source: string, language: string, attrName: string): string | null {
    if (!INFERENCE_SUPPORTED_LANGUAGES.has(language))
      return null
    const tree = this.parseSource(source, language)
    if (!tree)
      return null
    return this.findAttributeType(tree.rootNode, language, attrName)
  }

  private matchPythonAttributeType(node: Parser.SyntaxNode, attrName: string): string | null {
    if (node.type !== 'assignment')
      return null
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (left?.type === 'attribute' && right?.type === 'call') {
      const obj = left.childForFieldName('object')
      const attr = left.childForFieldName('attribute')
      if (obj?.text === 'self' && attr?.text === attrName) {
        const fn = right.childForFieldName('function')
        if (fn?.type === 'identifier')
          return fn.text
      }
    }
    return null
  }

  private matchTSJSAttributeType(node: Parser.SyntaxNode, attrName: string): string | null {
    if (node.type !== 'assignment_expression')
      return null
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (left?.type === 'member_expression' && right?.type === 'new_expression') {
      const obj = left.childForFieldName('object')
      const prop = left.childForFieldName('property')
      if (obj?.type === 'this' && prop?.text === attrName) {
        const ctor = right.childForFieldName('constructor')
        if (ctor)
          return ctor.text
      }
    }
    return null
  }

  private findAttributeType(node: Parser.SyntaxNode, language: string, attrName: string): string | null {
    let matched: string | null = null
    if (language === 'python')
      matched = this.matchPythonAttributeType(node, attrName)
    else if (language === 'typescript' || language === 'javascript')
      matched = this.matchTSJSAttributeType(node, attrName)

    if (matched)
      return matched

    for (const child of node.children) {
      const result = this.findAttributeType(child, language, attrName)
      if (result)
        return result
    }
    return null
  }

  /**
   * Resolve a CallSite with receiver info to a qualified name ("ClassName.methodName").
   * Returns null if resolution fails.
   *
   * Resolution order:
   * 1. self/this → look up callerEntity class, walk MRO
   * 2. super → skip current class, walk MRO from index 1
   * 3. variable → infer type via constructor assignment, then walk MRO
   * 4. Fuzzy global fallback (rejects common names + ambiguous matches)
   */
  resolveQualifiedCall(callSite: CallSite, source: string, language: string): string | null {
    const { receiverKind, calleeSymbol, callerEntity } = callSite

    if (!receiverKind || receiverKind === 'none')
      return null

    if (receiverKind === 'self' || receiverKind === 'super') {
      // callerEntity format is "ClassName.methodName" (set by CallExtractor.updateContext)
      const className = callerEntity?.split('.')[0]
      if (!className)
        return null
      return this.findMethodInMRO(className, calleeSymbol, receiverKind === 'super' ? 1 : 0)
    }

    if (receiverKind === 'variable') {
      return this.resolveVariableCall(callSite, source, language)
    }

    return null
  }

  private resolveVariableCall(callSite: CallSite, source: string, language: string): string | null {
    const { receiver, calleeSymbol } = callSite

    if (!receiver || !INFERENCE_SUPPORTED_LANGUAGES.has(language)) {
      return this.fuzzyFallback(calleeSymbol)
    }

    // Parse the source once and reuse the tree for both inference attempts
    const tree = this.parseSource(source, language)
    if (!tree)
      return this.fuzzyFallback(calleeSymbol)

    // Try local variable type inference first: x = Foo(); x.method()
    const localTypeName = this.findLocalVarType(tree.rootNode, language, receiver)
    if (localTypeName) {
      const result = this.findMethodInMRO(localTypeName, calleeSymbol)
      if (result)
        return result
    }

    // Try attribute type inference: self.helper = Bar(); self.helper.method()
    const attrTypeName = this.findAttributeType(tree.rootNode, language, receiver)
    if (attrTypeName) {
      const result = this.findMethodInMRO(attrTypeName, calleeSymbol)
      if (result)
        return result
    }

    return this.fuzzyFallback(calleeSymbol)
  }

  private fuzzyFallback(methodName: string): string | null {
    if (COMMON_METHOD_BLOCKLIST.has(methodName))
      return null
    const classes = this.methodIndex.get(methodName)
    if (classes?.length !== 1)
      return null
    return `${classes[0]}.${methodName}`
  }

  private getParser(language: string): Parser | null {
    if (!this.isSupportedLanguage(language))
      return null
    if (!this.parser) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const TreeSitter = require('tree-sitter')
      this.parser = new TreeSitter() as Parser
    }
    const config = LANGUAGE_CONFIGS[language]
    try {
      this.parser.setLanguage(config.parser as Parameters<typeof this.parser.setLanguage>[0])
      return this.parser
    }
    catch {
      return null
    }
  }

  private isSupportedLanguage(language: string): language is SupportedLanguage {
    return language in LANGUAGE_CONFIGS
  }
}
