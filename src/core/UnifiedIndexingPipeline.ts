import type {
  IContentSource,
  IndexedContent,
  ContentSourceConfig,
  ContentRelationship,
  IndexingStatistics,
} from '../interfaces/IContentSource';
import type { ContentSourceRegistry } from './ContentSourceRegistry';
import type { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import type { IVectorDatabase } from '../interfaces/IVectorDatabase';
import type { CodeVector } from '../models/CodeChunk';
import { createTreeLogger } from '../utils/logger';
import type { TreeLogger } from '../utils/treeLogger';

/**
 * Resultado da indexação unificada
 */
export interface UnifiedIndexingResult {
  /** Total de conteúdos indexados */
  totalContents: number;
  /** Total de vetores gerados */
  totalVectors: number;
  /** Fontes processadas */
  sources: string[];
  /** Relacionamentos detectados */
  relationships: number;
  /** Duração total em ms */
  durationMs: number;
  /** Estatísticas por fonte */
  sourceStats: Map<string, IndexingStatistics>;
  /** Erros por fonte */
  errors: Map<string, string[]>;
}

/**
 * Configuração do pipeline
 */
export interface UnifiedPipelineConfig {
  /** Delay entre operações de embedding (ms) */
  embeddingDelay?: number;
  /** Tamanho do batch para embeddings */
  embeddingBatchSize?: number;
  /** Se deve detectar relacionamentos entre fontes */
  detectRelationships?: boolean;
  /** Se deve continuar em caso de erro de uma fonte */
  continueOnSourceError?: boolean;
  /** Callback de progresso */
  onProgress?: (stage: string, current: number, total: number) => void;
}

/**
 * UnifiedIndexingPipeline
 *
 * Pipeline unificado para indexar múltiplas fontes de conteúdo.
 * Coordena os Content Sources, gera embeddings e armazena vetores.
 *
 * @example
 * ```typescript
 * const pipeline = new UnifiedIndexingPipeline(
 *   registry,
 *   embeddingProvider,
 *   vectorDatabase
 * );
 *
 * const result = await pipeline.indexAll([
 *   { type: 'repository', config: { path: './my-repo' } },
 *   { type: 'url', config: { urls: [...], tavilyApiKey: '...' } },
 * ]);
 * ```
 */
export class UnifiedIndexingPipeline {
  private log: TreeLogger;

  constructor(
    private registry: ContentSourceRegistry,
    private embeddingProvider: IEmbeddingProvider,
    private vectorDatabase: IVectorDatabase,
    private config: UnifiedPipelineConfig = {}
  ) {
    this.log = createTreeLogger({ component: 'UnifiedIndexingPipeline' }, { structuredLogger: false });
  }

  /**
   * Indexa todas as fontes configuradas
   */
  async indexAll(sources: ContentSourceConfig[]): Promise<UnifiedIndexingResult> {
    const startTime = Date.now();
    const allContents: IndexedContent[] = [];
    const sourceStats = new Map<string, IndexingStatistics>();
    const errors = new Map<string, string[]>();

    this.log.info(`Starting unified indexing with ${sources.length} sources...`);

    // Ordenar fontes por prioridade
    const sortedSources = [...sources].sort((a, b) =>
      (a.options?.priority || 0) - (b.options?.priority || 0)
    );

    // Filtrar fontes habilitadas
    const enabledSources = sortedSources.filter(s => s.options?.enabled !== false);

    if (enabledSources.length === 0) {
      this.log.warn('No enabled sources to index');
      return {
        totalContents: 0,
        totalVectors: 0,
        sources: [],
        relationships: 0,
        durationMs: Date.now() - startTime,
        sourceStats,
        errors,
      };
    }

    // Fase 1: Indexar cada fonte
    this.log.info(`Phase 1/3: Indexing ${enabledSources.length} content sources...`);

    for (let i = 0; i < enabledSources.length; i++) {
      const sourceConfig = enabledSources[i];
      const sourceName = `${sourceConfig.type}:${i}`;

      this.config.onProgress?.('indexing', i + 1, enabledSources.length);

      try {
        const contents = await this.indexSource(sourceConfig);
        allContents.push(...contents);

        // Obter estatísticas da fonte
        const source = this.registry.get(sourceConfig.type);
        if (source) {
          const stats = source.getStatistics();
          if (stats) {
            sourceStats.set(sourceName, stats);
          }
        }

        this.log.success(`Indexed ${contents.length} items from ${sourceConfig.type}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.error(`Failed to index ${sourceConfig.type}: ${errorMessage}`);

        errors.set(sourceName, [errorMessage]);

        if (!this.config.continueOnSourceError) {
          throw error;
        }
      }
    }

    if (allContents.length === 0) {
      this.log.warn('No content was indexed from any source');
      return {
        totalContents: 0,
        totalVectors: 0,
        sources: enabledSources.map(s => s.type),
        relationships: 0,
        durationMs: Date.now() - startTime,
        sourceStats,
        errors,
      };
    }

    // Fase 2: Detectar relacionamentos cross-source
    let relationships: ContentRelationship[] = [];
    if (this.config.detectRelationships !== false) {
      this.log.info('Phase 2/3: Detecting cross-source relationships...');
      relationships = this.detectRelationships(allContents);
      this.log.success(`Detected ${relationships.length} relationships`);
    } else {
      this.log.info('Phase 2/3: Skipping relationship detection (disabled)');
    }

    // Fase 3: Gerar embeddings e armazenar vetores
    this.log.info('Phase 3/3: Generating embeddings and storing vectors...');
    const vectors = await this.generateAndStoreVectors(allContents);

    const result: UnifiedIndexingResult = {
      totalContents: allContents.length,
      totalVectors: vectors.length,
      sources: enabledSources.map(s => s.type),
      relationships: relationships.length,
      durationMs: Date.now() - startTime,
      sourceStats,
      errors,
    };

    this.log.success(
      `Unified indexing complete! ${result.totalContents} contents, ` +
      `${result.totalVectors} vectors in ${(result.durationMs / 1000).toFixed(2)}s`
    );

    return result;
  }

  /**
   * Indexa uma única fonte
   */
  async indexSource(sourceConfig: ContentSourceConfig): Promise<IndexedContent[]> {
    const source = this.registry.get(sourceConfig.type);

    if (!source) {
      throw new Error(
        `Content source '${sourceConfig.type}' not found. ` +
        `Available: ${this.registry.listNames().join(', ')}`
      );
    }

    // Validar configuração
    const validation = await source.validate(sourceConfig.config);
    if (!validation.valid) {
      throw new Error(`Invalid configuration for ${sourceConfig.type}: ${validation.error}`);
    }

    if (validation.warnings) {
      for (const warning of validation.warnings) {
        this.log.warn(`${sourceConfig.type}: ${warning}`);
      }
    }

    // Indexar
    return source.index(sourceConfig.config);
  }

  /**
   * Detecta relacionamentos entre conteúdos de diferentes fontes
   * Otimizado com índices para evitar busca O(n²)
   */
  private detectRelationships(contents: IndexedContent[]): ContentRelationship[] {
    const relationships: ContentRelationship[] = [];

    // Agrupar conteúdos por tipo de fonte
    const contentsBySource = new Map<string, IndexedContent[]>();
    for (const content of contents) {
      const sourceType = content.metadata.sourceType;
      if (!contentsBySource.has(sourceType)) {
        contentsBySource.set(sourceType, []);
      }
      contentsBySource.get(sourceType)!.push(content);
    }

    // Criar índice de código por path para lookup O(1)
    const codeContents = contentsBySource.get('code') || [];
    const codeByPath = new Map<string, IndexedContent>();
    const codeByFileName = new Map<string, IndexedContent[]>();
    for (const code of codeContents) {
      const originPath = code.metadata.origin.path;
      if (originPath) {
        codeByPath.set(originPath, code);
        // Também indexar por nome do arquivo para matches parciais
        const fileName = originPath.split('/').pop() || originPath;
        if (!codeByFileName.has(fileName)) {
          codeByFileName.set(fileName, []);
        }
        codeByFileName.get(fileName)!.push(code);
      }
    }

    // Detectar referências de código em conteúdos não-código
    const nonCodeContents = contents.filter(c => c.metadata.sourceType !== 'code');
    for (const content of nonCodeContents) {
      const refs = this.extractCodeReferences(content.content);
      for (const ref of refs) {
        const relatedCode = this.findCodeContentOptimized(codeByPath, codeByFileName, ref);
        if (relatedCode) {
          relationships.push({
            sourceId: content.id,
            targetId: relatedCode.id,
            type: 'discusses',
            strength: 0.8,
          });
        }
      }
    }

    // Criar índice de URLs para lookup O(1)
    const urlContents = contentsBySource.get('url') || [];
    const urlByUrl = new Map<string, IndexedContent>();
    const urlBySourceId = new Map<string, IndexedContent>();
    for (const url of urlContents) {
      if (url.metadata.origin.url) {
        urlByUrl.set(url.metadata.origin.url, url);
      }
      if (url.metadata.sourceId) {
        urlBySourceId.set(url.metadata.sourceId, url);
      }
    }

    // Detectar referências de URLs em outros conteúdos
    for (const content of contents) {
      if (content.metadata.sourceType === 'url') continue;

      const urlRefs = this.extractUrlReferences(content.content);
      for (const urlRef of urlRefs) {
        const relatedUrl = urlByUrl.get(urlRef) || urlBySourceId.get(urlRef);
        if (relatedUrl) {
          relationships.push({
            sourceId: content.id,
            targetId: relatedUrl.id,
            type: 'references',
            strength: 0.7,
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Extrai referências a código de um texto
   */
  private extractCodeReferences(text: string): string[] {
    const patterns = [
      /([a-zA-Z0-9_/-]+\.(ts|tsx|js|jsx|py|java|go|rs|cpp|c|h))/g,
      /`([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)`/g, // backtick references
    ];

    const refs = new Set<string>();
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        refs.add(match[1]);
      }
    }

    return Array.from(refs);
  }

  /**
   * Extrai referências de URLs de um texto
   */
  private extractUrlReferences(text: string): string[] {
    const pattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    const matches = text.match(pattern);
    return matches ? [...new Set(matches)] : [];
  }

  /**
   * Encontra conteúdo de código por referência usando índices
   * Lookup O(1) ao invés de O(n)
   */
  private findCodeContentOptimized(
    codeByPath: Map<string, IndexedContent>,
    codeByFileName: Map<string, IndexedContent[]>,
    ref: string
  ): IndexedContent | undefined {
    // Tentar match exato por path
    if (codeByPath.has(ref)) {
      return codeByPath.get(ref);
    }

    // Tentar match por nome de arquivo
    const fileName = ref.split('/').pop() || ref;
    const candidates = codeByFileName.get(fileName);
    if (candidates && candidates.length > 0) {
      // Se há candidatos, retornar o primeiro que contém a referência
      return candidates.find(c => c.metadata.origin.path?.includes(ref)) || candidates[0];
    }

    return undefined;
  }

  /**
   * Gera embeddings e armazena vetores
   */
  private async generateAndStoreVectors(contents: IndexedContent[]): Promise<CodeVector[]> {
    const vectors: CodeVector[] = [];
    const batchSize = this.config.embeddingBatchSize || 10;
    const delay = this.config.embeddingDelay || 100;

    // Inicializar vector database
    await this.vectorDatabase.initialize('unified-index');

    // Processar em batches
    for (let i = 0; i < contents.length; i += batchSize) {
      const batch = contents.slice(i, i + batchSize);
      const texts = batch.map(c => c.content);

      this.config.onProgress?.('embedding', i + batch.length, contents.length);

      try {
        // Gerar embeddings para o batch
        const embeddings = await this.embeddingProvider.embedBatch(texts);

        // Criar vetores
        for (let j = 0; j < batch.length; j++) {
          const content = batch[j];
          const embedding = embeddings[j];

          const vector: CodeVector = {
            id: content.id,
            filePath: content.metadata.origin.path || content.metadata.sourceId,
            content: content.content,
            embedding,
            metadata: {
              startLine: (content.metadata.customMetadata?.startLine as number) || 0,
              endLine: (content.metadata.customMetadata?.endLine as number) || 0,
              astNode: content.metadata.customMetadata?.astNode as string,
              language: content.metadata.language || 'text',
              chunkId: content.id,
              fileType: content.metadata.contentType,
              directory: content.metadata.origin.path
                ? content.metadata.origin.path.split('/').slice(0, -1).join('/')
                : '',
              characteristics: (content.metadata.customMetadata?.characteristics as Record<string, unknown>) || {},
              // Metadados unificados
              sourceType: content.metadata.sourceType,
              sourceId: content.metadata.sourceId,
              title: content.metadata.title,
              author: content.metadata.author,
              origin: content.metadata.origin as unknown as Record<string, unknown>,
            },
          };

          vectors.push(vector);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.error(`Failed to generate embeddings for batch: ${errorMessage}`);
        // Continuar com próximo batch
      }

      // Delay para evitar rate limiting
      if (delay > 0 && i + batchSize < contents.length) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Progress update
      if ((i + batchSize) % 50 === 0 || i + batchSize >= contents.length) {
        this.log.progress(
          Math.min(i + batchSize, contents.length),
          contents.length,
          'Generating embeddings'
        );
      }
    }

    this.log.progressComplete();

    // Armazenar vetores no banco
    if (vectors.length > 0) {
      await this.vectorDatabase.upsertBatch(vectors);
      this.log.success(`Stored ${vectors.length} vectors in database`);
    }

    return vectors;
  }

  /**
   * Limpa todos os dados indexados
   */
  async clear(): Promise<void> {
    await this.vectorDatabase.clear();
    this.log.info('Cleared all indexed data');
  }
}
