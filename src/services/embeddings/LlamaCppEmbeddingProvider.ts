import type { IEmbeddingProvider } from '../../interfaces/IEmbeddingProvider';
import * as fs from 'fs';
import * as path from 'path';

// Dynamic import to avoid issues if node-llama-cpp is not available
let nodeLlamaCpp: any = null;

/**
 * Llama.cpp embedding provider
 * Uses llama.cpp directly via node-llama-cpp for embeddings
 * More performant than Ollama, runs entirely in-process
 * 
 * Requires a GGUF model file to be downloaded/available
 * Recommended models: nomic-embed-text, mxbai-embed-large, etc.
 */
export class LlamaCppEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'llama-cpp';
  readonly dimensions: number;
  readonly maxTokens: number;

  private modelPath: string;
  private llama: any = null;
  private model: any = null; // LlamaModel
  private context: any = null; // LlamaContext
  private initialized: boolean = false;
  private isNomicEmbedCode: boolean = false; // Detecta se é o modelo nomic-embed-code
  private isJinaCodeEmbeddings: boolean = false; // Detecta se é o modelo jina-code-embeddings

  constructor(config: {
    modelPath: string;
    dimensions?: number;
    maxTokens?: number;
  }) {
    if (!config.modelPath) {
      throw new Error('modelPath is required for LlamaCppEmbeddingProvider');
    }

    // Check if model file exists
    if (!fs.existsSync(config.modelPath)) {
      throw new Error(
        `Model file not found: ${config.modelPath}\n` +
        `Please download a GGUF embedding model (e.g., nomic-embed-text) and provide the path.`
      );
    }

    this.modelPath = path.resolve(config.modelPath);
    this.dimensions = config.dimensions || 768; // Default, will be updated when model loads
    
    // Para modelos Jina, usar limite menor (512 tokens)
    // Para outros modelos, usar 8192 como padrão
    if (this.isJinaCodeEmbeddings) {
      this.maxTokens = config.maxTokens || 512;
    } else {
      this.maxTokens = config.maxTokens || 8192;
    }
    
    // Detectar qual modelo está sendo usado baseado no nome do arquivo
    const modelFileName = path.basename(this.modelPath).toLowerCase();
    this.isNomicEmbedCode = modelFileName.includes('nomic-embed-code');
    this.isJinaCodeEmbeddings = modelFileName.includes('jina-code-embeddings');
    
    // Ajustar dimensões padrão baseado no modelo
    if (this.isJinaCodeEmbeddings && !config.dimensions) {
      (this as any).dimensions = 896; // Jina Code Embeddings tem 896 dimensões
    }
  }

  /**
   * Load node-llama-cpp dynamically
   * node-llama-cpp is a pure ESM module, so we use dynamic import
   */
  private async loadLlamaCpp(): Promise<void> {
    if (nodeLlamaCpp) {
      return;
    }

    try {
      // Dynamic import works for ESM modules even in CommonJS context
      // The issue is that node-llama-cpp uses top-level await which requires
      // the importing module to also be ESM or use proper ESM loader
      nodeLlamaCpp = await import('node-llama-cpp');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // More detailed error message for ESM/CommonJS conflicts
      if (errorMessage.includes('top-level await') || errorMessage.includes('ESM') || errorMessage.includes('require()')) {
        throw new Error(
          `Failed to load node-llama-cpp (ESM/CommonJS conflict): ${errorMessage}\n\n` +
          `node-llama-cpp is a pure ESM module that requires ESM execution context.\n\n` +
          `Solutions:\n` +
          `1. Use tsx instead of ts-node: npx tsx test-indexing-local.ts\n` +
          `2. Or configure ts-node for ESM: node --loader ts-node/esm test-indexing-local.ts\n` +
          `3. Or add "type": "module" to package.json and convert project to ESM\n\n` +
          `Make sure node-llama-cpp is installed: npm install node-llama-cpp@3`
        );
      }
      
      throw new Error(
        `Failed to load node-llama-cpp: ${errorMessage}\n` +
        `Make sure node-llama-cpp is installed: npm install node-llama-cpp@3`
      );
    }
  }

  /**
   * Initialize llama.cpp and load the model
   */
  private async initialize(): Promise<void> {
    if (this.initialized && this.model) {
      return; // Already initialized
    }

    try {
      await this.loadLlamaCpp();

      // Get Llama instance
      const { getLlama } = nodeLlamaCpp;
      this.llama = await getLlama();

      // Load the model
      this.model = await this.llama.loadModel({
        modelPath: this.modelPath,
      });

      // Create embedding context (não createContext normal)
      // Para modelos Jina, pode precisar de configuração específica
      // Tentar passar maxTokens se disponível na API
      try {
        this.context = await this.model.createEmbeddingContext({
          maxTokens: this.maxTokens,
        } as any);
      } catch {
        // Se não aceitar parâmetros, usar sem configuração
        this.context = await this.model.createEmbeddingContext();
      }

      // Update dimensions from model if available
      if (this.model.embeddingSize) {
        (this as any).dimensions = this.model.embeddingSize;
      } else if (this.context) {
        // Tentar obter dimensões do contexto
        try {
          const testEmbedding = await this.context.getEmbeddingFor('test');
          if (testEmbedding?.vector) {
            (this as any).dimensions = testEmbedding.vector.length;
          }
        } catch {
          // Ignore se não conseguir
        }
      }

      this.initialized = true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to initialize llama.cpp model at ${this.modelPath}: ${errorMessage}\n` +
        `Make sure:\n` +
        `1. The model file exists and is in GGUF format\n` +
        `2. The model is an embedding model (not a chat model)\n` +
        `3. You have enough RAM/VRAM to load the model`
      );
    }
  }

  /**
   * Adiciona o prefixo necessário baseado no modelo usado
   * - nomic-embed-code: queries começam com "Represent this query for searching relevant code: "
   * - jina-code-embeddings: queries começam com "Find the most relevant code snippet given the following query:\n"
   *                        passages começam com "Candidate code snippet:\n"
   */
  private prepareTextForEmbedding(text: string, isQuery: boolean = false): string {
    if (this.isNomicEmbedCode && isQuery) {
      const queryPrefix = 'Represent this query for searching relevant code: ';
      // Evitar duplicar o prefixo se já estiver presente
      if (!text.trim().startsWith(queryPrefix)) {
        return queryPrefix + text;
      }
    } else if (this.isJinaCodeEmbeddings) {
      if (isQuery) {
        const queryPrefix = 'Find the most relevant code snippet given the following query:\n';
        if (!text.trim().startsWith(queryPrefix)) {
          return queryPrefix + text;
        }
      } else {
        const passagePrefix = 'Candidate code snippet:\n';
        if (!text.trim().startsWith(passagePrefix)) {
          return passagePrefix + text;
        }
      }
    }
    return text;
  }

  async embed(text: string, isQuery: boolean = false): Promise<number[]> {
    const results = await this.embedBatch([text], isQuery);
    return results[0];
  }

  async embedBatch(texts: string[], isQuery: boolean = false): Promise<number[][]> {
    // Initialize if needed
    await this.initialize();

    if (!this.model || !this.context) {
      throw new Error('Model not initialized');
    }

    const embeddings: number[][] = [];

    for (const text of texts) {
      try {
        // Preparar o texto (adicionar prefixo se necessário para nomic-embed-code)
        let preparedText = this.prepareTextForEmbedding(text, isQuery);
        
        // Truncar texto se exceder maxTokens (estimativa: ~4 chars por token)
        // Deixar margem de segurança (70% do limite para evitar problemas)
        const maxChars = Math.floor(this.maxTokens * 0.7 * 4);
        if (preparedText.length > maxChars) {
          preparedText = preparedText.substring(0, maxChars);
        }
        
        // Validar que o texto não está vazio
        if (!preparedText || preparedText.trim().length === 0) {
          throw new Error('Text is empty after preparation');
        }
        
        // Usar a API correta do node-llama-cpp para embeddings
        // Segundo a documentação: context.getEmbeddingFor(text) retorna { vector: number[] }
        // Adicionar timeout e tratamento de erro mais robusto
        let embeddingResult: any;
        try {
          embeddingResult = await Promise.race([
            this.context.getEmbeddingFor(preparedText),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Embedding timeout after 30s')), 30000)
            ),
          ]) as any;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          // Se for erro fatal do llama.cpp, tentar recriar o contexto
          if (errorMsg.includes('fatal') || errorMsg.includes('llama-context')) {
            console.error(`⚠️  Erro fatal no llama.cpp ao processar texto de ${text.length} chars. Tentando recriar contexto...`);
            // Tentar recriar o contexto
            try {
              if (this.context) {
                await this.dispose();
              }
              await this.initialize();
              // Tentar novamente com texto menor
              const smallerText = preparedText.substring(0, Math.floor(maxChars * 0.5));
              embeddingResult = await this.context.getEmbeddingFor(smallerText);
            } catch (retryError) {
              throw new Error(`Failed to generate embedding after retry: ${errorMsg}. Original error: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
            }
          } else {
            throw error;
          }
        }
        
        if (!embeddingResult || !embeddingResult.vector || !Array.isArray(embeddingResult.vector)) {
          throw new Error('Invalid embedding response from model - expected { vector: number[] }');
        }

        // Extrair o array de números do vector
        const embedding = Array.from(embeddingResult.vector).map(v => 
          typeof v === 'number' ? v : parseFloat(String(v))
        );

        embeddings.push(embedding);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to generate embedding: ${errorMessage}`);
      }
    }

    return embeddings;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.initialize();
      return this.model !== null && this.context !== null;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.context) {
      try {
        if (typeof this.context.dispose === 'function') {
          await this.context.dispose();
        }
      } catch {
        // Ignore disposal errors
      }
      this.context = null;
    }

    if (this.model) {
      try {
        if (typeof this.model.dispose === 'function') {
          await this.model.dispose();
        }
      } catch {
        // Ignore disposal errors
      }
      this.model = null;
    }

    this.llama = null;
    this.initialized = false;
  }
}

