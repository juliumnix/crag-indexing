import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { downloadFileToCacheDir } from '@huggingface/hub';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Script para baixar o modelo de embedding automaticamente
 * Executado no postinstall do npm
 */

// Configurações dos modelos disponíveis
const MODEL_CONFIGS = {
  light: {
    name: 'jina-code-embeddings-0.5b',
    repo: 'jinaai/jina-code-embeddings-0.5b-GGUF',
    files: [
      'jina-code-embeddings-0.5b-Q4_K_M.gguf',  // 4-bit (recomendado)
      'jina-code-embeddings-0.5b-Q8_0.gguf',    // 8-bit (alternativa)
      'jina-code-embeddings-0.5b-F16.gguf',     // 16-bit (alternativa)
    ],
    note: 'Jina Code Embeddings - Modelo leve otimizado para código (~300-500MB)',
    dimensions: 896,
    sizeApprox: '~300-500MB',
  },
  complete: {
    name: 'nomic-embed-code',
    repo: 'nomic-ai/nomic-embed-code-GGUF',
    files: [
      'nomic-embed-code.Q4_K_M.gguf', // Versão recomendada
    ],
    note: 'Nomic Embed Code - Modelo completo otimizado para código (7B parâmetros)',
    dimensions: 4096,
    sizeApprox: '~4GB',
    originalRepo: 'nomic-ai/nomic-embed-code'
  }
};

const MODELS_DIR = path.join(process.cwd(), 'models');
const CONFIG_FILE = path.join(process.cwd(), '.crag-model-config.json');

/**
 * Abre a URL no navegador padrão
 */
