import { createHash } from 'node:crypto';

/** Canonicalize a value for stable hashing: sort object keys, stable stringify. */
export function canonicalize(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/** sha256 hex digest of the canonical form of a value. */
export function sha256OfValue(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

/** sha256 hex digest of raw bytes/string. */
export function sha256OfBytes(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Stable change id per spec §12:
 * sha256(ruleId|context|path|method||pointerOld|pointerNew|oldValueJSON|newValueJSON).slice(0,16)
 * Note the deliberate empty segment when method is absent.
 */
export function changeId(parts: {
  ruleId: string;
  context: string;
  path: string;
  method?: string;
  pointerOld: string;
  pointerNew: string;
  oldValue?: unknown;
  newValue?: unknown;
}): string {
  const method = parts.method ?? '';
  const oldJson = parts.oldValue === undefined ? '' : canonicalize(parts.oldValue);
  const newJson = parts.newValue === undefined ? '' : canonicalize(parts.newValue);
  const key = [
    parts.ruleId,
    parts.context,
    parts.path,
    method,
    parts.pointerOld,
    parts.pointerNew,
    oldJson,
    newJson,
  ].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
