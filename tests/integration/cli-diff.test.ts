import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const CLI = path.resolve(import.meta.dirname, '../../src/cli/main.ts');
const FIX = (v: string, name: string) =>
  path.resolve(import.meta.dirname, `../../tests/fixtures/${v}/${name}`);

function runCli(args: string[], env: Record<string, string> = {}): {
  status: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync('node', ['--import', 'tsx', CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? -1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

describe('apiguard diff CLI (integration)', () => {
  it('reports no changes on identical specs (exit 0)', () => {
    const r = runCli([
      'diff',
      FIX('3.0', 'no-changes/baseline.yaml'),
      FIX('3.0', 'no-changes/current.yaml'),
      '--format',
      'json',
    ]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.summary.total).toBe(0);
    expect(report.schemaVersion).toBe('1.0');
    expect(report.changes).toEqual([]);
  });

  it('treats YAML reorder + quoting as semantically identical (§4/§11.1)', () => {
    const r = runCli([
      'diff',
      FIX('3.0', 'yaml-reorder-quote-changes-only/baseline.yaml'),
      FIX('3.0', 'yaml-reorder-quote-changes-only/current.yaml'),
      '--format',
      'json',
    ]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.summary.total).toBe(0);
  });

  it('flags removed path as breaking (exit 1, golden verdict)', () => {
    const r = runCli([
      'diff',
      FIX('3.0', 'endpoint-removed/baseline.yaml'),
      FIX('3.0', 'endpoint-removed/current.yaml'),
    ]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('❌ Breaking API changes found');
    expect(r.stdout).toContain('ERROR');
    expect(r.stdout).toContain('Path removed: /orders (all operations)');
  });

  it('emits one removed-path row instead of per-method rows (§10.2)', () => {
    const r = runCli([
      'diff',
      FIX('3.0', 'endpoint-removed/baseline.yaml'),
      FIX('3.0', 'endpoint-removed/current.yaml'),
      '--format',
      'json',
    ]);
    const report = JSON.parse(r.stdout);
    const removedPaths = report.changes.filter((c: { ruleId: string }) => c.ruleId === 'removed-path');
    expect(removedPaths).toHaveLength(1);
    expect(removedPaths[0].breaking).toBe(true);
  });

  it('response property removed is error; exit 1 (parse-side doctrine §10.5)', () => {
    const r = runCli([
      'diff',
      FIX('3.0', 'response-property-removed/baseline.yaml'),
      FIX('3.0', 'response-property-removed/current.yaml'),
      '--format',
      'json',
    ]);
    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout);
    const change = report.changes.find((c: { ruleId: string }) => c.ruleId === 'property-removed');
    expect(change.severity).toBe('error'); // parse-side: strictest class wins (§10.5b)
    expect(change.location.context).toBe('component');
    expect(change.location.componentName).toBe('UserList');
    expect(change.location.usageCount).toBeGreaterThan(0);
  });

  it('required request property added is error (send-side doctrine §10.5)', () => {
    const r = runCli([
      'diff',
      FIX('3.0', 'required-request-property-added/baseline.yaml'),
      FIX('3.0', 'required-request-property-added/current.yaml'),
      '--format',
      'json',
    ]);
    const report = JSON.parse(r.stdout);
    const change = report.changes.find(
      (c: { ruleId: string }) => c.ruleId === 'required-property-added',
    );
    expect(change).toBeDefined();
    expect(change.severity).toBe('error');
    // $ref site resolves to the component, diffed once with usage metadata (§10.5b)
    expect(change.location.context).toBe('component');
    expect(change.location.componentName).toBe('UserInput');
  });

  it('3.1 fixtures behave identically (nullable/type-array parity)', () => {
    const r = runCli([
      'diff',
      FIX('3.1', 'no-changes/baseline.yaml'),
      FIX('3.1', 'no-changes/current.yaml'),
      '--format',
      'json',
    ]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).summary.total).toBe(0);

    const b = runCli([
      'diff',
      FIX('3.1', 'response-property-removed/baseline.yaml'),
      FIX('3.1', 'response-property-removed/current.yaml'),
      '--format',
      'json',
    ]);
    expect(b.status).toBe(1);
  });

  it('cross-version 3.0 vs 3.1: nullable parity holds — only the version info row fires (§11.2)', () => {
    const dir = FIX('cross-version', '3.0-baseline-3.1-current-nullable-parity');
    const r = runCli([
      'diff',
      path.join(dir, 'baseline.yaml'),
      path.join(dir, 'current.yaml'),
      '--format',
      'json',
    ]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    const ruleIds = report.changes.map((c: { ruleId: string }) => c.ruleId);
    expect(ruleIds).toEqual(['openapi-version-changed']); // §10.1 documents this as info
    expect(report.summary.bySeverity.error).toBe(0);
  });

  it('fails with exit 3 on missing file, empty file, and non-OpenAPI YAML', () => {
    const missing = runCli(['diff', 'nope.yaml', 'nope2.yaml']);
    expect(missing.status).toBe(3);
    expect(missing.stderr).toContain('cannot read file');

    const tmp = fs.mkdtempSync('apiguard-empty-');
    const emptyFile = path.join(tmp, 'empty.yaml');
    fs.writeFileSync(emptyFile, '');
    const empty = runCli(['diff', emptyFile, emptyFile]);
    expect(empty.status).toBe(3);
    expect(empty.stderr).toContain('file is empty');

    const notSpec = path.join(tmp, 'notspec.yaml');
    fs.writeFileSync(notSpec, 'just: a map\n');
    const bad = runCli(['diff', notSpec, notSpec]);
    expect(bad.status).toBe(3);
    expect(bad.stderr).toContain("missing 'openapi'");

    const swagger2 = path.join(tmp, 'swagger.yaml');
    fs.writeFileSync(swagger2, 'swagger: "2.0"\ninfo:\n  title: x\n  version: 1.0.0\npaths: {}\n');
    const sw = runCli(['diff', swagger2, swagger2]);
    expect(sw.status).toBe(3);
    // Swagger 2.0 lacks the `openapi` field entirely — either rejection message is correct (§11.1)
    expect(sw.stderr).toMatch(/unsupported OpenAPI version|missing 'openapi'/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('denies remote $refs by default with exit 3 and actionable message (§11.4)', () => {
    const tmp = fs.mkdtempSync('apiguard-remote-');
    const spec = path.join(tmp, 'remote.yaml');
    fs.writeFileSync(
      spec,
      `openapi: 3.0.3
info: {title: x, version: 1.0.0}
paths:
  /a:
    get:
      operationId: getA
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: 'https://example.com/schema.json#/Foo'
`,
    );
    const r = runCli(['diff', spec, spec]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('remote $ref');
    expect(r.stderr).toContain('allow-remote-refs');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('output is deterministic across runs (byte-identical, §5.1)', () => {
    const args = [
      'diff',
      FIX('3.0', 'endpoint-removed/baseline.yaml'),
      FIX('3.0', 'endpoint-removed/current.yaml'),
      '--format',
      'json',
    ];
    const a = runCli(args).stdout;
    const b = runCli(args).stdout;
    expect(a).toBe(b);
  });

  it('--fail-on never downgrades exit 1 to 0 (§13/§17)', () => {
    const r = runCli([
      'diff',
      FIX('3.0', 'endpoint-removed/baseline.yaml'),
      FIX('3.0', 'endpoint-removed/current.yaml'),
      '--fail-on',
      'never',
    ]);
    expect(r.status).toBe(0);
  });

  it('--quiet prints only the verdict line (§13)', () => {
    const r = runCli([
      'diff',
      FIX('3.0', 'endpoint-removed/baseline.yaml'),
      FIX('3.0', 'endpoint-removed/current.yaml'),
      '--quiet',
    ]);
    expect(r.status).toBe(1);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Breaking API changes found');
  });

  it('--suggest-version prints MAJOR for breaking sets (§16)', () => {
    const r = runCli([
      'diff',
      FIX('3.0', 'endpoint-removed/baseline.yaml'),
      FIX('3.0', 'endpoint-removed/current.yaml'),
      '--suggest-version',
    ]);
    expect(r.stdout).toContain('Suggested version bump: MAJOR');
  });

  it('clean run with info changes prints the informational count (§13)', () => {
    const r = runCli([
      'diff',
      FIX('3.0', 'description-only-change/baseline.yaml'),
      FIX('3.0', 'description-only-change/current.yaml'),
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('✓ No breaking API changes found (1 informational change)');
  });

  it('invalid --fail-on value exits 2 (§17)', () => {
    const r = runCli([
      'diff',
      FIX('3.0', 'no-changes/baseline.yaml'),
      FIX('3.0', 'no-changes/current.yaml'),
      '--fail-on',
      'sometimes',
    ]);
    expect(r.status).toBe(2);
  });
});

describe('apiguard validate CLI (integration)', () => {
  it('valid spec exits 0 with success line', () => {
    const r = runCli(['validate', FIX('3.0', 'no-changes/baseline.yaml')]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('is valid');
  });

  it('duplicate operationIds are warnings; --strict makes exit 1 (§11.8/§13)', () => {
    const tmp = fs.mkdtempSync('apiguard-dup-');
    const spec = path.join(tmp, 'dup.yaml');
    fs.writeFileSync(
      spec,
      `openapi: 3.0.3
info: {title: x, version: 1.0.0}
paths:
  /a:
    get: {operationId: same, responses: {'200': {description: OK}}}
  /b:
    get: {operationId: same, responses: {'200': {description: OK}}}
`,
    );
    const clean = runCli(['validate', spec]);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain('duplicate operationId');

    const strict = runCli(['validate', spec, '--strict']);
    expect(strict.status).toBe(1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('unknown security scheme reference is an error (exit 3)', () => {
    const tmp = fs.mkdtempSync('apiguard-sec-');
    const spec = path.join(tmp, 'sec.yaml');
    fs.writeFileSync(
      spec,
      `openapi: 3.0.3
info: {title: x, version: 1.0.0}
paths:
  /a:
    get:
      operationId: getA
      security: [{missingScheme: []}]
      responses: {'200': {description: OK}}
`,
    );
    const r = runCli(['validate', spec]);
    expect(r.status).toBe(3);
    expect(r.stdout).toContain('unknown scheme');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('apiguard init CLI (integration)', () => {
  it('scaffolds config and never overwrites without --force (§13)', () => {
    const tmp = fs.mkdtempSync('apiguard-init-');
    try {
      const r1 = runCli(['init', tmp, '--examples']);
      expect(r1.status).toBe(0);
      expect(fs.existsSync(path.join(tmp, 'apiguard.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmp, 'examples', 'baseline.yaml'))).toBe(true);

      const r2 = runCli(['init', tmp]);
      expect(r2.status).toBe(2);
      expect(r2.stderr).toContain('refusing to overwrite');

      const r3 = runCli(['init', tmp, '--force']);
      expect(r3.status).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('generated config is valid per the config schema', () => {
    const tmp = fs.mkdtempSync('apiguard-initval-');
    try {
      runCli(['init', tmp]);
      const cfg = path.join(tmp, 'apiguard.yaml');
      const r = runCli(['diff', FIX('3.0', 'no-changes/baseline.yaml'), FIX('3.0', 'no-changes/current.yaml'), '--config', cfg]);
      expect(r.status).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
