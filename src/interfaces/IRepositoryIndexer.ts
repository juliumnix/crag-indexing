import type { IndexedRepository, IndexingConfig } from '../model/IndexedRepository';
import type { RAGQuery, SemanticSearchResult } from '../model/RAGQuery';
import type { DependencyGraph } from '../model/FileMetadata';

/**
 * Interface for repository indexing
 * Main entry point for the indexing domain
 */
export interface IRepositoryIndexer {
  /**
   * Index a repository and create vector embeddings
   * @param config - Configuration for indexing
   */
  index(config?: IndexingConfig): Promise<IndexedRepository>;

  /**
   * Load a previously indexed repository from disk
   */
  load(): Promise<IndexedRepository | null>;

  /**
   * Save the indexed repository to disk
   */
  save(repository: IndexedRepository): Promise<void>;

  /**
   * Query the indexed repository using RAG
   */
  query(query: RAGQuery): Promise<SemanticSearchResult[]>;

  /**
   * Get the dependency graph of the repository
   */
  getDependencyGraph(): DependencyGraph | null;

  /**
   * Get the current indexed repository
   */
  getRepository(): IndexedRepository | null;

  /**
   * Clear all indexed data
   */
  clear(): Promise<void>;
}

/**
 * Configuration for RepositoryIndexer
 */
export interface RepositoryIndexerConfig {
  /** Path to the repository */
  projectPath: string;

  /** Unique identifier for the project */
  projectId: string;

  /** Embedding provider configuration */
  embeddingProvider?: any; // Will be IEmbeddingProvider

  /** Vector database configuration */
  vectorDatabase?: any; // Will be IVectorDatabase

  /** Chunking strategy configuration */
  chunkingStrategy?: any; // Will be IChunkingStrategy

  /** Storage path for cache and indexes */
  storagePath?: string;

  /** Whether to use cache if available */
  useCache?: boolean;
}

