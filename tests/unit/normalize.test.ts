import { describe, it, expect } from 'vitest';
import { normalizeDocument, hashNormalized } from '../../src/core/engine/normalize.js';
import { canonicalize } from '../../src/utils/hash.js';

describe('normalizeDocument', () => {
  it('converts type string to array', () => {
    const out = normalizeDocument({
      type: 'object',
      properties: { a: { type: 'string' } },
    }) as Record<string, unknown>;
    expect(out.type).toEqual(['object']);
  });

  it('unifies nullable:true with type arrays (3.0 vs 3.1 parity, §11.2)', () => {
    const v30 = normalizeDocument({ type: 'string', nullable: true });
    const v31 = normalizeDocument({ type: ['string', 'null'] });
    expect(canonicalize(v30)).toBe(canonicalize(v31));
    expect(canonicalize(v30)).toBe(JSON.stringify({ type: ['null', 'string'] }));
  });

  it('drops nullable:false as default-parity', () => {
    const out = normalizeDocument({ type: 'string', nullable: false });
    expect(canonicalize(out)).toBe(JSON.stringify({ type: ['string'] }));
  });

  it('converts boolean exclusiveMinimum to numeric bound (§11.2)', () => {
    const out = normalizeDocument({ minimum: 5, exclusiveMinimum: true }) as Record<
      string,
      unknown
    >;
    expect(out.exclusiveMinimum).toBe(5);
    expect(out.minimum).toBeUndefined();
  });

  it('converts boolean exclusiveMaximum to numeric bound', () => {
    const out = normalizeDocument({ maximum: 9, exclusiveMaximum: true }) as Record<
      string,
      unknown
    >;
    expect(out.exclusiveMaximum).toBe(9);
    expect(out.maximum).toBeUndefined();
  });

  it('drops explicit false exclusive flags', () => {
    const out = normalizeDocument({ minimum: 5, exclusiveMinimum: false }) as Record<
      string,
      unknown
    >;
    expect(out.minimum).toBe(5);
    expect(out.exclusiveMinimum).toBeUndefined();
  });

  it('emits keys sorted so hashes are canonical (§8)', () => {
    const a = hashNormalized(normalizeDocument({ b: 1, a: { y: 2, x: 3 } }));
    const b = hashNormalized(normalizeDocument({ a: { x: 3, y: 2 }, b: 1 }));
    expect(a).toBe(b);
  });

  it('walks arrays', () => {
    const out = normalizeDocument([{ type: 'string', nullable: true }]) as unknown[];
    expect(out[0]).toEqual({ type: ['null', 'string'] });
  });
});
