// Store interfaces (generic, domain-agnostic)
export type { GraphStore } from './graph-store'
export type { TextSearchStore } from './text-search-store'
export type { VectorStore } from './vector-store'
export type { ContextStore } from './context-store'

// Shared types
export type {
  NodeAttrs,
  EdgeAttrs,
  SerializedGraph,
  NodeFilter,
  EdgeFilter,
  TraverseOpts,
  TraverseResult,
  VectorSearchOpts,
  VectorSearchResult,
  TextSearchOpts,
  TextSearchResult,
  Lifecycle,
  ContextStoreConfig,
} from './types'

// Store implementations — import directly to avoid transitive deps:
//   import { SQLiteGraphStore } from './store/sqlite'
//   import { SQLiteTextSearchStore } from './store/sqlite'
//   import { SurrealGraphStore } from './store/surreal'
//   import { SurrealTextSearchStore } from './store/surreal'
//   import { LanceDBVectorStore } from './store/lancedb'
