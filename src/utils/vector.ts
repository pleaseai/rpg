import * as lancedb from '@lancedb/lancedb'

/**
 * Vector store options
 */
export interface VectorStoreOptions {
  /** Database path (directory for LanceDB) */
  dbPath: string
  /** Table name */
  tableName: string
  /** Embedding dimension */
  dimension?: number
}

/**
 * Embedding result
 */
export interface EmbeddingResult {
  /** Original text */
  text: string
  /** Embedding vector */
  embedding: number[]
  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * Search result from vector store
 */
export interface VectorSearchResult {
  /** Document ID */
  id: string
  /** Similarity score (distance) */
  score: number
  /** Document text */
  text: string
  /** Associated metadata */
  metadata?: Record<string, unknown>
}

/**
 * Document schema for LanceDB
 */
interface VectorDocument {
  id: string
  text: string
  vector: number[]
  metadata?: string // JSON serialized metadata
}

/**
 * Vector Store using LanceDB
 *
 * LanceDB is a Bun-native, disk-based vector database that provides:
 * - Fast similarity search
 * - Persistent storage
 * - No external server required
 *
 * Used for:
 * - Feature tree embedding and retrieval
 * - Semantic similarity search
 * - Node clustering
 */
export class VectorStore {
  private options: VectorStoreOptions
  private db: lancedb.Connection | null = null
  private table: lancedb.Table | null = null

  constructor(options: VectorStoreOptions) {
    this.options = {
      dimension: 1536,
      ...options,
    }
  }

  /**
   * Initialize the database connection
   */
  private async ensureConnection(): Promise<lancedb.Table> {
    if (!this.db) {
      this.db = await lancedb.connect(this.options.dbPath)
    }

    if (!this.table) {
      const tableNames = await this.db.tableNames()
      if (tableNames.includes(this.options.tableName)) {
        this.table = await this.db.openTable(this.options.tableName)
      }
    }

    if (!this.table) {
      throw new Error(`Table "${this.options.tableName}" does not exist. Call add() first.`)
    }

    return this.table
  }

  /**
   * Add documents to the store
   */
  async add(
    documents: Array<{
      id: string
      text: string
      vector: number[]
      metadata?: Record<string, unknown>
    }>
  ): Promise<void> {
    if (!this.db) {
      this.db = await lancedb.connect(this.options.dbPath)
    }

    const data: VectorDocument[] = documents.map((doc) => ({
      id: doc.id,
      text: doc.text,
      vector: doc.vector,
      metadata: doc.metadata ? JSON.stringify(doc.metadata) : undefined,
    }))

    const tableNames = await this.db.tableNames()
    if (tableNames.includes(this.options.tableName)) {
      // Add to existing table
      this.table = await this.db.openTable(this.options.tableName)
      await this.table.add(data)
    } else {
      // Create new table
      this.table = await this.db.createTable(this.options.tableName, data)
    }
  }

  /**
   * Search for similar documents
   */
  async search(queryVector: number[], topK = 10): Promise<VectorSearchResult[]> {
    const table = await this.ensureConnection()

    const results = await table.search(queryVector).limit(topK).toArray()

    return results.map((row) => ({
      id: row.id as string,
      score: row._distance as number,
      text: row.text as string,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    }))
  }

  /**
   * Delete documents by ID
   */
  async delete(ids: string[]): Promise<void> {
    const table = await this.ensureConnection()

    // LanceDB uses SQL-like filter syntax
    const idList = ids.map((id) => `'${id}'`).join(', ')
    await table.delete(`id IN (${idList})`)
  }

  /**
   * Clear all documents (drop and recreate table)
   */
  async clear(): Promise<void> {
    if (!this.db) {
      this.db = await lancedb.connect(this.options.dbPath)
    }

    const tableNames = await this.db.tableNames()
    if (tableNames.includes(this.options.tableName)) {
      await this.db.dropTable(this.options.tableName)
    }

    this.table = null
  }

  /**
   * Get document count
   */
  async count(): Promise<number> {
    const table = await this.ensureConnection()
    return await table.countRows()
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    this.db = null
    this.table = null
  }
}
