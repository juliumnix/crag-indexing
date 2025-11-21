import micromatch from 'micromatch';
import type {
  EndorsementConfig,
  SourceEndorsement,
  CredibilityScore,
  SourceInfo,
  EndorsedRetrievalResult,
} from './types';
import { FeedbackStore } from './FeedbackStore';
import type { SemanticSearchResult } from '../models/RAGQuery';

/**
 * Endorsement Engine
 * Calculates credibility scores and reranks results based on source trustworthiness
 */
export class EndorsementEngine {
  private config: EndorsementConfig;
  private feedbackStore: FeedbackStore;

  constructor(config: EndorsementConfig) {
    this.config = config;
    this.feedbackStore = new FeedbackStore(config.feedbackStoragePath);
  }

  /**
   * Evaluate credibility of a source
   */
  evaluateSource(source: SourceInfo): CredibilityScore {
    // 1. Base score from config
    const baseScore = this.getBaseScore(source);

    // 2. Temporal decay
    const ageInYears = this.calculateAge(source.updatedAt);
    const sourceConfig = this.getSourceConfig(source);
    const decay = sourceConfig?.temporalDecay || 0;
    const temporalDecay = Math.max(0, 1 - ageInYears * decay);

    // 3. Contextual fit
    const contextualFit = this.calculateContextFit(source, sourceConfig);

    // 4. User feedback
    const userFeedback = this.feedbackStore.getScore(source.id);

    // 5. Final score
    const finalScore = baseScore * temporalDecay * contextualFit * userFeedback;

    return {
      source: source.id,
      baseScore,
      temporalDecay,
      contextualFit,
      userFeedback,
      finalScore,
      updatedAt: new Date(),
    };
  }

  /**
   * Rerank results with endorsement scores
   */
  rerank(
    results: SemanticSearchResult[],
    weights?: { embedding: number; credibility: number }
  ): EndorsedRetrievalResult[] {
    const w = weights || this.config.weights;

    const endorsed = results.map(result => {
      const source = this.extractSourceInfo(result);
      const credibility = this.evaluateSource(source);

      // Combine embedding score + credibility
      const finalRelevance =
        result.similarity * w.embedding + credibility.finalScore * w.credibility;

      return {
        chunk: {
          id: result.metadata.chunkId || '',
          filePath: result.filePath,
          content: result.content,
          metadata: result.metadata,
        },
        embeddingScore: result.similarity,
        credibilityScore: credibility.finalScore,
        finalRelevance,
        source,
        explanation: this.explainScore(result, credibility),
      };
    });

    // Sort by final relevance
    endorsed.sort((a, b) => b.finalRelevance - a.finalRelevance);

    return endorsed;
  }

  /**
   * Record user feedback
   */
  recordFeedback(sourceId: string, positive: boolean): void {
    this.feedbackStore.record(sourceId, positive);
  }

  /**
   * Get base score from configuration
   */
  private getBaseScore(source: SourceInfo): number {
    const sourceConfig = this.getSourceConfig(source);
    if (!sourceConfig) {
      // Se não encontrou configuração, retornar score neutro
      // Mas verificar se é código fonte (padrão comum)
      if (source.url.match(/\.(ts|tsx|js|jsx)$/)) {
        return 0.9; // Assumir código fonte tem alta credibilidade
      }
      return 0.5; // Default neutral score
    }

    // Normalize from 0-100 to 0-1
    return sourceConfig.credibility / 100;
  }

  /**
   * Get source configuration that matches this source
   */
  private getSourceConfig(source: SourceInfo): SourceEndorsement | undefined {
    return this.config.sources.find(s =>
      s.patterns.some(pattern => micromatch.isMatch(source.url, pattern))
    );
  }

  /**
   * Calculate age in years
   */
  private calculateAge(date: Date): number {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
    return diffYears;
  }

  /**
   * Calculate contextual fit
   */
  private calculateContextFit(
    source: SourceInfo,
    sourceConfig?: SourceEndorsement
  ): number {
    if (!sourceConfig?.contexts || sourceConfig.contexts.length === 0) {
      return 1.0; // No context restriction = perfect fit
    }

    if (!source.context) {
      return 0.8; // Slight penalty if no context specified
    }

    // Check if source context matches any configured contexts
    // Also check if the URL/path contains context keywords
    const contextStr = (source.context || source.url || '').toLowerCase();
    const matches = sourceConfig.contexts.some(ctx => {
      const ctxLower = ctx.toLowerCase();
      // Check if context string contains the keyword
      return contextStr.includes(ctxLower);
    });

    // If no match, check if URL path suggests documentation (docs/, readme, etc.)
    if (!matches && source.url) {
      const urlLower = source.url.toLowerCase();
      const isDocs = urlLower.includes('/docs/') || 
                     urlLower.includes('readme') || 
                     urlLower.endsWith('.md');
      if (isDocs && sourceConfig.name === 'official-docs') {
        return 1.0; // Perfect fit for docs
      }
    }

    return matches ? 1.0 : 0.7;
  }

  /**
   * Extract source information from result
   */
  private extractSourceInfo(result: SemanticSearchResult): SourceInfo {
    // Try to extract source from file path or metadata
    const url = result.filePath;
    const sourceName = this.extractSourceName(url);

    return {
      id: result.metadata.chunkId || result.filePath,
      name: sourceName,
      url,
      updatedAt: new Date(), // TODO: Extract from metadata if available
      context: result.metadata.directory,
    };
  }

  /**
   * Extract source name from URL/path
   */
  private extractSourceName(url: string): string {
    // Try to extract domain or path component
    if (url.includes('://')) {
      try {
        const urlObj = new URL(url);
        return urlObj.hostname;
      } catch {
        // Invalid URL, use path
      }
    }

    // Use directory name or file name
    const parts = url.split('/');
    return parts[parts.length - 2] || parts[parts.length - 1] || 'unknown';
  }

  /**
   * Explain score calculation (for debugging)
   */
  private explainScore(
    result: SemanticSearchResult,
    credibility: CredibilityScore
  ): string {
    return `
Score breakdown:
  • Embedding similarity: ${result.similarity.toFixed(2)}
  • Source credibility: ${credibility.finalScore.toFixed(2)}
    - Base: ${credibility.baseScore.toFixed(2)} (${credibility.source})
    - Temporal: ${credibility.temporalDecay.toFixed(2)} (updated ${this.formatAge(
      result.metadata
    )})
    - Context fit: ${credibility.contextualFit.toFixed(2)}
    - User feedback: ${credibility.userFeedback.toFixed(2)}
  • Final relevance: ${(
    result.similarity * this.config.weights.embedding +
    credibility.finalScore * this.config.weights.credibility
  ).toFixed(2)}
    `.trim();
  }

  /**
   * Format age for display
   */
  private formatAge(metadata: any): string {
    // TODO: Extract actual update time from metadata
    return 'recently';
  }
}

