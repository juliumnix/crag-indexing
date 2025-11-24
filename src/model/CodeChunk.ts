/**
 * Code Chunk - Represents a piece of code extracted from a file
 */
export interface CodeChunk {
  /** Unique identifier for the chunk */
  id: string;

  /** Path to the source file */
  filePath: string;

  /** Content of the chunk */
  content: string;

  /** Starting line number (1-based) */
  startLine: number;

  /** Ending line number (1-based) */
  endLine: number;

  /** AST node type (if available) */
  astNode?: string;

  /** Programming language */
  language: string;
}

/**
 * Code Vector - A code chunk with its embedding vector
 */
export interface CodeVector {
  /** Unique identifier for the vector */
  id: string;

  /** Path to the source file */
  filePath: string;

  /** Content of the chunk */
  content: string;

  /** Embedding vector */
  embedding: number[];

  /** Metadata about the chunk */
  metadata: {
    /** Starting line number (1-based) */
    startLine: number;

    /** Ending line number (1-based) */
    endLine: number;

    /** AST node type (if available) */
    astNode?: string;

    /** Programming language */
    language: string;

    /** Original chunk ID */
    chunkId: string;

    /** File extension */
    fileType: string;

    /** Directory path */
    directory: string;

    /** Code characteristics */
    characteristics?: {
      lines: number;
      words: number;
      imports: number;
      exports: number;
      functions: number;
      classes: number;
    };
  };
}

