/**
 * SARIF 2.1.0 reporter for GitHub Advanced Security / Code Scanning integration.
 * Conforms to OASIS SARIF v2.1.0 specification.
 */
import path from 'node:path';
import type { DiffReport } from '../core/models/report.js';
import type { Severity } from '../core/models/change.js';
import { getAllRules } from '../core/rules/rule-registry.js';

function sarifLevel(severity: Severity): 'error' | 'warning' | 'note' {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'note';
  }
}

/** Render a DiffReport into a SARIF 2.1.0 JSON document. */
export function renderSarif(report: DiffReport): string {
  const rules = getAllRules().map((r) => ({
    id: r.id,
    shortDescription: { text: r.id },
    fullDescription: { text: r.trigger },
    defaultConfiguration: {
      level: sarifLevel(r.defaultSeverity),
    },
    help: {
      text: `${r.trigger}\nSuggestion: ${r.suggestion({ location: { path: '/', pointerOld: '', pointerNew: '', context: 'api' } })}`,
      markdown: `**Trigger:** ${r.trigger}\n\n[API Guard Rule Reference](https://github.com/subhamxaura/apiguard/blob/main/docs/rules.md#${r.id})`,
    },
    properties: {
      tags: ['api-contract', 'openapi', 'breaking-change', ...r.contexts],
    },
  }));

  const results = report.changes.map((c) => {
    const rawPath = c.location.file || report.current.source;
    const rel = path.isAbsolute(rawPath) ? path.relative(process.cwd(), rawPath) : rawPath;
    let fileUri = rel.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    if (!fileUri || fileUri === '.') {
      fileUri = path.basename(report.current.source) || 'openapi.yaml';
    }
    const line = c.location.line && c.location.line > 0 ? c.location.line : 1;
    const col = c.location.column && c.location.column > 0 ? c.location.column : 1;

    return {
      ruleId: c.ruleId,
      level: sarifLevel(c.severity),
      message: {
        text: `${c.message}. Suggestion: ${c.suggestion}`,
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: fileUri,
              uriBaseId: '%SRCROOT%',
            },
            region: {
              startLine: line,
              startColumn: col,
            },
          },
        },
      ],
      properties: {
        kind: c.kind,
        breaking: c.breaking,
        context: c.location.context,
        path: c.location.path,
        method: c.location.method,
      },
    };
  });

  const sarifLog = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'apiguard',
            version: report.tool.version,
            informationUri: 'https://github.com/subhamxaura/apiguard',
            rules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarifLog, null, 2);
}
