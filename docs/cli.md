# CLI reference

```
apiguard <command> [options]
```

Global: `-V, --version`, `-h, --help`. Help goes to stdout with exit 0; usage errors exit 2.

## `apiguard diff <old-spec> <new-spec>`

Diff a baseline spec against a current spec. This is the core command.

| Flag                     | Meaning                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `--format <f>`           | `terminal` (default), `json`, `markdown`                                         |
| `--json`, `--markdown`   | shorthands for `--format json                                                    | markdown` |
| `--config <path>`        | explicit config file; a missing file is a usage error (exit 2)                   |
| `--fail-on <level>`      | `error` (default), `warning`, `never` — which severities turn the exit code to 1 |
| `--strict`               | shorthand for `--fail-on warning --include-non-breaking`                         |
| `--quiet`                | only the one-line verdict                                                        |
| `--suggest-version`      | print the semver suggestion after the report                                     |
| `--include-non-breaking` | render warning+info changes too (terminal format shows errors by default)        |
| `--output <path>`        | additionally write the full report (always JSON contract) to a file              |
| `--no-color`             | disable ANSI color; auto-disabled for non-TTY                                    |
| `--show-ignored`         | render changes suppressed by ignore rules, tagged `ignored`                      |
| `--verbose`              | log parse/config steps to stderr                                                 |

**Exit codes:** `0` pass · `1` fail-on policy met · `2` usage/config error · `3` invalid spec
(parse, missing file, disallowed remote ref) · `4` internal error (please report).

### JSON output

`--json` prints the machine contract (schemaVersion 1.0): tool block, per-side spec metadata
with sha256, summary counts, and the fully sorted change list. No timestamps — byte-identical
across runs. `report.semver` carries the bump advice:

```json
{
  "summary": { "total": 4, "bySeverity": { "error": 1, "warning": 2, "info": 1 } },
  "semver": { "bump": "major", "reason": "1 breaking rule", "triggers": ["removed-method"] }
}
```

## `apiguard validate <spec>`

Load and semantically validate one spec: parser-level validation plus structural checks
(unresolvable local refs, missing operation responses, duplicate parameter names, nonexistent
`default`/`'4xx'` response targets). Exit `0` clean, `3` structural problems, `1` with
`--strict` when semantic warnings exist.

## `apiguard init [dir]`

Scaffold `apiguard.yaml` (every rule at its default severity) plus `.apiguardignore` docs
pointer. `--examples` also writes `specs/baseline.yaml` and `specs/current.yaml` for a first
diff run; `--force` overwrites existing files.

## Composability

The CLI never mutates your spec files. Everything the CLI prints is derivable from the JSON
contract — prefer `--output report.json` in CI and render from that.
