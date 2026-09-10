/** §13 flag semantics: --markdown, --output, --quiet, --suggest-version, --strict. */
import { describe, it, expect } from 'vitest';
import { run, type CliIo } from '../../src/cli/run.js';
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
// adds a NEW optional endpoint → info-level change (non-breaking)
const CURRENT = `${BASE}  /b:
    get:
      responses:
        '200': {description: OK}
`;

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

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-fl-'));
}

describe('diff flag semantics (§13)', () => {
  it('--markdown renders a markdown table', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.yaml'), BASE);
    fs.writeFileSync(path.join(d, 'b.yaml'), CURRENT);
    const io = ioFor(['diff', path.join(d, 'a.yaml'), path.join(d, 'b.yaml'), '--markdown', '--include-non-breaking']);
    const code = await run(io);
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('## ✅ API Guard');
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('--output writes the report file', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.yaml'), BASE);
    fs.writeFileSync(path.join(d, 'b.yaml'), CURRENT);
    const outPath = path.join(d, 'report.md');
    const io = ioFor([
      'diff', path.join(d, 'a.yaml'), path.join(d, 'b.yaml'),
      '--markdown', '--output', outPath, '--include-non-breaking',
    ]);
    await run(io);
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.readFileSync(outPath, 'utf8')).toContain('## ✅ API Guard');
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('--quiet prints only the verdict line', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.yaml'), BASE);
    fs.writeFileSync(path.join(d, 'b.yaml'), CURRENT);
    const io = ioFor(['diff', path.join(d, 'a.yaml'), path.join(d, 'b.yaml'), '--quiet', '--no-color']);
    const code = await run(io);
    expect(code).toBe(0);
    const out = io.out.join('\n').trim();
    expect(out.split('\n')).toHaveLength(1);
    expect(out).toContain('No breaking');
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('--suggest-version prints the bump line', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.yaml'), BASE);
    fs.writeFileSync(path.join(d, 'b.yaml'), CURRENT);
    const io = ioFor(['diff', path.join(d, 'a.yaml'), path.join(d, 'b.yaml'), '--suggest-version', '--no-color']);
    await run(io);
    expect(io.out.join('\n')).toContain('Suggested version bump:');
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('--strict includes non-breaking changes in terminal output', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.yaml'), BASE);
    fs.writeFileSync(path.join(d, 'b.yaml'), CURRENT);
    const io = ioFor(['diff', path.join(d, 'a.yaml'), path.join(d, 'b.yaml'), '--strict', '--no-color']);
    await run(io);
    expect(io.out.join('\n')).toContain('INFO');
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('--fail-on never exits 0 even with breaking changes', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a.yaml'), BASE);
    fs.writeFileSync(path.join(d, 'b.yaml'), BASE.replace("'200': {description: OK}", 'responses: {}'));
    const io = ioFor(['diff', path.join(d, 'a.yaml'), path.join(d, 'b.yaml'), '--fail-on', 'never', '--no-color']);
    const code = await run(io);
    expect(code).toBe(0);
    fs.rmSync(d, { recursive: true, force: true });
  });
});
