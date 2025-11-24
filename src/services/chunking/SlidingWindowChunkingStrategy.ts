import { createHash } from 'crypto';
import type { IChunkingStrategy } from '../../interfaces/IChunkingStrategy';
import type { CodeChunk } from '../../model/CodeChunk';

/**
 * Sliding window chunking strategy
 * Creates overlapping chunks of fixed size
 * This helps preserve context across chunk boundaries
 */
export class SlidingWindowChunkingStrategy implements IChunkingStrategy {
  readonly name = 'sliding-window';

  private maxChunkSize: number;
  private chunkOverlap: number;

  constructor(config: { maxChunkSize?: number; chunkOverlap?: number } = {}) {
    this.maxChunkSize = config.maxChunkSize || 50; // lines
    this.chunkOverlap = config.chunkOverlap || 10; // lines
  }

  async chunk(filePath: string, content: string, language: string): Promise<CodeChunk[]> {
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];

    if (lines.length <= this.maxChunkSize) {
      // File is small enough, return as single chunk
      return [
        {
          id: this.generateChunkId(filePath, 0),
          filePath,
          content,
          startLine: 1,
          endLine: lines.length,
          language,
        },
      ];
    }

    const step = this.maxChunkSize - this.chunkOverlap;
    let chunkIndex = 0;

    for (let i = 0; i < lines.length; i += step) {
      const endIdx = Math.min(i + this.maxChunkSize, lines.length);
      const chunkLines = lines.slice(i, endIdx);
      const chunkContent = chunkLines.join('\n');

      chunks.push({
        id: this.generateChunkId(filePath, chunkIndex),
        filePath,
        content: chunkContent,
        startLine: i + 1,
        endLine: endIdx,
        language,
      });

      chunkIndex++;

      // Break if we've reached the end
      if (endIdx >= lines.length) {
        break;
      }
    }

    return chunks;
  }

  private generateChunkId(filePath: string, index: number): string {
    const hash = createHash('sha256')
      .update(`${filePath}:${index}`)
      .digest('hex')
      .substring(0, 8);
    return `chunk-${index}-${hash}`;
  }
}

