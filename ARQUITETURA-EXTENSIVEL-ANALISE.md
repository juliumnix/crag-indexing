# 🏗️ Análise: Arquitetura Extensível para Indexação Multifacetada

## 📋 Visão do Projeto (Atualizada)

**Objetivo:** Criar um **indexador genérico e extensível** onde:
- ✅ Você pode enviar **QUALQUER tipo de conteúdo** para indexar
- ✅ Código de múltiplos repositórios (local)
- ✅ Threads do Slack (exemplo)
- ✅ Documentação de qualquer fonte
- ✅ Confluence interno da empresa (via SSO)
- ✅ Jira interno da empresa (via SSO)
- ✅ Qualquer coisa que você quiser adicionar

**Diferencial:** Sistema plugável que aceita qualquer fonte de dados e indexa tudo em um único índice unificado.

---

## 🎯 Arquitetura Ideal: Sistema de Plugins

### **Conceito Central: Content Source Plugins**

A ideia é ter uma arquitetura onde cada tipo de conteúdo é um **plugin** que implementa uma interface comum:

```typescript
// Interface base para qualquer indexador de conteúdo
interface ContentSourcePlugin {
  name: string
  version: string
  
  // Indexa conteúdo e retorna formato unificado
  index(config: SourceConfig): Promise<IndexedContent[]>
  
  // Valida configuração
  validate(config: SourceConfig): Promise<boolean>
  
  // Extrai metadata específica do tipo
  extractMetadata(content: RawContent): UnifiedMetadata
  
  // Detecta relacionamentos com outros conteúdos
  extractRelationships(content: RawContent): ContentRelationship[]
}
```

---

## 🔍 O Que Você JÁ TEM (Base Sólida)

### ✅ **1. URL Indexer** (Plugin de exemplo)
- Já funciona como um plugin
- Indexa URLs via Tavily
- Salva como Markdown unificado

### ✅ **2. Repository Indexer** (Plugin de código)
- Indexa código de um repositório
- Usa AST chunking
- Gera embeddings

### ✅ **3. Sistema de Endorsement**
- Já diferencia credibilidade por fonte
- Pode ser estendido para novos tipos

---

## ❌ O Que FALTA para Arquitetura Extensível

### 🔴 **1. Interface Unificada de Content Sources** ⚠️ **BLOQUEADOR #1**

**Status:** ❌ Ausente  
**Impacto:** CRÍTICO - Sem interface comum, não é extensível

**O que você precisa:**
```typescript
// src/interfaces/IContentSource.ts
export interface IContentSource {
  /**
   * Nome único do source (ex: 'slack', 'confluence', 'jira', 'notion')
   */
  readonly name: string;
  
  /**
   * Versão do plugin
   */
  readonly version: string;
  
  /**
   * Indexa conteúdo da fonte
   */
  index(config: ContentSourceConfig): Promise<IndexedContent[]>;
  
  /**
   * Valida configuração antes de indexar
   */
  validate(config: ContentSourceConfig): Promise<ValidationResult>;
  
  /**
   * Extrai metadata unificada
   */
  extractMetadata(rawContent: any): UnifiedContentMetadata;
  
  /**
   * Extrai relacionamentos com outros conteúdos
   */
  extractRelationships(rawContent: any): ContentRelationship[];
  
  /**
   * Health check da fonte
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Conteúdo indexado em formato unificado
 */
export interface IndexedContent {
  id: string;
  content: string;  // Texto/Markdown unificado
  metadata: UnifiedContentMetadata;
  relationships?: ContentRelationship[];
  embedding?: number[];  // Opcional, será gerado depois
}

/**
 * Metadata unificada para qualquer tipo de conteúdo
 */
export interface UnifiedContentMetadata {
  sourceType: string;  // 'code', 'slack', 'url', 'confluence', 'jira', etc.
  sourceId: string;   // ID único na fonte original
  contentType: string; // 'file', 'message', 'thread', 'document', etc.
  
  // Informações temporais
  createdAt: Date;
  updatedAt: Date;
  
  // Informações de autoria
  author?: string;
  authorId?: string;
  
  // Localização/origem
  origin: {
    type: string;     // 'repository', 'slack-channel', 'url', etc.
    path?: string;    // Caminho no repositório
    url?: string;     // URL original
    channel?: string; // Canal do Slack
    repo?: string;    // Repositório Git
  };
  
  // Tags e categorias
  tags?: string[];
  categories?: string[];
  
  // Metadados específicos do tipo (flexível)
  customMetadata?: Record<string, any>;
}
```

