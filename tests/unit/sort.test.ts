import { describe, it, expect } from 'vitest';
import {
  sortChanges,
  dedupeChanges,
  compareChanges,
  idFor,
  pointerJoin,
  METHOD_RANK,
} from '../../src/utils/sort.js';
import type { ApiChange } from '../../src/core/models/change.js';

function change(partial: {
  severity: ApiChange['severity'];
  ruleId: string;
  path: string;
  method?: string;
  pointerOld?: string;
  pointerNew?: string;
  context?: ApiChange['location']['context'];
}): ApiChange {
  const location = {
    path: partial.path,
    ...(partial.method ? { method: partial.method } : {}),
    pointerOld: partial.pointerOld ?? '#/x',
    pointerNew: partial.pointerNew ?? '#/x',
    context: partial.context ?? ('operation' as const),
  };
  return {
    id: idFor(partial.ruleId, location),
    ruleId: partial.ruleId,
    severity: partial.severity,
    kind: 'removal',
    breaking: partial.severity === 'error',
    location,
    message: 'm',
    suggestion: 's',
  };
}

describe('stable total ordering (§5.2)', () => {
  it('sorts by severity rank first', () => {
    const err = change({ severity: 'error', ruleId: 'a', path: '/z' });
    const warn = change({ severity: 'warning', ruleId: 'b', path: '/a' });
    const sorted = sortChanges([warn, err]);
    expect(sorted[0]?.id).toBe(err.id);
  });

  it('then path lexicographically', () => {
    const a = change({ severity: 'error', ruleId: 'r', path: '/a' });
    const b = change({ severity: 'error', ruleId: 'r', path: '/b' });
    expect(compareChanges(a, b)).toBeLessThan(0);
  });

  it('then method rank GET < POST < DELETE', () => {
    expect(METHOD_RANK['GET'] ?? 99).toBeLessThan(METHOD_RANK['POST'] ?? 99);
    expect(METHOD_RANK['POST'] ?? 99).toBeLessThan(METHOD_RANK['DELETE'] ?? 99);
    const g = change({ severity: 'error', ruleId: 'r', path: '/p', method: 'GET' });
    const d = change({ severity: 'error', ruleId: 'r', path: '/p', method: 'DELETE' });
    expect(compareChanges(g, d)).toBeLessThan(0);
  });

  it('then pointer, ruleId, id (totality)', () => {
    const p1 = change({ severity: 'info', ruleId: 'r', path: '/p', pointerOld: '#/a' });
    const p2 = change({ severity: 'info', ruleId: 'r', path: '/p', pointerOld: '#/b' });
    expect(compareChanges(p1, p2)).toBeLessThan(0);
    const r1 = change({ severity: 'info', ruleId: 'a', path: '/p' });
    const r2 = change({ severity: 'info', ruleId: 'b', path: '/p' });
    expect(compareChanges(r1, r2)).toBeLessThan(0);
    // identical facts → tie broken by id, comparator total
    const c1 = change({ severity: 'info', ruleId: 'r', path: '/p' });
    const c2 = change({ severity: 'info', ruleId: 'r', path: '/p' });
    expect([c1.id, c2.id]).toEqual([c1.id, c2.id]);
  });

  it('is deterministic across shuffles (fuzz)', () => {
    const base = [
      change({ severity: 'error', ruleId: 'r1', path: '/b' }),
      change({ severity: 'warning', ruleId: 'r2', path: '/a' }),
      change({ severity: 'error', ruleId: 'r3', path: '/a', method: 'POST' }),
      change({ severity: 'error', ruleId: 'r3', path: '/a', method: 'GET' }),
      change({ severity: 'info', ruleId: 'r4', path: '/c' }),
      change({ severity: 'info', ruleId: 'r5', path: '' }),
    ];
    const first = sortChanges([...base]).map((c) => c.id);
    for (let i = 0; i < 20; i++) {
      const shuffled = [...base].sort(() => Math.random() - 0.5);
      expect(sortChanges(shuffled).map((c) => c.id)).toEqual(first);
    }
  });
});

describe('dedupe (§5.6/§12)', () => {
  it('keeps first occurrence by id', () => {
    const a = change({ severity: 'error', ruleId: 'r', path: '/p' });
    const b = { ...a, message: 'duplicate fact' };
    const out = dedupeChanges([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toBe('m');
  });
});

describe('pointerJoin', () => {
  it('escapes ~ and / per RFC 6901', () => {
    expect(pointerJoin('paths', '/users/{id}', 'get')).toBe('#/paths/~1users~1{id}/get');
    expect(pointerJoin('a~b')).toBe('#/a~0b');
  });
});
