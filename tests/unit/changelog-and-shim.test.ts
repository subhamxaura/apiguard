import { describe, it, expect } from 'vitest';
import { renderChangelog } from '../../src/reporters/changelog.js';
import { generateGatewayShim } from '../../src/codegen/shim.js';
import type { DiffReport } from '../../src/core/models/report.js';

describe('renderChangelog', () => {
  const dummyReport: DiffReport = {
    schemaVersion: '1.0',
    tool: { name: 'apiguard', version: '1.0.0' },
    baseline: {
      source: 'v1.yaml',
      openapiVersion: '3.0.3',
      title: 'API',
      sha256: 'abc1234567890123456789012345678901234567890123456789012345678901',
    },
    current: {
      source: 'v2.yaml',
      openapiVersion: '3.0.3',
      title: 'API',
      sha256: 'def1234567890123456789012345678901234567890123456789012345678901',
    },
    summary: {
      total: 3,
      bySeverity: { error: 1, warning: 1, info: 1 },
      byKind: { addition: 1, removal: 1, modification: 1, relaxation: 0, documentation: 0 },
      ignored: 0,
    },
    semver: {
      bump: 'major',
      reason: '1 breaking change',
      triggers: ['property-removed'],
    },
    changes: [
      {
        id: '1',
        ruleId: 'property-removed',
        severity: 'error',
        kind: 'removal',
        breaking: true,
        message: 'Response property `email` was removed',
        suggestion: 'Stop using email',
        location: {
          path: '/users',
          method: 'GET',
          context: 'response-body',
          pointerOld: '',
          pointerNew: '',
        },
      },
      {
        id: '2',
        ruleId: 'operation-added',
        severity: 'info',
        kind: 'addition',
        breaking: false,
        message: 'New operation GET /health added',
        suggestion: 'Explore health checks',
        location: {
          path: '/health',
          method: 'GET',
          context: 'operation',
          pointerOld: '',
          pointerNew: '',
        },
      },
      {
        id: '3',
        ruleId: 'property-description-changed',
        severity: 'info',
        kind: 'modification',
        breaking: false,
        message: 'Description updated',
        suggestion: 'Read docs',
        location: {
          path: '/users',
          method: 'GET',
          context: 'response-body',
          pointerOld: '',
          pointerNew: '',
        },
      },
    ],
  };

  it('generates structured Keep-a-Changelog markdown notes', () => {
    const md = renderChangelog(dummyReport);
    expect(md).toContain('## Next Release (Recommended bump: MAJOR)');
    expect(md).toContain('### 🛑 Breaking Changes');
    expect(md).toContain('Response property `email` was removed');
    expect(md).toContain('### 🚀 Added');
    expect(md).toContain('New operation GET /health added');
    expect(md).toContain('### 🔄 Changed');
    expect(md).toContain('Description updated');
  });
});

describe('generateGatewayShim', () => {
  const dummyReport: DiffReport = {
    schemaVersion: '1.0',
    tool: { name: 'apiguard', version: '1.0.0' },
    baseline: { source: 'v1', openapiVersion: '3.0.3', title: 'T', sha256: 'abc' },
    current: { source: 'v2', openapiVersion: '3.0.3', title: 'T', sha256: 'def' },
    summary: {
      total: 1,
      bySeverity: { error: 1, warning: 0, info: 0 },
      byKind: { addition: 1, removal: 0, modification: 0, relaxation: 0, documentation: 0 },
      ignored: 0,
    },
    semver: { bump: 'major', reason: 'r', triggers: [] },
    changes: [
      {
        id: '1',
        ruleId: 'parameter-added-required',
        severity: 'error',
        kind: 'addition',
        breaking: true,
        message: 'Required query parameter `page` was added',
        suggestion: 'Provide default',
        newValue: '1',
        location: {
          path: '/items',
          method: 'GET',
          context: 'parameter',
          pointerOld: '',
          pointerNew: '/paths/~1items/get/parameters/0/name',
        },
      },
    ],
  };

  it('generates Express middleware shim', () => {
    const res = generateGatewayShim(dummyReport, 'express');
    expect(res.target).toBe('express');
    expect(res.code).toContain('export function apiGuardCompatibilityShim');
    expect(res.code).toContain("path.startsWith('/items')");
    expect(res.code).toContain("req.query['name'] = '1'");
  });

  it('generates Cloudflare Worker shim', () => {
    const res = generateGatewayShim(dummyReport, 'cloudflare-worker');
    expect(res.target).toBe('cloudflare-worker');
    expect(res.code).toContain('export default {');
    expect(res.code).toContain('async fetch(request: Request');
  });

  it('generates Envoy Lua filter shim', () => {
    const res = generateGatewayShim(dummyReport, 'envoy-lua');
    expect(res.target).toBe('envoy-lua');
    expect(res.code).toContain('function envoy_on_request');
  });
});
