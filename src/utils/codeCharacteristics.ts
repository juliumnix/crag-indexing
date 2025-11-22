/**
 * Code characteristics extracted from content
 */
export interface CodeCharacteristics {
  lines: number;
  words: number;
  imports: number;
  exports: number;
  functions: number;
  classes: number;
  /** Index signature for compatibility with Record<string, unknown> */
  [key: string]: number;
}

/**
 * Extract code characteristics from content
 * Extracted to avoid duplication across indexer implementations
 */
export function extractCharacteristics(content: string): CodeCharacteristics {
  const lines = content.split('\n').length;
  const words = content.split(/\s+/).length;
  const imports = (content.match(/import\s+/g) || []).length;
  const exports = (content.match(/export\s+/g) || []).length;
  const functions = (content.match(/(function|=>|=>\s*\{)/g) || []).length;
  const classes = (content.match(/class\s+/g) || []).length;

  return { lines, words, imports, exports, functions, classes };
}
