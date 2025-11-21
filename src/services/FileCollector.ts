import * as fs from 'fs';
import * as path from 'path';
import { createTreeLogger } from '../utils/logger';
import type { TreeLogger } from '../utils/treeLogger';

/**
 * Default directories to exclude from file collection
 */
export const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.github',
  '.next',
  'out',
  'storybook-static',
  '.vscode',
  '.idea',
  'tmp',
  'temp',
  // Note: .crag is NOT excluded so that URL-indexed content can be included
]);

/**
 * Patterns for non-core paths (tests, examples, etc.)
 */
export const NON_CORE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)tests?\//i,
  /(^|\/)specs?\//i,
  /(^|\/)__tests__\//i,
  /(^|\/)__mocks__\//i,
  /(^|\/)mocks?\//i,
  /(^|\/)fixtures?\//i,
  /(^|\/)stories?\//i,
  /(^|\/)examples?\//i,
  /(^|\/)example\//i,
  /\.test\.[tj]sx?$/i,
  /\.spec\.[tj]sx?$/i,
  /\.stories\.[tj]sx?$/i,
];

/**
 * Valid file extensions for code analysis
 */
export const VALID_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

/**
 * Configuration for file collection
 */
export interface FileCollectorConfig {
  /** Extensions to include (defaults to VALID_EXTENSIONS) */
  validExtensions?: string[];

  /** Directories to exclude (defaults to EXCLUDED_DIRECTORIES) */
  excludeDirectories?: Set<string>;

  /** Whether to exclude test files */
  excludeTestFiles?: boolean;

  /** Custom patterns for non-core paths */
  nonCorePatterns?: RegExp[];

  /** Include glob patterns */
  includePatterns?: string[];

  /** Exclude glob patterns */
  excludePatterns?: string[];

  /** Follow symbolic links */
  followSymlinks?: boolean;

  /** Maximum depth for directory traversal (undefined = unlimited) */
  maxDepth?: number;
}

/**
 * Result from file collection
 */
export interface FileCollectionResult {
  /** All collected file paths */
  files: string[];

  /** Files that were skipped and reasons */
  skipped: Array<{
    path: string;
    reason: string;
  }>;

  /** Errors encountered during collection */
  errors: Array<{
    path: string;
    error: string;
  }>;

  /** Statistics about the collection */
  stats: {
    totalFiles: number;
    totalSkipped: number;
    totalErrors: number;
    directoriesTraversed: number;
  };
}

/**
 * FileCollector
 * Responsible for collecting files from the repository
 */
export class FileCollector {
  private log: TreeLogger;
  private config: Required<FileCollectorConfig>;

  constructor(config: FileCollectorConfig = {}) {
    this.log = createTreeLogger({ component: 'FileCollector' }, { structuredLogger: false });

    this.config = {
      validExtensions: config.validExtensions || VALID_EXTENSIONS,
      excludeDirectories: config.excludeDirectories || EXCLUDED_DIRECTORIES,
      excludeTestFiles: config.excludeTestFiles ?? true,
      nonCorePatterns: config.nonCorePatterns || NON_CORE_PATH_PATTERNS,
      includePatterns: config.includePatterns || [],
      excludePatterns: config.excludePatterns || [],
      followSymlinks: config.followSymlinks ?? false,
      maxDepth: config.maxDepth ?? Infinity,
    };
  }

