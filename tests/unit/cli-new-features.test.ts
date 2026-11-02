import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { run } from '../../src/cli/run.js';
import type { CliIo } from '../../src/cli/run.js';

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tmpDirs = [];
});

function createIo(args: string[]): { io: CliIo; stdoutLines: string[]; stderrLines: string[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const io: CliIo = {
    stdout: (s) => stdoutLines.push(s),
    stderr: (s) => stderrLines.push(s),
    argv: ['node', 'apiguard', ...args],
    env: { APIGUARD_NO_COLOR: '1' },
  };
  return { io, stdoutLines, stderrLines };
}

const SPEC_BASE = `openapi: 3.0.3
info: { title: Test, version: '1.0' }
paths:
  /users:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: string }
                  status:
                    type: string
                    enum: [active, pending]
`;

const SPEC_CURRENT = `openapi: 3.0.3
info: { title: Test, version: '1.0' }
paths:
  /users:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    enum: [active, pending, archived]
`;

describe('CLI new features (HTML, SARIF, Changelog, Codegen-shim)', () => {
  it('diff --html produces interactive HTML report', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cli-html-'));
    tmpDirs.push(dir);
    const oldP = path.join(dir, 'old.yaml');
    const newP = path.join(dir, 'new.yaml');
    fs.writeFileSync(oldP, SPEC_BASE);
    fs.writeFileSync(newP, SPEC_CURRENT);

    const { io, stdoutLines } = createIo(['diff', oldP, newP, '--html']);
    const code = await run(io);
    expect(code).toBe(1); // property id was removed -> breaking change -> exit 1
    const output = stdoutLines.join('\n');
    expect(output).toContain('<!DOCTYPE html>');
    expect(output).toContain('API Guard Diff Report');
    expect(output).toContain('FAIL: Breaking Changes Detected');
  });

  it('diff --sarif produces valid SARIF JSON', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cli-sarif-'));
    tmpDirs.push(dir);
    const oldP = path.join(dir, 'old.yaml');
    const newP = path.join(dir, 'new.yaml');
    fs.writeFileSync(oldP, SPEC_BASE);
    fs.writeFileSync(newP, SPEC_CURRENT);

    const { io, stdoutLines } = createIo(['diff', oldP, newP, '--sarif']);
    const code = await run(io);
    expect(code).toBe(1);
    const parsed = JSON.parse(stdoutLines.join('\n'));
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs[0].tool.driver.name).toBe('apiguard');
  });

  it('changelog command outputs structured release notes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cli-chg-'));
    tmpDirs.push(dir);
    const oldP = path.join(dir, 'old.yaml');
    const newP = path.join(dir, 'new.yaml');
    fs.writeFileSync(oldP, SPEC_BASE);
    fs.writeFileSync(newP, SPEC_CURRENT);

    const { io, stdoutLines } = createIo(['changelog', oldP, newP]);
    const code = await run(io);
    expect(code).toBe(0);
    const output = stdoutLines.join('\n');
    expect(output).toContain('## Next Release');
    expect(output).toContain('### 🛑 Breaking Changes');
  });

  it('codegen-shim command generates compatibility middleware', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cli-shim-'));
    tmpDirs.push(dir);
    const oldP = path.join(dir, 'old.yaml');
    const newP = path.join(dir, 'new.yaml');
    fs.writeFileSync(oldP, SPEC_BASE);
    fs.writeFileSync(newP, SPEC_CURRENT);

    const { io, stdoutLines } = createIo(['codegen-shim', oldP, newP, '--target', 'express']);
    const code = await run(io);
    expect(code).toBe(0);
    const output = stdoutLines.join('\n');
    expect(output).toContain('export function apiGuardCompatibilityShim');
  });
});
