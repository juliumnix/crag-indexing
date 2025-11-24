import type { CodeVector } from '../model/CodeChunk';
import type { RAGQueryFilters, SemanticSearchResult } from '../model/RAGQuery';

/**
 * Interface for vector database backends
 * Abstracts the storage and retrieval of vector embeddings
 */
export interface IVectorDatabase {
  /**
   * Name of the vector database backend
   */
  readonly name: string;

  /**
   * Initialize the database (create collections, connect, etc.)
   */
  initialize(projectId: string): Promise<void>;

  /**
   * Insert or update a single vector
   */
  upsert(vector: CodeVector): Promise<void>;

  /**
   * Insert or update multiple vectors (batch operation)
   */
  upsertBatch(vectors: CodeVector[]): Promise<void>;

  /**
   * Search for similar vectors
   * @param queryVector - The query embedding vector
   * @param topK - Number of results to return
   * @param filters - Optional filters to apply
   */
  search(
    queryVector: number[],
    topK: number,
    filters?: RAGQueryFilters
  ): Promise<SemanticSearchResult[]>;

  /**
   * Delete vectors by IDs
   */
  delete(ids: string[]): Promise<void>;

  /**
   * Delete all vectors for a specific file
   */
  deleteByFilePath(filePath: string): Promise<void>;

  /**
   * Clear all vectors from the database
   */
  clear(): Promise<void>;

  /**
   * Get total count of vectors in the database
   */
  count(): Promise<number>;

  /**
   * Get vector by ID
   */
  get(id: string): Promise<CodeVector | null>;

  /**
   * Check if database is healthy and ready
   */
  healthCheck(): Promise<boolean>;

  /**
   * Close database connections
   */
  close(): Promise<void>;
}

/**
 * Configuration for vector database backends
 */
export interface VectorDatabaseConfig {
  /** Backend type (chroma, pinecone, qdrant, json, etc.) */
  type: 'chroma' | 'pinecone' | 'qdrant' | 'json' | 'memory';

  /** Storage path (for local backends) */
  storagePath?: string;

  /** API key (for cloud backends) */
  apiKey?: string;

  /** Host URL (for self-hosted backends) */
  host?: string;

  /** Port (for self-hosted backends) */
  port?: number;

  /** Collection/index name */
  collectionName?: string;

  /** Distance metric to use */
  distanceMetric?: 'cosine' | 'euclidean' | 'dot';

  /** Whether to persist to disk */
  persist?: boolean;
}

/**
 * Factory for creating vector database instances
 */
export interface IVectorDatabaseFactory {
  /**
   * Create a vector database backend based on configuration
   */
  create(config: VectorDatabaseConfig): Promise<IVectorDatabase>;
}

