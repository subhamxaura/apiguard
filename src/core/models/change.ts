/** Core change taxonomy and change records per spec §4/§8. */

export type Severity = 'error' | 'warning' | 'info';
export type ChangeKind = 'addition' | 'removal' | 'modification' | 'relaxation' | 'documentation';

/** Config-facing severities: the three above plus 'off' to disable a rule. */
export type ConfigSeverity = Severity | 'off';

/** HTTP methods recognized in location.method. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'TRACE';

/** Where a change was found, per spec §4 taxonomy. */
export type Context =
  | 'api'
  | 'operation'
  | 'request-body'
  | 'response-body'
  | 'request-header'
  | 'response-header'
  | 'parameter'
  | 'component'
  | 'security'
  | 'callback'
  | 'webhook';

export interface ChangeLocation {
  /** URL path template, e.g. "/users/{id}"; '/' for api-level, '' for components. */
  path: string;
  method?: HttpMethod | string;
  operationId?: string;
  /** JSON Pointer into the OLD document (after deref where applicable). */
  pointerOld: string;
  /** JSON Pointer into the NEW document. */
  pointerNew: string;
  context: Context;
  /** When media-type relevant, e.g. "application/json". */
  mediaType?: string;
  /** Response context status code, e.g. "200" | "default". */
  statusCode?: string;
  /** When context === 'component'. */
  componentName?: string;
  /** Component rules: number of operation usages found. */
  usageCount?: number;
}

export interface ApiChange {
  /** stable id = sha256(...).slice(0,16) per spec §12. */
  id: string;
  ruleId: string;
  severity: Severity;
  kind: ChangeKind;
  /** Derived: severity === 'error'. Stored per spec §8. */
  breaking: boolean;
  location: ChangeLocation;
  /** Human sentence, stable template. */
  message: string;
  /** Required for every change. */
  suggestion: string;
  /** Compact raw values (never full subtrees) for the JSON reporter. */
  oldValue?: unknown;
  newValue?: unknown;
  /** True only when show-ignored rendering includes a suppressed change. */
  ignored?: boolean;
}

export interface DiffSummary {
  total: number;
  bySeverity: Record<Severity, number>;
  byKind: Record<ChangeKind, number>;
  /** Count of ignored changes (when show-ignored enabled). */
  ignored: number;
}

export interface SemverAdvice {
  bump: 'major' | 'minor' | 'patch' | 'none';
  reason: string;
  triggers: string[];
}
