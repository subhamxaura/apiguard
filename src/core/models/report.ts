/** Per-spec metadata used by reporters, per spec §8 DiffReport sides. */
export interface SpecMeta {
  source: string;
  openapiVersion: string;
  title: string;
  sha256: string;
}

/** Full diff report — the machine contract (§15.1). Field order matters. */
export interface DiffReport {
  schemaVersion: '1.0';
  tool: { name: 'apiguard'; version: string };
  baseline: SpecMeta;
  current: SpecMeta;
  summary: import('./change.js').DiffSummary;
  changes: import('./change.js').ApiChange[];
  semver: import('./change.js').SemverAdvice;
  /** Present only when show-ignored is enabled. */
  ignored?: import('./change.js').ApiChange[];
}

/** Version string for the report/tool header; kept in one place. */
export const TOOL_VERSION = '0.1.0';
