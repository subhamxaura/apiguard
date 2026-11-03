/**
 * SpecLoader (§6): parser choice is swappable behind this adapter. The default uses
 * @apidevtools/swagger-parser. Remote (http/https) $refs are denied by default (§11.4).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
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
  /** Allow private or local IP addresses in remote spec URLs (SSRF protection). */
  allowPrivateIps?: boolean;
  /** Custom request headers for fetching remote specs (e.g. Authorization). */
  headers?: Record<string, string>;
}

/** Check if hostname points to a private/loopback address for SSRF prevention. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().trim();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h === '::') {
    return true;
  }
  // IPv4 ranges: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [b0, b1] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (b0 === 127) return true;
    if (b0 === 10) return true;
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    if (b0 === 192 && b1 === 168) return true;
    if (b0 === 169 && b1 === 254) return true;
    if (b0 === 0) return true;
  }
  // IPv6 unique local fc00::/7 or link-local fe80::/10
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) {
    return true;
  }
  return false;
}

/** Fetch remote OpenAPI spec via HTTP/HTTPS with SSRF protection. */
export async function fetchRemoteSpec(
  urlStr: string,
  options: SpecLoaderOptions = {},
): Promise<{ localPath: string; text: string }> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch (e) {
    throw new SpecLoadError(`${urlStr}: invalid URL: ${errorMessage(e)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SpecLoadError(
      `${urlStr}: unsupported protocol "${url.protocol}" (expected http: or https:)`,
    );
  }

  if (!options.allowPrivateIps && isPrivateHost(url.hostname)) {
    throw new SpecLoadError(
      `${urlStr}: remote spec blocked: private or loopback host "${url.hostname}" denied by SSRF protection. ` +
        `Set loader.allow-private-ips: true in apiguard.yaml or CLI to opt in.`,
    );
  }

  let text: string;
  try {
    const res = await fetch(urlStr, {
      headers: options.headers ?? {},
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new SpecLoadError(
        `${urlStr}: failed to fetch spec (HTTP ${res.status} ${res.statusText})`,
      );
    }
    text = await res.text();
  } catch (e) {
    if (e instanceof SpecLoadError) throw e;
    throw new SpecLoadError(`${urlStr}: network error fetching spec: ${errorMessage(e)}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-remote-'));
  const ext = url.pathname.toLowerCase().endsWith('.json') ? '.json' : '.yaml';
  const localPath = path.join(tmpDir, 'spec' + ext);
  fs.writeFileSync(localPath, text, 'utf8');
  return { localPath, text };
}

/** Fetch git spec from revision:path via git show. */
export function fetchGitSpec(
  gitUri: string,
  cwd: string = process.cwd(),
): { localPath: string; text: string } {
  const stripped = gitUri.replace(/^git:\/\//i, '').replace(/^git:/i, '');
  const colonIdx = stripped.indexOf(':');
  if (colonIdx === -1) {
    throw new SpecLoadError(`${gitUri}: invalid git spec URI (expected git://<rev>:<path>)`);
  }
  const rev = stripped.slice(0, colonIdx);
  const relPath = stripped.slice(colonIdx + 1);
  const gitRelPath = relPath.replace(/\\/g, '/');

  let text: string;
  try {
    text = execFileSync('git', ['show', `${rev}:${gitRelPath}`], { cwd, encoding: 'utf8' });
  } catch (e) {
    throw new SpecLoadError(
      `${gitUri}: failed to retrieve spec from git (${rev}:${relPath}): ${errorMessage(e)}`,
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-git-'));
  const ext = relPath.toLowerCase().endsWith('.json') ? '.json' : '.yaml';
  const localPath = path.join(tmpDir, path.basename(relPath) || 'spec' + ext);
  fs.writeFileSync(localPath, text, 'utf8');
  return { localPath, text };
}

/** Options container threaded through loading (config wires into this in M3). */
export interface LoadOptions {
  loader?: SpecLoaderOptions;
  cwd?: string;
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
export async function loadSpec(
  filePath: string,
  options: LoadOptions = {},
): Promise<NormalizedSpec> {
  let abs: string;
  let text: string;
  let tmpDirToClean: string | undefined;

  try {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const fetched = await fetchRemoteSpec(filePath, options.loader);
      abs = fetched.localPath;
      text = fetched.text;
      tmpDirToClean = path.dirname(fetched.localPath);
    } else if (filePath.startsWith('git://') || filePath.startsWith('git:')) {
      const fetched = fetchGitSpec(filePath, options.cwd);
      abs = fetched.localPath;
      text = fetched.text;
      tmpDirToClean = path.dirname(fetched.localPath);
    } else {
      abs = path.resolve(filePath);
      try {
        text = fs.readFileSync(abs, 'utf8');
      } catch (e) {
        throw new SpecLoadError(`${filePath}: cannot read file: ${errorMessage(e)}`);
      }
    }

    if (text.trim() === '') {
      throw new SpecLoadError(
        `${filePath}: file is empty — a spec must contain an OpenAPI document`,
      );
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
      rawText: text,
    };
    return toNormalizedSpec(loaded, normalizeDocument(document));
  } finally {
    if (tmpDirToClean) {
      try {
        fs.rmSync(tmpDirToClean, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
