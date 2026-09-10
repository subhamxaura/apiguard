/**
 * SpecLoader (§6): parser choice is swappable behind this adapter. The default uses
 * @apidevtools/swagger-parser. Remote (http/https) $refs are denied by default (§11.4).
 */
import fs from 'node:fs';
import path from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { parse as parseYaml } from 'yaml';
import { SpecLoadError, errorMessage } from '../utils/errors.js';
import { normalizeDocument, toNormalizedSpec } from '../core/engine/normalize.js';
import type { LoadedSpec, NormalizedSpec } from '../core/models/types.js';
import type { JsonValue } from '../core/models/types.js';

export interface SpecLoaderOptions {
  /** Allow http/https $refs (default false; still never fetched from CI). */
  allowRemoteRefs?: boolean;
  /** Allow file refs outside the spec's directory tree (default false). */
  allowExternalFiles?: boolean;
}

/** Options container threaded through loading (config wires into this in M3). */
export interface LoadOptions {
  loader?: SpecLoaderOptions;
}

/** Parse a YAML or JSON string into a plain JS object. */
export function parseSpecText(text: string, source: string): Record<string, unknown> {
  let parsed: unknown;
  const isJsonByExt = source.trimEnd().toLowerCase().endsWith('.json');
  if (isJsonByExt) {
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new SpecLoadError(`${source}: JSON parse error: ${errorMessage(e)}`);
    }
  } else {
    // unified parse: the YAML core schema is a JSON superset and parses JSON documents too
    try {
      parsed = parseYaml(text, { schema: 'core' });
    } catch (e) {
      throw new SpecLoadError(`${source}: YAML parse error: ${errorMessage(e)}`);
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SpecLoadError(
      `${source}: spec root must be a mapping object with an 'openapi' field (got ${describeRoot(parsed)})`,
    );
  }
  return parsed as Record<string, unknown>;
}

function describeRoot(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return `a ${typeof v}`;
}

/** Static scan for remote $refs before any network-capable step runs (§11.4). */
export function findRemoteRefs(document: unknown): string[] {
  const found: string[] = [];
  const stack: unknown[] = [document];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$ref' && typeof v === 'string') {
        const target = v.split('#')[0] ?? '';
        if (/^https?:\/\//i.test(target)) found.push(v);
      } else if (v !== null && typeof v === 'object') {
        stack.push(v);
      }
    }
  }
  return found;
}

/** Static scan for file $refs pointing outside the spec's directory tree. */
export function findExternalFileRefs(document: unknown, specDir: string): string[] {
  const found: string[] = [];
  const stack: unknown[] = [document];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$ref' && typeof v === 'string') {
        const filePart = v.split('#')[0] ?? '';
        if (filePart && !/^[a-z][a-z0-9+.-]*:/i.test(filePart)) {
          const resolved = path.resolve(specDir, filePart);
          const rel = path.relative(specDir, resolved);
          if (rel.startsWith('..') || path.isAbsolute(rel)) found.push(v);
        }
      } else if (v !== null && typeof v === 'object') {
        stack.push(v);
      }
    }
  }
  return found;
}

/**
 * Load a spec from disk: parse (YAML/JSON), guard remote/external refs, bundle local refs,
 * normalize. Returns the spec with the normalized view used by the engine.
 */
export async function loadSpec(filePath: string, options: LoadOptions = {}): Promise<NormalizedSpec> {
  const abs = path.resolve(filePath);
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw new SpecLoadError(`${filePath}: cannot read file: ${errorMessage(e)}`);
  }
  if (text.trim() === '') {
    throw new SpecLoadError(`${filePath}: file is empty — a spec must contain an OpenAPI document`);
  }

  const parsed = parseSpecText(text, filePath);

  const openapi = typeof parsed.openapi === 'string' ? parsed.openapi : '';
  if (!openapi) {
    throw new SpecLoadError(
      `${filePath}: missing 'openapi' version field — this does not look like an OpenAPI 3.x document`,
    );
  }
  if (!openapi.startsWith('3.')) {
    throw new SpecLoadError(
      `${filePath}: unsupported OpenAPI version "${openapi}" — API Guard supports 3.0.x and 3.1.x only`,
    );
  }

  const specDir = path.dirname(abs);
  const allowRemote = options.loader?.allowRemoteRefs ?? false;
  const allowExternal = options.loader?.allowExternalFiles ?? false;

  const remoteRefs = findRemoteRefs(parsed);
  if (remoteRefs.length > 0 && !allowRemote) {
    throw new SpecLoadError(
      `${filePath}: remote $ref(s) denied by default (found ${remoteRefs.length}: ` +
        `${remoteRefs.slice(0, 3).join(', ')}${remoteRefs.length > 3 ? ', …' : ''}). ` +
        `Set loader.allow-remote-refs: true in apiguard.yaml to opt in.`,
    );
  }

  const externalRefs = findExternalFileRefs(parsed, specDir);
  if (externalRefs.length > 0 && !allowExternal) {
    throw new SpecLoadError(
      `${filePath}: $ref(s) point outside the spec's directory (found ${externalRefs.length}: ` +
        `${externalRefs.slice(0, 3).join(', ')}${externalRefs.length > 3 ? ', …' : ''}). ` +
        `External-file refs are not supported in v1.`,
    );
  }

  let document: unknown;
  try {
    // bundle resolves local file refs and $ref cycles into a self-contained document
    document = await SwaggerParser.bundle(abs);
  } catch (e) {
    throw new SpecLoadError(`${filePath}: parser error: ${errorMessage(e)}`);
  }

  const info = (parsed.info ?? {}) as Record<string, unknown>;
  const title = typeof info.title === 'string' ? info.title : '';

  const loaded: LoadedSpec = {
    document: document as JsonValue,
    source: filePath,
    openapiVersion: openapi,
    title,
    sha256: '',
  };
  return toNormalizedSpec(loaded, normalizeDocument(document));
}
