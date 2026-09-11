/** `apiguard validate` per spec §13. */
import { loadSpec } from '../loaders/spec-loader.js';
import { validateSemantics, formatIssues } from '../loaders/validate.js';
import { SpecValidationError } from '../utils/errors.js';
import type { CliIo } from './run.js';

export interface ValidateOutcome {
  /** Exit code per §17: 0 clean, 3 structural, 1 strict+warnings. */
  exitCode: number;
}

export async function runValidate(
  spec: string,
  opts: { strict?: boolean; verbose?: boolean },
  io: CliIo,
): Promise<ValidateOutcome> {
  if (opts.verbose) io.stderr(`verbose: loading ${spec}`);
  const loaded = await loadSpec(spec);
  const result = validateSemantics(loaded.document, spec);

  if (result.issues.length > 0) {
    for (const line of formatIssues(result.issues)) io.stdout(line);
  }

  const structuralErrors = result.issues.some((i) => i.level === 'error');
  if (structuralErrors) {
    // structural problems are load-time failures by doctrine (§5.4); surface as exit 3
    const first = result.issues.find((i) => i.level === 'error');
    throw new SpecValidationError(`${spec}: semantic validation failed: ${first?.message ?? ''}`);
  }

  const warnings = result.issues.filter((i) => i.level === 'warning');
  if (opts.strict && warnings.length > 0) {
    io.stdout(`✗ ${warnings.length} semantic warning(s)`);
    return { exitCode: 1 };
  }
  io.stdout(`✓ ${spec} is valid${warnings.length > 0 ? ` (${warnings.length} warning(s))` : ''}`);
  return { exitCode: 0 };
}
