# API Guard

> Detect breaking changes between OpenAPI specifications (3.0 & 3.1) so API contracts never
> silently break downstream consumers.

[![Test](https://github.com/subhamxaura/apiguard/actions/workflows/test.yml/badge.svg)](./.github/workflows/test.yml)
[![Lint](https://github.com/subhamxaura/apiguard/actions/workflows/lint.yml/badge.svg)](./.github/workflows/lint.yml)

**API Guard** diffs two OpenAPI specs — a _baseline_ and a _current_ — and classifies every
difference as **breaking** (an existing conformant client will fail), **non-breaking but
notable**, or **informational**. It ships as a CLI, a TypeScript library, and a GitHub Action.

## Features

- **81 detection rules** across operations, parameters, request/response bodies, headers,
  schemas, security, callbacks, and webhooks — see the [generated rule reference](./docs/rules.md)
- **Semantic, not textual**: YAML formatting, key order, enum order, and `$ref` aliasing are
  never false positives; `nullable: true` (3.0) equals `type: ["string","null"]` (3.1)
- **Deterministic**: same inputs → byte-identical output, on any machine, any locale
- **Configurable**: per-rule severities, per-context overrides (`ruleId@context`), path/
  operation/schema/rule ignore lists in `apiguard.yaml`
- **Semver advice**: suggests major/minor/patch from the detected change kinds
- **Three output formats**: terminal (color), JSON (machine contract), markdown (PR-friendly)
- **GitHub Action**: merge-base baseline by default, PR summary, `fail-on` policy

## Quick start

```bash
pnpm add -D apiguard
apiguard init                    # scaffold apiguard.yaml
apiguard diff openapi.v1.yaml openapi.yaml
```

Example output:

```
ERROR  /users/{id}                       removed-method
       operation DELETE was removed; existing clients calling it will get 404s
       → keep the operation and mark it deprecated instead

2 breaking, 3 non-breaking, 12 info — suggest major
verdict: FAIL (exit 1)
```

## The GitHub Action (recommended)

```yaml
# .github/workflows/api-guard.yml
name: API Guard
on: [pull_request]
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 } # merge-base needs history
      - uses: apiguard/action@v1
        with:
          current: openapi.yaml # default; the PR's spec
          # baseline: omitted → the spec at the merge-base with origin/main
```

The Action posts a job summary table, emits `breaking` / `warnings` / `verdict` /
`suggested-version` outputs, and fails the step when breaking changes exist
(`fail-on: never` to only report). Full input/output reference:
[GitHub Action guide](./docs/github-action.md).

## CLI

```
apiguard diff <old-spec> <new-spec>    # the core command
apiguard validate <spec>               # load + semantic validation
apiguard init [dir]                    # scaffold a config
```

Useful `diff` flags: `--json`, `--markdown`, `--fail-on warning|never`, `--strict`,
`--include-non-breaking`, `--show-ignored`, `--suggest-version`, `--output <file>`,
`--quiet`, `--no-color`. Full flag semantics: [CLI guide](./docs/cli.md).

**Exit codes:** `0` pass · `1` changes met the fail-on policy · `2` usage/config error ·
`3` invalid spec · `4` internal error (please report).

## Library

```ts
import { analyze } from 'apiguard';

const { report, ignored } = await analyze('openapi.v1.yaml', 'openapi.yaml');
if (report.summary.bySeverity.error > 0) {
  console.log(report.semver.bump); // 'major' | 'minor' | 'patch' | 'none'
}
```

The engine is pure: no stdout, no process.exit, no timestamps in report bodies.
[Library guide](./docs/library.md).

## Configuration

```yaml
# apiguard.yaml
schemaVersion: 1
rules:
  property-removed: warning # downgrade a rule
  description-changed@operation: off # per-context override
ignore:
  paths: ['/internal/**']
  operations: ['GET /users']
  schemas: ['LegacyUser']
  changes: ['description-changed']
```

[Configuration guide](./docs/configuration.md) · [Ignoring changes](./docs/ignoring.md)

## How it works

1. **Load** — `@apidevtools/swagger-parser` behind a swappable `SpecLoader`; remote `$ref`s
   denied by default
2. **Normalize** — 3.0/3.1 unified: type arrays, nullable, exclusive bounds (§11.2)
3. **Index** — paths/methods/parameters/components, sorted
4. **Diff** — ref-aware pairwise schema comparison with cycle protection (10k-deep chains OK)
5. **Classify** — rules map facts → severities with per-context doctrine
6. **Report** — dedupe by stable id, deterministic sort, render

## Docs

- [Getting started](./docs/getting-started.md)
- [Configuration](./docs/configuration.md)
- [CLI reference](./docs/cli.md)
- [GitHub Action](./docs/github-action.md)
- [Ignoring changes](./docs/ignoring.md)
- [Rule reference (generated)](./docs/rules.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Milestone-by-milestone build decisions live in
[DECISIONS.md](./DECISIONS.md). Security issues: [SECURITY.md](./SECURITY.md) — do not open
public issues.

## License

[MIT](./LICENSE)
