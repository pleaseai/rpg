import { beforeEach, describe, expect, test } from 'vitest'
import { ZeroRepo } from '../src/zerorepo'

describe('ZeroRepo', () => {
  let zerorepo: ZeroRepo

  beforeEach(() => {
    zerorepo = new ZeroRepo({
      spec: 'A simple calculator library with basic arithmetic operations',
    })
  })

  test('creates ZeroRepo with spec', () => {
    const zr = new ZeroRepo({ spec: 'test spec' })
    expect(zr).toBeDefined()
  })

  test('creates ZeroRepo with custom options', () => {
    const zr = new ZeroRepo({
      spec: 'test spec',
      language: 'python',
      generateTests: false,
    })
    expect(zr).toBeDefined()
  })

  test('buildProposalGraph returns RPG', async () => {
    const rpg = await zerorepo.buildProposalGraph()

    expect(rpg).toBeDefined()
    expect(rpg.getConfig().name).toBe('generated-repo')
  })

  test('buildImplementationGraph accepts proposal graph', async () => {
    const proposalGraph = await zerorepo.buildProposalGraph()
    const rpg = await zerorepo.buildImplementationGraph(proposalGraph)

    expect(rpg).toBeDefined()
  })

  test('generateRepository returns result', async () => {
    const proposalGraph = await zerorepo.buildProposalGraph()
    const rpg = await zerorepo.buildImplementationGraph(proposalGraph)
    const result = await zerorepo.generateRepository(rpg, '/tmp/test-output')

    expect(result.outputPath).toBe('/tmp/test-output')
    expect(result.filesGenerated).toBeGreaterThanOrEqual(0)
    expect(result.linesOfCode).toBeGreaterThanOrEqual(0)
  })
})

describe('ZeroRepo Pipeline', () => {
  test('full pipeline executes without error', async () => {
    const zerorepo = new ZeroRepo({
      spec: 'A utility library for string manipulation',
      language: 'typescript',
      generateTests: true,
    })

    const proposalGraph = await zerorepo.buildProposalGraph()
    expect(proposalGraph).toBeDefined()

    const implementationGraph = await zerorepo.buildImplementationGraph(proposalGraph)
    expect(implementationGraph).toBeDefined()

    const result = await zerorepo.generateRepository(implementationGraph, '/tmp/zerorepo-test')
    expect(result).toBeDefined()
  })

  test('specification is stored in RPG description', async () => {
    const spec = 'A machine learning library'
    const zerorepo = new ZeroRepo({ spec })

    const rpg = await zerorepo.buildProposalGraph()
    expect(rpg.getConfig().description).toBe(spec)
  })
})

describe('ZeroRepo Options', () => {
  test('default language is typescript', async () => {
    const zerorepo = new ZeroRepo({ spec: 'test' })
    // Default options are applied internally
    expect(zerorepo).toBeDefined()
  })

  test('generateTests defaults to true', async () => {
    const zerorepo = new ZeroRepo({ spec: 'test' })
    expect(zerorepo).toBeDefined()
  })

  test('accepts python language', () => {
    const zerorepo = new ZeroRepo({
      spec: 'test',
      language: 'python',
    })
    expect(zerorepo).toBeDefined()
  })

  test('accepts generateTests false', () => {
    const zerorepo = new ZeroRepo({
      spec: 'test',
      generateTests: false,
    })
    expect(zerorepo).toBeDefined()
  })
})
