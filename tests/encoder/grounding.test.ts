import { describe, expect, it } from 'vitest'
import { ArtifactGrounder, computeLCA } from '../../src/encoder/grounding'
import { RepositoryPlanningGraph } from '../../src/graph'

describe('computeLCA (PathTrie)', () => {
  it('should return empty array for empty input', () => {
    const result = computeLCA(new Set())
    expect(result).toEqual([])
  })

  it('should return single path when all inputs share one directory', () => {
    const result = computeLCA(new Set(['src/graph']))
    expect(result).toEqual(['src/graph'])
  })

  it('should return single path for multiple files in same directory', () => {
    // All files are in src/graph — LCA is src/graph
    const result = computeLCA(new Set(['src/graph', 'src/graph']))
    expect(result).toEqual(['src/graph'])
  })

  it('should return branching node when paths diverge', () => {
    // src/graph and src/encoder diverge at src/
    const result = computeLCA(new Set(['src/graph', 'src/encoder']))
    expect(result).toHaveLength(1)
    expect(result).toContain('src')
  })

  it('should return multiple LCA paths for unrelated directories', () => {
    // src/graph and tests/encoder share no common prefix beyond root
    const result = computeLCA(new Set(['src/graph', 'tests/encoder']))
    expect(result).toHaveLength(2)
    expect(result.sort()).toEqual(['src/graph', 'tests/encoder'])
  })

  it('should handle deeply nested paths with branching', () => {
    // src/encoder/reorganization and src/encoder/evolution diverge at src/encoder
    const result = computeLCA(
      new Set(['src/encoder/reorganization', 'src/encoder/evolution']),
    )
    expect(result).toHaveLength(1)
    expect(result).toContain('src/encoder')
  })

  it('should handle mix of related and unrelated paths', () => {
    const result = computeLCA(
      new Set(['src/graph', 'src/encoder', 'tests/fixtures']),
    )
    // src/graph and src/encoder merge to src, tests/fixtures stays separate
    expect(result).toHaveLength(2)
    expect(result.sort()).toEqual(['src', 'tests/fixtures'])
  })

  it('should handle root-level paths', () => {
    const result = computeLCA(new Set(['.']))
    expect(result).toEqual(['.'])
  })

  it('should handle paths with common prefix but different depths', () => {
    // src/encoder and src/encoder/reorganization
    // src/encoder is terminal, src/encoder/reorganization is deeper
    const result = computeLCA(
      new Set(['src/encoder', 'src/encoder/reorganization']),
    )
    // src/encoder is both terminal and has a child — it's a branching/terminal point
    expect(result).toHaveLength(1)
    expect(result).toContain('src/encoder')
  })

  it('should correctly prune subtrees to prevent redundant paths', () => {
    // All paths under src/encoder/* should consolidate to src/encoder
    const result = computeLCA(
      new Set([
        'src/encoder/reorganization',
        'src/encoder/evolution',
        'src/encoder/semantic',
      ]),
    )
    expect(result).toHaveLength(1)
    expect(result).toContain('src/encoder')
  })

  it('should handle three-way branching', () => {
    // a/b, a/c, a/d all diverge at a
    const result = computeLCA(new Set(['a/b', 'a/c', 'a/d']))
    expect(result).toHaveLength(1)
    expect(result).toContain('a')
  })
})

