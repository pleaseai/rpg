import { describe, expect, test } from 'vitest'
import {
  EdgeType,
  NodeType,
  RepositoryPlanningGraph,
  createDependencyEdge,
  createFunctionalEdge,
  createHighLevelNode,
  createLowLevelNode,
  isDependencyEdge,
  isFunctionalEdge,
  isHighLevelNode,
  isLowLevelNode,
} from '../src/graph'

describe('Node', () => {
  test('createHighLevelNode creates valid node', () => {
    const node = createHighLevelNode({
      id: 'test-node',
      feature: { description: 'handle authentication' },
      directoryPath: '/src/auth',
    })

    expect(node.id).toBe('test-node')
    expect(node.type).toBe(NodeType.HighLevel)
    expect(node.feature.description).toBe('handle authentication')
    expect(node.directoryPath).toBe('/src/auth')
  })

  test('createLowLevelNode creates valid node', () => {
    const node = createLowLevelNode({
      id: 'func-node',
      feature: {
        description: 'validate user credentials',
        keywords: ['auth', 'login'],
      },
      metadata: {
        entityType: 'function',
        path: '/src/auth/login.ts',
        startLine: 10,
        endLine: 25,
      },
    })

    expect(node.id).toBe('func-node')
    expect(node.type).toBe(NodeType.LowLevel)
    expect(node.metadata.entityType).toBe('function')
    expect(node.metadata.path).toBe('/src/auth/login.ts')
  })

  test('isHighLevelNode returns correct type guard', () => {
    const highLevel = createHighLevelNode({
      id: 'high',
      feature: { description: 'module' },
    })
    const lowLevel = createLowLevelNode({
      id: 'low',
      feature: { description: 'function' },
      metadata: { entityType: 'function', path: '/test.ts' },
    })

    expect(isHighLevelNode(highLevel)).toBe(true)
    expect(isHighLevelNode(lowLevel)).toBe(false)
    expect(isLowLevelNode(highLevel)).toBe(false)
    expect(isLowLevelNode(lowLevel)).toBe(true)
  })
})

describe('Edge', () => {
  test('createFunctionalEdge creates valid edge', () => {
    const edge = createFunctionalEdge({
      source: 'parent',
      target: 'child',
      level: 1,
    })

    expect(edge.source).toBe('parent')
    expect(edge.target).toBe('child')
    expect(edge.type).toBe(EdgeType.Functional)
    expect(edge.level).toBe(1)
  })

  test('createDependencyEdge creates valid edge', () => {
    const edge = createDependencyEdge({
      source: 'a',
      target: 'b',
      dependencyType: 'import',
      line: 5,
    })

    expect(edge.source).toBe('a')
    expect(edge.target).toBe('b')
    expect(edge.type).toBe(EdgeType.Dependency)
    expect(edge.dependencyType).toBe('import')
    expect(edge.line).toBe(5)
  })

  test('isFunctionalEdge returns correct type guard', () => {
    const functional = createFunctionalEdge({ source: 'a', target: 'b' })
    const dependency = createDependencyEdge({
      source: 'a',
      target: 'b',
      dependencyType: 'call',
    })

    expect(isFunctionalEdge(functional)).toBe(true)
    expect(isFunctionalEdge(dependency)).toBe(false)
    expect(isDependencyEdge(functional)).toBe(false)
    expect(isDependencyEdge(dependency)).toBe(true)
  })
})

describe('RepositoryPlanningGraph', () => {
  test('creates empty graph', () => {
    const rpg = new RepositoryPlanningGraph({ name: 'test-repo' })
    const stats = rpg.getStats()

    expect(stats.nodeCount).toBe(0)
    expect(stats.edgeCount).toBe(0)
  })

  test('adds and retrieves nodes', () => {
    const rpg = new RepositoryPlanningGraph({ name: 'test-repo' })

    rpg.addHighLevelNode({
      id: 'module',
      feature: { description: 'auth module' },
    })

    rpg.addLowLevelNode({
      id: 'func',
      feature: { description: 'login function' },
      metadata: { entityType: 'function', path: '/auth.ts' },
    })

    expect(rpg.hasNode('module')).toBe(true)
    expect(rpg.hasNode('func')).toBe(true)
    expect(rpg.hasNode('nonexistent')).toBe(false)

    const node = rpg.getNode('module')
    expect(node?.feature.description).toBe('auth module')
  })

  test('adds and retrieves edges', () => {
    const rpg = new RepositoryPlanningGraph({ name: 'test-repo' })

    rpg.addHighLevelNode({ id: 'parent', feature: { description: 'parent' } })
    rpg.addLowLevelNode({
      id: 'child',
      feature: { description: 'child' },
      metadata: { entityType: 'file', path: '/test.ts' },
    })

    rpg.addFunctionalEdge({ source: 'parent', target: 'child' })
    rpg.addDependencyEdge({
      source: 'child',
      target: 'parent',
      dependencyType: 'import',
    })

    const edges = rpg.getEdges()
    expect(edges.length).toBe(2)

    const funcEdges = rpg.getFunctionalEdges()
    expect(funcEdges.length).toBe(1)

    const depEdges = rpg.getDependencyEdges()
    expect(depEdges.length).toBe(1)
  })

  test('gets children and parent', () => {
    const rpg = new RepositoryPlanningGraph({ name: 'test-repo' })

    rpg.addHighLevelNode({ id: 'root', feature: { description: 'root' } })
    rpg.addHighLevelNode({ id: 'child1', feature: { description: 'child1' } })
    rpg.addHighLevelNode({ id: 'child2', feature: { description: 'child2' } })

    rpg.addFunctionalEdge({ source: 'root', target: 'child1' })
    rpg.addFunctionalEdge({ source: 'root', target: 'child2' })

    const children = rpg.getChildren('root')
    expect(children.length).toBe(2)

    const parent = rpg.getParent('child1')
    expect(parent?.id).toBe('root')
  })

  test('searches by feature', () => {
    const rpg = new RepositoryPlanningGraph({ name: 'test-repo' })

    rpg.addHighLevelNode({ id: 'auth', feature: { description: 'handle authentication' } })
    rpg.addHighLevelNode({ id: 'data', feature: { description: 'process data' } })

    const results = rpg.searchByFeature('auth')
    expect(results.length).toBe(1)
    expect(results[0]?.id).toBe('auth')
  })

  test('serializes and deserializes', () => {
    const rpg = new RepositoryPlanningGraph({
      name: 'test-repo',
      description: 'Test repository',
    })

    rpg.addHighLevelNode({ id: 'root', feature: { description: 'root module' } })
    rpg.addLowLevelNode({
      id: 'func',
      feature: { description: 'test function' },
      metadata: { entityType: 'function', path: '/test.ts' },
    })
    rpg.addFunctionalEdge({ source: 'root', target: 'func' })

    const json = rpg.toJSON()
    const restored = RepositoryPlanningGraph.fromJSON(json)

    expect(restored.getStats().nodeCount).toBe(2)
    expect(restored.getStats().edgeCount).toBe(1)
    expect(restored.getConfig().name).toBe('test-repo')
  })
})
