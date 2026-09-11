/** Terminal reporter per spec §13/§15.3. Row markers ASCII-stable: ERROR/WARN/INFO. */
import type { ApiChange, Severity } from '../core/models/change.js';
import type { DiffReport } from '../core/models/report.js';

export interface RenderOptions {
  includeNonBreaking: boolean;
  showIgnored: boolean;
  color: boolean;
  quiet: boolean;
}

const MARKER: Record<Severity, string> = { error: 'ERROR', warning: 'WARN', info: 'INFO' };

const ANSI = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

function markerFor(sev: Severity, color: boolean): string {
  const marker = MARKER[sev].padEnd(5);
  if (!color) return marker;
  if (sev === 'error') return ANSI.red(marker);
  if (sev === 'warning') return ANSI.yellow(marker);
  return ANSI.cyan(marker);
}

/** Group key: "METHOD /path" or the path/api label. */
function groupKey(change: ApiChange): string {
  const loc = change.location;
  if (loc.method) return `${loc.method} ${loc.path}`;
  if (loc.path && loc.path !== '/') return loc.path;
  if (loc.context === 'webhook') return `webhook ${loc.componentName ?? ''}`.trim();
  if (loc.componentName) return `component ${loc.componentName}`;
  return 'API';
}

/** Render the full terminal report (deterministic, §5.1). */
export function renderTerminal(report: DiffReport, options: RenderOptions): string[] {
  const lines: string[] = [];
  const breakingCount = report.summary.bySeverity.error;
  const infoCount = report.summary.bySeverity.info + report.summary.bySeverity.warning;

  const renderable = report.changes.filter((c) => {
    if (c.severity === 'error') return true;
    return options.includeNonBreaking;
  });

  if (!options.quiet) {
    if (renderable.length > 0) {
      // group by location key, sorted by first appearance in the sorted changes
      const groups = new Map<string, ApiChange[]>();
      for (const c of renderable) {
        const key = groupKey(c);
        const arr = groups.get(key);
        if (arr) arr.push(c);
        else groups.set(key, [c]);
      }
      for (const [key, changes] of groups) {
        lines.push(key);
        for (const c of changes) {
          const marker = markerFor(c.severity, options.color);
          lines.push(`  ${marker} ${c.message}`);
          lines.push(`  Suggestion: ${c.suggestion}`);
        }
        lines.push('');
      }
      // drop trailing blank line
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    }

    // ignored section (show-ignored)
    if (options.showIgnored && report.ignored && report.ignored.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('Ignored changes:');
      for (const c of report.ignored) {
        const marker = markerFor(c.severity, options.color);
        lines.push(`  ${marker} [ignored] ${c.message}`);
        lines.push(`  Suggestion: ${c.suggestion}`);
      }
    }
  }

  // verdict line (always; --quiet prints only this)
  if (breakingCount > 0) {
    const verdict = '❌ Breaking API changes found';
    lines.push(options.color ? ANSI.red(ANSI.bold(verdict)) : verdict);
  } else {
    const suffix =
      infoCount > 0 ? ` (${infoCount} informational change${infoCount === 1 ? '' : 's'})` : '';
    const verdict = `✓ No breaking API changes found${suffix}`;
    lines.push(options.color ? ANSI.green(verdict) : verdict);
  }

  return lines;
}

/** Suggested bump line (§13): "Suggested version bump: MAJOR" — empty when none. */
export function suggestLine(report: DiffReport): string | null {
  const bump = report.semver.bump;
  if (bump === 'none') return null;
  const label = bump === 'major' ? 'MAJOR' : bump === 'minor' ? 'MINOR' : 'PATCH';
  return `Suggested version bump: ${label}`;
}
