/**
 * M7: direct unit tests for the rule-registry wording helpers — every fmt() value shape,
 * sideLabel context, whereLabel component names, and nameOf pointer tokenization.
 */
import { describe, it, expect } from 'vitest';
import { getRule, allRuleIds, RULES } from '../../src/core/rules/rule-registry.js';
import type { TemplateContext } from '../../src/core/rules/rule-registry.js';
import type { ChangeLocation } from '../../src/core/models/change.js';

function loc(partial: Partial<ChangeLocation>): ChangeLocation {
  return {
    path: '/x',
    pointerOld: '/x',
    pointerNew: '/x',
    context: 'request-body',
    ...partial,
  };
}
function ctx(partial: Partial<TemplateContext> = {}): TemplateContext {
  return { location: loc({}), ...partial };
}

describe('fmt() value shapes in templates', () => {
  const rule = getRule('openapi-version-changed');
  it('formats strings as code, null, undefined, and JSON values', () => {
    expect(rule.message(ctx({ oldValue: '3.0.3', newValue: '3.1.0' }))).toContain(
      'from `3.0.3` to `3.1.0`',
    );
    expect(rule.message(ctx({ oldValue: null, newValue: 'x' }))).toContain('from null to `x`');
    expect(rule.message(ctx({ oldValue: 42, newValue: { a: 1 } }))).toContain(
      'from `42` to `{"a":1}`',
    );
  });
});

describe('sideLabel per context', () => {
  const rule = getRule('property-added');
  const cases: Array<[ChangeLocation['context'], string]> = [
    ['request-body', 'Request property'],
    ['response-body', 'Response property'],
    ['request-header', 'Request header'],
    ['response-header', 'Response header'],
    ['parameter', 'Parameter'],
    ['component', 'Component property'],
    ['callback', 'Callback payload property'],
    ['webhook', 'Webhook payload property'],
  ];
  for (const [context, label] of cases) {
    it(`labels ${context} as "${label}"`, () => {
      const msg = rule.message(ctx({ location: loc({ context }), newValue: { type: 'string' } }));
      expect(msg).toContain(label);
    });
  }
  it('falls back to "Property" for unmapped contexts', () => {
    const msg = rule.message(ctx({ location: loc({ context: 'api' }), newValue: 1 }));
    expect(msg).toContain('Property');
  });
});

describe('whereLabel component naming', () => {
  const rule = getRule('property-removed');
  it('names the component when present', () => {
    const msg = rule.message(
      ctx({ location: loc({ context: 'component', componentName: 'Pet' }) }),
    );
    expect(msg).toContain('in component Pet');
  });
  it('degrades gracefully without a component name', () => {
    const msg = rule.message(ctx({ location: loc({ context: 'component' }) }));
    expect(msg).toContain('in component');
  });
});

describe('nameOf pointer tokenization', () => {
  it('prefers pointerNew and unescapes JSON-pointer tokens', () => {
    const rule = getRule('parameter-added-optional');
    const msg = rule.message(ctx({ location: loc({ pointerNew: '/x/a~1b', pointerOld: '' }) }));
    expect(msg).toContain('`a/b`');
  });
  it('falls back to pointerOld for removals and to "value" for root pointers', () => {
    const removed = getRule('removed-parameter');
    expect(
      removed.message(ctx({ location: loc({ pointerOld: '/x/limit', pointerNew: '' }) })),
    ).toContain('`limit`');
    expect(removed.message(ctx({ location: loc({ pointerOld: '/', pointerNew: '' }) }))).toContain(
      'value',
    );
  });
});

describe('registry integrity', () => {
  it('ids are unique and getRule throws on unknown ids', () => {
    const ids = allRuleIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(RULES.length).toBe(ids.length);
    expect(() => getRule('nope')).toThrow(/unknown rule id/);
  });
});
