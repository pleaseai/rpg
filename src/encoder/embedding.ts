import OpenAI from 'openai'

/**
 * Embedding vector result
 */
export interface EmbeddingVector {
  /** The embedding vector */
  vector: number[]
  /** Vector dimension */
  dimension: number
}

/**
 * Abstract base class for embedding implementations
 */
export abstract class Embedding {
  protected abstract maxTokens: number

  /**
   * Preprocess text to ensure it's valid for embedding
   */
  protected preprocessText(text: string): string {
    if (text == null || text === '') {
      return ' '
    }

    // Simple character-based truncation (approximately 4 chars per token)
    const maxChars = this.maxTokens * 4
    if (text.length > maxChars) {
      return text.substring(0, maxChars)
    }

    return text
  }

  /**
   * Preprocess array of texts
   */
  protected preprocessTexts(texts: string[]): string[] {
    return texts.map((text) => this.preprocessText(text))
  }

  /**
   * Generate embedding vector for text
   */
  abstract embed(text: string): Promise<EmbeddingVector>

  /**
   * Generate embedding vectors for multiple texts in batch
   */
  abstract embedBatch(texts: string[]): Promise<EmbeddingVector[]>

  /**
   * Get embedding vector dimension
   */
  abstract getDimension(): number

  /**
   * Get service provider name
   */
  abstract getProvider(): string
}

/**
 * OpenAI embedding configuration
 */
export interface OpenAIEmbeddingConfig {
  /** OpenAI API key */
  apiKey: string
  /** Model name (default: text-embedding-3-small) */
  model?: string
  /** Custom base URL for API */
  baseURL?: string
}

/**
 * Supported OpenAI embedding models and their dimensions
 */
const OPENAI_MODELS: Record<string, { dimension: number; description: string }> = {
  'text-embedding-3-small': {
    dimension: 1536,
    description: 'High performance and cost-effective embedding model (recommended)',
  },
  'text-embedding-3-large': {
    dimension: 3072,
    description: 'Highest performance embedding model with larger dimensions',
  },
  'text-embedding-ada-002': {
    dimension: 1536,
    description: 'Legacy model (use text-embedding-3-small instead)',
  },
}

/**
 * OpenAI Embedding implementation
 *
 * Uses OpenAI's text-embedding models to generate vector embeddings.
 * Supports text-embedding-3-small (default), text-embedding-3-large, and ada-002.
 */
export class OpenAIEmbedding extends Embedding {
  private client: OpenAI
  private model: string
  private dimension: number
  protected maxTokens = 8192

  constructor(config: OpenAIEmbeddingConfig) {
    super()
    this.model = config.model ?? 'text-embedding-3-small'
    this.dimension = OPENAI_MODELS[this.model]?.dimension ?? 1536
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<EmbeddingVector> {
    const processedText = this.preprocessText(text)

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: processedText,
        encoding_format: 'float',
      })

      const firstResult = response.data[0]
      if (!firstResult) {
        throw new Error('OpenAI returned empty response')
      }
      const embedding = firstResult.embedding
      this.dimension = embedding.length

      return {
        vector: embedding,
        dimension: this.dimension,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to generate OpenAI embedding: ${message}`)
    }
  }

  /**
   * Generate embeddings for multiple texts in a single API call
   */
  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.length === 0) {
      return []
    }

    const processedTexts = this.preprocessTexts(texts)

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: processedTexts,
        encoding_format: 'float',
      })

      const firstResult = response.data[0]
      if (!firstResult) {
        throw new Error('OpenAI returned empty response')
      }
      this.dimension = firstResult.embedding.length

      return response.data.map((item) => ({
        vector: item.embedding,
        dimension: this.dimension,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to generate OpenAI batch embeddings: ${message}`)
    }
  }

  getDimension(): number {
    return this.dimension
  }

  getProvider(): string {
    return 'OpenAI'
  }

  /**
   * Get the current model name
   */
  getModel(): string {
    return this.model
  }

  /**
   * Get list of supported models
   */
  static getSupportedModels(): Record<string, { dimension: number; description: string }> {
    return { ...OPENAI_MODELS }
  }
}

/**
 * Mock embedding for testing (generates deterministic vectors)
 */
export class MockEmbedding extends Embedding {
  private readonly dimension: number
  protected maxTokens = 8192

  constructor(dimension = 1536) {
    super()
    this.dimension = dimension
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const processedText = this.preprocessText(text)
    return {
      vector: this.generateDeterministicVector(processedText),
      dimension: this.dimension,
    }
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    const processedTexts = this.preprocessTexts(texts)
    return processedTexts.map((text) => ({
      vector: this.generateDeterministicVector(text),
      dimension: this.dimension,
    }))
  }

  getDimension(): number {
    return this.dimension
  }

  getProvider(): string {
    return 'Mock'
  }

  /**
   * Generate a deterministic vector based on text content
   * Same text always produces same vector (for testing)
   */
  private generateDeterministicVector(text: string): number[] {
    const vector: number[] = []
    let hash = 0

    // Simple hash function
    for (let i = 0; i < text.length; i++) {
      const codePoint = text.codePointAt(i) ?? 0
      hash = (hash * 31 + codePoint) % 2147483647
    }

    // Generate deterministic vector values
    for (let i = 0; i < this.dimension; i++) {
      hash = (hash * 1103515245 + 12345) % 2147483648
      // Normalize to [-1, 1] range
      vector.push((hash / 2147483647) * 2 - 1)
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
    return vector.map((val) => val / magnitude)
  }
}
