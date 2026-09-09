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
