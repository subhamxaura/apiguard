/** Commander CLI per spec §13. */
import { Command } from 'commander';
import { discoverAndLoadConfig } from '../core/config/index.js';
import { CliUsageError, ExitCode } from '../utils/errors.js';
import { exitCodeFor, renderError } from './exit-codes.js';
import { runDiff } from './diff-command.js';
import { runValidate } from './validate-command.js';
import { runInit } from './init-command.js';
import { runChangelog } from './changelog-command.js';
import { runCodegenShim } from './codegen-command.js';
import { TOOL_VERSION } from '../core/models/report.js';

export interface CliIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  argv: readonly string[];
  env: Record<string, string | undefined>;
}

export const defaultIo: CliIo = {
  stdout: (s) => process.stdout.write(s + '\n'),
  stderr: (s) => process.stderr.write(s + '\n'),
  argv: process.argv,
  env: process.env as Record<string, string | undefined>,
};

/** Build the commander program (exported for help-snapshot tests). */
export function buildProgram(io: CliIo): Command {
  const program = new Command();
  // exitOverride: commander throws CommanderError instead of process.exit — run() maps it
  // to the §17 exit codes (--help/--version → 0, usage errors → exitCode, §17).
  program.exitOverride();
  // route help/usage text through CliIo so tests (and embedders) capture it deterministically
  program.configureOutput({
    writeOut: (s) => io.stdout(s.trimEnd()),
    writeErr: () => {}, // Commander usage errors are formatted and rendered once via renderError in run()
  });
  program
    .name('apiguard')
    .version(TOOL_VERSION)
    .description('Detect breaking changes between OpenAPI specifications');

  const diff = program
    .command('diff')
    .description('Diff two OpenAPI specs and report breaking changes')
    .argument('<old-spec>', 'baseline spec path')
    .argument('[new-spec]', 'current spec path')
    .option(
      '--format <f>',
      'terminal|json|markdown|html|sarif|junit (aliases: --json, --markdown, --html, --sarif, --junit)',
    )
    .option('--json', 'shorthand for --format json')
    .option('--markdown', 'shorthand for --format markdown')
    .option('--html', 'shorthand for --format html')
    .option('--sarif', 'shorthand for --format sarif')
    .option('--junit', 'shorthand for --format junit')
    .option('--allow-external-files', 'allow $ref to files outside spec directory')
    .option('--open', 'open interactive HTML report in browser')
    .option('--git-base <ref>', 'resolve baseline against git branch or commit')
    .option('--profile <p>', 'client persona profile (default|strict-sdk|loose-web)')
    .option('--config <path>', 'explicit config file (missing file: exit 2)')
    .option('--fail-on <level>', 'error|warning|never', 'error')
    .option('--strict', 'shorthand for --fail-on warning AND --include-non-breaking')
    .option('--quiet', 'print only the one-line verdict')
    .option('--suggest-version', 'print suggested version bump after the report')
    .option('--include-non-breaking', 'also render warning+info changes')
    .option('--output <path>', 'also write the full report to a file')
    .option('--no-color', 'disable ANSI color (auto-detected for non-TTY)')
    .option('--show-ignored', 'render changes suppressed by ignore rules, tagged ignored')
    .option('--verbose', 'log parse/config steps to stderr')
    .action(async (oldSpec, newSpec, opts) => {
      const code = await runDiff(oldSpec, newSpec, opts, io);
      if (code !== ExitCode.Ok) {
        process.exitCode = code;
        // commander swallows return values; surface the policy exit code via exception-free path
        (program as unknown as { __apiguardExitCode?: number }).__apiguardExitCode = code;
      }
    });

  void diff;

  program
    .command('changelog')
    .description('Generate a Keep-a-Changelog formatted release summary from spec diff')
    .argument('<old-spec>', 'baseline spec path')
    .argument('[new-spec]', 'current spec path')
    .option('--config <path>', 'explicit config file')
    .option('--output <path>', 'write changelog to file')
    .option('--git-base <ref>', 'resolve baseline against git branch or commit')
    .option('--json', 'output changelog as JSON')
    .action(async (oldSpec, newSpec, opts) => {
      const code = await runChangelog(oldSpec, newSpec, opts, io);
      if (code !== ExitCode.Ok) {
        process.exitCode = code;
        (program as unknown as { __apiguardExitCode?: number }).__apiguardExitCode = code;
      }
    });

  program
    .command('codegen-shim')
    .description('Generate backward-compatibility gateway adapter for breaking changes')
    .argument('<old-spec>', 'baseline spec path')
    .argument('[new-spec]', 'current spec path')
    .option('--target <t>', 'express|cloudflare-worker|envoy-lua', 'express')
    .option('--config <path>', 'explicit config file')
    .option('--output <path>', 'write generated shim code to file')
    .option('--git-base <ref>', 'resolve baseline against git branch or commit')
    .action(async (oldSpec, newSpec, opts) => {
      const code = await runCodegenShim(oldSpec, newSpec, opts, io);
      if (code !== ExitCode.Ok) {
        process.exitCode = code;
        (program as unknown as { __apiguardExitCode?: number }).__apiguardExitCode = code;
      }
    });

  program
    .command('validate')
    .description('Load and validate a spec')
    .argument('<spec>', 'spec path')
    .option('--config <path>', 'explicit config file')
    .option('--strict', 'exit 1 when semantic warnings exist')
    .option('--verbose', 'log parse steps to stderr')
    .action(async (spec, opts) => {
      const outcome = await runValidate(spec, opts, io);
      if (outcome.exitCode !== ExitCode.Ok) {
        (program as unknown as { __apiguardExitCode?: number }).__apiguardExitCode =
          outcome.exitCode;
      }
    });

  program
    .command('init')
    .description('Scaffold an apiguard.yaml config template')
    .argument('[dir]', 'target directory (default: cwd)', '.')
    .option('--examples', 'also write two sample specs for a first diff run')
    .option('--force', 'overwrite existing files')
    .action(async (dir, opts) => {
      await runInit(dir, opts, io);
    });

  return program;
}

/** One entry point that maps error classes to exit codes (§17). */
export async function run(io: CliIo = defaultIo): Promise<number> {
  const program = buildProgram(io);
  try {
    await program.parseAsync(io.argv as string[], { from: 'node' });
    const code = (program as unknown as { __apiguardExitCode?: number }).__apiguardExitCode;
    return code ?? ExitCode.Ok;
  } catch (err) {
    const rendered = renderError(err, io.env.APIGUARD_VERBOSE === '1');
    if (rendered) io.stderr(rendered);
    return exitCodeFor(err);
  }
}

/** Shared config resolution used by commands (env + explicit path). */
export function resolveConfigOrThrow(
  io: CliIo,
  explicitPath?: string,
): ReturnType<typeof discoverAndLoadConfig> {
  const loaded = discoverAndLoadConfig({
    explicit: explicitPath,
    env: io.env.APIGUARD_CONFIG,
  });
  for (const w of loaded.warnings) io.stderr(`warning: ${w}`);
  return loaded;
}

export { mergeWithFlags } from '../core/config/index.js';
export const fail = (msg: string): never => {
  throw new CliUsageError(msg);
};
