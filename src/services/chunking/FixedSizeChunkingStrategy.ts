import { createHash } from 'crypto';
import type { IChunkingStrategy } from '../../interfaces/IChunkingStrategy';
import type { CodeChunk } from '../../model/CodeChunk';

/**
 * Fixed-size chunking strategy
 * Creates non-overlapping chunks of fixed size
 * Simplest strategy, good for very large files
 */
export class FixedSizeChunkingStrategy implements IChunkingStrategy {
  readonly name = 'fixed-size';

  private maxChunkSize: number;

  constructor(config: { maxChunkSize?: number } = {}) {
    this.maxChunkSize = config.maxChunkSize || 100; // lines
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

    let chunkIndex = 0;

    for (let i = 0; i < lines.length; i += this.maxChunkSize) {
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