describe('ArtifactGrounder', () => {
  async function createTestRPG() {
    return RepositoryPlanningGraph.create({ name: 'test' })
  }

  it('should populate metadata.path for HighLevelNodes with single directory', async () => {
    const rpg = await createTestRPG()

    // Create hierarchy: HL -> LL(file in src/graph)
    await rpg.addHighLevelNode({
      id: 'domain:GraphStorage',
      feature: { description: 'manage graph storage' },
    })
    await rpg.addLowLevelNode({
      id: 'src/graph/node.ts:file',
      feature: { description: 'define graph nodes' },
      metadata: { entityType: 'file', path: 'src/graph/node.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'src/graph/edge.ts:file',
      feature: { description: 'define graph edges' },
      metadata: { entityType: 'file', path: 'src/graph/edge.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:GraphStorage', target: 'src/graph/node.ts:file' })
    await rpg.addFunctionalEdge({ source: 'domain:GraphStorage', target: 'src/graph/edge.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    const node = await rpg.getNode('domain:GraphStorage')
    expect(node?.metadata?.path).toBe('src/graph')
    expect(node?.metadata?.entityType).toBe('module')
  })

  it('should set metadata.extra.paths for multi-directory HighLevelNodes', async () => {
    const rpg = await createTestRPG()

    await rpg.addHighLevelNode({
      id: 'domain:Testing',
      feature: { description: 'testing infrastructure' },
    })
    await rpg.addLowLevelNode({
      id: 'src/utils/test-helper.ts:file',
      feature: { description: 'test helpers' },
      metadata: { entityType: 'file', path: 'src/utils/test-helper.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'tests/graph/graph.test.ts:file',
      feature: { description: 'graph tests' },
      metadata: { entityType: 'file', path: 'tests/graph/graph.test.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:Testing', target: 'src/utils/test-helper.ts:file' })
    await rpg.addFunctionalEdge({ source: 'domain:Testing', target: 'tests/graph/graph.test.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    const node = await rpg.getNode('domain:Testing')
    expect(node?.metadata?.entityType).toBe('module')
    expect(node?.metadata?.path).toBeDefined()
    expect(node?.metadata?.extra?.paths).toBeDefined()
    const paths = node?.metadata?.extra?.paths as string[]
    expect(paths).toHaveLength(2)
    expect(paths).toContain('src/utils')
    expect(paths).toContain('tests/graph')
  })

  it('should handle HighLevelNodes with no leaf descendants', async () => {
    const rpg = await createTestRPG()

    await rpg.addHighLevelNode({
      id: 'domain:Empty',
      feature: { description: 'empty domain' },
    })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    const node = await rpg.getNode('domain:Empty')
    // No metadata should be set since there are no leaf descendants
    expect(node?.metadata?.path).toBeUndefined()
  })

  it('should propagate through nested HighLevelNodes', async () => {
    const rpg = await createTestRPG()

    // 3-level hierarchy: area -> category -> subcategory -> files
    await rpg.addHighLevelNode({
      id: 'domain:Core',
      feature: { description: 'core functionality' },
    })
    await rpg.addHighLevelNode({
      id: 'domain:Core/storage',
      feature: { description: 'storage' },
    })
    await rpg.addHighLevelNode({
      id: 'domain:Core/storage/graph',
      feature: { description: 'graph storage' },
    })
    await rpg.addLowLevelNode({
      id: 'src/graph/store.ts:file',
      feature: { description: 'graph store' },
      metadata: { entityType: 'file', path: 'src/graph/store.ts' },
    })

    await rpg.addFunctionalEdge({ source: 'domain:Core', target: 'domain:Core/storage' })
    await rpg.addFunctionalEdge({ source: 'domain:Core/storage', target: 'domain:Core/storage/graph' })
    await rpg.addFunctionalEdge({ source: 'domain:Core/storage/graph', target: 'src/graph/store.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    // All HighLevelNodes should get src/graph as their path
    const leaf = await rpg.getNode('domain:Core/storage/graph')
    expect(leaf?.metadata?.path).toBe('src/graph')

    const mid = await rpg.getNode('domain:Core/storage')
    expect(mid?.metadata?.path).toBe('src/graph')

    const root = await rpg.getNode('domain:Core')
    expect(root?.metadata?.path).toBe('src/graph')
  })

  it('should handle entityType set to module for grounded nodes', async () => {
    const rpg = await createTestRPG()

    await rpg.addHighLevelNode({
      id: 'domain:Encoder',
      feature: { description: 'encoding pipeline' },
    })
    await rpg.addLowLevelNode({
      id: 'src/encoder/encoder.ts:file',
      feature: { description: 'encoder' },
      metadata: { entityType: 'file', path: 'src/encoder/encoder.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:Encoder', target: 'src/encoder/encoder.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    const node = await rpg.getNode('domain:Encoder')
    expect(node?.metadata?.entityType).toBe('module')
  })
})
