/**
 * Deprecated Source
 */
export interface DeprecatedSource {
  /** URL pattern */
  url: string;

  /** Whether deprecated */
  deprecated: boolean;

  /** When deprecated */
  deprecatedAt: Date;

  /** Reason for deprecation */
  reason: string;

  /** Replacement source */
  replacedBy?: string;

  /** When to remove */
  removeAt?: Date;
}

/**
 * Deprecation Warning
 */
export interface DeprecationWarning {
  /** Warning message */
  warning: string;

  /** Reason */
  reason: string;

  /** Replacement source */
  replacedBy?: string;
}

