import { describe, it, expect } from 'vitest';
import { RULES, allRuleIds, getRule } from '../../src/core/rules/rule-registry.js';

/**
 * Normative parity table from spec §10. Id → [severity, kind]. A mismatch fails the suite;
 * a missing id fails the suite. This test IS the registry-parity gate (§20.1).
 */
const PARITY: Record<string, ['error' | 'warning' | 'info', string]> = {
  // §10.1
  'openapi-version-changed': ['info', 'documentation'],
  'title-changed': ['info', 'documentation'],
  'description-changed': ['info', 'documentation'],
  'server-url-added': ['info', 'addition'],
  'server-url-removed': ['error', 'removal'],
  'server-metadata-changed': ['info', 'documentation'],
  'external-docs-changed': ['info', 'documentation'],
  'license-changed': ['info', 'documentation'],
  'contact-changed': ['info', 'documentation'],
  // §10.2
  'operation-added': ['info', 'addition'],
  'removed-method': ['error', 'removal'],
  'removed-path': ['error', 'removal'],
  'operation-id-changed': ['warning', 'modification'],
  'operation-deprecated-added': ['warning', 'modification'],
  'operation-deprecated-removed': ['info', 'documentation'],
  'operation-tags-changed': ['info', 'documentation'],
  'operation-summary-changed': ['info', 'documentation'],
  'operation-description-changed': ['info', 'documentation'],
  'callback-added': ['info', 'addition'],
  'callback-removed': ['error', 'removal'],
  'webhook-added': ['info', 'addition'],
  'webhook-removed': ['error', 'removal'],
  // §10.3
  'parameter-added-required': ['error', 'addition'],
  'parameter-added-optional': ['info', 'addition'],
  'removed-parameter': ['warning', 'removal'], // [ctx] — default table value
  'parameter-made-required': ['error', 'modification'],
  'parameter-type-changed': ['error', 'modification'],
  'parameter-format-changed': ['warning', 'modification'],
  'parameter-location-changed': ['error', 'modification'],
  'parameter-style-changed': ['warning', 'modification'],
  'parameter-default-changed': ['warning', 'modification'],
  'parameter-metadata-changed': ['info', 'documentation'],
  'request-body-removed': ['warning', 'removal'], // [ctx]
  'request-body-added-required': ['error', 'addition'],
  'request-body-added-optional': ['info', 'addition'],
  'request-body-required-changed': ['error', 'modification'],
  'content-type-removed': ['error', 'removal'],
  'content-type-added': ['info', 'addition'],
  'encoding-changed': ['warning', 'modification'],
  'response-added': ['info', 'addition'],
  'response-removed': ['error', 'removal'],
  'default-response-removed': ['error', 'removal'],
  'response-header-removed': ['error', 'removal'],
  'response-header-added': ['info', 'addition'],
  'request-header-removed': ['error', 'removal'],
  // §10.4
  'property-added': ['info', 'addition'],
  'required-property-added': ['error', 'modification'], // [ctx] — send-side default
  'property-removed': ['warning', 'removal'], // [ctx]
  'property-type-changed': ['error', 'modification'],
  'property-format-changed': ['warning', 'modification'],
  'property-default-changed': ['warning', 'modification'],
  'enum-value-removed': ['error', 'removal'],
  'enum-value-added': ['info', 'addition'],
  'const-added': ['error', 'modification'],
  'const-changed': ['error', 'modification'],
  'const-removed': ['info', 'relaxation'],
  'constraint-added': ['error', 'modification'],
  'constraint-tightened': ['error', 'modification'],
  'constraint-relaxed': ['info', 'relaxation'],
  'constraint-removed': ['info', 'relaxation'],
  'required-removed': ['info', 'relaxation'],
  'map-closed': ['error', 'modification'],
  'map-opened': ['info', 'relaxation'],
  'allOf-member-added': ['warning', 'modification'],
  'allOf-member-removed': ['info', 'relaxation'],
  'anyOf-oneOf-member-added': ['info', 'addition'],
  'anyOf-oneOf-member-removed': ['error', 'removal'],
  'discriminator-added': ['warning', 'modification'],
  'discriminator-changed': ['error', 'modification'],
  'schema-description-changed': ['info', 'documentation'],
  // §10.6
  'security-scheme-added': ['info', 'addition'],
  'security-scheme-removed': ['error', 'removal'],
  'security-type-changed': ['error', 'modification'],
  'api-key-location-changed': ['error', 'modification'],
  'oauth-scope-removed': ['error', 'removal'],
  'oauth-scope-added': ['info', 'addition'],
  'security-requirement-added': ['error', 'modification'],
  'security-requirement-changed': ['error', 'modification'],
  'security-scope-required-added': ['error', 'modification'],
  'security-requirement-removed': ['warning', 'relaxation'],
  'security-scope-required-removed': ['info', 'relaxation'],
};

describe('rule registry parity (§10 / §20.1)', () => {
  it('contains exactly the §10 rule ids', () => {
    const ids = allRuleIds().sort();
    const expected = Object.keys(PARITY).sort();
    const missing = expected.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => !expected.includes(id));
    expect(missing, 'missing rules').toEqual([]);
    expect(extra, 'unexpected rules').toEqual([]);
  });

  it('matches default severity and kind for every rule', () => {
    for (const [id, [severity, kind]] of Object.entries(PARITY)) {
      const rule = getRule(id);
      expect([id, rule.defaultSeverity]).toEqual([id, severity]);
      expect([id, rule.defaultKind]).toEqual([id, kind]);
    }
  });

  it('gives every rule message and suggestion templates', () => {
    for (const rule of RULES) {
      expect(rule.message({ location: loc() }), rule.id).toMatch(/\S/);
      expect(rule.suggestion({ location: loc() }), rule.id).toMatch(/\S/);
      expect(rule.trigger, rule.id).toMatch(/\S/);
    }
  });
});

function loc() {
  return {
    path: '/x',
    method: 'GET',
    pointerOld: '#/a',
    pointerNew: '#/a',
    context: 'operation' as const,
  };
}
