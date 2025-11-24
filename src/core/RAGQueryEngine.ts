import type { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import type { IVectorDatabase } from '../interfaces/IVectorDatabase';
import type { RAGQuery, SemanticSearchResult, RAGQueryConfig } from '../model/RAGQuery';
import { createTreeLogger } from '../utils/logger';
import type { TreeLogger } from '../utils/treeLogger';
import { LRUCache } from '../utils/LRUCache';

// Simple LLM provider interface for optional reranking
interface ILLMProvider {
  generate(prompt: string): Promise<string>;
}

/**
 * RAGQueryEngine
 * Advanced semantic search with filtering, hybrid search, and re-ranking
 */
export class RAGQueryEngine {
  private log: TreeLogger;
  private vectorDatabase: IVectorDatabase;
  private embeddingProvider: IEmbeddingProvider;
  private llmProvider?: ILLMProvider;
  private queryCache: LRUCache<string, SemanticSearchResult[]> = new LRUCache(100);

  constructor(config: {
    vectorDatabase: IVectorDatabase;
    embeddingProvider: IEmbeddingProvider;
    llmProvider?: ILLMProvider;
  }) {
    this.log = createTreeLogger({ component: 'RAGQueryEngine' }, { structuredLogger: false });
    this.vectorDatabase = config.vectorDatabase;
    this.embeddingProvider = config.embeddingProvider;
    this.llmProvider = config.llmProvider;
  }

  /**
   * Execute a RAG query with advanced features
   */
  async query(
    query: RAGQuery,
    config?: RAGQueryConfig
  ): Promise<SemanticSearchResult[]> {
    const startTime = Date.now();

    // Check cache
    const cacheKey = this.getCacheKey(query);
    if (this.queryCache.has(cacheKey)) {
      this.log.info('Query cache hit');
      return this.queryCache.get(cacheKey)!;
    }

    // Step 1: Generate query embedding (isQuery=true para modelos que precisam de prefixo)
    const queryEmbedding = await this.embeddingProvider.embed(query.text, true);

    // Step 2: Vector search
    const topK = query.topK || 10;
    let vectorResults = await this.vectorDatabase.search(
      queryEmbedding,
      topK * 2, // Fetch more for hybrid/reranking
      query.filters
    );

    // Step 3: Apply minimum similarity filter
    if (query.minSimilarity !== undefined) {
      vectorResults = vectorResults.filter(r => r.similarity >= query.minSimilarity!);
    }

    // Step 4: Hybrid search (optional)
    let results = vectorResults;
    if (config?.hybridSearch) {
      results = await this.hybridSearch(
        query.text,
        vectorResults,
        config.keywordWeight || 0.3
      );
    }

    // Step 5: Re-ranking (optional)
    if (query.rerank && this.llmProvider) {
      results = await this.rerankWithLLM(query.text, results);
    }

    // Step 6: Limit to topK
    results = results.slice(0, topK);

    const duration = Date.now() - startTime;
    this.log.info(
      `Query completed in ${duration}ms, found ${results.length} results`
    );

    // Cache results
    this.queryCache.set(cacheKey, results);

    return results;
  }

  /**
   * Hybrid search combining vector and keyword search
   * Uses BM25-like scoring for keyword matching
   */
  private async hybridSearch(
    queryText: string,
    vectorResults: SemanticSearchResult[],
    keywordWeight: number
  ): Promise<SemanticSearchResult[]> {
    // Normalize query
    const queryTerms = this.tokenize(queryText.toLowerCase());

    // Calculate keyword scores
    const keywordScores = new Map<string, number>();

    for (const result of vectorResults) {
      const contentTerms = this.tokenize(result.content.toLowerCase());
      const score = this.calculateBM25Score(queryTerms, contentTerms);
      keywordScores.set(result.filePath + ':' + result.metadata.startLine, score);
    }

    // Combine scores using RRF (Reciprocal Rank Fusion)
    const combinedResults = vectorResults.map(result => {
      const key = result.filePath + ':' + result.metadata.startLine;
      const keywordScore = keywordScores.get(key) || 0;

      // Weighted combination
      const vectorWeight = 1 - keywordWeight;
      const combinedScore =
        result.similarity * vectorWeight + keywordScore * keywordWeight;

      return {
        ...result,
        similarity: combinedScore,
      };
    });

    // Sort by combined score
    combinedResults.sort((a, b) => b.similarity - a.similarity);

    return combinedResults;
  }

  /**
   * Re-rank results using LLM
   * LLM scores each result based on relevance to query
   */
  private async rerankWithLLM(
    queryText: string,
    results: SemanticSearchResult[]
  ): Promise<SemanticSearchResult[]> {
    if (!this.llmProvider) {
      this.log.warn('LLM provider not available, skipping reranking');
      return results;
    }

    const rerankedResults: (SemanticSearchResult & { rerankScore?: number })[] = [];

    // Score each result with LLM (in batches to avoid token limits)
    const batchSize = 5;
    for (let i = 0; i < results.length; i += batchSize) {
      const batch = results.slice(i, i + batchSize);

      for (const result of batch) {
        try {
          const score = await this.scoreSemanticRelevance(queryText, result);
          rerankedResults.push({
            ...result,
            rerankScore: score,
          });
        } catch (error) {
          // If LLM fails, keep original score
          rerankedResults.push(result);
        }
      }
    }

    // Sort by rerank score
    rerankedResults.sort((a, b) => {
      const scoreA = a.rerankScore !== undefined ? a.rerankScore : a.similarity;
      const scoreB = b.rerankScore !== undefined ? b.rerankScore : b.similarity;
      return scoreB - scoreA;
    });

    return rerankedResults;
  }

  /**
   * Score semantic relevance using LLM
   */
  private async scoreSemanticRelevance(
    query: string,
    result: SemanticSearchResult
  ): Promise<number> {
    const prompt = `Rate the relevance of the following code snippet to the query on a scale of 0-100.

Query: ${query}

Code:
\`\`\`
${result.content}
\`\`\`

File: ${result.filePath}:${result.metadata.startLine}-${result.metadata.endLine}

Respond with ONLY a number between 0 and 100.`;

    const response = await this.llmProvider!.generate(prompt);

    // Parse score from response
    const scoreMatch = response.match(/\d+/);
    if (scoreMatch) {
      const score = parseInt(scoreMatch[0], 10);
      return Math.min(100, Math.max(0, score)) / 100; // Normalize to 0-1
    }

    // Fallback to vector similarity
    return result.similarity;
  }

  /**
   * Simple BM25-like scoring
   */
  private calculateBM25Score(
    queryTerms: string[],
    documentTerms: string[]
  ): number {
    const k1 = 1.5;
    const b = 0.75;
    const avgDocLength = 100; // Approximate

    let score = 0;
    const docLength = documentTerms.length;

    for (const term of queryTerms) {
      const termFreq = documentTerms.filter(t => t === term).length;
      if (termFreq === 0) continue;

      // Simplified BM25 formula
      const idf = Math.log((1 + docLength) / (1 + termFreq));
      const tf = (termFreq * (k1 + 1)) /
        (termFreq + k1 * (1 - b + b * (docLength / avgDocLength)));

      score += idf * tf;
    }

    // Normalize to 0-1
    return Math.min(1, score / queryTerms.length);
  }

  /**
   * Tokenize text into terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2); // Remove very short terms
  }

  /**
   * Generate cache key for query
   */
  private getCacheKey(query: RAGQuery): string {
    return JSON.stringify({
      text: query.text,
      filters: query.filters,
      topK: query.topK,
      minSimilarity: query.minSimilarity,
    });
  }

  /**
   * Clear query cache
   */
  clearCache(): void {
    this.queryCache.clear();
  }
}
