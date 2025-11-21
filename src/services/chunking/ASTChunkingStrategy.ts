import { createHash } from 'crypto';
import type { IChunkingStrategy } from '../../interfaces/IChunkingStrategy';
import type { CodeChunk } from '../../models/CodeChunk';

/**
 * AST-based chunking strategy (Simplified version using regex)
 * Attempts to parse code and create chunks based on function/class boundaries
 * This preserves code structure when possible
 */
export class ASTChunkingStrategy implements IChunkingStrategy {
  readonly name = 'ast';

  async chunk(filePath: string, content: string, language: string): Promise<CodeChunk[]> {
    try {
      // Try to extract functions and classes using regex
      const chunks = this.extractCodeBlocks(filePath, content, language);
      
      if (chunks.length > 0) {
        return chunks;
      }
      
      // Fallback: return entire file as single chunk
      return [this.createFallbackChunk(filePath, content, language)];
    } catch (error) {
      // If parsing fails, fall back to a single chunk with the entire file
      return [this.createFallbackChunk(filePath, content, language)];
    }
  }

  private extractCodeBlocks(filePath: string, content: string, language: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    
    // Patterns for different code structures
    const functionPattern = /^(\s*)(export\s+)?(async\s+)?function\s+(\w+)/;
    const arrowFunctionPattern = /^(\s*)(export\s+)?const\s+(\w+)\s*=\s*(\([^)]*\)|[^\s]+)\s*=>/;
    const classPattern = /^(\s*)(export\s+)?(abstract\s+)?class\s+(\w+)/;
    const interfacePattern = /^(\s*)(export\s+)?interface\s+(\w+)/;
    const typePattern = /^(\s*)(export\s+)?type\s+(\w+)/;
    
    let currentChunk: { startLine: number; endLine: number; content: string; astNode?: string } | null = null;
    let braceDepth = 0;
    let chunkIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if this line starts a new code block
      let match = line.match(functionPattern) || 
                  line.match(arrowFunctionPattern) || 
                  line.match(classPattern) ||
                  line.match(interfacePattern) ||
                  line.match(typePattern);
      
      if (match && currentChunk === null) {
        // Determine the node type
        let astNode = 'code_block';
        if (line.includes('function')) astNode = 'function';
        else if (line.includes('class')) astNode = 'class';
        else if (line.includes('interface')) astNode = 'interface';
        else if (line.includes('type')) astNode = 'type';
        
        currentChunk = {
          startLine: i + 1,
          endLine: i + 1,
          content: line,
          astNode,
        };
        braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      } else if (currentChunk) {
        // Continue current chunk
        currentChunk.content += '\n' + line;
        currentChunk.endLine = i + 1;
        braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        
        // End chunk when braces are balanced (for JS/TS)
        if (braceDepth === 0 && (line.includes('}') || line.match(/;$/))) {
          let chunkContent = currentChunk.content;
          // Limitar tamanho do chunk (máximo ~100k caracteres)
          const maxChars = 100000;
          if (chunkContent.length > maxChars) {
            chunkContent = chunkContent.substring(0, maxChars);
            const truncatedLines = chunkContent.split('\n');
            currentChunk.endLine = currentChunk.startLine + truncatedLines.length - 1;
          }
          
          chunks.push({
            id: this.generateChunkId(filePath, chunkIndex),
            filePath,
            content: chunkContent,
            startLine: currentChunk.startLine,
            endLine: currentChunk.endLine,
            astNode: currentChunk.astNode,
            language,
          });
          currentChunk = null;
          chunkIndex++;
        }
      }
    }
    
    // Add any remaining chunk
    if (currentChunk) {
      let chunkContent = currentChunk.content;
      // Limitar tamanho do chunk (máximo ~100k caracteres)
      const maxChars = 100000;
      if (chunkContent.length > maxChars) {
        chunkContent = chunkContent.substring(0, maxChars);
        const truncatedLines = chunkContent.split('\n');
        currentChunk.endLine = currentChunk.startLine + truncatedLines.length - 1;
      }
      
      chunks.push({
        id: this.generateChunkId(filePath, chunkIndex),
        filePath,
        content: chunkContent,
        startLine: currentChunk.startLine,
        endLine: currentChunk.endLine,
        astNode: currentChunk.astNode,
        language,
      });
    }
    
    // If we couldn't extract any meaningful chunks, split by size
    if (chunks.length === 0) {
      return this.fallbackToFixedSize(filePath, content, language);
    }
    
    return chunks;
  }

  private fallbackToFixedSize(filePath: string, content: string, language: string): CodeChunk[] {
    const maxLines = 50;
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    
    for (let i = 0; i < lines.length; i += maxLines) {
      const endIdx = Math.min(i + maxLines, lines.length);
      const chunkLines = lines.slice(i, endIdx);
      const chunkContent = chunkLines.join('\n');
      
      chunks.push({
        id: this.generateChunkId(filePath, chunks.length),
        filePath,
        content: chunkContent,
        startLine: i + 1,
        endLine: endIdx,
        language,
      });
    }
    
    return chunks;
  }

  private createFallbackChunk(filePath: string, content: string, language: string): CodeChunk {
    // Limitar tamanho do chunk para evitar problemas com modelos de embedding
    // Máximo de ~2000 linhas ou ~100k caracteres
    const maxLines = 2000;
    const maxChars = 100000;
    let finalContent = content;
    let finalEndLine = content.split('\n').length;
    
    if (finalEndLine > maxLines || content.length > maxChars) {
      finalContent = content.split('\n').slice(0, maxLines).join('\n');
      if (finalContent.length > maxChars) {
        finalContent = finalContent.substring(0, maxChars);
        finalEndLine = finalContent.split('\n').length;
      } else {
        finalEndLine = maxLines;
      }
    }
    
    return {
      id: 'full-file',
      filePath,
      content: finalContent,
      startLine: 1,
      endLine: finalEndLine,
      language,
    };
  }

  private generateChunkId(filePath: string, index: number): string {
    const hash = createHash('sha256')
      .update(`${filePath}:${index}`)
      .digest('hex')
      .substring(0, 8);
    return `chunk-${index}-${hash}`;
  }
}

