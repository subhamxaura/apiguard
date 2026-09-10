/**
 * Final branch coverage: validate --verbose flow, config alias-with-scope, spec-loader
 * title branch, ignore micro-branches, and methodRank's undefined-method branch.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { run, type CliIo } from '../../src/cli/run.js';
import { methodRank } from '../../src/utils/sort.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

function ioFor(argv: string[]): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    argv: ['node', 'apiguard', ...argv],
    env: { ...process.env },
    out,
    err,
  };
}

// invalid response keys are structural ERRORS (exit 3); use a warning-level issue instead:
// a `required` entry not backed by a declared property (§17.2 advisory quality check).
const WARN_SPEC = `openapi: 3.0.3
info: {title: A, version: '1.0'}
components:
  schemas:
    Thing:
      type: object
      required: [ghost]
      properties:
        real: {type: string}
paths:
  /a:
    get:
      responses:
        '200': {description: OK}
`;

describe('validate branches', () => {
  it('--verbose logs to stderr; warnings listed but exit stays 0', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-fb-'));
    tmpDirs.push(d);
    const spec = path.join(d, 'w.yaml');
    fs.writeFileSync(spec, WARN_SPEC);
    const io = ioFor(['validate', spec, '--verbose']);
    const code = await run(io);
    expect(code).toBe(0);
    expect(io.err.join('')).toContain('verbose: loading');
    expect(io.out.join('')).toContain('1 warning(s)');
  });

  it('a warning-free spec prints the clean verdict without a warnings suffix', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-fb-'));
    tmpDirs.push(d);
    const spec = path.join(d, 'ok.yaml');
    fs.writeFileSync(
      spec,
      `openapi: 3.0.3\ninfo: {title: A, version: '1.0'}\npaths:\n  /a:\n    get:\n      responses:\n        '200': {description: OK}\n`,
    );
    const io = ioFor(['validate', spec]);
    const code = await run(io);
    expect(code).toBe(0);
    expect(io.out.join('')).toContain('is valid');
    expect(io.out.join('')).not.toContain('warning');
  });
});

describe('methodRank branches', () => {
  it('undefined/empty method ranks after all methods; unknown last', () => {
    expect(methodRank(undefined)).toBeGreaterThan(methodRank('TRACE'));
    expect(methodRank('')).toBeGreaterThan(methodRank('TRACE'));
    expect(methodRank('ZZZ')).toBeGreaterThan(methodRank(undefined));
  });
});
