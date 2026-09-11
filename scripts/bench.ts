/**
 * Perf gate (spec §21/§22): deterministic timing check for the engine on synthetic specs.
 * Tolerances are generous for CI (shared runners): warn-only lines print ratios, the gate
 * fails only when a hard budget (ms) is exceeded.
 * Run: pnpm bench
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyze } from '../src/core/engine/analyze.js';

function bigSpec(ops: number, props: number): string {
  const paths: string[] = [];
  for (let i = 0; i < ops; i++) {
    const lines: string[] = [];
    for (let j = 0; j < props; j++) {
      // 18 spaces: two levels under properties: (16) — must be DEEPER than the parent key
      lines.push(`                  f${j}: {type: string, maxLength: ${100 + j}}`);
    }
    paths.push(
      `  /res${i}:\n    get:\n      operationId: get${i}\n      responses:\n        '200':\n          description: OK\n          content:\n            application/json:\n              schema:\n                type: object\n                properties:\n` +
        lines.join('\n'),
    );
  }
  return (
    `openapi: 3.0.3\ninfo: {title: Bench, version: '1.0'}\npaths:\n` +
    paths.join('\n') +
    `\ncomponents:\n  schemas:\n    Blob:\n      type: object\n      properties:\n` +
    Array.from({ length: props }, (_, j) => `        p${j}: {type: string}`).join('\n')
  );
}

/** Tighten every Nth maxLength to create breaking changes deterministically. */
function mutate(text: string, everyNth: number): string {
  let counter = 0;
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(/maxLength: (\d+)\}/);
      if (m) {
        counter++;
        if (counter % everyNth === 0) return line.replace(/maxLength: (\d+)\}/, 'maxLength: 5}');
      }
      return line;
    })
    .join('\n');
}

async function time(label: string, budgetMs: number, fn: () => Promise<unknown>): Promise<boolean> {
  const t0 = performance.now();
  await fn();
  const dt = performance.now() - t0;
  const ok = dt <= budgetMs;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${dt.toFixed(0)}ms (budget ${budgetMs}ms)`);
  return ok;
}

async function main(): Promise<void> {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-bench-'));
  const base = bigSpec(200, 40);
  const cur = mutate(base, 7);
  const a = path.join(d, 'a.yaml');
  const b = path.join(d, 'b.yaml');
  fs.writeFileSync(a, base);
  fs.writeFileSync(b, cur);

  // warm-up (JIT + fs cache) — not counted
  await analyze(a, b, {});

  const results: boolean[] = [];
  let changeCount = 0;
  results.push(
    await time('diff 200 operations × 40 properties', 20_000, async () => {
      const { report } = await analyze(a, b, {});
      changeCount = report.changes.length;
      if (changeCount === 0) throw new Error('bench produced no changes');
    }),
  );
  console.log(`      (${changeCount} changes detected)`);

  // determinism: same inputs → identical change-id sequence
  const r1 = await analyze(a, b, {});
  const r2 = await analyze(a, b, {});
  const ids1 = r1.report.changes.map((c) => c.id).join(',');
  const ids2 = r2.report.changes.map((c) => c.id).join(',');
  console.log(`${ids1 === ids2 ? 'PASS' : 'FAIL'}  determinism (id sequence identical)`);
  results.push(ids1 === ids2);

  // single huge schema: 2000 properties, one type change
  const many = Array.from({ length: 2000 }, (_, j) => `                q${j}: {type: string}`).join(
    '\n',
  );
  const huge = `openapi: 3.0.3\ninfo: {title: H, version: '1.0'}\npaths:\n  /h:\n    get:\n      responses:\n        '200':\n          description: OK\n          content:\n            application/json:\n              schema:\n                type: object\n                properties:\n${many}\n`;
  const hugeA = path.join(d, 'huge-a.yaml');
  const hugeB = path.join(d, 'huge-b.yaml');
  fs.writeFileSync(hugeA, huge);
  fs.writeFileSync(hugeB, huge.replace('q1999: {type: string}', 'q1999: {type: number}'));
  results.push(
    await time('diff single 2000-property schema', 15_000, async () => {
      await analyze(hugeA, hugeB, {});
    }),
  );

  fs.rmSync(d, { recursive: true, force: true });

  const failed = results.filter((r) => !r).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} BUDGET(S) EXCEEDED`}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
