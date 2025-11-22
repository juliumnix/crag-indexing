import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { IRepositoryIndexer, RepositoryIndexerConfig } from '../interfaces/IRepositoryIndexer';
import type { IndexedRepository, IndexingConfig, IndexingStats } from '../models/IndexedRepository';
import type { RAGQuery, SemanticSearchResult } from '../models/RAGQuery';
import type { DependencyGraph } from '../models/FileMetadata';
import type { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import type { IVectorDatabase } from '../interfaces/IVectorDatabase';
import type { IChunkingStrategy } from '../interfaces/IChunkingStrategy';
import type { CodeVector } from '../models/CodeChunk';
import { FileCollector } from '../services/FileCollector';
import { DependencyGraphBuilder } from '../services/DependencyGraphBuilder';
import { ASTChunkingStrategy } from '../services/chunking/ASTChunkingStrategy';
import { EmbeddingProviderFactory } from '../services/embeddings/EmbeddingProviderFactory';
import { VectorDatabaseFactory } from '../backends/VectorDatabaseFactory';
import { createTreeLogger } from '../utils/logger';
import type { TreeLogger } from '../utils/treeLogger';
import { inferLanguageFromFilePath } from '../utils/language';
import { extractCharacteristics } from '../utils/codeCharacteristics';

/**
 * RepositoryIndexer
 * Main orchestrator for repository indexing
 * Coordinates file collection, chunking, embedding, and vector storage
 */
export class RepositoryIndexer implements IRepositoryIndexer {
  private log: TreeLogger;
  private config: RepositoryIndexerConfig;
  private embeddingProvider: IEmbeddingProvider;
  private vectorDatabase: IVectorDatabase;
  private chunkingStrategy: IChunkingStrategy;
  private fileCollector: FileCollector;
  private graphBuilder: DependencyGraphBuilder;

  private currentRepository: IndexedRepository | null = null;

  constructor(config: RepositoryIndexerConfig) {
    this.log = createTreeLogger({ component: 'RepositoryIndexer' }, { structuredLogger: false });
    this.config = config;

    // Initialize services
    // FileCollector will be configured in index() method based on config
    this.fileCollector = new FileCollector();
    this.graphBuilder = new DependencyGraphBuilder();

    // Use provided or create default embedding provider
    if (config.embeddingProvider) {
      this.embeddingProvider = config.embeddingProvider;
    } else {
      // Will be initialized async in index()
      this.embeddingProvider = null as any;
    }

    // Use provided or create default vector database
    if (config.vectorDatabase) {
      this.vectorDatabase = config.vectorDatabase;
    } else {
      // Will be initialized async in index()
      this.vectorDatabase = null as any;
    }

    // Use provided or create default chunking strategy
    this.chunkingStrategy = config.chunkingStrategy || new ASTChunkingStrategy();
  }

  /**
   * Index a repository
   */
  async index(config?: IndexingConfig): Promise<IndexedRepository> {
    const startTime = Date.now();
    this.log.info(`Starting indexation of ${this.config.projectPath}...`);

    // Initialize embedding provider if not set
    if (!this.embeddingProvider) {
      const factory = new EmbeddingProviderFactory();
      this.embeddingProvider = await factory.createDefault();
      this.log.info(`Using default embedding provider: ${this.embeddingProvider.name}`);
    }

    // Initialize vector database if not set
    if (!this.vectorDatabase) {
      const factory = new VectorDatabaseFactory();
      this.vectorDatabase = await factory.createDefault(
        this.config.storagePath || '.analyzer_cache'
      );
      this.log.info(`Using default vector database: ${this.vectorDatabase.name}`);
    }

    // Initialize vector database with project ID
    await this.vectorDatabase.initialize(this.config.projectId);

    const effectiveConfig: Required<IndexingConfig> = {
      includePatterns: config?.includePatterns || [],
      excludeDirectories: config?.excludeDirectories || [],
      detectBusinessRulesPath: config?.detectBusinessRulesPath ?? false,
      buildDependencyGraph: config?.buildDependencyGraph ?? true,
      chunkingStrategy: config?.chunkingStrategy || 'ast',
      maxChunkSize: config?.maxChunkSize || 100,
      chunkOverlap: config?.chunkOverlap || 10,
      persist: config?.persist ?? true,
      storagePath: config?.storagePath || this.config.storagePath || '.analyzer_cache',
      embeddingDelay: config?.embeddingDelay || 100,
      includeMarkdown: config?.includeMarkdown ?? false,
    };

    // Configure FileCollector to include Markdown if needed
    if (effectiveConfig.includeMarkdown) {
      const { FileCollector, VALID_EXTENSIONS } = await import('../services/FileCollector');
      this.fileCollector = new FileCollector({
        validExtensions: [...VALID_EXTENSIONS, '.md', '.markdown'],
      });
      this.log.info('FileCollector configured to include Markdown files');
    }

    // Step 1: Collect files
    this.log.info('Step 1/5: Collecting files...');
    const collectionResult = await this.fileCollector.collect([this.config.projectPath]);

    this.log.success(
      `Collected ${collectionResult.stats.totalFiles} files ` +
      `(${collectionResult.stats.totalSkipped} skipped, ${collectionResult.stats.totalErrors} errors)`
    );

    if (collectionResult.files.length === 0) {
      throw new Error('No files found to index');
    }

    // Step 2: Build dependency graph (optional)
    let dependencyGraph: DependencyGraph | undefined;

    if (effectiveConfig.buildDependencyGraph) {
      this.log.info('Step 2/5: Building dependency graph...');
      dependencyGraph = await this.graphBuilder.build(collectionResult.files);
      this.log.success(`Built dependency graph with ${dependencyGraph.files.size} files`);
    } else {
      this.log.info('Step 2/5: Skipping dependency graph (disabled)');
    }

    // Step 3: Chunk files
    this.log.info('Step 3/5: Chunking files...');
    const allChunks: CodeVector[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < collectionResult.files.length; i++) {
      const filePath = collectionResult.files[i];

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const language = inferLanguageFromFilePath(filePath) || 'typescript';

        // Chunk the file
        const chunks = await this.chunkingStrategy.chunk(filePath, content, language);

        // Generate embeddings for each chunk
        for (const chunk of chunks) {
          try {
            // Validar tamanho do chunk antes de processar
            if (chunk.content.length > 100000) {
              this.log.warn(`Chunk muito grande (${chunk.content.length} chars) em ${path.basename(filePath)}:${chunk.startLine}, truncando...`);
              chunk.content = chunk.content.substring(0, 100000);
            }
            
            const embedding = await this.embeddingProvider.embed(chunk.content);

            const vector: CodeVector = {
              id: this.generateVectorId(chunk.id, filePath),
              filePath,
              content: chunk.content,
              embedding,
              metadata: {
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                astNode: chunk.astNode,
                language: chunk.language,
                chunkId: chunk.id,
                fileType: path.extname(filePath),
                directory: path.dirname(filePath),
                characteristics: extractCharacteristics(chunk.content),
              },
            };

            allChunks.push(vector);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log.error(`Failed to generate embedding for chunk ${chunk.id} in ${path.basename(filePath)}: ${errorMessage}`);
            // Continuar com próximo chunk ao invés de falhar completamente
            errorCount++;
          }
        }

        successCount++;
      } catch (error) {
        errorCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.log.error(`Failed to process ${path.basename(filePath)}: ${errorMessage}`);
      }

      // Add small delay to avoid overloading embedding provider (especially Ollama)
      const delayMs = effectiveConfig.embeddingDelay || 0;
      if (delayMs > 0 && i < collectionResult.files.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Progress update
      if ((i + 1) % 10 === 0 || i === collectionResult.files.length - 1) {
        this.log.progress(i + 1, collectionResult.files.length, 'Processing files');
      }
    }

    this.log.progressComplete();
    this.log.success(
      `Created ${allChunks.length} vectors from ${successCount} files (${errorCount} errors)`
    );

    // Step 4: Store vectors in database
    this.log.info('Step 4/5: Storing vectors in database...');
    await this.vectorDatabase.upsertBatch(allChunks);
    this.log.success(`Stored ${allChunks.length} vectors`);

    // Step 5: Create indexed repository metadata
    this.log.info('Step 5/5: Creating repository metadata...');

    const duration = Date.now() - startTime;
    const stats: IndexingStats = {
      duration,
      successCount,
      errorCount,
      totalLines: allChunks.reduce((sum, v) =>
        sum + (v.metadata.endLine - v.metadata.startLine + 1), 0
      ),
      embeddingProvider: this.embeddingProvider.name,
      vectorBackend: this.vectorDatabase.name,
      chunkingStrategy: this.chunkingStrategy.name,
    };

    const repository: IndexedRepository = {
      projectId: this.config.projectId,
      projectPath: this.config.projectPath,
      indexedAt: new Date(),
      totalFiles: collectionResult.files.length,
      totalChunks: allChunks.length,
      totalVectors: allChunks.length,
      files: dependencyGraph ? Array.from(dependencyGraph.files.values()) : [],
      dependencyGraph,
      stats,
    };

    this.currentRepository = repository;

    // Persist if requested
    if (effectiveConfig.persist) {
      await this.save(repository);
    }

    this.log.success(
      `Indexing complete! ${allChunks.length} vectors from ${collectionResult.files.length} files in ${(duration / 1000).toFixed(2)}s`
    );

    return repository;
  }

  /**
   * Query the indexed repository using RAG
   */
  async query(query: RAGQuery): Promise<SemanticSearchResult[]> {
    if (!this.vectorDatabase) {
      throw new Error('Vector database not initialized. Call index() first.');
    }

    // Generate embedding for query (isQuery=true para modelos que precisam de prefixo)
    const queryEmbedding = await this.embeddingProvider.embed(query.text, true);

    // Search vector database
    const topK = query.topK || 10;
    const results = await this.vectorDatabase.search(
      queryEmbedding,
      topK,
      query.filters
    );

    // Filter by minimum similarity if specified
    let filteredResults = results;
    if (query.minSimilarity !== undefined) {
      filteredResults = results.filter(r => r.similarity >= query.minSimilarity!);
    }

    return filteredResults;
  }

  /**
   * Save indexed repository to disk
   */
  async save(repository: IndexedRepository): Promise<void> {
    const storagePath = this.config.storagePath || '.analyzer_cache';
    const metadataPath = path.join(
      storagePath,
      'metadata',
      this.config.projectId,
      'repository.json'
    );

    // Ensure directory exists
    const dir = path.dirname(metadataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Save metadata
    const metadata = {
      ...repository,
      dependencyGraph: undefined, // Don't serialize the full graph (too large)
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    this.log.info(`Saved repository metadata to ${metadataPath}`);
  }

  /**
   * Load indexed repository from disk
   */
  async load(): Promise<IndexedRepository | null> {
    const storagePath = this.config.storagePath || '.analyzer_cache';
    const metadataPath = path.join(
      storagePath,
      'metadata',
      this.config.projectId,
      'repository.json'
    );

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(metadataPath, 'utf-8');
      const metadata = JSON.parse(content);

      // Convert date string back to Date
      metadata.indexedAt = new Date(metadata.indexedAt);

      this.currentRepository = metadata;
      this.log.info(`Loaded repository metadata from ${metadataPath}`);

      return metadata;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log.error(`Failed to load repository metadata: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Get dependency graph
   */
  getDependencyGraph(): DependencyGraph | null {
    return this.currentRepository?.dependencyGraph || null;
  }

  /**
   * Get current repository
   */
  getRepository(): IndexedRepository | null {
    return this.currentRepository;
  }

  /**
   * Clear all indexed data
   */
  async clear(): Promise<void> {
    if (this.vectorDatabase) {
      await this.vectorDatabase.clear();
    }
    this.currentRepository = null;
    this.log.info('Cleared all indexed data');
  }

  /**
   * Generate unique vector ID
   */
  private generateVectorId(chunkId: string, filePath: string): string {
    const hash = createHash('sha256')
      .update(`${filePath}:${chunkId}`)
      .digest('hex')
      .substring(0, 16);
    return `${this.config.projectId}:${chunkId}:${hash}`;
  }
}
