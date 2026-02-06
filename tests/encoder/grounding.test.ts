import { describe, expect, it } from 'vitest'
import { computeLCA } from '../../src/encoder/grounding'

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
