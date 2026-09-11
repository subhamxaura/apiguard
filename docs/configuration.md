# Configuration

API Guard reads `apiguard.yaml` (or `apiguard.json`) from the working directory, an
`APIGUARD_CONFIG` environment variable, or an explicit `--config <path>`. Missing explicit
config files are a usage error (exit 2); discovery that finds nothing silently uses defaults.

## Full shape

```yaml
schemaVersion: 1

rules:
  property-removed: warning # error | warning | info | off
  description-changed@operation: off # per-context override (ruleId@context)
  removed-parameter@media-type: off # context names come from the rule reference

ignore:
  paths: # globs against the spec path (micromatch)
    - '/internal/**'
    - '/legacy/*'
  operations: # "METHOD /path" entries
    - 'GET /users/search'
  schemas: # component schema names
    - 'LegacyUser'
  changes: # rule ids, everywhere
    - 'description-changed'
  showIgnored: false # implies --show-ignored when true

output:
  format: terminal # terminal | json | markdown
  includeNonBreaking: false
  color: auto # auto | always | never

failOn: error # error | warning | never

versioning:
  suggest: true # compute report.semver

loader:
  allowRemoteRefs: false # deny http(s) $ref fetching (default)

github:
  comment: false # reserved for Action-side comment config
  checkRun: false
  updateExistingComment: false
```

## Rule severities and context overrides

Every rule id from the [rule reference](rules.md) is a config key. The bare id sets the
severity everywhere the rule can fire; `ruleId@context` narrows it to one context:

```yaml
rules:
  enum-value-removed: error # default
  enum-value-removed@response-body: info # lenient where clients just display values
```

Precedence: `ruleId@context` wins over the bare id, which wins over the built-in default.
`off` fully disables a rule (it never emits, and `--show-ignored` will not resurrect it —
ignored lists do that instead).

## Legacy aliases

A few pre-1.0 rule names still resolve (with a warning on stderr): see
`LEGACY_RULE_ALIASES` in `src/core/config/loader.ts`. New configs should use canonical ids.

## Validation

The config is validated at load (zod): unknown rule ids, unknown contexts, bad severities,
and `schemaVersion` mismatches are hard errors naming the offending key. Duplicate list
entries keep their first occurrence (deterministic).

## Flag interaction

CLI flags override config values for the single run: `--fail-on` overrides `failOn`,
`--include-non-breaking` overrides `output.includeNonBreaking`, `--show-ignored` overrides
`ignore.showIgnored`, `--format`/`--json`/`--markdown` override `output.format`.
