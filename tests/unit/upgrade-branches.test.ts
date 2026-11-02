import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runChangelog } from '../../src/cli/changelog-command.js';
import { runCodegenShim } from '../../src/cli/codegen-command.js';
import { renderChangelog } from '../../src/reporters/changelog.js';
import { renderHtml } from '../../src/reporters/html.js';
import { fetchGitSpec } from '../../src/loaders/spec-loader.js';
import { postPrComment, emitOutputs } from '../../src/github/action.js';
import type { CliIo } from '../../src/cli/run.js';
import type { DiffReport } from '../../src/core/models/report.js';

function fakeIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      argv: [],
      env: {},
    },
    out,
    err,
  };
}

const SPEC_A = `openapi: 3.0.3
info: { title: A, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200': { description: ok }
`;

describe('Upgrade branches coverage', () => {
  it('covers runChangelog error and output branches', async () => {
    const { io, out, err } = fakeIo();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-chg-br-'));
    const fA = path.join(tmp, 'a.yaml');
    const outFile = path.join(tmp, 'out.md');
    fs.writeFileSync(fA, SPEC_A);

    // Missing spec
    await expect(runChangelog('', '', {}, io)).rejects.toThrow(/missing required/);

    // gitBase with 1 spec
    await expect(runChangelog(fA, '', { gitBase: 'invalid-branch' }, io)).rejects.toThrow();

    // Valid changelog with file output and json flag
    await runChangelog(fA, fA, { json: true, output: outFile }, io);
    expect(out.length).toBeGreaterThan(0);
    expect(err.some((e) => e.includes('changelog written to'))).toBe(true);
    expect(fs.existsSync(outFile)).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('covers runCodegenShim error, invalid target, and output branches', async () => {
    const { io, out, err } = fakeIo();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-code-br-'));
    const fA = path.join(tmp, 'a.yaml');
    const outFile = path.join(tmp, 'shim.ts');
    fs.writeFileSync(fA, SPEC_A);

    // Missing spec
    await expect(runCodegenShim('', '', {}, io)).rejects.toThrow(/missing required/);

    // gitBase with 1 spec
    await expect(runCodegenShim(fA, '', { gitBase: 'invalid-branch' }, io)).rejects.toThrow();

    // Invalid target
    await expect(runCodegenShim(fA, fA, { target: 'invalid' as never }, io)).rejects.toThrow(
      /invalid --target/,
    );

    // Valid codegen with output
    await runCodegenShim(fA, fA, { target: 'express', output: outFile }, io);
    expect(out.length).toBeGreaterThan(0);
    expect(err.some((e) => e.includes('compatibility shim written to'))).toBe(true);
    expect(fs.existsSync(outFile)).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('covers renderChangelog endpoint and empty report branches', () => {
    const emptyReport: DiffReport = {
      schemaVersion: '1.0',
      tool: { name: 'apiguard', version: '1.0' },
      baseline: { source: 'a', openapiVersion: '3.0.3', title: 'T', sha256: 'h' },
      current: { source: 'b', openapiVersion: '3.0.3', title: 'T', sha256: 'h' },
      summary: {
        total: 0,
        bySeverity: { error: 0, warning: 0, info: 0 },
        byKind: { addition: 0, removal: 0, modification: 0, relaxation: 0, documentation: 0 },
        ignored: 0,
      },
      semver: { bump: 'none', reason: 'none', triggers: [] },
      changes: [],
    };
    const emptyMd = renderChangelog(emptyReport);
    expect(emptyMd).toContain('No functional contract changes detected');
    expect(emptyMd).toContain('Current Release');

    const variedReport: DiffReport = {
      ...emptyReport,
      changes: [
        {
          id: '1',
          ruleId: 'r1',
          severity: 'info',
          kind: 'relaxation',
          breaking: false,
          message: 'relaxed',
          suggestion: 'ok',
          location: {
            path: '',
            context: 'component',
            componentName: 'User',
            pointerOld: '',
            pointerNew: '',
          },
        },
        {
          id: '2',
          ruleId: 'r2',
          severity: 'info',
          kind: 'documentation',
          breaking: false,
          message: 'documented',
          suggestion: 'ok',
          location: { path: '/', context: 'api', pointerOld: '', pointerNew: '' },
        },
      ],
    };
    const variedMd = renderChangelog(variedReport);
    expect(variedMd).toContain('component `User`');
    expect(variedMd).toContain('API');
  });

  it('covers renderHtml endpointOf and value representations', () => {
    const report: DiffReport = {
      schemaVersion: '1.0',
      tool: { name: 'apiguard', version: '1.0' },
      baseline: { source: 'a', openapiVersion: '3.0.3', title: 'T', sha256: 'h' },
      current: { source: 'b', openapiVersion: '3.0.3', title: 'T', sha256: 'h' },
      summary: {
        total: 3,
        bySeverity: { error: 1, warning: 1, info: 1 },
        byKind: { addition: 1, removal: 1, modification: 1, relaxation: 0, documentation: 0 },
        ignored: 0,
      },
      semver: { bump: 'minor', reason: 'minor', triggers: [] },
      changes: [
        {
          id: '1',
          ruleId: 'r1',
          severity: 'error',
          kind: 'removal',
          breaking: true,
          message: 'Webhook changed',
          suggestion: 'Fix',
          oldValue: null,
          newValue: { a: 1 },
          location: {
            path: '',
            context: 'webhook',
            componentName: 'OrderHook',
            pointerOld: '',
            pointerNew: '',
          },
        },
        {
          id: '2',
          ruleId: 'r2',
          severity: 'warning',
          kind: 'modification',
          breaking: false,
          message: 'Component changed',
          suggestion: 'Review',
          oldValue: 123,
          newValue: 'newVal',
          location: {
            path: '',
            context: 'component',
            componentName: 'Item',
            pointerOld: '',
            pointerNew: '',
          },
        },
        {
          id: '3',
          ruleId: 'r3',
          severity: 'info',
          kind: 'addition',
          breaking: false,
          message: 'Root changed',
          suggestion: 'Check',
          location: { path: '/', context: 'api', pointerOld: '', pointerNew: '' },
        },
      ],
    };
    const html = renderHtml(report);
    expect(html).toContain('webhook OrderHook');
    expect(html).toContain('component Item');
    expect(html).toContain('API Root');
    expect(html).toContain('null');
    expect(html).toContain('newVal');
  });

  it('covers fetchGitSpec error when colon is missing', () => {
    expect(() => fetchGitSpec('git:noColonHere')).toThrow(/invalid git spec URI/);
  });

  it('covers postPrComment error catching', async () => {
    const fakeCore = {
      info: vi.fn(),
      warning: vi.fn(),
    };
    const throwingOctokit = {
      rest: {
        issues: {
          listComments: vi.fn().mockRejectedValue(new Error('GitHub API Error 500')),
        },
      },
    };
    const fakeContext = {
      payload: { pull_request: { number: 10 } },
      repo: { owner: 'o', repo: 'r' },
    };

    await postPrComment('token', 'body', {
      core: fakeCore as never,
      context: fakeContext as never,
      octokit: throwingOctokit as never,
    });
    expect(fakeCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('could not post/update PR comment: GitHub API Error 500'),
    );
  });

  it('covers emitOutputs with notice severity change and summary write error fallback', () => {
    const fakeCore = {
      setOutput: vi.fn(),
      summary: {
        addRaw: () => ({
          write: () => {
            throw new Error('Summary write failed');
          },
        }),
      },
      warning: vi.fn(),
      error: vi.fn(),
      notice: vi.fn(),
    };

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-emit-'));
    const mdFile = path.join(tmp, 'report.md');

    emitOutputs(
      fakeCore as never,
      {
        outcome: {
          breaking: 0,
          warnings: 0,
          infos: 1,
          ignored: 0,
          suggestedVersion: 'none',
          verdict: 'pass',
          baselineVia: 'input',
        },
        commentBody: 'Body',
        report: {
          schemaVersion: '1.0',
          tool: { name: 'apiguard', version: '1.0' },
          baseline: { source: 'a', openapiVersion: '3.0.3', title: 'T', sha256: 'h' },
          current: { source: 'b', openapiVersion: '3.0.3', title: 'T', sha256: 'h' },
          summary: {
            total: 1,
            bySeverity: { error: 0, warning: 0, info: 1 },
            byKind: { addition: 1, removal: 0, modification: 0, relaxation: 0, documentation: 0 },
            ignored: 0,
          },
          semver: { bump: 'none', reason: 'none', triggers: [] },
          changes: [
            {
              id: '1',
              ruleId: 'r1',
              severity: 'info',
              kind: 'addition',
              breaking: false,
              message: 'Info message',
              suggestion: 'sug',
              location: {
                path: '/p',
                context: 'api',
                file: 'spec.yaml',
                line: 12,
                column: 4,
                pointerOld: '',
                pointerNew: '',
              },
            },
          ],
        },
      },
      mdFile,
    );

    expect(fakeCore.notice).toHaveBeenCalledWith(
      'Info message. Suggestion: sug',
      expect.objectContaining({ startLine: 12 }),
    );
    expect(fakeCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('could not write job summary'),
    );
    expect(fs.existsSync(mdFile)).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
