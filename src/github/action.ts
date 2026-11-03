/**
 * GitHub Action adapter (spec §19). Thin wrapper: inputs → config → analyze() → outputs.
 * Rendering lives in comment.ts; baseline resolution in baseline.ts. Never calls
 * process.exit — the entry maps the returned verdict to the step outcome.
 */
import * as core from '@actions/core';
import * as github from '@actions/github';
import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedConfig } from '../core/config/schema.js';
import type { DiffReport } from '../core/models/report.js';
import { analyze } from '../core/engine/analyze.js';
import { DEFAULT_CONFIG, loadConfigFrom } from '../core/config/index.js';
import { resolveBaseline } from './baseline.js';
import { renderComment, type ActionOutcome } from './comment.js';
import { errorMessage } from '../utils/errors.js';

export interface RunOptions {
  /** Injected for tests; defaults to the real @actions/core. */
  core?: typeof core;
  cwd?: string;
}

export interface RunResult {
  outcome: ActionOutcome;
  commentBody: string;
  report?: DiffReport;
}

/** Read Action inputs through the injected (or real) core adapter. */
export function readInputs(c: typeof core = core): {
  baseline?: string;
  current: string;
  base: string;
  failOn: 'error' | 'never';
  config?: string;
  token?: string;
  comment: boolean;
} {
  const baseline = c.getInput('baseline');
  const current = c.getInput('current') || 'openapi.yaml';
  const base = c.getInput('base') || 'origin/main';
  const failOnInput = c.getInput('fail-on') || 'error';
  const failOn = failOnInput === 'never' ? 'never' : 'error';
  const config = c.getInput('config') || undefined;
  const token = c.getInput('token') || undefined;
  const comment = (c.getInput('comment-pr') || 'false') === 'true';
  return {
    baseline: baseline || undefined,
    current,
    base,
    failOn,
    config,
    token,
    comment,
  };
}

/**
 * Run the Action end-to-end and return the outcome + rendered comment.
 * Throws on operator errors (bad inputs, unresolvable baseline) — the entry catches.
 */
export async function runAction(opts: RunOptions = {}): Promise<RunResult> {
  const c = opts.core ?? core;
  const inputs = readInputs(c);

  const cwd = opts.cwd ?? process.cwd();
  const baseline = resolveBaseline({
    baseline: inputs.baseline,
    current: inputs.current,
    base: inputs.base,
    cwd,
  });

  try {
    // Config: explicit input wins; otherwise defaults (the CLI's discovery is cwd-based and
    // the Action runs from the workspace root — defaults keep behavior predictable).
    let config: ResolvedConfig = { ...DEFAULT_CONFIG };
    if (inputs.config) {
      config = loadConfigFrom(inputs.config).config;
    }

    const currentPath = path.resolve(cwd, inputs.current);
    const { report, ignored } = await analyze(baseline.path, currentPath, { config });
    const breaking = report.summary.bySeverity.error;
    const warnings = report.summary.bySeverity.warning;
    const infos = report.summary.bySeverity.info;
    const ignoredCount = ignored.length;

    const advice = config.versioning.suggest
      ? report.semver
      : { bump: 'none' as const, reason: 'suggestion disabled', triggers: [] };
    const suggestedVersion =
      advice.bump === 'none' ? 'no bump needed' : `${advice.bump} (${advice.reason})`;

    const verdict: 'fail' | 'pass' = inputs.failOn === 'never' || breaking === 0 ? 'pass' : 'fail';

    const outcome: ActionOutcome = {
      breaking,
      warnings,
      infos,
      ignored: ignoredCount,
      suggestedVersion,
      verdict,
      baselineVia: baseline.via,
    };
    return { outcome, commentBody: renderComment(report, outcome), report };
  } finally {
    if (baseline.via === 'merge-base') {
      try {
        fs.rmSync(path.dirname(baseline.path), { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

/** Post or update an idempotent PR comment with API Guard report. */
export async function postPrComment(
  token: string,
  commentBody: string,
  injected?: {
    core?: typeof core;
    context?: typeof github.context;
    octokit?: ReturnType<typeof github.getOctokit>;
  },
): Promise<void> {
  const c = injected?.core ?? core;
  const ctx = injected?.context ?? github.context;
  const prNumber = ctx.payload.pull_request?.number;
  if (!prNumber) {
    c.info('API Guard: not a pull_request event, skipping PR comment.');
    return;
  }
  const octokit = injected?.octokit ?? github.getOctokit(token);
  const { owner, repo } = ctx.repo;
  const marker = '<!-- apiguard-comment -->';
  const bodyWithMarker = `${marker}\n${commentBody}`;

  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 50,
    });
    const existing = comments.find((cm) => cm.body && cm.body.includes(marker));
    if (existing) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body: bodyWithMarker,
      });
      c.info(`API Guard: updated existing PR comment (#${existing.id}).`);
    } else {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: bodyWithMarker,
      });
      c.info(`API Guard: posted PR comment to #${prNumber}.`);
    }
  } catch (err) {
    c.warning(`API Guard: could not post/update PR comment: ${errorMessage(err)}`);
  }
}

/** Write outputs + summary via the @actions/core adapter. */
export function emitOutputs(c: typeof core, result: RunResult, markdownPath?: string): void {
  c.setOutput('breaking', String(result.outcome.breaking));
  c.setOutput('warnings', String(result.outcome.warnings));
  c.setOutput('verdict', result.outcome.verdict);
  c.setOutput('suggested-version', result.outcome.suggestedVersion);

  // Emit inline workflow annotations for pull requests
  if (result.report?.changes) {
    for (const change of result.report.changes) {
      if (change.location.line && change.location.file) {
        const file = change.location.file;
        const startLine = change.location.line;
        const startColumn = change.location.column;
        const title = change.ruleId;
        const msg = `${change.message}. Suggestion: ${change.suggestion}`;
        if (change.severity === 'error') {
          c.error(msg, { file, startLine, startColumn, title });
        } else if (change.severity === 'warning') {
          c.warning(msg, { file, startLine, startColumn, title });
        } else {
          c.notice(msg, { file, startLine, startColumn, title });
        }
      }
    }
  }

  try {
    c.summary.addRaw(result.commentBody).write();
  } catch (err) {
    // Summary is best-effort: local runs / odd runners lack GITHUB_STEP_SUMMARY.
    c.warning(`could not write job summary: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (markdownPath) {
    fs.writeFileSync(markdownPath, result.commentBody, 'utf8');
  }
}
