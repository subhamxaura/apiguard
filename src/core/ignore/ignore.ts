/** Ignore engine per spec §14.3 (applied after classification) and §10.5b usage. */
import micromatch from 'micromatch';
import type { ApiChange } from '../models/change.js';
import type { ResolvedConfig } from '../config/schema.js';

export interface IgnoreStats {
  ignoredCount: number;
}

/** Split an operation key "METHOD /path" into parts; null when the format is wrong. */
export function parseOperationKey(key: string): { method: string; path: string } | null {
  const m = key.match(/^(\S+)\s+(\/.*)$/);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { method: m[1].toUpperCase(), path: m[2] };
}

function changePath(change: ApiChange): string {
  return change.location.path ?? '';
}

/**
 * Decide whether a change is ignored. Ignore rules:
 * - paths: globs match the path template (all methods); operation-level api changes use '/'
 * - operations: exact "METHOD /path" entries
 * - schemas: micromatch against componentName, and against pointer prefixes "components/schemas/X"
 * - changes: ruleId globs (e.g. "server-*")
 */
export function isIgnored(change: ApiChange, config: ResolvedConfig): boolean {
  const ignore = config.ignore;

  // --- changes: ruleId globs
  if (ignore.changes.length > 0) {
    if (micromatch.isMatch(change.ruleId, ignore.changes, { nocase: false })) return true;
  }

  const path = changePath(change);

  // --- schemas: match componentName or pointer prefixes (pointer may carry a leading #/)
  if (ignore.schemas.length > 0) {
    const name = change.location.componentName;
    if (name && micromatch.isMatch(name, ignore.schemas)) return true;
    const pointer = (change.location.pointerNew || change.location.pointerOld || '').replace(/^#\//, '');
    const SCHEMAS_SEG = 'components/schemas/';
    if (pointer && (pointer.includes(`/${SCHEMAS_SEG}`) || pointer.startsWith(SCHEMAS_SEG))) {
      const after = pointer.split(SCHEMAS_SEG)[1] ?? '';
      const rootName = after.split('/')[0]?.replace(/~1/g, '/');
      if (rootName) {
        // match the bare schema name and each glob's last segment (so "components/schemas/V1*"
        // also matches "V1Legacy": micromatch's * does not cross '/', §14.3 examples)
        if (micromatch.isMatch(rootName, ignore.schemas)) return true;
        const lastSegments = ignore.schemas.map((s) => s.split('/').pop() ?? s);
        if (micromatch.isMatch(rootName, lastSegments)) return true;
        // full-pointer match with ** semantics for the remainder
        const prefixGlobs = ignore.schemas.map((s) => `components/schemas/${s}**`);
        if (micromatch.isMatch(pointer, prefixGlobs)) return true;
      }
    }
  }

  // --- operations: exact "METHOD /path" entries
  if (ignore.operations.length > 0 && change.location.method !== undefined) {
    const opKey = `${change.location.method.toUpperCase()} ${path}`;
    if (ignore.operations.includes(opKey)) return true;
  }

  // --- paths: globs against the path template (all methods)
  if (ignore.paths.length > 0 && path && path !== '' ) {
    if (micromatch.isMatch(path, ignore.paths)) return true;
  }

  return false;
}

/** Partition changes into kept + ignored (order preserved within each). */
export function applyIgnores(
  changes: ApiChange[],
  config: ResolvedConfig,
): { kept: ApiChange[]; ignored: ApiChange[] } {
  const kept: ApiChange[] = [];
  const ignored: ApiChange[] = [];
  for (const c of changes) {
    if (isIgnored(c, config)) ignored.push(c);
    else kept.push(c);
  }
  return { kept, ignored };
}
