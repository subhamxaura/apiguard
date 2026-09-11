/**
 * Baseline resolution (spec §19): explicit input takes precedence; otherwise the merge-base
 * of the current HEAD and the base branch — "what changed relative to where this forked".
 * Deterministic: same repo state → same commit.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface BaselineResolution {
  /** Absolute path to the resolved baseline spec file. */
  path: string;
  /** How it was resolved — surfaced in the Action summary. */
  via: 'input' | 'merge-base';
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** `true` when the path exists in the given git revision. */
function hasFile(cwd: string, rev: string, file: string): boolean {
  try {
    const out = git(cwd, ['ls-tree', '--name-only', '-z', rev, '--', file]);
    return out.length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve the baseline spec:
 * 1. explicit `baseline` input → use as-is (must exist on disk);
 * 2. otherwise merge-base of HEAD and `base` (default `origin/main`) must contain the file.
 * Throws a plain Error with an operator-readable message; the entry maps it to a failed step.
 */
export function resolveBaseline(opts: {
  baseline?: string;
  current: string;
  base?: string;
  cwd?: string;
}): BaselineResolution {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.baseline) {
    const p = path.resolve(cwd, opts.baseline);
    if (!fs.existsSync(p)) {
      throw new Error(`baseline input "${opts.baseline}" does not exist`);
    }
    return { path: p, via: 'input' };
  }

  const base = opts.base || 'origin/main';
  let mergeBase: string;
  try {
    mergeBase = git(cwd, ['merge-base', 'HEAD', base]);
  } catch {
    throw new Error(
      `could not compute merge-base of HEAD and "${base}". ` +
        `Ensure the action is run on a pull_request event or set the "baseline" input.`,
    );
  }
  // Current spec path, relative to the repo root, must exist at the merge-base commit.
  const repoRoot = git(cwd, ['rev-parse', '--show-toplevel']);
  const rel = path.relative(repoRoot, path.resolve(cwd, opts.current)).split(path.sep).join('/');
  if (!hasFile(repoRoot, mergeBase, rel)) {
    throw new Error(
      `"${rel}" does not exist at merge-base ${mergeBase.slice(0, 12)} — ` +
        `the spec appears to be newly added. Set the "baseline" input to compare explicitly.`,
    );
  }
  // Materialize the baseline blob to a temp file (content-addressed name → deterministic).
  const blob = git(repoRoot, ['show', `${mergeBase}:${rel}`]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-baseline-'));
  const out = path.join(dir, path.basename(rel));
  fs.writeFileSync(out, blob, 'utf8');
  return { path: out, via: 'merge-base' };
}
