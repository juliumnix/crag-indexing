import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { Version, BreakingChange } from './types';
import { VersionDetector } from './VersionDetector';

/**
 * Version Engine
 * Manages version information and breaking changes
 */
export class VersionEngine {
  private versionDetector: VersionDetector;
  private breakingChanges: Map<string, BreakingChange[]> = new Map();
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.versionDetector = new VersionDetector();
  }

  /**
   * Load breaking changes from config
   */
  async loadBreakingChanges(): Promise<void> {
    const configPath = path.join(this.projectPath, '.crag', 'versions.yaml');

    if (!fs.existsSync(configPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = yaml.parse(content);

      if (config.versions && Array.isArray(config.versions)) {
        for (const versionConfig of config.versions) {
          const version = this.versionDetector.parseVersion(versionConfig.version);
          if (!version) continue;

          const changes: BreakingChange[] = (versionConfig.breaking_changes || []).map(
            (bc: any) => ({
              version,
              title: bc.title,
              description: bc.description,
              affected: bc.affected || [],
              migration: bc.migration,
              severity: bc.severity || 'major',
            })
          );

          this.breakingChanges.set(version.raw, changes);
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Get breaking changes for a version
   */
  getBreakingChanges(version: Version): BreakingChange[] {
    const changes: BreakingChange[] = [];

    // Get changes for this version and all previous versions
    for (const [v, bc] of this.breakingChanges.entries()) {
      const vObj = this.versionDetector.parseVersion(v);
      if (vObj && this.versionDetector.compare(vObj, version) <= 0) {
        changes.push(...bc);
      }
    }

    return changes;
  }

  /**
   * Format breaking changes for display
   */
  formatBreakingChanges(changes: BreakingChange[]): string {
    if (changes.length === 0) {
      return '';
    }

    const lines = ['⚠️  BREAKING CHANGES DETECTED', ''];

    for (const change of changes) {
      const icon = change.severity === 'critical' ? '🔴' : '⚠️';
      lines.push(`${icon} ${change.title}`);
      lines.push(change.description);
      if (change.affected.length > 0) {
        lines.push(`Affected: ${change.affected.join(', ')}`);
      }
      if (change.migration) {
        lines.push(`Migration: ${change.migration}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get migration guide between two versions
   */
  async getMigrationGuide(from: Version, to: Version): Promise<string> {
    const changes = this.getBreakingChanges(to).filter(
      change => this.versionDetector.compare(change.version, from) > 0
    );

    if (changes.length === 0) {
      return `No breaking changes between ${from.raw} and ${to.raw}`;
    }

    return this.formatBreakingChanges(changes);
  }

  /**
   * Get version detector
   */
  getVersionDetector(): VersionDetector {
    return this.versionDetector;
  }
}

