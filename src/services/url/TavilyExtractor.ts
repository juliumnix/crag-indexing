import { tavily } from '@tavily/core';

/**
 * Configuration for Tavily extractor
 */
export interface TavilyExtractorConfig {
  /** Tavily API key */
  apiKey: string;

  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Extracted content from a URL
 */
export interface ExtractedContent {
  /** Original URL */
  url: string;

  /** Extracted content */
  content: string;

  /** Title of the page */
  title?: string;

  /** Metadata about the extraction */
  metadata?: {
    description?: string;
    author?: string;
    publishedDate?: string;
    [key: string]: any;
  };
}

/**
 * Tavily Content Extractor
 * Uses Tavily API to extract content from public URLs
 */
export class TavilyExtractor {
  private client: ReturnType<typeof tavily>;
  private timeout: number;

  constructor(config: TavilyExtractorConfig) {
    this.client = tavily({ apiKey: config.apiKey });
    this.timeout = config.timeout || 30000;
  }

  /**
   * Extract content from a single URL
   */
  async extract(url: string): Promise<ExtractedContent> {
    try {
      const response = await Promise.race([
        this.client.extract([url]), // Tavily extract expects an array
        this.createTimeoutPromise(),
      ]) as any;

      // Tavily extract returns: { results: [...], failedResults: [...] }
      // Each result has: { url, rawContent, title?, ... }
      if (!response || typeof response !== 'object') {
        throw new Error(`Invalid response from Tavily: ${typeof response}`);
      }

      // Check for failed results
      if (response.failedResults && response.failedResults.length > 0) {
        const failed = response.failedResults.find((f: any) => f.url === url);
        if (failed) {
          throw new Error(`Tavily failed to extract ${url}: ${failed.error || 'Unknown error'}`);
        }
      }

      // Get the result for this URL
      const result = response.results?.find((r: any) => r.url === url) || response.results?.[0];
      
      if (!result) {
        throw new Error(`No result found for ${url} in Tavily response`);
      }

      // Tavily returns rawContent (not content or text)
      const content = result.rawContent || '';

      if (!content || content.trim().length === 0) {
        console.warn(`⚠️  Empty content extracted from ${url}. Available keys:`, Object.keys(result));
      }

      return {
        url: result.url || url,
        content: content || '',
        title: result.title || '',
        metadata: {
          description: result.description,
          author: result.author,
          publishedDate: result.publishedDate,
          ...(result.metadata || {}),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Error extracting ${url}:`, errorMessage);
      throw new Error(`Failed to extract content from ${url}: ${errorMessage}`);
    }
  }

  /**
   * Extract content from multiple URLs
   */
  async extractBatch(urls: string[]): Promise<ExtractedContent[]> {
    const results: ExtractedContent[] = [];
    
    for (const url of urls) {
      try {
        const content = await this.extract(url);
        results.push(content);
      } catch (error) {
        console.error(`Failed to extract ${url}:`, error);
        // Continue with other URLs
      }
    }

    return results;
  }

  /**
   * Create a timeout promise
   */
  private createTimeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${this.timeout}ms`));
      }, this.timeout);
    });
  }
}

