import * as fs from 'fs';
import * as path from 'path';
import type { Version } from './types';

/**
 * Version Detector
 * Detects versions from various sources (manifests, Git, URLs)
 */
export class VersionDetector {
  /**
   * Detect version from manifest file (package.json, pyproject.toml, etc.)
   */
  async detectFromManifest(filePath: string): Promise<Version | null> {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // package.json
      if (filePath.endsWith('package.json')) {
        const pkg = JSON.parse(content);
        return this.parseVersion(pkg.version);
      }

      // pyproject.toml
      if (filePath.endsWith('pyproject.toml')) {
        const match = content.match(/version\s*=\s*"([^"]+)"/);
        return match ? this.parseVersion(match[1]) : null;
      }

      // Cargo.toml
      if (filePath.endsWith('Cargo.toml')) {
        const match = content.match(/version\s*=\s*"([^"]+)"/);
        return match ? this.parseVersion(match[1]) : null;
      }

      // go.mod
      if (filePath.endsWith('go.mod')) {
        const match = content.match(/^module\s+\S+\s+v(\d+\.\d+\.\d+)/m);
        return match ? this.parseVersion(match[1]) : null;
      }
    } catch (error) {
      // Ignore errors
    }

    return null;
  }

  /**
   * Detect versions from Git tags
   */
  async detectFromGit(repoPath: string): Promise<Version[]> {
    try {
      const { execSync } = require('child_process');
      const tags = execSync('git tag -l "v*"', { cwd: repoPath, encoding: 'utf-8' })
        .toString()
        .trim()
        .split('\n')
        .filter(Boolean);

      return tags
        .map((tag: string) => this.parseVersion(tag))
        .filter((v: Version | null): v is Version => v !== null);
    } catch (error) {
      return [];
    }
  }

  /**
   * Detect version from URL patterns
   */
  detectFromURL(url: string): Version | null {
    // Patterns: /v2/, /v3.1/, /version/2.0.0/
    const patterns = [
      /\/v(\d+)(?:\.(\d+))?(?:\.(\d+))?/,
      /\/version[/-](\d+)(?:\.(\d+))?(?:\.(\d+))?/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          major: parseInt(match[1]) || 0,
          minor: parseInt(match[2]) || 0,
          patch: parseInt(match[3]) || 0,
          raw: match[0],
        };
      }
    }

    return null;
  }

  /**
   * Parse version string (semver format)
   */
  parseVersion(versionStr: string): Version | null {
    if (!versionStr) return null;

    // Remove "v" prefix
    versionStr = versionStr.replace(/^v/i, '');

    // Parse semver: 1.2.3-beta.1+build.123
    const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+(.+))?$/);

    if (!match) {
      // Try simplified format: 1.2
      const simpleMatch = versionStr.match(/^(\d+)\.(\d+)$/);
      if (simpleMatch) {
        return {
          major: parseInt(simpleMatch[1]),
          minor: parseInt(simpleMatch[2]),
          patch: 0,
          raw: versionStr,
        };
      }
      return null;
    }

    return {
      major: parseInt(match[1]),
      minor: parseInt(match[2]),
      patch: parseInt(match[3]),
      prerelease: match[4],
      build: match[5],
      raw: versionStr,
    };
  }

  /**
   * Compare two versions
   * Returns: negative if a < b, zero if a == b, positive if a > b
   */
  compare(a: Version, b: Version): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    return 0;
  }

  /**
   * Check if version is in range
   */
  inRange(version: Version, range: { min?: Version; max?: Version; exact?: Version }): boolean {
    if (range.exact) {
      return this.compare(version, range.exact) === 0;
    }

    if (range.min && this.compare(version, range.min) < 0) {
      return false;
    }

    if (range.max && this.compare(version, range.max) > 0) {
      return false;
    }

    return true;
  }
}

