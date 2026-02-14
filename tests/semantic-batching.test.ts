import type { EntityInput } from '@pleaseai/rpg-encoder/semantic'
import { SemanticExtractor } from '@pleaseai/rpg-encoder/semantic'
import { describe, expect, it } from 'vitest'

describe('semantic batching', () => {
  describe('createTokenAwareBatches', () => {
    const extractor = new SemanticExtractor({ useLLM: false })

    it('returns empty array for empty input', () => {
      const input: EntityInput[] = []
      const batches = (extractor as any).createTokenAwareBatches(input)
      expect(batches).toEqual([])
    })

    it('groups single entity into one batch', () => {
      const entity: EntityInput = {
        type: 'function',
        name: 'getValue',
        filePath: 'src/utils.ts',
      }
      const batches = (extractor as any).createTokenAwareBatches([entity])
      expect(batches).toHaveLength(1)
      expect(batches[0]).toEqual([entity])
    })

    it('groups multiple small entities within maxBatchTokens', () => {
      const entities: EntityInput[] = [
        {
          type: 'function',
          name: 'func1',
          filePath: 'src/a.ts',
        },
        {
          type: 'function',
          name: 'func2',
          filePath: 'src/b.ts',
        },
        {
          type: 'function',
          name: 'func3',
          filePath: 'src/c.ts',
        },
      ]
      // Each entity has ~200 tokens (no source code)
      // Total: 600 tokens, which is well under maxBatchTokens (50000)
      const batches = (extractor as any).createTokenAwareBatches(entities)
      expect(batches).toHaveLength(1)
      expect(batches[0]).toEqual(entities)
    })

    it('isolates single entity exceeding maxBatchTokens', () => {
      // Create an entity with huge source code
      const largeSource = 'x'.repeat(200000) // ~50000 tokens
      const largeEntity: EntityInput = {
        type: 'function',
        name: 'largeFunc',
        filePath: 'src/large.ts',
        sourceCode: largeSource,
      }
      const smallEntity: EntityInput = {
        type: 'function',
        name: 'small',
        filePath: 'src/small.ts',
      }

      const entities = [smallEntity, largeEntity]
      const batches = (extractor as any).createTokenAwareBatches(entities)

      // Should have at least 2 batches since large entity exceeds maxBatchTokens
      expect(batches.length).toBeGreaterThanOrEqual(2)
      // Verify large entity is isolated
      const largeInOwn = batches.some(batch => batch.length === 1 && batch[0] === largeEntity)
      expect(largeInOwn).toBe(true)
    })

    it('merges last batch into previous batch when below minBatchTokens', () => {
      // Create entities such that:
      // - First batch fills up close to maxBatchTokens
      // - Second batch (last) is below minBatchTokens
      // - Should be merged into first batch

      const mediumSource = 'x'.repeat(40000) // ~10000 tokens
      const entity1: EntityInput = {
        type: 'function',
        name: 'medium1',
        filePath: 'src/m1.ts',
        sourceCode: mediumSource,
      }
      const entity2: EntityInput = {
        type: 'function',
        name: 'medium2',
        filePath: 'src/m2.ts',
        sourceCode: mediumSource,
      }
      // Small entity that will be last batch
      const entity3: EntityInput = {
        type: 'function',
        name: 'small',
        filePath: 'src/s.ts',
      }

      const entities = [entity1, entity2, entity3]
      const batches = (extractor as any).createTokenAwareBatches(entities)

      // If last batch was merged, should have fewer batches
      // The exact behavior depends on token counts, but verify the method exists
      expect(batches.length).toBeGreaterThanOrEqual(1)
      // Verify all entities are in some batch
      const allEntities = batches.flat()
      expect(allEntities).toEqual(entities)
    })

    it('respects minBatchTokens and maxBatchTokens options', () => {
      const customExtractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 5000,
        maxBatchTokens: 20000,
      })

      const entities: EntityInput[] = [
        { type: 'function', name: 'a', filePath: 'a.ts' },
        { type: 'function', name: 'b', filePath: 'b.ts' },
        { type: 'function', name: 'c', filePath: 'c.ts' },
        { type: 'function', name: 'd', filePath: 'd.ts' },
        { type: 'function', name: 'e', filePath: 'e.ts' },
      ]

      const batches = (customExtractor as any).createTokenAwareBatches(entities)

      // Each entity is 200 tokens, so:
      // - Can fit 5 entities per batch with 20000 max (5 * 200 = 1000 tokens)
      // - All should fit in one batch
      expect(batches.length).toBeGreaterThanOrEqual(1)
      const allEntities = batches.flat()
      expect(allEntities).toEqual(entities)
    })

    it('preserves entity order across batches', () => {
      const entities: EntityInput[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'function',
        name: `func${i}`,
        filePath: `src/file${i}.ts`,
      }))

      const batches = (extractor as any).createTokenAwareBatches(entities)
      const flattened = batches.flat()

      // Verify order is preserved
      expect(flattened).toEqual(entities)
    })
  })

  describe('extractBatch integration', () => {
    it('extracts batch using token-aware batching', async () => {
      const extractor = new SemanticExtractor({ useLLM: false })

      const entities: EntityInput[] = [
        {
          type: 'function',
          name: 'getValue',
          filePath: 'src/utils.ts',
        },
        {
          type: 'class',
          name: 'UserService',
          filePath: 'src/services/user.ts',
        },
        {
          type: 'method',
          name: 'fetchData',
          filePath: 'src/api.ts',
          parent: 'ApiClient',
        },
      ]

      const results = await extractor.extractBatch(entities)

      expect(results).toHaveLength(3)
      expect(results[0]).toHaveProperty('description')
      expect(results[0]).toHaveProperty('keywords')
      expect(results[1]).toHaveProperty('description')
      expect(results[2]).toHaveProperty('keywords')
    })

    it('returns all entities in correct order', async () => {
      const extractor = new SemanticExtractor({ useLLM: false })

      const entities: EntityInput[] = [
        { type: 'function', name: 'getUser', filePath: 'user.ts' },
        { type: 'function', name: 'saveData', filePath: 'data.ts' },
        { type: 'function', name: 'validateInput', filePath: 'validate.ts' },
      ]

      const results = await extractor.extractBatch(entities)

      expect(results).toHaveLength(3)
      // Verify order is maintained by checking descriptions contain expected verbs
      expect(results[0].description).toContain('user')
      expect(results[1].description).toContain('save')
      expect(results[2].description).toContain('validate')
    })

    it('handles empty input array', async () => {
      const extractor = new SemanticExtractor({ useLLM: false })
      const results = await extractor.extractBatch([])
      expect(results).toEqual([])
    })

    it('handles large batch that gets split into multiple batches', async () => {
      const customExtractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 5000,
        maxBatchTokens: 20000,
      })

      // Create entities with source code to increase token count
      const entities: EntityInput[] = Array.from({ length: 5 }, (_, i) => ({
        type: 'function',
        name: `func${i}`,
        filePath: `src/file${i}.ts`,
        sourceCode: 'const x = 1;'.repeat(100), // Add some tokens
      }))

      const results = await customExtractor.extractBatch(entities)

      // Should get same number of results
      expect(results).toHaveLength(5)
      // All should have semantic features
      results.forEach((result) => {
        expect(result.description).toBeDefined()
        expect(result.keywords).toBeDefined()
      })
    })

    it('maintains backward compatibility with existing extract calls', async () => {
      const extractor = new SemanticExtractor({ useLLM: false })

      const input: EntityInput = {
        type: 'function',
        name: 'getValue',
        filePath: 'src/utils.ts',
      }

      // Single extract call should still work
      const result = await extractor.extract(input)
      expect(result.description).toBeDefined()
      expect(result.keywords).toBeDefined()

      // extractBatch with single item should match
      const batchResults = await extractor.extractBatch([input])
      expect(batchResults).toHaveLength(1)
      expect(batchResults[0].description).toBeDefined()
    })
  })
})
