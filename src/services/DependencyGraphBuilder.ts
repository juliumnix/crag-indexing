import * as path from 'path';
import * as fs from 'fs';
import type { FileMetadata, DependencyGraph } from '../models/FileMetadata';

/**
 * Builds dependency graph for a set of files
 * Analyzes imports/exports to create relationships
 */
export class DependencyGraphBuilder {
  private fileMap: Map<string, string> = new Map(); // normalized path -> actual path
  private importGraph: Map<string, Set<string>> = new Map(); // file -> files it imports
  private reverseGraph: Map<string, Set<string>> = new Map(); // file -> files that import it

  /**
   * Build dependency graph from file paths
   */
  async build(filePaths: string[]): Promise<DependencyGraph> {
    // Reset state
    this.fileMap.clear();
    this.importGraph.clear();
    this.reverseGraph.clear();

    const files = new Map<string, FileMetadata>();

    // Initialize maps
    for (const filePath of filePaths) {
      const normalized = this.normalizePath(filePath);
      this.fileMap.set(normalized, filePath);
      this.importGraph.set(filePath, new Set());
      this.reverseGraph.set(filePath, new Set());
    }

    // Extract imports from each file
    for (const filePath of filePaths) {
      const imports = await this.extractImports(filePath);
      const resolvedImports = imports
        .map(imp => this.resolveImport(filePath, imp, filePaths))
        .filter((imp): imp is string => imp !== null);

      // Create file metadata
      const metadata: FileMetadata = {
        filePath,
        path: filePath,
        name: path.basename(filePath),
        relativePath: this.getRelativePath(filePath),
        size: 0, // Will be set later if needed
        language: this.detectLanguage(filePath),
        directory: path.dirname(filePath),
        extension: path.extname(filePath),
        imports: resolvedImports,
        importedBy: [], // Will be populated below
        lines: 0, // Will be set later if needed
        chunks: 0, // Will be set later if needed
      };

      files.set(filePath, metadata);
      this.importGraph.set(filePath, new Set(resolvedImports));

      // Build reverse graph
      for (const resolved of resolvedImports) {
        if (this.reverseGraph.has(resolved)) {
          this.reverseGraph.get(resolved)!.add(filePath);
        }
      }
    }

    // Populate importedBy
    for (const [filePath, metadata] of files) {
      const importedBySet = this.reverseGraph.get(filePath) || new Set();
      metadata.importedBy = Array.from(importedBySet);
    }

    // Calculate core scores
    for (const metadata of files.values()) {
      metadata.coreScore = this.calculateCoreScore(metadata, files);
    }

    const graph: DependencyGraph = {
      files,
      getImporters: (filePath: string) => {
        const importers = this.reverseGraph.get(filePath) || new Set();
        return Array.from(importers).map(fp => files.get(fp)!).filter(Boolean);
      },
      getImports: (filePath: string) => {
        const imports = this.importGraph.get(filePath) || new Set();
        return Array.from(imports).map(fp => files.get(fp)!).filter(Boolean);
      },
    };

    return graph;
  }

  /**
   * Extract import statements from a file using regex
   * Simple implementation that works for most TypeScript/JavaScript imports
   */
  private async extractImports(filePath: string): Promise<string[]> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const imports: string[] = [];

      // Match ES6 imports: import ... from '...'
      const es6ImportRegex = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = es6ImportRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }

      // Match require() calls: require('...')
      const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = requireRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }

      // Match dynamic imports: import('...')
      const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = dynamicImportRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }

      return imports;
    } catch (error) {
      // If file can't be read, return empty array
      return [];
    }
  }

  /**
   * Resolve import path to actual file
   */
  private resolveImport(
    fromFile: string,
    importPath: string,
    allFiles: string[]
  ): string | null {
    // Ignore external imports
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const dir = path.dirname(fromFile);
    let resolved: string;

    if (importPath.startsWith('.')) {
      resolved = path.resolve(dir, importPath);
    } else {
      resolved = path.resolve(importPath);
    }

    // Try different extensions
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

    for (const ext of extensions) {
      const candidate = resolved + ext;
      const normalized = this.normalizePath(candidate);

      for (const file of allFiles) {
        if (this.normalizePath(file) === normalized) {
          return file;
        }
      }
    }

    return null;
  }

  /**
   * Calculate core score for a file (0-100)
   * Higher score = more important/central to the codebase
   */
  private calculateCoreScore(
    metadata: FileMetadata,
    allFiles: Map<string, FileMetadata>
  ): number {
    let score = 0;

    // Factor 1: Number of files that import this file (popularity)
    const importCount = (metadata.importedBy || []).length;
    score += Math.min(importCount * 10, 40);

    // Factor 2: Path-based heuristics
    if (metadata.filePath && this.isCorePathPattern(metadata.filePath)) {
      score += 30;
    }

    // Factor 3: Hub factor (imports many files)
    if ((metadata.imports || []).length > 5) {
      score += 15;
    }

    // Factor 4: Imported by core files
    const coreImporters = (metadata.importedBy || []).filter(importer => {
      const importerMeta = allFiles.get(importer);
      return importerMeta && importerMeta.filePath && this.isCorePathPattern(importerMeta.filePath);
    });
    score += coreImporters.length * 5;

    // Penalties
    if (metadata.filePath && this.isConfigFile(metadata.filePath)) {
      score -= 50;
    }

    if (metadata.filePath && this.isDocumentationFile(metadata.filePath)) {
      score -= 50;
    }

    if (importCount === 0 && metadata.filePath && !this.isEntryFile(metadata.filePath)) {
      score -= 20;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Check if file path matches core patterns
   */
  private isCorePathPattern(filePath: string): boolean {
    const normalized = this.normalizePath(filePath);
    const corePatterns = [
      /[/\\](utils?|services?|core|lib|api|store|state|hooks?|models?|types?|constants?)[/\\]/i,
    ];
    return corePatterns.some(pattern => pattern.test(normalized));
  }

  /**
   * Check if file is a configuration file
   */
  private isConfigFile(filePath: string): boolean {
    const basename = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const configNames = [
      'config', 'setup', 'jest', 'webpack', 'vite', 'rollup',
      'babel', 'metro', 'next', 'tailwind', 'postcss', 'eslint',
      'prettier', 'tsconfig',
    ];
    return configNames.some(name => basename.includes(name));
  }

  /**
   * Check if file is documentation
   */
  private isDocumentationFile(filePath: string): boolean {
    const normalized = this.normalizePath(filePath);
    return /[/\\]doc(s|umentation)?[/\\]/i.test(normalized) ||
           /[/\\]storybook[/\\]/i.test(normalized) ||
           /[/\\]\.storybook[/\\]/i.test(normalized);
  }

  /**
   * Check if file is an entry point
   */
  private isEntryFile(filePath: string): boolean {
    const basename = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const entryNames = ['main', 'index', 'app', 'entry', 'server', 'client'];
    return entryNames.includes(basename);
  }

  /**
   * Detect language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath);
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
    };
    return languageMap[ext] || 'unknown';
  }

  /**
   * Get relative path (for display)
   */
  private getRelativePath(filePath: string): string {
    // Try to get relative from cwd
    const cwd = process.cwd();
    if (filePath.startsWith(cwd)) {
      return path.relative(cwd, filePath);
    }
    return filePath;
  }

  /**
   * Normalize path for comparison
   */
  private normalizePath(filePath: string): string {
    return path.resolve(filePath).replace(/\\/g, '/');
  }
}

