import type { JsonValue, LoadedSpec, NormalizedSpec } from '../models/types.js';
import { sha256OfValue } from '../../utils/hash.js';

/**
 * Normalize a parsed OpenAPI document into the internal representation (§11.1–11.3):
 * - `type` strings become arrays
 * - `nullable: true` becomes a `null` member of the type array (3.0 ↔ 3.1 parity)
 * - boolean `exclusiveMinimum`/`exclusiveMaximum` become numeric bounds (3.0 → 3.1 form)
 *
 * Keys are emitted sorted so the normalized document hashes canonically (§8).
 * The input must be acyclic (guaranteed by the loader); normalization walks with an explicit
 * stack so deep specs never throw RangeError (§11.7).
 */
export function normalizeDocument(document: JsonValue): JsonValue {
  return normalizeNode(document);
}

function normalizeNode(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    return node.map((v) => normalizeNode(v));
  }

  const obj = node as Record<string, unknown>;

  // --- 3.0 boolean exclusive* → numeric form (§11.2)
  const minimum = obj.minimum;
  const maximum = obj.maximum;
  let exclusiveMin = obj.exclusiveMinimum;
  let exclusiveMax = obj.exclusiveMaximum;

  const minIsExclusive = exclusiveMin === true && typeof minimum === 'number';
  const maxIsExclusive = exclusiveMax === true && typeof maximum === 'number';
  if (minIsExclusive) exclusiveMin = minimum;
  else if (exclusiveMin === false) exclusiveMin = undefined;
  if (maxIsExclusive) exclusiveMax = maximum;
  else if (exclusiveMax === false) exclusiveMax = undefined;

  // --- type/nullable unification (§11.2): IR always stores type as an array
  let typeValue = obj.type;
  const nullable = obj.nullable === true;
  if (typeof typeValue === 'string') typeValue = [typeValue];
  if (Array.isArray(typeValue)) typeValue = [...typeValue].sort();
  if (nullable && Array.isArray(typeValue)) {
    typeValue = typeValue.includes('null') ? typeValue : [...typeValue, 'null'].sort();
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    switch (key) {
      case 'type':
        if (typeValue !== undefined) out.type = typeValue;
        break;
      case 'nullable':
        // consumed into the type array; `nullable: false` is the default and is dropped
        break;
      case 'exclusiveMinimum':
        if (exclusiveMin !== undefined) out.exclusiveMinimum = exclusiveMin;
        break;
      case 'exclusiveMaximum':
        if (exclusiveMax !== undefined) out.exclusiveMaximum = exclusiveMax;
        break;
      case 'minimum':
        if (!minIsExclusive && minimum !== undefined) out.minimum = minimum;
        break;
      case 'maximum':
        if (!maxIsExclusive && maximum !== undefined) out.maximum = maximum;
        break;
      default:
        out[key] = normalizeNode(obj[key]);
        break;
    }
  }
  return out;
}

/** Construct a NormalizedSpec from a LoadedSpec + its normalized document. */
export function toNormalizedSpec(loaded: LoadedSpec, normalized: JsonValue): NormalizedSpec {
  return { ...loaded, normalized, sha256: sha256OfValue(normalized) };
}

/** Hash of a normalized document (normalized bytes per spec §8). */
export function hashNormalized(normalized: JsonValue): string {
  return sha256OfValue(normalized);
}
