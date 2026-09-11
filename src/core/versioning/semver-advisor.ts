/** Semver advisor per spec §16 — pure function over the change set. */
import type { ApiChange, SemverAdvice } from '../models/change.js';

/**
 * Decision table (§16):
 * 1. any error → major (reason lists top ruleIds by count)
 * 2. else any addition|removal|modification OR any warning → minor
 * 3. else any relaxation|documentation info → patch
 * 4. else none
 */
export function suggestVersion(changes: ApiChange[]): SemverAdvice {
  const errors = changes.filter((c) => c.severity === 'error');
  if (errors.length > 0) {
    const counts = new Map<string, number>();
    for (const c of errors) counts.set(c.ruleId, (counts.get(c.ruleId) ?? 0) + 1);
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([id, n]) => `${id}(${n})`);
    return {
      bump: 'major',
      reason: `${errors.length} breaking change(s); driven by ${top.join(', ')}`,
      triggers: [...new Set(errors.map((c) => c.ruleId))].sort(),
    };
  }

  const minorish = changes.filter(
    (c) =>
      c.severity === 'warning' ||
      c.kind === 'addition' ||
      c.kind === 'removal' ||
      c.kind === 'modification',
  );
  if (minorish.length > 0) {
    const triggers = [...new Set(minorish.map((c) => c.ruleId))].sort();
    return {
      bump: 'minor',
      reason: `${minorish.length} non-breaking functional change(s) (additions/modifications/warnings)`,
      triggers,
    };
  }

  const patchish = changes.filter((c) => c.kind === 'relaxation' || c.kind === 'documentation');
  if (patchish.length > 0) {
    const triggers = [...new Set(patchish.map((c) => c.ruleId))].sort();
    return {
      bump: 'patch',
      reason: `${patchish.length} documentation/relaxation change(s)`,
      triggers,
    };
  }

  return { bump: 'none', reason: 'no changes', triggers: [] };
}
