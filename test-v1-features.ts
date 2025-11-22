import { CRAGCore } from './src/core/index';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { randomUUID } from 'crypto';

// Carregar variáveis de ambiente do arquivo .env
function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      // Ignorar comentários e linhas vazias
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        
        // Remover aspas se houver
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        // Só definir se não existir já (variáveis de ambiente têm prioridade)
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

// Carregar .env no início
loadEnvFile();

/**
 * Script de Teste para CRAG Indexing v1.0
 *
 * Testa todas as novas features:
 * - Endorsed Retrieval
 * - Version-Aware RAG
 * - Context Budget Manager
 * - Observability
 * - Conflict Detection
 * - Source Deprecation
 * - 🆕 Arquitetura Extensível (Content Sources)
 *
 * Permite escolher entre modelos de embedding:
 * - nomic-embed-code (pesado, ~4GB)
 * - jina-code-embeddings-0.5b (leve, ~300-500MB)
 */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}


async function tryDownloadJinaModel(
  fileName: string,
  accessToken: string,
  targetPath: string
): Promise<boolean> {
  try {
    const { downloadFileToCacheDir } = await import('@huggingface/hub');
    
    const downloadOptions = {
      repo: 'jinaai/jina-code-embeddings-0.5b-GGUF',
      path: fileName,
      accessToken: accessToken,
    };

    const downloadedPath = await downloadFileToCacheDir(downloadOptions);

    // Copiar do cache para o destino final
    if (downloadedPath !== targetPath) {
      fs.copyFileSync(downloadedPath, targetPath);
    }

    return true;
  } catch (error) {
    return false;
  }
}

async function downloadJinaModel(): Promise<string> {
  const modelDir = './models';
  
  // Verificar se há qualquer arquivo .gguf do Jina
  if (fs.existsSync(modelDir)) {
    const files = fs.readdirSync(modelDir).filter(f => 
      f.endsWith('.gguf') && f.toLowerCase().includes('jina')
    );
    if (files.length > 0) {
      const foundPath = path.join(modelDir, files[0]);
      console.log(`✅ Modelo encontrado: ${files[0]}`);
      return foundPath;
    }
  }

  // Modelo não encontrado - usar a mesma abordagem do download-model.ts
  console.log('\n📥 Modelo Jina não encontrado.');
  console.log('   Baixando usando a mesma abordagem do download-model.ts...\n');

  // Criar diretório se não existir
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  // Tentar diferentes nomes de arquivo baseado na documentação
  // Da documentação: jina-code-embeddings-0.5b-F16.gguf é mencionado
  const modelFiles = [
    'jina-code-embeddings-0.5b-F16.gguf',      // Mencionado na doc
    'jina-code-embeddings-0.5b-Q8_0.gguf',    // 8-bit
    'jina-code-embeddings-0.5b-Q4_K_M.gguf',  // 4-bit
  ];

  // Obter token (mesma função do download-model.ts)
  const tokenFromEnv = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || process.env.HF_ACCESS_TOKEN;
  
  if (!tokenFromEnv) {
    console.error('❌ Token do HuggingFace necessário!');
    console.error('   Configure: export HF_TOKEN=hf_...');
    console.error('   Ou adicione no arquivo .env: HF_TOKEN=hf_...');
    process.exit(1);
  }

  // Tentar cada arquivo até encontrar um que funcione
  for (const fileName of modelFiles) {
    const targetPath = path.join(modelDir, fileName);
    console.log(`   Tentando baixar ${fileName}...`);
    
    const success = await tryDownloadJinaModel(fileName, tokenFromEnv, targetPath);
    
    if (success && fs.existsSync(targetPath)) {
      console.log(`\n✅ Modelo baixado com sucesso: ${targetPath}`);
      return targetPath;
    } else {
      console.log(`   ⚠️  ${fileName} não encontrado, tentando próximo...`);
    }
  }

  // Se nenhum funcionou
  console.error('\n❌ Não foi possível baixar nenhum arquivo do modelo Jina.');
  console.error('   Verifique os arquivos disponíveis em:');
  console.error('   https://huggingface.co/jinaai/jina-code-embeddings-0.5b-GGUF/tree/main');
  console.error('\n   Baixe manualmente qualquer arquivo .gguf e salve em:');
  console.error(`   ${path.resolve(modelDir)}/`);
  process.exit(1);
}

