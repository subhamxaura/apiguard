/** JSON reporter per spec §15.1: field order fixed as declared in §8; no timestamps. */
import type { DiffReport } from '../core/models/report.js';

/**
 * Serialize with declared key order (JSON.stringify preserves insertion order; the report
 * object is built in §8 field order). Deterministic: same input → byte-identical output.
 */
export function renderJson(report: DiffReport): string {
  return JSON.stringify(report, null, 2);
}
