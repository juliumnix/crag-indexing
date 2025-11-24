/**
 * File metadata in the dependency graph
 */
export interface FileMetadata {
  /** File path (absolute) */
  filePath?: string;

  /** File path (relative) */
  path?: string;

  /** Relative path */
  relativePath?: string;

  /** File name */
  name?: string;

  /** File extension */
  extension?: string;

  /** Directory path */
  directory?: string;

  /** Dependencies (imports/exports) */
  dependencies?: string[];

  /** Imports (resolved file paths) */
  imports?: string[];

  /** Files that depend on this file */
  dependents?: string[];

  /** Files that import this file */
  importedBy?: string[];

  /** Language */
  language?: string;

  /** File size in bytes */
  size?: number;

  /** Number of lines */
  lines?: number;

  /** Number of chunks */
  chunks?: number;

  /** Core score (importance) */
  coreScore?: number;
}

/**
 * Dependency Graph - Represents relationships between files
 */
export interface DependencyGraph {
  /** Map of file paths to metadata */
  files: Map<string, FileMetadata>;

  /** Root files (files with no dependencies) */
  roots?: string[];

  /** Leaf files (files with no dependents) */
  leaves?: string[];

  /** Get files that import a given file */
  getImporters?: (filePath: string) => FileMetadata[];

  /** Get files imported by a given file */
  getImports?: (filePath: string) => FileMetadata[];
}

