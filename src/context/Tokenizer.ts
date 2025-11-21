/**
 * Simple Tokenizer
 * Estimates token count (approximate, ~4 chars per token for English)
 */
export class Tokenizer {
  /**
   * Count tokens in text (approximate)
   */
  count(text: string): number {
    // Simple heuristic: ~4 characters per token
    // This is approximate and works reasonably well for English code
    return Math.ceil(text.length / 4);
  }

  /**
   * Count tokens for multiple texts
   */
  countBatch(texts: string[]): number {
    return texts.reduce((sum, text) => sum + this.count(text), 0);
  }
}

