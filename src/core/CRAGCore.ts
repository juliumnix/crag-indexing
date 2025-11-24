import * as path from 'path';
import * as fs from 'fs';
import type { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import type { IVectorDatabase } from '../interfaces/IVectorDatabase';
import type { EmbeddingProviderConfig } from '../interfaces/IEmbeddingProvider';
import type { VectorDatabaseConfig } from '../interfaces/IVectorDatabase';
import type { IndexedRepository, IndexingConfig } from '../model/IndexedRepository';
import type { RAGQuery, SemanticSearchResult } from '../model/RAGQuery';
import type { DependencyGraph } from '../model/FileMetadata';
import type { EndorsementConfig } from '../endorsement/types';
import type { ContextBudgetOptions } from '../model/RAGQuery';
import type { IContentSource, ContentSourceConfig } from '../interfaces/IContentSource';
import { RepositoryIndexer } from './RepositoryIndexer';
import { ContentSourceRegistry } from './ContentSourceRegistry';
import { UnifiedIndexingPipeline, type UnifiedIndexingResult } from './UnifiedIndexingPipeline';
import { EmbeddingProviderFactory } from '../services/embeddings/EmbeddingProviderFactory';
import { VectorDatabaseFactory } from '../backends/VectorDatabaseFactory';
import { EndorsementEngine } from '../endorsement/EndorsementEngine';
import { VersionEngine } from '../versioning/VersionEngine';
import { ContextBudgetManager } from '../context/ContextBudgetManager';
import { Inspector } from '../observability/Inspector';
import { ConflictDetector } from '../conflict/ConflictDetector';
import { DeprecationTracker } from '../deprecation/DeprecationTracker';
import { URLIndexer } from '../services/url/URLIndexer';
import { RepositorySource } from '../sources/repository';
import { URLSource } from '../sources/url';
import { createTreeLogger } from '../utils/logger';
import type { TreeLogger } from '../utils/treeLogger';

/**
 * Configuração unificada para CodeRAG
 * Todas as configurações necessárias em um único objeto
 */
export interface CodeRAGConfig {
  /** Caminho do projeto a ser indexado */
  projectPath: string;

  /** ID único do projeto */
  projectId: string;

  /** Configuração do provider de embeddings */
  embedding: EmbeddingProviderConfig;

  /** Configuração do banco vetorial */
  vectorDatabase: VectorDatabaseConfig;

  /** Configurações de indexação (opcional) */
  indexing?: {
    /** Padrões de arquivos para incluir (glob patterns) */
    includePatterns?: string[];
    /** Diretórios para excluir */
    excludeDirectories?: string[];
    /** Detectar automaticamente o caminho de regras de negócio */
    detectBusinessRulesPath?: boolean;
    /** Construir grafo de dependências */
    buildDependencyGraph?: boolean;
    /** Estratégia de chunking: 'ast', 'sliding-window', ou 'semantic' */
    chunkingStrategy?: 'ast' | 'sliding-window' | 'semantic';
    /** Tamanho máximo do chunk em tokens */
    maxChunkSize?: number;
    /** Sobreposição entre chunks (para sliding-window) */
    chunkOverlap?: number;
    /** Delay em milissegundos entre processamento de arquivos */
    embeddingDelay?: number;
  };

  /** Configurações de armazenamento */
  storage?: {
    /** Caminho para salvar cache e índices */
    path?: string;
    /** Salvar índice em disco */
    persist?: boolean;
  };

  /** Configuração de endorsement (credibilidade de fontes) */
  endorsement?: EndorsementConfig;

  /** Configuração de versionamento */
  versioning?: {
    enabled: boolean;
    detectFromGit?: boolean;
  };

  /** Configuração de context budget */
  contextBudget?: {
    defaultMaxTokens?: number;
    defaultReservedTokens?: number;
  };

  /** Configuração de observabilidade */
  observability?: {
    enabled: boolean;
    traceStorage?: string;
  };

  /** Configuração para indexar URLs públicas (usando Tavily) */
  urlIndexing?: {
    /** Tavily API key */
    tavilyApiKey?: string;
    /** URLs públicas para indexar */
    urls?: string[];
    /** Diretório para salvar conteúdo extraído */
    storagePath?: string;
    /** Tempo de expiração do cache em meses (padrão: 3) */
    cacheExpirationMonths?: number;
  };

  /**
   * 🆕 Múltiplas fontes de conteúdo para indexar (nova arquitetura extensível)
   * Quando configurado, substitui urlIndexing e permite adicionar qualquer tipo de fonte
   */
  contentSources?: ContentSourceConfig[];

  /**
   * 🆕 Plugins de content sources customizados para registrar
   * Útil para adicionar fontes de dados customizadas (Slack, Confluence, Jira, etc.)
   */
  plugins?: IContentSource[];
}

/**
 * CodeRAG - API Simplificada
 * 
 * Classe principal que unifica todas as funcionalidades de indexação e busca
 * em uma interface simples com um único objeto de configuração.
 * 
 * @example
 * ```typescript
 * const rag = new CodeRAG({
 *   projectPath: '/path/to/project',
 *   projectId: 'my-project',
 *   embedding: {
 *     type: 'ollama',
 *     model: 'embeddinggemma',
 *     baseURL: 'http://localhost:11434'
 *   },
 *   vectorDatabase: {
 *     type: 'json',
 *     storagePath: '.crag_cache'
 *   }
 * });
 * 
 * await rag.index();
 * const results = await rag.query({ text: 'como fazer autenticação?' });
 * ```
 */
export class CRAGCore {
  private log: TreeLogger;
  private config: CodeRAGConfig;
  private indexer: RepositoryIndexer | null = null;
  private embeddingProvider: IEmbeddingProvider | null = null;
  private vectorDatabase: IVectorDatabase | null = null;
  private endorsementEngine: EndorsementEngine | null = null;
  private versionEngine: VersionEngine | null = null;
  private contextManager: ContextBudgetManager | null = null;
  private inspector: Inspector | null = null;
  private conflictDetector: ConflictDetector | null = null;
  private deprecationTracker: DeprecationTracker | null = null;

  // 🆕 Nova arquitetura extensível
  private registry: ContentSourceRegistry;
  private unifiedPipeline: UnifiedIndexingPipeline | null = null;

  constructor(config: CodeRAGConfig) {
    this.log = createTreeLogger({ component: 'CodeRAG' }, { structuredLogger: false });
    this.config = config;

    // 🆕 Initialize content source registry with built-in sources
    this.registry = new ContentSourceRegistry();
    this.registry.register(new RepositorySource());
    this.registry.register(new URLSource());

    // Register custom plugins if provided
    if (config.plugins) {
      for (const plugin of config.plugins) {
        this.registry.register(plugin);
      }
    }

    // Initialize endorsement engine if configured
    if (config.endorsement) {
      // Resolve feedbackStoragePath relative to projectPath if it's a relative path
      const endorsementConfig = { ...config.endorsement };
      if (endorsementConfig.feedbackStoragePath && !path.isAbsolute(endorsementConfig.feedbackStoragePath)) {
        endorsementConfig.feedbackStoragePath = path.join(config.projectPath, endorsementConfig.feedbackStoragePath);
      }
      this.endorsementEngine = new EndorsementEngine(endorsementConfig);
    }

    // Initialize version engine if configured
    if (config.versioning?.enabled) {
      this.versionEngine = new VersionEngine(config.projectPath);
      this.versionEngine.loadBreakingChanges();
    }

    // Initialize context budget manager
    this.contextManager = new ContextBudgetManager();

    // Initialize inspector if configured
    if (config.observability?.enabled) {
      this.inspector = new Inspector();
    }

    // Initialize conflict detector
    this.conflictDetector = new ConflictDetector();

    // Initialize deprecation tracker
    this.deprecationTracker = new DeprecationTracker(config.projectPath);
  }

  /**
   * Indexa URLs públicas usando Tavily (se configurado)
   */
  async indexURLs(): Promise<Array<{ url: string; filePath: string; cached: boolean }>> {
    if (!this.config.urlIndexing?.urls || this.config.urlIndexing.urls.length === 0) {
      this.log.info('No URLs configured for indexing');
      return [];
    }

    if (!this.config.urlIndexing.tavilyApiKey) {
      throw new Error('Tavily API key is required for URL indexing. Set urlIndexing.tavilyApiKey in config.');
    }

    // Resolve storage path: if relative, resolve from projectPath; if absolute, use as is
    let storagePath: string;
    if (this.config.urlIndexing.storagePath) {
      if (path.isAbsolute(this.config.urlIndexing.storagePath)) {
        storagePath = this.config.urlIndexing.storagePath;
      } else {
        // Relative path - resolve from projectPath
        storagePath = path.resolve(this.config.projectPath, this.config.urlIndexing.storagePath);
      }
    } else {
      // Default: .crag/urls inside projectPath
      storagePath = path.resolve(this.config.projectPath, '.crag', 'urls');
    }

    const urlIndexer = new URLIndexer({
      tavilyApiKey: this.config.urlIndexing.tavilyApiKey,
      storagePath,
      cacheExpirationMonths: this.config.urlIndexing.cacheExpirationMonths,
    });

    this.log.info(`Indexing ${this.config.urlIndexing.urls.length} URLs...`);
    const indexed = await urlIndexer.index(this.config.urlIndexing.urls);
    
    this.log.success(`Indexed ${indexed.length} URLs to ${storagePath}`);
    return indexed;
  }

  /**
   * 🆕 Indexa todas as fontes configuradas usando a nova arquitetura extensível
   *
   * Este método usa o UnifiedIndexingPipeline para indexar múltiplas fontes
   * de conteúdo de forma unificada.
   *
   * @example
   * ```typescript
   * const rag = new CRAGCore({
   *   projectPath: './my-project',
   *   projectId: 'my-project',
   *   embedding: { type: 'ollama', model: 'embeddinggemma' },
   *   vectorDatabase: { type: 'json', storagePath: '.crag_cache' },
   *   contentSources: [
   *     { type: 'repository', config: { path: './my-project' } },
   *     { type: 'url', config: { urls: [...], tavilyApiKey: '...' } },
   *   ],
   * });
   *
   * const result = await rag.indexAll();
   * ```
   */
  async indexAll(): Promise<UnifiedIndexingResult> {
    // Inicializar providers
    await this.initializeProviders();

    // Construir lista de sources
    const sources: ContentSourceConfig[] = [];

    // Se contentSources está configurado, usar nova arquitetura
    if (this.config.contentSources && this.config.contentSources.length > 0) {
      sources.push(...this.config.contentSources);
    } else {
      // Fallback: converter config legada para nova arquitetura

      // Adicionar repositório principal
      sources.push({
        type: 'repository',
        config: {
          path: this.config.projectPath,
          excludeDirectories: this.config.indexing?.excludeDirectories,
          includePatterns: this.config.indexing?.includePatterns,
          chunkingStrategy: this.config.indexing?.chunkingStrategy,
          maxChunkSize: this.config.indexing?.maxChunkSize,
          chunkOverlap: this.config.indexing?.chunkOverlap,
        },
        options: { priority: 0 },
      });

      // Adicionar URLs se configurado
      if (this.config.urlIndexing?.urls && this.config.urlIndexing.urls.length > 0) {
        sources.push({
          type: 'url',
          config: {
            tavilyApiKey: this.config.urlIndexing.tavilyApiKey,
            urls: this.config.urlIndexing.urls,
            storagePath: this.config.urlIndexing.storagePath
              ? path.resolve(this.config.projectPath, this.config.urlIndexing.storagePath)
              : path.resolve(this.config.projectPath, '.crag', 'urls'),
            cacheExpirationMonths: this.config.urlIndexing.cacheExpirationMonths,
          },
          options: { priority: 1 },
        });
      }
    }

    if (sources.length === 0) {
      throw new Error('No content sources configured');
    }

    // Criar pipeline unificado
    this.unifiedPipeline = new UnifiedIndexingPipeline(
      this.registry,
      this.embeddingProvider!,
      this.vectorDatabase!,
      {
        embeddingDelay: this.config.indexing?.embeddingDelay || 100,
        detectRelationships: true,
        continueOnSourceError: true,
      }
    );

    this.log.info(`Starting unified indexing with ${sources.length} sources...`);
    return this.unifiedPipeline.indexAll(sources);
  }

  /**
   * 🆕 Obtém o registry de content sources
   * Útil para registrar plugins customizados em runtime
   */
  getRegistry(): ContentSourceRegistry {
    return this.registry;
  }

  /**
   * 🆕 Lista os content sources disponíveis
   */
  listAvailableSources(): string[] {
    return this.registry.listNames();
  }

  /**
   * Indexa o repositório
   * Cria embeddings e armazena no banco vetorial
   *
   * @deprecated Use indexAll() para a nova arquitetura extensível
   */
  async index(): Promise<IndexedRepository> {
    // Verificar se projectPath existe
    const resolvedProjectPath = path.resolve(this.config.projectPath);
    if (!fs.existsSync(resolvedProjectPath)) {
      throw new Error(`Project path does not exist: ${resolvedProjectPath}`);
    }

    // Indexar URLs primeiro (se configurado)
    if (this.config.urlIndexing?.urls && this.config.urlIndexing.urls.length > 0) {
      await this.indexURLs();
    }

    // Inicializar providers se ainda não foram inicializados
    await this.initializeProviders();

    // Criar indexador se ainda não foi criado
    if (!this.indexer) {
      this.indexer = new RepositoryIndexer({
        projectPath: this.config.projectPath,
        projectId: this.config.projectId,
        embeddingProvider: this.embeddingProvider!,
        vectorDatabase: this.vectorDatabase!,
        storagePath: this.config.storage?.path || '.crag_cache',
      });
    }

    // Preparar configuração de indexação
    const indexingConfig: IndexingConfig = {
      includePatterns: this.config.indexing?.includePatterns,
      excludeDirectories: this.config.indexing?.excludeDirectories,
      detectBusinessRulesPath: this.config.indexing?.detectBusinessRulesPath,
      buildDependencyGraph: this.config.indexing?.buildDependencyGraph,
      chunkingStrategy: this.config.indexing?.chunkingStrategy,
      maxChunkSize: this.config.indexing?.maxChunkSize,
      chunkOverlap: this.config.indexing?.chunkOverlap,
      embeddingDelay: this.config.indexing?.embeddingDelay,
      persist: this.config.storage?.persist,
      storagePath: this.config.storage?.path,
      // Se há URL indexing, incluir arquivos Markdown para indexar conteúdo das URLs
      includeMarkdown: this.config.urlIndexing?.urls && this.config.urlIndexing.urls.length > 0,
    };

    return await this.indexer.index(indexingConfig);
  }

  /**
   * Busca semântica no código indexado
   */
  async query(query: RAGQuery): Promise<SemanticSearchResult[]> {
    // Start trace if observability enabled
    const trace = this.inspector?.startTrace(query.text);

    try {
      // Inicializar providers se necessário
      await this.initializeProviders();

      // Criar indexador se ainda não foi criado (pode ter sido carregado)
      if (!this.indexer) {
        // Tentar carregar repositório existente
        const repository = await this.load();
        if (!repository) {
          throw new Error('Repositório não indexado. Chame index() primeiro.');
        }
      }

      // Busca semântica normal
      let results = await this.indexer!.query(query);
      if (trace) {
        this.inspector!.recordStage(trace.id, {
          name: 'vector-search',
          duration: 0, // TODO: measure actual duration
          input: { topK: query.topK },
          output: { candidates: results.length },
          metadata: {},
        });
      }

      // Aplicar version filtering se habilitado
      if (this.versionEngine && query.version) {
        const targetVersion = this.versionEngine
          .getVersionDetector()
          .parseVersion(query.version.target);

        if (targetVersion) {
          results = results.filter(r => {
            const chunkVersion = (r.metadata as any).versionContext?.version;
            if (!chunkVersion) return true; // No version = include

            const comparison = this.versionEngine!
              .getVersionDetector()
              .compare(chunkVersion, targetVersion);

            if (comparison === 0) return true; // Exact match
            if (comparison > 0 && query.version!.includeNewer) return true;
            if (comparison < 0 && query.version!.includeOlder) return true;

            return false;
          });

          // Add breaking changes if requested
          if (query.version.includeBreakingChanges) {
            const changes = this.versionEngine.getBreakingChanges(targetVersion);
            if (changes.length > 0) {
              const breakingChangeText = this.versionEngine.formatBreakingChanges(changes);
              results.unshift({
                filePath: 'breaking-changes',
                content: breakingChangeText,
                similarity: 1.0,
                metadata: {
                  type: 'breaking-changes',
                  startLine: 1,
                  endLine: 1,
                  language: 'markdown',
                },
              } as SemanticSearchResult);
            }
          }
        }
      }

      // Aplicar endorsement reranking se habilitado
      if (this.endorsementEngine && query.endorsement?.enabled) {
        const endorsed = this.endorsementEngine.rerank(results);

        // Filtrar por credibilidade mínima se especificado
        const minCred = query.endorsement.minCredibility || 0;
        const filtered = endorsed.filter(r => r.credibilityScore >= minCred);

        // Converter para SemanticSearchResult
        results = filtered.map(r => ({
          filePath: r.chunk.filePath,
          content: r.chunk.content,
          similarity: r.embeddingScore,
          metadata: r.chunk.metadata,
          embeddingScore: r.embeddingScore,
          credibilityScore: r.credibilityScore,
          finalRelevance: r.finalRelevance,
          explanation: r.explanation,
        }));
      }

      // Aplicar context budget optimization se habilitado
      if (this.contextManager && query.contextBudget) {
        const budget = {
          maxTokens: query.contextBudget.maxTokens,
          reservedTokens: query.contextBudget.reservedTokens,
          availableTokens:
            query.contextBudget.maxTokens - query.contextBudget.reservedTokens,
          deduplication: query.contextBudget.deduplication ?? true,
          prioritizeRecent: query.contextBudget.prioritizeRecent ?? true,
        };

        const optimized = this.contextManager.optimize(results, budget);
        const totalTokens = optimized.reduce((sum, r) => sum + r.tokenCount, 0);

        results = optimized.map(r => ({
          ...r,
          usedTokens: totalTokens,
        }));
      }

      // Detectar conflitos se habilitado
      if (this.conflictDetector && query.detectConflicts) {
        const conflicts = this.conflictDetector.detectConflicts(results);
        results = results.map(r => {
          const relatedConflicts = conflicts.filter(c =>
            c.sources.some(s => s.chunkId === r.metadata.chunkId)
          );
          if (relatedConflicts.length > 0) {
            return {
              ...r,
              conflicts: relatedConflicts.map(c => ({
                level: c.level,
                title: c.title,
                description: c.description,
              })),
            };
          }
          return r;
        });
      }

      // Adicionar avisos de deprecação
      if (this.deprecationTracker) {
        results = this.deprecationTracker.addWarnings(results);
      }

      if (trace) {
        trace.chunksReturned = results.length;
        trace.chunksRetrieved = results.length;
        this.inspector!.endTrace(trace.id);
      }

      return results;
    } catch (error) {
      if (trace) {
        this.inspector!.endTrace(trace.id);
      }
      throw error;
    }
  }

  /**
   * Fornece feedback sobre um resultado
   */
  async provideFeedback(
    resultId: string,
    feedback: { positive: boolean; comment?: string }
  ): Promise<void> {
    if (!this.endorsementEngine) {
      throw new Error('Endorsement engine not enabled');
    }

    this.endorsementEngine.recordFeedback(resultId, feedback.positive);
  }

  /**
   * Carrega um repositório previamente indexado
   */
  async load(): Promise<IndexedRepository | null> {
    await this.initializeProviders();

    if (!this.indexer) {
      this.indexer = new RepositoryIndexer({
        projectPath: this.config.projectPath,
        projectId: this.config.projectId,
        embeddingProvider: this.embeddingProvider!,
        vectorDatabase: this.vectorDatabase!,
        storagePath: this.config.storage?.path || '.crag_cache',
      });
    }

    return await this.indexer.load();
  }

  /**
   * Obtém o grafo de dependências
   */
  getDependencyGraph(): DependencyGraph | null {
    if (!this.indexer) {
      return null;
    }
    return this.indexer.getDependencyGraph();
  }

  /**
   * Obtém o repositório indexado atual
   */
  getRepository(): IndexedRepository | null {
    if (!this.indexer) {
      return null;
    }
    return this.indexer.getRepository();
  }

  /**
   * Limpa todos os dados indexados
   */
  async clear(): Promise<void> {
    if (this.indexer) {
      await this.indexer.clear();
    }
  }

  /**
   * Fecha conexões e libera recursos
   */
  async close(): Promise<void> {
    if (this.vectorDatabase) {
      await this.vectorDatabase.close();
    }
  }

  /**
   * Inicializa os providers de embedding e banco vetorial
   */
  private async initializeProviders(): Promise<void> {
    // Inicializar embedding provider
    if (!this.embeddingProvider) {
      const embeddingFactory = new EmbeddingProviderFactory();
      this.embeddingProvider = await embeddingFactory.create(this.config.embedding);
      this.log.info(`Embedding provider inicializado: ${this.embeddingProvider.name}`);
    }

    // Inicializar vector database
    if (!this.vectorDatabase) {
      const vectorFactory = new VectorDatabaseFactory();
      
      // Usar storagePath da config se disponível
      const vectorConfig: VectorDatabaseConfig = {
        ...this.config.vectorDatabase,
        storagePath: this.config.vectorDatabase.storagePath || 
                     this.config.storage?.path || 
                     '.crag_cache',
      };

      this.vectorDatabase = await vectorFactory.create(vectorConfig);
      await this.vectorDatabase.initialize(this.config.projectId);
      this.log.info(`Vector database inicializado: ${this.vectorDatabase.name}`);
    }
  }
}

