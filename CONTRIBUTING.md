# Contributing to API Guard

Thanks for helping keep API contracts intact. This guide covers the essentials; design
decisions and their reasons live in [DECISIONS.md](./DECISIONS.md).

## Development

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test   # the milestone gate
pnpm coverage                              # 90/90/90 lines, 85 branches thresholds
pnpm test:e2e                              # CLI + Action bundle e2e
pnpm bench                                 # perf gate (~1s locally, generous CI budgets)
pnpm docs:rules                            # regenerate docs/rules.md from the registry
```

Node ≥ 20; pnpm is pinned via the `packageManager` field (corepack or `npm i -g pnpm`).

## How to add a rule

1. Add the `RuleDefinition` to `src/core/rules/rule-registry.ts` — id, default severity/kind,
   contexts, trigger sentence, message/suggestion templates.
2. Emit the fact from `src/core/engine/differ.ts` (or `schema-differ.ts`).
3. If the severity is context-dependent, wire the doctrine in `classify.ts` — never in the
   reporter.
4. Run `pnpm docs:rules` — the parity test fails CI if you forget.
5. Add a unit test that runs `analyze()` over a fixture pair and asserts the rule id + severity.

## Rules of the codebase

- **Determinism first**: no unsorted key iteration, no timestamps in report bodies, no
  locale-dependent formatting. Same inputs → byte-identical output.
- **Layered purity**: `core/` never imports `cli/`, `reporters/`, or `github/` — enforced by
  ESLint `no-restricted-imports`.
- **No rule fires twice for one fact**: dedupe is by stable change id; don't emit near-
  duplicates with slightly different messages.
- **Fail loud**: never swallow an error into a report row. Internal errors exit 4.
- **Boring code wins**: prefer explicit branches over clever folds; no `any` escapes.

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore(scope):`) — semantic-release
derives versions and changelog entries from them. A breaking-change PR should include fixture
updates demonstrating the detected change.

## PR checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green
- [ ] `pnpm test:e2e` green (if CLI/Action touched)
- [ ] New rule → registry entry + fixture test + `docs/rules.md` regenerated
- [ ] Behavior change → `DECISIONS.md` entry (one line: decision + reason + date)
- [ ] No new `any`, no unsorted iteration, no stdout writes from `core/`
