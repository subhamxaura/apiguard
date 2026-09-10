import { describe, it, expect } from 'vitest';
import { suggestVersion } from '../../src/core/versioning/semver-advisor.js';
import type { ApiChange, ChangeKind, Severity } from '../../src/core/models/change.js';

function c(severity: Severity, kind: ChangeKind, ruleId: string): ApiChange {
  return {
    id: ruleId,
    ruleId,
    severity,
    kind,
    breaking: severity === 'error',
    location: { path: '/x', pointerOld: '#/x', pointerNew: '#/x', context: 'operation' },
    message: 'm',
    suggestion: 's',
  };
}

describe('semver advisor (§16)', () => {
  it('any error → major with top ruleIds by count', () => {
    const advice = suggestVersion([
      c('error', 'removal', 'removed-path'),
      c('error', 'removal', 'removed-path'),
      c('error', 'modification', 'property-type-changed'),
      c('info', 'documentation', 'title-changed'),
    ]);
    expect(advice.bump).toBe('major');
    expect(advice.triggers).toContain('removed-path');
    expect(advice.reason).toContain('removed-path(2)');
  });

  it('operation-added (info addition) → minor (§16 example)', () => {
    const advice = suggestVersion([c('info', 'addition', 'operation-added')]);
    expect(advice.bump).toBe('minor');
  });

  it('warning → minor', () => {
    const advice = suggestVersion([c('warning', 'documentation', 'parameter-metadata-changed')]);
    expect(advice.bump).toBe('minor');
  });

  it('description-only (documentation info) → patch (§16 example)', () => {
    const advice = suggestVersion([c('info', 'documentation', 'operation-description-changed')]);
    expect(advice.bump).toBe('patch');
  });

  it('relaxation info → patch', () => {
    const advice = suggestVersion([c('info', 'relaxation', 'constraint-relaxed')]);
    expect(advice.bump).toBe('patch');
  });

  it('no changes → none', () => {
    expect(suggestVersion([]).bump).toBe('none');
  });

  it('mixed set dominated by errors → major', () => {
    const advice = suggestVersion([
      c('info', 'addition', 'operation-added'),
      c('info', 'documentation', 'title-changed'),
      c('error', 'removal', 'enum-value-removed'),
    ]);
    expect(advice.bump).toBe('major');
  });
});
