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
import { FileCollector, VALID_EXTENSIONS } from '../../services/FileCollector';
import type { IChunkingStrategy } from '../../interfaces/IChunkingStrategy';
import { ASTChunkingStrategy } from '../../services/chunking/ASTChunkingStrategy';
import { createTreeLogger } from '../../utils/logger';
import type { TreeLogger } from '../../utils/treeLogger';
import { inferLanguageFromFilePath } from '../../utils/language';
import { extractCharacteristics } from '../../utils/codeCharacteristics';

/**
 * Configuração específica para RepositorySource
 */
export interface RepositorySourceConfig {
  /** Caminho para o repositório */
  path: string;
  /** Diretórios a excluir */
  excludeDirectories?: string[];
  /** Padrões de arquivos a incluir */
  includePatterns?: string[];
  /** Estratégia de chunking */
  chunkingStrategy?: 'ast' | 'sliding-window' | 'fixed-size';
  /** Tamanho máximo do chunk */
  maxChunkSize?: number;
  /** Sobreposição entre chunks */
  chunkOverlap?: number;
  /** Incluir arquivos Markdown */
  includeMarkdown?: boolean;
  /** Nome do repositório (opcional, inferido do path) */
  repoName?: string;
  /** Branch atual (opcional) */
  branch?: string;
}

/**
 * RepositorySource - Content Source Plugin para repositórios de código
 *
 * Implementa IContentSource para indexar código-fonte de repositórios locais.
 * Converte chunks de código para o formato unificado IndexedContent.
 *
 * @example
 * ```typescript
 * const repoSource = new RepositorySource();
 *
 * const contents = await repoSource.index({
 *   path: './my-project',
 *   excludeDirectories: ['node_modules', '.git'],
 *   chunkingStrategy: 'ast',
 * });
 * ```
 */
export class RepositorySource implements IContentSource {
  readonly name = 'repository';
  readonly version = '1.0.0';
  readonly description = 'Indexes source code from local repositories using AST-aware chunking';

  private log: TreeLogger;
  private chunkingStrategy: IChunkingStrategy;
  private statistics: IndexingStatistics | null = null;

  constructor(chunkingStrategy?: IChunkingStrategy) {
    this.log = createTreeLogger({ component: 'RepositorySource' }, { structuredLogger: false });
    this.chunkingStrategy = chunkingStrategy || new ASTChunkingStrategy();
  }

  /**
   * Indexa um repositório e retorna conteúdos no formato unificado
   */
  async index(config: Record<string, unknown>): Promise<IndexedContent[]> {
    const typedConfig = config as unknown as RepositorySourceConfig;
    const startTime = Date.now();

    this.log.info(`Indexing repository: ${typedConfig.path}`);

    // Configurar FileCollector
    const extensions = typedConfig.includeMarkdown
      ? [...VALID_EXTENSIONS, '.md', '.markdown']
      : VALID_EXTENSIONS;

    const fileCollector = new FileCollector({ validExtensions: extensions });

    // Coletar arquivos
    const collectionResult = await fileCollector.collect([typedConfig.path]);

    this.log.info(
      `Collected ${collectionResult.stats.totalFiles} files ` +
      `(${collectionResult.stats.totalSkipped} skipped)`
    );

    if (collectionResult.files.length === 0) {
      this.statistics = {
        totalProcessed: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: 0,
        durationMs: Date.now() - startTime,
      };
      return [];
    }

    const contents: IndexedContent[] = [];
    let successCount = 0;
    let errorCount = 0;

    // Inferir nome do repositório
    const repoName = typedConfig.repoName || path.basename(path.resolve(typedConfig.path));

    // Processar cada arquivo
    for (const filePath of collectionResult.files) {
      try {
        const fileContents = await this.processFile(filePath, typedConfig, repoName);
        contents.push(...fileContents);
        successCount++;
      } catch (error) {
        errorCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.error(`Failed to process ${path.basename(filePath)}: ${errorMessage}`);
      }
    }

    this.statistics = {
      totalProcessed: collectionResult.files.length,
      successCount,
      errorCount,
      skippedCount: collectionResult.stats.totalSkipped,
      durationMs: Date.now() - startTime,
    };

    this.log.success(
      `Indexed ${contents.length} chunks from ${successCount} files in ${this.statistics.durationMs}ms`
    );

    return contents;
  }