### 🔴 **2. Content Source Registry** ⚠️ **BLOQUEADOR #2**

**Status:** ❌ Ausente  
**Impacto:** CRÍTICO - Precisa registrar e gerenciar plugins

**O que você precisa:**
```typescript
// src/core/ContentSourceRegistry.ts
export class ContentSourceRegistry {
  private sources: Map<string, IContentSource> = new Map();
  
  /**
   * Registra um novo content source
   */
  register(source: IContentSource): void {
    this.sources.set(source.name, source);
  }
  
  /**
   * Obtém um content source pelo nome
   */
  get(name: string): IContentSource | undefined {
    return this.sources.get(name);
  }
  
  /**
   * Lista todos os sources registrados
   */
  list(): IContentSource[] {
    return Array.from(this.sources.values());
  }
  
  /**
   * Valida se um source está disponível
   */
  isAvailable(name: string): boolean {
    return this.sources.has(name);
  }
}
```

### 🔴 **3. Configuração Unificada de Múltiplas Fontes** ⚠️ **BLOQUEADOR #3**

**Status:** ⚠️ Parcial (apenas código + URLs)  
**Impacto:** CRÍTICO - Precisa configurar múltiplas fontes facilmente

**O que você precisa:**
```typescript
// Atualizar CRAGCore para aceitar múltiplas fontes
export interface CodeRAGConfig {
  // ... configurações existentes ...
  
  /**
   * Múltiplas fontes de conteúdo para indexar
   */
  contentSources?: ContentSourceConfig[];
}

export interface ContentSourceConfig {
  /**
   * Tipo do source (deve estar registrado)
   */
  type: string;
  
  /**
   * Configuração específica do tipo
   */
  config: Record<string, any>;
  
  /**
   * Opções de indexação
   */
  options?: {
    enabled?: boolean;
    priority?: number;  // Ordem de indexação
    filters?: {
      include?: string[];
      exclude?: string[];
    };
  };
}
```

**Exemplo de uso:**
```typescript
const rag = new CRAGCore({
  projectPath: './main-repo',
  projectId: 'my-project',
  
  // Configuração de embedding e vector DB (igual)
  embedding: { type: 'ollama', model: 'embeddinggemma' },
  vectorDatabase: { type: 'json', storagePath: '.crag_cache' },
  
  // 🆕 Múltiplas fontes de conteúdo
  contentSources: [
    // 1. Código do repositório principal (já existe)
    {
      type: 'repository',
      config: {
        path: './main-repo',
        excludeDirectories: ['node_modules', '.git'],
        chunkingStrategy: 'ast',
      },
    },
    
    // 2. Outro repositório Git
    {
      type: 'repository',
      config: {
        path: '../other-repo',
        excludeDirectories: ['node_modules'],
      },
    },
    
    // 3. Slack (exemplo - plugin futuro)
    {
      type: 'slack',
      config: {
        apiToken: process.env.SLACK_BOT_TOKEN,
        channels: ['#dev-team', '#architecture'],
        includeThreads: true,
      },
      options: {
        priority: 2,  // Indexar depois do código
      },
    },
    
    // 4. URLs (já existe)
    {
      type: 'url',
      config: {
        tavilyApiKey: process.env.TAVILY_API_KEY,
        urls: [
          'https://docs.example.com',
          'https://api.example.com/docs',
        ],
      },
    },
    
    // 5. Confluence interno (via SSO)
    {
      type: 'confluence',
      config: {
        baseUrl: 'https://confluence.empresa.com',
        ssoConfig: {
          type: 'saml', // ou 'oauth2', 'basic'
          // Configuração SSO será feita via variáveis de ambiente ou arquivo
        },
        spaces: ['DEV', 'ARCH', 'DOCS'], // Espaços para indexar
        includeAttachments: true,
      },
      options: {
        priority: 3,
      },
    },
    
    // 6. Jira interno (via SSO)
    {
      type: 'jira',
      config: {
        baseUrl: 'https://jira.empresa.com',
        ssoConfig: {
          type: 'saml', // ou 'oauth2', 'basic'
        },
        projects: ['PROJ1', 'PROJ2'], // Projetos para indexar
        includeIssues: true,
        includeComments: true,
        includeAttachments: false,
      },
      options: {
        priority: 4,
      },
    },
  ],
});
```

