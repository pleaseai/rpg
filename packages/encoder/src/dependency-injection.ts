import type { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import type { ASTParser, ParseResult } from '@pleaseai/rpg-utils/ast'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@pleaseai/rpg-utils/logger'
import { CallExtractor } from './call-extractor'
import { InheritanceExtractor } from './inheritance-extractor'
import { SymbolResolver } from './symbol-resolver'

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

  // Phase 3: Extract and resolve call edges
  // Note: createdEdges uses `${source}->${target}` as key to match the DB
  // UNIQUE(source, target, type) constraint (all dependency edges share type='dependency').
  // Import edges are created first and take priority over call/inherit edges.
  await addCallEdges(rpg, fileData, callExtractor, symbolResolver, filePathToNodeId, knownFiles, createdEdges)

  // Phase 4: Extract and resolve inheritance/implementation edges
  await addInheritanceEdges(rpg, fileData, inheritanceExtractor, symbolResolver, filePathToNodeId, knownFiles, createdEdges)
}

async function addCallEdges(
  rpg: RepositoryPlanningGraph,
  fileData: Array<{ filePath: string, nodeId: string, parseResult: ParseResult, sourceCode: string }>,
  callExtractor: CallExtractor,
  symbolResolver: SymbolResolver,
  filePathToNodeId: Map<string, string>,
  knownFiles: Set<string>,
  createdEdges: Set<string>,
): Promise<void> {
  for (const file of fileData) {
    const calls = callExtractor.extract(file.sourceCode, file.parseResult.language, file.filePath)

    for (const call of calls) {
      const resolved = symbolResolver.resolveCall(call, knownFiles)
      if (!resolved || resolved.targetFile === file.filePath)
        continue

      const targetNodeId = filePathToNodeId.get(resolved.targetFile)
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
        symbol: resolved.targetSymbol,
        line: resolved.line,
      })
    }
  }
}

async function addInheritanceEdges(
  rpg: RepositoryPlanningGraph,
  fileData: Array<{ filePath: string, nodeId: string, parseResult: ParseResult, sourceCode: string }>,
  inheritanceExtractor: InheritanceExtractor,
  symbolResolver: SymbolResolver,
  filePathToNodeId: Map<string, string>,
  knownFiles: Set<string>,
  createdEdges: Set<string>,
): Promise<void> {
  for (const file of fileData) {
    const relations = inheritanceExtractor.extract(file.sourceCode, file.parseResult.language, file.filePath)

    for (const relation of relations) {
      const resolved = symbolResolver.resolveInheritance(relation, knownFiles)
      if (!resolved || resolved.parentFile === file.filePath)
        continue

      const targetNodeId = filePathToNodeId.get(resolved.parentFile)
      if (!targetNodeId)
        continue

      const edgeKey = `${file.nodeId}->${targetNodeId}`
      if (createdEdges.has(edgeKey))
        continue
      createdEdges.add(edgeKey)

      await rpg.addDependencyEdge({
        source: file.nodeId,
        target: targetNodeId,
        dependencyType: relation.kind,
        symbol: relation.childClass,
        targetSymbol: resolved.parentClass,
      })
    }
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
