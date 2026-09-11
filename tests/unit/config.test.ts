import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverAndLoadConfig,
  applyAliases,
  mergeWithFlags,
  LEGACY_RULE_ALIASES,
  CONFIG_FILE_CANDIDATES,
} from '../../src/core/config/index.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';
import { ConfigError } from '../../src/utils/errors.js';

let tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cfg-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe('config discovery (§14.1)', () => {
  it('returns defaults when nothing found', () => {
    const d = tmp();
    const loaded = discoverAndLoadConfig({ cwd: d });
    expect(loaded.sourcePath).toBe('');
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
  });

  it('prefers apiguard.yaml over .apiguard.yml (first match wins)', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'apiguard.yaml'), 'schemaVersion: 1\n');
    fs.writeFileSync(path.join(d, '.apiguard.yml'), 'schemaVersion: 1\n');
    expect(discoverAndLoadConfig({ cwd: d }).sourcePath).toBe(path.resolve(d, 'apiguard.yaml'));
  });

  it('checks all candidates in order', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'apiguard.json'), '{"schemaVersion":1}');
    expect(discoverAndLoadConfig({ cwd: d }).sourcePath).toBe(path.resolve(d, 'apiguard.json'));
  });

  it('explicit --config missing file is a ConfigError (exit 2)', () => {
    const d = tmp();
    expect(() => discoverAndLoadConfig({ explicit: path.join(d, 'nope.yaml') })).toThrow(
      ConfigError,
    );
  });

  it('APIGUARD_CONFIG env is honored', () => {
    const d = tmp();
    const p = path.join(d, 'env.yaml');
    fs.writeFileSync(p, 'schemaVersion: 1\nfail-on: warning\n');
    const loaded = discoverAndLoadConfig({ env: p });
    expect(loaded.config.failOn).toBe('warning');
  });

  it('rejects unknown schemaVersion with ConfigError (§14.3)', () => {
    const d = tmp();
    const p = path.join(d, 'apiguard.yaml');
    fs.writeFileSync(p, 'schemaVersion: 2\n');
    expect(() => discoverAndLoadConfig({ cwd: d })).toThrow(/schemaVersion/);
  });

  it('rejects invalid severity values and unknown keys naming the key', () => {
    const d = tmp();
    fs.writeFileSync(
      path.join(d, 'apiguard.yaml'),
      'schemaVersion: 1\nrules:\n  removed-path: fatal\n',
    );
    expect(() => discoverAndLoadConfig({ cwd: d })).toThrow(ConfigError);
    fs.writeFileSync(path.join(d, 'apiguard.yaml'), 'schemaVersion: 1\nunknownKey: 1\n');
    expect(() => discoverAndLoadConfig({ cwd: d })).toThrow(ConfigError);
  });
});

describe('legacy aliases (§14.3)', () => {
  it('maps v1 keys to scoped canonical ids with warning', () => {
    const warnings: string[] = [];
    const out = applyAliases(
      { schemaVersion: 1, rules: { 'removed-request-property': 'error', 'removed-path': 'error' } },
      warnings,
    ) as { rules: Record<string, string> };
    expect(out.rules['property-removed@request-body']).toBe('error');
    expect(out.rules['removed-path']).toBe('error');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('deprecated');
  });

  it('alias map scopes each v1 id to one context only', () => {
    expect(LEGACY_RULE_ALIASES['removed-request-property']).toEqual({
      canonical: 'property-removed',
      scope: 'request-body',
    });
  });
});

describe('CLI > env > file precedence (§14.2)', () => {
  it('flags override file config', () => {
    const merged = mergeWithFlags({ ...DEFAULT_CONFIG, failOn: 'warning' }, { failOn: 'never' });
    expect(merged.failOn).toBe('never');
  });

  it('flag absent keeps file value', () => {
    const merged = mergeWithFlags({ ...DEFAULT_CONFIG, failOn: 'warning' }, {});
    expect(merged.failOn).toBe('warning');
  });

  it('--strict implies include-non-breaking', () => {
    const merged = mergeWithFlags(DEFAULT_CONFIG, { includeNonBreaking: true, failOn: 'warning' });
    expect(merged.output.includeNonBreaking).toBe(true);
  });

  it('noColor forces color never', () => {
    const merged = mergeWithFlags(DEFAULT_CONFIG, { noColor: true });
    expect(merged.output.color).toBe('never');
  });
});

describe('candidates list', () => {
  it('matches §14.1 order', () => {
    expect(CONFIG_FILE_CANDIDATES).toEqual([
      'apiguard.yaml',
      'apiguard.yml',
      'apiguard.json',
      '.apiguard.yaml',
      '.apiguard.yml',
    ]);
  });
});
