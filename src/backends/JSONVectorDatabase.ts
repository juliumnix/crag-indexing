import * as fs from 'fs';
import * as path from 'path';
import type { IVectorDatabase } from '../interfaces/IVectorDatabase';
import type { CodeVector } from '../models/CodeChunk';
import type { RAGQueryFilters, SemanticSearchResult } from '../models/RAGQuery';
import { cosineSimilarity } from '../utils/similarity';
import { matchesFilters } from '../utils/filters';

/**
 * Simple JSON-based vector database
 * Stores vectors in memory and optionally persists to disk
 * Good for development and small projects
 */
export class JSONVectorDatabase implements IVectorDatabase {
  readonly name = 'json';

  private vectors: Map<string, CodeVector> = new Map();
  private projectId?: string;
  private storagePath?: string;
  private persist: boolean;

  constructor(config: {
    storagePath?: string;
    persist?: boolean;
  } = {}) {
    this.storagePath = config.storagePath;
    this.persist = config.persist ?? true;
  }

  async initialize(projectId: string): Promise<void> {
    this.projectId = projectId;

    // Try to load existing vectors
    if (this.persist && this.storagePath) {
      await this.loadVectors();
    }
  }

  async upsert(vector: CodeVector): Promise<void> {
    this.vectors.set(vector.id, vector);

    if (this.persist) {
      await this.saveVectors();
    }
  }

  async upsertBatch(vectors: CodeVector[]): Promise<void> {
    for (const vector of vectors) {
      this.vectors.set(vector.id, vector);
    }

    if (this.persist) {
      await this.saveVectors();
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

    if (this.persist) {
      await this.saveVectors();
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

    if (this.persist && this.storagePath && this.projectId) {
      const vectorsFile = this.getVectorsFilePath();
      if (fs.existsSync(vectorsFile)) {
        fs.unlinkSync(vectorsFile);
      }
    }
  }

  async count(): Promise<number> {
    return this.vectors.size;
  }

  async get(id: string): Promise<CodeVector | null> {
    return this.vectors.get(id) || null;
  }

  async healthCheck(): Promise<boolean> {
    return true; // Always healthy
  }

  async close(): Promise<void> {
    if (this.persist) {
      await this.saveVectors();
    }
    this.vectors.clear();
  }

  /**
   * Save vectors to disk
   */
  private async saveVectors(): Promise<void> {
    if (!this.storagePath || !this.projectId) {
      return;
    }

    try {
      const vectorsDir = path.dirname(this.getVectorsFilePath());
      if (!fs.existsSync(vectorsDir)) {
        fs.mkdirSync(vectorsDir, { recursive: true });
      }

      const vectorsData: CodeVector[] = Array.from(this.vectors.values());

      const filePath = this.getVectorsFilePath();
      fs.writeFileSync(filePath, JSON.stringify(vectorsData, null, 2), 'utf-8');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to save vectors: ${errorMessage}`);
    }
  }

  /**
   * Load vectors from disk
   */
  private async loadVectors(): Promise<void> {
    if (!this.storagePath || !this.projectId) {
      return;
    }

    try {
      const filePath = this.getVectorsFilePath();

      if (!fs.existsSync(filePath)) {
        return;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const vectorsData: CodeVector[] = JSON.parse(content);

      this.vectors.clear();
      for (const vector of vectorsData) {
        this.vectors.set(vector.id, vector);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to load vectors: ${errorMessage}`);
    }
  }

  /**
   * Get the file path for storing vectors
   */
  private getVectorsFilePath(): string {
    return path.join(this.storagePath!, 'vectors', this.projectId!, 'vectors.json');
  }
}
