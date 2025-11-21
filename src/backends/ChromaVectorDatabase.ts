import * as path from 'path';
import type { IVectorDatabase } from '../interfaces/IVectorDatabase';
import type { CodeVector } from '../models/CodeChunk';
import type { RAGQueryFilters, SemanticSearchResult } from '../models/RAGQuery';

/**
 * ChromaDB vector database backend
 * Uses ChromaDB for vector storage and similarity search
 *
 * NOTE: This requires the chromadb package to be installed:
 * npm install chromadb
 *
 * And ChromaDB server to be running (or use embedded mode)
 */
export class ChromaVectorDatabase implements IVectorDatabase {
  readonly name = 'chroma';

  private client: any; // ChromaClient type
  private collection: any; // Collection type
  private projectId?: string;
  private host: string;
  private port: number;

  constructor(config: {
    host?: string;
    port?: number;
  } = {}) {
    this.host = config.host || 'localhost';
    this.port = config.port || 8000;
  }

  async initialize(projectId: string): Promise<void> {
    this.projectId = projectId;

    try {
      // Dynamically import chromadb (optional dependency)
      // @ts-ignore - chromadb is optional
      const { ChromaClient } = await import('chromadb');

      this.client = new ChromaClient({
        path: `http://${this.host}:${this.port}`,
      });

      // Get or create collection
      const collectionName = this.sanitizeCollectionName(projectId);
      this.collection = await this.client.getOrCreateCollection({
        name: collectionName,
        metadata: {
          'hnsw:space': 'cosine', // Use cosine similarity
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Cannot find module')) {
        throw new Error(
          'ChromaDB client not installed. Run: npm install chromadb'
        );
      }
      throw error;
    }
  }

  async upsert(vector: CodeVector): Promise<void> {
    await this.upsertBatch([vector]);
  }

  async upsertBatch(vectors: CodeVector[]): Promise<void> {
    if (vectors.length === 0) {
      return;
    }

    const ids = vectors.map(v => v.id);
    const embeddings = vectors.map(v => v.embedding);
    const documents = vectors.map(v => v.content);
    const metadatas = vectors.map(v => this.prepareMetadata(v));

    await this.collection.upsert({
      ids,
      embeddings,
      documents,
      metadatas,
    });
  }

  async search(
    queryVector: number[],
    topK: number,
    filters?: RAGQueryFilters
  ): Promise<SemanticSearchResult[]> {
    const whereClause = filters ? this.buildWhereClause(filters) : undefined;

    const results = await this.collection.query({
      queryEmbeddings: [queryVector],
      nResults: topK,
      where: whereClause,
    });

    // Convert ChromaDB results to SemanticSearchResult
    const searchResults: SemanticSearchResult[] = [];

    if (results.ids && results.ids[0]) {
      for (let i = 0; i < results.ids[0].length; i++) {
        const metadata = results.metadatas?.[0]?.[i] || {};
        const document = results.documents?.[0]?.[i] || '';
        const distance = results.distances?.[0]?.[i] || 0;

        // Convert distance to similarity (ChromaDB returns distance, not similarity)
        // For cosine distance: similarity = 1 - distance
        const similarity = 1 - distance;

        searchResults.push({
          filePath: metadata.filePath || '',
          content: document,
          similarity,
          metadata: {
            startLine: metadata.startLine || 0,
            endLine: metadata.endLine || 0,
            astNode: metadata.astNode,
            language: metadata.language,
            chunkId: metadata.chunkId || '',
            fileType: metadata.fileType,
            directory: metadata.directory,
          },
        });
      }
    }

    return searchResults;
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.collection.delete({
      ids,
    });
  }

  async deleteByFilePath(filePath: string): Promise<void> {
    await this.collection.delete({
      where: { filePath },
    });
  }

  async clear(): Promise<void> {
    if (this.collection) {
      await this.client.deleteCollection({
        name: this.collection.name,
      });

      // Recreate the collection
      if (this.projectId) {
        const collectionName = this.sanitizeCollectionName(this.projectId);
        this.collection = await this.client.createCollection({
          name: collectionName,
          metadata: {
            'hnsw:space': 'cosine',
          },
        });
      }
    }
  }

  async count(): Promise<number> {
    const result = await this.collection.count();
    return result;
  }

  async get(id: string): Promise<CodeVector | null> {
    const result = await this.collection.get({
      ids: [id],
    });

    if (result.ids && result.ids.length > 0) {
      const metadata = result.metadatas?.[0] || {};
      const document = result.documents?.[0] || '';
      const embedding = result.embeddings?.[0] || [];

      return {
        id: result.ids[0],
        filePath: metadata.filePath || '',
        content: document,
        embedding,
        metadata: {
          startLine: metadata.startLine || 0,
          endLine: metadata.endLine || 0,
          astNode: metadata.astNode,
          language: metadata.language,
          chunkId: metadata.chunkId || '',
          fileType: metadata.fileType || '',
          directory: metadata.directory || '',
        },
      };
    }

    return null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.heartbeat();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // ChromaDB client doesn't need explicit closing
    this.collection = null;
    this.client = null;
  }

  /**
   * Prepare metadata for ChromaDB storage
   * ChromaDB has restrictions on metadata types
   */
  private prepareMetadata(vector: CodeVector): Record<string, any> {
    return {
      filePath: vector.filePath,
      startLine: vector.metadata.startLine,
      endLine: vector.metadata.endLine,
      astNode: vector.metadata.astNode || '',
      language: vector.metadata.language || '',
      chunkId: vector.metadata.chunkId,
      fileType: vector.metadata.fileType || path.extname(vector.filePath),
      directory: vector.metadata.directory || path.dirname(vector.filePath),
    };
  }

  /**
   * Build WHERE clause for ChromaDB queries based on filters
   */
  private buildWhereClause(filters: RAGQueryFilters): any {
    const conditions: any[] = [];

    if (filters.fileTypes && filters.fileTypes.length > 0) {
      conditions.push({
        fileType: { $in: filters.fileTypes },
      });
    }

    if (filters.directories && filters.directories.length > 0) {
      // ChromaDB doesn't support partial matching, so we need to be exact
      conditions.push({
        directory: { $in: filters.directories },
      });
    }

    if (filters.astNodeTypes && filters.astNodeTypes.length > 0) {
      conditions.push({
        astNode: { $in: filters.astNodeTypes },
      });
    }

    if (conditions.length === 0) {
      return undefined;
    }

    if (conditions.length === 1) {
      return conditions[0];
    }

    return { $and: conditions };
  }

  /**
   * Sanitize collection name for ChromaDB
   * ChromaDB has restrictions on collection names
   */
  private sanitizeCollectionName(name: string): string {
    // Replace invalid characters with underscores
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  }
}
