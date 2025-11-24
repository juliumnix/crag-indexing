import type { CodeChunk } from '../model/CodeChunk';

/**
 * Interface for code chunking strategies
 * Different strategies for breaking code into analyzable chunks
 */
export interface IChunkingStrategy {
  /**
   * Name of the chunking strategy
   */
  readonly name: string;

  /**
   * Chunk a file into multiple code chunks
   * @param filePath - Path to the file to chunk
   * @param content - File content
   * @param language - Programming language
   */
  chunk(filePath: string, content: string, language: string): Promise<CodeChunk[]>;
}

/**
 * Configuration for chunking strategies
 */
export interface ChunkingStrategyConfig {
  /** Strategy type */
  type: 'ast' | 'sliding-window' | 'semantic' | 'fixed-size';

  /** Maximum chunk size in tokens */
  maxChunkSize?: number;

  /** Overlap between chunks (for sliding-window) */
  chunkOverlap?: number;

  /** Minimum chunk size in tokens */
  minChunkSize?: number;

  /** Whether to preserve code structure (functions, classes) */
  preserveStructure?: boolean;
}

