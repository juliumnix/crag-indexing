import type { SemanticSearchResult } from '../model/RAGQuery';
import type { ContextBudget, OptimizedChunk } from './types';
import { Tokenizer } from './Tokenizer';

/**
 * Context Budget Manager
 * Optimizes chunks to fit within token budget
 */
export class ContextBudgetManager {
  private tokenizer: Tokenizer;

  constructor() {
    this.tokenizer = new Tokenizer();
  }

  /**
   * Optimize chunks to fit within budget
   */
  optimize(chunks: SemanticSearchResult[], budget: ContextBudget): OptimizedChunk[] {
    // 1. Count tokens and calculate priority
    const chunksWithTokens = chunks.map(chunk => ({
      ...chunk,
      tokenCount: this.tokenizer.count(chunk.content),
      priority: this.calculatePriority(chunk, budget),
    }));

    // 2. Remove duplicates if enabled
    let optimized = budget.deduplication
      ? this.deduplicateChunks(chunksWithTokens)
      : chunksWithTokens;

    // 3. Sort by priority
    optimized.sort((a, b) => b.priority - a.priority);

    // 4. Select chunks until budget is reached
    const selected: OptimizedChunk[] = [];
    let usedTokens = 0;

    for (const chunk of optimized) {
      if (usedTokens + chunk.tokenCount <= budget.availableTokens) {
        selected.push(chunk);
        usedTokens += chunk.tokenCount;
      } else {
        break; // Budget exhausted
      }
    }

    return selected;
  }

  /**
   * Remove duplicate chunks (>90% similar)
   */
  private deduplicateChunks(chunks: OptimizedChunk[]): OptimizedChunk[] {
    const unique: OptimizedChunk[] = [];

    for (const chunk of chunks) {
      let isDuplicate = false;

      for (const other of unique) {
        const similarity = this.calculateSimilarity(chunk.content, other.content);

        if (similarity > 0.9) {
          // 90% similar = duplicate
          isDuplicate = true;
          chunk.similarTo = [...(chunk.similarTo || []), (other.metadata?.chunkId as string) || ''];
          break;
        }
      }

      if (!isDuplicate) {
        unique.push(chunk);
      }
    }

    return unique;
  }

  /**
   * Calculate priority score
   */
  private calculatePriority(chunk: SemanticSearchResult, budget: ContextBudget): number {
    let priority = chunk.similarity || 0; // Base: embedding score

    // Boost recent docs if enabled
    if (budget.prioritizeRecent) {
      // TODO: Extract actual update time from metadata
      // For now, assume all are recent
      const recencyBoost = 0.3;
      priority = priority * 0.7 + recencyBoost * 0.3;
    }

    return priority;
  }

  /**
   * Calculate similarity between two texts (Jaccard)
   */
  private calculateSimilarity(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/\s+/));
    const tokensB = new Set(b.toLowerCase().split(/\s+/));

    const intersection = new Set([...tokensA].filter(x => tokensB.has(x)));
    const union = new Set([...tokensA, ...tokensB]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }
}

