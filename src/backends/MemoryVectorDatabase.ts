import * as path from 'path';
import type { IVectorDatabase } from '../interfaces/IVectorDatabase';
import type { CodeVector } from '../models/CodeChunk';
import type { RAGQueryFilters, SemanticSearchResult } from '../models/RAGQuery';

/**
 * In-memory vector database
 * Stores vectors only in memory (no persistence)
 * Fastest option for testing and development
 */
export class MemoryVectorDatabase implements IVectorDatabase {
  readonly name = 'memory';

  private vectors: Map<string, CodeVector> = new Map();

  async initialize(_projectId: string): Promise<void> {
    this.vectors.clear();
  }

  async upsert(vector: CodeVector): Promise<void> {
    this.vectors.set(vector.id, vector);
  }

  async upsertBatch(vectors: CodeVector[]): Promise<void> {
    for (const vector of vectors) {
      this.vectors.set(vector.id, vector);
    }
  }

  async search(
    queryVector: number[],
    topK: number,
    filters?: RAGQueryFilters
  ): Promise<SemanticSearchResult[]> {
    const results: SemanticSearchResult[] = [];

    for (const vector of this.vectors.values()) {
      // Apply filters
      if (filters && !this.matchesFilters(vector, filters)) {
        continue;
      }

      const similarity = this.cosineSimilarity(queryVector, vector.embedding);

      results.push({
        filePath: vector.filePath,
        content: vector.content,
        similarity,
        metadata: vector.metadata,
      });
    }

    // Sort by similarity (highest first) and limit
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, topK);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.vectors.delete(id);
    }
  }

  async deleteByFilePath(filePath: string): Promise<void> {
    const idsToDelete: string[] = [];

    for (const [id, vector] of this.vectors.entries()) {
      if (vector.filePath === filePath) {
        idsToDelete.push(id);
      }
    }

    await this.delete(idsToDelete);
  }

  async clear(): Promise<void> {
    this.vectors.clear();
  }

  async count(): Promise<number> {
    return this.vectors.size;
  }

  async get(id: string): Promise<CodeVector | null> {
    return this.vectors.get(id) || null;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.vectors.clear();
  }

  /**
   * Check if a vector matches the given filters
   */
  private matchesFilters(vector: CodeVector, filters: RAGQueryFilters): boolean {
    if (filters.fileTypes && filters.fileTypes.length > 0) {
      const ext = path.extname(vector.filePath);
      if (!filters.fileTypes.includes(ext)) {
        return false;
      }
    }

    if (filters.directories && filters.directories.length > 0) {
      const dir = path.dirname(vector.filePath);
      const matches = filters.directories.some((filterDir: string) =>
        dir.includes(filterDir) || dir.startsWith(filterDir)
      );
      if (!matches) {
        return false;
      }
    }

    if (filters.astNodeTypes && filters.astNodeTypes.length > 0) {
      if (!vector.metadata.astNode || !filters.astNodeTypes.includes(vector.metadata.astNode)) {
        return false;
      }
    }

    if (filters.excludePaths && filters.excludePaths.length > 0) {
      const isExcluded = filters.excludePaths.some((excludePath: string) =>
        vector.filePath.includes(excludePath)
      );
      if (isExcluded) {
        return false;
      }
    }

    if (filters.metadata) {
      for (const [key, value] of Object.entries(filters.metadata)) {
        if (value !== undefined && (vector.metadata as any)[key] !== value) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
