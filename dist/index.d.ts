/** Zod config schema per spec §14.3. Keys use the kebab-case spelling from the spec. */

/** Internal, camelCase-shaped resolved configuration consumed by the engine/CLI. */
interface ResolvedConfig {
    schemaVersion: 1;
    rules: Record<string, 'error' | 'warning' | 'info' | 'off'>;
    ignore: {
        paths: string[];
        operations: string[];
        schemas: string[];
        changes: string[];
        showIgnored: boolean;
    };
    output: {
        format: 'terminal' | 'json' | 'markdown';
        includeNonBreaking: boolean;
        color: 'auto' | 'always' | 'never';
    };
    failOn: 'error' | 'warning' | 'never';
    versioning: {
        suggest: boolean;
    };
    loader: {
        allowRemoteRefs: boolean;
    };
    github: {
        comment: boolean;
        checkRun: boolean;
        updateExistingComment: boolean;
    };
}

/** Core change taxonomy and change records per spec §4/§8. */
type Severity = 'error' | 'warning' | 'info';
type ChangeKind = 'addition' | 'removal' | 'modification' | 'relaxation' | 'documentation';
/** HTTP methods recognized in location.method. */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'TRACE';
/** Where a change was found, per spec §4 taxonomy. */
type Context = 'api' | 'operation' | 'request-body' | 'response-body' | 'request-header' | 'response-header' | 'parameter' | 'component' | 'security' | 'callback' | 'webhook';
interface ChangeLocation {
    /** URL path template, e.g. "/users/{id}"; '/' for api-level, '' for components. */
    path: string;
    method?: HttpMethod | string;
    operationId?: string;
    /** JSON Pointer into the OLD document (after deref where applicable). */
    pointerOld: string;
    /** JSON Pointer into the NEW document. */
    pointerNew: string;
    context: Context;
    /** When media-type relevant, e.g. "application/json". */
    mediaType?: string;
    /** Response context status code, e.g. "200" | "default". */
    statusCode?: string;
    /** When context === 'component'. */
    componentName?: string;
    /** Component rules: number of operation usages found. */
    usageCount?: number;
}
interface ApiChange {
    /** stable id = sha256(...).slice(0,16) per spec §12. */
    id: string;
    ruleId: string;
    severity: Severity;
    kind: ChangeKind;
    /** Derived: severity === 'error'. Stored per spec §8. */
    breaking: boolean;
    location: ChangeLocation;
    /** Human sentence, stable template. */
    message: string;
    /** Required for every change. */
    suggestion: string;
    /** Compact raw values (never full subtrees) for the JSON reporter. */
    oldValue?: unknown;
    newValue?: unknown;
    /** True only when show-ignored rendering includes a suppressed change. */
    ignored?: boolean;
}
interface DiffSummary {
    total: number;
    bySeverity: Record<Severity, number>;
    byKind: Record<ChangeKind, number>;
    /** Count of ignored changes (when show-ignored enabled). */
    ignored: number;
}
interface SemverAdvice {
    bump: 'major' | 'minor' | 'patch' | 'none';
    reason: string;
    triggers: string[];
}

/** Per-spec metadata used by reporters, per spec §8 DiffReport sides. */
interface SpecMeta {
    source: string;
    openapiVersion: string;
    title: string;
    sha256: string;
}
/** Full diff report — the machine contract (§15.1). Field order matters. */
interface DiffReport {
    schemaVersion: '1.0';
    tool: {
        name: 'apiguard';
        version: string;
    };
    baseline: SpecMeta;
    current: SpecMeta;
    summary: DiffSummary;
    changes: ApiChange[];
    semver: SemverAdvice;
    /** Present only when show-ignored is enabled. */
    ignored?: ApiChange[];
}

interface AnalyzeOptions {
    /** Explicit config path; otherwise discovery per §14.1. */
    configPath?: string;
    /** Pre-resolved config (used by the Action); overrides configPath. */
    config?: ResolvedConfig;
    /** Show changes suppressed by ignore rules. */
    showIgnored?: boolean;
}
interface AnalyzeResult {
    report: DiffReport;
    ignored: ApiChange[];
}
/** Run the full diff pipeline over two spec files. */
declare function analyze(baselinePath: string, currentPath: string, options?: AnalyzeOptions): Promise<AnalyzeResult>;

interface ValidationIssue {
    /** Severity class of the issue. */
    level: 'error' | 'warning';
    /** e.g. "spec.yaml" — rendered as `file: message` (line when known). */
    file: string;
    message: string;
}
interface ValidationResult {
    issues: ValidationIssue[];
    /** true when no structural (level=error) issues were found. */
    ok: boolean;
}

type JsonValue = unknown;
/** Resolved spec bundle: parsed document plus provenance metadata. */
interface LoadedSpec {
    /** Parsed document as plain JSON-compatible data. */
    document: JsonValue;
    /** Human-readable source label (file path or ref), used in reports. */
    source: string;
    /** OpenAPI version string as declared in the document (e.g. "3.0.3", "3.1.0"); '' when absent. */
    openapiVersion: string;
    /** Document title or '' when absent. */
    title: string;
    /** sha256 hex digest of the normalized document bytes. */
    sha256: string;
}
/** Internal representation of a normalized spec used by the diff engine. */
interface NormalizedSpec extends LoadedSpec {
    /** The normalized document (types as arrays, exclusiveMin/Max numeric, etc.). */
    normalized: JsonValue;
}

interface LoadedConfig {
    config: ResolvedConfig;
    /** Path of the file the config came from ('' when defaults only). */
    sourcePath: string;
    /** Deprecation warnings collected during load (printed to stderr by the CLI). */
    warnings: string[];
}
/** Load config from an explicit path (missing file → ConfigError, exit 2). */
declare function loadConfigFrom(explicitPath: string): LoadedConfig;
/** Discover config per §14.1; returns defaults when nothing is found. */
declare function discoverAndLoadConfig(opts?: {
    explicit?: string;
    env?: string;
    cwd?: string;
}): LoadedConfig;

/** Semver advisor per spec §16 — pure function over the change set. */

/**
 * Decision table (§16):
 * 1. any error → major (reason lists top ruleIds by count)
 * 2. else any addition|removal|modification OR any warning → minor
 * 3. else any relaxation|documentation info → patch
 * 4. else none
 */
declare function suggestVersion(changes: ApiChange[]): SemverAdvice;

/** Public library API per spec §18. Pure; no stdout; no process.exit. */

/**
 * Load + validate a spec (§18 `validateSpec`). Throws SpecLoadError (exit-3 class) on
 * structural problems; returns the semantic issue list otherwise.
 */
declare function validateSpec(specPath: string, options?: {
    loader?: {
        allowRemoteRefs?: boolean;
    };
}): Promise<{
    spec: NormalizedSpec;
    validation: ValidationResult;
}>;

export { type AnalyzeOptions, type AnalyzeResult, type ApiChange, type ChangeKind, type ChangeLocation, type Context, type DiffReport, type DiffSummary, type LoadedConfig, type LoadedSpec, type NormalizedSpec, type ResolvedConfig, type SemverAdvice, type Severity, type SpecMeta, type ValidationIssue, type ValidationResult, analyze, discoverAndLoadConfig, loadConfigFrom, suggestVersion, validateSpec };
