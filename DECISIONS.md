# DECISIONS.md

Every non-obvious decision, its reason, and date. Newest entries last per milestone.

## M0 — Scaffold

- **pnpm via npm global prefix** (2026-09-09): corepack activation failed with EPERM writing to
  `C:\Program Files\nodejs`; installed pnpm 12.3.4 through npm's user-writable global prefix
  instead. `packageManager` field pins pnpm@12.3.4.
- **Dependency ranges use caret; CI installs with `--frozen-lockfile`** so the committed lockfile
  is the exact-version contract (spec: pin exact versions at install time).
- **Prettier: single quotes, 100 cols, LF endings** — avoids churn on Windows checkouts; CI and
  the git `* text=auto` attribute keep LF.
- **Vitest 4 + `@vitest/coverage-v8`** chosen over jest for zero-config ESM and native TS
  support; matches spec §6.
- **`exactOptionalPropertyTypes: false`** per spec §6, keeping change-building code simpler when
  optional location fields are set conditionally.
- **Action bundle via esbuild `--minify`** into a committed `dist/index.js` (self-contained, no
  node_modules); library build via tsup dual ESM+CJS.
- **Status note (3 lines):** scaffold complete. Strict TS + flat ESLint with core-purity
  `no-restricted-imports` enforcement. Empty passing suite wired with coverage thresholds.

## M3 — Engine, Rules, Config (coverage gate)

- **Parameter matching is by name only** (2026-09-10): the diff previously keyed parameters by
  `name::in`, making `parameter-location-changed` unreachable (an `in` change looked like
  removal+addition). Matching by name surfaces the §10.3 location-change rule; same-name
  duplicates in one list keep their first occurrence (deterministic).
- **`removed-parameter` / `request-body-removed` doctrine wired into classify** (2026-09-10):
  the registry documents "error when required (or header/path)" but classify never applied the
  emitter's `wasRequired` doctrine; both rules now resolve through `resolveContextSeverity`.
- **compact() no longer produces invalid JSON** (2026-09-10): blind `json.slice(0,77) + '…"'`
  crashed `JSON.parse` on any object value longer than 80 chars (real crash path from a large
  default). Truncation now emits a string marker `…` suffix instead of re-parsing.
- **`satisfiesAny` semantics** (2026-09-10): new requirement satisfies old credentials when it
  demands a *subset* of previously-required scopes (narrower = more permissive). Old `[read]` →
  new `[read, write]` is therefore `security-requirement-changed` (error), not a scope-added row.
- **Component diff diffs each schema once with strictest usage class** (2026-09-10): usage is
  scanned across request (send), response/parameters (parse), and webhooks (parse); parse wins
  ties; `usageCount` is stamped on component-context changes. Unreachable components are skipped.
- **Status note (3 lines):** engine complete: document/operation/schema/component/security
  rules, ignore engine, config loader with aliases, JSON reporter. 288 tests; coverage gate
  94.06% stmts / 96.7% lines / 96.68% funcs / 85.07% branches (all ≥ thresholds). Fixed 4 real
  engine bugs surfaced by the coverage push (parameter keying, doctrine wiring, compact crash,
  scope-satisfaction direction).
