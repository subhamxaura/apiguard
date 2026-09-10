/** Operation & component index per spec §9 (engine/index stage). */
import type { JsonObject } from '../models/types.js';
import { isHttpMethod } from '../../loaders/validate.js';
import { METHOD_RANK } from '../../utils/sort.js';

export interface OperationEntry {
  path: string;
  method: string; // uppercase
  operation: JsonObject;
  pathItem: JsonObject;
}

export interface SpecIndex {
  /** Sorted path keys present in the document. */
  paths: string[];
  /** Path items by literal (normalized) path template key. */
  pathItems: Map<string, JsonObject>;
  /** Operations sorted by (path, method rank). */
  operations: OperationEntry[];
  /** components.schemas by name (may be empty). */
  schemas: Map<string, JsonObject>;
  /** Top-level webhooks (3.1) by name. */
  webhooks: Map<string, JsonObject>;
}

function asObject(v: unknown): JsonObject | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : undefined;
}

export function buildSpecIndex(document: unknown): SpecIndex {
  const doc = asObject(document) ?? {};
  const pathsObj = asObject(doc.paths) ?? {};
  const paths = Object.keys(pathsObj).sort();
  const pathItems = new Map<string, JsonObject>();
  const operations: OperationEntry[] = [];

  for (const p of paths) {
    const item = asObject(pathsObj[p]);
    if (!item) continue;
    pathItems.set(p, item);
    const methods = Object.keys(item)
      .filter((k) => isHttpMethod(k))
      .sort((a, b) => (METHOD_RANK[a.toUpperCase()] ?? 99) - (METHOD_RANK[b.toUpperCase()] ?? 99));
    for (const m of methods) {
      const op = asObject(item[m]);
      if (!op) continue;
      operations.push({ path: p, method: m.toUpperCase(), operation: op, pathItem: item });
    }
  }

  const components = asObject(doc.components) ?? {};
  const schemasObj = asObject(components.schemas) ?? {};
  const schemas = new Map<string, JsonObject>();
  for (const [name, schema] of Object.entries(schemasObj)) {
    const obj = asObject(schema);
    if (obj) schemas.set(name, obj);
  }

  const webhooksObj = asObject(doc.webhooks) ?? {};
  const webhooks = new Map<string, JsonObject>();
  for (const [name, wh] of Object.entries(webhooksObj)) {
    const obj = asObject(wh);
    if (obj) webhooks.set(name, obj);
  }

  return { paths, pathItems, operations, schemas, webhooks };
}

/**
 * Merge path-level and operation-level parameters per OAS rules (§11.8): op-level wins on
 * identical name+in. Returns the effective parameter list for an operation.
 */
export function mergedParameters(pathItem: JsonObject, operation: JsonObject): JsonObject[] {
  const out: JsonObject[] = [];
  const seen = new Set<string>();
  const opParams = paramList(operation.parameters);
  for (const p of opParams) {
    const key = paramKey(p);
    seen.add(key);
    out.push(p);
  }
  for (const p of paramList(pathItem.parameters)) {
    const key = paramKey(p);
    if (!seen.has(key)) out.push(p);
  }
  return out;
}

function paramList(v: unknown): JsonObject[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is JsonObject => x !== null && typeof x === 'object' && !Array.isArray(x),
  );
}

function paramKey(p: JsonObject): string {
  const name = typeof p.name === 'string' ? p.name : '';
  const loc = typeof p.in === 'string' ? p.in : '';
  return `${name}::${loc}`;
}
