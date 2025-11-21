import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { TavilyExtractor, type ExtractedContent } from './TavilyExtractor';
import { createTreeLogger } from '../../utils/logger';
import type { TreeLogger } from '../../utils/treeLogger';

/**
 * Configuration for URL indexing
 */
export interface URLIndexerConfig {
  /** Tavily API key */
  tavilyApiKey: string;

  /** Directory to save extracted content */
  storagePath: string;

  /** URL patterns to include (optional) */
  includePatterns?: string[];

  /** URL patterns to exclude (optional) */
  excludePatterns?: string[];

  /** Cache expiration time in months (default: 3) */
  cacheExpirationMonths?: number;
}

/**
 * URL Indexer
 * Downloads and indexes content from public URLs using Tavily
 */
export class URLIndexer {
  private log: TreeLogger;
  private extractor: TavilyExtractor;
  private config: URLIndexerConfig;
  private cacheExpirationMonths: number;

  constructor(config: URLIndexerConfig) {
    this.log = createTreeLogger({ component: 'URLIndexer' }, { structuredLogger: false });
    this.config = config;
    this.cacheExpirationMonths = config.cacheExpirationMonths || 3;
    this.extractor = new TavilyExtractor({
      apiKey: config.tavilyApiKey,
      timeout: 30000,
    });
  }

