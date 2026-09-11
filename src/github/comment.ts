/**
 * PR comment / job-summary rendering (spec §19). Byte-deterministic: no timestamps, sorted
 * rows, ASCII markers. Kept separate from action.ts so both are unit-testable without
 * a GitHub network context.
 */
import type { ApiChange } from '../core/models/change.js';
import type { DiffReport } from '../core/models/report.js';

export interface ActionOutcome {
  breaking: number;
  warnings: number;
  infos: number;
  ignored: number;
  suggestedVersion: string;
  verdict: 'fail' | 'pass';
  baselineVia: 'input' | 'merge-base';
}

export function isBreaking(c: ApiChange): boolean {
  return c.severity === 'error';
}

const MARK: Record<ApiChange['severity'], string> = {
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|');
}

/**
 * Render the PR comment / step-summary body. Deterministic: changes already come sorted
 * from the engine; the table order is the report order.
 */
export function renderComment(report: DiffReport, outcome: ActionOutcome): string {
  const lines: string[] = [];
  const icon = outcome.verdict === 'fail' ? '🚨' : '✅';
  lines.push(`## ${icon} API Guard report`);
  lines.push('');
  lines.push(
    `**${outcome.breaking}** breaking · **${outcome.warnings}** warnings · **${outcome.infos}** info` +
      (outcome.ignored > 0 ? ` · ${outcome.ignored} ignored` : ''),
  );
  lines.push('');
  lines.push(
    `Suggested next version: **${outcome.suggestedVersion}** ` +
      `(baseline: ${report.baseline.title} @ \`${report.baseline.sha256.slice(0, 12)}\`, ` +
      `resolved via ${outcome.baselineVia})`,
  );
  lines.push('');
  if (report.changes.length > 0) {
    lines.push('| Severity | Rule | Location | Message |');
    lines.push('|---|---|---|---|');
    for (const c of report.changes) {
      lines.push(
        `| ${MARK[c.severity]} ${c.severity} | \`${c.ruleId}\` | \`${c.location.path}\` | ${esc(c.message)} |`,
      );
    }
  } else {
    lines.push('No contract changes detected.');
  }
  lines.push('');
  lines.push('<details><summary>How to read this report</summary>');
  lines.push('');
  lines.push('- ❌ **error** — breaking: existing conformant clients will fail.');
  lines.push('- ⚠️ **warning** — non-breaking but may require client updates.');
  lines.push('- ℹ️ **info** — additive or cosmetic.');
  lines.push('');
  lines.push('Suppress with an <code>apiguard.yaml</code> ignore list — see the docs.');
  lines.push('</details>');
  return lines.join('\n');
}
