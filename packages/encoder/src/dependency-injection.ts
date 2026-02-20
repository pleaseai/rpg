import type { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import type { ASTParser, ParseResult } from '@pleaseai/rpg-utils/ast'
import type { EntityNode, InheritanceRelation } from './dependency-graph'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@pleaseai/rpg-utils/logger'
import { CallExtractor } from './call-extractor'
import { InheritanceExtractor } from './inheritance-extractor'
import { SymbolResolver } from './symbol-resolver'
import { TypeInferrer } from './type-inferrer'

const log = createLogger('DependencyInjection')

/**
 * Resolve an import module path to an actual file path relative to repo root.
 */
export function resolveImportPath(
  sourceFile: string,
  modulePath: string,
  knownFiles?: Set<string>,
): string | null {
  if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) {
    return null
  }

  const sourceDir = path.dirname(sourceFile)
  const resolvedPath = path.normalize(path.join(sourceDir, modulePath))

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '']
  const candidates: string[] = []

  for (const ext of extensions) {
    candidates.push((resolvedPath + ext).replaceAll('\\', '/'))
  }

  for (const ext of extensions) {
    candidates.push(path.join(resolvedPath, `index${ext}`).replaceAll('\\', '/'))
  }

  if (knownFiles) {
    return candidates.find(c => knownFiles.has(c)) ?? null
  }

  // Fallback: return first non-absolute path candidate
  return candidates.find(c => !c.startsWith('/')) ?? resolvedPath.replaceAll('\\', '/')
}

/**
 * Inject dependency edges into an RPG via AST analysis.
 *
 * Creates three types of dependency edges:
 * 1. **Import edges**: file-to-file based on import/require statements
 * 2. **Call edges**: file-to-file based on function/method invocations
 * 3. **Inherit/implement edges**: file-to-file based on class hierarchy
 *
 * Shared between RPGEncoder and interactive encoder.
 */
export async function injectDependencies(
  rpg: RepositoryPlanningGraph,
  repoPath: string,
  astParser: ASTParser,
): Promise<void> {
  const lowLevelNodes = await rpg.getLowLevelNodes()
  const fileNodes = lowLevelNodes.filter(n => n.metadata?.entityType === 'file')

  const filePathToNodeId = new Map<string, string>()
  for (const node of fileNodes) {
    if (node.metadata?.path) {
      filePathToNodeId.set(node.metadata.path, node.id)
    }
  }

  const knownFiles = new Set(filePathToNodeId.keys())
  const createdEdges = new Set<string>()

  // Collect parse results and source code for all files
  const callExtractor = new CallExtractor()
  const inheritanceExtractor = new InheritanceExtractor()
  const symbolResolver = new SymbolResolver()

  const fileData: Array<{
    filePath: string
    nodeId: string
    parseResult: ParseResult
    sourceCode: string
  }> = []

  for (const node of fileNodes) {
    const filePath = node.metadata?.path
    if (!filePath)
      continue

    const fullPath = path.join(repoPath, filePath)
    const parseResult = await astParser.parseFile(fullPath)

    let sourceCode: string
    try {
      sourceCode = await readFile(fullPath, 'utf-8')
    }
    catch (err) {
      log.warn(`Failed to read file ${fullPath}: ${err}`)
      sourceCode = ''
    }

    // Phase 1: Import edges (existing logic)
    await addImportEdges(rpg, node.id, filePath, parseResult.imports, filePathToNodeId, knownFiles, createdEdges)

    fileData.push({ filePath, nodeId: node.id, parseResult, sourceCode })
  }

  // Phase 2: Build symbol table for cross-file resolution
  symbolResolver.buildSymbolTable(
    fileData.map(f => ({
      filePath: f.filePath,
      parseResult: f.parseResult,
      entities: f.parseResult.entities.map(e => ({ name: e.name })),
    })),
  )

  // Phase 3: Extract inheritances (needed by both TypeInferrer and inheritance edge creation)
  const allInheritances: InheritanceRelation[] = []
  for (const file of fileData) {
    const rels = inheritanceExtractor.extract(file.sourceCode, file.parseResult.language, file.filePath)
    allInheritances.push(...rels)
  }

  // Phase 4: Build TypeInferrer for type-aware call resolution
  const typeInferrer = new TypeInferrer(buildEntityNodes(fileData), allInheritances)

  // Phase 5: Extract and resolve call edges (type-aware first, then fallback)
  // Note: createdEdges uses `${source}->${target}` as key to match the DB
  // UNIQUE(source, target, type) constraint (all dependency edges share type='dependency').
  // Import edges are created first and take priority over call/inherit edges.
  await addCallEdges(rpg, fileData, callExtractor, symbolResolver, filePathToNodeId, createdEdges, typeInferrer)

  // Phase 6: Create inheritance/implementation edges from pre-extracted relations
  await addInheritanceEdgesFromRelations(rpg, allInheritances, symbolResolver, filePathToNodeId, knownFiles, createdEdges)
}

/**
 * Collect EntityNode records (class name + methods) from all parsed files.
 */
