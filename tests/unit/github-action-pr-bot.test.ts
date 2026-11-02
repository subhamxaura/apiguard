import { describe, it, expect, vi } from 'vitest';
import { postPrComment, emitOutputs, type RunResult } from '../../src/github/action.js';

describe('GitHub Action PR Bot & Annotations', () => {
  it('skips posting comment when not a pull_request event', async () => {
    const fakeCore = {
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      notice: vi.fn(),
    };
    const fakeContext = {
      payload: {},
      repo: { owner: 'subham', repo: 'apiguard' },
    };

    await postPrComment('token', 'comment body', {
      core: fakeCore as never,
      context: fakeContext as never,
    });
    expect(fakeCore.info).toHaveBeenCalledWith(expect.stringContaining('skipping PR comment'));
  });

  it('updates existing comment when marker is present', async () => {
    const fakeCore = {
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      notice: vi.fn(),
    };
    const updateComment = vi.fn().mockResolvedValue({});
    const createComment = vi.fn().mockResolvedValue({ data: { id: 123 } });
    const listComments = vi.fn().mockResolvedValue({
      data: [{ id: 99, body: '<!-- apiguard-comment -->\nOld report' }],
    });

    const fakeContext = {
      payload: { pull_request: { number: 42 } },
      repo: { owner: 'subham', repo: 'apiguard' },
    };

    const fakeOctokit = {
      rest: {
        issues: {
          listComments,
          updateComment,
          createComment,
        },
      },
    };

    await postPrComment('dummy-token', '## New Report', {
      core: fakeCore as never,
      context: fakeContext as never,
      octokit: fakeOctokit as never,
    });
    expect(updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        comment_id: 99,
        body: expect.stringContaining('## New Report'),
      }),
    );
    expect(createComment).not.toHaveBeenCalled();
    expect(fakeCore.info).toHaveBeenCalledWith(
      expect.stringContaining('updated existing PR comment'),
    );
  });

  it('emits workflow command inline annotations when line and file are present', () => {
    const fakeCore = {
      setOutput: vi.fn(),
      summary: { addRaw: () => ({ write: vi.fn() }) },
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      notice: vi.fn(),
    };

    const runResult: RunResult = {
      outcome: {
        breaking: 1,
        warnings: 1,
        infos: 0,
        ignored: 0,
        suggestedVersion: 'major',
        verdict: 'fail',
        baselineVia: 'input',
      },
      commentBody: 'Body',
      report: {
        schemaVersion: '1.0',
        tool: { name: 'apiguard', version: '1.0.0' },
        baseline: { source: 'base', openapiVersion: '3.0.3', title: 'T', sha256: 'a' },
        current: { source: 'curr', openapiVersion: '3.0.3', title: 'T', sha256: 'b' },
        summary: {
          total: 2,
          bySeverity: { error: 1, warning: 1, info: 0 },
          byKind: { addition: 0, removal: 1, modification: 1, relaxation: 0, documentation: 0 },
          ignored: 0,
        },
        semver: { bump: 'major', reason: 'r', triggers: [] },
        changes: [
          {
            id: '1',
            ruleId: 'property-removed',
            severity: 'error',
            kind: 'removal',
            breaking: true,
            message: 'Property `email` removed',
            suggestion: 'Fix it',
            location: {
              path: '/users',
              context: 'response-body',
              pointerOld: '',
              pointerNew: '',
              file: 'openapi.yaml',
              line: 45,
              column: 3,
            },
          },
          {
            id: '2',
            ruleId: 'description-changed',
            severity: 'warning',
            kind: 'modification',
            breaking: false,
            message: 'Description changed',
            suggestion: 'Notice',
            location: {
              path: '/users',
              context: 'api',
              pointerOld: '',
              pointerNew: '',
              file: 'openapi.yaml',
              line: 10,
              column: 1,
            },
          },
        ],
      },
    };

    emitOutputs(fakeCore as never, runResult);

    expect(fakeCore.error).toHaveBeenCalledWith(
      expect.stringContaining('Property `email` removed'),
      expect.objectContaining({
        file: 'openapi.yaml',
        startLine: 45,
        startColumn: 3,
        title: 'property-removed',
      }),
    );

    expect(fakeCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('Description changed'),
      expect.objectContaining({
        file: 'openapi.yaml',
        startLine: 10,
        startColumn: 1,
        title: 'description-changed',
      }),
    );
  });
});
