import { EdgeType, type Node, type RepositoryPlanningGraph } from '../graph'

/**
 * Edge type for exploration
 */
export type ExploreEdgeType = 'functional' | 'dependency' | 'both'

/**
 * Options for ExploreRPG
 */
export interface ExploreOptions {
  /** Starting node ID */
  startNode: string
  /** Type of edges to traverse */
  edgeType: ExploreEdgeType
  /** Maximum depth to explore */
  maxDepth?: number
  /** Direction: outgoing, incoming, or both */
  direction?: 'out' | 'in' | 'both'
}

/**
 * Explore result
 */
export interface ExploreResult {
  /** Nodes discovered */
  nodes: Node[]
  /** Edges traversed */
  edges: Array<{ source: string; target: string; type: string }>
  /** Depth reached */
  maxDepthReached: number
}

/**
 * ExploreRPG - Cross-view traversal
 *
 * Navigate along functional and dependency edges to discover
 * related modules and interactions.
 */
export class ExploreRPG {
  private rpg: RepositoryPlanningGraph

  constructor(rpg: RepositoryPlanningGraph) {
    this.rpg = rpg
  }

  /**
   * Traverse the graph from a starting node
   */
  async traverse(options: ExploreOptions): Promise<ExploreResult> {
    const { startNode, edgeType, maxDepth = 3, direction = 'out' } = options

    const visited = new Set<string>()
    const nodes: Node[] = []
    const edges: Array<{ source: string; target: string; type: string }> = []
    let maxDepthReached = 0

    const getEdgeTypes = (): EdgeType[] => {
      if (edgeType === 'both') return [EdgeType.Functional, EdgeType.Dependency]
      return [edgeType === 'functional' ? EdgeType.Functional : EdgeType.Dependency]
    }

    const explore = (nodeId: string, depth: number) => {
      if (depth > maxDepth || visited.has(nodeId)) return
      visited.add(nodeId)

      const node = this.rpg.getNode(nodeId)
      if (!node) return

      nodes.push(node)
      maxDepthReached = Math.max(maxDepthReached, depth)

      for (const et of getEdgeTypes()) {
        if (direction === 'out' || direction === 'both') {
          for (const edge of this.rpg.getOutEdges(nodeId, et)) {
            edges.push({ source: edge.source, target: edge.target, type: edge.type })
            explore(edge.target, depth + 1)
          }
        }

        if (direction === 'in' || direction === 'both') {
          for (const edge of this.rpg.getInEdges(nodeId, et)) {
            edges.push({ source: edge.source, target: edge.target, type: edge.type })
            explore(edge.source, depth + 1)
          }
        }
      }
    }

    explore(startNode, 0)

    return { nodes, edges, maxDepthReached }
  }
}
