import { describe, it, expect } from 'vitest';
import {
  resolveContextSeverity,
  classify,
  parseRuleKey,
  sideClassOf,
} from '../../src/core/engine/classify.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';

describe('§10.5 severity doctrine', () => {
  it('property-removed: parse side → error', () => {
    expect(resolveContextSeverity('property-removed', 'response-body', {})).toBe('error');
    expect(resolveContextSeverity('property-removed', 'response-header', {})).toBe('error');
    expect(resolveContextSeverity('property-removed', 'callback', {})).toBe('error');
    expect(resolveContextSeverity('property-removed', 'webhook', {})).toBe('error');
  });

  it('property-removed: request-body → warning, error only when required', () => {
    expect(resolveContextSeverity('property-removed', 'request-body', {})).toBe('warning');
    expect(resolveContextSeverity('property-removed', 'request-body', { wasRequired: true })).toBe(
      'error',
    );
  });

  it('property-removed: header params are protocol-relevant → error (§10.5)', () => {
    expect(resolveContextSeverity('property-removed', 'request-header', {})).toBe('error');
    expect(resolveContextSeverity('property-removed', 'parameter', {})).toBe('error');
  });

  it('required-property-added: send → error, parse → info (extra data never breaks a parser)', () => {
    expect(resolveContextSeverity('required-property-added', 'request-body', {})).toBe('error');
    expect(resolveContextSeverity('required-property-added', 'parameter', {})).toBe('error');
    expect(resolveContextSeverity('required-property-added', 'response-body', {})).toBe('info');
    expect(resolveContextSeverity('required-property-added', 'webhook', {})).toBe('info');
  });

  it('other rules use registry defaults', () => {
    expect(resolveContextSeverity('removed-path', 'operation', {})).toBe('error');
    expect(resolveContextSeverity('operation-added', 'operation', {})).toBe('info');
  });
});

describe('context classes', () => {
  it('send vs parse mapping', () => {
    expect(sideClassOf('request-body')).toBe('send');
    expect(sideClassOf('request-header')).toBe('send');
    expect(sideClassOf('parameter')).toBe('send');
    expect(sideClassOf('response-body')).toBe('parse');
    expect(sideClassOf('response-header')).toBe('parse');
    expect(sideClassOf('callback')).toBe('parse');
    expect(sideClassOf('webhook')).toBe('parse');
  });
});

describe('config overrides (§14.3)', () => {
  const rules = { ...DEFAULT_CONFIG.rules };

  it('plain key overrides all contexts', () => {
    const out = classify('removed-path', 'operation', {
      rules: { ...rules, 'removed-path': 'warning' },
    });
    expect(out?.severity).toBe('warning');
  });

  it('scoped key wins over plain key', () => {
    const out = classify('property-removed', 'request-body', {
      rules: { ...rules, 'property-removed': 'error', 'property-removed@request-body': 'info' },
    });
    expect(out?.severity).toBe('info');
  });

  it("'off' disables the rule (null)", () => {
    expect(
      classify('removed-path', 'operation', { rules: { ...rules, 'removed-path': 'off' } }),
    ).toBeNull();
    expect(
      classify('property-removed', 'request-body', {
        rules: { ...rules, 'property-removed@request-body': 'off' },
      }),
    ).toBeNull();
  });

  it('scoped key only affects its context', () => {
    const rb = classify('property-removed', 'request-body', {
      rules: { ...rules, 'property-removed@response-body': 'info' },
    });
    expect(rb?.severity).toBe('warning'); // doctrine default for send-side optional
    const rs = classify('property-removed', 'response-body', {
      rules: { ...rules, 'property-removed@response-body': 'info' },
    });
    expect(rs?.severity).toBe('info');
  });

  it('parses scoped keys', () => {
    expect(parseRuleKey('removed-path')).toEqual({ ruleId: 'removed-path' });
    expect(parseRuleKey('property-removed@request-body')).toEqual({
      ruleId: 'property-removed',
      context: 'request-body',
    });
  });
});
