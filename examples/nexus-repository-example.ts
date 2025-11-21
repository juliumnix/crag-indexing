/**
 * Exemplo: Indexando Repositório Nexus (Código + Documentação + URLs)
 * 
 * Este exemplo mostra como indexar um repositório que mistura:
 * - Código fonte (TypeScript, JavaScript)
 * - Documentação local (Markdown)
 * - Documentação externa via URLs (usando Tavily)
 */

import * as fs from 'fs';
import * as path from 'path';
import { CRAGCore } from '../src/core/index';

async function main() {
  console.log('🚀 Indexando Repositório Nexus\n');
  console.log('Este exemplo indexa:');
  console.log('  ✅ Código fonte (.ts, .js, etc.)');
  console.log('  ✅ Documentação local (.md)');
  console.log('  ✅ Documentação externa (URLs via Tavily)\n');

  // Resolver caminho do projeto (pode ser relativo ou absoluto)
  // Aceita como argumento da linha de comando ou usa caminho padrão
  let projectPath = process.argv[2];
  
  if (!projectPath) {
    // Tentar caminhos comuns
    const possiblePaths = [
      path.resolve(process.cwd(), '../../../.nexus'),
      path.resolve(process.cwd(), '../../nexus'),
      path.resolve(process.cwd(), '../nexus'),
      path.resolve(process.cwd(), 'nexus'),
    ];
    
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        projectPath = possiblePath;
        break;
      }
    }
  }
  
  if (!projectPath) {
    console.error('❌ Caminho do projeto não especificado e não encontrado nos caminhos padrão');
    console.error('\n💡 Uso:');
    console.error('   tsx examples/nexus-repository-example.ts <caminho-do-projeto>');
    console.error('\n   Exemplo:');
    console.error('   tsx examples/nexus-repository-example.ts C:/Users/tftum/developer/nexus');
    console.error('   ou');
    console.error('   tsx examples/nexus-repository-example.ts ./nexus');
    process.exit(1);
  }
  
  // Resolver caminho absoluto
  projectPath = path.resolve(projectPath);
  
  // Verificar se o caminho existe
  if (!fs.existsSync(projectPath)) {
    console.error(`❌ Caminho do projeto não encontrado: ${projectPath}`);
    process.exit(1);
  }
  
  console.log(`📂 Projeto: ${projectPath}\n`);

  const rag = new CRAGCore({
    projectPath: projectPath,
    projectId: 'nexus-repo',
    
    embedding: {
      type: 'llama-cpp',
      modelPath: './models/jina-code-embeddings-0.5b-Q8_0.gguf',
      dimensions: 896,
      maxTokens: 512, // Jina Code Embeddings tem limite menor
    },
    
    vectorDatabase: {
      type: 'json',
      storagePath: '.crag_cache',
      persist: true,
    },
    
    indexing: {
      excludeDirectories: ['node_modules', '.git', 'dist', 'build'],
      buildDependencyGraph: true,
      chunkingStrategy: 'ast',
      // Markdown será incluído automaticamente se houver URL indexing
    },
    
    // 🆕 Indexar URLs públicas de documentação
    urlIndexing: {
      tavilyApiKey: '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',
      urls: [
        // Documentação oficial do framework/biblioteca
        'https://docs.nextjs.org/docs/getting-started',
        'https://react.dev/learn',
        'https://www.apollographql.com/docs/what-is-apollo'
      ],
      storagePath: '.crag/urls', // Salva dentro do projeto
      cacheExpirationMonths: 3, // Cache de 3 meses (padrão)
    },
    
    // 🆕 Endorsement: Diferentes credibilidades para diferentes fontes
    endorsement: {
      sources: [
        {
          name: 'source-code',
          patterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
          credibility: 95, // Código fonte tem alta credibilidade
          contexts: ['code', 'implementation'],
        },
        {
          name: 'local-docs',
          patterns: ['**/*.md', '**/docs/**', '**/README.md'],
          credibility: 90, // Documentação local também é confiável
          contexts: ['documentation', 'local'],
        },
        {
          name: 'nextjs-docs',
          patterns: ['**/urls/nextjs-org-*/**'],
          credibility: 95, // Docs oficiais do Next.js
          contexts: ['documentation', 'framework'],
        },
        {
          name: 'react-docs',
          patterns: ['**/urls/react-dev-*/**'],
          credibility: 95, // Docs oficiais do React
          contexts: ['documentation', 'library'],
        },
        {
          name: 'external-docs',
          patterns: ['**/urls/**'], // Qualquer outra URL indexada
          credibility: 85,
          contexts: ['documentation', 'external'],
        },
      ],
      weights: {
        embedding: 0.6,
        credibility: 0.4,
      },
      feedbackStoragePath: '.crag/feedback',
    },
    
    versioning: {
      enabled: true,
      detectFromGit: true,
    },
    
    contextBudget: {
      defaultMaxTokens: 20000,
      defaultReservedTokens: 2000,
    },
    
    observability: {
      enabled: true,
      traceStorage: '.crag/traces',
    },
  });

  try {
    console.log('📥 Passo 1: Indexando URLs públicas...\n');
    const indexedUrls = await rag.indexURLs();
    
    // Separar URLs por cache vs atualizadas
    const cached = indexedUrls.filter(u => u.cached);
    const updated = indexedUrls.filter(u => !u.cached);
    
    console.log(`✅ ${indexedUrls.length} URLs processadas:`);
    console.log(`   📦 ${cached.length} do cache (sem chamar Tavily)`);
    console.log(`   🔄 ${updated.length} atualizadas (chamadas ao Tavily)\n`);

    console.log('📦 Passo 2: Indexando repositório (código + docs locais + URLs)...\n');
    const repository = await rag.index();
    
    console.log(`\n✅ Indexação concluída!`);
    console.log(`   - Arquivos totais: ${repository.totalFiles}`);
    console.log(`   - Vetores criados: ${repository.totalVectors}`);
    console.log(`   - Inclui: código, documentação local e URLs externas\n`);

    // Exemplo de busca que pode encontrar resultados de qualquer fonte
    console.log('🔍 Exemplo de busca...\n');
    
    // Primeiro, testar sem filtro de credibilidade para ver todos os resultados
    console.log('📋 Teste 1: Busca sem filtro de credibilidade\n');
    let results = await rag.query({
      text: 'como fazer autenticação?',
      topK: 10,
    });
    
    console.log(`📊 Encontrados ${results.length} resultados (sem filtro):\n`);
    results.forEach((result, i) => {
      const fileName = result.filePath.split(/[/\\]/).pop();
      const isCode = /\.(ts|tsx|js|jsx)$/.test(result.filePath);
      const isLocalDoc = result.filePath.includes('.md') && !result.filePath.includes('/urls/') && !result.filePath.includes('\\urls\\');
      const isFromURL = result.filePath.includes('/urls/') || result.filePath.includes('\\urls\\');
      
      let sourceType = '📄';
      if (isCode) sourceType = '💻';
      else if (isLocalDoc) sourceType = '📝';
      else if (isFromURL) sourceType = '🌐';
      
      console.log(`${i + 1}. ${sourceType} [${(result.similarity * 100).toFixed(1)}%] ${fileName}`);
      console.log(`   📂 ${result.filePath}`);
      if (result.credibilityScore) {
        console.log(`   📈 Credibilidade: ${(result.credibilityScore * 100).toFixed(1)}%`);
      }
      if (result.metadata?.startLine && result.metadata?.endLine) {
        console.log(`   📍 Linhas: ${result.metadata.startLine}-${result.metadata.endLine}`);
      }
      console.log(`   📝 ${result.content.substring(0, 80)}...\n`);
    });
    
    // Agora testar com endorsement (mas com credibilidade mínima mais baixa)
    console.log('\n📋 Teste 2: Busca com endorsement (minCredibility: 0.5)\n');
    results = await rag.query({
      text: 'como fazer autenticação?',
      topK: 5,
      endorsement: {
        enabled: true,
        minCredibility: 0.5, // Reduzido de 0.8 para 0.5
      },
    });

    console.log(`📊 Encontrados ${results.length} resultados com endorsement:\n`);
    results.forEach((result, i) => {
      const fileName = result.filePath.split(/[/\\]/).pop();
      const isCode = /\.(ts|tsx|js|jsx)$/.test(result.filePath);
      const isLocalDoc = result.filePath.includes('.md') && !result.filePath.includes('/urls/') && !result.filePath.includes('\\urls\\');
      const isFromURL = result.filePath.includes('/urls/') || result.filePath.includes('\\urls\\');
      
      let sourceType = '📄';
      if (isCode) sourceType = '💻';
      else if (isLocalDoc) sourceType = '📝';
      else if (isFromURL) sourceType = '🌐';
      
      const relevance = result.finalRelevance || result.similarity || 0;
      console.log(`${i + 1}. ${sourceType} [${(relevance * 100).toFixed(1)}%] ${fileName}`);
      console.log(`   📂 ${result.filePath}`);
      if (result.credibilityScore !== undefined) {
        console.log(`   📈 Credibilidade: ${(result.credibilityScore * 100).toFixed(1)}%`);
      }
      if (result.embeddingScore !== undefined) {
        console.log(`   🔢 Embedding Score: ${(result.embeddingScore * 100).toFixed(1)}%`);
      }
      if (result.metadata?.startLine && result.metadata?.endLine) {
        console.log(`   📍 Linhas: ${result.metadata.startLine}-${result.metadata.endLine}`);
      }
      console.log(`   📝 ${result.content.substring(0, 80)}...\n`);
    });

  } catch (error) {
    console.error('❌ Erro:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { main };

