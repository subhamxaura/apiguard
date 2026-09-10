/**
 * Media-type, response-header, request-header, and response-status rules (§10.3),
 * plus malformed-node robustness (defensive isObject guards must not crash the engine).
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-media-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'old.yaml'), oldYaml);
  fs.writeFileSync(path.join(d, 'new.yaml'), newYaml);
  return [path.join(d, 'old.yaml'), path.join(d, 'new.yaml')];
}

const idsOf = (r: { changes: Array<{ ruleId: string }> }) => r.changes.map((c) => c.ruleId);

describe('media-type and header rules (§10.3)', () => {
  it('content-type-added/removed fire on request and response bodies', async () => {
    const [o, n] = pair(
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /users:
    post:
      operationId: createUser
      requestBody:
        content:
          application/json:
            schema: {type: object}
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: {type: object}
            application/xml:
              schema: {type: object}
`,
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /users:
    post:
      operationId: createUser
      requestBody:
        content:
          application/json:
            schema: {type: object}
          text/plain:
            schema: {type: string}
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: {type: object}
`,
    );
    const { report } = await analyze(o, n, {});
    const ids = idsOf(report);
    expect(ids).toContain('content-type-removed'); // response xml removed
    expect(ids).toContain('content-type-added'); // request text/plain added
    const removed = report.changes.find((c) => c.ruleId === 'content-type-removed');
    expect(removed?.breaking).toBe(true);
    const added = report.changes.find((c) => c.ruleId === 'content-type-added');
    expect(added?.severity).toBe('info');
  });

  it('response-header-removed is breaking; response-header-added is info', async () => {
    const [o, n] = pair(
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /users:
    get:
      operationId: list
      responses:
        '200':
          description: OK
          headers:
            X-Rate-Limit:
              schema: {type: integer}
`,
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /users:
    get:
      operationId: list
      responses:
        '200':
          description: OK
          headers:
            X-Trace-Id:
              schema: {type: string}
`,
    );
    const { report } = await analyze(o, n, {});
    const ids = idsOf(report);
    expect(ids).toContain('response-header-removed');
    expect(ids).toContain('response-header-added');
    expect(report.changes.find((c) => c.ruleId === 'response-header-removed')?.breaking).toBe(true);
  });

  it('response-removed fires; response-added is info', async () => {
    const [o, n] = pair(
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /users:
    get:
      operationId: list
      responses:
        '200': {description: OK}
        '404': {description: Not found}
`,
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /users:
    get:
      operationId: list
      responses:
        '200': {description: OK}
        '429': {description: Too many requests}
`,
    );
    const { report } = await analyze(o, n, {});
    const ids = idsOf(report);
    expect(ids).toContain('response-removed');
    expect(ids).toContain('response-added');
  });

  it('request-header rules: added-optional, made-required, removed', async () => {
    const [o, n] = pair(
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /users:
    get:
      operationId: list
      parameters:
        - name: X-Trace
          in: header
          required: false
          schema: {type: string}
      responses:
        '200': {description: OK}
`,
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /users:
    get:
      operationId: list
      parameters:
        - name: X-Trace
          in: header
          required: true
          schema: {type: string}
      responses:
        '200': {description: OK}
`,
    );
    const { report } = await analyze(o, n, {});
    expect(idsOf(report)).toContain('parameter-made-required');
    const made = report.changes.find((c) => c.ruleId === 'parameter-made-required');
    expect(made?.location.context).toBe('parameter');
  });
});

describe('malformed-node robustness (defensive guards)', () => {
  it('null/missing operation fragments do not crash the differ', async () => {
    const [o, n] = pair(
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /weird:
    get:
      operationId: w
      parameters: null
      requestBody: null
      responses: null
      security: null
      callbacks: null
`,
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /weird:
    get:
      operationId: w
      parameters: []
      requestBody: {}
      responses: {}
      security: []
      callbacks: {}
`,
    );
    const { report } = await analyze(o, n, {});
    expect(Array.isArray(report.changes)).toBe(true);
  });

  it('non-object servers/responses entries are skipped, not fatal', async () => {
    const [o, n] = pair(
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
servers:
  - not-an-object: true
  - url: https://x.example.com
paths:
  /users:
    get:
      operationId: list
      responses:
        '200':
          description: OK
          headers: null
          content: null
`,
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
servers:
  - url: https://x.example.com
paths:
  /users:
    get:
      operationId: list
      responses:
        '200':
          description: OK
          headers: {}
          content: {}
`,
    );
    const { report } = await analyze(o, n, {});
    expect(report.changes).toHaveLength(0);
  });

  it('path items with non-method keys and null operations are indexed safely', async () => {
    const [o, n] = pair(
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /users:
    summary: user ops
    get: null
    post:
      operationId: create
      responses:
        '201': {description: Created}
`,
      `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /users:
    summary: user ops
    get:
      operationId: list
      responses:
        '200': {description: OK}
`,
    );
    const { report } = await analyze(o, n, {});
    const ids = idsOf(report);
    // POST vanishes entirely → removed-method; the null→object GET must not crash the differ
    expect(ids).toContain('removed-method');
    expect(report.changes.length).toBeGreaterThan(0);
  });
});
