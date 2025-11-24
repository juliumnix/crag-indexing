import type { SemanticSearchResult } from '../model/RAGQuery';
import type { Conflict, ConflictSource } from './types';
import { ConflictLevel } from './types';

/**
 * Conflict Detector
 * Detects contradictions between sources
 */
export class ConflictDetector {
  /**
   * Detect conflicts in results
   */
  detectConflicts(results: SemanticSearchResult[]): Conflict[] {
    const conflicts: Conflict[] = [];

    // Compare each pair of chunks
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const conflict = this.compareChunks(results[i], results[j]);
        if (conflict) {
          conflicts.push(conflict);
        }
      }
    }

    return conflicts;
  }

  /**
   * Compare two chunks for conflicts
   */
  private compareChunks(a: SemanticSearchResult, b: SemanticSearchResult): Conflict | null {
    // 1. Version conflict
    const aVersion = (a.metadata as any).version;
    const bVersion = (b.metadata as any).version;

    if (aVersion && bVersion && aVersion !== bVersion) {
      return {
        level: ConflictLevel.WARNING,
        title: 'Version mismatch',
        description: `Different versions detected: ${aVersion} vs ${bVersion}`,
        sources: [
          {
            chunkId: a.metadata.chunkId || '',
            content: a.content,
            source: a.filePath,
            version: aVersion,
          },
          {
            chunkId: b.metadata.chunkId || '',
            content: b.content,
            source: b.filePath,
            version: bVersion,
          },
        ],
        detected: new Date(),
      };
    }

    // 2. Critical conflict (contradictory)
    if (this.isContradictory(a.content, b.content)) {
      return {
        level: ConflictLevel.CRITICAL,
        title: 'Contradictory information',
        description: 'Sources provide opposite information',
        sources: [
          {
            chunkId: a.metadata.chunkId || '',
            content: a.content,
            source: a.filePath,
          },
          {
            chunkId: b.metadata.chunkId || '',
            content: b.content,
            source: b.filePath,
          },
        ],
        detected: new Date(),
      };
    }

    return null;
  }

  /**
   * Check if texts are contradictory
   */
  private isContradictory(a: string, b: string): boolean {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    const negations = ['not', 'never', 'no', 'false', 'incorrect', 'wrong'];
    const hasNegationA = negations.some(n => aLower.includes(n));
    const hasNegationB = negations.some(n => bLower.includes(n));

    // If one has negation and other doesn't, might be contradictory
    if (hasNegationA !== hasNegationB) {
      const similarity = this.calculateSimilarity(
        aLower.replace(/not|never|no|false/g, ''),
        bLower.replace(/not|never|no|false/g, '')
      );

      return similarity > 0.7; // Similar content but negated
    }

    return false;
  }

  /**
   * Calculate similarity between texts
   */
  private calculateSimilarity(a: string, b: string): number {
    const tokensA = new Set(a.split(/\s+/));
    const tokensB = new Set(b.split(/\s+/));

    const intersection = new Set([...tokensA].filter(x => tokensB.has(x)));
    const union = new Set([...tokensA, ...tokensB]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }
}

