/**
 * Conflict Level
 */
export enum ConflictLevel {
  CRITICAL = 'critical',
  WARNING = 'warning',
  INFO = 'info',
}

/**
 * Conflict Source
 */
export interface ConflictSource {
  /** Chunk ID */
  chunkId: string;

  /** Content */
  content: string;

  /** Source name */
  source: string;

  /** Version (if available) */
  version?: string;
}

/**
 * Conflict
 */
export interface Conflict {
  /** Conflict level */
  level: ConflictLevel;

  /** Title */
  title: string;

  /** Description */
  description: string;

  /** Sources involved */
  sources: ConflictSource[];

  /** When detected */
  detected: Date;
}

