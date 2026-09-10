/**
 * Shared structural layer per spec §11.4/§11.7.
 *
 * `structuralDeref` resolves local `#/components/schemas/...` $refs into inline copies so
 * downstream comparison is structural (a ref whose target content changed is caught by the
 * structural comparison, §11.4). Resolution is memoized per target and cycles are broken by
 * stopping at an in-progress target (the target's own properties were already expanded once),
 * producing a finite tree from any valid OAS document.
 *
 * `dereffedPair` resolves a pair of nodes for comparison: if either side is a `$ref` node,
 * both sides are deref'd to their targets (aliasing differences are not changes, §5.4).
 */
import type { JsonObject } from '../models/types.js';

/** JSON Pointer escape (~0 → ~, / → ~1). */
export function escape(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Un-escape a JSON Pointer token. */
export function unescape(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

const REF = '$ref';

/** Expansion depth cap (§11.7): refs nested deeper stay verbatim; the differ's pairwise
 * resolution handles them under its own cap. Keeps 10k-deep chains from overflowing. */
const MAX_DEREF_DEPTH = 256;

function isObj(v: unknown): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Replace every `$ref: '#/components/schemas/X'` node with a deep copy of the target schema
 * (memoized, cycle-safe). Only operates on `components.schemas` targets — other local refs
 * (responses, parameters) are left for op-level comparison, which already handles them.
 */
export function structuralDeref(root: JsonObject): void {
  const components = root.components;
  if (!isObj(components)) return;
  const schemasMap = components.schemas;
  if (!isObj(schemasMap)) return;
  const schemas: JsonObject = schemasMap;

  const resolved = new Map<string, JsonObject>(); // name → expanded copy
  const inProgress = new Set<string>();

  const resolve = (name: string, schema: JsonObject, depth: number): JsonObject => {
    const memo = resolved.get(name);
    if (memo) return memo;
    if (inProgress.has(name)) return schema; // cycle: stop here; first expansion suffices
    inProgress.add(name);
    const out = expand(schema, depth);
    inProgress.delete(name);
    resolved.set(name, out);
    return out;
  };

  /** Expand a node: returns a new object with $ref nodes replaced (up to the depth cap). */
  function expand(node: JsonObject, depth: number): JsonObject {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === REF && typeof v === 'string') {
        const target = depth >= MAX_DEREF_DEPTH ? undefined : targetOf(v, schemas);
        if (target) {
          const expanded = resolve(target.name, target.schema, depth + 1);
          for (const [ek, ev] of Object.entries(expanded)) out[ek] = ev;
          continue; // ref node replaced entirely (siblings of $ref are ignored per OAS)
        }
        out[k] = v; // non-components ref or beyond cap: keep verbatim
        continue;
      }
      out[k] = walkValue(v, depth);
    }
    return out;
  }

  function walkValue(v: unknown, depth: number): unknown {
    if (Array.isArray(v)) return v.map((x) => walkValue(x, depth));
    if (isObj(v)) return expand(v, depth);
    return v;
  }

  for (const [name, schema] of Object.entries(schemas)) {
    if (isObj(schema)) schemas[name] = resolve(name, schema, 0);
  }
}

interface Target {
  name: string;
  schema: JsonObject;
}

function targetOf(ref: string, schemas: JsonObject): Target | undefined {
  if (!ref.startsWith('#/components/schemas/')) return undefined;
  const parts = ref
    .slice('#/components/schemas/'.length)
    .split('/')
    .map(unescape);
  let cur: unknown = schemas;
  for (const part of parts) {
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  return isObj(cur) ? { name: parts.join('/'), schema: cur } : undefined;
}

/** Is this node a `$ref` node? */
export function isRefNode(node: unknown): node is JsonObject & { $ref: string } {
  return isObj(node) && typeof node[REF] === 'string';
}

/**
 * Resolve a pair of schema nodes for comparison (§11.4): if either side is a `$ref`, both
 * sides resolve to their targets. Unresolvable refs are left as-is (compared textually).
 * `seen` guards against ref cycles (§11.7).
 */
export function dereffedPair(
  oldNode: unknown,
  newNode: unknown,
  oldSchemas: unknown,
  newSchemas: unknown,
  seen: Set<string>,
): { old: JsonObject; new: JsonObject } | undefined {
  const oldRef = isRefNode(oldNode) ? refTarget(oldNode.$ref, oldSchemas) : undefined;
  const newRef = isRefNode(newNode) ? refTarget(newNode.$ref, newSchemas) : undefined;

  if (!oldRef && !newRef) {
    return isObj(oldNode) && isObj(newNode) ? { old: oldNode, new: newNode } : undefined;
  }

  // one side refs, the other doesn't (or both do) — resolve both to targets
  const oldResolved = oldRef ? oldRef.schema : isObj(oldNode) ? stripRef(oldNode) : undefined;
  const newResolved = newRef ? newRef.schema : isObj(newNode) ? stripRef(newNode) : undefined;
  if (!oldResolved || !newResolved) return undefined;

  // cycle guard: same target pair already being compared up the stack
  const key = `${oldRef?.name ?? '•'}|${newRef?.name ?? '•'}`;
  if (oldRef && newRef && seen.has(key)) return undefined;
  if (oldRef && newRef) seen.add(key);

  return { old: oldResolved, new: newResolved };
}

/** Resolve a local components.schemas ref to the target object (original, not expanded). */
function refTarget(ref: string, schemas: unknown): Target | undefined {
  if (!isObj(schemas) || !ref.startsWith('#/components/schemas/')) return undefined;
  const parts = ref
    .slice('#/components/schemas/'.length)
    .split('/')
    .map(unescape);
  let cur: unknown = schemas;
  for (const part of parts) {
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  return isObj(cur) ? { name: parts.join('/'), schema: cur } : undefined;
}

function stripRef(node: JsonObject): JsonObject {
  if (!(REF in node)) return node;
  const out = { ...node };
  delete out[REF];
  return out;
}
