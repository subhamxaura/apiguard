# Security Policy

## Supported versions

| Version        | Supported    |
| -------------- | ------------ |
| latest release | ✅           |
| older releases | ❌ (upgrade) |

## Reporting a vulnerability

Do **not** open a public issue for security problems.

Use GitHub's **Private vulnerability reporting** (Security tab → Report a vulnerability) for
this repository. Include: affected version/commit, a minimal spec pair reproducing the issue,
and expected vs. actual behavior.

You can expect a first response within 7 days. We will keep you informed of the fix timeline
and credit you in the release notes unless you prefer otherwise.

## Scope notes

API Guard processes untrusted spec files. Threat model notes for reporters:

- Specs are parsed with `yaml` + `@apidevtools/swagger-parser`; remote `$ref` fetching is
  **denied by default** (opt-in via `loader.allowRemoteRefs`).
- The tool never executes code from specs, never mutates input files, and makes no network
  requests unless remote refs are explicitly allowed.
- The GitHub Action runs with the workflow's `GITHUB_TOKEN` only if you pass it; the default
  configuration makes no API calls.
