import { describe, it, expect } from 'vitest';
import { renderHtml } from '../../src/reporters/html.js';
import type { DiffReport } from '../../src/core/models/report.js';

describe('renderHtml', () => {
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
      total: 1,
      bySeverity: { error: 1, warning: 0, info: 0 },
      byKind: { addition: 0, removal: 1, modification: 0, relaxation: 0, documentation: 0 },
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
        oldValue: 'string',
        newValue: undefined,
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
    ],
  };

  it('renders a self-contained HTML document with Hallmark design floor compliance', () => {
    const html = renderHtml(dummyReport);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>API Guard Report - Breaking Changes Found</title>');

    // Hallmark Floor rule 1: :root tokens
    expect(html).toContain(':root {');
    expect(html).toContain('--bg-page:');
    expect(html).toContain('--color-fail:');

    // Hallmark Floor rule 2: Never transition: all
    expect(html).not.toContain('transition: all');

    // Hallmark Floor rule 4: overflow-x: clip
    expect(html).toContain('overflow-x: clip;');

    // Hallmark Floor rule 6: :focus-visible
    expect(html).toContain('*:focus-visible');

    // Content checks
    expect(html).toContain('API Guard Diff Report');
    expect(html).toContain('FAIL: Breaking Changes Detected');
    expect(html).toContain('property-removed');
    expect(html).toContain('GET /users/{id}');
    expect(html).toContain('current.yaml:42:7');
    expect(html).toContain('Response property `email` was removed');
    expect(html).toContain('Stop using email');
  });

  it('renders clean pass badge when there are 0 breaking changes', () => {
    const cleanReport: DiffReport = {
      ...dummyReport,
      summary: {
        total: 0,
        bySeverity: { error: 0, warning: 0, info: 0 },
        byKind: { addition: 0, removal: 0, modification: 0, relaxation: 0, documentation: 0 },
        ignored: 0,
      },
      semver: { bump: 'none', reason: 'no changes', triggers: [] },
      changes: [],
    };
    const html = renderHtml(cleanReport);
    expect(html).toContain('PASS: No Breaking Changes');
    expect(html).toContain('No contract changes detected');
  });
});
