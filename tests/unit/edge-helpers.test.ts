/**
 * Edge-case coverage for comparator / sort / hash / errors helpers — the small pure
 * branches that are cheaper to hit directly than via end-to-end fixtures.
 */
import { describe, it, expect } from 'vitest';
import {
  deepEqual,
  typeLabel,
  isObject,
  num,
  boundDirection,
  exclusiveKeyFor,
} from '../../src/core/engine/comparator.js';
import { compareChanges, sortChanges } from '../../src/utils/sort.js';
import { sha256OfValue, sha256OfBytes, changeId } from '../../src/utils/hash.js';
import { errorMessage, InternalError } from '../../src/utils/errors.js';
import type { ApiChange } from '../../src/core/models/change.js';

describe('deepEqual edge cases', () => {
  it('distinguishes array vs object and null vs object', () => {
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual({}, null)).toBe(false);
    expect(deepEqual('1', 1)).toBe(false);
    expect(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});

describe('typeLabel / isObject / num', () => {
  it('labels arrays with pipe separator', () => {
    expect(typeLabel('string')).toBe('string');
    expect(typeLabel(['string', 'null'])).toBe('string|null');
    expect(typeLabel(42)).toBe('42');
  });
  it('isObject excludes null and arrays', () => {
    expect(isObject({})).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isObject([1])).toBe(false);
    expect(isObject('x')).toBe(false);
  });
  it('num rejects NaN/Infinity and non-numbers', () => {
    expect(num(5)).toBe(5);
    expect(num(Number.NaN)).toBeUndefined();
    expect(num(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(num('5')).toBeUndefined();
  });
});

describe('boundDirection full truth table (§11.3)', () => {
  it('lower bounds: raising tightens, lowering relaxes', () => {
    expect(boundDirection('lower', 1, 2)).toBe('tightened');
    expect(boundDirection('lower', 2, 1)).toBe('relaxed');
  });
  it('upper bounds: lowering tightens, raising relaxes', () => {
    expect(boundDirection('upper', 10, 5)).toBe('tightened');
    expect(boundDirection('upper', 5, 10)).toBe('relaxed');
  });
  it('added/removed bounds and equality', () => {
    expect(boundDirection('lower', undefined, 3)).toBe('tightened');
    expect(boundDirection('upper', undefined, 3)).toBe('tightened');
    expect(boundDirection('lower', 3, undefined)).toBe('relaxed');
    expect(boundDirection('upper', 3, undefined)).toBe('relaxed');
    expect(boundDirection('lower', 3, 3)).toBe('same');
    expect(boundDirection('upper', undefined, undefined)).toBe('same');
  });
  it('exclusiveKeyFor maps only min/max', () => {
    expect(exclusiveKeyFor('minimum')).toBe('exclusiveMinimum');
    expect(exclusiveKeyFor('maximum')).toBe('exclusiveMaximum');
    expect(exclusiveKeyFor('minLength')).toBeUndefined();
  });
});

/** Build a minimal change for comparator tests. */
function change(over: Partial<ApiChange>): ApiChange {
  return {
    ruleId: 'r',
    severity: 'error',
    kind: 'modification',
    breaking: true,
    message: 'm',
    suggestion: 's',
    location: { path: '/', pointerOld: '#/a', pointerNew: '#/a', context: 'api' },
    id: 'h1',
    ...over,
  } as ApiChange;
}

describe('compareChanges total ordering (§5.2)', () => {
  it('orders by severity rank then path', () => {
    const err = change({ severity: 'error' });
    const warn = change({ severity: 'warning' });
    const info = change({ severity: 'info' });
    expect(compareChanges(err, warn)).toBeLessThan(0);
    expect(compareChanges(warn, info)).toBeLessThan(0);
    expect(compareChanges(info, err)).toBeGreaterThan(0);
    const pA = change({ location: { ...change({}).location, path: '/a' } });
    const pB = change({ location: { ...change({}).location, path: '/b' } });
    expect(compareChanges(pA, pB)).toBeLessThan(0);
  });
  it('method rank: known methods in rank order, unknown methods after them', () => {
    const m = (method: string) => change({ location: { ...change({}).location, method } });
    expect(compareChanges(m('GET'), m('POST'))).toBeLessThan(0);
    expect(compareChanges(m('PATCH'), m('DELETE'))).toBeLessThan(0);
    expect(compareChanges(m('TRACE'), m('ZZZ'))).toBeLessThan(0); // unknown after known
    expect(compareChanges(m('ZZZ'), m('TRACE'))).toBeGreaterThan(0);
    expect(compareChanges(m('GET'), m('get'))).toBe(0); // case-insensitive rank
    // unknown methods tie at the same rank; with identical ids the comparator is total → 0
    // (real emits dedupe identical ids before sorting, §5.6)
    expect(compareChanges(m('ZZZ'), m('AAA'))).toBe(0);
  });
  it('pointer, ruleId, and id tie-breaks', () => {
    const withPointer = (oldPtr: string, newPtr: string, ruleId: string, id: string) =>
      change({
        ruleId,
        id,
        location: { ...change({}).location, pointerOld: oldPtr, pointerNew: newPtr },
      });
    expect(
      compareChanges(withPointer('#/a', '#/a', 'r', 'i1'), withPointer('#/b', '#/b', 'r', 'i1')),
    ).toBeLessThan(0);
    expect(
      compareChanges(withPointer('#/a', '#/a', 'r1', 'i1'), withPointer('#/a', '#/a', 'r2', 'i1')),
    ).toBeLessThan(0);
    expect(
      compareChanges(withPointer('#/a', '#/a', 'r', 'i1'), withPointer('#/a', '#/a', 'r', 'i2')),
    ).not.toBe(0);
    // pointerNew tie-break fires when pointerOld equal
    expect(
      compareChanges(withPointer('#/a', '#/a', 'r', 'i1'), withPointer('#/a', '#/b', 'r', 'i1')),
    ).toBeLessThan(0);
  });
  it('sortChanges is a stable full sort', () => {
    const a = change({ severity: 'info', id: 'a' });
    const b = change({ severity: 'error', id: 'b' });
    const c = change({ severity: 'error', id: 'c' });
    expect(sortChanges([a, b, c]).map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('hash helpers', () => {
  it('sha256OfValue is canonical (key order irrelevant)', () => {
    expect(sha256OfValue({ a: 1, b: 2 })).toBe(sha256OfValue({ b: 2, a: 1 }));
    expect(sha256OfValue({ a: 1 })).not.toBe(sha256OfValue({ a: 2 }));
  });
  it('sha256OfBytes handles strings and bytes', () => {
    expect(sha256OfBytes('abc')).toBe(sha256OfBytes(new TextEncoder().encode('abc')));
  });
  it('changeId differs when any component differs', () => {
    const id = (o: Parameters<typeof changeId>[0]) => changeId(o);
    const base = { ruleId: 'r1', context: 'api', path: '/', pointerOld: '#/a', pointerNew: '#/a' };
    expect(id(base)).toBe(id({ ...base }));
    expect(id(base)).not.toBe(id({ ...base, ruleId: 'r2' }));
    expect(id(base)).not.toBe(id({ ...base, context: 'operation' }));
    expect(id(base)).not.toBe(id({ ...base, path: '/x' }));
    expect(id(base)).not.toBe(id({ ...base, method: 'GET' }));
    expect(id(base)).not.toBe(id({ ...base, pointerOld: '#/b' }));
    expect(id(base)).not.toBe(id({ ...base, pointerNew: '#/b' }));
    expect(id(base)).not.toBe(id({ ...base, oldValue: 1 }));
    expect(id(base)).not.toBe(id({ ...base, newValue: 2 }));
  });
});

describe('errors', () => {
  it('errorMessage handles non-Error throws', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
  });
  it('InternalError carries exit code 4 and optional cause', () => {
    const cause = new Error('root');
    const e = new InternalError('wrap', { cause });
    expect(e.exitCode).toBe(4);
    expect(e.cause).toBe(cause);
    const plain = new InternalError('no cause');
    expect(plain.cause).toBeUndefined();
  });
});
