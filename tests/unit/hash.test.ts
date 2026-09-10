import { describe, it, expect } from 'vitest';
import { canonicalize, sha256OfValue, changeId } from '../../src/utils/hash.js';

describe('canonicalize / sha256 (§8/§12)', () => {
  it('sorts object keys', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('handles nested structures and arrays (order-preserving)', () => {
    expect(canonicalize({ x: [3, 1, 2], y: { d: 4, c: 3 } })).toBe('{"x":[3,1,2],"y":{"c":3,"d":4}}');
  });

  it('stable ids across key shuffles', () => {
    const a = sha256OfValue({ p: '/a', t: ['null', 'string'], n: 5 });
    const b = sha256OfValue({ t: ['null', 'string'], n: 5, p: '/a' });
    expect(a).toBe(b);
  });

  it('changeId follows the §12 recipe (16 hex chars, method-empty segment)', () => {
    const id = changeId({
      ruleId: 'removed-path',
      context: 'operation',
      path: '/orders',
      pointerOld: '#/paths/~1orders',
      pointerNew: '',
    });
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    const withMethod = changeId({
      ruleId: 'removed-method',
      context: 'operation',
      path: '/orders',
      method: 'GET',
      pointerOld: '#/paths/~1orders/get',
      pointerNew: '',
    });
    expect(withMethod).not.toBe(id);
    // same inputs → same id
    expect(
      changeId({
        ruleId: 'removed-path',
        context: 'operation',
        path: '/orders',
        pointerOld: '#/paths/~1orders',
        pointerNew: '',
      }),
    ).toBe(id);
  });
});
