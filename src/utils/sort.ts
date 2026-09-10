import type { ApiChange, ChangeLocation, Severity } from '../core/models/change.js';
import { changeId } from './hash.js';

/** Severity rank: error=0, warning=1, info=2. */
export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Method rank per spec §5.2, then others alphabetically. */
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'];
export const METHOD_RANK: Record<string, number> = {};
for (const [i, m] of METHOD_ORDER.entries()) METHOD_RANK[m] = i;

export function methodRank(method: string | undefined): number {
  if (!method) return METHOD_ORDER.length; // api-level or component changes after methods
  const r = METHOD_RANK[method.toUpperCase()];
  return r ?? METHOD_ORDER.length + 1;
}

/** Compare helper for the total ordering per spec §5.2. */
export function compareChanges(a: ApiChange, b: ApiChange): number {
  const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sev !== 0) return sev;

  const path = (a.location.path ?? '').localeCompare(b.location.path ?? '', 'en', {
    sensitivity: 'variant',
  });
  if (path !== 0) return path;

  const meth = methodRank(a.location.method) - methodRank(b.location.method);
  if (meth !== 0) return meth;

  const po = a.location.pointerOld.localeCompare(b.location.pointerOld, 'en', {
    sensitivity: 'variant',
  });
  if (po !== 0) return po;

  const pn = a.location.pointerNew.localeCompare(b.location.pointerNew, 'en', {
    sensitivity: 'variant',
  });
  if (pn !== 0) return pn;

  const rule = a.ruleId.localeCompare(b.ruleId, 'en', { sensitivity: 'variant' });
  if (rule !== 0) return rule;

  // Final tie-break: stable id hash (makes the ordering total).
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Sort changes in place per the §5.2 comparator. */
export function sortChanges(changes: ApiChange[]): ApiChange[] {
  changes.sort(compareChanges);
  return changes;
}

/** Dedupe by change id (first occurrence wins) per spec §5.6/§12. */
export function dedupeChanges(changes: ApiChange[]): ApiChange[] {
  const seen = new Set<string>();
  const out: ApiChange[] = [];
  for (const c of changes) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** Convenience: build the change id from a location + rule parts. */
export function idFor(
  ruleId: string,
  location: ChangeLocation,
  oldValue?: unknown,
  newValue?: unknown,
): string {
  return changeId({
    ruleId,
    context: location.context,
    path: location.path,
    method: location.method,
    pointerOld: location.pointerOld,
    pointerNew: location.pointerNew,
    oldValue,
    newValue,
  });
}

/** Escape a JSON pointer token per RFC 6901. */
export function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Join pointer tokens into a JSON pointer string (e.g. "#/paths/~1users/get"). */
export function pointerJoin(...tokens: (string | number)[]): string {
  return `#/${tokens.map((t) => escapePointerToken(String(t))).join('/')}`;
}
