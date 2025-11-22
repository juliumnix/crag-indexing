import type { IVectorDatabase, IVectorDatabaseFactory, VectorDatabaseConfig } from '../interfaces/IVectorDatabase';
import { MemoryVectorDatabase } from './MemoryVectorDatabase';
import { JSONVectorDatabase } from './JSONVectorDatabase';
import { ChromaVectorDatabase } from './ChromaVectorDatabase';
import { PineconeVectorDatabase } from './PineconeVectorDatabase';

/**
 * Factory for creating vector database instances
 */
export class VectorDatabaseFactory implements IVectorDatabaseFactory {
  async create(config: VectorDatabaseConfig): Promise<IVectorDatabase> {
    switch (config.type) {
      case 'memory':
        return new MemoryVectorDatabase();

      case 'json':
        return new JSONVectorDatabase({
          storagePath: config.storagePath,
          persist: config.persist,
        });

      case 'chroma':
        return new ChromaVectorDatabase({
          host: config.host,
          port: config.port,
        });

      case 'pinecone':
        if (!config.apiKey) {
          throw new Error('Pinecone API key is required');
        }
        return new PineconeVectorDatabase({
          apiKey: config.apiKey,
          indexName: config.collectionName,
          dimension: config.distanceMetric ? undefined : 768, // Default for embeddinggemma
        });

      default:
        throw new Error(`Unknown vector database type: ${config.type}`);
    }
  }

  /**
   * Create a default vector database
   * Uses JSON backend with persistence
   */
  async createDefault(storagePath?: string): Promise<IVectorDatabase> {
    return new JSONVectorDatabase({
      storagePath: storagePath || '.analyzer_cache',
      persist: true,
    });
  }
}
