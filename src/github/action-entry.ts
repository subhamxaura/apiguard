/**
 * Action entrypoint — bundled by esbuild to dist/index.js (self-contained, no node_modules).
 * Contract: never throw; failures go through setFailed/exit code so the step turns red.
 */
import * as core from '@actions/core';
import { runAction, emitOutputs, postPrComment } from './action.js';

async function main(): Promise<void> {
  try {
    const markdownPath = core.getInput('markdown-file') || undefined;
    const commentPr = (core.getInput('comment-pr') || 'false') === 'true';
    const token = core.getInput('token') || process.env.GITHUB_TOKEN;

    const result = await runAction();
    emitOutputs(core, result, markdownPath);

    if (commentPr && token) {
      await postPrComment(token, result.commentBody, { core });
    }

    if (result.outcome.verdict === 'fail') {
      core.setFailed(
        `API Guard found ${result.outcome.breaking} breaking change(s). ` +
          `See the job summary for details.`,
      );
    } else {
      core.info(
        `API Guard: no breaking changes (${result.outcome.warnings} warnings, ` +
          `${result.outcome.infos} info).`,
      );
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

void main();
