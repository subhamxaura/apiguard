/**
 * Automated API Changelog generator.
 * Produces structured release notes in Keep-a-Changelog Markdown format.
 */
import type { DiffReport } from '../core/models/report.js';
import type { ApiChange } from '../core/models/change.js';

function endpointOf(change: ApiChange): string {
  const loc = change.location;
  if (loc.method && loc.path) return `\`${loc.method} ${loc.path}\``;
  if (loc.path && loc.path !== '/') return `\`${loc.path}\``;
  if (loc.componentName) return `component \`${loc.componentName}\``;
  return 'API';
}

/** Render a DiffReport into Keep-a-Changelog Markdown format. */
export function renderChangelog(report: DiffReport): string {
  const lines: string[] = [];
  const version =
    report.semver.bump === 'none'
      ? 'Current Release (No version bump)'
      : `Next Release (Recommended bump: ${report.semver.bump.toUpperCase()})`;
  lines.push(`## ${version}`);
  lines.push('');

  const breaking = report.changes.filter((c) => c.severity === 'error');
  const additions = report.changes.filter((c) => c.severity !== 'error' && c.kind === 'addition');
  const modifications = report.changes.filter(
    (c) => c.severity !== 'error' && c.kind === 'modification',
  );
  const relaxations = report.changes.filter(
    (c) => c.severity !== 'error' && (c.kind === 'relaxation' || c.kind === 'documentation'),
  );

  if (breaking.length > 0) {
    lines.push('### 🛑 Breaking Changes');
    lines.push('');
    for (const c of breaking) {
      lines.push(`- **${endpointOf(c)}**: ${c.message} (\`${c.ruleId}\`)`);
      lines.push(`  *Suggestion: ${c.suggestion}*`);
    }
    lines.push('');
  }

  if (additions.length > 0) {
    lines.push('### 🚀 Added');
    lines.push('');
    for (const c of additions) {
      lines.push(`- **${endpointOf(c)}**: ${c.message}`);
    }
    lines.push('');
  }

  if (modifications.length > 0) {
    lines.push('### 🔄 Changed');
    lines.push('');
    for (const c of modifications) {
      lines.push(`- **${endpointOf(c)}**: ${c.message}`);
    }
    lines.push('');
  }

  if (relaxations.length > 0) {
    lines.push('### ℹ️ Other Improvements');
    lines.push('');
    for (const c of relaxations) {
      lines.push(`- **${endpointOf(c)}**: ${c.message}`);
    }
    lines.push('');
  }

  if (report.changes.length === 0) {
    lines.push('No functional contract changes detected between specifications.');
  }

  return lines.join('\n').trim();
}