### 🟡 **4. Implementações de Plugins Comuns** (Importante)

**Status:** ❌ Ausente  
**Impacto:** ALTO - Precisa de plugins prontos para uso

**Plugins a criar:**

#### **4.1. Repository Source (Melhorar existente)**
```typescript
// src/sources/repository/RepositorySource.ts
export class RepositorySource implements IContentSource {
  readonly name = 'repository';
  readonly version = '1.0.0';
  
  async index(config: RepositorySourceConfig): Promise<IndexedContent[]> {
    // Usa RepositoryIndexer existente, mas retorna formato unificado
    const indexer = new RepositoryIndexer({...});
    const repository = await indexer.index();
    
    // Converte para formato unificado
    return this.convertToUnified(repository);
  }
}
```

#### **4.2. Slack Source (Novo)**
```typescript
// src/sources/slack/SlackSource.ts
export class SlackSource implements IContentSource {
  readonly name = 'slack';
  readonly version = '1.0.0';
  
  async index(config: SlackSourceConfig): Promise<IndexedContent[]> {
    const client = new WebClient(config.apiToken);
    const contents: IndexedContent[] = [];
    
    for (const channelId of config.channels) {
      // Buscar mensagens
      const messages = await client.conversations.history({ channel: channelId });
      
      // Buscar threads
      if (config.includeThreads) {
        for (const message of messages.messages || []) {
          if (message.ts) {
            const thread = await client.conversations.replies({
              channel: channelId,
              ts: message.ts,
            });
            contents.push(...this.convertThread(thread));
          }
        }
      }
    }
    
    return contents;
  }
}
```

#### **4.3. Confluence Source (Novo)**
```typescript
// src/sources/confluence/ConfluenceSource.ts
export class ConfluenceSource implements IContentSource {
  readonly name = 'confluence';
  readonly version = '1.0.0';
  private ssoAuthenticator: SSOAuthenticator;
  
  constructor() {
    this.ssoAuthenticator = new SSOAuthenticator();
  }
  
  async index(config: ConfluenceSourceConfig): Promise<IndexedContent[]> {
    // 1. Autenticar via SSO
    const authToken = await this.ssoAuthenticator.authenticate({
      type: config.ssoConfig.type,
      baseUrl: config.baseUrl,
      // SSO config será lido de variáveis de ambiente ou arquivo seguro
    });
    
    // 2. Criar cliente Confluence autenticado
    const client = new ConfluenceClient({
      baseUrl: config.baseUrl,
      auth: authToken,
    });
    
    const contents: IndexedContent[] = [];
    
    // 3. Indexar espaços configurados
    for (const spaceKey of config.spaces) {
      // Buscar todas as páginas do espaço
      const pages = await client.content.getAll({
        spaceKey,
        expand: ['body.storage', 'version', 'ancestors'],
      });
      
      for (const page of pages) {
        // Converter página para formato unificado
        contents.push({
          id: `confluence-${page.id}`,
          content: this.extractContent(page),
          metadata: {
            sourceType: 'confluence',
            sourceId: page.id,
            contentType: 'page',
            createdAt: new Date(page.version.when),
            updatedAt: new Date(page.version.when),
            author: page.version.by?.displayName,
            origin: {
              type: 'confluence',
              url: `${config.baseUrl}/pages/viewpage.action?pageId=${page.id}`,
            },
            customMetadata: {
              spaceKey: page.space?.key,
              spaceName: page.space?.name,
              title: page.title,
            },
          },
        });
      }
      
      // Indexar attachments se configurado
      if (config.includeAttachments) {
        // Buscar attachments das páginas
        // ...
      }
    }
    
    return contents;
  }
  
  private extractContent(page: any): string {
    // Extrair conteúdo HTML e converter para Markdown
    const html = page.body?.storage?.value || '';
    return this.htmlToMarkdown(html);
  }
}
```