  /**
   * Index URLs and save as local files
   * Uses cache to avoid unnecessary API calls (updates if older than cacheExpirationMonths)
   */
  async index(urls: string[]): Promise<Array<{ url: string; filePath: string; cached: boolean }>> {
    this.log.info(`Indexing ${urls.length} URLs...`);

    // Filter URLs if patterns are specified
    const filteredUrls = this.filterUrls(urls);

    if (filteredUrls.length === 0) {
      this.log.warn('No URLs to index after filtering');
      return [];
    }

    // Ensure storage directory exists
    if (!fs.existsSync(this.config.storagePath)) {
      fs.mkdirSync(this.config.storagePath, { recursive: true });
      this.log.info(`Created storage directory: ${this.config.storagePath}`);
    }

    // Separate URLs into those that need extraction and those that are cached
    const urlsToExtract: string[] = [];
    const cachedResults: Array<{ url: string; filePath: string; cached: boolean }> = [];

    for (const url of filteredUrls) {
      const filePath = this.getFilePath(url);
      const cacheInfo = this.checkCache(url, filePath);

      if (cacheInfo.isValid) {
        // Use cached version
        cachedResults.push({ url, filePath, cached: true });
        const dateStr = cacheInfo.indexedAt ? cacheInfo.indexedAt.toLocaleDateString() : 'unknown date';
        this.log.info(`Using cache: ${path.basename(filePath)} (indexed ${dateStr})`);
      } else {
        // Need to extract (new or expired)
        urlsToExtract.push(url);
        if (cacheInfo.exists) {
          this.log.info(`Cache expired for ${path.basename(filePath)}, updating...`);
        }
      }
    }

    // Extract content from URLs that need updating
    let extracted: ExtractedContent[] = [];
    if (urlsToExtract.length > 0) {
      extracted = await this.extractor.extractBatch(urlsToExtract);
    }

    // Save extracted content as files
    const saved: Array<{ url: string; filePath: string; cached: boolean }> = [...cachedResults];

    for (const content of extracted) {
      try {
        const filePath = this.saveContent(content);
        saved.push({ url: content.url, filePath, cached: false });
        this.log.success(`Saved: ${path.basename(filePath)}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.error(`Failed to save content from ${content.url}: ${errorMessage}`);
      }
    }

    const cachedCount = cachedResults.length;
    const updatedCount = extracted.length;
    this.log.success(`Indexed ${saved.length}/${filteredUrls.length} URLs (${cachedCount} cached, ${updatedCount} updated)`);

    return saved;
  }

  /**
   * Filter URLs based on include/exclude patterns
   */
  private filterUrls(urls: string[]): string[] {
    let filtered = urls;

    // Apply include patterns
    if (this.config.includePatterns && this.config.includePatterns.length > 0) {
      filtered = filtered.filter(url => {
        return this.config.includePatterns!.some(pattern => {
          try {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(url);
          } catch {
            return url.includes(pattern);
          }
        });
      });
    }

    // Apply exclude patterns
    if (this.config.excludePatterns && this.config.excludePatterns.length > 0) {
      filtered = filtered.filter(url => {
        return !this.config.excludePatterns!.some(pattern => {
          try {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(url);
          } catch {
            return url.includes(pattern);
          }
        });
      });
    }

    return filtered;
  }

  /**
   * Get file path for a URL
   */
  private getFilePath(url: string): string {
    const urlHash = createHash('md5').update(url).digest('hex').substring(0, 8);
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/[^a-z0-9]/gi, '-');
    const pathname = urlObj.pathname.replace(/[^a-z0-9]/gi, '-').substring(0, 50) || 'index';
    
    const filename = `${domain}-${pathname}-${urlHash}.md`;
    return path.join(this.config.storagePath, filename);
  }

  /**
   * Check if cached content exists and is still valid
   */
  private checkCache(url: string, filePath: string): { exists: boolean; isValid: boolean; indexedAt?: Date } {
    if (!fs.existsSync(filePath)) {
      return { exists: false, isValid: false };
    }

    try {
      // Read file to extract indexedAt date
      const content = fs.readFileSync(filePath, 'utf-8');
      const indexedAt = this.extractIndexedDate(content);

      if (!indexedAt) {
        // Old format without date, consider expired
        return { exists: true, isValid: false };
      }

      // Check if cache is still valid (not older than cacheExpirationMonths)
      const now = new Date();
      const expirationDate = new Date(indexedAt);
      expirationDate.setMonth(expirationDate.getMonth() + this.cacheExpirationMonths);

      const isValid = now < expirationDate;

      return { exists: true, isValid, indexedAt };
    } catch (error) {
      // Error reading file, consider expired
      return { exists: true, isValid: false };
    }
  }

  /**
   * Extract indexed date from markdown frontmatter
   */
  private extractIndexedDate(content: string): Date | null {
    // Look for "Indexed At: YYYY-MM-DD" in frontmatter
    const indexedAtMatch = content.match(/Indexed At:\s*(\d{4}-\d{2}-\d{2})/);
    if (indexedAtMatch) {
      const date = new Date(indexedAtMatch[1]);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    return null;
  }

  /**
   * Save extracted content to a file
   */
  private saveContent(content: ExtractedContent): string {
    const filePath = this.getFilePath(content.url);

    // Create markdown content
    const markdown = this.createMarkdown(content);

    // Save file
    fs.writeFileSync(filePath, markdown, 'utf-8');

    return filePath;
  }

  /**
   * Create markdown content from extracted data
   */
  private createMarkdown(content: ExtractedContent): string {
    const lines: string[] = [];

    // Title
    if (content.title) {
      lines.push(`# ${content.title}`);
      lines.push('');
    }

    // Metadata
    lines.push('---');
    lines.push(`Source URL: ${content.url}`);
    lines.push(`Indexed At: ${new Date().toISOString().split('T')[0]}`); // YYYY-MM-DD format
    if (content.metadata?.description) {
      lines.push(`Description: ${content.metadata.description}`);
    }
    if (content.metadata?.author) {
      lines.push(`Author: ${content.metadata.author}`);
    }
    if (content.metadata?.publishedDate) {
      lines.push(`Published: ${content.metadata.publishedDate}`);
    }
    lines.push('---');
    lines.push('');

    // Content
    lines.push(content.content);

    return lines.join('\n');
  }

  /**
   * Get storage path for indexed URLs
   */
  getStoragePath(): string {
    return this.config.storagePath;
  }
}

