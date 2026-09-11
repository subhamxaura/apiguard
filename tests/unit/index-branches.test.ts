/**
 * buildSpecIndex / mergedParameters branch matrix (§9): malformed entries, method
 * ordering, path-level parameter merging with op-level override.
 */
import { describe, it, expect } from 'vitest';
import { buildSpecIndex, mergedParameters } from '../../src/core/engine/index-build.js';

describe('buildSpecIndex branches (§9)', () => {
  it('indexes paths, operations, schemas, and webhooks from a well-formed doc', () => {
    const doc = {
      openapi: '3.0.3',
      paths: {
        '/b': { get: { responses: {} }, post: { responses: {} } },
        '/a': { delete: { responses: {} } },
      },
      components: { schemas: { User: { type: 'object' }, Bad: 'not-an-object' } },
      webhooks: { userCreated: { post: { responses: {} } } },
    };
    const idx = buildSpecIndex(doc);
    expect(idx.paths).toEqual(['/a', '/b']);
    // operations sort by path (lexicographic) first, then method rank (§9)
    expect(idx.operations.map((o) => `${o.method} ${o.path}`)).toEqual([
      'DELETE /a',
      'GET /b',
      'POST /b',
    ]);
    expect(idx.schemas.get('User')).toEqual({ type: 'object' });
    expect(idx.schemas.has('Bad')).toBe(false);
    expect(idx.webhooks.has('userCreated')).toBe(true);
  });

  it('skips non-object path items, operations, schemas, and webhooks', () => {
    const doc = {
      paths: { '/x': 'string', '/y': null, '/z': { get: 'not-object', post: { responses: {} } } },
      components: { schemas: null },
      webhooks: { wh: 42 },
    };
    const idx = buildSpecIndex(doc);
    expect(idx.paths).toEqual(['/x', '/y', '/z']);
    expect(idx.pathItems.has('/x')).toBe(false);
    expect(idx.operations.map((o) => `${o.method} ${o.path}`)).toEqual(['POST /z']);
    expect(idx.schemas.size).toBe(0);
    expect(idx.webhooks.size).toBe(0);
  });

  it('tolerates null documents and null method maps', () => {
    expect(buildSpecIndex(null).paths).toEqual([]);
    expect(buildSpecIndex({ paths: null, components: null, webhooks: null }).operations).toEqual(
      [],
    );
  });

  it('sorts methods by METHOD_RANK and ignores non-method keys', () => {
    const doc = {
      paths: {
        '/m': {
          trace: { responses: {} },
          get: { responses: {} },
          query: { responses: {} }, // not an HTTP method → not indexed
          head: { responses: {} },
        },
      },
    };
    const idx = buildSpecIndex(doc);
    expect(idx.operations.map((o) => o.method)).toEqual(['GET', 'HEAD', 'TRACE']);
  });
});

describe('mergedParameters branches (§11.8)', () => {
  it('op-level wins on identical name+in; path-level fills the rest; malformed entries dropped', () => {
    const pathItem = {
      parameters: [
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
        { name: 'X-Trace', in: 'header' },
        'garbage',
        null,
        { name: 'noname' },
      ],
    };
    const operation = {
      parameters: [{ name: 'limit', in: 'query', schema: { type: 'string' } }],
    };
    const merged = mergedParameters(pathItem, operation);
    const limit = merged.find((p) => p.name === 'limit');
    expect(limit?.schema).toEqual({ type: 'string' }); // op-level override
    expect(merged.some((p) => p.name === 'X-Trace')).toBe(true);
    // garbage/null are dropped; nameless-but-object params are kept (key "::")
    expect(merged).toHaveLength(3);
  });

  it('handles missing parameters arrays on both sides', () => {
    expect(mergedParameters({}, {})).toEqual([]);
    expect(mergedParameters({ parameters: null }, { parameters: undefined })).toEqual([]);
  });
});