#### **4.4. Jira Source (Novo)**
```typescript
// src/sources/jira/JiraSource.ts
export class JiraSource implements IContentSource {
  readonly name = 'jira';
  readonly version = '1.0.0';
  private ssoAuthenticator: SSOAuthenticator;
  
  constructor() {
    this.ssoAuthenticator = new SSOAuthenticator();
  }
  
  async index(config: JiraSourceConfig): Promise<IndexedContent[]> {
    // 1. Autenticar via SSO
    const authToken = await this.ssoAuthenticator.authenticate({
      type: config.ssoConfig.type,
      baseUrl: config.baseUrl,
    });
    
    // 2. Criar cliente Jira autenticado
    const client = new JiraClient({
      baseUrl: config.baseUrl,
      auth: authToken,
    });
    
    const contents: IndexedContent[] = [];
    
    // 3. Indexar projetos configurados
    for (const projectKey of config.projects) {
      // Indexar Issues
      if (config.includeIssues) {
        const issues = await client.issues.search({
          jql: `project = ${projectKey} ORDER BY updated DESC`,
          expand: ['renderedFields', 'changelog'],
        });
        
        for (const issue of issues.issues) {
          // Converter issue para formato unificado
          contents.push({
            id: `jira-${issue.id}`,
            content: this.extractIssueContent(issue),
            metadata: {
              sourceType: 'jira',
              sourceId: issue.key,
              contentType: 'issue',
              createdAt: new Date(issue.fields.created),
              updatedAt: new Date(issue.fields.updated),
              author: issue.fields.reporter?.displayName,
              origin: {
                type: 'jira',
                url: `${config.baseUrl}/browse/${issue.key}`,
              },
              customMetadata: {
                projectKey: issue.fields.project.key,
                issueType: issue.fields.issuetype.name,
                status: issue.fields.status.name,
                priority: issue.fields.priority?.name,
                assignee: issue.fields.assignee?.displayName,
              },
            },
          });
        }
      }
      
      // Indexar Comments
      if (config.includeComments) {
        // Buscar comments das issues
        // ...
      }
    }
    
    return contents;
  }
  
  private extractIssueContent(issue: any): string {
    // Combinar título, descrição e comentários
    let content = `# ${issue.fields.summary}\n\n`;
    content += `${issue.fields.description || ''}\n\n`;
    
    if (issue.fields.comment?.comments) {
      content += `## Comments\n\n`;
      for (const comment of issue.fields.comment.comments) {
        content += `**${comment.author.displayName}** (${comment.created}):\n`;
        content += `${comment.body}\n\n`;
      }
    }
    
    return content;
  }
}

#### **4.5. SSO Authenticator (Componente Compartilhado)**

**Importante:** Confluence e Jira precisam de autenticação SSO. Criar um componente compartilhado:

```typescript
// src/services/sso/SSOAuthenticator.ts
export class SSOAuthenticator {
  /**
   * Autentica via SSO (SAML, OAuth2, ou Basic)
   */
  async authenticate(config: SSOConfig): Promise<string> {
    switch (config.type) {
      case 'saml':
        return await this.authenticateSAML(config);
      case 'oauth2':
        return await this.authenticateOAuth2(config);
      case 'basic':
        return await this.authenticateBasic(config);
      default:
        throw new Error(`Unsupported SSO type: ${config.type}`);
    }
  }
  
  private async authenticateSAML(config: SSOConfig): Promise<string> {
    // Implementar autenticação SAML
    // Usar biblioteca como 'saml2-js' ou 'passport-saml'
    // Configuração via variáveis de ambiente:
    // - SSO_ENTITY_ID
    // - SSO_ENTRY_POINT
    // - SSO_CERT
    // - SSO_PRIVATE_KEY
    // ...
  }
  
  private async authenticateOAuth2(config: SSOConfig): Promise<string> {
    // Implementar OAuth2 flow
    // Usar biblioteca como 'simple-oauth2'
    // ...
  }
  
  private async authenticateBasic(config: SSOConfig): Promise<string> {
    // Basic auth (username/password)
    // Usar variáveis de ambiente:
    // - BASIC_USERNAME
    // - BASIC_PASSWORD
    // ...
  }
}
```