  /**
   * Collect files from multiple input paths
   */
  async collect(inputPaths: string[]): Promise<FileCollectionResult> {
    const files: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    const errors: Array<{ path: string; error: string }> = [];
    let directoriesTraversed = 0;

    for (const inputPath of inputPaths) {
      try {
        const resolvedPath = path.resolve(inputPath);

        if (!fs.existsSync(resolvedPath)) {
          this.log.warn({ inputPath, resolvedPath }, 'Input path does not exist');
          skipped.push({ path: inputPath, reason: 'does not exist' });
          continue;
        }

        const stats = this.getStats(resolvedPath);

        if (!stats) {
          skipped.push({ path: inputPath, reason: 'cannot stat' });
          continue;
        }

        if (stats.isFile()) {
          if (this.shouldIncludeFile(resolvedPath)) {
            files.push(resolvedPath);
          } else {
            skipped.push({ path: resolvedPath, reason: 'does not match criteria' });
          }
        } else if (stats.isDirectory()) {
          directoriesTraversed++;
          const result = this.collectFromDirectory(resolvedPath, 0);
          files.push(...result.files);
          skipped.push(...result.skipped);
          errors.push(...result.errors);
          directoriesTraversed += result.directoriesTraversed;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.log.error({ inputPath, error: errorMessage }, 'Failed to collect from path');
        errors.push({ path: inputPath, error: errorMessage });
      }
    }

    const result: FileCollectionResult = {
      files,
      skipped,
      errors,
      stats: {
        totalFiles: files.length,
        totalSkipped: skipped.length,
        totalErrors: errors.length,
        directoriesTraversed,
      },
    };

    this.log.info(
      `Collected ${result.stats.totalFiles} files (${result.stats.totalSkipped} skipped, ${result.stats.totalErrors} errors)`
    );

    return result;
  }

  /**
   * Recursively collect files from a directory
   */
  private collectFromDirectory(
    dirPath: string,
    depth: number
  ): Omit<FileCollectionResult, 'stats'> & { directoriesTraversed: number } {
    const files: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    const errors: Array<{ path: string; error: string }> = [];
    let directoriesTraversed = 0;

    // Check max depth
    if (this.config.maxDepth !== undefined && depth >= this.config.maxDepth) {
      return { files, skipped, errors, directoriesTraversed };
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const normalizedPath = this.normalizePath(fullPath);

        // Skip hidden files and excluded directories
        // But allow .crag directory (for URL-indexed content)
        const isCragDir = entry.name === '.crag';
        if ((entry.name.startsWith('.') && !isCragDir) || this.shouldSkipDirectory(entry.name)) {
          skipped.push({ path: fullPath, reason: 'excluded directory' });
          continue;
        }

        // Skip test files if configured
        if (this.config.excludeTestFiles && this.isNonCorePath(entry.isDirectory() ? `${normalizedPath}/` : normalizedPath)) {
          skipped.push({ path: fullPath, reason: 'non-core path' });
          continue;
        }

        if (entry.isFile()) {
          if (this.shouldIncludeFile(fullPath)) {
            files.push(fullPath);
          } else {
            skipped.push({ path: fullPath, reason: 'does not match criteria' });
          }
        } else if (entry.isDirectory()) {
          directoriesTraversed++;
          const subResult = this.collectFromDirectory(fullPath, depth + 1);
          files.push(...subResult.files);
          skipped.push(...subResult.skipped);
          errors.push(...subResult.errors);
          directoriesTraversed += subResult.directoriesTraversed;
        } else if (entry.isSymbolicLink() && this.config.followSymlinks) {
          const stats = this.getStats(fullPath);
          if (stats?.isDirectory()) {
            directoriesTraversed++;
            const subResult = this.collectFromDirectory(fullPath, depth + 1);
            files.push(...subResult.files);
            skipped.push(...subResult.skipped);
            errors.push(...subResult.errors);
            directoriesTraversed += subResult.directoriesTraversed;
          } else if (stats?.isFile() && this.shouldIncludeFile(fullPath)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ dirPath, error: errorMessage }, 'Failed to read directory');
      errors.push({ path: dirPath, error: errorMessage });
    }

    return { files, skipped, errors, directoriesTraversed };
  }

  /**
   * Check if a file should be included
   */
  private shouldIncludeFile(filePath: string): boolean {
    // Check valid extension
    const hasValidExtension = this.config.validExtensions.some(ext =>
      filePath.endsWith(ext)
    );

    if (!hasValidExtension) {
      return false;
    }

    // Check if it's a test file
    if (this.config.excludeTestFiles && this.isNonCorePath(filePath)) {
      return false;
    }

    // TODO: Add support for include/exclude glob patterns

    return true;
  }

  /**
   * Check if directory should be skipped
   */
  private shouldSkipDirectory(dirName: string): boolean {
    return this.config.excludeDirectories.has(dirName.toLowerCase());
  }

  /**
   * Check if path matches non-core patterns
   */
  private isNonCorePath(filePath: string): boolean {
    const normalized = this.normalizePath(filePath);
    return this.config.nonCorePatterns.some(pattern => pattern.test(normalized));
  }

  /**
   * Normalize path separators
   */
  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  /**
   * Get file stats safely
   */
  private getStats(filePath: string): fs.Stats | null {
    try {
      return fs.statSync(filePath);
    } catch {
      return null;
    }
  }
}

