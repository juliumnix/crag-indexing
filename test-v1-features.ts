import { CRAGCore } from './src/core/index';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

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
  console.log('  ✅ Source Deprecation (tracking de obsoletos)\n');

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

  // 3. Configurar CRAGCore com todas as features
  console.log('📡 Inicializando CRAGCore com todas as features...\n');

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

  // 4. Indexar
  console.log('📦 Iniciando indexação...');
  console.log('   (Pode demorar dependendo do tamanho do projeto)\n');

  const repo = await rag.index();

  console.log(`\n✅ Indexação concluída!`);
  console.log(`  - Arquivos: ${repo.totalFiles}`);
  console.log(`  - Vetores: ${repo.totalVectors}`);
  console.log(`  - Tempo: ${(repo.stats.duration / 1000).toFixed(2)}s\n`);

  // 5. Loop de Consultas com todas as features
  console.log('💬 Modo de Chat com todas as features v1.0');
  console.log('   Digite "sair" para encerrar\n');

  while (true) {
    const queryText = await prompt('\n❓ Pergunta: ');
    if (queryText.toLowerCase() === 'sair' || queryText.toLowerCase() === 'exit') {
      break;
    }
    if (!queryText) continue;

    console.log('   Buscando com todas as features...\n');

    try {
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
      
      const results = await rag.query({
        text: queryText,
        topK: 5,
        minSimilarity: 0.0, // Remover filtro de similaridade para testar
        // 🆕 Feature: Endorsement
        endorsement: {
          enabled: true,
          minCredibility: 0.5, // Filtro razoável de credibilidade (50%)
        },
        // 🆕 Feature: Version (se aplicável)
        // version: {
        //   target: '1.0.0',
        //   includeBreakingChanges: true,
        // },
        // 🆕 Feature: Context Budget
        contextBudget: {
          maxTokens: 20000,
          reservedTokens: 2000,
          deduplication: true,
          prioritizeRecent: true,
        },
        // 🆕 Feature: Conflict Detection
        detectConflicts: true,
      });

      if (results.length === 0) {
        console.log('   (Nenhum resultado relevante)');
        console.log('   💡 Dica: Tente reduzir minSimilarity ou desabilitar filtros');
      } else {
        console.log(`   📊 Encontrados ${results.length} resultados:\n`);
        results.forEach((r, i) => {
          const fileName = path.basename(r.filePath);
          const similarity = r.finalRelevance || r.similarity;
          
          console.log(`   ${i + 1}. [${(similarity * 100).toFixed(1)}%] ${fileName}:${r.metadata.startLine}`);
          
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
          if (r.deprecation) {
            console.log(`      📅 ${r.deprecation.warning}`);
          }
          
          // Mostrar tokens usados se disponível
          if (r.usedTokens) {
            console.log(`      🎯 Tokens: ${r.usedTokens}`);
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
          } else {
            console.log(`      💡 Score breakdown: (não disponível - endorsement pode não estar gerando explanation)`);
          }
          
          console.log('');
        });
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

