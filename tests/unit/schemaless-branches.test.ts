/**
 * One-side-missing branches: header parameter removal (request-header context),
 * parameters/responses/media types without schema nodes, and callback add/remove.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { analyze } from '../../src/core/engine/analyze.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

function pair(oldYaml: string, newYaml: string): [string, string] {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-ns-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'old.yaml'), oldYaml);
  fs.writeFileSync(path.join(d, 'new.yaml'), newYaml);
  return [path.join(d, 'old.yaml'), path.join(d, 'new.yaml')];
}

const idsOf = (r: { changes: Array<{ ruleId: string }> }) => r.changes.map((c) => c.ruleId);

describe('header parameter removal (§10.3, request-header context)', () => {
  it('removed header parameter surfaces in request-header context with wasRequired', async () => {
    const [o, n] = pair(
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /a:
    get:
      operationId: op
      parameters:
        - name: X-Required
          in: header
          required: true
          schema: {type: string}
      responses:
        '200': {description: OK}
`,
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /a:
    get:
      operationId: op
      responses:
        '200': {description: OK}
`,
    );
    const { report } = await analyze(o, n, {});
    const hit = report.changes.find((c) => c.ruleId === 'removed-parameter');
    expect(hit).toBeDefined();
    expect(hit?.location.context).toBe('request-header');
    expect(hit?.breaking).toBe(true);
  });
});

describe('schemaless nodes on either side', () => {
  it('parameters without schema and media types without schema do not crash or misfire', async () => {
    const [o, n] = pair(
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /a:
    get:
      operationId: op
      parameters:
        - name: q
          in: query
          required: false
          description: docs only
      responses:
        '200':
          description: OK
          content:
            application/json:
              examples:
                - name: ex1
`,
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /a:
    get:
      operationId: op
      parameters:
        - name: q
          in: query
          required: false
          description: docs only v2
      responses:
        '200':
          description: OK
          content:
            application/json:
              examples:
                - name: ex1-renamed
`,
    );
    const { report } = await analyze(o, n, {});
    // no schema-based rules fire; report is well-formed
    expect(Array.isArray(report.changes)).toBe(true);
    expect(report.changes.find((c) => c.ruleId === 'property-type-changed')).toBeUndefined();
  });

  it('response media type present on both sides but schema only on one side', async () => {
    const [o, n] = pair(
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /a:
    get:
      operationId: op
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: {type: object}
`,
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /a:
    get:
      operationId: op
      responses:
        '200':
          description: OK
          content:
            application/json:
              description: inline docs
`,
    );
    const { report } = await analyze(o, n, {});
    expect(report.changes.find((c) => c.ruleId === 'property-type-changed')).toBeUndefined();
  });
});

describe('callback rules (§10.3)', () => {
  const withCallbacks = (cb: string) => `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /subscribe:
    post:
      operationId: sub
      callbacks:
${cb}
      responses:
        '200': {description: OK}
`;

  it('callback-added and callback-removed fire', async () => {
    const [o, n] = pair(
      withCallbacks(`        eventCreated:
          '{$request.body#/url}':
            post:
              requestBody:
                content:
                  application/json:
                    schema: {type: object}
              responses:
                '200': {description: OK}`),
      withCallbacks(`        eventCreated:
          '{$request.body#/url}':
            post:
              requestBody:
                content:
                  application/json:
                    schema: {type: object}
              responses:
                '200': {description: OK}
        eventDeleted:
          '{$request.body#/url}':
            post:
              responses:
                '200': {description: OK}`),
    );
    const { report } = await analyze(o, n, {});
    expect(idsOf(report)).toContain('callback-added');

    const [o2, n2] = pair(
      withCallbacks(`        eventA:
          '{$request.body#/url}':
            post:
              responses:
                '200': {description: OK}
        eventB:
          '{$request.body#/url}':
            post:
              responses:
                '200': {description: OK}`),
      withCallbacks(`        eventA:
          '{$request.body#/url}':
            post:
              responses:
                '200': {description: OK}`),
    );
    const r2 = await analyze(o2, n2, {});
    expect(idsOf(r2.report)).toContain('callback-removed');
  });
});
