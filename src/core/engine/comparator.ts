/** Value/constraint comparison helpers per spec §11.3. */
import type { JsonObject } from '../models/types.js';

/** Deep structural equality on plain JSON data. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as JsonObject;
  const bo = b as JsonObject;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length) return false;
  if (!ak.every((k, i) => k === bk[i])) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}

/** IR types are arrays; render compactly for messages/values ("string" vs ["string","null"]). */
export function typeLabel(t: unknown): string {
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.join('|');
  return JSON.stringify(t) ?? 'unknown';
}

export function isObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Numeric constraints compared as numbers (already normalized per §11.3). */
export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Direction of a numeric bound change. `lower` bounds (minimum, minLength, minItems):
 * raising = tighter. `upper` bounds: lowering = tighter.
 */
export type Tighter = 'tightened' | 'relaxed' | 'same';

export function boundDirection(
  kind: 'lower' | 'upper',
  oldV: number | undefined,
  newV: number | undefined,
): Tighter {
  if (oldV === undefined && newV === undefined) return 'same';
  if (oldV === newV) return 'same';
  if (oldV === undefined)
    return newV === undefined ? 'same' : kind === 'lower' ? 'tightened' : 'tightened';
  if (newV === undefined) return 'relaxed';
  if (oldV === newV) return 'same';
  if (kind === 'lower') return newV > oldV ? 'tightened' : 'relaxed';
  return newV < oldV ? 'tightened' : 'relaxed';
}

/** Which exclusive bound key corresponds to a min/max key (§11.2 numeric form). */
export function exclusiveKeyFor(key: string): 'exclusiveMinimum' | 'exclusiveMaximum' | undefined {
  if (key === 'minimum') return 'exclusiveMinimum';
  if (key === 'maximum') return 'exclusiveMaximum';
  return undefined;
}

export const LOWER_BOUNDS = ['minimum', 'minLength', 'minItems'] as const;
export const UPPER_BOUNDS = ['maximum', 'maxLength', 'maxItems'] as const;
export const CONSTRAINT_KEYS = [
  'pattern',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'multipleOf',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
] as const;
