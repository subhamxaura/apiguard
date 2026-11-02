/** `apiguard changelog` command handler. */
import fs from 'node:fs';
import { analyze } from '../core/engine/analyze.js';
import { discoverAndLoadConfig } from '../core/config/index.js';
import { renderChangelog } from '../reporters/changelog.js';
import { CliUsageError, ExitCode } from '../utils/errors.js';
import type { CliIo } from './run.js';

export interface ChangelogOptions {
  config?: string;
  output?: string;
  gitBase?: string;
  json?: boolean;
}

export async function runChangelog(
  oldSpec: string,
  newSpec: string,
  opts: ChangelogOptions,
  io: CliIo,
): Promise<number> {
  if (opts.gitBase) {
    if (!newSpec && oldSpec) {
      newSpec = oldSpec;
      oldSpec = `git:${opts.gitBase}:${newSpec}`;
    }
  }

  if (!oldSpec || !newSpec) {
    throw new CliUsageError('missing required spec arguments (or use --git-base <ref>)');
  }

  const loaded = discoverAndLoadConfig({ explicit: opts.config, env: io.env.APIGUARD_CONFIG });
  const { report } = await analyze(oldSpec, newSpec, { config: loaded.config });

  const body = opts.json
    ? JSON.stringify(
        { semver: report.semver, summary: report.summary, changes: report.changes },
        null,
        2,
      )
    : renderChangelog(report);

  io.stdout(body);

  if (opts.output) {
    fs.writeFileSync(opts.output, body + '\n', 'utf8');
    io.stderr(`changelog written to ${opts.output}`);
  }

  return ExitCode.Ok;
}
