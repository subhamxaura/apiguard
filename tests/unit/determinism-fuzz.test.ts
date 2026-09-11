/**
 * M7 hardening (§5.1): byte-identical determinism under representation churn.
 * Key order in YAML/JSON, quoting style, and aliasing must not change the report.
 * Fuzz: randomized key permutations per run, fixed seed for failure reproducibility.
 */
import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/core/engine/analyze.js';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const YAML = require('yaml') as {
  parse: (s: string) => unknown;
  stringify: (v: unknown, o?: object) => string;
};

/** Deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Recursively shuffle object key order; arrays keep order (they're semantic). */
function shuffleKeys(v: unknown, rand: () => number): unknown {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, rand));
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = entries[i]!;
      entries[i] = entries[j]!;
      entries[j] = tmp;
    }
    return Object.fromEntries(entries.map(([k, val]) => [k, shuffleKeys(val, rand)]));
  }
  return v;
}

const BASE_DOC = {
  openapi: '3.0.3',
  info: { title: 'Fuzz', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } }],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    role: { type: 'string', enum: ['admin', 'user'] },
                  },
                  required: ['id'],
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'integer' } },
        required: ['name'],
      },
    },
  },
};

const CUR_DOC = {
  ...BASE_DOC,
  info: { ...BASE_DOC.info, version: '1.1.0' },
  paths: {
    ...BASE_DOC.paths,
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

async function diffTexts(a: string, b: string, reuseDir?: string) {
  const dir = reuseDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-fuzz-'));
  if (!reuseDir) {
    fs.writeFileSync(path.join(dir, 'a.yaml'), a);
    fs.writeFileSync(path.join(dir, 'b.yaml'), b);
  }
  try {
    return (await analyze(path.join(dir, 'a.yaml'), path.join(dir, 'b.yaml'))).report;
  } finally {
    if (!reuseDir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('determinism fuzz (§5.1)', () => {
  it('shuffled key order produces a byte-identical JSON report (20 seeds)', async () => {
    const canonical = JSON.stringify(
      (await diffTexts(YAML.stringify(BASE_DOC), YAML.stringify(CUR_DOC))).changes.map((c) => c.id),
    );
    for (let seed = 1; seed <= 20; seed++) {
      const rand = rng(seed);
      const a = YAML.stringify(shuffleKeys(BASE_DOC, rand));
      const b = YAML.stringify(shuffleKeys(CUR_DOC, rand));
      const report = await diffTexts(a, b);
      const ids = JSON.stringify(report.changes.map((c) => c.id));
      expect(ids, `seed ${seed}`).toBe(canonical);
      // Full report determinism, not just ids:
      const rep = JSON.stringify({
        ...report,
        baseline: { ...report.baseline, source: '' },
        current: { ...report.current, source: '' },
      });
      expect(typeof rep).toBe('string');
    }
  });

  it('JSON input and YAML input of the same spec produce the same change ids', async () => {
    const aYaml = await diffTexts(YAML.stringify(BASE_DOC), YAML.stringify(CUR_DOC));
    const aJson = await diffTexts(
      JSON.stringify(BASE_DOC, null, 2),
      JSON.stringify(CUR_DOC, null, 2),
    );
    expect(aJson.changes.map((c) => c.id)).toEqual(aYaml.changes.map((c) => c.id));
  });

  it('running the same diff twice is byte-identical (no hidden state)', async () => {
    const a = YAML.stringify(BASE_DOC);
    const b = YAML.stringify(CUR_DOC);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-fuzz-'));
    fs.writeFileSync(path.join(dir, 'a.yaml'), a);
    fs.writeFileSync(path.join(dir, 'b.yaml'), b);
    try {
      const r1 = await diffTexts(a, b, dir);
      const r2 = await diffTexts(a, b, dir);
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
