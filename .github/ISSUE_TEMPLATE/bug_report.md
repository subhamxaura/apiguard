---
name: Bug report
about: API Guard produced a wrong verdict, crash, or non-deterministic output
labels: bug
---

## What happened?

<!-- A clear description of the wrong behavior. -->

## Command and environment

```bash
# The exact command you ran, e.g.:
apiguard diff baseline.yaml current.yaml --json
```

- API Guard version: <!-- output of `apiguard --version` or the Action tag -->
- Node version: <!-- output of `node --version` -->
- OpenAPI version of the specs: <!-- 3.0.x / 3.1.x -->

## Reproduction

<!-- Attach minimal before/after spec pair that triggers the issue. Remove any
     proprietary details first — specs are treated as untrusted input, but do not
     paste secrets. If the bug is non-deterministic output, say so explicitly. -->

<details>
<summary>Spec pair</summary>

```yaml
# baseline.yaml
```

```yaml
# current.yaml
```

</details>

## Expected behavior

<!-- What should have been reported (or not reported), including the expected rule id and severity if relevant. -->

## Actual output

```text
# Paste the actual output. For --json output, prefer attaching the file.
```
