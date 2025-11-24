import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import micromatch from 'micromatch';
import type { SemanticSearchResult } from '../model/RAGQuery';
import type { DeprecatedSource, DeprecationWarning } from './types';

/**
 * Deprecation Tracker
 * Tracks deprecated sources and adds warnings
 */
export class DeprecationTracker {
  private deprecated: Map<string, DeprecatedSource> = new Map();
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.load();
  }

  /**
   * Load deprecation config
   */
  private load(): void {
    const configPath = path.join(this.projectPath, '.crag', 'deprecation.yaml');

    if (!fs.existsSync(configPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = yaml.parse(content);

      if (config.sources && Array.isArray(config.sources)) {
        for (const sourceConfig of config.sources) {
          if (sourceConfig.deprecated) {
            this.deprecated.set(sourceConfig.url, {
              url: sourceConfig.url,
              deprecated: true,
              deprecatedAt: new Date(sourceConfig.deprecatedAt),
              reason: sourceConfig.reason,
              replacedBy: sourceConfig.replacedBy,
              removeAt: sourceConfig.removeAt ? new Date(sourceConfig.removeAt) : undefined,
            });
          }
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Check if source is deprecated
   */
  isDeprecated(url: string): DeprecatedSource | null {
    for (const [pattern, source] of this.deprecated.entries()) {
      if (micromatch.isMatch(url, pattern)) {
        return source;
      }
    }
    return null;
  }

  /**
   * Add deprecation warnings to results
   */
  addWarnings(results: SemanticSearchResult[]): SemanticSearchResult[] {
    return results.map(r => {
      const deprecated = this.isDeprecated(r.filePath);

      if (deprecated) {
        return {
          ...r,
          deprecation: {
            warning: `⚠️  This source is deprecated since ${deprecated.deprecatedAt.toISOString().split('T')[0]}`,
            reason: deprecated.reason,
            replacedBy: deprecated.replacedBy,
          },
        };
      }

      return r;
    });
  }
}

