import * as fs from 'fs';
import * as path from 'path';
import type { IVectorDatabase } from '../interfaces/IVectorDatabase';
import type { CodeVector } from '../models/CodeChunk';
import type { RAGQueryFilters, SemanticSearchResult } from '../models/RAGQuery';

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
   * Check if a vector matches the given filters
   */
  private matchesFilters(vector: CodeVector, filters: RAGQueryFilters): boolean {
    // File type filter
    if (filters.fileTypes && filters.fileTypes.length > 0) {
      const ext = path.extname(vector.filePath);
      if (!filters.fileTypes.includes(ext)) {
        return false;
      }
    }

    // Directory filter
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
