/**
 * Source Endorsement Configuration
 * Defines credibility settings for different sources
 */
export interface SourceEndorsement {
  /** Name identifier for this source */
  name: string;

  /** Glob patterns to match source URLs/paths */
  patterns: string[];

  /** Base credibility score (0-100) */
  credibility: number;

  /** Contexts where this source is most relevant */
  contexts?: string[];

  /** Temporal decay rate per year (0-1, e.g., 0.05 = 5% decay per year) */
  temporalDecay?: number;

  /** Whether this source requires verification (e.g., upvotes for Stack Overflow) */
  requireVerification?: boolean;
}

/**
 * Credibility Score Calculation
 */
export interface CredibilityScore {
  /** Source identifier */
  source: string;

  /** Base score from configuration (0-1) */
  baseScore: number;

  /** Temporal decay factor (0-1) */
  temporalDecay: number;

  /** Contextual fit score (0-1) */
  contextualFit: number;

  /** User feedback score (0-1) */
  userFeedback: number;

  /** Final computed score (0-1) */
  finalScore: number;

  /** When this score was calculated */
  updatedAt: Date;
}

/**
 * Source Information
 */
export interface SourceInfo {
  /** Source identifier */
  id: string;

  /** Source name */
  name: string;

  /** Source URL or path */
  url: string;

  /** When the source was last updated */
  updatedAt: Date;

  /** Context of the source */
  context?: string;
}

/**
 * Endorsed Retrieval Result
 * Extends regular retrieval with credibility information
 */
export interface EndorsedRetrievalResult {
  /** The chunk */
  chunk: {
    id: string;
    filePath: string;
    content: string;
    metadata: any;
  };

  /** Embedding similarity score (0-1) */
  embeddingScore: number;

  /** Credibility score (0-1) */
  credibilityScore: number;

  /** Final relevance score (0-1) */
  finalRelevance: number;

  /** Source information */
  source: SourceInfo;

  /** Explanation of the score (for debugging) */
  explanation?: string;
}

/**
 * Endorsement Configuration
 */
export interface EndorsementConfig {
  /** Source endorsements */
  sources: SourceEndorsement[];

  /** Weights for combining scores */
  weights: {
    /** Weight for embedding similarity (0-1) */
    embedding: number;

    /** Weight for credibility (0-1) */
    credibility: number;
  };

  /** Storage path for feedback (optional) */
  feedbackStoragePath?: string;
}

