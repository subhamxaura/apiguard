import { describe, it, expect } from 'vitest';
import { isIgnored, applyIgnores } from '../../src/core/ignore/ignore.js';
import type { ApiChange } from '../../src/core/models/change.js';
import type { ResolvedConfig } from '../../src/core/config/schema.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';

function c(partial: {
  ruleId: string;
  path?: string;
  method?: string;
  componentName?: string;
  pointerNew?: string;
}): ApiChange {
  return {
    id: Math.random().toString(16).slice(2),
    ruleId: partial.ruleId,
    severity: 'error',
    kind: 'removal',
    breaking: true,
    location: {
      path: partial.path ?? '/x',
      ...(partial.method ? { method: partial.method } : {}),
      pointerOld: partial.pointerNew ?? '#/x',
      pointerNew: partial.pointerNew ?? '#/x',
      context: 'operation',
      ...(partial.componentName ? { componentName: partial.componentName } : {}),
    },
    message: 'm',
    suggestion: 's',
  };
}

function cfg(ignore: Partial<ResolvedConfig['ignore']>): ResolvedConfig {
  return { ...DEFAULT_CONFIG, ignore: { ...DEFAULT_CONFIG.ignore, ...ignore } };
}

describe('ignore engine (§14.3)', () => {
  it('path globs ignore all methods on a path template', () => {
    const config = cfg({ paths: ['/internal/**', '/metrics'] });
    expect(isIgnored(c({ ruleId: 'removed-path', path: '/internal/users' }), config)).toBe(true);
    expect(isIgnored(c({ ruleId: 'removed-path', path: '/metrics' }), config)).toBe(true);
    expect(isIgnored(c({ ruleId: 'removed-path', path: '/users' }), config)).toBe(false);
  });

  it('operation entries are exact "METHOD /path"', () => {
    const config = cfg({ operations: ['GET /health', 'POST /users'] });
    expect(isIgnored(c({ ruleId: 'removed-method', path: '/health', method: 'GET' }), config)).toBe(
      true,
    );
    expect(
      isIgnored(c({ ruleId: 'removed-method', path: '/health', method: 'POST' }), config),
    ).toBe(false);
    expect(
      isIgnored(c({ ruleId: 'removed-method', path: '/healthz', method: 'GET' }), config),
    ).toBe(false);
  });

  it('schema globs match componentName and pointer prefixes', () => {
    const config = cfg({ schemas: ['InternalModel', 'components/schemas/V1*'] });
    expect(
      isIgnored(c({ ruleId: 'property-removed', componentName: 'InternalModel' }), config),
    ).toBe(true);
    expect(
      isIgnored(
        c({
          ruleId: 'property-removed',
          componentName: 'V1Legacy',
          pointerNew: '#/components/schemas/V1Legacy/props/x',
        }),
        config,
      ),
    ).toBe(true);
    expect(isIgnored(c({ ruleId: 'property-removed', componentName: 'User' }), config)).toBe(false);
  });

  it('schema pointer fallback extracts root name after /components/schemas/', () => {
    const config = cfg({ schemas: ['Hidden'] });
    expect(
      isIgnored(
        c({ ruleId: 'property-removed', pointerNew: '#/components/schemas/Hidden/properties/x' }),
        config,
      ),
    ).toBe(true);
  });

  it('ruleId globs (changes) including wildcards', () => {
    const config = cfg({ changes: ['operation-id-changed', 'server-*'] });
    expect(isIgnored(c({ ruleId: 'operation-id-changed' }), config)).toBe(true);
    expect(isIgnored(c({ ruleId: 'server-url-removed' }), config)).toBe(true);
    expect(isIgnored(c({ ruleId: 'removed-path' }), config)).toBe(false);
  });

  it('applyIgnores partitions and preserves order', () => {
    const config = cfg({ changes: ['a-*'] });
    const kept = c({ ruleId: 'removed-path' });
    const gone = c({ ruleId: 'a-rule' });
    const out = applyIgnores([kept, gone], config);
    expect(out.kept).toEqual([kept]);
    expect(out.ignored).toEqual([gone]);
  });
});
