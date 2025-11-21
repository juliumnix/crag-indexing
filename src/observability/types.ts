/**
 * Trace Stage - A stage in the retrieval pipeline
 */
export interface TraceStage {
  /** Stage name */
  name: string;

  /** Duration in milliseconds */
  duration: number;

  /** Input data */
  input: any;

  /** Output data */
  output: any;

  /** Additional metadata */
  metadata: Record<string, any>;
}

/**
 * Score Breakdown
 */
export interface ScoreBreakdown {
  /** Chunk ID */
  chunkId: string;

  /** Embedding similarity score */
  embeddingScore: number;

  /** Credibility score (if endorsement enabled) */
  credibilityScore?: number;

  /** Version score (if versioning enabled) */
  versionScore?: number;

  /** Recency score */
  recencyScore?: number;

  /** Final score */
  finalScore: number;

  /** Explanation */
  explanation: string;
}

/**
 * Retrieval Trace
 */
export interface RetrievalTrace {
  /** Trace ID */
  id: string;

  /** Query text */
  query: string;

  /** Timestamp */
  timestamp: Date;

  /** Total duration in milliseconds */
  duration: number;

  /** Pipeline stages */
  stages: TraceStage[];

  /** Number of chunks retrieved */
  chunksRetrieved: number;

  /** Number of chunks returned */
  chunksReturned: number;

  /** Source names */
  sources: string[];

  /** Score breakdowns */
  scores: ScoreBreakdown[];
}

