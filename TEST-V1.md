# Teste CRAG Indexing v1.0

Este arquivo explica como testar todas as novas features da v1.0.

## 🚀 Como Executar

```bash
npm run test:v1
```

Ou diretamente:

```bash
tsx test-v1-features.ts
```

## 📋 O que o teste faz

1. **Permite escolher o modelo de embedding:**
   - **Jina Code Embeddings 0.5B** (RECOMENDADO - ~300-500MB, mais leve)
   - **Nomic Embed Code** (~4GB, mais pesado)

2. **Lista projetos** na pasta pai para indexar

3. **Indexa o projeto** com todas as features v1.0 habilitadas

4. **Permite fazer queries** testando:
   - ✅ Endorsed Retrieval (credibilidade de fontes)
   - ✅ Context Budget Manager (otimização de tokens)
   - ✅ Conflict Detection (detecção de conflitos)
   - ✅ Source Deprecation (avisos de obsoletos)
   - ✅ Observability (traces para debugging)

## 🎯 Features Testadas

### Endorsed Retrieval
- Prioriza fontes confiáveis (docs > código > testes)
- Mostra scores de credibilidade
- Permite feedback do usuário

### Context Budget Manager
- Otimiza uso de tokens
- Remove chunks redundantes
- Prioriza documentos recentes

### Conflict Detection
- Detecta conflitos de versão
- Detecta informações contraditórias
- Mostra avisos nos resultados

### Source Deprecation
- Avisa sobre fontes obsoletas
- Sugere substituições

### Observability
- Traces completos de cada query
- Debugging detalhado
- Estatísticas de performance

## 📦 Modelo Jina Code Embeddings

O modelo Jina é **muito mais leve** que o Nomic (~300-500MB vs ~4GB) e oferece:
- 896 dimensões
- Suporte a 15+ linguagens
- Performance excelente para código

O script tenta baixar automaticamente via `huggingface-cli`. Se não tiver instalado:

```bash
pip install huggingface-hub
```

Ou baixe manualmente de: https://huggingface.co/jinaai/jina-code-embeddings-0.5b-GGUF

## 💡 Exemplo de Uso

```bash
$ npm run test:v1

🚀 CRAG Indexing v1.0 - Teste de Features

🤖 Escolha o modelo de embedding:
1. jina-code-embeddings-0.5b (RECOMENDADO - leve, ~500MB)
2. nomic-embed-code (pesado, ~4GB)

👉 Escolha (1 ou 2): 1

📥 Modelo Jina não encontrado. Baixando...
   (Isso pode demorar alguns minutos)

✅ Modelo baixado: ./models/jina-code-embeddings-0.5b-Q4_K_M.gguf

📂 Buscando projetos...
1. meu-projeto
2. outro-projeto

👉 Escolha o número: 1

📦 Indexando...
✅ Indexação concluída!

💬 Modo de Chat
❓ Pergunta: como fazer autenticação?

📊 Encontrados 3 resultados:
   1. [95.2%] auth.ts:42
      📈 Embedding: 92.1% | Credibility: 100.0%
      🎯 Tokens: 18500
      📝 Trecho: "export async function authenticate..."
```

## 🔧 Configuração Avançada

Você pode editar o arquivo `test-v1-features.ts` para:
- Ajustar configurações de endorsement
- Configurar versionamento
- Ajustar limites de tokens
- Habilitar/desabilitar features específicas

## 📚 Mais Informações

- [Documentação do Jina Code Embeddings](https://huggingface.co/jinaai/jina-code-embeddings-0.5b-GGUF)
- [PRD v1.0 completo](./PRD.md) (se disponível)

