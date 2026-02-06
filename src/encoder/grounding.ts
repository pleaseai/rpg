import type { RepositoryPlanningGraph } from '../graph'
import path from 'node:path'
import { isHighLevelNode, isLowLevelNode } from '../graph/node'

/**
 * Trie node for directory path prefix analysis.
 * Used internally by ArtifactGrounder to compute LCA paths.
 */
class TrieNode {
  children = new Map<string, TrieNode>()
  isTerminal = false

  isBranching(): boolean {
    return this.children.size > 1
  }
}

/**
 * Prefix tree for computing Lowest Common Ancestor (LCA) paths
 * from a set of directory paths.
 *
 * Implements COMPUTE_LCA from RPG-Encoder Algorithm 1 (§3.3):
 * - Builds a prefix tree from directory path segments
 * - Post-order traversal identifies branching and terminal nodes
 * - Prunes subtrees to consolidate redundant sub-paths
 */
class PathTrie {
  private root = new TrieNode()

  /**
   * Insert a directory path into the trie.
   * Path is split by '/' into segments.
   */
  insert(dirPath: string): void {
    const segments = dirPath.split('/').filter(s => s.length > 0)
    let current = this.root
    for (const segment of segments) {
      if (!current.children.has(segment)) {
        current.children.set(segment, new TrieNode())
      }
      current = current.children.get(segment)!
    }
    current.isTerminal = true
  }

  /**
   * Compute LCA paths via post-order traversal with pruning.
   *
   * Returns paths at meaningful functional boundaries:
   * - Branching nodes (where paths diverge)
   * - Terminal nodes (deepest unique prefixes)
   */
  computeLCA(): string[] {
    const results: string[] = []
    this.postOrder(this.root, [], results)
    return results
  }

  private postOrder(node: TrieNode, pathSegments: string[], results: string[]): void {
    // Process children first (post-order)
    for (const [segment, child] of node.children) {
      this.postOrder(child, [...pathSegments, segment], results)
    }

    // Skip root node with no segments
    if (pathSegments.length === 0)
      return

    if (node.isBranching() || node.isTerminal) {
      const currentPath = pathSegments.join('/')
      // Prune: remove any already-added sub-paths consolidated under this node
      const prefix = `${currentPath}/`
      for (let i = results.length - 1; i >= 0; i--) {
        if (results[i]!.startsWith(prefix)) {
          results.splice(i, 1)
        }
      }
      results.push(currentPath)
      // Mark as consolidated so parent sees this as terminal
      node.children.clear()
      node.isTerminal = true
    }
  }
}

/**
 * Artifact Grounding — bottom-up LCA propagation for RPG HighLevelNodes.
 *
 * Implements Algorithm 1 from RPG-Encoder §3.3:
 * Assigns `metadata.path` to every HighLevelNode by computing the
 * Lowest Common Ancestor of its leaf descendants' directory paths.
 *
 * After grounding:
 * - Single-LCA nodes get `metadata.path` with `entityType: 'module'`
 * - Multi-LCA nodes get the first path in `metadata.path` and all paths in `metadata.extra.paths`
 * - Nodes with no leaf descendants are left unchanged
 */
export class ArtifactGrounder {
  constructor(private rpg: RepositoryPlanningGraph) {}

  /**
   * Ground all HighLevelNodes with physical path metadata.
   * Traverses the functional hierarchy bottom-up, propagating
   * directory paths from leaf LowLevelNodes upward.
   */
  async ground(): Promise<void> {
    // Find root nodes (HighLevelNodes with no parent)
    const highLevelNodes = await this.rpg.getHighLevelNodes()

    for (const node of highLevelNodes) {
      const parent = await this.rpg.getParent(node.id)
      if (!parent) {
        // This is a root — start propagation from here
        await this.propagate(node.id)
      }
    }
  }

  /**
   * PROPAGATE(v) from Algorithm 1:
   * Recursively collects directory paths from leaves and assigns
   * LCA-computed paths to HighLevelNodes.
   *
   * @returns Set of directory paths covered by this subtree
   */
  private async propagate(nodeId: string): Promise<Set<string>> {
    const node = await this.rpg.getNode(nodeId)
    if (!node)
      return new Set()

    // Base case: LowLevelNode — return its directory
    if (isLowLevelNode(node)) {
      const filePath = node.metadata?.path
      if (!filePath)
        return new Set()
      return new Set([path.dirname(filePath)])
    }

    // Recursive case: collect child coverage
    const children = await this.rpg.getChildren(nodeId)
    const dirSet = new Set<string>()

    for (const child of children) {
      const childDirs = await this.propagate(child.id)
      for (const dir of childDirs) {
        dirSet.add(dir)
      }
    }

    // Assign grounded paths only to HighLevelNodes with leaf descendants
    if (isHighLevelNode(node) && dirSet.size > 0) {
      const lcaPaths = computeLCA(dirSet)

      if (lcaPaths.length === 1) {
        await this.rpg.updateNode(nodeId, {
          metadata: {
            ...node.metadata,
            entityType: 'module',
            path: lcaPaths[0],
          },
        })
      }
      else if (lcaPaths.length > 1) {
        const sorted = [...lcaPaths].sort()
        await this.rpg.updateNode(nodeId, {
          metadata: {
            ...node.metadata,
            entityType: 'module',
            path: sorted[0],
            extra: {
              ...node.metadata?.extra,
              paths: sorted,
            },
          },
        })
      }
    }

    return dirSet
  }
}

/**
 * Compute LCA paths from a set of directory paths using a prefix trie.
 * Exported for testing.
 */
export function computeLCA(dirPaths: Set<string>): string[] {
  if (dirPaths.size === 0)
    return []
  if (dirPaths.size === 1)
    return [...dirPaths]

  const trie = new PathTrie()
  for (const dir of dirPaths) {
    trie.insert(dir)
  }
  return trie.computeLCA()
}
