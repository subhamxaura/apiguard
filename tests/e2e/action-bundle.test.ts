/**
 * M5 e2e: run the BUILT bundle (dist/index.js) as a real node process against a fixture
 * git repo, exactly like the Actions runner does (INPUT_* env vars, GITHUB_* context).
 * Proves the bundle is self-contained (no node_modules required at runtime).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import esbuild from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BUNDLE = path.join(ROOT, 'dist/index.cjs');

let workspace = '';
let made = false;

const BASE = `openapi: 3.0.3
info: { title: Demo, version: '1.0.0' }
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
`;

const BROKEN = `openapi: 3.0.3
info: { title: Demo, version: '1.1.0' }
paths: {}
`;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function runAction(env: Record<string, string>) {
  // Real runners pre-create the step-summary file; @actions/core only appends.
  const summaryPath = path.join(workspace, 'summary.md');
  if (!fs.existsSync(summaryPath)) fs.writeFileSync(summaryPath, '');
  return spawnSync(process.execPath, [BUNDLE], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_REPOSITORY: 'acme/demo',
      GITHUB_JOB: 'apiguard',
      GITHUB_REF: 'refs/heads/feature',
      RUNNER_TEMP: workspace,
      GITHUB_STEP_SUMMARY: summaryPath,
      ...env,
    },
    encoding: 'utf8',
  });
}

describe('action bundle e2e', () => {
  beforeAll(async () => {
    // Build fresh so the test never runs against a stale bundle.
    await esbuild.build({
      entryPoints: [path.join(ROOT, 'src/github/action-entry.ts')],
      bundle: true,
      platform: 'node',
      target: 'node20',
      outfile: BUNDLE,
      minify: true,
    });

    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-e2e-'));
    made = true;
    git(['init', '-q'], workspace);
    git(['config', 'user.email', 't@t'], workspace);
    git(['config', 'user.name', 't'], workspace);
    fs.writeFileSync(path.join(workspace, 'openapi.yaml'), BASE);
    git(['add', '.'], workspace);
    git(['commit', '-qm', 'base'], workspace);
    git(['branch', '-M', 'main'], workspace);
    git(['checkout', '-q', '-b', 'feature'], workspace);
    fs.writeFileSync(path.join(workspace, 'openapi.yaml'), BROKEN);
    git(['add', '.'], workspace);
    git(['commit', '-qm', 'break it'], workspace);
  });

  afterAll(() => {
    if (made) fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('fails on breaking changes and emits outputs (merge-base baseline)', () => {
    const r = runAction({ 'INPUT_CURRENT': 'openapi.yaml', 'INPUT_BASE': 'main' });
    expect(r.status).not.toBe(0);
    const out = r.stdout + r.stderr;
    expect(out).toContain('::set-output name=breaking::1');
    expect(out).toContain('::set-output name=verdict::fail');
    expect(out).toContain('breaking change');
    // Job summary is written like a real runner would.
    const summary = fs.readFileSync(path.join(workspace, 'summary.md'), 'utf8');
    expect(summary).toContain('🚨 API Guard report');
    expect(summary).toContain('resolved via merge-base');
  });

  it('passes with fail-on=never despite breaking changes', () => {
    const r = runAction({
      'INPUT_CURRENT': 'openapi.yaml',
      'INPUT_BASE': 'main',
      'INPUT_FAIL-ON': 'never',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('::set-output name=verdict::pass');
  });

  it('writes the markdown report when markdown-file is set', () => {
    const md = path.join(workspace, 'report.md');
    const r = runAction({
      'INPUT_CURRENT': 'openapi.yaml',
      'INPUT_BASE': 'main',
      'INPUT_FAIL-ON': 'never',
      'INPUT_MARKDOWN-FILE': md,
    });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(md, 'utf8')).toContain('API Guard report');
  });

  it('fails with a readable message for a missing spec', () => {
    const r = runAction({ 'INPUT_CURRENT': 'nope.yaml', 'INPUT_BASE': 'main' });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/nope\.yaml/);
  });
});
