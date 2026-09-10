import { describe, it, expect } from 'vitest';
import { renderTerminal, suggestLine } from '../../src/reporters/terminal.js';
import { renderJson } from '../../src/reporters/json.js';
import { renderMarkdown } from '../../src/reporters/markdown.js';
import type { DiffReport } from '../../src/core/models/report.js';
import type { ApiChange } from '../../src/core/models/change.js';
import { TOOL_VERSION } from '../../src/core/models/report.js';
import { idFor } from '../../src/utils/sort.js';

function change(partial: {
  ruleId: string;
  severity: ApiChange['severity'];
  message: string;
  path?: string;
  method?: string;
  context?: ApiChange['location']['context'];
}): ApiChange {
  const location = {
    path: partial.path ?? '/x',
    ...(partial.method ? { method: partial.method } : {}),
    pointerOld: '#/x',
    pointerNew: '#/x',
    context: partial.context ?? ('operation' as const),
  };
  return {
    id: idFor(partial.ruleId, location),
    ruleId: partial.ruleId,
    severity: partial.severity,
    kind: 'removal',
    breaking: partial.severity === 'error',
    location,
    message: partial.message,
    suggestion: `fix ${partial.ruleId}`,
  };
}

function report(changes: ApiChange[]): DiffReport {
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byKind = { addition: 0, removal: 0, modification: 0, relaxation: 0, documentation: 0 };
  for (const c of changes) {
    bySeverity[c.severity]++;
    byKind[c.kind]++;
  }
  return {
    schemaVersion: '1.0',
    tool: { name: 'apiguard', version: TOOL_VERSION },
    baseline: { source: 'old.yaml', openapiVersion: '3.0.3', title: 'T', sha256: 'a'.repeat(64) },
    current: { source: 'new.yaml', openapiVersion: '3.0.3', title: 'T', sha256: 'b'.repeat(64) },
    summary: { total: changes.length, bySeverity, byKind, ignored: 0 },
    changes,
    semver:
      changes.length > 0
        ? { bump: 'major', reason: 'test', triggers: ['removed-path'] }
        : { bump: 'none', reason: 'no changes', triggers: [] },
  };
}

describe('terminal reporter (§13/§15.3)', () => {
  it('matches the §13 golden output for the breaking case', () => {
    const r = report([
      change({ ruleId: 'required-property-added', severity: 'error', message: 'Request property `email` changed from optional to required', path: '/users', method: 'POST', context: 'request-body' }),
      change({ ruleId: 'property-removed', severity: 'error', message: 'Response property `phoneNumber` was removed', path: '/users/{id}', method: 'GET', context: 'response-body' }),
    ]);
    const out = renderTerminal(r, { includeNonBreaking: false, showIgnored: false, color: false, quiet: false }).join('\n');
    expect(out).toContain('POST /users');
    expect(out).toContain('ERROR Request property `email` changed from optional to required');
    expect(out).toContain('Suggestion: fix required-property-added');
    expect(out).toContain('GET /users/{id}');
    expect(out).toContain('❌ Breaking API changes found');
    expect(out.split('\n').filter((l) => l.includes('ERROR')).every((l) => l.startsWith('  ERROR'))).toBe(true);
  });

  it('clean case prints the informational count (§13)', () => {
    const r = report([change({ ruleId: 'description-changed', severity: 'info', message: 'API description changed', path: '/' })]);
    const out = renderTerminal(r, { includeNonBreaking: false, showIgnored: false, color: false, quiet: false });
    expect(out[out.length - 1]).toBe('✓ No breaking API changes found (1 informational change)');
  });

  it('quiet prints only the verdict', () => {
    const r = report([change({ ruleId: 'removed-path', severity: 'error', message: 'Path removed: /x', path: '/x' })]);
    const out = renderTerminal(r, { includeNonBreaking: false, showIgnored: false, color: false, quiet: true });
    expect(out).toEqual(['❌ Breaking API changes found']);
  });

  it('--include-non-breaking renders warnings and info rows', () => {
    const r = report([
      change({ ruleId: 'operation-id-changed', severity: 'warning', message: 'operationId changed', path: '/a', method: 'GET' }),
      change({ ruleId: 'title-changed', severity: 'info', message: 'title changed', path: '/' }),
    ]);
    const without = renderTerminal(r, { includeNonBreaking: false, showIgnored: false, color: false, quiet: false });
    const withN = renderTerminal(r, { includeNonBreaking: true, showIgnored: false, color: false, quiet: false });
    expect(without.join('\n')).not.toContain('operationId changed');
    expect(withN.join('\n')).toContain('operationId changed');
    expect(withN.join('\n')).toContain('WARN');
    expect(withN.join('\n')).toContain('INFO');
  });

  it('suggestLine formats bumps and suppresses none', () => {
    expect(suggestLine(report([]))).toBeNull();
    const r = report([]);
    expect(suggestLine({ ...r, semver: { bump: 'major', reason: '', triggers: [] } })).toBe('Suggested version bump: MAJOR');
    expect(suggestLine({ ...r, semver: { bump: 'minor', reason: '', triggers: [] } })).toBe('Suggested version bump: MINOR');
  });
});

