# Getting started

## 1. Install

```bash
pnpm add -D apiguard        # CLI + library
```

Requires Node.js ≥ 20.

## 2. Scaffold a config (optional but recommended)

```bash
apiguard init
apiguard init --examples    # also writes two sample specs for a first diff run
```

This writes an `apiguard.yaml` with every rule set to its default severity, ready to
selectively tune. Without a config file, API Guard uses the same defaults.

## 3. Run your first diff

```bash
apiguard diff baseline.yaml current.yaml
```

Output (terminal format):

```
ERROR  /users/{id}                    removed-method
       ...

1 breaking, 1 non-breaking, 3 info
verdict: FAIL (exit 1)
```

- **ERROR (breaking)** — an existing, spec-conformant client will fail
- **WARN (non-breaking)** — contract works but clients may need updates
- **INFO** — additive or cosmetic

The diff exits `1` when any breaking change exists (tune with `--fail-on`).

## 4. Pick your workflow

| You are... | Use |
|---|---|
| A repo with an API spec in git | The [GitHub Action](github-action.md) — baseline is automatic |
| A CI without GitHub | The CLI: keep the last-released spec as `baseline.yaml` and diff against it |
| An SDK/codegen maintainer | The [library](library.md) — gate publishes on `report.semver.bump` |

## 5. Tune noise

Start with defaults; when a rule is too loud for your API, change its severity or ignore
targeted spots — see [configuration](configuration.md) and [ignoring](ignoring.md).

```bash
apiguard validate current.yaml   # sanity-check a spec in isolation
```