  /**
   * Processa um arquivo individual
   */
  private async processFile(
    filePath: string,
    config: RepositorySourceConfig,
    repoName: string
  ): Promise<IndexedContent[]> {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const language = inferLanguageFromFilePath(filePath) || 'text';

    // Aplicar chunking
    const chunks = await this.chunkingStrategy.chunk(filePath, fileContent, language);

    // Converter chunks para IndexedContent
    const contents: IndexedContent[] = [];

    for (const chunk of chunks) {
      const relativePath = path.relative(config.path, filePath);

      const content: IndexedContent = {
        id: this.generateContentId(filePath, chunk.id),
        content: chunk.content,
        metadata: {
          sourceType: 'code',
          sourceId: `${repoName}:${relativePath}:${chunk.id}`,
          contentType: this.getContentType(chunk.astNode, language),
          createdAt: this.getFileDate(filePath, 'created'),
          updatedAt: this.getFileDate(filePath, 'modified'),
          origin: {
            type: 'repository',
            path: relativePath,
            repo: repoName,
            branch: config.branch,
          },
          language,
          title: this.generateTitle(chunk.astNode, relativePath, chunk.startLine),
          customMetadata: {
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            astNode: chunk.astNode,
            fileType: path.extname(filePath),
            directory: path.dirname(relativePath),
            characteristics: extractCharacteristics(chunk.content),
          },
        },
      };

      contents.push(content);
    }

    return contents;
  }

  /**
   * Valida a configuração
   */
  async validate(config: Record<string, unknown>): Promise<ValidationResult> {
    const typedConfig = config as unknown as RepositorySourceConfig;

    if (!typedConfig.path) {
      return { valid: false, error: 'Repository path is required' };
    }

    const resolvedPath = path.resolve(typedConfig.path);

    if (!fs.existsSync(resolvedPath)) {
      return { valid: false, error: `Path does not exist: ${resolvedPath}` };
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isDirectory()) {
      return { valid: false, error: `Path is not a directory: ${resolvedPath}` };
    }

    const warnings: string[] = [];

    // Verificar se é um repositório Git
    const gitPath = path.join(resolvedPath, '.git');
    if (!fs.existsSync(gitPath)) {
      warnings.push('Directory is not a Git repository');
    }

    return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
  }

  /**
   * Extrai metadata de conteúdo bruto
   */
  extractMetadata(rawContent: unknown): UnifiedContentMetadata {
    const content = rawContent as {
      filePath: string;
      content: string;
      language?: string;
      chunk?: { startLine: number; endLine: number; astNode?: string };
    };

    return {
      sourceType: 'code',
      sourceId: content.filePath,
      contentType: 'file',
      createdAt: new Date(),
      updatedAt: new Date(),
      origin: {
        type: 'repository',
        path: content.filePath,
      },
      language: content.language,
    };
  }

  /**
   * Extrai relacionamentos (importações, dependências)
   */
  extractRelationships(
    rawContent: unknown,
    existingContents?: IndexedContent[]
  ): ContentRelationship[] {
    const content = rawContent as { content: string; id: string };
    const relationships: ContentRelationship[] = [];

    if (!existingContents) {
      return relationships;
    }

    // Extrair imports do conteúdo
    const importPatterns = [
      /import\s+.*?from\s+['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /from\s+['"]([^'"]+)['"]/g,
    ];

    const imports = new Set<string>();
    for (const pattern of importPatterns) {
      let match;
      while ((match = pattern.exec(content.content)) !== null) {
        imports.add(match[1]);
      }
    }

    // Encontrar conteúdos correspondentes aos imports
    for (const importPath of imports) {
      const related = existingContents.find(c =>
        c.metadata.origin.path?.includes(importPath.replace(/^\.\//, ''))
      );

      if (related) {
        relationships.push({
          sourceId: content.id,
          targetId: related.id,
          type: 'depends_on',
          strength: 0.9,
        });
      }
    }

    return relationships;
  }

  /**
   * Health check - verifica se pode acessar o sistema de arquivos
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simples verificação: tentar ler diretório atual
      fs.readdirSync('.');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retorna estatísticas da última indexação
   */
  getStatistics(): IndexingStatistics | null {
    return this.statistics;
  }

  /**
   * Gera ID único para o conteúdo
   */
  private generateContentId(filePath: string, chunkId: string): string {
    const hash = createHash('sha256')
      .update(`repository:${filePath}:${chunkId}`)
      .digest('hex')
      .substring(0, 16);
    return `repo:${chunkId}:${hash}`;
  }

  /**
   * Determina o tipo de conteúdo baseado no nó AST
   */
  private getContentType(astNode: string | undefined, language: string): string {
    if (!astNode) return 'code-chunk';

    const nodeType = astNode.toLowerCase();
    if (nodeType.includes('function')) return 'function';
    if (nodeType.includes('class')) return 'class';
    if (nodeType.includes('interface')) return 'interface';
    if (nodeType.includes('type')) return 'type-definition';
    if (nodeType.includes('import') || nodeType.includes('export')) return 'module-declaration';

    return 'code-chunk';
  }

  /**
   * Gera título legível para o conteúdo
   */
  private generateTitle(astNode: string | undefined, filePath: string, startLine: number): string {
    if (astNode && astNode !== 'file') {
      return `${astNode} in ${path.basename(filePath)}:${startLine}`;
    }
    return `${path.basename(filePath)}:${startLine}`;
  }

  /**
   * Obtém data do arquivo
   */
  private getFileDate(filePath: string, type: 'created' | 'modified'): Date {
    try {
      const stats = fs.statSync(filePath);
      return type === 'created' ? stats.birthtime : stats.mtime;
    } catch {
      return new Date();
    }
  }
}
