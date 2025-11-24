import type { SemanticSearchResult } from '../model/RAGQuery';

/**
 * Context Budget Configuration
 */
export interface ContextBudget {
  /** Maximum tokens allowed */
  maxTokens: number;

  /** Reserved tokens (for system prompt) */
  reservedTokens: number;

  /** Available tokens = maxTokens - reservedTokens */
  availableTokens: number;

  /** Whether to deduplicate chunks */
  deduplication: boolean;

  /** Whether to prioritize recent documents */
  prioritizeRecent: boolean;
}

/**
 * Optimized Chunk
 */
export interface OptimizedChunk extends SemanticSearchResult {
  /** Token count for this chunk */
  tokenCount: number;

  /** IDs of similar chunks (redundant) */
  similarTo?: string[];

  /** Priority score (0-1) */
  priority: number;
}

