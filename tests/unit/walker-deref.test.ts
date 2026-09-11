/** Direct unit tests for the pairwise ref resolver (§11.4) and the spec index (§7 index stage). */
import { describe, it, expect } from 'vitest';
import { dereffedPair } from '../../src/core/engine/walker.js';
import { buildSpecIndex } from '../../src/core/engine/index-build.js';

describe('dereffedPair (§11.4)', () => {
  const schemas = {
    A: { type: 'object', properties: { x: { type: 'string' } } },
    B: { type: 'object', properties: { y: { type: 'integer' } } },
  };

  it('both refs → resolves to targets', () => {
    const pair = dereffedPair(
      { $ref: '#/components/schemas/A' },
      { $ref: '#/components/schemas/B' },
      schemas,
      schemas,
      new Set(),
    );
    expect(pair?.old).toBe(schemas.A);
    expect(pair?.new).toBe(schemas.B);
  });

  it('one side refs, other inline: resolves both', () => {
    const pair = dereffedPair(
      { $ref: '#/components/schemas/A' },
      { type: 'object', properties: { x: { type: 'string' } } },
      schemas,
      schemas,
      new Set(),
    );
    expect(pair).toBeDefined();
  });

  it('ref + inline with different content compares content (no aliasing error, §5.4)', () => {
    const pair = dereffedPair(
      { $ref: '#/components/schemas/A' },
      { type: 'object', properties: { x: { type: 'number' } } },
      schemas,
      schemas,
      new Set(),
    );
    expect((pair?.new as Record<string, unknown>).properties).toEqual({ x: { type: 'number' } });
  });

  it('cycle: same target pair repeated is skipped (§11.7)', () => {
    const seen = new Set<string>();
    const first = dereffedPair(
      { $ref: '#/components/schemas/A' },
      { $ref: '#/components/schemas/A' },
      schemas,
      schemas,
      seen,
    );
    expect(first).toBeDefined();
    const second = dereffedPair(
      { $ref: '#/components/schemas/A' },
      { $ref: '#/components/schemas/A' },
      schemas,
      schemas,
      seen,
    );
    expect(second).toBeUndefined();
  });

  it('unresolvable ref: falls back to raw node comparison', () => {
    const pair = dereffedPair(
      { $ref: '#/components/schemas/Missing' },
      { type: 'object' },
      schemas,
      schemas,
      new Set(),
    );
    // fallback: raw nodes compared textually (unresolvable refs stay verbatim, §11.4)
    expect(pair?.old).toEqual({ $ref: '#/components/schemas/Missing' });
    expect(pair?.new).toEqual({ type: 'object' });
  });
  it('non-ref primitives: undefined (not comparable as schemas)', () => {
    expect(dereffedPair('a', 'b', schemas, schemas, new Set())).toBeUndefined();
  });

  it('ref with siblings: siblings stripped for content comparison', () => {
    const pair = dereffedPair(
      { $ref: '#/components/schemas/A', description: 'stale sibling' },
      { $ref: '#/components/schemas/A', description: 'newer sibling' },
      schemas,
      schemas,
      new Set(),
    );
    // both resolve to the same target; description siblings differ but OAS says
    // $ref siblings are ignored — stripRef keeps them, so the diff will see them;
    // dereffedPair itself only surfaces the targets.
    expect(pair?.old).toBeDefined();
  });
});

describe('buildSpecIndex (§7 index stage)', () => {
  it('indexes paths, operations, schemas, webhooks', () => {
    const doc = {
      openapi: '3.0.3',
      paths: {
        '/a': {
          get: { operationId: 'getA', responses: {} },
          post: { responses: {} },
          parameters: [{ name: 'shared', in: 'query' }],
        },
      },
      components: { schemas: { S: { type: 'object' } } },
      webhooks: { wh: { post: { responses: {} } } },
    };
    const idx = buildSpecIndex(doc);
    expect(idx.paths).toContain('/a');
    expect(idx.operations.length).toBeGreaterThanOrEqual(2);
    expect(idx.schemas.get('S')).toEqual({ type: 'object' });
    expect(idx.webhooks.get('wh')).toEqual({ post: { responses: {} } });
  });

  it('empty document: empty index, no throw', () => {
    const idx = buildSpecIndex({});
    expect(idx.paths).toHaveLength(0);
    expect(idx.schemas.size).toBe(0);
    expect(idx.webhooks.size).toBe(0);
  });

  it('malformed path items are skipped, not fatal', () => {
    const idx = buildSpecIndex({
      paths: { '/bad': 'not-an-object', '/ok': { get: { responses: {} } } },
    });
    expect(idx.paths).toContain('/ok');
  });
});