describe('json reporter (§15.1)', () => {
  it('emits §8 field order and is byte-stable', () => {
    const r = report([change({ ruleId: 'removed-path', severity: 'error', message: 'Path removed: /x', path: '/x' })]);
    const a = renderJson(r);
    const b = renderJson(report([change({ ruleId: 'removed-path', severity: 'error', message: 'Path removed: /x', path: '/x' })]));
    expect(a).toBe(b);
    const parsed = JSON.parse(a);
    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'tool',
      'baseline',
      'current',
      'summary',
      'changes',
      'semver',
    ]);
    expect(parsed.tool.name).toBe('apiguard');
    expect(parsed.changes[0].breaking).toBe(true);
  });
});

describe('markdown reporter (§15.2)', () => {
  it('has summary table, details groups, and footer', () => {
    const r = report([
      change({ ruleId: 'removed-path', severity: 'error', message: 'Path removed: /x | with pipe', path: '/x' }),
      change({ ruleId: 'title-changed', severity: 'info', message: 'title', path: '/' }),
    ]);
    const md = renderMarkdown(r);
    expect(md).toContain('## ❌ API Guard: 1 breaking change found');
    expect(md).toContain('| Rule | Severity | Endpoint | What changed | Suggestion |');
    expect(md).toContain('<details>');
    expect(md).toContain('</details>');
    expect(md).toContain('apiguard v');
    expect(md).toContain('\\|'); // pipe escaped
  });

  it('clean report shows the success header', () => {
    expect(renderMarkdown(report([]))).toContain('## ✅ API Guard: no breaking changes');
  });
});

describe('reporter branches: colors, ignored, webhook/component labels', () => {
  const base = () => ({
    schemaVersion: '1.0' as const,
    tool: { name: 'apiguard' as const, version: '0.1.0' },
    baseline: { source: 'o.yaml', openapiVersion: '3.0.3', title: 'T', sha256: 'a'.repeat(64) },
    current: { source: 'n.yaml', openapiVersion: '3.0.3', title: 'T', sha256: 'b'.repeat(64) },
    summary: {
      total: 1,
      bySeverity: { error: 1, warning: 0, info: 0 },
      byKind: { addition: 0, removal: 1, modification: 0, relaxation: 0, documentation: 0 },
      ignored: 1,
    },
    changes: [
      {
        id: 'x'.repeat(16),
        ruleId: 'removed-path',
        severity: 'error' as const,
        kind: 'removal' as const,
        breaking: true,
        location: {
          path: '/gone',
          method: 'GET',
          pointerOld: '#/paths/~1gone',
          pointerNew: '',
          context: 'operation' as const,
        },
        message: 'Path /gone removed',
        suggestion: 'keep it',
      },
    ],
    ignored: [
      {
        id: 'y'.repeat(16),
        ruleId: 'property-added',
        severity: 'info' as const,
        kind: 'addition' as const,
        breaking: false,
        location: {
          path: '/a',
          pointerOld: '',
          pointerNew: '#/paths/~1a/get',
          context: 'response-body' as const,
        },
        message: 'Property added',
        suggestion: 'nothing',
        ignored: true as const,
      },
    ],
    semver: { bump: 'major' as const, reason: 'breaking', triggers: ['removed-path'] },
  });

  it('terminal: color markers, webhook/component group labels, ignored section', async () => {
    const { renderTerminal } = await import('../../src/reporters/terminal.js');
    const colored = renderTerminal(base() as never, { includeNonBreaking: false, showIgnored: true, color: true, quiet: false });
    expect(colored.join('\n')).toContain('\x1b[31m');
    expect(colored.join('\n')).toContain('Ignored changes:');
    expect(colored.join('\n')).toContain('[ignored]');

    const r2 = structuredClone(base()) as never;
    (r2 as { changes: Array<{ location: { method?: string } }> }).changes[0]!.location.method = undefined;
    const grouped = renderTerminal(r2, { includeNonBreaking: false, showIgnored: false, color: false, quiet: false });
    expect(grouped.join('\n')).toContain('/gone');

    const r3 = structuredClone(base()) as never;
    const loc3 = (r3 as { changes: Array<{ location: { context: string; path: string; method?: string } }> }).changes[0]!
      .location;
    loc3.context = 'webhook';
    loc3.path = ''; // webhooks are emitted with empty path and no method (see diffWebhooks)
    loc3.method = undefined;
    const g3 = renderTerminal(r3, { includeNonBreaking: false, showIgnored: false, color: false, quiet: false });
    expect(g3.join('\n')).toContain('webhook');
  });

  it('terminal: quiet mode with only informational changes shows the info suffix', async () => {
    const { renderTerminal } = await import('../../src/reporters/terminal.js');
    const r = structuredClone(base()) as never;
    const cast = r as { summary: { bySeverity: Record<string, number> } };
    cast.summary.bySeverity.error = 0;
    cast.summary.bySeverity.info = 2;
    const lines = renderTerminal(r, { includeNonBreaking: false, showIgnored: false, color: false, quiet: true });
    expect(lines.join('\n')).toContain('2 informational changes');
  });

  it('markdown: ignored section and bump line', async () => {
    const { renderMarkdown, markdownBumpLine } = await import('../../src/reporters/markdown.js');
    const md = renderMarkdown(base() as never);
    expect(md).toContain('Ignored changes (1)');
    expect(md).toContain('[ignored]');
    expect(md).toContain('apiguard v0.1.0');
    expect(markdownBumpLine(base() as never)).toBe('Suggested version bump: MAJOR');
  });
});
