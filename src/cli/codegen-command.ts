/** `apiguard codegen-shim` command handler. */
import fs from 'node:fs';
import { analyze } from '../core/engine/analyze.js';
import { discoverAndLoadConfig } from '../core/config/index.js';
import { generateGatewayShim, type ShimTarget } from '../codegen/shim.js';
import { CliUsageError, ExitCode } from '../utils/errors.js';
import type { CliIo } from './run.js';

export interface CodegenOptions {
  config?: string;
  output?: string;
  target?: string;
  gitBase?: string;
}

export async function runCodegenShim(
  oldSpec: string,
  newSpec: string | undefined,
  opts: CodegenOptions,
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

  const rawTarget = opts.target ?? 'express';
  if (rawTarget !== 'express' && rawTarget !== 'cloudflare-worker' && rawTarget !== 'envoy-lua') {
    throw new CliUsageError(
      `invalid --target "${rawTarget}" (expected express|cloudflare-worker|envoy-lua)`,
    );
  }
  const target = rawTarget as ShimTarget;

  const loaded = discoverAndLoadConfig({ explicit: opts.config, env: io.env.APIGUARD_CONFIG });
  const { report } = await analyze(oldSpec, newSpec, { config: loaded.config });

  const result = generateGatewayShim(report, target);

  io.stdout(result.code);

  if (opts.output) {
    fs.writeFileSync(opts.output, result.code, 'utf8');
    io.stderr(
      `compatibility shim written to ${opts.output} (${result.handledChanges} breaking change(s) addressed)`,
    );
  }

  return ExitCode.Ok;
}