function buildEntityNodes(
  fileData: Array<{ parseResult: ParseResult }>,
): EntityNode[] {
  const entityNodes: EntityNode[] = []
  for (const file of fileData) {
    const methodsByClass = new Map<string, string[]>()
    for (const entity of file.parseResult.entities) {
      if (entity.type === 'method' && entity.parent) {
        const methods = methodsByClass.get(entity.parent) ?? []
        methods.push(entity.name)
        methodsByClass.set(entity.parent, methods)
      }
    }
    for (const entity of file.parseResult.entities) {
      if (entity.type === 'class') {
        entityNodes.push({ className: entity.name, methods: methodsByClass.get(entity.name) ?? [] })
      }
    }
  }
  return entityNodes
}

/**
 * Resolve the target file and symbol for a single call site.
 * Returns null targetFile when no cross-file target is found.
 */
function resolveCallTarget(
  call: import('./dependency-graph').CallSite,
  filePath: string,
  sourceCode: string,
  language: string,
  typeInferrer: TypeInferrer,
  symbolResolver: SymbolResolver,
  knownFiles: Set<string>,
): { targetFile: string | null, targetSymbol: string } {
  let targetFile: string | null = null
  let targetSymbol = call.calleeSymbol
  // When type-aware resolution succeeds (even for same-file calls), skip SymbolResolver
  // to avoid incorrect cross-file routing based on the bare method name.
  let skipFallback = false

  if (call.receiverKind && call.receiverKind !== 'none') {
    const qualifiedName = typeInferrer.resolveQualifiedCall(call, sourceCode, language)
    if (qualifiedName) {
      skipFallback = true
      const className = qualifiedName.split('.')[0] ?? qualifiedName
      const classCall = { ...call, calleeSymbol: className }
      const classResolved = symbolResolver.resolveCall(classCall, knownFiles)
      if (classResolved && classResolved.targetFile !== filePath) {
        targetFile = classResolved.targetFile
        targetSymbol = qualifiedName
      }
    }
  }

  if (!targetFile && !skipFallback) {
    const resolved = symbolResolver.resolveCall(call, knownFiles)
    if (resolved && resolved.targetFile !== filePath) {
      targetFile = resolved.targetFile
      targetSymbol = resolved.targetSymbol
    }
  }

  return { targetFile, targetSymbol }
}

async function addCallEdges(
  rpg: RepositoryPlanningGraph,
  fileData: Array<{ filePath: string, nodeId: string, parseResult: ParseResult, sourceCode: string }>,
  callExtractor: CallExtractor,
  symbolResolver: SymbolResolver,
  filePathToNodeId: Map<string, string>,
  createdEdges: Set<string>,
  typeInferrer: TypeInferrer,
): Promise<void> {
  const knownFiles = new Set(filePathToNodeId.keys())
  for (const file of fileData) {
    const calls = callExtractor.extract(file.sourceCode, file.parseResult.language, file.filePath)
    for (const call of calls) {
      const { targetFile, targetSymbol } = resolveCallTarget(
        call,
        file.filePath,
        file.sourceCode,
        file.parseResult.language,
        typeInferrer,
        symbolResolver,
        knownFiles,
      )

      if (!targetFile)
        continue

      const targetNodeId = filePathToNodeId.get(targetFile)
      if (!targetNodeId)
        continue

      const edgeKey = `${file.nodeId}->${targetNodeId}`
      if (createdEdges.has(edgeKey))
        continue
      createdEdges.add(edgeKey)

      await rpg.addDependencyEdge({
        source: file.nodeId,
        target: targetNodeId,
        dependencyType: 'call',
        symbol: targetSymbol,
        line: call.line,
      })
    }
  }
}

async function addInheritanceEdgesFromRelations(
  rpg: RepositoryPlanningGraph,
  relations: InheritanceRelation[],
  symbolResolver: SymbolResolver,
  filePathToNodeId: Map<string, string>,
  knownFiles: Set<string>,
  createdEdges: Set<string>,
): Promise<void> {
  for (const relation of relations) {
    const resolved = symbolResolver.resolveInheritance(relation, knownFiles)
    if (!resolved || resolved.parentFile === relation.childFile)
      continue

    const sourceNodeId = filePathToNodeId.get(relation.childFile)
    const targetNodeId = filePathToNodeId.get(resolved.parentFile)
    if (!sourceNodeId || !targetNodeId)
      continue

    const edgeKey = `${sourceNodeId}->${targetNodeId}`
    if (createdEdges.has(edgeKey))
      continue
    createdEdges.add(edgeKey)

    await rpg.addDependencyEdge({
      source: sourceNodeId,
      target: targetNodeId,
      dependencyType: relation.kind,
      symbol: relation.childClass,
      targetSymbol: resolved.parentClass,
    })
  }
}

async function addImportEdges(
  rpg: RepositoryPlanningGraph,
  sourceNodeId: string,
  sourceFilePath: string,
  imports: Array<{ module: string }>,
  filePathToNodeId: Map<string, string>,
  knownFiles: Set<string>,
  createdEdges: Set<string>,
): Promise<void> {
  for (const importInfo of imports) {
    const targetPath = resolveImportPath(sourceFilePath, importInfo.module, knownFiles)
    if (!targetPath)
      continue

    const targetNodeId = filePathToNodeId.get(targetPath)
    if (!targetNodeId || targetNodeId === sourceNodeId)
      continue

    const edgeKey = `${sourceNodeId}->${targetNodeId}`
    if (createdEdges.has(edgeKey))
      continue
    createdEdges.add(edgeKey)

    await rpg.addDependencyEdge({
      source: sourceNodeId,
      target: targetNodeId,
      dependencyType: 'import',
    })
  }
}
