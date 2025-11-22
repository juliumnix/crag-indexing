import type {
  IContentSource,
  ContentSourceConfig,
  ValidationResult,
} from '../interfaces/IContentSource';
import { createTreeLogger } from '../utils/logger';
import type { TreeLogger } from '../utils/treeLogger';

/**
 * Resultado de registro de um content source
 */
export interface RegistrationResult {
  success: boolean;
  error?: string;
}

/**
 * Informações sobre um source registrado
 */
export interface RegisteredSourceInfo {
  name: string;
  version: string;
  description: string;
  healthy: boolean;
  lastHealthCheck?: Date;
}

/**
 * ContentSourceRegistry
 *
 * Registro central para gerenciar Content Source Plugins.
 * Permite registrar, obter e listar sources disponíveis.
 *
 * @example
 * ```typescript
 * const registry = new ContentSourceRegistry();
 *
 * // Registrar plugins
 * registry.register(new RepositorySource());
 * registry.register(new SlackSource());
 * registry.register(new ConfluenceSource());
 *
 * // Usar um plugin
 * const repoSource = registry.get('repository');
 * if (repoSource) {
 *   const contents = await repoSource.index({ path: './my-repo' });
 * }
 * ```
 */
export class ContentSourceRegistry {
  private sources: Map<string, IContentSource> = new Map();
  private healthStatus: Map<string, { healthy: boolean; checkedAt: Date }> = new Map();
  private log: TreeLogger;

  constructor() {
    this.log = createTreeLogger({ component: 'ContentSourceRegistry' }, { structuredLogger: false });
  }

  /**
   * Registra um novo content source
   * @param source O plugin a ser registrado
   * @returns Resultado do registro
   */
  register(source: IContentSource): RegistrationResult {
    if (!source.name) {
      return { success: false, error: 'Source must have a name' };
    }

    if (this.sources.has(source.name)) {
      const existing = this.sources.get(source.name)!;
      this.log.warn(
        `Overwriting existing source '${source.name}' v${existing.version} with v${source.version}`
      );
    }

    this.sources.set(source.name, source);
    this.log.info(`Registered content source: ${source.name} v${source.version}`);

    return { success: true };
  }

  /**
   * Registra múltiplos content sources
   * @param sources Array de plugins a serem registrados
   * @returns Array de resultados
   */
  registerAll(sources: IContentSource[]): RegistrationResult[] {
    return sources.map(source => this.register(source));
  }

  /**
   * Remove um content source do registro
   * @param name Nome do source a ser removido
   * @returns true se removido, false se não existia
   */
  unregister(name: string): boolean {
    const removed = this.sources.delete(name);
    if (removed) {
      this.healthStatus.delete(name);
      this.log.info(`Unregistered content source: ${name}`);
    }
    return removed;
  }

  /**
   * Obtém um content source pelo nome
   * @param name Nome do source
   * @returns O source ou undefined se não encontrado
   */
  get(name: string): IContentSource | undefined {
    return this.sources.get(name);
  }

  /**
   * Obtém um content source, lançando erro se não encontrado
   * @param name Nome do source
   * @returns O source
   * @throws Error se source não encontrado
   */
  getOrThrow(name: string): IContentSource {
    const source = this.sources.get(name);
    if (!source) {
      throw new Error(`Content source '${name}' not found. Available sources: ${this.listNames().join(', ')}`);
    }
    return source;
  }

  /**
   * Verifica se um source está registrado
   * @param name Nome do source
   * @returns true se registrado
   */
  has(name: string): boolean {
    return this.sources.has(name);
  }

  /**
   * Lista todos os sources registrados
   * @returns Array de content sources
   */
  list(): IContentSource[] {
    return Array.from(this.sources.values());
  }

  /**
   * Lista nomes de todos os sources registrados
   * @returns Array de nomes
   */
  listNames(): string[] {
    return Array.from(this.sources.keys());
  }

  /**
   * Obtém informações sobre todos os sources registrados
   * @returns Array com informações dos sources
   */
  listInfo(): RegisteredSourceInfo[] {
    return this.list().map(source => ({
      name: source.name,
      version: source.version,
      description: source.description,
      healthy: this.healthStatus.get(source.name)?.healthy ?? true,
      lastHealthCheck: this.healthStatus.get(source.name)?.checkedAt,
    }));
  }

  /**
   * Verifica se um source está disponível e saudável
   * @param name Nome do source
   * @returns true se disponível e saudável
   */
  async isAvailable(name: string): Promise<boolean> {
    const source = this.sources.get(name);
    if (!source) {
      return false;
    }

    try {
      const healthy = await source.healthCheck();
      this.healthStatus.set(name, { healthy, checkedAt: new Date() });
      return healthy;
    } catch (error) {
      this.healthStatus.set(name, { healthy: false, checkedAt: new Date() });
      return false;
    }
  }

  /**
   * Executa health check em todos os sources
   * @returns Map de nome -> status de saúde
   */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [name, source] of this.sources) {
      try {
        const healthy = await source.healthCheck();
        results.set(name, healthy);
        this.healthStatus.set(name, { healthy, checkedAt: new Date() });
      } catch (error) {
        results.set(name, false);
        this.healthStatus.set(name, { healthy: false, checkedAt: new Date() });
      }
    }

    return results;
  }

  /**
   * Valida uma configuração para um source específico
   * @param sourceConfig Configuração a ser validada
   * @returns Resultado da validação
   */
  async validateConfig(sourceConfig: ContentSourceConfig): Promise<ValidationResult> {
    const source = this.sources.get(sourceConfig.type);

    if (!source) {
      return {
        valid: false,
        error: `Content source '${sourceConfig.type}' not found. Available: ${this.listNames().join(', ')}`,
      };
    }

    // Verificar se source está habilitado
    if (sourceConfig.options?.enabled === false) {
      return {
        valid: true,
        warnings: ['Source is disabled and will be skipped'],
      };
    }

    return source.validate(sourceConfig.config);
  }

  /**
   * Valida múltiplas configurações
   * @param configs Array de configurações
   * @returns Map de tipo -> resultado de validação
   */
  async validateConfigs(configs: ContentSourceConfig[]): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();

    for (const config of configs) {
      const key = `${config.type}:${JSON.stringify(config.config).substring(0, 50)}`;
      results.set(key, await this.validateConfig(config));
    }

    return results;
  }

  /**
   * Número de sources registrados
   */
  get size(): number {
    return this.sources.size;
  }

  /**
   * Limpa todos os sources registrados
   */
  clear(): void {
    this.sources.clear();
    this.healthStatus.clear();
    this.log.info('Cleared all registered content sources');
  }
}
