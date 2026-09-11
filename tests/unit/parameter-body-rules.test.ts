/**
 * Parameter lifecycle and request-body rules (§10.3): removed/made-required/location-changed/
 * metadata/added-required/added-optional, request-body removed/added/made-required.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { analyze } from '../../src/core/engine/analyze.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

function pair(oldYaml: string, newYaml: string): [string, string] {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-param-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'old.yaml'), oldYaml);
  fs.writeFileSync(path.join(d, 'new.yaml'), newYaml);
  return [path.join(d, 'old.yaml'), path.join(d, 'new.yaml')];
}

const DOC = (op: string) => `openapi: 3.0.3\ninfo: {title: API, version: '1.0'}\npaths:\n${op}`;

const GET_WITH_PARAMS = (params: string) =>
  `  /users/{id}:
    get:
      operationId: getUser
      parameters:
${params}
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
`;

function param(name: string, body: string): string {
  return (
    `        - name: ${name}\n          in: query\n` +
    body
      .split('\n')
      .map((l) => (l.trim() === '' ? '' : '          ' + l))
      .join('\n') +
    '\n'
  );
}

describe('parameter lifecycle rules (§10.3)', () => {
  it('removed-parameter + parameter-added-optional fire together', async () => {
    const [o, n] = pair(
      DOC(GET_WITH_PARAMS(param('limit', 'required: false\nschema:\n  type: integer'))),
      DOC(GET_WITH_PARAMS(param('offset', 'required: false\nschema:\n  type: integer'))),
    );
    const { report } = await analyze(o, n, {});
    const ids = report.changes.map((c) => c.ruleId);
    expect(ids).toContain('removed-parameter');
    expect(ids).toContain('parameter-added-optional');
  });

  it('parameter-added-required fires for required=true additions', async () => {
    const [o, n] = pair(
      DOC(GET_WITH_PARAMS(param('limit', 'required: false\nschema:\n  type: integer'))),
      DOC(
        GET_WITH_PARAMS(
          param('limit', 'required: false\nschema:\n  type: integer') +
            param('verbose', 'required: true\nschema:\n  type: boolean'),
        ),
      ),
    );
    const { report } = await analyze(o, n, {});
    expect(report.changes.find((c) => c.ruleId === 'parameter-added-required')).toBeDefined();
  });

  it('parameter-made-required and parameter-metadata-changed fire', async () => {
    const [o, n] = pair(
      DOC(
        GET_WITH_PARAMS(
          param('filter', 'required: false\ndescription: a filter\nschema:\n  type: string'),
        ),
      ),
      DOC(
        GET_WITH_PARAMS(
          param('filter', 'required: true\ndescription: better\nschema:\n  type: string'),
        ),
      ),
    );
    const { report } = await analyze(o, n, {});
    const ids = report.changes.map((c) => c.ruleId);
    expect(ids).toContain('parameter-made-required');
    expect(ids).toContain('parameter-metadata-changed');
  });

  it('parameter-location-changed fires when in changes (query → header)', async () => {
    const [o, n] = pair(
      DOC(GET_WITH_PARAMS(param('trace', 'required: false\nschema:\n  type: string'))),
      DOC(
        GET_WITH_PARAMS(
          `        - name: trace\n          in: header\n          required: false\n          schema:\n            type: string`,
        ),
      ),
    );
    const { report } = await analyze(o, n, {});
    expect(report.changes.find((c) => c.ruleId === 'parameter-location-changed')).toBeDefined();
  });
});

describe('request-body rules (§10.3)', () => {
  const POST_BODY = (required: boolean) =>
    `  /users:
    post:
      operationId: createUser
      requestBody:
        required: ${required}
        content:
          application/json:
            schema:
              type: object
      responses:
        '201':
          description: Created
`;

  const POST_NOBODY = `  /users:
    post:
      operationId: createUser
      responses:
        '201':
          description: Created
`;

  it('request-body-removed fires with wasRequired doctrine (breaking)', async () => {
    const [o, n] = pair(DOC(POST_BODY(true)), DOC(POST_NOBODY));
    const { report } = await analyze(o, n, {});
    const removed = report.changes.find((c) => c.ruleId === 'request-body-removed');
    expect(removed).toBeDefined();
    expect(removed?.breaking).toBe(true);
  });

  it('request-body-added-optional is info', async () => {
    const [o, n] = pair(DOC(POST_NOBODY), DOC(POST_BODY(false)));
    const { report } = await analyze(o, n, {});
    const added = report.changes.find((c) => c.ruleId === 'request-body-added-optional');
    expect(added).toBeDefined();
    expect(added?.severity).toBe('info');
  });

  it('request-body-required-changed (optional → required) is breaking', async () => {
    const [o, n] = pair(DOC(POST_BODY(false)), DOC(POST_BODY(true)));
    const { report } = await analyze(o, n, {});
    const madeReq = report.changes.find((c) => c.ruleId === 'request-body-required-changed');
    expect(madeReq).toBeDefined();
    expect(madeReq?.severity).toBe('error');
  });
});
