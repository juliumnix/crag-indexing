/**
 * IContentSource - Interface base para Content Source Plugins
 *
 * Esta interface define o contrato que qualquer fonte de conteúdo deve implementar
 * para ser plugável no sistema de indexação.
 */

/**
 * Resultado de validação de configuração
 */
export interface ValidationResult {
  /** Se a configuração é válida */
  valid: boolean;
  /** Mensagem de erro se inválida */
  error?: string;
  /** Warnings (configuração válida mas com ressalvas) */
  warnings?: string[];
}

/**
 * Relacionamento entre conteúdos de diferentes fontes
 */
export interface ContentRelationship {
  /** ID do conteúdo de origem */
  sourceId: string;
  /** ID do conteúdo de destino */
  targetId: string;
  /** Tipo do relacionamento */
  type: 'references' | 'implements' | 'discusses' | 'extends' | 'depends_on' | 'related';
  /** Força do relacionamento (0-1) */
  strength: number;
  /** Metadados adicionais do relacionamento */
  metadata?: Record<string, unknown>;
}

/**
 * Informações de origem do conteúdo
 */
export interface ContentOrigin {
  /** Tipo da origem (repository, slack-channel, url, confluence-space, etc.) */
  type: string;
  /** Caminho no repositório (se aplicável) */
  path?: string;
  /** URL original (se aplicável) */
  url?: string;
  /** Canal do Slack (se aplicável) */
  channel?: string;
  /** Repositório Git (se aplicável) */
  repo?: string;
  /** Branch (se aplicável) */
  branch?: string;
  /** Espaço do Confluence (se aplicável) */
  space?: string;
  /** Projeto do Jira (se aplicável) */
  project?: string;
}

/**
 * Metadata unificada para qualquer tipo de conteúdo
 */
export interface UnifiedContentMetadata {
  /** Tipo da fonte (code, slack, url, confluence, jira, notion, etc.) */
  sourceType: string;
  /** ID único na fonte original */
  sourceId: string;
  /** Tipo do conteúdo (file, message, thread, document, page, issue, etc.) */
  contentType: string;

  // Informações temporais
  /** Data de criação */
  createdAt: Date;
  /** Data de última atualização */
  updatedAt: Date;

  // Informações de autoria
  /** Nome do autor */
  author?: string;
  /** ID do autor na fonte original */
  authorId?: string;

  /** Informações de localização/origem */
  origin: ContentOrigin;

  /** Tags associadas */
  tags?: string[];
  /** Categorias */
  categories?: string[];
  /** Linguagem de programação (para código) */
  language?: string;
  /** Título do conteúdo */
  title?: string;

  /** Metadados específicos do tipo (flexível) */
  customMetadata?: Record<string, unknown>;
}

/**
 * Conteúdo indexado em formato unificado
 */
export interface IndexedContent {
  /** ID único do conteúdo */
  id: string;
  /** Texto/Markdown unificado */
  content: string;
  /** Metadata unificada */
  metadata: UnifiedContentMetadata;
  /** Relacionamentos com outros conteúdos */
  relationships?: ContentRelationship[];
  /** Embedding (opcional, será gerado depois) */
  embedding?: number[];
}

/**
 * Configuração base para qualquer content source
 */
export interface ContentSourceConfig {
  /** Tipo do source (deve estar registrado) */
  type: string;
  /** Configuração específica do tipo */
  config: Record<string, unknown>;
  /** Opções de indexação */
  options?: ContentSourceOptions;
}

/**
 * Opções de indexação
 */
export interface ContentSourceOptions {
  /** Se a fonte está habilitada */
  enabled?: boolean;
  /** Prioridade de indexação (menor = primeiro) */
  priority?: number;
  /** Filtros de inclusão/exclusão */
  filters?: {
    include?: string[];
    exclude?: string[];
  };
  /** Delay entre operações (ms) - útil para rate limiting */
  operationDelay?: number;
  /** Número máximo de itens para indexar (útil para testes) */
  maxItems?: number;
}

/**
 * Estatísticas de indexação
 */
export interface IndexingStatistics {
  /** Total de itens processados */
  totalProcessed: number;
  /** Itens indexados com sucesso */
  successCount: number;
  /** Itens com erro */
  errorCount: number;
  /** Itens pulados (cache, filtros, etc.) */
  skippedCount: number;
  /** Duração em ms */
  durationMs: number;
}

/**
 * Interface base para qualquer Content Source Plugin
 */
export interface IContentSource {
  /**
   * Nome único do source (ex: 'repository', 'slack', 'confluence', 'jira', 'notion')
   */
  readonly name: string;

  /**
   * Versão do plugin
   */
  readonly version: string;

  /**
   * Descrição do plugin
   */
  readonly description: string;

  /**
   * Indexa conteúdo da fonte
   * @param config Configuração específica do source
   * @returns Array de conteúdos indexados em formato unificado
   */
  index(config: Record<string, unknown>): Promise<IndexedContent[]>;

  /**
   * Valida configuração antes de indexar
   * @param config Configuração a ser validada
   * @returns Resultado da validação
   */
  validate(config: Record<string, unknown>): Promise<ValidationResult>;

  /**
   * Extrai metadata unificada de conteúdo bruto
   * @param rawContent Conteúdo bruto da fonte
   * @returns Metadata no formato unificado
   */
  extractMetadata(rawContent: unknown): UnifiedContentMetadata;

  /**
   * Extrai relacionamentos com outros conteúdos
   * @param rawContent Conteúdo bruto da fonte
   * @param existingContents Conteúdos já indexados (para detectar referências)
   * @returns Array de relacionamentos detectados
   */
  extractRelationships(
    rawContent: unknown,
    existingContents?: IndexedContent[]
  ): ContentRelationship[];

  /**
   * Health check da fonte
   * Verifica se a fonte está disponível e acessível
   * @returns true se saudável, false caso contrário
   */
  healthCheck(): Promise<boolean>;

  /**
   * Obtém estatísticas da última indexação
   * @returns Estatísticas ou null se nunca indexou
   */
  getStatistics(): IndexingStatistics | null;
}

/**
 * Interface para content sources que suportam indexação incremental
 */
export interface IIncrementalContentSource extends IContentSource {
  /**
   * Obtém apenas conteúdos atualizados desde uma data
   * @param since Data a partir da qual buscar atualizações
   * @param config Configuração do source
   * @returns Conteúdos atualizados
   */
  indexIncremental(
    since: Date,
    config: Record<string, unknown>
  ): Promise<IndexedContent[]>;

  /**
   * Suporta indexação incremental
   */
  readonly supportsIncremental: true;
}

/**
 * Interface para content sources que requerem autenticação
 */
export interface IAuthenticatedContentSource extends IContentSource {
  /**
   * Tipo de autenticação suportada
   */
  readonly authType: 'api-key' | 'oauth2' | 'basic' | 'saml' | 'token';

  /**
   * Autentica com a fonte
   * @param credentials Credenciais de autenticação
   * @returns true se autenticação bem-sucedida
   */
  authenticate(credentials: Record<string, unknown>): Promise<boolean>;

  /**
   * Verifica se está autenticado
   */
  isAuthenticated(): boolean;

  /**
   * Revoga autenticação
   */
  logout(): Promise<void>;
}
