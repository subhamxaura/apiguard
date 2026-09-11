/**
 * Action entrypoint — bundled by esbuild to dist/index.js (self-contained, no node_modules).
 * Contract: never throw; failures go through setFailed/exit code so the step turns red.
 */
import * as core from '@actions/core';
import { runAction, emitOutputs } from './action.js';

async function main(): Promise<void> {
  try {
    const markdownPath = core.getInput('markdown-file') || undefined;
    const result = await runAction();
    emitOutputs(core, result, markdownPath);
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
