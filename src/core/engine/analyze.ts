/**
 * analyze() — the pure engine entry per spec §18: no stdout, no process.exit. CLI and the
 * GitHub Action wrap it. Pipeline per §9.
 */
import { discoverAndLoadConfig, type LoadedConfig } from '../config/index.js';
import type { ResolvedConfig } from '../config/schema.js';
import { loadSpec } from '../../loaders/spec-loader.js';
import type { JsonObject, NormalizedSpec } from '../models/types.js';
import type { DiffReport, SpecMeta } from '../models/report.js';
import type { ApiChange as Change, ChangeKind, DiffSummary, Severity } from '../models/change.js';
import { TOOL_VERSION } from '../models/report.js';
import { runStructuralDiff, buildSpecIndex, type DiffContext } from './differ.js';
import { structuralDeref } from './walker.js';
import { sortChanges, dedupeChanges } from '../../utils/sort.js';
import { applyIgnores } from '../ignore/ignore.js';
import { suggestVersion } from '../versioning/semver-advisor.js';

export interface AnalyzeOptions {
  /** Explicit config path; otherwise discovery per §14.1. */
  configPath?: string;
  /** Pre-resolved config (used by the Action); overrides configPath. */
  config?: ResolvedConfig;
  /** Show changes suppressed by ignore rules. */
  showIgnored?: boolean;
}

export interface AnalyzeResult {
  report: DiffReport;
  ignored: Change[];
}

function summarize(changes: Change[], ignoredCount: number): DiffSummary {
  const summary: DiffSummary = {
    total: changes.length,
    bySeverity: { error: 0, warning: 0, info: 0 },
    byKind: { addition: 0, removal: 0, modification: 0, relaxation: 0, documentation: 0 },
    ignored: ignoredCount,
  };
  for (const c of changes) {
    summary.bySeverity[c.severity]++;
    summary.byKind[c.kind]++;
  }
  return summary;
}

function metaOf(spec: NormalizedSpec): SpecMeta {
  return {
    source: spec.source,
    openapiVersion: spec.openapiVersion,
    title: spec.title,
    sha256: spec.sha256,
  };
}

/** Run the full diff pipeline over two spec files. */
export async function analyze(
  baselinePath: string,
  currentPath: string,
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const loaded: LoadedConfig = options.config
    ? { config: options.config, sourcePath: '', warnings: [] }
    : discoverAndLoadConfig({ explicit: options.configPath });
  const config: ResolvedConfig = loaded.config;

  const [baseline, current] = await Promise.all([
    loadSpec(baselinePath, { loader: { allowRemoteRefs: config.loader.allowRemoteRefs } }),
    loadSpec(currentPath, { loader: { allowRemoteRefs: config.loader.allowRemoteRefs } }),
  ]);

  // §11.4: structural deref — local components.schemas $refs are inlined (memoized,
  // cycle-safe §11.7) so comparison is semantic; original pointers are retained upstream.
  structuralDeref(baseline.normalized as JsonObject);
  structuralDeref(current.normalized as JsonObject);

  const ctx: DiffContext = {
    baseline,
    current,
    baselineIndex: buildSpecIndex(baseline.normalized),
    currentIndex: buildSpecIndex(current.normalized),
    config,
    candidates: [],
  };

  runStructuralDiff(ctx);

  // sort + dedupe per §12 (id computed at emit; first occurrence wins)
  const deduped = dedupeChanges(sortChanges([...ctx.candidates]));
  const { kept, ignored } = applyIgnores(deduped, config);

  const summary = summarize(kept, ignored.length);
  const semver = suggestVersion(kept);

  const report: DiffReport = {
    schemaVersion: '1.0',
    tool: { name: 'apiguard', version: TOOL_VERSION },
    baseline: metaOf(baseline),
    current: metaOf(current),
    summary,
    changes: kept,
    semver,
  };
  if (options.showIgnored && ignored.length > 0) {
    report.ignored = ignored.map((c) => ({ ...c, ignored: true }));
  }
  return { report, ignored };
}

export type { Change as ApiChange, ChangeKind, Severity, DiffReport };
