/**
 * Config loader edge branches (JSON configs, env discovery, aliases, malformed configs)
 * and the ignore-engine branch matrix (§14.3).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  loadConfigFrom,
  discoverAndLoadConfig,
  applyAliases,
  discoverConfigPaths,
  CONFIG_FILE_CANDIDATES,
  LEGACY_RULE_ALIASES,
} from '../../src/core/config/loader.js';
import { isIgnored, parseOperationKey, applyIgnores } from '../../src/core/ignore/ignore.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';
import type { ApiChange } from '../../src/core/models/change.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

function tmpFile(name: string, body: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cfg-'));
  tmpDirs.push(d);
  const p = path.join(d, name);
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

describe('config loader branches', () => {
  it('loads JSON configs (.json extension branch)', () => {
    const p = tmpFile('apiguard.json', JSON.stringify({ schemaVersion: 1, rules: { 'title-changed': 'off' } }));
    const loaded = loadConfigFrom(p);
    expect(loaded.config.rules['title-changed']).toBe('off');
    expect(loaded.sourcePath).toBe(p);
  });
  it('throws ConfigError for missing explicit file', () => {
    expect(() => loadConfigFrom(path.join(os.tmpdir(), 'nope-9x.yaml'))).toThrow(/config file not found/);
  });
  it('throws ConfigError for invalid YAML/JSON', () => {
    const p = tmpFile('bad.yaml', 'rules: [unclosed');
    expect(() => loadConfigFrom(p)).toThrow(/invalid YAML\/JSON/);
  });
  it('throws ConfigError with key path for schema violations', () => {
    const p = tmpFile('bad2.yaml', "schemaVersion: 1\nrules:\n  title-changed: 'sometimes'\n");
    expect(() => loadConfigFrom(p)).toThrow(/invalid config at key "rules\.title-changed"/);
  });
  it('rejects unknown schemaVersion values', () => {
    const p = tmpFile('v99.yaml', 'schemaVersion: 99\n');
    expect(() => loadConfigFrom(p)).toThrow(/schemaVersion must be 1/);
  });
  it('discovers via explicit and env paths, resolving relative to cwd', () => {
    const p = tmpFile('apiguard.yaml', 'schemaVersion: 1\nrules: {}\n');
    const viaExplicit = discoverAndLoadConfig({ explicit: p });
    expect(viaExplicit.sourcePath).toBe(p);
    const viaEnv = discoverAndLoadConfig({ env: p });
    expect(viaEnv.sourcePath).toBe(p);
    // relative explicit path resolved against cwd
    const dir = path.dirname(p);
    const rel = discoverAndLoadConfig({ explicit: path.basename(p), cwd: dir });
    expect(rel.sourcePath).toBe(p);
  });
  it('falls back to defaults when no candidate exists', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-empty-'));
    tmpDirs.push(d);
    const loaded = discoverAndLoadConfig({ cwd: d });
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
  });
  it('discoverConfigPaths honors explicit then env then candidates', () => {
    expect(discoverConfigPaths('a.yaml', 'b.yaml')).toEqual(['a.yaml']);
    expect(discoverConfigPaths(undefined, 'b.yaml')).toEqual(['b.yaml']);
    expect(discoverConfigPaths()).toEqual(CONFIG_FILE_CANDIDATES.map(String));
  });
  it('applyAliases rewrites legacy keys and collects warnings; ignores non-objects', () => {
    const warnings: string[] = [];
    const firstKey = Object.keys(LEGACY_RULE_ALIASES)[0] as string;
    const alias = LEGACY_RULE_ALIASES[firstKey] as { canonical: string; scope?: string };
    const canonical = alias.scope ? `${alias.canonical}@${alias.scope}` : alias.canonical;
    const out = applyAliases({ rules: { [firstKey]: 'warning' } }, warnings) as {
      rules: Record<string, string>;
    };
    expect(out.rules[canonical]).toBe('warning');
    expect(out.rules[firstKey]).toBeUndefined();
    expect(warnings.length).toBeGreaterThan(0);
    // non-object inputs pass through untouched
    expect(applyAliases(null, [])).toBeNull();
    expect(applyAliases('x', [])).toBe('x');
    expect(applyAliases({ rules: 'not-an-object' }, [])).toEqual({ rules: 'not-an-object' });
  });
});

/** Minimal change builder for ignore tests. */
function change(over: Partial<ApiChange['location']> & { ruleId?: string }): ApiChange {
  const { ruleId = 'property-type-changed', ...location } = over;
  return {
    ruleId,
    severity: 'error',
    kind: 'modification',
    breaking: true,
    message: 'm',
    suggestion: 's',
    location: { path: '/', pointerOld: '#/a', pointerNew: '#/a', context: 'api', ...location },
    id: 'x',
  } as ApiChange;
}

const cfg = (ignore: object) => ({
  ...DEFAULT_CONFIG,
  ignore: { ...DEFAULT_CONFIG.ignore, ...ignore },
}) as typeof DEFAULT_CONFIG;

describe('parseOperationKey', () => {
  it('parses METHOD + path, uppercases the method, rejects garbage', () => {
    expect(parseOperationKey('GET /users')).toEqual({ method: 'GET', path: '/users' });
    expect(parseOperationKey('post /pets')).toEqual({ method: 'POST', path: '/pets' });
    expect(parseOperationKey('GET')).toBeNull();
    expect(parseOperationKey('GET noslash')).toBeNull();
  });
});

describe('isIgnored branch matrix (§14.3)', () => {
  it('changes: ruleId globs', () => {
    const c = cfg({ changes: ['server-*'] });
    expect(isIgnored(change({ ruleId: 'server-url-added' }), c)).toBe(true);
    expect(isIgnored(change({ ruleId: 'title-changed' }), c)).toBe(false);
  });
  it('schemas: componentName match', () => {
    const c = cfg({ schemas: ['Legacy*'] });
    expect(isIgnored(change({ componentName: 'LegacyUser' }), c)).toBe(true);
    expect(isIgnored(change({ componentName: 'User' }), c)).toBe(false);
  });
  it('schemas: pointer with leading #/ and nested prefixes', () => {
    const c = cfg({ schemas: ['V1*'] });
    expect(isIgnored(change({ pointerNew: '#/components/schemas/V1Legacy' }), c)).toBe(true);
    expect(isIgnored(change({ pointerOld: '#/paths/~1users/get/responses/200/content/~1appl/json/schema' }), c)).toBe(false);
  });
  it('operations: exact METHOD + path match', () => {
    const c = cfg({ operations: ['GET /users'] });
    expect(isIgnored(change({ method: 'get', path: '/users' }), c)).toBe(true);
    expect(isIgnored(change({ method: 'POST', path: '/users' }), c)).toBe(false);
  });
  it('paths: glob match on path template; api-level empty path not matched', () => {
    const c = cfg({ paths: ['/users/*'] });
    expect(isIgnored(change({ path: '/users/123' }), c)).toBe(true);
    expect(isIgnored(change({ path: '/orders' }), c)).toBe(false);
    expect(isIgnored(change({ path: '' }), c)).toBe(false);
  });
  it('applyIgnores partitions preserving order', () => {
    const c = cfg({ paths: ['/hidden/**'] });
    const a = change({ path: '/hidden/x' });
    const b = change({ path: '/shown' });
    const { kept, ignored } = applyIgnores([a, b, a], c);
    expect(kept).toHaveLength(1);
    expect(ignored).toHaveLength(2);
    expect(kept[0]).toBe(b);
  });
});
