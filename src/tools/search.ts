import type { Node, RepositoryPlanningGraph } from '../graph'

/**
 * Search mode
 */
export type SearchMode = 'features' | 'snippets' | 'auto'

/**
 * Options for SearchNode
 */
export interface SearchOptions {
  /** Search mode: features (semantic), snippets (code), or auto (both) */
  mode: SearchMode
  /** Behavioral/functionality phrases for feature search */
  featureTerms?: string[]
  /** File paths, entities, or keywords for snippet search */
  searchTerms?: string[]
  /** Feature paths to restrict search scope */
  searchScopes?: string[]
  /** File path or glob pattern to restrict snippet search */
  filePattern?: string
  /** Line range [start, end] for specific file extraction */
  lineRange?: [number, number]
}

/**
 * Search result
 */
export interface SearchResult {
  /** Matched nodes */
  nodes: Node[]
  /** Total matches found */
  totalMatches: number
  /** Search mode used */
  mode: SearchMode
}

/**
 * SearchNode - Global node-level retrieval
 *
 * Maps high-level functional descriptions to concrete code entities
 * via RPG mapping, and/or retrieves code snippets via symbol/file search.
 */
export class SearchNode {
  private rpg: RepositoryPlanningGraph

  constructor(rpg: RepositoryPlanningGraph) {
    this.rpg = rpg
  }

  /**
   * Execute a search query
   */
  async query(options: SearchOptions): Promise<SearchResult> {
    const results: Node[] = []

    if (options.mode === 'features' || options.mode === 'auto') {
      // Feature-based search
      if (options.featureTerms) {
        for (const term of options.featureTerms) {
          const matches = this.rpg.searchByFeature(term)
          results.push(...matches)
        }
      }
    }

    if (options.mode === 'snippets' || options.mode === 'auto') {
      // Path/pattern-based search
      if (options.filePattern) {
        const matches = this.rpg.searchByPath(options.filePattern)
        results.push(...matches)
      }
    }

    // Deduplicate by node ID
    const uniqueNodes = Array.from(new Map(results.map((n) => [n.id, n])).values())

    return {
      nodes: uniqueNodes,
      totalMatches: uniqueNodes.length,
      mode: options.mode,
    }
  }
}
