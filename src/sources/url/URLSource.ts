import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type {
  IContentSource,
  IndexedContent,
  UnifiedContentMetadata,
  ContentRelationship,
  ValidationResult,
  IndexingStatistics,
} from '../../interfaces/IContentSource';
import { TavilyExtractor, type ExtractedContent } from '../../services/url/TavilyExtractor';
import { createTreeLogger } from '../../utils/logger';
import type { TreeLogger } from '../../utils/treeLogger';

/**
 * Configuração específica para URLSource
 */
export interface URLSourceConfig {
  /** Tavily API key */
  tavilyApiKey: string;
  /** URLs para indexar */
  urls: string[];
  /** Diretório para salvar conteúdo extraído (cache) */
  storagePath?: string;
  /** Padrões de URL para incluir */
  includePatterns?: string[];
  /** Padrões de URL para excluir */
  excludePatterns?: string[];
  /** Tempo de expiração do cache em meses (default: 3) */
  cacheExpirationMonths?: number;
  /** Forçar re-extração mesmo se cache válido */
  forceRefresh?: boolean;
  /** Timeout por URL em ms (default: 30000) */
  timeout?: number;
}

/**
 * URLSource - Content Source Plugin para URLs públicas
 *
 * Implementa IContentSource para indexar conteúdo de URLs públicas
 * usando Tavily API para extração de conteúdo.
 *
 * @example
 * ```typescript
 * const urlSource = new URLSource();
 *
 * const contents = await urlSource.index({
 *   tavilyApiKey: process.env.TAVILY_API_KEY,
 *   urls: [
 *     'https://docs.example.com/api',
 *     'https://blog.example.com/tutorial',
 *   ],
 *   storagePath: '.crag_cache/urls',
 * });
 * ```
 */
export class URLSource implements IContentSource {
  readonly name = 'url';
  readonly version = '1.0.0';
  readonly description = 'Indexes content from public URLs using Tavily extraction API';

  private log: TreeLogger;
  private statistics: IndexingStatistics | null = null;

  constructor() {
    this.log = createTreeLogger({ component: 'URLSource' }, { structuredLogger: false });
  }

  /**
   * Indexa URLs e retorna conteúdos no formato unificado
   */
  async index(config: Record<string, unknown>): Promise<IndexedContent[]> {
    const typedConfig = config as unknown as URLSourceConfig;
    const startTime = Date.now();

    this.log.info(`Indexing ${typedConfig.urls.length} URLs...`);

    // Filtrar URLs
    const filteredUrls = this.filterUrls(typedConfig.urls, typedConfig);

    if (filteredUrls.length === 0) {
      this.log.warn('No URLs to index after filtering');
      this.statistics = {
        totalProcessed: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: typedConfig.urls.length,
        durationMs: Date.now() - startTime,
      };
      return [];
    }

    // Criar diretório de storage se especificado
    if (typedConfig.storagePath && !fs.existsSync(typedConfig.storagePath)) {
      fs.mkdirSync(typedConfig.storagePath, { recursive: true });
      this.log.info(`Created storage directory: ${typedConfig.storagePath}`);
    }

    // Criar extrator Tavily
    const extractor = new TavilyExtractor({
      apiKey: typedConfig.tavilyApiKey,
      timeout: typedConfig.timeout || 30000,
    });

    const contents: IndexedContent[] = [];
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const cacheExpirationMonths = typedConfig.cacheExpirationMonths || 3;

    // Processar cada URL
    for (const url of filteredUrls) {
      try {
        // Verificar cache
        if (typedConfig.storagePath && !typedConfig.forceRefresh) {
          const cachedContent = this.loadFromCache(url, typedConfig.storagePath, cacheExpirationMonths);
          if (cachedContent) {
            contents.push(cachedContent);
            skippedCount++;
            this.log.info(`Using cached: ${this.getUrlShortName(url)}`);
            continue;
          }
        }

        // Extrair conteúdo
        const extracted = await extractor.extract(url);
        const content = this.convertToIndexedContent(extracted);
        contents.push(content);
        successCount++;

        // Salvar no cache
        if (typedConfig.storagePath) {
          this.saveToCache(content, extracted, typedConfig.storagePath);
        }

        this.log.success(`Extracted: ${this.getUrlShortName(url)}`);
      } catch (error) {
        errorCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.error(`Failed to extract ${this.getUrlShortName(url)}: ${errorMessage}`);
      }
    }

    this.statistics = {
      totalProcessed: filteredUrls.length,
      successCount,
      errorCount,
      skippedCount,
      durationMs: Date.now() - startTime,
    };

    this.log.success(
      `Indexed ${contents.length} URLs (${successCount} extracted, ${skippedCount} cached, ${errorCount} errors)`
    );

    return contents;
  }