**Configuração via variáveis de ambiente:**
```bash
# .env ou arquivo de configuração seguro
CONFLUENCE_BASE_URL=https://confluence.empresa.com
CONFLUENCE_SSO_TYPE=saml
SSO_ENTITY_ID=https://confluence.empresa.com/sso
SSO_ENTRY_POINT=https://sso.empresa.com/saml/sso
SSO_CERT_PATH=/path/to/cert.pem
SSO_PRIVATE_KEY_PATH=/path/to/key.pem

JIRA_BASE_URL=https://jira.empresa.com
JIRA_SSO_TYPE=saml
# (mesmas variáveis SSO podem ser compartilhadas)
```

#### **4.6. Notion Source (Novo)**
```typescript
// src/sources/notion/NotionSource.ts
export class NotionSource implements IContentSource {
  readonly name = 'notion';
  readonly version = '1.0.0';
  
  async index(config: NotionSourceConfig): Promise<IndexedContent[]> {
    const client = new Client({ auth: config.apiKey });
    const contents: IndexedContent[] = [];
    
    for (const databaseId of config.databaseIds) {
      const pages = await client.databases.query({
        database_id: databaseId,
      });
      contents.push(...this.convertPages(pages.results));
    }
    
    return contents;
  }
}
```

### 🟡 **5. Sistema de Relacionamentos Cross-Source** (Diferencial)

**Status:** ❌ Ausente  
**Impacto:** ALTO - Conectar conteúdo de diferentes fontes

**O que você precisa:**
```typescript
// src/services/relationships/RelationshipMapper.ts
export class RelationshipMapper {
  /**
   * Detecta relacionamentos entre conteúdos de diferentes fontes
   */
  mapRelationships(contents: IndexedContent[]): ContentRelationship[] {
    const relationships: ContentRelationship[] = [];
    
    // Exemplo 1: Thread do Slack menciona "auth.ts" → relaciona com código
    for (const content of contents) {
      if (content.metadata.sourceType === 'slack') {
        // Extrair referências a arquivos de código
        const codeRefs = this.extractCodeReferences(content.content);
        for (const ref of codeRefs) {
          const relatedCode = this.findCodeContent(contents, ref);
          if (relatedCode) {
            relationships.push({
              source: content.id,
              target: relatedCode.id,
              type: 'discusses',
              strength: 0.8,
            });
          }
        }
      }
      
      // Exemplo 2: Página do Confluence menciona issue do Jira → relaciona
      if (content.metadata.sourceType === 'confluence') {
        const jiraRefs = this.extractJiraReferences(content.content);
        for (const ref of jiraRefs) {
          const relatedJira = this.findJiraContent(contents, ref);
          if (relatedJira) {
            relationships.push({
              source: content.id,
              target: relatedJira.id,
              type: 'references',
              strength: 0.9,
            });
          }
        }
      }
      
      // Exemplo 3: Issue do Jira menciona arquivo de código → relaciona
      if (content.metadata.sourceType === 'jira') {
        const codeRefs = this.extractCodeReferences(content.content);
        for (const ref of codeRefs) {
          const relatedCode = this.findCodeContent(contents, ref);
          if (relatedCode) {
            relationships.push({
              source: content.id,
              target: relatedCode.id,
              type: 'implements',
              strength: 0.85,
            });
          }
        }
      }
    }
    
    return relationships;
  }
  
  /**
   * Extrai referências a código de um texto
   */
  private extractCodeReferences(text: string): string[] {
    // Regex para encontrar referências como "auth.ts", "src/auth.ts", etc.
    const patterns = [
      /([a-zA-Z0-9_/-]+\.(ts|tsx|js|jsx|py|java|go|rs))/g,
      /src\/([a-zA-Z0-9_/-]+)/g,
    ];
    
    const refs: string[] = [];
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        refs.push(...matches);
      }
    }
    
    return [...new Set(refs)]; // Remove duplicatas
  }
  
  /**
   * Extrai referências a issues do Jira (ex: PROJ-123)
   */
  private extractJiraReferences(text: string): string[] {
    const pattern = /([A-Z]+-\d+)/g;
    const matches = text.match(pattern);
    return matches ? [...new Set(matches)] : [];
  }
  
  /**
   * Encontra conteúdo do Jira pelo key (ex: PROJ-123)
   */
  private findJiraContent(contents: IndexedContent[], key: string): IndexedContent | undefined {
    return contents.find(c => 
      c.metadata.sourceType === 'jira' && 
      c.metadata.sourceId === key
    );
  }
}
```

