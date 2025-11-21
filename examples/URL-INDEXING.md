# Indexação de URLs com Tavily

Este exemplo mostra como usar o Tavily para indexar conteúdo de URLs públicas e incluí-las nas buscas do CRAG.

## Como Funciona

1. **Tavily extrai conteúdo** de URLs públicas usando sua API
2. **Conteúdo é salvo** como arquivos Markdown locais
3. **Arquivos são indexados** junto com o código do projeto
4. **Endorsement** pode dar credibilidade diferente a essas fontes

## Configuração

### 1. Obter API Key do Tavily

1. Acesse https://tavily.com
2. Crie uma conta
3. Obtenha sua API key
4. Configure no `.env`:

```bash
TAVILY_API_KEY=tvly-sua-chave-aqui
```

### 2. Configurar CRAGCore

```typescript
import { CRAGCore } from '@cragjs/indexing';

const rag = new CRAGCore({
  projectPath: './meu-projeto',
  projectId: 'meu-projeto',
  
  // ... outras configurações ...
  
  // 🆕 Configuração de URL Indexing
  urlIndexing: {
    tavilyApiKey: process.env.TAVILY_API_KEY!,
    urls: [
      'https://docs.nextjs.org/docs/getting-started',
      'https://react.dev/learn',
      'https://www.typescriptlang.org/docs/',
    ],
    storagePath: '.crag/urls', // Onde salvar o conteúdo
  },
  
  // 🆕 Configuração de Endorsement para URLs
  endorsement: {
    sources: [
      {
        name: 'nextjs-docs',
        patterns: ['**/urls/nextjs-org-*/**'],
        credibility: 95,
        contexts: ['documentation', 'framework'],
      },
      {
        name: 'external-docs',
        patterns: ['**/urls/**'], // Qualquer URL indexada
        credibility: 85,
        contexts: ['documentation'],
      },
    ],
    weights: {
      embedding: 0.6,
      credibility: 0.4,
    },
  },
});
```

## Uso

### Indexar URLs e Projeto

```typescript
// 1. Indexar URLs (baixa conteúdo usando Tavily)
const indexedUrls = await rag.indexURLs();
console.log(`Indexadas ${indexedUrls.length} URLs`);

// 2. Indexar projeto (incluindo arquivos das URLs)
const repository = await rag.index();
```

### Buscar no Conteúdo

```typescript
const results = await rag.query({
  text: 'como usar hooks no React?',
  topK: 5,
  endorsement: {
    enabled: true,
    minCredibility: 0.8,
  },
});

// Resultados incluem conteúdo de URLs indexadas!
results.forEach(result => {
  const isFromURL = result.filePath.includes('/urls/');
  console.log(`${isFromURL ? '🌐' : '📄'} ${result.filePath}`);
});
```

## Estrutura de Arquivos

Após indexar URLs, a estrutura fica assim:

```
.crag/
  urls/
    nextjs-org-docs-getting-started-abc123.md
    react-dev-learn-def456.md
    typescriptlang-org-docs-ghi789.md
```

## Endorsement Patterns

Os patterns de endorsement fazem match com os nomes dos arquivos salvos:

- `**/urls/nextjs-org-*/**` - Match com docs do Next.js
- `**/urls/react-dev-*/**` - Match com docs do React
- `**/urls/**` - Match com qualquer URL indexada

## Limitações

- **Apenas URLs públicas**: Tavily não acessa conteúdo privado (Confluence, GitHub privado)
- **Requer API key**: Precisa de conta no Tavily
- **Rate limits**: Respeite os limites da API do Tavily

## Para Conteúdo Privado

Para Confluence, GitHub privado, etc., você precisaria:
1. Usar APIs específicas (Confluence API, GitHub API)
2. Autenticar com tokens/chaves
3. Baixar conteúdo manualmente
4. Salvar como arquivos locais
5. Indexar normalmente

