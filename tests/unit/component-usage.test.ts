/**
 * Component usage classification (§10.5b): send-only, parse-only, and mixed send+parse
 * components (incl. webhook refs), usageCount stamping, and strictest-class view selection.
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-use-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'old.yaml'), oldYaml);
  fs.writeFileSync(path.join(d, 'new.yaml'), newYaml);
  return [path.join(d, 'old.yaml'), path.join(d, 'new.yaml')];
}

const H = `openapi: 3.1.0
info: {title: A, version: '1.0'}
`;

describe('component usage classes (§10.5b)', () => {
  it('send-only component: property removal is request-body doctrine (warning when optional)', async () => {
    const [o, n] = pair(
      `${H}paths:
  /a:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/In'
      responses:
        '200': {description: OK}
components:
  schemas:
    In:
      type: object
      required: [keep]
      properties:
        keep: {type: string}
        drop: {type: string}
`,
      `${H}paths:
  /a:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/In'
      responses:
        '200': {description: OK}
components:
  schemas:
    In:
      type: object
      required: [keep]
      properties:
        keep: {type: string}
`,
    );
    const { report } = await analyze(o, n, {});
    const comp = report.changes.find(
      (c) => c.ruleId === 'property-removed' && c.location.context === 'component',
    );
    expect(comp).toBeDefined();
    expect(comp?.location.usageCount).toBeGreaterThan(0);
    expect(comp?.severity).toBe('warning'); // send-side optional → §10.5
  });

  it('parse-side component: required-property-added is info (extra data never breaks a parser)', async () => {
    const [o, n] = pair(
      `${H}paths:
  /a:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Out'
components:
  schemas:
    Out:
      type: object
      properties:
        a: {type: string}
`,
      `${H}paths:
  /a:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Out'
components:
  schemas:
    Out:
      type: object
      required: [a]
      properties:
        a: {type: string}
        b: {type: string}
`,
    );
    const { report } = await analyze(o, n, {});
    const added = report.changes.find((c) => c.ruleId === 'required-property-added');
    expect(added).toBeDefined();
    expect(added?.severity).toBe('info'); // parse-side
  });

  it('mixed usage (request + response + webhook): strictest class wins (parse)', async () => {
    const [o, n] = pair(
      `${H}paths:
  /a:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Both'
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Both'
components:
  schemas:
    Both:
      type: object
      properties:
        keep: {type: string}
        drop: {type: string}
webhooks:
  pushed:
    post:
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Both'
`,
      `${H}paths:
  /a:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Both'
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Both'
components:
  schemas:
    Both:
      type: object
      properties:
        keep: {type: string}
`,
    );
    const { report } = await analyze(o, n, {});
    const comp = report.changes.find(
      (c) => c.ruleId === 'property-removed' && c.location.context === 'component',
    );
    expect(comp).toBeDefined();
    // parse > send in usage count → parse doctrine: removal is breaking
    expect(comp?.severity).toBe('error');
    expect(comp?.location.usageCount).toBeGreaterThanOrEqual(3);
  });

  it('unreachable components (unused on both sides) are not diffed (§10.5b)', async () => {
    const [o, n] = pair(
      `${H}paths: {}\ncomponents:\n  schemas:\n    Unused:\n      type: object\n      properties:\n        a: {type: string}\n`,
      `${H}paths: {}\ncomponents:\n  schemas:\n    Unused:\n      type: object\n`,
    );
    const { report } = await analyze(o, n, {});
    expect(report.changes).toHaveLength(0);
  });
});