### 🟡 **6. Pipeline Unificado de Indexação** (Melhoria)

**Status:** ⚠️ Parcial  
**Impacto:** MÉDIO - Processar todas as fontes de forma coordenada

**O que você precisa:**
```typescript
// src/core/UnifiedIndexingPipeline.ts
export class UnifiedIndexingPipeline {
  constructor(
    private registry: ContentSourceRegistry,
    private embeddingProvider: IEmbeddingProvider,
    private vectorDatabase: IVectorDatabase,
    private relationshipMapper: RelationshipMapper
  ) {}
  
  /**
   * Indexa todas as fontes configuradas
   */
  async indexAll(sources: ContentSourceConfig[]): Promise<IndexedRepository> {
    const allContents: IndexedContent[] = [];
    
    // 1. Indexar cada fonte
    for (const sourceConfig of sources.sort((a, b) => 
      (a.options?.priority || 0) - (b.options?.priority || 0)
    )) {
      const source = this.registry.get(sourceConfig.type);
      if (!source) {
        throw new Error(`Content source '${sourceConfig.type}' not found`);
      }
      
      // Validar configuração
      const validation = await source.validate(sourceConfig.config);
      if (!validation.valid) {
        console.warn(`Skipping ${sourceConfig.type}: ${validation.error}`);
        continue;
      }
      
      // Indexar
      const contents = await source.index(sourceConfig.config);
      allContents.push(...contents);
    }
    
    // 2. Mapear relacionamentos
    const relationships = this.relationshipMapper.mapRelationships(allContents);
    
    // 3. Gerar embeddings
    const vectors = await this.generateEmbeddings(allContents);
    
    // 4. Armazenar no vector database
    await this.vectorDatabase.upsertBatch(vectors);
    
    // 5. Retornar repositório indexado
    return {
      totalFiles: allContents.length,
      totalVectors: vectors.length,
      sources: sources.map(s => s.type),
      relationships: relationships.length,
    };
  }
}
```

---

## 🏗️ Estrutura de Diretórios Proposta

```
src/
  sources/                    # Plugins de content sources
    repository/
      RepositorySource.ts
      index.ts
    slack/
      SlackSource.ts
      SlackMessageParser.ts
      index.ts
    confluence/
      ConfluenceSource.ts
      ConfluencePageParser.ts
      SSOAuthenticator.ts
      index.ts
    jira/
      JiraSource.ts
      JiraIssueParser.ts
      SSOAuthenticator.ts
      index.ts
    notion/
      NotionSource.ts
      NotionPageParser.ts
      index.ts
    url/
      URLSource.ts           # Refatorar URLIndexer existente
      index.ts
    
  interfaces/
    IContentSource.ts        # Interface base
    ContentSourceConfig.ts   # Tipos de configuração
    
  core/
    ContentSourceRegistry.ts # Registro de plugins
    UnifiedIndexingPipeline.ts # Pipeline unificado
    CRAGCore.ts             # Atualizar para usar registry
    
  services/
    relationships/
      RelationshipMapper.ts  # Mapeamento de relacionamentos
      CodeReferenceExtractor.ts
    sso/
      SSOAuthenticator.ts    # Autenticação SSO compartilhada
      SAMLAuthenticator.ts
      OAuth2Authenticator.ts
```

---

## 📊 Comparação: Antes vs. Depois

### **ANTES (Atual)**
```typescript
// Apenas código + URLs (hardcoded)
const rag = new CRAGCore({
  projectPath: './repo',
  urlIndexing: { ... },  // Específico para URLs
  // Não extensível
});
```

### **DEPOIS (Extensível)**
```typescript
// Qualquer fonte de conteúdo (plugins)
const rag = new CRAGCore({
  contentSources: [
    { type: 'repository', config: {...} },
    { type: 'slack', config: {...} },
    { type: 'confluence', config: { baseUrl: '...', ssoConfig: {...} } },
    { type: 'jira', config: { baseUrl: '...', ssoConfig: {...} } },
    { type: 'notion', config: {...} },
    { type: 'custom-plugin', config: {...} },  // Plugin customizado!
  ],
});
```