async function selectModel(): Promise<{ modelPath: string; dimensions: number; name: string }> {
  console.log('\n🤖 Escolha o modelo de embedding:\n');
  console.log('1. jina-code-embeddings-0.5b (RECOMENDADO - leve, ~500MB)');
  console.log('2. nomic-embed-code (pesado, ~4GB)\n');

  while (true) {
    const choice = await prompt('👉 Escolha (1 ou 2): ');
    
    if (choice === '1') {
      const modelPath = await downloadJinaModel();
      return {
        modelPath,
        dimensions: 896, // Jina Code Embeddings tem 896 dimensões
        name: 'jina-code-embeddings-0.5b',
      };
    } else if (choice === '2') {
      const modelPath = './models/nomic-embed-code.Q4_K_M.gguf';
      if (!fs.existsSync(modelPath)) {
        console.error('\n❌ Modelo nomic-embed-code não encontrado!');
        console.error(`   Caminho esperado: ${modelPath}`);
        console.error('\n💡 Execute: npm run download-model');
        continue;
      }
      return {
        modelPath,
        dimensions: 4096, // nomic-embed-code tem 4096 dimensões
        name: 'nomic-embed-code',
      };
    } else {
      console.log('❌ Opção inválida. Escolha 1 ou 2.');
    }
  }
}