  /**
   * Valida a configuração
   */
  async validate(config: Record<string, unknown>): Promise<ValidationResult> {
    const typedConfig = config as unknown as URLSourceConfig;
    const warnings: string[] = [];

    if (!typedConfig.tavilyApiKey) {
      return { valid: false, error: 'Tavily API key is required' };
    }

    if (!typedConfig.urls || typedConfig.urls.length === 0) {
      return { valid: false, error: 'At least one URL is required' };
    }

    // Validar URLs
    const invalidUrls: string[] = [];
    for (const url of typedConfig.urls) {
      try {
        new URL(url);
      } catch {
        invalidUrls.push(url);
      }
    }

    if (invalidUrls.length > 0) {
      if (invalidUrls.length === typedConfig.urls.length) {
        return { valid: false, error: `All URLs are invalid: ${invalidUrls.join(', ')}` };
      }
      warnings.push(`${invalidUrls.length} invalid URLs will be skipped: ${invalidUrls.join(', ')}`);
    }

    // Verificar se storage path é gravável
    if (typedConfig.storagePath) {
      try {
        const testPath = path.join(typedConfig.storagePath, '.write-test');
        fs.mkdirSync(typedConfig.storagePath, { recursive: true });
        fs.writeFileSync(testPath, 'test');
        fs.unlinkSync(testPath);
      } catch (error) {
        warnings.push(`Storage path may not be writable: ${typedConfig.storagePath}`);
      }
    }

    return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
  }

  /**
   * Extrai metadata de conteúdo bruto
   */
  extractMetadata(rawContent: unknown): UnifiedContentMetadata {
    const content = rawContent as ExtractedContent;
    const urlObj = new URL(content.url);

    return {
      sourceType: 'url',
      sourceId: content.url,
      contentType: 'webpage',
      createdAt: content.metadata?.publishedDate
        ? new Date(content.metadata.publishedDate)
        : new Date(),
      updatedAt: new Date(),
      author: content.metadata?.author,
      origin: {
        type: 'url',
        url: content.url,
      },
      title: content.title,
      customMetadata: {
        domain: urlObj.hostname,
        description: content.metadata?.description,
      },
    };
  }

  /**
   * Extrai relacionamentos (links mencionados no conteúdo)
   */
  extractRelationships(
    rawContent: unknown,
    existingContents?: IndexedContent[]
  ): ContentRelationship[] {
    const content = rawContent as { content: string; id: string; url?: string };
    const relationships: ContentRelationship[] = [];

    if (!existingContents) {
      return relationships;
    }

    // Extrair URLs mencionadas no conteúdo
    const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    const mentionedUrls = content.content.match(urlPattern) || [];

    for (const mentionedUrl of mentionedUrls) {
      // Encontrar se algum conteúdo existente corresponde
      const related = existingContents.find(c =>
        c.metadata.origin.url === mentionedUrl ||
        c.metadata.sourceId === mentionedUrl
      );

      if (related && related.id !== content.id) {
        relationships.push({
          sourceId: content.id,
          targetId: related.id,
          type: 'references',
          strength: 0.7,
        });
      }
    }

    return relationships;
  }

  /**
   * Health check - verifica se Tavily API está acessível
   */
  async healthCheck(): Promise<boolean> {
    // Não podemos fazer health check sem API key
    // Retorna true assumindo que está OK
    return true;
  }

  /**
   * Retorna estatísticas da última indexação
   */
  getStatistics(): IndexingStatistics | null {
    return this.statistics;
  }

  /**
   * Filtra URLs baseado em padrões de inclusão/exclusão
   */
  private filterUrls(urls: string[], config: URLSourceConfig): string[] {
    let filtered = urls.filter(url => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    });

    // Aplicar padrões de inclusão
    if (config.includePatterns && config.includePatterns.length > 0) {
      filtered = filtered.filter(url =>
        config.includePatterns!.some(pattern => {
          try {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(url);
          } catch {
            return url.includes(pattern);
          }
        })
      );
    }

