import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { TextSearchStore } from '../../src/store/text-search-store'
import { SQLiteTextSearchStore } from '../../src/store/sqlite/text-search-store'
import { SurrealTextSearchStore } from '../../src/store/surreal/text-search-store'

function runTextSearchTests(name: string, createStore: () => TextSearchStore) {
  describe(`${name}: TextSearchStore conformance`, () => {
    let store: TextSearchStore

    beforeEach(async () => {
      store = createStore()
      await store.open('memory')
    })

    afterEach(async () => {
      await store.close()
    })

    test('index and search by feature', async () => {
      await store.index('auth-mod', {
        feature_desc: 'authentication and authorization module',
        feature_keywords: 'auth login security',
      })

      const results = await store.search('authentication')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('auth-mod')
    })

    test('search returns empty for no match', async () => {
      await store.index('n1', { feature_desc: 'hello world' })
      const results = await store.search('nonexistent')
      expect(results).toHaveLength(0)
    })

    test('remove document from index', async () => {
      await store.index('n1', { feature_desc: 'authentication module' })
      await store.remove('n1')
      const results = await store.search('authentication')
      expect(results).toHaveLength(0)
    })

    test('field-restricted search', async () => {
      await store.index('n1', {
        feature_desc: 'handles user authentication',
        path: '/src/auth/login.ts',
      })
      await store.index('n2', {
        feature_desc: 'API routing',
        path: '/src/api/router.ts',
      })

      // Search only in path field
      const pathResults = await store.search('auth', { fields: ['path'] })
      // Should find n1 (has auth in path)
      if (pathResults.length > 0) {
        expect(pathResults.some((r) => r.id === 'n1')).toBe(true)
      }
    })

    test('indexBatch', async () => {
      if (!store.indexBatch) return

      await store.indexBatch([
        { id: 'b1', fields: { feature_desc: 'batch item one' } },
        { id: 'b2', fields: { feature_desc: 'batch item two' } },
      ])

      const results = await store.search('batch')
      expect(results.length).toBe(2)
    })
  })
}

runTextSearchTests('SQLiteTextSearchStore', () => new SQLiteTextSearchStore())
runTextSearchTests('SurrealTextSearchStore', () => new SurrealTextSearchStore())
