import fs from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { type RPGConfig, RepositoryPlanningGraph } from '../graph'
import { ASTParser, type CodeEntity } from '../utils/ast'
import { type CacheOptions, SemanticCache } from './cache'
import { type EntityInput, SemanticExtractor, type SemanticOptions } from './semantic'

/**
 * Options for encoding a repository
 */
export interface EncoderOptions {
  /** Repository path */
  repoPath: string
  /** Include source code in nodes */
  includeSource?: boolean
  /** File patterns to include */
  include?: string[]
  /** File patterns to exclude */
  exclude?: string[]
  /** Maximum depth for directory traversal */
  maxDepth?: number
  /** Semantic extraction options */
  semantic?: SemanticOptions
  /** Cache options */
  cache?: CacheOptions
}

/**
 * Result of encoding a repository
 */
export interface EncodingResult {
  /** The generated RPG */
  rpg: RepositoryPlanningGraph
  /** Number of files processed */
  filesProcessed: number
  /** Number of functions/classes extracted */
  entitiesExtracted: number
  /** Time taken in milliseconds */
  duration: number
}

/**
 * RPG Encoder - Extracts RPG from existing codebases
 *
 * Implements three phases:
 * 1. Semantic Lifting: Extract semantic features from code
 * 2. Structural Reorganization: Build functional hierarchy
 * 3. Artifact Grounding: Connect to physical code entities
 */
/**
 * Entity extracted from a file
 */
interface ExtractedEntity {
  id: string
  feature: { description: string; keywords?: string[] }
  metadata: {
    entityType: 'file' | 'class' | 'function' | 'method'
    path: string
    startLine?: number
    endLine?: number
  }
  sourceCode?: string
}

export class RPGEncoder {
  private repoPath: string
  private options: EncoderOptions
  private astParser: ASTParser
  private semanticExtractor: SemanticExtractor
  private cache: SemanticCache

  constructor(repoPath: string, options?: Partial<Omit<EncoderOptions, 'repoPath'>>) {
    this.repoPath = repoPath
    this.astParser = new ASTParser()
    this.options = {
      repoPath,
      includeSource: false,
      include: ['**/*.ts', '**/*.js', '**/*.py'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      maxDepth: 10,
      ...options,
    }

    // Initialize semantic extractor and cache
    this.semanticExtractor = new SemanticExtractor(this.options.semantic)
    this.cache = new SemanticCache({
      cacheDir: path.join(this.repoPath, '.please', 'cache'),
      ...this.options.cache,
    })
  }

  /**
   * Encode the repository into an RPG
   */
  async encode(): Promise<EncodingResult> {
    const startTime = Date.now()

    // Extract repository name from path
    const repoName = this.repoPath.split('/').pop() ?? 'unknown'

    const config: RPGConfig = {
      name: repoName,
      rootPath: this.repoPath,
    }

    const rpg = new RepositoryPlanningGraph(config)

    // Phase 1: Semantic Lifting
    const files = await this.discoverFiles()
    let entitiesExtracted = 0

    for (const file of files) {
      const entities = await this.extractEntities(file)
      entitiesExtracted += entities.length

      for (const entity of entities) {
        rpg.addLowLevelNode({
          id: entity.id,
          feature: entity.feature,
          metadata: entity.metadata,
          sourceCode: this.options.includeSource ? entity.sourceCode : undefined,
        })
      }
    }

    // Save cache after processing all files
    await this.cache.save()

    // Phase 2: Structural Reorganization
    await this.buildFunctionalHierarchy(rpg)

    // Phase 3: Artifact Grounding
    await this.injectDependencies(rpg)

    return {
      rpg,
      filesProcessed: files.length,
      entitiesExtracted,
      duration: Date.now() - startTime,
    }
  }

  /**
   * Discover files to process
   */
  private async discoverFiles(): Promise<string[]> {
    // Check if repository exists
    if (!fs.existsSync(this.repoPath)) {
      return []
    }

    const files: string[] = []
    const includePatterns = this.options.include ?? ['**/*.ts', '**/*.js', '**/*.py']
    const excludePatterns = this.options.exclude ?? [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
    ]

    // Recursively walk directory
    await this.walkDirectory(this.repoPath, files, includePatterns, excludePatterns, 0)

    return files.sort()
  }

  /**
   * Recursively walk directory and collect matching files
   */
  private async walkDirectory(
    dir: string,
    files: string[],
    includePatterns: string[],
    excludePatterns: string[],
    depth: number
  ): Promise<void> {
    const maxDepth = this.options.maxDepth ?? 10
    if (depth > maxDepth) return

    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      const relativePath = path.relative(this.repoPath, fullPath)

      // Check if excluded
      if (this.matchesPattern(relativePath, excludePatterns)) {
        continue
      }

      let stats: fs.Stats
      try {
        stats = await stat(fullPath)
      } catch {
        continue
      }

      if (stats.isDirectory()) {
        await this.walkDirectory(fullPath, files, includePatterns, excludePatterns, depth + 1)
      } else if (stats.isFile()) {
        if (this.matchesPattern(relativePath, includePatterns)) {
          files.push(fullPath)
        }
      }
    }
  }

