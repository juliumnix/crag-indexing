import * as path from 'path';
import type { CodeVector } from '../models/CodeChunk';
import type { RAGQueryFilters } from '../models/RAGQuery';

/**
 * Check if a vector matches the given filters
 * Extracted to avoid duplication across vector database implementations
 */
export function matchesFilters(vector: CodeVector, filters: RAGQueryFilters): boolean {
  // File type filter
  if (filters.fileTypes && filters.fileTypes.length > 0) {
    const ext = path.extname(vector.filePath);
    if (!filters.fileTypes.includes(ext)) {
      return false;
    }
  }

  // Directory filter - use Set for better performance with many directories
  if (filters.directories && filters.directories.length > 0) {
    const dir = path.dirname(vector.filePath);
    const matches = filters.directories.some((filterDir: string) =>
      dir.includes(filterDir) || dir.startsWith(filterDir)
    );
    if (!matches) {
      return false;
    }
  }

  // AST node type filter
  if (filters.astNodeTypes && filters.astNodeTypes.length > 0) {
    if (!vector.metadata.astNode || !filters.astNodeTypes.includes(vector.metadata.astNode)) {
      return false;
    }
  }

  // Exclude paths filter
  if (filters.excludePaths && filters.excludePaths.length > 0) {
    const isExcluded = filters.excludePaths.some((excludePath: string) =>
      vector.filePath.includes(excludePath)
    );
    if (isExcluded) {
      return false;
    }
  }

  // Custom metadata filters
  if (filters.metadata) {
    for (const [key, value] of Object.entries(filters.metadata)) {
      if (value !== undefined && (vector.metadata as Record<string, unknown>)[key] !== value) {
        return false;
      }
    }
  }

  return true;
}
