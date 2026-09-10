/** Unit tests for the shared comparator helpers (§11.3). */
import { describe, it, expect } from 'vitest';
import { deepEqual, isObject, typeLabel, num, boundDirection } from '../../src/core/engine/comparator.js';

describe('comparator helpers', () => {
  it('deepEqual: primitives, arrays, objects', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false); // order matters for lists
    expect(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it('isObject narrows plain objects only', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject('x')).toBe(false);
  });

  it('typeLabel renders arrays and primitives', () => {
    expect(typeLabel(['string', 'null'])).toBe('string|null');
    expect(typeLabel('integer')).toBe('integer');
  });

  it('num parses finite numbers and rejects the rest', () => {
    expect(num(5)).toBe(5);
    expect(num('7')).toBeUndefined(); // strings are not coerced (determinism)
    expect(num('x')).toBeUndefined();
  });

  it('boundDirection classifies bound movement (§11.3)', () => {
    // lower bounds: raise = tighten, lower = relax
    expect(boundDirection('lower', 5, 7)).toBe('tightened');
    expect(boundDirection('lower', 5, 3)).toBe('relaxed');
    // upper bounds: lower = tighten, raise = relax
    expect(boundDirection('upper', 10, 8)).toBe('tightened');
    expect(boundDirection('upper', 10, 12)).toBe('relaxed');
    // introduction / removal
    expect(boundDirection('lower', undefined, 5)).toBe('tightened');
    expect(boundDirection('lower', 5, undefined)).toBe('relaxed');
    expect(boundDirection('lower', 5, 5)).toBe('same');
  });
});
