<!--
  Before opening: search existing PRs to avoid duplicates.
  Keep the diff focused — one logical change per PR.
-->

## Summary

<!-- What does this PR change and why? One or two sentences. -->

## Type of change

- [ ] `fix:` bug fix (patch release)
- [ ] `feat:` new feature (minor release)
- [ ] `docs:` / `chore:` / `refactor:` / `test:` no release
- [ ] `perf:` performance improvement

## Checklist

- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) — semantic-release derives versions from them
- [ ] `pnpm lint && pnpm typecheck && pnpm test` passes (the milestone gate)
- [ ] `pnpm test:e2e` passes if CLI or Action behavior changed
- [ ] `pnpm docs:rules` run if a rule was added or changed (`docs/rules.md` is generated — do not edit by hand)
- [ ] Determinism preserved: no unsorted iteration, no timestamps in report bodies, no locale-dependent formatting
- [ ] Layered purity respected: nothing in `core/` imports `cli/`, `reporters/`, or `github/`