  /**
   * Check if path matches any of the glob patterns
   */
  private matchesPattern(filePath: string, patterns: string[]): boolean {
    return patterns.some((pattern) => this.globMatch(filePath, pattern))
  }

  /**
   * Simple glob matching (supports * and **)
   */
  private globMatch(filePath: string, pattern: string): boolean {
    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, '/')
    const normalizedPattern = pattern.replace(/\\/g, '/')

    // Split into segments for better matching
    const pathSegments = normalizedPath.split('/')
    const patternSegments = normalizedPattern.split('/')

    return this.matchSegments(pathSegments, patternSegments, 0, 0)
  }

  /**
   * Match path segments against pattern segments
   */
  private matchSegments(
    pathSegs: string[],
    patternSegs: string[],
    pathIdx: number,
    patternIdx: number
  ): boolean {
    // Both exhausted - match
    if (pathIdx === pathSegs.length && patternIdx === patternSegs.length) {
      return true
    }

    // Pattern exhausted but path remaining - no match
    if (patternIdx === patternSegs.length) {
      return false
    }

    const patternSeg = patternSegs[patternIdx]

    // Handle ** (globstar)
    if (patternSeg === '**') {
      // Try matching zero or more directories
      for (let i = pathIdx; i <= pathSegs.length; i++) {
        if (this.matchSegments(pathSegs, patternSegs, i, patternIdx + 1)) {
          return true
        }
      }
      return false
    }

    // Path exhausted but pattern remaining (and not **)
    if (pathIdx === pathSegs.length) {
      return false
    }

    // Match single segment
    if (this.matchSegment(pathSegs[pathIdx], patternSeg)) {
      return this.matchSegments(pathSegs, patternSegs, pathIdx + 1, patternIdx + 1)
    }

    return false
  }

  /**
   * Match single path segment against pattern segment
   */
  private matchSegment(pathSeg: string, patternSeg: string): boolean {
    // Convert pattern to regex
    const regexPattern = patternSeg
      .replace(/\./g, '\\.') // Escape dots
      .replace(/\*/g, '.*') // * matches anything
      .replace(/\?/g, '.') // ? matches single char

    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(pathSeg)
  }

  /**
   * Extract entities (functions, classes) from a file
   */
  private async extractEntities(file: string): Promise<ExtractedEntity[]> {
    const relativePath = path.relative(this.repoPath, file)
    const entities: ExtractedEntity[] = []

    // Read source code for semantic extraction
    let sourceCode: string | undefined
    try {
      sourceCode = await readFile(file, 'utf-8')
    } catch {
      // Ignore read errors
    }

    // Parse the file
    const parseResult = await this.astParser.parseFile(file)

    // Add file-level entity with semantic extraction
    const fileId = this.generateEntityId(relativePath, 'file')
    const fileFeature = await this.extractSemanticFeature({
      type: 'file',
      name: path.basename(relativePath, path.extname(relativePath)),
      filePath: relativePath,
    })
    entities.push({
      id: fileId,
      feature: fileFeature,
      metadata: {
        entityType: 'file',
        path: relativePath,
      },
    })

    // Add code entities (functions, classes, methods)
    for (const entity of parseResult.entities) {
      const entityId = this.generateEntityId(
        relativePath,
        entity.type,
        entity.name,
        entity.startLine
      )
      const extractedEntity = await this.convertCodeEntity(
        entity,
        relativePath,
        entityId,
        sourceCode
      )
      if (extractedEntity) {
        entities.push(extractedEntity)
      }
    }

    return entities
  }

  /**
   * Generate unique entity ID
   */
  private generateEntityId(
    filePath: string,
    entityType: string,
    entityName?: string,
    startLine?: number
  ): string {
    const parts = [filePath, entityType]
    if (entityName) {
      parts.push(entityName)
    }
    if (startLine !== undefined) {
      parts.push(String(startLine))
    }
    return parts.join(':')
  }

  /**
   * Convert CodeEntity to ExtractedEntity
   */
  private async convertCodeEntity(
    entity: CodeEntity,
    filePath: string,
    entityId: string,
    fileSourceCode?: string
  ): Promise<ExtractedEntity | null> {
    const entityType = this.mapEntityType(entity.type)
    if (!entityType) return null

    // Extract entity source code from file
    let entitySourceCode: string | undefined
    if (fileSourceCode && entity.startLine !== undefined && entity.endLine !== undefined) {
      const lines = fileSourceCode.split('\n')
      entitySourceCode = lines.slice(entity.startLine - 1, entity.endLine).join('\n')
    }

    // Use semantic extractor with caching
    const feature = await this.extractSemanticFeature({
      type: entity.type,
      name: entity.name,
      filePath,
      parent: entity.parent,
      sourceCode: entitySourceCode,
    })

    return {
      id: entityId,
      feature,
      metadata: {
        entityType,
        path: filePath,
        startLine: entity.startLine,
        endLine: entity.endLine,
      },
      sourceCode: entitySourceCode,
    }
  }

  /**
   * Extract semantic feature with caching
   */
  private async extractSemanticFeature(
    input: EntityInput
  ): Promise<{ description: string; keywords?: string[] }> {
    // Check cache first
    const cached = await this.cache.get(input)
    if (cached) {
      return {
        description: cached.description,
        keywords: cached.keywords,
      }
    }

    // Extract using semantic extractor
    const feature = await this.semanticExtractor.extract(input)

    // Cache the result
    await this.cache.set(input, feature)

    return {
      description: feature.description,
      keywords: feature.keywords,
    }
  }

  /**
   * Map AST entity type to RPG entity type
   */
  private mapEntityType(
    type: CodeEntity['type']
  ): ExtractedEntity['metadata']['entityType'] | null {
    const typeMap: Record<string, ExtractedEntity['metadata']['entityType']> = {
      function: 'function',
      class: 'class',
      method: 'method',
    }
    return typeMap[type] ?? null
  }

  /**
   * Build functional hierarchy from extracted entities
   */
  private async buildFunctionalHierarchy(_rpg: RepositoryPlanningGraph): Promise<void> {
    // TODO: Implement LLM-based functional grouping
  }

  /**
   * Inject dependency edges via AST analysis
   */
  private async injectDependencies(_rpg: RepositoryPlanningGraph): Promise<void> {
    // TODO: Implement AST-based dependency extraction
  }

  /**
   * Incrementally update RPG with new commits
   */
  async evolve(options: { commitRange: string }): Promise<void> {
    // TODO: Implement incremental updates
    console.log(`Evolving with commits: ${options.commitRange}`)
  }
}
