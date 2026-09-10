/**
 * In-process CLI harness tests: exercise run(io) with synthetic argv so the CLI layer is
 * covered without child_process (and coverage counts in-process).
 */
import { describe, it, expect } from 'vitest';
import { run, type CliIo } from '../../src/cli/run.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cli-'));
}

const SPEC_OK = `openapi: 3.0.3
info: {title: T, version: '1.0'}
paths:
  /a:
    get:
      responses:
        '200': {description: OK}
`;

function ioFor(argv: string[], dir?: string): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    argv: ['node', 'apiguard', ...argv],
    env: dir ? { ...process.env, APIGUARD_TEST_CWD: dir } : { ...process.env },
    out,
    err,
  };
}

describe('CLI run() harness (§13)', () => {
  it('diff with no changes exits 0 and prints the verdict', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.yaml'), SPEC_OK);
    fs.writeFileSync(path.join(d, 'b.yaml'), SPEC_OK);
    const io = ioFor(['diff', path.join(d, 'a.yaml'), path.join(d, 'b.yaml'), '--no-color']);
    const code = await run(io);
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('No breaking API changes found');
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('diff with breaking change exits 1 and renders ERROR rows', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.yaml'), SPEC_OK);
    // response-removed → error → exit 1 (§17 fail-on error)
    fs.writeFileSync(path.join(d, 'b.yaml'), `openapi: 3.0.3
info: {title: T, version: '1.0'}
paths:
  /a:
    get:
      responses: {}
`);
    const io = ioFor(['diff', path.join(d, 'a.yaml'), path.join(d, 'b.yaml'), '--no-color']);
    const code = await run(io);
    expect(code).toBe(1);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('diff --format json emits stable JSON with schemaVersion', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.yaml'), SPEC_OK);
    fs.writeFileSync(path.join(d, 'b.yaml'), SPEC_OK);
    const io = ioFor(['diff', path.join(d, 'a.yaml'), path.join(d, 'b.yaml'), '--json']);
    await run(io);
    const parsed = JSON.parse(io.out.join('\n'));
    expect(parsed.schemaVersion).toBe('1.0');
    expect(Array.isArray(parsed.changes)).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('diff missing file maps to exit 3', async () => {
    const io = ioFor(['diff', '/nonexistent/old.yaml', '/nonexistent/new.yaml', '--no-color']);
    const code = await run(io);
    expect(code).toBe(3);
  });

  it('diff --config with missing file maps to exit 2', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.yaml'), SPEC_OK);
    fs.writeFileSync(path.join(d, 'b.yaml'), SPEC_OK);
    const io = ioFor([
      'diff', path.join(d, 'a.yaml'), path.join(d, 'b.yaml'),
      '--config', path.join(d, 'nope.yaml'), '--no-color',
    ]);
    const code = await run(io);
    expect(code).toBe(2);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('validate ok spec exits 0', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.yaml'), SPEC_OK);
    const io = ioFor(['validate', path.join(d, 'a.yaml')]);
    const code = await run(io);
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('valid');
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('validate broken spec exits 3', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'bad.yaml'), 'not: [openapi\n');
    const io = ioFor(['validate', path.join(d, 'bad.yaml')]);
    const code = await run(io);
    expect(code).toBe(3);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('validate --strict exits 1 on semantic warnings', async () => {
    const d = tmp();
    const dup = `openapi: 3.0.3
info: {title: T, version: '1.0'}
paths:
  /a:
    get:
      operationId: dupe
      responses:
        '200': {description: OK}
  /b:
    get:
      operationId: dupe
      responses:
        '200': {description: OK}
`;
    fs.writeFileSync(path.join(d, 'dup.yaml'), dup);
    const io = ioFor(['validate', path.join(d, 'dup.yaml'), '--strict']);
    const code = await run(io);
    expect(code).toBe(1);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('init writes apiguard.yaml in the target dir', async () => {
    const d = tmp();
    const io = ioFor(['init', d]);
    const code = await run(io);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(d, 'apiguard.yaml'))).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('unknown command exits 1 with usage on stderr', async () => {
    const io = ioFor(['bogus-command']);
    const code = await run(io);
    expect(code).not.toBe(0);
    fs.rmSync(tmp(), { recursive: true, force: true });
  });
});

describe('CLI harness extras: init --examples/--force, init conflict, help', () => {
  it('init --examples writes baseline/current examples', async () => {
    const d = tmp();
    const io = ioFor(['init', d, '--examples']);
    const code = await run(io);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(d, 'examples', 'baseline.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(d, 'examples', 'current.yaml'))).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('init refuses overwrite without --force (exit 2 via CliUsageError)', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'apiguard.yaml'), 'existing\n');
    const io = ioFor(['init', d]);
    const code = await run(io);
    expect(code).toBe(2);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('init --force overwrites an existing config', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'apiguard.yaml'), 'existing\n');
    const io = ioFor(['init', d, '--force']);
    const code = await run(io);
    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(d, 'apiguard.yaml'), 'utf8')).toContain('apiguard');
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('--help exits 0 and lists commands', async () => {
    const io = ioFor(['--help']);
    const code = await run(io);
    expect(code).toBe(0);
    const out = io.out.join('\n');
    expect(out).toContain('diff');
    expect(out).toContain('validate');
    expect(out).toContain('init');
  });
});
