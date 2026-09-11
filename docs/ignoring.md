# Ignoring changes

Suppress known/accepted changes so real drift stays visible. Ignoring is config-driven and
auditable — every suppression can be shown with `--show-ignored` (tagged `ignored`), and the
JSON report counts them under `summary.ignored`.

## The four ignore lists

```yaml
ignore:
  paths: # spec path globs (micromatch)
    - '/internal/**'
    - '/**/beta/*'
  operations: # "METHOD /path" entries
    - 'GET /users/search'
    - 'POST /orders'
  schemas: # component schema names
    - 'LegacyUser'
    - 'Internal*'
  changes: # rule ids — suppress a rule everywhere
    - 'description-changed'
    - 'property-removed@LegacyUser' # NOT supported: changes entries are rule ids only
```

Semantics:

- **paths** match the JSON-pointer-ish spec path of a change's location (`/users/{id}`)
- **operations** match `METHOD /path` for operation-level changes
- **schemas** match component schema names for component-context changes
- **changes** match the rule id — the bluntest instrument; prefer scoped lists first

A change is suppressed when _any_ list matches. `pnpm apiguard diff --show-ignored` prints
suppressed rows inline so reviewers can audit what was hidden.

## Ignore vs. severity `off`

|                  | `rules: { id: off }` | `ignore.changes: [id]`                   |
| ---------------- | -------------------- | ---------------------------------------- |
| Emits            | never                | suppressed, counted in `summary.ignored` |
| `--show-ignored` | no                   | yes, tagged                              |
| Scope            | everywhere           | scoped by the other lists                |

Rule of thumb: `off` for "this rule doesn't fit our API"; ignore lists for "this exact spot
is accepted debt".

## Recipe: legacy endpoints

```yaml
ignore:
  paths: ['/v1/**'] # frozen v1: changes are expected and accepted
```

## Recipe: calm the docs noise

```yaml
rules:
  description-changed: info
ignore:
  changes: [description-changed, title-changed, contact-changed]
```
