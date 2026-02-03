import type { Node, RepositoryPlanningGraph } from '../graph'

/**
 * Options for FetchNode
 */
export interface FetchOptions {
  /** Code entity identifiers to fetch */
  codeEntities?: string[]
  /** Feature path identifiers to fetch */
  featureEntities?: string[]
}

/**
 * Fetch result for a single entity
 */
export interface EntityDetail {
  /** Node data */
  node: Node
  /** Source code (if available) */
  sourceCode?: string
  /** Related feature paths */
  featurePaths: string[]
}

/**
 * Fetch result
 */
export interface FetchResult {
  /** Fetched entities */
  entities: EntityDetail[]
  /** Entities not found */
  notFound: string[]
}

/**
 * FetchNode - Retrieve precise metadata and source context
 *
 * Verifies candidate code locations and returns exact file path,
 * entity type, line numbers, and code preview.
 */
export class FetchNode {
  private rpg: RepositoryPlanningGraph

  constructor(rpg: RepositoryPlanningGraph) {
    this.rpg = rpg
  }

  /**
   * Fetch entities by ID
   */
  async get(options: FetchOptions): Promise<FetchResult> {
    const entities: EntityDetail[] = []
    const notFound: string[] = []

    const allIds = [...(options.codeEntities ?? []), ...(options.featureEntities ?? [])]

    for (const id of allIds) {
      const node = this.rpg.getNode(id)
      if (node) {
        entities.push({
          node,
          sourceCode: 'sourceCode' in node ? node.sourceCode : undefined,
          featurePaths: this.getFeaturePaths(node.id),
        })
      } else {
        notFound.push(id)
      }
    }

    return { entities, notFound }
  }

  /**
   * Get feature paths for a node by traversing functional edges
   */
  private getFeaturePaths(nodeId: string): string[] {
    const paths: string[] = []
    let current = this.rpg.getNode(nodeId)

    while (current) {
      paths.unshift(current.feature.description)
      current = this.rpg.getParent(current.id)
    }

    return [paths.join(' / ')]
  }
}
