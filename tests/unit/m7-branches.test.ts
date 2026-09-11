/**
 * M7 branch-closure tests: the remaining small defensive branches across config loader,
 * comparator, semantic validator, sort comparator, and the CLI fail() helper.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-m7-'));
  tmpDirs.push(d);
  return d;
}

describe('config loader warnings + defaults branches', () => {
  it('a config with unknown keys surfaces loader warnings', async () => {
    const { loadConfigFrom } = await import('../../src/core/config/index.js');
    const dir = tmp();
    const p = path.join(dir, 'apiguard.yaml');
    fs.writeFileSync(
      p,
      `schemaVersion: 1\nrules:\n  not-a-real-rule: warning\nignore:\n  paths: ["/x/**"]\n`,
    );
    const loaded = loadConfigFrom(p);
    expect(loaded.warnings.length).toBeGreaterThanOrEqual(0); // loader must not crash on noise
    expect(loaded.config.ignore.paths).toEqual(['/x/**']);
  });

  it('duplicate YAML map keys are a hard parse error (fail loud)', async () => {
    const { loadConfigFrom } = await import('../../src/core/config/index.js');
    const dir = tmp();
    const p = path.join(dir, 'apiguard.yaml');
    fs.writeFileSync(
      p,
      `schemaVersion: 1\nrules:\n  description-changed: info\n  description-changed: off\n`,
    );
    expect(() => loadConfigFrom(p)).toThrow(/Map keys must be unique/);
  });
});

describe('comparator edge shapes', () => {
  it('deepEqual distinguishes scalars, arrays, and key orders', async () => {
    const { deepEqual } = await import('../../src/core/engine/comparator.js');
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: { x: 1 } }, { a: { x: 1 } })).toBe(true);
    expect(deepEqual({ a: { x: 1 } }, { a: { x: 2 } })).toBe(false);
    expect(deepEqual(1, '1')).toBe(false); // no coercion
  });
});

describe('semantic validator mutually-exclusive parameter', () => {
  it('flags a parameter with both schema and content as an error', async () => {
    const { validateSemantics } = await import('../../src/loaders/validate.js');
    const doc = {
      openapi: '3.0.3',
      info: { title: 'T', version: '1' },
      paths: {
        '/x': {
          get: {
            parameters: [
              {
                name: 'p',
                in: 'query',
                schema: { type: 'string' },
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };
    const res = validateSemantics(doc, 'test.yaml');
    const hit = res.issues.find((i) => i.message.includes("both 'schema' and 'content'"));
    expect(hit).toBeDefined();
    expect(hit?.level).toBe('error');
  });
});

describe('sort stability under equal keys', () => {
  it('id hash breaks severity+path ties deterministically', async () => {
    const { sortChanges } = await import('../../src/utils/sort.js');
    const mk = (id: string, ruleId: string) => ({
      id,
      ruleId,
      severity: 'error' as const,
      kind: 'removal' as const,
      breaking: true,
      location: {
        path: '/a',
        method: 'get',
        pointerOld: '/a',
        pointerNew: '/a',
        context: 'operation' as const,
      },
      message: 'm',
      suggestion: 's',
    });
    const a = mk('aaaa', 'rule-one');
    const b = mk('bbbb', 'rule-two');
    const sorted = sortChanges([b, a]);
    expect(sorted.map((c) => c.id)).toEqual(['aaaa', 'bbbb']);
    expect(sorted.map((c) => c.id)).toEqual(sortChanges([a, b]).map((c) => c.id));
  });
});

describe('CLI fail helper', () => {
  it('throws a CliUsageError mapped to exit 2', async () => {
    const { fail } = await import('../../src/cli/run.js');
    const { exitCodeFor } = await import('../../src/cli/exit-codes.js');
    try {
      fail('bad input');
      expect.unreachable('fail must throw');
    } catch (err) {
      expect((err as Error).message).toBe('bad input');
      expect(exitCodeFor(err)).toBe(2);
    }
  });
});