async function openBrowser(url: string): Promise<void> {
  try {
    const platform = process.platform;
    let command: string;

    if (platform === 'win32') {
      command = `start "" "${url}"`;
    } else if (platform === 'darwin') {
      command = `open "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }

    await execAsync(command);
  } catch (error) {
    // Ignorar erros ao abrir navegador
  }
}

/**
 * Valida o formato do token do HuggingFace
 */
function isValidToken(token: string): boolean {
  return token.startsWith('hf_') && token.length > 10;
}

/**
 * Obtém o token do HuggingFace de variável de ambiente ou solicita interativamente
 */
async function getHuggingFaceToken(): Promise<string> {
  // Primeiro, tentar da variável de ambiente
  const tokenFromEnv = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || process.env.HF_ACCESS_TOKEN;
  if (tokenFromEnv && isValidToken(tokenFromEnv)) {
    console.log('✅ Token do HuggingFace encontrado na variável de ambiente\n');
    return tokenFromEnv;
  }

  // Se não estiver em modo interativo (npm install automático), mostrar instruções e sair
  // Mas permitir interação quando executado manualmente via npm run download-model
  const isAutoInstall = process.env.npm_lifecycle_event === 'postinstall' && !process.stdin.isTTY;
  
  if (isAutoInstall) {
    console.log('\n❌ Token do HuggingFace necessário para download');
    console.log('\n📋 Para configurar o token:');
    console.log('   1. Obtenha um token em: https://huggingface.co/settings/tokens');
    console.log('   2. Configure a variável de ambiente:');
    console.log('      Windows: set HF_TOKEN=hf_...');
    console.log('      Linux/Mac: export HF_TOKEN=hf_...');
    console.log('   3. Execute manualmente: npm run download-model\n');
    process.exit(1);
  }

  // Modo interativo: guiar o usuário através do processo
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log('\n' + '='.repeat(60));
    console.log('🔑 Autenticação do HuggingFace Necessária');
    console.log('='.repeat(60));
    console.log('\n📝 Para baixar o modelo, você precisa de um token do HuggingFace.');
    console.log('   O token é gratuito e pode ser obtido em segundos.\n');
    
    console.log('🌐 Abrindo a página de tokens no seu navegador...\n');
    
    // Abrir navegador (não esperar, continuar imediatamente)
    openBrowser('https://huggingface.co/settings/tokens').catch(() => {
      // Ignorar erros ao abrir navegador
    });
    
    // Dar um pequeno delay para o navegador abrir, mas não bloquear
    setTimeout(() => {
      console.log('✅ Navegador aberto!');
      console.log('   Se não abriu automaticamente, acesse: https://huggingface.co/settings/tokens\n');
      
      console.log('📋 Instruções:');
      console.log('   1. Faça login na sua conta HuggingFace (ou crie uma gratuita)');
      console.log('   2. Clique em "New token"');
      console.log('   3. Dê um nome ao token (ex: "cragjs-indexing")');
      console.log('   4. Selecione "Read" como permissão');
      console.log('   5. Clique em "Generate token"');
      console.log('   6. Copie o token (começa com "hf_...")\n');
      
      const askToken = () => {
        rl.question('🔑 Cole seu token do HuggingFace aqui (ou pressione Ctrl+C para cancelar): ', async (answer) => {
          const token = answer.trim();
          
          if (!token) {
            console.log('\n⚠️  Token não pode estar vazio. Tente novamente.\n');
            askToken();
            return;
          }
          
          if (!isValidToken(token)) {
            console.log('\n❌ Token inválido. O token deve começar com "hf_" e ter pelo menos 10 caracteres.');
            console.log('   Exemplo: hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n');
            askToken();
            return;
          }
          
          console.log('\n✅ Token recebido! Validando...');
          
          // Tentar validar o token fazendo uma requisição simples
          try {
            // Testar o token tentando baixar um arquivo pequeno do repositório do modelo
            await downloadFileToCacheDir({
              repo: MODEL_CONFIGS.complete.repo,
              path: 'README.md',
              accessToken: token
            });
            console.log('✅ Token válido!\n');
            rl.close();
            resolve(token);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes('401') || errorMsg.includes('Unauthorized') || errorMsg.includes('Invalid')) {
              console.log('\n❌ Token inválido ou expirado. Verifique se:');
              console.log('   - O token está correto (começa com "hf_")');
              console.log('   - O token não expirou');
              console.log('   - Você copiou o token completo\n');
              askToken();
            } else {
              // Se não for erro de autenticação, aceitar o token mesmo assim
              // Pode ser um erro de rede ou outro problema
              console.log('✅ Token aceito (validação parcial)\n');
              rl.close();
              resolve(token);
            }
          }
        });
      };
      
      askToken();
    }, 500); // Pequeno delay para o navegador abrir
  });
}

/**
 * Salva a configuração do modelo escolhido
 */
function saveModelConfig(selectedModels: string[]): void {
  const config = {
    selectedModels,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Lê a configuração do modelo salva
 */
function loadModelConfig(): { selectedModels: string[] } | null {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Pergunta ao usuário qual modelo baixar
 */
async function askModelChoice(rl: readline.Interface): Promise<string[]> {
  return new Promise((resolve) => {
    console.log('\n' + '='.repeat(60));
    console.log('🤖 Escolha o Modelo de Embedding');
    console.log('='.repeat(60));
    console.log('\n📦 Modelos disponíveis:\n');
    console.log('1. 🪶 Leve (jina-code-embeddings-0.5b)');
    console.log('   - Tamanho: ~300-500MB');
    console.log('   - Dimensões: 896');
    console.log('   - Recomendado para: desenvolvimento, testes rápidos\n');
    console.log('2. 🚀 Completo (nomic-embed-code)');
    console.log('   - Tamanho: ~4GB');
    console.log('   - Dimensões: 4096');
    console.log('   - Recomendado para: produção, máxima qualidade\n');
    console.log('3. 📦 Ambos (leve + completo)');
    console.log('   - Permite escolher qual usar em tempo de execução\n');
    
    const askChoice = () => {
      rl.question('👉 Escolha (1, 2 ou 3): ', (answer) => {
        const choice = answer.trim();
        if (choice === '1') {
          resolve(['light']);
        } else if (choice === '2') {
          resolve(['complete']);
        } else if (choice === '3') {
          resolve(['light', 'complete']);
        } else {
          console.log('❌ Opção inválida. Escolha 1, 2 ou 3.\n');
          askChoice();
        }
      });
    };
    
    askChoice();
  });
}

/**
 * Tenta baixar um arquivo de modelo específico
 */
async function tryDownloadModelFile(
  repo: string,
  fileName: string,
  accessToken: string,
  targetPath: string
): Promise<boolean> {
  try {
    const downloadOptions: {
      repo: string;
      path: string;
      accessToken: string;
    } = {
      repo,
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

/**
 * Baixa um modelo específico (light ou complete)
 */
async function downloadSpecificModel(
  modelType: 'light' | 'complete',
  accessToken: string,
  rl?: readline.Interface
): Promise<boolean> {
  const config = MODEL_CONFIGS[modelType];
  const modelPath = path.join(MODELS_DIR, config.files[0]);
  
  // Verificar se o modelo já existe
  if (fs.existsSync(modelPath)) {
    const stats = fs.statSync(modelPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`✅ Modelo ${config.name} já existe: ${modelPath} (${sizeMB} MB)`);
    return true;
  }

  // Verificar se há qualquer arquivo do modelo já baixado
  if (fs.existsSync(MODELS_DIR)) {
    const files = fs.readdirSync(MODELS_DIR).filter(f => 
      f.endsWith('.gguf') && f.toLowerCase().includes(config.name.toLowerCase().split('-')[0])
    );
    if (files.length > 0) {
      const foundPath = path.join(MODELS_DIR, files[0]);
      const stats = fs.statSync(foundPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`✅ Modelo ${config.name} encontrado: ${foundPath} (${sizeMB} MB)`);
      return true;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`📥 Download do Modelo: ${config.name}`);
  console.log('='.repeat(60));
  console.log(`\n📦 Repositório: ${config.repo}`);
  console.log(`📄 Arquivo: ${config.files[0]}`);
  console.log(`📁 Destino: ${modelPath}`);
  console.log(`ℹ️  ${config.note}`);
  console.log(`🔢 Dimensões: ${config.dimensions}`);
  console.log(`📊 Tamanho aproximado: ${config.sizeApprox}\n`);

  // Criar diretório se não existir
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  // Tentar baixar cada arquivo até encontrar um que funcione
  let success = false;
  for (const fileName of config.files) {
    const targetPath = path.join(MODELS_DIR, fileName);
    console.log(`⏳ Tentando baixar ${fileName}...`);
    
    const downloaded = await tryDownloadModelFile(config.repo, fileName, accessToken, targetPath);
    
    if (downloaded && fs.existsSync(targetPath)) {
      const stats = fs.statSync(targetPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`\n✅ Modelo baixado com sucesso!`);
      console.log(`📦 Modelo: ${config.repo}/${fileName}`);
      console.log(`📊 Tamanho: ${sizeMB} MB`);
      console.log(`📁 Local: ${targetPath}`);
      console.log(`🔢 Dimensões: ${config.dimensions}\n`);
      success = true;
      break;
    } else {
      console.log(`   ⚠️  ${fileName} não encontrado, tentando próximo...`);
    }
  }

  if (!success) {
    console.error(`\n❌ Não foi possível baixar o modelo ${config.name}.`);
    console.error(`   Verifique os arquivos disponíveis em:`);
    console.error(`   https://huggingface.co/${config.repo}/tree/main`);
    return false;
  }

  return true;
}

async function downloadModel() {
  // Verificar se estamos em modo interativo
  const isAutoInstall = process.env.npm_lifecycle_event === 'postinstall' && !process.stdin.isTTY;
  
  // Se for instalação automática sem TTY, pular a escolha e usar configuração salva ou padrão
  if (isAutoInstall) {
    const savedConfig = loadModelConfig();
    if (savedConfig && savedConfig.selectedModels.length > 0) {
      console.log('\n📋 Usando configuração salva anteriormente');
      console.log(`   Modelos selecionados: ${savedConfig.selectedModels.join(', ')}\n`);
      // Não baixar automaticamente no postinstall, apenas informar
      console.log('💡 Para baixar os modelos, execute: npm run download-model\n');
      return;
    } else {
      // Se não houver configuração, apenas informar
      console.log('\n💡 Execute "npm run download-model" para escolher e baixar o modelo de embedding\n');
      return;
    }
  }

  // Modo interativo: perguntar qual modelo baixar
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    // Perguntar qual modelo baixar
    const selectedModels = await askModelChoice(rl);
    
    // Salvar a escolha
    saveModelConfig(selectedModels);
    
    // Obter token de autenticação (obrigatório)
    let accessToken = await getHuggingFaceToken();
    
    // Baixar os modelos selecionados
    let allSuccess = true;
    for (const modelType of selectedModels) {
      const success = await downloadSpecificModel(modelType as 'light' | 'complete', accessToken, rl);
      if (!success) {
        allSuccess = false;
      }
    }
    
    if (allSuccess) {
      console.log('\n' + '='.repeat(60));
      console.log('✅ Download concluído!');
      console.log('='.repeat(60));
      console.log('\n💡 Dica: Você pode escolher qual modelo usar em tempo de execução');
      console.log('   Configuração salva em: .crag-model-config.json\n');
    } else {
      console.log('\n⚠️  Alguns modelos não foram baixados. Verifique os erros acima.\n');
    }
    
    rl.close();
  } catch (error) {
    rl.close();
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('\n' + '='.repeat(60));
    console.error('❌ Erro ao baixar modelo');
    console.error('='.repeat(60));
    console.error(`\n${errorMessage}\n`);
    process.exit(1);
  }
}

// Executar apenas se não estiver em modo de publicação
if (process.env.npm_lifecycle_event !== 'prepublishOnly') {
  downloadModel().catch(err => {
    console.error('Erro no download do modelo:', err);
    process.exit(0); // Não falhar npm install
  });
}


