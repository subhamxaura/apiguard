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
  demands a _subset_ of previously-required scopes (narrower = more permissive). Old `[read]` →
  new `[read, write]` is therefore `security-requirement-changed` (error), not a scope-added row.
- **Component diff diffs each schema once with strictest usage class** (2026-09-10): usage is
  scanned across request (send), response/parameters (parse), and webhooks (parse); parse wins
  ties; `usageCount` is stamped on component-context changes. Unreachable components are skipped.
- **Status note (3 lines):** engine complete: document/operation/schema/component/security
  rules, ignore engine, config loader with aliases, JSON reporter. 288 tests; coverage gate
  94.06% stmts / 96.7% lines / 96.68% funcs / 85.07% branches (all ≥ thresholds). Fixed 4 real
  engine bugs surfaced by the coverage push (parameter keying, doctrine wiring, compact crash,
  scope-satisfaction direction).

## M4 — Semver, Markdown, Docs Tooling

- **docs/rules.md is generated, with a parity test** (2026-09-10): the per-rule reference is
  emitted from the registry by `pnpm docs:rules`; a unit test fails CI if docs drift or a rule
  is added without regenerating (§23 registry-parity).
- **Perf gate is `pnpm bench` with generous CI budgets** (2026-09-10): 200-op × 40-prop diff
  ≤ 20s, 2000-property schema ≤ 15s, plus an id-sequence determinism check. Observed: ~0.7s and
  ~0.3s locally — budgets leave 20× headroom for shared runners.
- **Status note (3 lines):** semver advisor (§16), markdown reporter (§15.2), flag semantics
  (§13) all covered by tests from M3. Added docs:rules generator + parity test, bench perf
  gate. 293 tests, coverage 94.1/96.7/96.7/85.1 — all gates green.

## M5 — GitHub Action

- **Action bundle is CommonJS with a `.cjs` extension** (2026-09-11): the root package.json has
  `"type": "module"`, so an esbuild CJS bundle named `dist/index.js` crashed at import
  (`require is not defined in ES module scope`). Emitting `dist/index.cjs` and pointing
  `action.yml` at it fixes runtime without a package.json inside dist.
- **Baseline resolves via merge-base, input takes precedence** (2026-09-11): default
  `origin/main` merge-base answers "what changed relative to where this branch forked";
  explicit `baseline` input wins; a spec absent at the merge-base is a readable operator error
  ("newly added") instead of an empty diff.
- **Summary write is best-effort** (2026-09-11): `@actions/core` summary throws when
  `GITHUB_STEP_SUMMARY` is unset (local runs); the adapter downgrades to a warning so the
  verdict/outputs still emit.
- **ajv is bundled but inert** (2026-09-11): swagger-parser's `validate()` (the only ajv path)
  is never called by the loader; the `ajv/dist/runtime` requires in the bundle are never
  reached. Verified by running the built bundle e2e in a fixture repo.
- **Status note (3 lines):** action.yml (marketplace-ready, node20), git merge-base baseline
  resolver, deterministic PR-comment/summary renderer, esbuild bundle (`dist/index.cjs`),
  4-scenario bundle e2e + 9 unit tests. Self-test workflow dogfoods the Action on fixtures;
  lint + release workflows added. 302 unit tests green; bundle e2e green.

## M6 — Docs, Packaging, Release

- **CLI bin path fixed + shebang** (2026-09-11): `bin` pointed at `./dist/cli.js` but tsup
  emits `dist/cli/main.js` (npm bin would 404 on install). Added `#!/usr/bin/env node` and
  removed the dead `./cli` export (its d.ts was a 13-byte stub).
- **`--help` printed a spurious internal-error line** (2026-09-11): commander's
  `helpDisplayed` CommanderError reached `renderError`'s ApiguardError/internal fallback and
  rendered "unexpected internal error" after the help text. Commander errors now render as
  empty (help/version) or their usage message.
- **Docs are written, rules.md stays generated** (2026-09-11): README + 5 guides
  (getting-started, configuration, cli, github-action, ignoring, library) + CONTRIBUTING /
  CODE_OF_CONDUCT / SECURITY; the rule reference remains registry-generated with a parity
  test so it cannot drift.
- **Status note (3 lines):** full docs set, 4 CI workflows (test/lint/release/self-test),
  semantic-release config, npm pack audit clean (13 files, correct bin), CLI smoke-tested
  against fixtures (exit 1 breaking / 0 clean). 302 unit + 4 e2e tests green.

## M7 — Hardening & Final DoD

- **Determinism fuzz is a unit test** (2026-09-11): 20 seeded key-order shuffles + JSON-vs-YAML
  representation churn must produce identical change-id sequences; a same-input rerun must be
  byte-identical. Caught nothing new — the §5.1 invariants hold.
- **Registry wording helpers are directly unit-tested** (2026-09-11): fmt/sideLabel/
  whereLabel/nameOf had branches reachable only through specific emit shapes; direct template
  tests pin them (plus registry integrity: unique ids, getRule throws on unknown).
- **Duplicate YAML map keys are a hard config error** (2026-09-11): `yaml` rejects them at
  parse; documented as the fail-loud behavior instead of silent last-wins.
- **Status note (3 lines):** FINAL. 326 unit + 4 e2e tests; gates: lint ✓ format ✓ typecheck ✓
  coverage 94.28/85.54/96.5/96.53 (stmts/branches/funcs/lines) ✓ bench ALL PASS (300ms-668ms vs
  15-20s budgets) ✓ bundle e2e ✓ CLI smoke (exit 1 breaking / 0 clean) ✓ npm pack 13 files ✓.
  All milestones M0-M7 complete.
