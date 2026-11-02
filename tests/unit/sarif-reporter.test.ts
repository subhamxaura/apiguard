import { describe, it, expect } from 'vitest';
import { renderSarif } from '../../src/reporters/sarif.js';
import type { DiffReport } from '../../src/core/models/report.js';

describe('renderSarif', () => {
  const dummyReport: DiffReport = {
    schemaVersion: '1.0',
    tool: { name: 'apiguard', version: '1.0.0' },
    baseline: {
      source: 'baseline.yaml',
      openapiVersion: '3.0.3',
      title: 'Store API',
      sha256: 'abc1234567890123456789012345678901234567890123456789012345678901',
    },
    current: {
      source: 'current.yaml',
      openapiVersion: '3.0.3',
      title: 'Store API',
      sha256: 'def1234567890123456789012345678901234567890123456789012345678901',
    },
    summary: {
      total: 2,
      bySeverity: { error: 1, warning: 1, info: 0 },
      byKind: { addition: 0, removal: 1, modification: 1, relaxation: 0, documentation: 0 },
      ignored: 0,
    },
    semver: {
      bump: 'major',
      reason: '1 breaking change',
      triggers: ['property-removed'],
    },
    changes: [
      {
        id: 'change-1',
        ruleId: 'property-removed',
        severity: 'error',
        kind: 'removal',
        breaking: true,
        message: 'Response property `email` was removed',
        suggestion: 'Stop using email',
        location: {
          path: '/users/{id}',
          method: 'GET',
          context: 'response-body',
          pointerOld: '/paths/~1users~1{id}/get/responses/200/.../email',
          pointerNew: '',
          file: 'current.yaml',
          line: 42,
          column: 7,
        },
      },
      {
        id: 'change-2',
        ruleId: 'operation-deprecated-added',
        severity: 'warning',
        kind: 'modification',
        breaking: false,
        message: 'Operation was deprecated',
        suggestion: 'Migrate callers',
        location: {
          path: '/legacy',
          method: 'POST',
          context: 'operation',
          pointerOld: '/paths/~1legacy/post',
          pointerNew: '/paths/~1legacy/post',
          file: 'current.yaml',
          line: 88,
          column: 5,
        },
      },
    ],
  };

  it('renders valid SARIF 2.1.0 JSON format', () => {
    const raw = renderSarif(dummyReport);
    const parsed = JSON.parse(raw);

    expect(parsed.version).toBe('2.1.0');
    expect(parsed.$schema).toContain('sarif-schema-2.1.0.json');

    const run = parsed.runs[0];
    expect(run.tool.driver.name).toBe('apiguard');
    expect(run.tool.driver.version).toBe('1.0.0');
    expect(run.tool.driver.rules.length).toBeGreaterThanOrEqual(81);

    expect(run.results).toHaveLength(2);

    const r0 = run.results[0];
    expect(r0.ruleId).toBe('property-removed');
    expect(r0.level).toBe('error');
    expect(r0.message.text).toContain('Response property `email` was removed');
    expect(r0.locations[0].physicalLocation.region.startLine).toBe(42);
    expect(r0.locations[0].physicalLocation.region.startColumn).toBe(7);

    const r1 = run.results[1];
    expect(r1.ruleId).toBe('operation-deprecated-added');
    expect(r1.level).toBe('warning');
    expect(r1.locations[0].physicalLocation.region.startLine).toBe(88);
  });
});