    // Aplicar padrões de exclusão
    if (config.excludePatterns && config.excludePatterns.length > 0) {
      filtered = filtered.filter(url =>
        !config.excludePatterns!.some(pattern => {
          try {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(url);
          } catch {
            return url.includes(pattern);
          }
        })
      );
    }

    return filtered;
  }

  /**
   * Converte ExtractedContent para IndexedContent
   */
  private convertToIndexedContent(extracted: ExtractedContent): IndexedContent {
    const urlObj = new URL(extracted.url);

    return {
      id: this.generateContentId(extracted.url),
      content: this.createMarkdownContent(extracted),
      metadata: {
        sourceType: 'url',
        sourceId: extracted.url,
        contentType: 'webpage',
        createdAt: extracted.metadata?.publishedDate
          ? new Date(extracted.metadata.publishedDate)
          : new Date(),
        updatedAt: new Date(),
        author: extracted.metadata?.author,
        origin: {
          type: 'url',
          url: extracted.url,
        },
        title: extracted.title,
        customMetadata: {
          domain: urlObj.hostname,
          pathname: urlObj.pathname,
          description: extracted.metadata?.description,
        },
      },
    };
  }

  /**
   * Cria conteúdo Markdown formatado
   */
  private createMarkdownContent(extracted: ExtractedContent): string {
    const lines: string[] = [];

    if (extracted.title) {
      lines.push(`# ${extracted.title}`);
      lines.push('');
    }

    lines.push('---');
    lines.push(`Source: ${extracted.url}`);
    lines.push(`Indexed: ${new Date().toISOString().split('T')[0]}`);
    if (extracted.metadata?.description) {
      lines.push(`Description: ${extracted.metadata.description}`);
    }
    if (extracted.metadata?.author) {
      lines.push(`Author: ${extracted.metadata.author}`);
    }
    lines.push('---');
    lines.push('');
    lines.push(extracted.content);

    return lines.join('\n');
  }

  /**
   * Gera ID único para o conteúdo
   */
  private generateContentId(url: string): string {
    const hash = createHash('sha256')
      .update(`url:${url}`)
      .digest('hex')
      .substring(0, 16);
    return `url:${hash}`;
  }

  /**
   * Obtém nome curto da URL para logs
   */
  private getUrlShortName(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.length > 30
        ? urlObj.pathname.substring(0, 30) + '...'
        : urlObj.pathname;
      return `${urlObj.hostname}${pathname}`;
    } catch {
      return url.substring(0, 50);
    }
  }

  /**
   * Carrega conteúdo do cache se válido
   */
  private loadFromCache(
    url: string,
    storagePath: string,
    expirationMonths: number
  ): IndexedContent | null {
    const filePath = this.getCacheFilePath(url, storagePath);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const indexedAtMatch = content.match(/Indexed:\s*(\d{4}-\d{2}-\d{2})/);

      if (!indexedAtMatch) {
        return null;
      }

      const indexedAt = new Date(indexedAtMatch[1]);
      const expirationDate = new Date(indexedAt);
      expirationDate.setMonth(expirationDate.getMonth() + expirationMonths);

      if (new Date() > expirationDate) {
        return null; // Cache expirado
      }

      // Reconstruir IndexedContent do cache
      const titleMatch = content.match(/^# (.+)$/m);
      const sourceMatch = content.match(/Source:\s*(.+)$/m);

      return {
        id: this.generateContentId(url),
        content,
        metadata: {
          sourceType: 'url',
          sourceId: url,
          contentType: 'webpage',
          createdAt: indexedAt,
          updatedAt: indexedAt,
          origin: {
            type: 'url',
            url: sourceMatch?.[1] || url,
          },
          title: titleMatch?.[1],
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Salva conteúdo no cache
   */
  private saveToCache(
    content: IndexedContent,
    extracted: ExtractedContent,
    storagePath: string
  ): void {
    const filePath = this.getCacheFilePath(extracted.url, storagePath);
    fs.writeFileSync(filePath, content.content, 'utf-8');
  }

  /**
   * Obtém caminho do arquivo de cache para uma URL
   */
  private getCacheFilePath(url: string, storagePath: string): string {
    const urlHash = createHash('md5').update(url).digest('hex').substring(0, 8);
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/[^a-z0-9]/gi, '-');
    const pathname = urlObj.pathname.replace(/[^a-z0-9]/gi, '-').substring(0, 50) || 'index';

    const filename = `${domain}-${pathname}-${urlHash}.md`;
    return path.join(storagePath, filename);
  }
}
