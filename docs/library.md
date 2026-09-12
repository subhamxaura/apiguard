# Library

The `@subhamxcod/apiguard` package exposes the engine for programmatic use — SDK release gates, spec
linters, custom reporters.

```bash
pnpm add @subhamxcod/apiguard
```

```ts
import { analyze, suggestVersion, validateSpec } from '@subhamxcod/apiguard';

// Full pipeline: load → normalize → diff → classify → sort → semver.
const { report, ignored } = await analyze('baseline.yaml', 'current.yaml', {
  configPath: './apiguard.yaml', // or pass a pre-resolved `config`
  showIgnored: false,
});

report.summary.bySeverity.error; // breaking count
report.changes; // sorted, deduped ApiChange[]
report.semver; // { bump: 'major', reason, triggers }
ignored; // changes suppressed by ignore rules
```

## Purity guarantees

- No stdout/stderr writes, no `process.exit`, no reading env vars
- Deterministic: same inputs → the same `report`, byte-for-byte, on any platform
- No timestamps in report bodies
- `core/` imports nothing from CLI, reporters, or GitHub layers

## Types

The JSON contract is the exported type surface:

- `DiffReport` — schemaVersion, tool, per-side `SpecMeta` (sha256!), summary, changes, semver
- `ApiChange` — `id` (stable sha256-based), `ruleId`, `severity`, `kind`, `breaking`, `location`, `message`, `suggestion`, compact `oldValue`/`newValue`
- `Severity` — `'error' | 'warning' | 'info'`; `breaking` ≡ `severity === 'error'`
- `SemverAdvice` — `'major' | 'minor' | 'patch' | 'none'` with reason + top trigger rule ids

## Single-spec validation

```ts
const { spec, validation } = await validateSpec('openapi.yaml');
spec.sha256; // content hash for caching
validation.ok; // false when semantic issues exist
validation.issues; // { level, message, pointer }[]
```

Structural problems throw `SpecLoadError` (the CLI's exit-3 class) rather than returning.

## Loading options

```ts
await analyze(a, b, {
  configPath: './ci-apiguard.yaml',
});
```

Remote `$ref` fetching is denied by default; pass a config with `loader.allowRemoteRefs: true`
only for trusted inputs.

## Sorting & dedupe invariants

Changes arrive sorted by severity → path → method rank → JSON-pointer → ruleId → id, and
deduped by stable `id`: rendering or grouping downstream never needs to re-sort.
