# GitHub Action

The Action wraps the same engine as the CLI for pull-request workflows:
it resolves a baseline automatically, posts the report as a job summary, and applies your
fail policy to the step.

It lives in this repository (`action.yml` + the committed `dist/index.cjs` bundle) and is
consumed directly from release tags, e.g. `subhamxaura/apiguard@v1.0.3` — pin the latest
release tag from the [releases page](https://github.com/subhamxaura/apiguard/releases).

## Minimal setup

```yaml
# .github/workflows/api-guard.yml
name: API Guard
on: [pull_request]
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 } # full history: merge-base needs it
      - uses: subhamxaura/apiguard@v1.0.3 # pin the latest release tag
        with:
          current: openapi.yaml
```

## Baseline resolution

1. **`baseline` input set** → that file, as-is.
2. **Otherwise** → the spec at the merge-base of `HEAD` and `base` (default `origin/main`):
   "what changed relative to where this branch forked", including upstream drift.

If the current spec doesn't exist at the merge-base (newly added spec), the Action fails with
a readable message — pass an explicit `baseline` for that case.

## Inputs

| Input           | Default        | Meaning                                                     |
| --------------- | -------------- | ----------------------------------------------------------- |
| `current`       | `openapi.yaml` | The PR's spec path                                          |
| `baseline`      | merge-base     | Explicit baseline spec path                                 |
| `base`          | `origin/main`  | Ref for merge-base resolution                               |
| `fail-on`       | `error`        | `error` or `never` — whether breaking changes fail the step |
| `config`        | –              | Path to `apiguard.yaml` (rules + ignores)                   |
| `comment-pr`    | `false`        | Post the report as a PR comment (needs `token`)             |
| `token`         | –              | `github.token` when `comment-pr: true`                      |
| `markdown-file` | –              | Also write the markdown report to this path                 |

## Outputs

| Output              | Meaning                                             |
| ------------------- | --------------------------------------------------- |
| `breaking`          | Number of error-severity changes                    |
| `warnings`          | Number of warning-severity changes                  |
| `verdict`           | `fail` or `pass` under the fail-on policy           |
| `suggested-version` | e.g. `major (3 breaking rules)` or `no bump needed` |

## Job summary

Every run writes a markdown summary (visible on the workflow run page): counts, suggested
version, baseline resolution method, and a per-change table with rule id and location.
Rendering is deterministic — the same diff produces the same summary text.

## Gating merges

The step fails when `verdict` is `fail` (breaking changes under `fail-on: error`). To report
without blocking — e.g. during a migration — set `fail-on: never` and branch on the output:

```yaml
- uses: subhamxaura/apiguard@v1.0.3 # pin the latest release tag
  id: guard
  with: { fail-on: never, current: openapi.yaml }
- run: echo "breaking=${{ steps.guard.outputs.breaking }}"
```

## Self-test

The repo's own CI dogfoods the Action ([self-test workflow](../.github/workflows/self-test.yml)):
it builds the bundle and asserts the Action correctly fails on a fixture that removes an
endpoint.
