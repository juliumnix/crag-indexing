import type { DependencyGraph, FileMetadata } from './FileMetadata';

/**
 * Statistics about the indexing process
 */
export interface IndexingStats {
  /** Duration in milliseconds */
  duration: number;

  /** Number of successfully indexed files */
  successCount: number;

  /** Number of files that failed to index */
  errorCount: number;

  /** Total lines indexed */
  totalLines: number;

  /** Embedding provider used */
  embeddingProvider: string;

  /** Vector database backend used */
  vectorBackend: string;

  /** Chunking strategy used */
  chunkingStrategy: string;
}

/**
 * Configuration for indexing
 */
export interface IndexingConfig {
  /** File patterns to include (glob patterns) */
  includePatterns?: string[];

  /** Directories to exclude */
  excludeDirectories?: string[];

  /** Detect business rules path automatically */
  detectBusinessRulesPath?: boolean;

  /** Build dependency graph */
  buildDependencyGraph?: boolean;

  /** Chunking strategy */
  chunkingStrategy?: 'ast' | 'sliding-window' | 'semantic' | 'fixed-size';

  /** Maximum chunk size in tokens */
  maxChunkSize?: number;

  /** Overlap between chunks */
  chunkOverlap?: number;

  /** Delay between embedding requests (ms) */
  embeddingDelay?: number;

  /** Persist index to disk */
  persist?: boolean;

  /** Storage path */
  storagePath?: string;
}

/**
 * Indexed Repository - Metadata about an indexed codebase
 */
export interface IndexedRepository {
  /** Project ID */
  projectId: string;

  /** Project path */
  projectPath: string;

  /** When the repository was indexed */
  indexedAt: Date;

  /** Total number of files indexed */
  totalFiles: number;

  /** Total number of chunks created */
  totalChunks: number;

  /** Total number of vectors stored */
  totalVectors: number;

  /** List of indexed files */
  files: FileMetadata[];

  /** Dependency graph (if built) */
  dependencyGraph?: DependencyGraph;

  /** Indexing statistics */
  stats: IndexingStats;
}

