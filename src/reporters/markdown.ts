/** Markdown reporter per spec §15.2 (GitHub-compatible; details/summary + table only). */
import type { ApiChange, Severity } from '../core/models/change.js';
import type { DiffReport } from '../core/models/report.js';

const LABEL: Record<Severity, string> = {
  error: 'Breaking (errors)',
  warning: 'Warnings',
  info: 'Informational',
};

function truncate(s: string, max = 140): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function endpointOf(change: ApiChange): string {
  const loc = change.location;
  if (loc.method) return `${loc.method} ${loc.path}`;
  if (loc.path && loc.path !== '/') return loc.path;
  if (loc.componentName) return loc.componentName;
  return 'API';
}

/** Render the markdown report body (deterministic). */
export function renderMarkdown(report: DiffReport): string {
  const lines: string[] = [];

  const breaking = report.summary.bySeverity.error;
  lines.push(
    breaking > 0
      ? `## ❌ API Guard: ${breaking} breaking change${breaking === 1 ? '' : 's'} found`
      : '## ✅ API Guard: no breaking changes',
  );
  lines.push('');

  // summary table
  lines.push('| Rule | Severity | Endpoint | What changed | Suggestion |');
  lines.push('|---|---|---|---|---|');
  for (const c of report.changes) {
    lines.push(
      `| \`${c.ruleId}\` | ${c.severity} | ${endpointOf(c)} | ${truncate(c.message.replace(/\|/g, '\\|'))} | ${truncate(c.suggestion.replace(/\|/g, '\\|'))} |`,
    );
  }

  // collapsible groups per severity (only non-empty)
  for (const sev of ['error', 'warning', 'info'] as const) {
    const group = report.changes.filter((c) => c.severity === sev);
    if (group.length === 0) continue;
    lines.push('');
    lines.push(`<details>`);
    lines.push(`<summary>${LABEL[sev]} (${group.length})</summary>`);
    lines.push('');
    for (const c of group) {
      lines.push(`#### \`${c.ruleId}\` — ${endpointOf(c)}`);
      lines.push('');
      lines.push(c.message);
      lines.push('');
      lines.push(`> **Suggestion:** ${c.suggestion}`);
      lines.push('');
    }
    lines.push(`</details>`);
  }

  // ignored section
  if (report.ignored && report.ignored.length > 0) {
    lines.push('');
    lines.push(`<details>`);
    lines.push(`<summary>Ignored changes (${report.ignored.length})</summary>`);
    lines.push('');
    for (const c of report.ignored) {
      lines.push(`- [ignored] \`${c.ruleId}\` — ${c.message}`);
    }
    lines.push('');
    lines.push(`</details>`);
  }

  // footer
  lines.push('');
  lines.push(
    `<sub>apiguard v${report.tool.version} · baseline ${report.baseline.sha256.slice(0, 8)} → current ${report.current.sha256.slice(0, 8)}</sub>`,
  );
  return lines.join('\n');
}

/** Bump line for markdown footer when requested. */
export function markdownBumpLine(report: DiffReport): string | null {
  const bump = report.semver.bump;
  if (bump === 'none') return null;
  const label = bump === 'major' ? 'MAJOR' : bump === 'minor' ? 'MINOR' : 'PATCH';
  return `Suggested version bump: ${label}`;
}
