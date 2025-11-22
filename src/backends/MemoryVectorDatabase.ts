import type { IVectorDatabase } from '../interfaces/IVectorDatabase';
import type { CodeVector } from '../models/CodeChunk';
import type { RAGQueryFilters, SemanticSearchResult } from '../models/RAGQuery';
import { cosineSimilarity } from '../utils/similarity';
import { matchesFilters } from '../utils/filters';

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
      if (filters && !matchesFilters(vector, filters)) {
        continue;
      }

      const similarity = cosineSimilarity(queryVector, vector.embedding);

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
}
