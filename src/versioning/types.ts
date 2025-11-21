/**
 * Version representation
 */
export interface Version {
  /** Major version number */
  major: number;

  /** Minor version number */
  minor: number;

  /** Patch version number */
  patch: number;

  /** Prerelease identifier (e.g., "beta", "alpha") */
  prerelease?: string;

  /** Build metadata */
  build?: string;

  /** Raw version string */
  raw: string;
}

/**
 * Version Context - Information about a version
 */
export interface VersionContext {
  /** Version */
  version: Version;

  /** Git branch */
  branch?: string;

  /** Git tag */
  tag?: string;

  /** Commit hash */
  commitHash?: string;

  /** Release date */
  releaseDate?: Date;

  /** Changelog entries */
  changelog?: string[];
}

/**
 * Version Range
 */
export interface VersionRange {
  /** Minimum version (inclusive) */
  min?: Version;

  /** Maximum version (inclusive) */
  max?: Version;

  /** Exact version */
  exact?: Version;
}

/**
 * Breaking Change
 */
export interface BreakingChange {
  /** Version where change was introduced */
  version: Version;

  /** Title of the breaking change */
  title: string;

  /** Description */
  description: string;

  /** Affected components (endpoints, functions, etc.) */
  affected: string[];

  /** Link to migration guide */
  migration?: string;

  /** Severity level */
  severity: 'critical' | 'major' | 'minor';
}

/**
 * Versioned Chunk - Chunk with version information
 */
export interface VersionedChunk {
  /** Chunk ID */
  id: string;

  /** File path */
  filePath: string;

  /** Content */
  content: string;

  /** Version context */
  versionContext: VersionContext;

  /** Version range this chunk applies to */
  versionRange?: VersionRange;

  /** Version where this was deprecated */
  deprecatedIn?: Version;

  /** Version where this was removed */
  removedIn?: Version;
}

