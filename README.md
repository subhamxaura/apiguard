# API Guard

> Production-grade OpenAPI breaking-change detection for CI/CD.

[![Test](https://github.com/subhamxaura/apiguard/actions/workflows/test.yml/badge.svg)](./.github/workflows/test.yml)
[![Release](https://github.com/subhamxaura/apiguard/actions/workflows/release.yml/badge.svg)](./.github/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/@subhamxcod/apiguard.svg)](https://www.npmjs.com/package/@subhamxcod/apiguard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**API Guard** diffs two OpenAPI specifications — a _baseline_ and a _current_ — and classifies
every difference as **breaking** (an existing conformant client will fail), **non-breaking but
notable**, or **informational**. It ships as a CLI, a TypeScript library, and a GitHub Action.

## Why API Guard?

APIs evolve, and small spec changes can silently break the consumers that depend on them:
frontend applications, generated SDKs, partner integrations, and downstream services. A removed
response field or a changed property type doesn't fail your build — it fails your users, in
production, at runtime.

API Guard moves that failure left. It compares your OpenAPI documents **semantically** — not
textually — and reports every change that would break an existing client, before the code ships:

```
old spec  +  new spec  →  API Guard  →  breaking changes (or a clean pass)
```

## Features

- **81 detection rules** across operations, parameters, request/response bodies, headers,
  schemas, security, callbacks, and webhooks — see the [generated rule reference](./docs/rules.md)
- **OpenAPI 3.0 and 3.1** — unified normalization: `nullable: true` (3.0) equals
  `type: ["string", "null"]` (3.1)
- **Semantic, not textual** — YAML formatting, key order, enum order, and `$ref` aliasing are
  never false positives
- **Deterministic** — same inputs produce byte-identical output, on any machine, any locale
- **Configurable** — per-rule severities, per-context overrides (`ruleId@context`), and
  path/operation/schema/rule ignore lists in `apiguard.yaml`
- **Semver advice** — suggests major/minor/patch from the detected change kinds
- **Three output formats** — terminal (color), JSON (machine contract), markdown (PR-friendly)
- **GitHub Action** — merge-base baseline by default, PR job summary, `fail-on` policy
- **TypeScript library** — typed, pure API for embedding in your own tooling

## Quick start

```bash
npm install --save-dev @subhamxcod/apiguard
# or: pnpm add -D @subhamxcod/apiguard
# or: yarn add -D @subhamxcod/apiguard

apiguard init . --examples                  # scaffold apiguard.yaml + two sample specs
apiguard diff examples/baseline.yaml examples/current.yaml
```

Or run it directly without installing:

```bash
npx @subhamxcod/apiguard diff old.yaml new.yaml
```

## What gets detected

Remove a required response property between two releases:

```yaml
# before                              # after
responses:                            responses:
  '200':                                '200':
    content:                              content:
      application/json:                     application/json:
        schema:                               schema:
          type: object                          type: object
          required: [id, name, email]           required: [id, name]
          properties:                           properties:
            id: { type: string }                  id: { type: string }
            name: { type: string }                name: { type: string }
            email: { type: string }
```

Running `apiguard diff old.yaml new.yaml` exits non-zero and prints:

```text
GET /users/{id}
  ERROR Response property `email` was removed
  Suggestion: stop relying on `email`; it will no longer be returned
❌ Breaking API changes found

Suggested version bump: MAJOR
```

The `property-removed` rule fired for the response body; removals are resolved per the §10.5
context table (request/response/parameter/component), so the same rule can downgrade to a
warning where the context allows it. The full catalog of 81 rules with severities and trigger
conditions lives in the [rule reference](./docs/rules.md).

## CLI

### `apiguard diff <old-spec> <new-spec>`

Diff two OpenAPI specs and report breaking changes. This is the core command.

| Flag                     | Effect                                                   |
| ------------------------ | -------------------------------------------------------- |
| `--json`, `--markdown`   | Output format (default: colorized terminal)              |
| `--fail-on <level>`      | `error` (default) \| `warning` \| `never`                |
| `--strict`               | Shorthand for `--fail-on warning --include-non-breaking` |
| `--include-non-breaking` | Also render warning + info changes                       |
| `--show-ignored`         | Show changes suppressed by ignore rules, tagged          |
| `--suggest-version`      | Print the suggested semver bump after the report         |
| `--config <path>`        | Explicit config file (missing file: exit 2)              |
| `--output <path>`        | Also write the full report to a file                     |
| `--quiet`                | Print only the one-line verdict                          |
| `--no-color`             | Disable ANSI color (auto-detected for non-TTY)           |
| `--verbose`              | Log parse/config steps to stderr                         |

**Exit codes:** `0` pass · `1` changes met the fail-on policy · `2` usage/config error ·
`3` invalid spec · `4` internal error (please report).

Machine contract: `--json` emits a versioned report (`schemaVersion: "1.0"`) with
`summary.bySeverity`, per-change `ruleId`/`severity`/`kind`, and stable change ids.

### `apiguard validate <spec>`

Load and semantically validate one spec. `--strict` exits 1 when semantic warnings exist.

### `apiguard init [dir]`

Scaffold an `apiguard.yaml` config template. `--examples` also writes two sample specs for a
first diff run; `--force` overwrites existing files.

Full reference: [CLI guide](./docs/cli.md).

## GitHub Action

The Action wraps the same engine for pull requests: it resolves the baseline automatically from
the merge-base with your default branch, posts the report as a job summary, and fails the step
when breaking changes exist.

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
      - uses: subhamxaura/apiguard@v1 # tracks the latest v1.x release
        with:
          current: openapi.yaml # the PR's spec
          # baseline: omitted → the spec at the merge-base with origin/main
```

The Action emits `breaking`, `warnings`, `verdict`, and `suggested-version` outputs, and writes
a deterministic job summary. To report without blocking (e.g. during a migration), set
`fail-on: never` and branch on the outputs. Full input/output reference:
[GitHub Action guide](./docs/github-action.md).

## TypeScript library

```ts
import { analyze } from '@subhamxcod/apiguard';

const { report, ignored } = await analyze('openapi.v1.yaml', 'openapi.yaml');
if (report.summary.bySeverity.error > 0) {
  console.log(report.semver.bump); // 'major' | 'minor' | 'patch' | 'none'
}
```

The library also exports `suggestVersion` for standalone semver advice and `validateSpec` for
load + semantic validation. The engine is pure: no stdout, no `process.exit`, no timestamps in
report bodies. [Library guide](./docs/library.md).

## Configuration

API Guard reads `apiguard.yaml` (discovered from the working directory, or passed with
`--config` / the `APIGUARD_CONFIG` environment variable):

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

## OpenAPI support

| Version | Status          |
| ------- | --------------- |
| 3.0.x   | ✅ Full support |
| 3.1.x   | ✅ Full support |

Documents are normalized into one internal model before diffing, so 3.0 and 3.1 idioms compare
correctly: type arrays vs `nullable`, exclusive bounds, and `$ref` aliasing. Remote `$ref`
fetching is **denied by default** (pass an explicit loader option to allow it) so untrusted
specs cannot trigger network access. Swagger 2.0 documents are not supported.

## CI/CD

The intended workflow — run API Guard on every pull request that touches your API:

```text
OpenAPI change → API Guard (merge-base diff) → breaking changes?
   ├─ none        → CI passes, merge with confidence
   └─ breaking    → step fails, changes are blocked before release
```

1. Add the [GitHub Action](#github-action) to your PR workflow, **or** run the CLI in any CI:
   `apiguard diff "$BASELINE" "$CURRENT" --fail-on error`
2. If you ship an SDK, gate version bumps on `--suggest-version` output
3. Encode your team's policy in `apiguard.yaml` (downgrades, ignores) and commit it

## Docs

- [Getting started](./docs/getting-started.md)
- [CLI reference](./docs/cli.md)
- [Configuration](./docs/configuration.md)
- [Ignoring changes](./docs/ignoring.md)
- [Rule reference (81 rules, generated)](./docs/rules.md)
- [GitHub Action](./docs/github-action.md)
- [Library API](./docs/library.md)
- [Changelog](./CHANGELOG.md)

## Development

Requires Node ≥ 20. pnpm is pinned via the `packageManager` field (use corepack).

```bash
pnpm install        # install dependencies
pnpm test           # unit tests (vitest)
pnpm test:e2e       # CLI + Action bundle e2e tests
pnpm coverage       # coverage with 90/90/90 lines, 85 branches thresholds
pnpm lint           # eslint
pnpm format:check   # prettier
pnpm typecheck      # tsc --noEmit
pnpm build          # tsup (ESM + CJS + dts)
pnpm build:action   # esbuild bundle for the GitHub Action
pnpm docs:rules     # regenerate docs/rules.md from the rule registry
```

Rule parity is enforced: if you add a rule and forget `pnpm docs:rules`, CI fails.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow, the
milestone gate (`lint && typecheck && test`), and how to add a rule. Design decisions and their
reasons live in [DECISIONS.md](./DECISIONS.md). Please note the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

API Guard processes untrusted spec files; its threat model is documented in
[SECURITY.md](./SECURITY.md). Please report vulnerabilities through GitHub's private
vulnerability reporting — do not open public issues.

## License

[MIT](./LICENSE) © API Guard contributors

---

**Catch breaking OpenAPI changes before they reach production.**
