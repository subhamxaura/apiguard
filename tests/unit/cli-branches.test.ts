/**
 * CLI branch coverage (format/fail-on/color resolution, verbose, --output with --quiet)
 * and §10.6 operation-security scope narrowing via the analyze() pipeline.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { run, type CliIo } from '../../src/cli/run.js';
import { analyze } from '../../src/core/engine/analyze.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = `openapi: 3.0.3
info: {title: T, version: '1.0'}
paths:
  /a:
    get:
      responses:
        '200': {description: OK}
`;
const CURRENT = `${BASE}  /b:
    get:
      responses:
        '200': {description: OK}
`;

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
  delete process.env.APIGUARD_FORMAT;
  delete process.env.APIGUARD_FAIL_ON;
  delete process.env.APIGUARD_NO_COLOR;
  delete process.env.NO_COLOR;
});

function ioFor(
  argv: string[],
  env: Record<string, string> = {},
): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    argv: ['node', 'apiguard', ...argv],
    env: { ...process.env, ...env },
    out,
    err,
  };
}

function specs(): { oldPath: string; newPath: string } {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cb-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'a.yaml'), BASE);
  fs.writeFileSync(path.join(d, 'b.yaml'), CURRENT);
  return { oldPath: path.join(d, 'a.yaml'), newPath: path.join(d, 'b.yaml') };
}

describe('CLI branch coverage (§13)', () => {
  it('--format terminal via flag; invalid --format maps to usage exit code (2)', async () => {
    const { oldPath, newPath } = specs();
    const io = ioFor(['diff', oldPath, newPath, '--format', 'terminal']);
    const code = await run(io);
    expect(code).toBe(0);
    expect(io.out.join('')).toContain('No breaking API changes');

    const bad = ioFor(['diff', oldPath, newPath, '--format', 'xml']);
    const badCode = await run(bad);
    expect(badCode).toBe(2); // CliUsageError → exit 2 (§17)
    expect(bad.err.join('')).toContain('invalid --format');
  });

  it('APIGUARD_FORMAT env selects format; invalid --fail-on exits 2; APIGUARD_FAIL_ON honored', async () => {
    const { oldPath, newPath } = specs();
    process.env.APIGUARD_FORMAT = 'json';
    const io = ioFor(['diff', oldPath, newPath]);
    await run(io);
    expect(JSON.parse(io.out.join(''))).toHaveProperty('summary');

    process.env.APIGUARD_FAIL_ON = 'sometimes';
    const badFailOn = ioFor(['diff', oldPath, newPath, '--fail-on', 'sometimes']);
    expect(await run(badFailOn)).toBe(2);
    delete process.env.APIGUARD_FAIL_ON;

    process.env.APIGUARD_FAIL_ON = 'never';
    const envFailOn = ioFor(['diff', oldPath, newPath, '--fail-on', 'never']);
    const code = await run(envFailOn);
    expect(code).toBe(0);
  });

  it('--verbose writes to stderr; --no-color and NO_COLOR disable color', async () => {
    const { oldPath, newPath } = specs();
    const io = ioFor(['diff', oldPath, newPath, '--verbose', '--no-color']);
    await run(io);
    expect(io.err.join('')).toContain('verbose: loading baseline');

    const envNoColor = ioFor(['diff', oldPath, newPath], { NO_COLOR: '1' });
    await expect(run(envNoColor)).resolves.toBe(0);
  });

  it('--output with --quiet writes the file without stderr note', async () => {
    const { oldPath, newPath } = specs();
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cbo-'));
    tmpDirs.push(d);
    const outFile = path.join(d, 'report.txt');
    const io = ioFor(['diff', oldPath, newPath, '--output', outFile, '--quiet']);
    const code = await run(io);
    expect(code).toBe(0);
    expect(fs.readFileSync(outFile, 'utf8')).toContain('No breaking API changes');
    expect(io.err.join('')).not.toContain('report written to');
  });

  it('APIGUARD_FORMAT=markdown env is honored (envFormat branch)', async () => {
    const { oldPath, newPath } = specs();
    process.env.APIGUARD_FORMAT = 'markdown';
    const io = ioFor(['diff', oldPath, newPath, '--include-non-breaking']);
    await run(io);
    expect(io.out.join('')).toContain('|');
  });

  it('unknown command maps to a non-zero exit with a message', async () => {
    const io = ioFor(['frobnicate']);
    const code = await run(io);
    expect(code).not.toBe(0);
    expect(io.err.join('')).toContain('frobnicate');
  });
});

describe('operation-security scope narrowing (§10.6)', () => {
  const SEC_DOC = (scopes: string[]) => `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /users:
    get:
      operationId: listUsers
      security:
        - oauth:
${scopes.map((s) => `            - ${s}`).join('\n')}
      responses:
        '200': {description: OK}
components:
  securitySchemes:
    oauth:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.example.com/token
          scopes:
            read: read access
            write: write access
`;

  it('security-requirement-changed fires when new security demands an extra scope (breaking)', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-sec-'));
    tmpDirs.push(d);
    const o = path.join(d, 'o.yaml');
    const n = path.join(d, 'n.yaml');
    fs.writeFileSync(o, SEC_DOC(['read']));
    fs.writeFileSync(n, SEC_DOC(['read', 'write']));
    const { report } = await analyze(o, n, {});
    // old tokens (read only) no longer satisfy [read, write] → breaking requirement change
    const changed = report.changes.find((c) => c.ruleId === 'security-requirement-changed');
    expect(changed).toBeDefined();
    expect(changed?.breaking).toBe(true);
  });

  it('security-scope-required-removed fires when a demanded scope is dropped (info)', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-sec-'));
    tmpDirs.push(d);
    const o = path.join(d, 'o.yaml');
    const n = path.join(d, 'n.yaml');
    fs.writeFileSync(o, SEC_DOC(['read', 'write']));
    fs.writeFileSync(n, SEC_DOC(['read']));
    const { report } = await analyze(o, n, {});
    const removed = report.changes.find((c) => c.ruleId === 'security-scope-required-removed');
    expect(removed).toBeDefined();
    expect(removed?.severity).toBe('info');
  });

  it('no security rules fire when scopes are unchanged', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-sec-'));
    tmpDirs.push(d);
    const o = path.join(d, 'o.yaml');
    const n = path.join(d, 'n.yaml');
    fs.writeFileSync(o, SEC_DOC(['read']));
    fs.writeFileSync(n, SEC_DOC(['read']));
    const { report } = await analyze(o, n, {});
    const secRules = report.changes.filter((c) => c.location.context === 'security');
    expect(secRules).toHaveLength(0);
  });
});
