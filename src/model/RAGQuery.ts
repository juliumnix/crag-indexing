import type { CodeVector } from './CodeChunk';

/**
 * Filters for RAG queries
 */
export interface RAGQueryFilters {
  /** Filter by file types (extensions) */
  fileTypes?: string[];

  /** Filter by directories */
  directories?: string[];

  /** Filter by file paths (glob patterns) */
  filePaths?: string[];

  /** Filter by languages */
  languages?: string[];

  /** Filter by AST node types */
  astNodeTypes?: string[];

  /** Exclude paths */
  excludePaths?: string[];

  /** Custom metadata filters */
  metadata?: Record<string, any>;
}

/**
 * Endorsement options for query
 */
export interface EndorsementOptions {
  /** Enable endorsement reranking */
  enabled: boolean;

  /** Minimum credibility score (0-1) */
  minCredibility?: number;
}

/**
 * Version options for query
 */
export interface VersionOptions {
  /** Target version */
  target: string;

  /** Include newer versions */
  includeNewer?: boolean;

  /** Include older versions */
  includeOlder?: boolean;

  /** Include breaking changes */
  includeBreakingChanges?: boolean;
}

/**
 * Context budget options
 */
export interface ContextBudgetOptions {
  /** Maximum tokens */
  maxTokens: number;

  /** Reserved tokens */
  reservedTokens: number;

  /** Enable deduplication */
  deduplication?: boolean;

  /** Prioritize recent documents */
  prioritizeRecent?: boolean;
}

/**
 * RAG Query - Input for semantic search
 */
export interface RAGQuery {
  /** Query text */
  text: string;

  /** Number of results to return */
  topK?: number;

  /** Minimum similarity threshold (0-1) */
  minSimilarity?: number;

  /** Optional filters */
  filters?: RAGQueryFilters;

  /** Whether to rerank results */
  rerank?: boolean;

  /** Endorsement options */
  endorsement?: EndorsementOptions;

  /** Version options */
  version?: VersionOptions;

  /** Context budget options */
  contextBudget?: ContextBudgetOptions;

  /** Detect conflicts */
  detectConflicts?: boolean;
}

/**
 * Semantic Search Result
 */
export interface SemanticSearchResult {
  /** Path to the source file */
  filePath: string;

  /** Content of the chunk */
  content: string;

  /** Similarity score (0-1) */
  similarity: number;

  /** Metadata about the chunk */
  metadata: {
    startLine: number;
    endLine: number;
    astNode?: string;
    language: string;
    chunkId?: string;
    fileType?: string;
    directory?: string;
    characteristics?: {
      lines: number;
      words: number;
      imports: number;
      exports: number;
      functions: number;
      classes: number;
    };
  };

  /** Embedding score (if endorsement enabled) */
  embeddingScore?: number;

  /** Credibility score (if endorsement enabled) */
  credibilityScore?: number;

  /** Final relevance score (if endorsement enabled) */
  finalRelevance?: number;

  /** Explanation of scores (if endorsement enabled) */
  explanation?: string;

  /** Conflicts detected (if conflict detection enabled) */
  conflicts?: Array<{
    level: string;
    title: string;
    description: string;
  }>;

  /** Deprecation warning (if source is deprecated) */
  deprecation?: {
    warning: string;
    reason: string;
    replacedBy?: string;
  };

  /** Tokens used (if context budget enabled) */
  usedTokens?: number;
}

/**
 * Configuration for RAG query engine
 */
export interface RAGQueryConfig {
  /** Enable hybrid search (vector + keyword) */
  hybridSearch?: boolean;

  /** Weight for keyword search (0-1) */
  keywordWeight?: number;
}

