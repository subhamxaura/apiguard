/**
 * JUnit XML reporter per spec §13 for CI/CD test result ingestion (Jenkins, GitLab CI, CircleCI, etc.).
 */
import type { DiffReport } from '../core/models/report.js';

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderJunit(report: DiffReport): string {
  const breakingCount = report.summary.bySeverity.error;
  const totalTests = report.changes.length === 0 ? 1 : report.changes.length;
  const failures = breakingCount;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="API Guard" tests="${totalTests}" failures="${failures}" errors="0" time="0">`,
  );
  lines.push(
    `  <testsuite name="OpenAPI Contract Changes" tests="${totalTests}" failures="${failures}" errors="0" skipped="0" time="0">`,
  );

  if (report.changes.length === 0) {
    lines.push('    <testcase classname="api" name="contract-compatibility" time="0"/>');
  } else {
    for (const c of report.changes) {
      const classname = escapeXml(c.location.context);
      const name = escapeXml(
        `${c.ruleId}${c.location.method ? ' ' + c.location.method : ''}${c.location.path ? ' ' + c.location.path : ''}`,
      );
      lines.push(`    <testcase classname="${classname}" name="${name}" time="0">`);
      if (c.breaking) {
        const message = escapeXml(c.message);
        const ptr = c.location.pointerNew || c.location.pointerOld || '';
        const bodyText = escapeXml(
          `Rule: ${c.ruleId}\nSeverity: ${c.severity}\nLocation: ${c.location.path} (${ptr})\nSuggestion: ${c.suggestion}`,
        );
        lines.push(
          `      <failure message="${message}" type="${escapeXml(c.ruleId)}">${bodyText}</failure>`,
        );
      } else {
        const infoText = escapeXml(
          `[${c.severity.toUpperCase()}] ${c.message}\nSuggestion: ${c.suggestion}`,
        );
        lines.push(`      <system-out>${infoText}</system-out>`);
      }
      lines.push('    </testcase>');
    }
  }

  lines.push('  </testsuite>');
  lines.push('</testsuites>');
  return lines.join('\n');
}
