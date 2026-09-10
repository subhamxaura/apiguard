/** Public library API per spec §18. Pure; no stdout; no process.exit. */
import { analyze, type AnalyzeOptions, type AnalyzeResult } from './core/engine/analyze.js';
import { loadSpec } from './loaders/spec-loader.js';
import { validateSemantics, type ValidationResult } from './loaders/validate.js';
import type { NormalizedSpec } from './core/models/types.js';

export { analyze, type AnalyzeOptions, type AnalyzeResult };
export {
  discoverAndLoadConfig,
  loadConfigFrom,
  type LoadedConfig,
} from './core/config/index.js';
export { suggestVersion } from './core/versioning/semver-advisor.js';
export type {
  ApiChange,
  ChangeKind,
  Severity,
  SemverAdvice,
  ChangeLocation,
  Context,
  DiffSummary,
} from './core/models/change.js';
export type { DiffReport, SpecMeta } from './core/models/report.js';
export type { ResolvedConfig } from './core/config/schema.js';
export type { ValidationResult, ValidationIssue } from './loaders/validate.js';
export type { NormalizedSpec, LoadedSpec } from './core/models/types.js';

/**
 * Load + validate a spec (§18 `validateSpec`). Throws SpecLoadError (exit-3 class) on
 * structural problems; returns the semantic issue list otherwise.
 */
export async function validateSpec(
  specPath: string,
  options?: { loader?: { allowRemoteRefs?: boolean } },
): Promise<{ spec: NormalizedSpec; validation: ValidationResult }> {
  const spec = await loadSpec(specPath, { loader: options?.loader });
  const validation = validateSemantics(spec.document, specPath);
  return { spec, validation };
}