---

## 🎯 Plano de Implementação

### **Fase 1: Fundação (2 semanas)**
1. ✅ Criar `IContentSource` interface
2. ✅ Criar `ContentSourceRegistry`
3. ✅ Criar `UnifiedContentMetadata`
4. ✅ Refatorar `RepositoryIndexer` para `RepositorySource`
5. ✅ Refatorar `URLIndexer` para `URLSource`

### **Fase 2: Plugins Básicos (3-4 semanas)**
1. ✅ `SSOAuthenticator` (componente compartilhado)
2. ✅ `SlackSource` plugin
3. ✅ `ConfluenceSource` plugin (com SSO)
4. ✅ `JiraSource` plugin (com SSO)
5. ✅ `NotionSource` plugin (opcional)

### **Fase 3: Sistema de Relacionamentos (1-2 semanas)**
1. ✅ `RelationshipMapper`
2. ✅ Detecção automática de referências
3. ✅ Busca cross-source

### **Fase 4: Pipeline Unificado (1 semana)**
1. ✅ `UnifiedIndexingPipeline`
2. ✅ Integração com `CRAGCore`
3. ✅ Documentação de como criar plugins customizados

**Total: 7-9 semanas**

---

## 🚀 Exemplo de Uso Final

```typescript
import { CRAGCore } from '@cragjs/indexing';
import { SlackSource } from '@cragjs/indexing/sources/slack';
import { ConfluenceSource } from '@cragjs/indexing/sources/confluence';
import { JiraSource } from '@cragjs/indexing/sources/jira';
import { MyCustomSource } from './my-custom-source';  // Plugin customizado!

const rag = new CRAGCore({
  projectId: 'my-project',
  embedding: { type: 'ollama', model: 'embeddinggemma' },
  vectorDatabase: { type: 'json', storagePath: '.crag_cache' },
  
  // Registrar plugins customizados
  plugins: [
    new SlackSource(),
    new ConfluenceSource(),
    new JiraSource(),
    new MyCustomSource(),  // Seu plugin!
  ],
  
  // Configurar múltiplas fontes
  contentSources: [
    // Repositório principal
    {
      type: 'repository',
      config: { path: './main-repo' },
    },
    
    // Outro repositório
    {
      type: 'repository',
      config: { path: '../other-repo' },
    },
    
    // Slack
    {
      type: 'slack',
      config: {
        apiToken: process.env.SLACK_TOKEN,
        channels: ['#dev-team'],
      },
    },
    
    // Confluence interno (via SSO)
    {
      type: 'confluence',
      config: {
        baseUrl: 'https://confluence.empresa.com',
        ssoConfig: {
          type: 'saml', // SSO config via env vars
        },
        spaces: ['DEV', 'ARCH', 'DOCS'],
        includeAttachments: true,
      },
    },
    
    // Jira interno (via SSO)
    {
      type: 'jira',
      config: {
        baseUrl: 'https://jira.empresa.com',
        ssoConfig: {
          type: 'saml', // SSO config via env vars
        },
        projects: ['PROJ1', 'PROJ2'],
        includeIssues: true,
        includeComments: true,
      },
    },
    
    // Seu plugin customizado!
    {
      type: 'my-custom',
      config: { apiKey: '...' },
    },
  ],
});

// Indexar tudo de uma vez
await rag.indexAll();

// Buscar em todas as fontes
const results = await rag.query({
  text: 'decisões sobre autenticação',
  // Retorna: código + threads do Slack + páginas do Confluence + issues do Jira + docs
});
```

---

## 🎖️ Conclusão

**Com essa arquitetura, você terá:**

1. ✅ **Sistema verdadeiramente extensível** - Qualquer um pode criar plugins
2. ✅ **Múltiplas fontes unificadas** - Código + Slack + Confluence + Jira + Notion + etc.
3. ✅ **Autenticação SSO** - Integração segura com ferramentas corporativas
4. ✅ **Relacionamentos cross-source** - Conecta conteúdo de diferentes fontes
5. ✅ **Fácil de estender** - Interface simples para novos plugins
6. ✅ **Busca unificada** - Um único índice para tudo

**Isso é único no mercado!** Nenhuma outra biblioteca oferece essa flexibilidade.

---

**Última atualização:** Novembro 2025

