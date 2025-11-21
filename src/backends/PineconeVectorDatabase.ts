import { Pinecone } from '@pinecone-database/pinecone';
import type { IVectorDatabase } from '../interfaces/IVectorDatabase';
import type { CodeVector } from '../models/CodeChunk';
import type { RAGQueryFilters, SemanticSearchResult } from '../models/RAGQuery';

/**
 * Pinecone vector database backend
 * Stores vectors in Pinecone cloud service
 */
export class PineconeVectorDatabase implements IVectorDatabase {
  readonly name = 'pinecone';

  private client: Pinecone | null = null;
  private index: any = null; // Pinecone index
  private projectId?: string;
  private apiKey: string;
  private indexName?: string;
  private dimension?: number;

  constructor(config: {
    apiKey: string;
    indexName?: string;
    dimension?: number;
  }) {
    if (!config.apiKey) {
      throw new Error('Pinecone API key is required');
    }

    this.apiKey = config.apiKey;
    this.indexName = config.indexName;
    this.dimension = config.dimension;
  }

  async initialize(projectId: string): Promise<void> {
    this.projectId = projectId;

    // Initialize Pinecone client if not already initialized
    if (!this.client) {
      this.client = new Pinecone({
        apiKey: this.apiKey,
      });
    }

    // Use projectId as index name if not provided
    const finalIndexName = this.indexName || `crag-${projectId}`;

    try {
      // Check if index exists
      const indexes = await this.client.listIndexes();
      const indexExists = indexes.indexes?.some((idx: any) => idx.name === finalIndexName);

      if (!indexExists) {
        // Create index if it doesn't exist
        // Default dimension is 768 (for embeddinggemma)
        const dimension = this.dimension || 768;

        await this.client.createIndex({
          name: finalIndexName,
          dimension,
          metric: 'cosine',
          spec: {
            serverless: {
              cloud: 'aws',
              region: 'us-east-1',
            },
          },
        });

        // Wait for index to be ready
        await this.waitForIndexReady(finalIndexName);
      }

      // Get index reference
      this.index = this.client.index(finalIndexName);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to initialize Pinecone: ${errorMessage}`);
    }
  }

  async upsert(vector: CodeVector): Promise<void> {
    if (!this.index) {
      throw new Error('Pinecone index not initialized. Call initialize() first.');
    }

    try {
      await this.index.upsert([
        {
          id: vector.id,
          values: vector.embedding,
          metadata: {
            filePath: vector.filePath,
            content: vector.content,
            startLine: vector.metadata.startLine,
            endLine: vector.metadata.endLine,
            astNode: vector.metadata.astNode || '',
            language: vector.metadata.language || '',
            chunkId: vector.metadata.chunkId,
            fileType: vector.metadata.fileType || '',
            directory: vector.metadata.directory || '',
            // Store characteristics as JSON string
            characteristics: vector.metadata.characteristics
              ? JSON.stringify(vector.metadata.characteristics)
              : '',
          },
        },
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to upsert vector: ${errorMessage}`);
    }
  }

  async upsertBatch(vectors: CodeVector[]): Promise<void> {
    if (!this.index) {
      throw new Error('Pinecone index not initialized. Call initialize() first.');
    }

    if (vectors.length === 0) {
      return;
    }

    try {
      // Pinecone supports batch upserts
      // Process in chunks of 100 (Pinecone limit)
      const chunkSize = 100;
      for (let i = 0; i < vectors.length; i += chunkSize) {
        const chunk = vectors.slice(i, i + chunkSize);
        const records = chunk.map(vector => ({
          id: vector.id,
          values: vector.embedding,
          metadata: {
            filePath: vector.filePath,
            content: vector.content,
            startLine: vector.metadata.startLine,
            endLine: vector.metadata.endLine,
            astNode: vector.metadata.astNode || '',
            language: vector.metadata.language || '',
            chunkId: vector.metadata.chunkId,
            fileType: vector.metadata.fileType || '',
            directory: vector.metadata.directory || '',
            characteristics: vector.metadata.characteristics
              ? JSON.stringify(vector.metadata.characteristics)
              : '',
          },
        }));

        await this.index.upsert(records);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to upsert batch: ${errorMessage}`);
    }
  }

  async search(
    queryVector: number[],
    topK: number,
    filters?: RAGQueryFilters
  ): Promise<SemanticSearchResult[]> {
    if (!this.index) {
      throw new Error('Pinecone index not initialized. Call initialize() first.');
    }

    try {
      // Build Pinecone filter
      const pineconeFilter = this.buildPineconeFilter(filters);

      // Query Pinecone
      const queryResponse = await this.index.query({
        vector: queryVector,
        topK,
        includeMetadata: true,
        filter: pineconeFilter,
      });

      // Convert Pinecone results to SemanticSearchResult
      const results: SemanticSearchResult[] = [];

      for (const match of queryResponse.matches || []) {
        const metadata = match.metadata as any;

        // Parse characteristics if present
        let characteristics;
        if (metadata.characteristics) {
          try {
            characteristics = JSON.parse(metadata.characteristics);
          } catch {
            characteristics = undefined;
          }
        }

        const result: SemanticSearchResult = {
          filePath: metadata.filePath || '',
          content: metadata.content || '',
          similarity: match.score || 0, // Pinecone returns score (0-1 for cosine)
          metadata: {
            startLine: metadata.startLine || 0,
            endLine: metadata.endLine || 0,
            astNode: metadata.astNode || undefined,
            language: metadata.language || undefined,
            chunkId: metadata.chunkId || '',
            fileType: metadata.fileType || undefined,
            directory: metadata.directory || undefined,
            characteristics,
          },
        };

        results.push(result);
      }

      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to search: ${errorMessage}`);
    }
  }

  async delete(ids: string[]): Promise<void> {
    if (!this.index) {
      throw new Error('Pinecone index not initialized. Call initialize() first.');
    }

    if (ids.length === 0) {
      return;
    }

    try {
      // Pinecone v6 delete accepts an object with ids array
      await this.index.deleteMany(ids);
    } catch (error) {
      // Fallback: try delete with object format
      try {
        await this.index.delete({ ids });
      } catch (deleteError) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to delete vectors: ${errorMessage}`);
      }
    }
  }

  async deleteByFilePath(filePath: string): Promise<void> {
    if (!this.index) {
      throw new Error('Pinecone index not initialized. Call initialize() first.');
    }

    try {
      // Pinecone doesn't support delete by metadata directly
      // We need to query first, then delete
      // This is a limitation - for better performance, we could maintain a mapping
      const queryResponse = await this.index.query({
        vector: new Array(this.dimension || 768).fill(0), // Dummy vector
        topK: 10000, // Large number to get all matches
        includeMetadata: true,
        filter: {
          filePath: { $eq: filePath },
        },
      });

      const idsToDelete = (queryResponse.matches || []).map((m: any) => m.id);
      if (idsToDelete.length > 0) {
        try {
          await this.index.deleteMany(idsToDelete);
        } catch {
          // Fallback
          await this.index.delete({ ids: idsToDelete });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to delete by file path: ${errorMessage}`);
    }
  }

  async clear(): Promise<void> {
    if (!this.index) {
      throw new Error('Pinecone index not initialized. Call initialize() first.');
    }

    try {
      // Delete all vectors by deleting the index and recreating it
      const indexName = this.indexName || `crag-${this.projectId}`;
      if (this.client) {
        await this.client.deleteIndex(indexName);
        // Recreate index
        const dimension = this.dimension || 768;
        await this.client.createIndex({
          name: indexName,
          dimension,
          metric: 'cosine',
          spec: {
            serverless: {
              cloud: 'aws',
              region: 'us-east-1',
            },
          },
        });
        await this.waitForIndexReady(indexName);
        this.index = this.client.index(indexName);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to clear index: ${errorMessage}`);
    }
  }

  async count(): Promise<number> {
    if (!this.index) {
      throw new Error('Pinecone index not initialized. Call initialize() first.');
    }

    try {
      const stats = await this.index.describeIndexStats();
      return stats.totalRecordCount || 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get count: ${errorMessage}`);
    }
  }

  async get(id: string): Promise<CodeVector | null> {
    if (!this.index) {
      throw new Error('Pinecone index not initialized. Call initialize() first.');
    }

    try {
      const fetchResponse = await this.index.fetch([id]);
      const record = fetchResponse.records?.[id];

      if (!record) {
        return null;
      }

      const metadata = record.metadata as any;

      // Parse characteristics if present
      let characteristics;
      if (metadata.characteristics) {
        try {
          characteristics = JSON.parse(metadata.characteristics);
        } catch {
          characteristics = undefined;
        }
      }

      return {
        id: record.id,
        filePath: metadata.filePath || '',
        content: metadata.content || '',
        embedding: record.values || [],
        metadata: {
          startLine: metadata.startLine || 0,
          endLine: metadata.endLine || 0,
          astNode: metadata.astNode || undefined,
          language: metadata.language || undefined,
          chunkId: metadata.chunkId || '',
          fileType: metadata.fileType || undefined,
          directory: metadata.directory || undefined,
          characteristics,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get vector: ${errorMessage}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Initialize client if not already initialized
      if (!this.client) {
        this.client = new Pinecone({
          apiKey: this.apiKey,
        });
      }

      const indexes = await this.client.listIndexes();
      return indexes.indexes !== undefined;
    } catch (error) {
      // Log error for debugging
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Pinecone health check failed: ${errorMessage}`);
      return false;
    }
  }

  async close(): Promise<void> {
    // Pinecone client doesn't need explicit closing
    this.index = null;
    this.client = null;
  }

  /**
   * Build Pinecone filter from RAGQueryFilters
   */
  private buildPineconeFilter(filters?: RAGQueryFilters): any {
    if (!filters) {
      return undefined;
    }

    const filterConditions: any[] = [];

    // File type filter
    if (filters.fileTypes && filters.fileTypes.length > 0) {
      filterConditions.push({
        fileType: { $in: filters.fileTypes },
      });
    }

    // Directory filter
    if (filters.directories && filters.directories.length > 0) {
      // Pinecone doesn't support partial string matching easily
      // We'll use $in for exact matches or $regex for partial
      // For now, we'll check if directory starts with any of the filter directories
      // This is a limitation - we might need to store directory parts separately
      filterConditions.push({
        $or: filters.directories.map((dir: string) => ({
          directory: { $regex: `^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
        })),
      });
    }

    // AST node type filter
    if (filters.astNodeTypes && filters.astNodeTypes.length > 0) {
      filterConditions.push({
        astNode: { $in: filters.astNodeTypes },
      });
    }

    // Exclude paths filter
    if (filters.excludePaths && filters.excludePaths.length > 0) {
      filterConditions.push({
        $and: filters.excludePaths.map((excludePath: string) => ({
          filePath: { $ne: excludePath },
        })),
      });
    }

    // Custom metadata filters
    if (filters.metadata) {
      for (const [key, value] of Object.entries(filters.metadata)) {
        if (value !== undefined) {
          filterConditions.push({
            [key]: { $eq: value },
          });
        }
      }
    }

    if (filterConditions.length === 0) {
      return undefined;
    }

    if (filterConditions.length === 1) {
      return filterConditions[0];
    }

    return {
      $and: filterConditions,
    };
  }

  /**
   * Wait for index to be ready
   */
  private async waitForIndexReady(indexName: string, maxWaitMs: number = 120000): Promise<void> {
    const startTime = Date.now();
    console.log(`  Aguardando índice ${indexName} ficar pronto...`);

    while (Date.now() - startTime < maxWaitMs) {
      try {
        if (this.client) {
          const indexes = await this.client.listIndexes();
          const index = indexes.indexes?.find((idx: any) => idx.name === indexName);

          if (index) {
            // Check if index is ready
            // Status can be 'Initializing', 'ScalingUp', 'ScalingDown', 'Ready', etc.
            const status = index.status?.state || (index.status?.ready ? 'Ready' : 'Initializing');
            const isReady = status === 'Ready' || index.status?.ready === true;
            
            if (isReady) {
              console.log(`  ✓ Índice ${indexName} está pronto!`);
              return;
            }
            // Log status for debugging
            if ((Date.now() - startTime) % 10000 < 2000) {
              console.log(`  Status do índice: ${status || 'verificando...'}`);
            }
          }
        }

        // Wait 2 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        // Continue waiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    throw new Error(`Index ${indexName} did not become ready within ${maxWaitMs}ms`);
  }
}

