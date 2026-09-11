/**
 * M5 unit tests: baseline resolution, deterministic comment rendering, and the Action
 * adapter wired to a fake @actions/core (no network, no process).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SPEC = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths: {}
`;

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe('resolveBaseline', () => {
  function initRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-base-'));
    tmpDirs.push(dir);
    const g = (args: string[]) => execFileSync('git', args, { cwd: dir });
    g(['init', '-q']);
    g(['config', 'user.email', 't@t']);
    g(['config', 'user.name', 't']);
    fs.writeFileSync(path.join(dir, 'openapi.yaml'), SPEC);
    g(['add', '.']);
    g(['commit', '-qm', 'base spec']);
    g(['branch', '-M', 'main']); // GitHub's default branch name
    // Create a branch where the spec changes, so merge-base differs from HEAD.
    g(['checkout', '-q', '-b', 'feature']);
    fs.writeFileSync(path.join(dir, 'openapi.yaml'), SPEC.replace('1.0', '2.0'));
    g(['add', '.']);
    g(['commit', '-qm', 'bump spec']);
    return dir;
  }

  it('uses the explicit baseline input when it exists', async () => {
    const { resolveBaseline } = await import('../../src/github/baseline.js');
    const dir = initRepo();
    const base = path.join(dir, 'base.yaml');
    fs.writeFileSync(base, SPEC);
    const r = resolveBaseline({
      baseline: base,
      current: path.join(dir, 'openapi.yaml'),
      cwd: dir,
    });
    expect(r.via).toBe('input');
    expect(r.path).toBe(path.resolve(base));
  });

  it('throws when the explicit baseline does not exist', async () => {
    const { resolveBaseline } = await import('../../src/github/baseline.js');
    const dir = initRepo();
    expect(() =>
      resolveBaseline({ baseline: 'missing.yaml', current: 'openapi.yaml', cwd: dir }),
    ).toThrow(/does not exist/);
  });

  it('resolves the merge-base baseline on a feature branch', async () => {
    const { resolveBaseline } = await import('../../src/github/baseline.js');
    const dir = initRepo();
    const r = resolveBaseline({ current: 'openapi.yaml', base: 'main', cwd: dir });
    expect(r.via).toBe('merge-base');
    const content = fs.readFileSync(r.path, 'utf8');
    expect(content).toContain("version: '1.0'"); // the merge-base version, not HEAD's 2.0
  });

  it('throws when the current spec is new (absent at merge-base)', async () => {
    const { resolveBaseline } = await import('../../src/github/baseline.js');
    const dir = initRepo();
    fs.writeFileSync(path.join(dir, 'new.yaml'), SPEC);
    expect(() => resolveBaseline({ current: 'new.yaml', base: 'main', cwd: dir })).toThrow(
      /newly added/,
    );
  });

  it('throws a readable error when no merge-base exists (fresh repo, no main)', async () => {
    const { resolveBaseline } = await import('../../src/github/baseline.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-nobase-'));
    tmpDirs.push(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'openapi.yaml'), SPEC);
    expect(() => resolveBaseline({ current: 'openapi.yaml', base: 'main', cwd: dir })).toThrow(
      /merge-base/,
    );
  });
});

describe('renderComment', () => {
  it('renders a deterministic, sorted report with verdict icon', async () => {
    const { renderComment } = await import('../../src/github/comment.js');
    const { analyze } = await import('../../src/core/engine/analyze.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cmt-'));
    tmpDirs.push(dir);
    const oldY = `${SPEC.replace('1.0', '1.0').replace(
      'paths: {}',
      `paths:
  /users/{id}:
    get:
      responses:
        '200': { description: ok }`,
    )}`;
    const newY = oldY.replace("'200': { description: ok }", '');
    fs.writeFileSync(path.join(dir, 'old.yaml'), oldY);
    fs.writeFileSync(path.join(dir, 'new.yaml'), newY);
    const { report } = await analyze(path.join(dir, 'old.yaml'), path.join(dir, 'new.yaml'));
    const body = renderComment(report, {
      breaking: report.summary.bySeverity.error,
      warnings: report.summary.bySeverity.warning,
      infos: report.summary.bySeverity.info,
      ignored: 0,
      suggestedVersion: 'major (removed-method)',
      verdict: 'fail',
      baselineVia: 'input',
    });
    expect(body).toContain('🚨 API Guard report');
    expect(body).toContain('| Severity | Rule | Location | Message |');
    expect(body).toContain('`response-removed`');
    expect(body).toMatchSnapshot();
  });

  it('renders the no-changes variant', async () => {
    const { renderComment } = await import('../../src/github/comment.js');
    const { analyze } = await import('../../src/core/engine/analyze.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cmt2-'));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'a.yaml'), SPEC);
    fs.writeFileSync(path.join(dir, 'b.yaml'), SPEC);
    const { report } = await analyze(path.join(dir, 'a.yaml'), path.join(dir, 'b.yaml'));
    const body = renderComment(report, {
      breaking: 0,
      warnings: 0,
      infos: 0,
      ignored: 0,
      suggestedVersion: 'no bump needed',
      verdict: 'pass',
      baselineVia: 'merge-base',
    });
    expect(body).toContain('✅ API Guard report');
    expect(body).toContain('No contract changes detected.');
  });
});

describe('runAction (fake core)', () => {
  it('maps inputs, runs the engine, and reports a failing verdict on breaking changes', async () => {
    const { runAction } = await import('../../src/github/action.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-act-'));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'openapi.yaml'), SPEC);
    const calls: Record<string, string> = {};
    const fakeCore = {
      getInput: (name: string) =>
        ({ baseline: path.join(dir, 'base.yaml'), current: 'openapi.yaml' })[name] ?? '',
      setOutput: (k: string, v: string) => {
        calls[k] = v;
      },
      summary: { addRaw: () => ({ write: () => {} }) },
      info: () => {},
      setFailed: () => {},
    };
    fs.writeFileSync(
      path.join(dir, 'base.yaml'),
      SPEC.replace(
        'paths: {}',
        `paths:
  /users:
    get:
      responses:
        '200': { description: ok }`,
      ),
    );
    const result = await runAction({
      core: fakeCore as never,
      cwd: dir,
    });
    expect(result.outcome.verdict).toBe('fail');
    expect(result.outcome.breaking).toBeGreaterThan(0);
    expect(result.commentBody).toContain('API Guard report');
    expect(calls.verdict).toBeUndefined(); // emitOutputs not called yet
  });

  it('passes when fail-on=never even with breaking changes', async () => {
    const { runAction } = await import('../../src/github/action.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-act2-'));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'openapi.yaml'), SPEC);
    fs.writeFileSync(
      path.join(dir, 'base.yaml'),
      SPEC.replace(
        'paths: {}',
        `paths:
  /users:
    get:
      responses:
        '200': { description: ok }`,
      ),
    );
    const fakeCore = {
      getInput: (name: string) =>
        ({ baseline: path.join(dir, 'base.yaml'), current: 'openapi.yaml', 'fail-on': 'never' })[
          name
        ] ?? '',
      setOutput: () => {},
      summary: { addRaw: () => ({ write: () => {} }) },
      info: () => {},
      setFailed: () => {},
    };
    const result = await runAction({ core: fakeCore as never, cwd: dir });
    expect(result.outcome.verdict).toBe('pass');
  });
});
