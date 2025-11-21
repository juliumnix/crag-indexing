/**
 * Exemplo de uso do URL Indexing com Tavily
 * 
 * Este exemplo mostra como:
 * 1. Indexar URLs públicas usando Tavily
 * 2. Configurar endorsement para dar credibilidade a essas fontes
 * 3. Buscar no conteúdo indexado
 */

import { CRAGCore } from '../src/core/index';

async function main() {
  console.log('🌐 Exemplo de Indexação de URLs com Tavily\n');

  // Configurar CRAGCore com URL indexing
  const rag = new CRAGCore({
    projectPath: './examples',
    projectId: 'url-indexing-example',
    
    embedding: {
      type: 'llama-cpp',
      modelPath: './models/jina-code-embeddings-0.5b-Q4_K_M.gguf',
      dimensions: 896,
    },
    
    vectorDatabase: {
      type: 'json',
      storagePath: '.crag_cache',
      persist: true,
    },
    
    indexing: {
      excludeDirectories: ['node_modules', '.git'],
      chunkingStrategy: 'ast',
    },
    
    // 🆕 Configuração de URL Indexing
    urlIndexing: {
      tavilyApiKey: process.env.TAVILY_API_KEY || '', // Obter em https://tavily.com
      urls: [
        'https://docs.nextjs.org/docs/getting-started',
        'https://react.dev/learn',
        'https://www.typescriptlang.org/docs/',
        // Adicione mais URLs públicas aqui
      ],
      storagePath: '.crag/urls', // Onde salvar o conteúdo extraído
    },
    
    // 🆕 Configuração de Endorsement para URLs
    endorsement: {
      sources: [
        {
          name: 'nextjs-docs',
          patterns: ['**/urls/nextjs-org-*/**'], // Match com arquivos do Next.js
          credibility: 95,
          contexts: ['documentation', 'framework'],
        },
        {
          name: 'react-docs',
          patterns: ['**/urls/react-dev-*/**'], // Match com arquivos do React
          credibility: 95,
          contexts: ['documentation', 'library'],
        },
        {
          name: 'typescript-docs',
          patterns: ['**/urls/typescriptlang-org-*/**'], // Match com TypeScript
          credibility: 100,
          contexts: ['documentation', 'language'],
        },
        {
          name: 'external-docs',
          patterns: ['**/urls/**'], // Match com qualquer URL indexada
          credibility: 85,
          contexts: ['documentation'],
        },
      ],
      weights: {
        embedding: 0.6,
        credibility: 0.4,
      },
      feedbackStoragePath: '.crag/feedback',
    },
  });

  try {
    // 1. Indexar URLs (isso baixa o conteúdo usando Tavily e salva como arquivos)
    console.log('📥 Indexando URLs públicas...\n');
    const indexedUrls = await rag.indexURLs();
    
    console.log(`✅ ${indexedUrls.length} URLs indexadas:`);
    indexedUrls.forEach(({ url, filePath }) => {
      console.log(`   - ${url}`);
      console.log(`     → ${filePath}\n`);
    });

    // 2. Indexar o projeto (incluindo os arquivos baixados das URLs)
    console.log('📦 Indexando projeto (incluindo URLs)...\n');
    const repository = await rag.index();
    
    console.log(`✅ Indexação concluída!`);
    console.log(`   - Arquivos: ${repository.totalFiles}`);
    console.log(`   - Vetores: ${repository.totalVectors}\n`);

    // 3. Buscar no conteúdo indexado (incluindo URLs)
    console.log('🔍 Buscando no conteúdo indexado...\n');
    
    const results = await rag.query({
      text: 'como usar hooks no React?',
      topK: 5,
      endorsement: {
        enabled: true,
        minCredibility: 0.8,
      },
    });

    console.log(`📊 Encontrados ${results.length} resultados:\n`);
    results.forEach((result, i) => {
      const fileName = result.filePath.split('/').pop();
      const isFromURL = result.filePath.includes('/urls/');
      
      console.log(`${i + 1}. [${(result.finalRelevance || result.similarity) * 100}%] ${fileName}`);
      if (isFromURL) {
        console.log(`   🌐 Fonte: URL indexada`);
      }
      if (result.credibilityScore) {
        console.log(`   📈 Credibilidade: ${(result.credibilityScore * 100).toFixed(1)}%`);
      }
      console.log(`   📝 ${result.content.substring(0, 100)}...\n`);
    });

  } catch (error) {
    console.error('❌ Erro:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Executar se for chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

export { main };

