/** `apiguard diff` per spec §13/§17. */
import fs from 'node:fs';
import { analyze } from '../core/engine/analyze.js';
import { discoverAndLoadConfig, mergeWithFlags } from '../core/config/index.js';
import { renderTerminal, suggestLine } from '../reporters/terminal.js';
import { renderJson } from '../reporters/json.js';
import { CliUsageError, ExitCode } from '../utils/errors.js';
import type { CliIo } from './run.js';

export interface DiffOptions {
  format?: string;
  json?: boolean;
  markdown?: boolean;
  config?: string;
  failOn?: string;
  strict?: boolean;
  quiet?: boolean;
  suggestVersion?: boolean;
  includeNonBreaking?: boolean;
  output?: string;
  color?: boolean;
  showIgnored?: boolean;
  verbose?: boolean;
}

function resolveFormat(opts: DiffOptions): 'terminal' | 'json' | 'markdown' {
  if (opts.json) return 'json';
  if (opts.markdown) return 'markdown';
  if (opts.format !== undefined) {
    if (opts.format === 'terminal' || opts.format === 'json' || opts.format === 'markdown') {
      return opts.format;
    }
    throw new CliUsageError(`invalid --format "${opts.format}" (expected terminal|json|markdown)`);
  }
  const envFormat = process.env.APIGUARD_FORMAT;
  if (envFormat === 'json' || envFormat === 'markdown' || envFormat === 'terminal')
    return envFormat;
  return 'terminal';
}

function resolveFailOn(opts: DiffOptions): 'error' | 'warning' | 'never' {
  const raw = opts.strict ? 'warning' : (opts.failOn ?? process.env.APIGUARD_FAIL_ON ?? 'error');
  if (raw === 'error' || raw === 'warning' || raw === 'never') return raw;
  throw new CliUsageError(`invalid --fail-on "${raw}" (expected error|warning|never)`);
}

function colorEnabled(opts: DiffOptions, configColor: 'auto' | 'always' | 'never'): boolean {
  if (opts.color === false) return false; // --no-color
  if (process.env.APIGUARD_NO_COLOR !== undefined || process.env.NO_COLOR !== undefined)
    return false;
  if (configColor === 'always') return true;
  if (configColor === 'never') return false;
  return process.stdout.isTTY === true;
}

export async function runDiff(
  oldSpec: string,
  newSpec: string,
  opts: DiffOptions,
  io: CliIo,
): Promise<number> {
  if (opts.verbose) io.stderr(`verbose: loading baseline ${oldSpec} and current ${newSpec}`);

  const loaded = discoverAndLoadConfig({ explicit: opts.config, env: io.env.APIGUARD_CONFIG });
  for (const w of loaded.warnings) io.stderr(`warning: ${w}`);

  const config = mergeWithFlags(loaded.config, {
    format: resolveFormat(opts),
    failOn: resolveFailOn(opts),
    includeNonBreaking: opts.strict || opts.includeNonBreaking,
    suggestVersion: opts.suggestVersion,
    noColor: !colorEnabled(opts, loaded.config.output.color),
  });

  const { report } = await analyze(oldSpec, newSpec, {
    config,
    showIgnored: Boolean(opts.showIgnored) || loaded.config.ignore.showIgnored === true,
  });

  let body: string;
  const wantBump = !opts.quiet && (config.versioning.suggest || opts.suggestVersion === true);
  if (opts.quiet) {
    // §13: --quiet prints only the one-line verdict, regardless of format
    body =
      report.summary.bySeverity.error > 0
        ? '❌ Breaking API changes found'
        : '✓ No breaking API changes found';
  } else if (config.output.format === 'json') {
    body = renderJson(report);
  } else if (config.output.format === 'markdown') {
    const { renderMarkdown } = await import('../reporters/markdown.js');
    body = renderMarkdown(report);
  } else {
    const lines = renderTerminal(report, {
      includeNonBreaking: config.output.includeNonBreaking,
      showIgnored: Boolean(opts.showIgnored) || loaded.config.ignore.showIgnored === true,
      color:
        config.output.color === 'always' ||
        (config.output.color === 'auto' && process.stdout.isTTY === true),
      quiet: Boolean(opts.quiet),
    });
    body = lines.join('\n');
    const bump = wantBump ? suggestLine(report) : null;
    if (bump) body += '\n\n' + bump;
  }

  // quiet: verdict only (handled inside renderTerminal); errors still go to stderr
  io.stdout(body);

  if (opts.output) {
    fs.writeFileSync(opts.output, body + '\n', 'utf8');
    if (!opts.quiet) io.stderr(`report written to ${opts.output}`);
  }

  // exit policy per §17: exit 1 when any change at ≥ fail-on level exists
  if (config.failOn === 'never') return ExitCode.Ok;
  const threshold = config.failOn === 'error' ? 'error' : 'warning';
  const hits =
    threshold === 'error'
      ? report.summary.bySeverity.error > 0
      : report.summary.bySeverity.error + report.summary.bySeverity.warning > 0;
  return hits ? ExitCode.BreakingChanges : ExitCode.Ok;
}