async function main() {
  console.log('🚀 CRAG Indexing v1.0 - Teste de Features\n');
  console.log('Features disponíveis:');
  console.log('  ✅ Endorsed Retrieval (credibilidade de fontes)');
  console.log('  ✅ Version-Aware RAG (versionamento)');
  console.log('  ✅ Context Budget Manager (otimização de tokens)');
  console.log('  ✅ Observability (traces e debugging)');
  console.log('  ✅ Conflict Detection (detecção de conflitos)');
  console.log('  ✅ Source Deprecation (tracking de obsoletos)');
  console.log('  ✅ URL Indexing (documentação externa via Tavily)');
  console.log('  🆕 Arquitetura Extensível (Content Sources + Plugins)\n');

  // 1. Selecionar modelo
  const model = await selectModel();
  console.log(`\n✅ Modelo selecionado: ${model.name} (${model.dimensions} dimensões)\n`);

  // 2. Selecionar projeto
  const currentDir = process.cwd();
  const parentDir = path.resolve(currentDir, '..');

  console.log(`📂 Buscando projetos em: ${parentDir}`);

  let projects: string[] = [];
  try {
    const items = fs.readdirSync(parentDir);
    projects = items.filter((item) => {
      const fullPath = path.join(parentDir, item);
      return fs.statSync(fullPath).isDirectory() && !item.startsWith('.');
    });
  } catch (e) {
    console.error('❌ Erro ao ler diretório pai:', e);
    process.exit(1);
  }

  if (projects.length === 0) {
    console.error('❌ Nenhum projeto encontrado no diretório pai.');
    process.exit(1);
  }

  console.log('\nProjetos encontrados:');
  projects.forEach((proj, index) => {
    console.log(`${index + 1}. ${proj}`);
  });

  let selectedProject = '';
  while (!selectedProject) {
    const answer = await prompt('\n👉 Escolha o número do projeto para indexar: ');
    const num = parseInt(answer);
    if (!isNaN(num) && num > 0 && num <= projects.length) {
      selectedProject = projects[num - 1];
    } else {
      console.log('❌ Opção inválida.');
    }
  }

  const projectPath = path.join(parentDir, selectedProject);
  console.log(`\n✅ Selecionado: ${selectedProject} (${projectPath})\n`);

  // 3. Perguntar se quer indexar URLs
  console.log('🌐 Indexação de URLs públicas (Tavily)');
  console.log('   Você pode indexar documentação externa de URLs públicas');
  const indexUrls = await prompt('👉 Indexar URLs? (s/n, padrão: n): ');
  const shouldIndexUrls = indexUrls.toLowerCase() === 's' || indexUrls.toLowerCase() === 'sim' || indexUrls.toLowerCase() === 'y' || indexUrls.toLowerCase() === 'yes';
  
  let urlsToIndex: string[] = [];
  let tavilyApiKey: string | undefined;
  
  if (shouldIndexUrls) {
    const apiKey = process.env.TAVILY_API_KEY || await prompt('👉 Tavily API Key (ou configure TAVILY_API_KEY no .env): ');
    if (apiKey) {
      tavilyApiKey = apiKey;
      
      console.log('\n💡 URLs sugeridas (pressione Enter para usar padrão):');
      console.log('   1. https://docs.nextjs.org/docs/getting-started');
      console.log('   2. https://react.dev/learn');
      console.log('   3. https://www.apollographql.com/docs/what-is-apollo');
      
      const customUrls = await prompt('\n👉 Digite URLs separadas por vírgula (ou Enter para usar padrão): ');
      if (customUrls.trim()) {
        urlsToIndex = customUrls.split(',').map(u => u.trim()).filter(u => u.length > 0);
      } else {
        urlsToIndex = [
          'https://docs.nextjs.org/docs/getting-started',
          'https://react.dev/learn',
          'https://www.apollographql.com/docs/what-is-apollo'
        ];
      }
    } else {
      console.log('   ⚠️  Sem API key, pulando indexação de URLs');
    }
  }

  // 4. Configurar CRAGCore com todas as features
  console.log('\n📡 Inicializando CRAGCore com todas as features...\n');

  const rag = new CRAGCore({
    projectPath: projectPath,
    projectId: `test-${selectedProject}`,
    embedding: {
      type: 'llama-cpp',
      modelPath: model.modelPath,
      dimensions: model.dimensions,
      maxTokens: model.name === 'jina-code-embeddings-0.5b' ? 512 : 4096, // Jina tem limite de 512 tokens no node-llama-cpp
    },
    vectorDatabase: {
      type: 'json',
      storagePath: '.crag_cache',
      persist: true,
    },
    indexing: {
      buildDependencyGraph: true,
      excludeDirectories: ['node_modules', '.git', 'dist', 'build', '.next', 'coverage'],
      chunkingStrategy: 'ast',
      maxChunkSize: model.name === 'jina-code-embeddings-0.5b' ? 300 : 8000, // Jina tem limite menor - usar 300 tokens (linhas)
    },
    storage: {
      path: '.crag_cache',
      persist: true,
    },
    // 🆕 Feature: URL Indexing (Tavily)
    ...(shouldIndexUrls && tavilyApiKey && urlsToIndex.length > 0 ? {
      urlIndexing: {
        tavilyApiKey,
        urls: urlsToIndex,
        storagePath: '.crag/urls',
        cacheExpirationMonths: 3, // Cache de 3 meses
      },
    } : {}),
    // 🆕 Feature: Endorsement
    endorsement: {
      sources: [
        {
          name: 'official-docs',
          patterns: ['**/docs/**', '**/README.md', '**/*.md'],
          credibility: 100,
          contexts: ['documentation', 'api'],
          temporalDecay: 0.05,
        },
        {
          name: 'source-code',
          patterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
          credibility: 90,
          contexts: ['code', 'implementation'],
        },
        {
          name: 'tests',
          patterns: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
          credibility: 70,
          contexts: ['testing', 'examples'],
        },
        // 🆕 URLs indexadas via Tavily
        ...(shouldIndexUrls ? [{
          name: 'external-docs',
          patterns: ['**/urls/**'],
          credibility: 85,
          contexts: ['documentation', 'external'],
        }] : []),
      ],
      weights: {
        embedding: 0.6,
        credibility: 0.4,
      },
      feedbackStoragePath: '.crag/feedback',
    },
    // 🆕 Feature: Versioning
    versioning: {
      enabled: true,
      detectFromGit: true,
    },
    // 🆕 Feature: Context Budget
    contextBudget: {
      defaultMaxTokens: 20000,
      defaultReservedTokens: 2000,
    },
    // 🆕 Feature: Observability
    observability: {
      enabled: true,
      traceStorage: '.crag/traces',
    },
  });

  // 5. Indexar URLs primeiro (se configurado)
  if (shouldIndexUrls && tavilyApiKey && urlsToIndex.length > 0) {
    console.log('📥 Passo 1: Indexando URLs públicas...\n');
    try {
      const indexedUrls = await rag.indexURLs();
      
      // Separar URLs por cache vs atualizadas
      const cached = indexedUrls.filter(u => u.cached);
      const updated = indexedUrls.filter(u => !u.cached);
      
      console.log(`✅ ${indexedUrls.length} URLs processadas:`);
      console.log(`   📦 ${cached.length} do cache (sem chamar Tavily)`);
      console.log(`   🔄 ${updated.length} atualizadas (chamadas ao Tavily)\n`);
    } catch (error) {
      console.error('   ⚠️  Erro ao indexar URLs:', error instanceof Error ? error.message : error);
      console.log('   Continuando com indexação do código...\n');
    }
  }

  // 6. Indexar código
  console.log('📦 Passo 2: Iniciando indexação do código...');
  console.log('   (Pode demorar dependendo do tamanho do projeto)\n');

  const repo = await rag.index();

  console.log(`\n✅ Indexação concluída!`);
  console.log(`  - Arquivos: ${repo.totalFiles}`);
  console.log(`  - Vetores: ${repo.totalVectors}`);
  console.log(`  - Tempo: ${(repo.stats.duration / 1000).toFixed(2)}s\n`);

  // 5. Loop de Consultas com todas as features
  console.log('💬 Modo de Chat com todas as features v1.0');
  console.log('   Digite "sair" para encerrar');
  console.log('\n📋 Comandos especiais para testar features:');
  console.log('   - /feedback <número> <positivo|negativo> - Dar feedback sobre um resultado');
  console.log('   - /version <versão> - Filtrar por versão (ex: /version 1.0.0)');
  console.log('   - /budget <max> <reservado> - Ajustar context budget (ex: /budget 10000 1000)');
  console.log('   - /traces - Ver traces de observabilidade');
  console.log('   - /trace <id> - Ver detalhes de um trace específico');
  console.log('   - /sources - Listar content sources disponíveis (arquitetura extensível)\n');

  let lastTraceId: string | null = null;
  let lastResults: any[] = [];
  const traceStoragePath = path.join(projectPath, '.crag', 'traces');

  // Função auxiliar para salvar trace em disco
  async function saveTraceToDisk(trace: any): Promise<void> {
    if (!fs.existsSync(traceStoragePath)) {
      fs.mkdirSync(traceStoragePath, { recursive: true });
    }
    
    const traceFile = path.join(traceStoragePath, `${trace.id}.json`);
    const traceData = {
      ...trace,
      timestamp: trace.timestamp instanceof Date ? trace.timestamp.toISOString() : trace.timestamp,
    };
    
    fs.writeFileSync(traceFile, JSON.stringify(traceData, null, 2), 'utf-8');
  }

  while (true) {
    const queryText = await prompt('\n❓ Pergunta: ');
    if (queryText.toLowerCase() === 'sair' || queryText.toLowerCase() === 'exit') {
      break;
    }
    if (!queryText) continue;

    // Comandos especiais
    if (queryText.startsWith('/')) {
      const parts = queryText.trim().split(' ');
      const command = parts[0].toLowerCase();

      // Comando: /feedback
      if (command === '/feedback' && parts.length >= 3) {
        const resultIndex = parseInt(parts[1]) - 1;
        const isPositive = parts[2].toLowerCase() === 'positivo' || parts[2].toLowerCase() === 'positive';
        
        if (resultIndex >= 0 && resultIndex < lastResults.length) {
          const result = lastResults[resultIndex];
          const resultId = result.metadata?.chunkId || result.filePath;
          
          try {
            await rag.provideFeedback(resultId, { 
              positive: isPositive,
              comment: parts.slice(3).join(' ') || undefined
            });
            console.log(`\n✅ Feedback ${isPositive ? 'positivo' : 'negativo'} registrado para resultado ${resultIndex + 1}`);
            console.log(`   Isso afetará a credibilidade da fonte nas próximas buscas.\n`);
          } catch (error) {
            console.error(`   ❌ Erro ao registrar feedback:`, error instanceof Error ? error.message : error);
          }
        } else {
          console.log('   ❌ Número de resultado inválido. Use um número de 1 a', lastResults.length);
        }
        continue;
      }

      // Comando: /traces
      if (command === '/traces') {
        console.log('\n📊 Traces de Observabilidade:\n');
        if (fs.existsSync(traceStoragePath)) {
          const files = fs.readdirSync(traceStoragePath).filter(f => f.endsWith('.json'));
          if (files.length > 0) {
            console.log(`   Encontrados ${files.length} traces salvos em: ${traceStoragePath}`);
            files.slice(0, 10).forEach((file, i) => {
              const filePath = path.join(traceStoragePath, file);
              try {
                const trace = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                const traceId = file.replace('.json', '');
                console.log(`   ${i + 1}. ${traceId.substring(0, 8)}... (${file})`);
                console.log(`      Query: "${trace.query?.substring(0, 50)}..."`);
                console.log(`      Duração: ${trace.duration || 0}ms`);
                console.log(`      Chunks: ${trace.chunksReturned || 0}`);
                console.log(`      Stages: ${trace.stages?.length || 0}`);
                console.log(`      💡 Use "/trace ${traceId}" para ver detalhes`);
              } catch (e) {
                console.log(`   ${i + 1}. ${file} (erro ao ler)`);
              }
            });
            if (files.length > 10) {
              console.log(`   ... e mais ${files.length - 10} traces`);
            }
          } else {
            console.log('   Nenhum trace salvo ainda. Execute algumas consultas primeiro.');
          }
        } else {
          console.log('   Diretório de traces não existe ainda.');
          console.log(`   Será criado em: ${traceStoragePath}`);
        }
        continue;
      }

      // Comando: /trace <id>
      if (command === '/trace' && parts.length >= 2) {
        const traceId = parts[1];
        const traceFile = path.join(traceStoragePath, `${traceId}.json`);
        
        if (fs.existsSync(traceFile)) {
          try {
            const trace = JSON.parse(fs.readFileSync(traceFile, 'utf-8'));
            console.log(`\n📊 Trace: ${traceId}\n`);
            console.log(`Query: "${trace.query}"`);
            console.log(`Timestamp: ${new Date(trace.timestamp).toLocaleString()}`);
            console.log(`Duração: ${trace.duration || 0}ms`);
            console.log(`Chunks recuperados: ${trace.chunksRetrieved || 0}`);
            console.log(`Chunks retornados: ${trace.chunksReturned || 0}`);
            
            if (trace.stages && trace.stages.length > 0) {
              console.log(`\nPipeline Stages:`);
              trace.stages.forEach((stage: any, i: number) => {
                console.log(`  ${i + 1}. ${stage.name} (${stage.duration || 0}ms)`);
                if (stage.input) console.log(`     Input: ${JSON.stringify(stage.input).substring(0, 100)}`);
                if (stage.output) console.log(`     Output: ${JSON.stringify(stage.output).substring(0, 100)}`);
              });
            }
            
            if (trace.sources && trace.sources.length > 0) {
              console.log(`\nFontes:`);
              trace.sources.forEach((source: string, i: number) => {
                console.log(`  ${i + 1}. ${source}`);
              });
            }
            
            if (trace.scores && trace.scores.length > 0) {
              console.log(`\nScores:`);
              trace.scores.slice(0, 5).forEach((score: any, i: number) => {
                console.log(`  ${i + 1}. Chunk ${score.chunkId?.substring(0, 20)}...`);
                console.log(`     Embedding: ${(score.embeddingScore * 100).toFixed(1)}%`);
                console.log(`     Credibility: ${(score.credibilityScore * 100).toFixed(1)}%`);
                console.log(`     Final: ${(score.finalRelevance * 100).toFixed(1)}%`);
              });
            }
          } catch (error) {
            console.error(`   ❌ Erro ao ler trace:`, error instanceof Error ? error.message : error);
          }
        } else {
          console.log(`   ❌ Trace não encontrado: ${traceId}`);
          console.log(`   Procure em: ${traceStoragePath}`);
          console.log(`   💡 Use "/traces" para listar todos os traces disponíveis`);
        }
        continue;
      }

      // Comando: /version
      if (command === '/version' && parts.length >= 2) {
        const version = parts[1];
        console.log(`\n🔍 Testando filtro de versão: ${version}`);
        console.log('   Execute uma consulta normal para ver o filtro em ação.\n');
        console.log('   Exemplo: "como fazer autenticação?"\n');
        // Armazenar versão para próxima query
        (rag as any).__testVersion = version;
        continue;
      }

      // Comando: /budget
      if (command === '/budget' && parts.length >= 3) {
        const maxTokens = parseInt(parts[1]);
        const reservedTokens = parseInt(parts[2]);
        
        if (!isNaN(maxTokens) && !isNaN(reservedTokens)) {
          console.log(`\n🎯 Context Budget configurado:`);
          console.log(`   Max Tokens: ${maxTokens}`);
          console.log(`   Reserved Tokens: ${reservedTokens}`);
          console.log(`   Available: ${maxTokens - reservedTokens}`);
          console.log('   Execute uma consulta para ver o budget em ação.\n');
          // Armazenar budget para próxima query
          (rag as any).__testBudget = { maxTokens, reservedTokens };
          continue;
        } else {
          console.log('   ❌ Valores inválidos. Use: /budget <max> <reservado>');
        }
        continue;
      }

      // Comando: /sources
      if (command === '/sources') {
        console.log('\n🔌 Content Sources Disponíveis (Arquitetura Extensível):\n');
        const sources = rag.listAvailableSources();
        sources.forEach((source, i) => {
          console.log(`   ${i + 1}. ${source}`);
        });
        console.log('\n   💡 Você pode adicionar plugins customizados via config.plugins');
        console.log('   📚 Fontes built-in: repository, url');
        console.log('   🔮 Planejado: slack, confluence, jira, notion\n');
        continue;
      }

      console.log('   ❌ Comando não reconhecido. Use /feedback, /version, /budget, /traces, /trace ou /sources');
      continue;
    }

    console.log('   Buscando com todas as features...\n');

    try {
      // Verificar se há versão de teste configurada
      const testVersion = (rag as any).__testVersion;
      const testBudget = (rag as any).__testBudget || { maxTokens: 20000, reservedTokens: 2000 };
      
      // Primeiro, fazer uma busca simples sem filtros para debug
      const debugResults = await rag.query({
        text: queryText,
        topK: 10,
        minSimilarity: 0.0, // Sem filtro de similaridade para debug
      });
      
      if (debugResults.length > 0) {
        console.log(`   🔍 Debug: Encontrados ${debugResults.length} resultados sem filtros`);
        console.log(`   📊 Similaridades: ${debugResults.slice(0, 3).map(r => (r.similarity * 100).toFixed(1) + '%').join(', ')}\n`);
      } else {
        console.log('   ⚠️  Debug: Nenhum resultado mesmo sem filtros - problema pode ser nos embeddings\n');
      }
      
      // Construir query com features configuradas
      const queryConfig: any = {
        text: queryText,
        topK: 5,
        minSimilarity: 0.0,
        // 🆕 Feature: Endorsement
        endorsement: {
          enabled: true,
          minCredibility: 0.5,
        },
        // 🆕 Feature: Context Budget (testável via /budget)
        contextBudget: {
          maxTokens: testBudget.maxTokens,
          reservedTokens: testBudget.reservedTokens,
          deduplication: true,
          prioritizeRecent: true,
        },
        // 🆕 Feature: Conflict Detection
        detectConflicts: true,
      };

      // 🆕 Feature: Version (testável via /version)
      if (testVersion) {
        console.log(`   🔖 Aplicando filtro de versão: ${testVersion}`);
        queryConfig.version = {
          target: testVersion,
          includeBreakingChanges: true,
          includeNewer: true,
          includeOlder: false,
        };
      }
      
      const queryStartTime = Date.now();
      const results = await rag.query(queryConfig);
      const queryDuration = Date.now() - queryStartTime;
      
      // Armazenar resultados para comandos posteriores
      lastResults = results;
      
      // Criar e salvar trace manualmente (já que não temos acesso direto ao inspector)
      const traceId = randomUUID();
      const trace = {
        id: traceId,
        query: queryText,
        timestamp: new Date(),
        duration: queryDuration,
        stages: [
          {
            name: 'vector-search',
            duration: queryDuration,
            input: { topK: queryConfig.topK, text: queryText },
            output: { candidates: results.length },
            metadata: {},
          },
        ],
        chunksRetrieved: debugResults.length,
        chunksReturned: results.length,
        sources: [...new Set(results.map(r => r.filePath))],
        scores: results.map((r) => ({
          chunkId: r.metadata?.chunkId || `${r.filePath}:${r.metadata.startLine}`,
          embeddingScore: r.embeddingScore || r.similarity,
          credibilityScore: r.credibilityScore || 1.0,
          finalRelevance: r.finalRelevance || r.similarity,
          explanation: r.explanation || 'No explanation available',
        })),
      };
      
      lastTraceId = traceId;
      await saveTraceToDisk(trace);

      if (results.length === 0) {
        console.log('   (Nenhum resultado relevante)');
        console.log('   💡 Dica: Tente reduzir minSimilarity ou desabilitar filtros');
      } else {
        // Calcular tokens totais se context budget foi aplicado
        const totalTokens = results.reduce((sum, r) => sum + (r.usedTokens || 0), 0);
        const budgetUsed = testBudget.maxTokens - testBudget.reservedTokens;
        
        console.log(`   📊 Encontrados ${results.length} resultados`);
        if (totalTokens > 0) {
          console.log(`   🎯 Context Budget: ${totalTokens}/${budgetUsed} tokens usados (${((totalTokens / budgetUsed) * 100).toFixed(1)}%)\n`);
        } else {
          console.log('');
        }
        
        results.forEach((r, i) => {
          const fileName = path.basename(r.filePath);
          const similarity = r.finalRelevance || r.similarity;
          const chunkId = r.metadata?.chunkId || `${r.filePath}:${r.metadata.startLine}`;
          
          console.log(`   ${i + 1}. [${(similarity * 100).toFixed(1)}%] ${fileName}:${r.metadata.startLine}`);
          console.log(`      📂 ${r.filePath}`);
          console.log(`      🆔 ID: ${chunkId.substring(0, 40)}...`);
          
          // Mostrar scores se disponíveis
          if (r.embeddingScore !== undefined || r.credibilityScore !== undefined) {
            console.log(`      📈 Embedding: ${((r.embeddingScore || r.similarity) * 100).toFixed(1)}% | Credibility: ${((r.credibilityScore || 1) * 100).toFixed(1)}%`);
          }
          
          // Mostrar conflitos se detectados
          if (r.conflicts && r.conflicts.length > 0) {
            console.log(`      ⚠️  Conflitos detectados: ${r.conflicts.length}`);
            r.conflicts.forEach(c => {
              console.log(`         - ${c.level}: ${c.title}`);
            });
          }
          
          // Mostrar deprecação se aplicável
          const deprecation = (r as any).deprecation;
          if (deprecation) {
            console.log(`      📅 ${deprecation.warning}`);
          }
          
          // Mostrar tokens usados se disponível (Context Budget)
          if (r.usedTokens) {
            console.log(`      🎯 Tokens deste chunk: ${r.usedTokens}`);
          }
          
          // Mostrar versão se disponível (Versioning)
          const versionContext = (r.metadata as any)?.versionContext;
          if (versionContext) {
            console.log(`      🔖 Versão: ${versionContext.version || 'N/A'}`);
          }
          
          console.log(`      📝 Trecho: "${r.content.substring(0, 100).replace(/\n/g, ' ')}..."`);
          
          // Mostrar score breakdown se disponível
          if (r.explanation) {
            console.log(`      💡 Score breakdown:`);
            // Formatar a explicação (pode ter múltiplas linhas)
            const lines = r.explanation.split('\n').filter(l => l.trim());
            lines.forEach(line => {
              console.log(`         ${line.trim()}`);
            });
          }
          
          console.log(`      💬 Dica: Use "/feedback ${i + 1} positivo" ou "/feedback ${i + 1} negativo" para dar feedback`);
          console.log('');
        });
        
        // Mostrar informações sobre features ativas
        console.log('   📋 Features ativas nesta busca:');
        console.log('      ✅ Endorsement (credibilidade de fontes)');
        console.log('      ✅ Context Budget (otimização de tokens)');
        console.log('      ✅ Conflict Detection');
        if (shouldIndexUrls && tavilyApiKey) {
          console.log('      ✅ URL Indexing (documentação externa via Tavily)');
        }
        if (testVersion) {
          console.log(`      ✅ Version Filter (${testVersion})`);
        }
        console.log('      ✅ Observability (traces salvos em .crag/traces)');
        console.log(`      📊 Trace ID: ${lastTraceId?.substring(0, 8)}... (use "/trace ${lastTraceId}" para ver detalhes)`);
        console.log('');
      }
    } catch (error) {
      console.error('   ❌ Erro na busca:', error instanceof Error ? error.message : error);
    }
  }

  rl.close();
  await rag.close();
}

main().catch((err) => {
  console.error('❌ Erro fatal:', err);
  rl.close();
  process.exit(1);
});

