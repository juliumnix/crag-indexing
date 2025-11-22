// Core
export * from './core';

// Services
export * from './services';

// URL Indexing
export * from './services/url';

// Backends
export * from './backends';

// Models
export * from './models';

// Interfaces
export * from './interfaces';

// 🆕 Content Sources (extensible architecture)
export * from './sources';

// Utils (exportar apenas os principais)
export { createTreeLogger, treeLogger, logger, setLogLevel } from './utils/logger';
export { inferLanguageFromFilePath } from './utils/language';
export {
  hasOllamaCloudApiKey,
  getOllamaCloudApiKey,
  setOllamaCloudApiKey,
  saveOllamaCloudApiKeyToEnv,
  setupOllamaCloudInteractive,
  setupOllamaCloudAuto,
  validateOllamaCloudApiKey,
} from './utils/ollamaCloudSetup';

