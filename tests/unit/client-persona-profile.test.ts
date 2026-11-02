import { describe, it, expect } from 'vitest';
import { classify } from '../../src/core/engine/classify.js';

describe('Client Impact Persona Profiles', () => {
  it('classifies enum-value-added as error under strict-sdk profile', () => {
    const res = classify('enum-value-added', 'response-body', {
      rules: {},
      profile: 'strict-sdk',
    });
    expect(res).toBeDefined();
    expect(res?.severity).toBe('error');
  });

  it('classifies anyOf-oneOf-member-added as warning under strict-sdk profile', () => {
    const res = classify('anyOf-oneOf-member-added', 'response-body', {
      rules: {},
      profile: 'strict-sdk',
    });
    expect(res).toBeDefined();
    expect(res?.severity).toBe('warning');
  });

  it('keeps default info severity for enum-value-added under default and loose-web profiles', () => {
    const defaultRes = classify('enum-value-added', 'response-body', {
      rules: {},
      profile: 'default',
    });
    expect(defaultRes?.severity).toBe('info');

    const looseRes = classify('enum-value-added', 'response-body', {
      rules: {},
      profile: 'loose-web',
    });
    expect(looseRes?.severity).toBe('info');
  });

  it('ensures explicit config rules override persona profile defaults', () => {
    const res = classify('enum-value-added', 'response-body', {
      rules: { 'enum-value-added': 'warning' },
      profile: 'strict-sdk',
    });
    expect(res?.severity).toBe('warning');
  });
});
