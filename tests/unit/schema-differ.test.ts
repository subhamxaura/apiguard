import { describe, it, expect, afterEach } from 'vitest';
import { analyze } from '../../src/core/engine/analyze.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

let tmpDirs: string[] = [];
function specPair(baseline: string, current: string): { old: string; cur: string } {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-sd-'));
  tmpDirs.push(d);
  const old = path.join(d, 'old.yaml');
  const cur = path.join(d, 'new.yaml');
  fs.writeFileSync(old, baseline);
  fs.writeFileSync(cur, current);
  return { old, cur };
}

const DOC = (schemas: string, body: string) => `openapi: 3.0.3
info:
  title: T
  version: 1.0.0
paths:
${body}
components:
  schemas:
${schemas}`;

afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe('recursive schema differ (§10.4)', () => {
  it('nested property type change with pointer to nested node', async () => {
    const p = specPair(
      DOC(
        `    Nested:
      type: object
      properties:
        inner:
          type: object
          properties:
            deep:
              type: string
`,
        `  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Nested'`,
      ),
      DOC(
        `    Nested:
      type: object
      properties:
        inner:
          type: object
          properties:
            deep:
              type: number
`,
        `  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Nested'`,
      ),
    );
    const { report } = await analyze(p.old, p.cur, { config: undefined });
    const tc = report.changes.find((c) => c.ruleId === 'property-type-changed');
    expect(tc).toBeDefined();
    expect(tc?.severity).toBe('error');
    expect(tc?.location.pointerNew).toContain('/properties/inner/properties/deep');
    expect(String(tc?.oldValue)).toContain('string');
    expect(String(tc?.newValue)).toContain('number');
  });

  it('array item type change surfaces (pointer through items)', async () => {
    const p = specPair(
      DOC(
        `    List:
      type: object
      properties:
        tags:
          type: array
          items:
            type: string
`,
        `  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/List'`,
      ),
      DOC(
        `    List:
      type: object
      properties:
        tags:
          type: array
          items:
            type: number
`,
        `  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/List'`,
      ),
    );
    const { report } = await analyze(p.old, p.cur, {});
    expect(report.changes.some((c) => c.ruleId === 'property-type-changed')).toBe(true);
  });

  it('enum added/removed in any context (§10.4)', async () => {
    const p = specPair(
      DOC(
        `    E:
      type: object
      properties:
        status:
          type: string
          enum: [active, inactive, banned]
`,
        `  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/E'`,
      ),
      DOC(
        `    E:
      type: object
      properties:
        status:
          type: string
          enum: [active, inactive, pending]
`,
        `  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/E'`,
      ),
    );
    const { report } = await analyze(p.old, p.cur, {});
    expect(
      report.changes.some(
        (c) => c.ruleId === 'enum-value-removed' && String(c.oldValue) === 'banned',
      ),
    ).toBe(true);
    expect(
      report.changes.some((c) => c.ruleId === 'enum-value-added' && c.newValue === 'pending'),
    ).toBe(true);
  });

  it('pattern change counts as tightened even when loosened (§11.3 bluntness)', async () => {
    const p = specPair(
      DOC(
        `    P:
      type: object
      properties:
        code:
          type: string
          pattern: '^[A-Z]{3,10}$'
`,
        `  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/P'`,
      ),
      DOC(
        `    P:
      type: object
      properties:
        code:
          type: string
          pattern: '.*'
`,
        `  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/P'`,
      ),
    );
    const { report } = await analyze(p.old, p.cur, {});
    expect(report.changes.some((c) => c.ruleId === 'constraint-tightened')).toBe(true);
  });

  it('circular refs terminate (§11.7)', async () => {
    const schema = `    Node:
      type: object
      properties:
        next:
          $ref: '#/components/schemas/Node'
        name:
          type: string
`;
    const p = specPair(
      DOC(
        schema,
        `  /a:\n    get:\n      responses:\n        '200':\n          description: OK\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/Node'`,
      ),
      DOC(
        schema.replace(
          '        name:\n          type: string\n',
          '        name:\n          type: number\n',
        ),
        `  /a:\n    get:\n      responses:\n        '200':\n          description: OK\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/Node'`,
      ),
    );
    const { report } = await analyze(p.old, p.cur, {});
    expect(report.changes.some((c) => c.ruleId === 'property-type-changed')).toBe(true);
  });
});

describe('readOnly/writeOnly views (§11.5)', () => {
  it('readOnly flip removes from request view only', async () => {
    const mk = (ro: boolean) =>
      DOC(
        `    R:
      type: object
      properties:
        id:
          type: string
${ro ? '          readOnly: true\n' : ''}        name:
          type: string
`,
        `  /a:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/R'
      responses:
        '200':
          description: OK`,
      );
    const p = specPair(mk(false), mk(true));
    const { report } = await analyze(p.old, p.cur, {});
    // request view: id disappears → property-removed (send side, optional → warning);
    // the $ref site resolves to the component, so the fact surfaces in component context
    const removed = report.changes.find((c) => c.ruleId === 'property-removed');
    expect(removed).toBeDefined();
    expect(removed?.location.context).toBe('component');
    expect(removed?.severity).toBe('warning');
  });
});

describe('security rules (§10.6)', () => {
  it('scheme removal referenced by an operation is error', async () => {
    const doc = (schemes: string) => `openapi: 3.0.3
info:
  title: T
  version: 1.0.0
paths:
  /a:
    get:
      security:
        - apiKeyAuth: []
      responses:
        '200':
          description: OK
components:
  securitySchemes:
${schemes}`;
    const p = specPair(
      doc('    apiKeyAuth:\n      type: apiKey\n      in: header\n      name: X-Api'),
      doc('    otherAuth:\n      type: http\n      scheme: bearer'),
    );
    const { report } = await analyze(p.old, p.cur, {});
    // scheme still referenced in the old doc → error (§10.6)
    expect(
      report.changes.some((c) => c.ruleId === 'security-scheme-removed' && c.severity === 'error'),
    ).toBe(true);
    // the operation's scheme SET is unchanged (same key), so requirement-changed does not fire;
    // the scheme's disappearance is reported once at the component level.
    expect(report.changes.some((c) => c.ruleId === 'security-requirement-changed')).toBe(false);
    // requirement-changed already covers the incompatibility; scope rows only fire on overlap
  });

  it('security added to anonymous operation is error (§10.6)', async () => {
    const base = `openapi: 3.0.3
info:
  title: T
  version: 1.0.0
paths:
  /a:
    get:
SEC
      responses:
        '200':
          description: OK
components:
  securitySchemes:
    apiKeyAuth:
      type: apiKey
      in: header
      name: X-Api
`;
    const p = specPair(
      base.replace('SEC\n', ''),
      base.replace('SEC\n', '      security:\n        - apiKeyAuth: []\n'),
    );
    const { report } = await analyze(p.old, p.cur, {});
    expect(
      report.changes.some(
        (c) => c.ruleId === 'security-requirement-added' && c.severity === 'error',
      ),
    ).toBe(true);
  });

  it('security removed entirely is warning relaxation (§10.6)', async () => {
    const base = `openapi: 3.0.3
info:
  title: T
  version: 1.0.0
paths:
  /a:
    get:
SEC
      responses:
        '200':
          description: OK
components:
  securitySchemes:
    apiKeyAuth:
      type: apiKey
      in: header
      name: X-Api
`;
    const p = specPair(
      base.replace('SEC\n', '      security:\n        - apiKeyAuth: []\n'),
      base.replace('SEC\n', ''),
    );
    const { report } = await analyze(p.old, p.cur, {});
    const removed = report.changes.find((c) => c.ruleId === 'security-requirement-removed');
    expect(removed?.severity).toBe('warning');
  });

  it('scope narrowing: added scope is error, removed scope is info (§10.6)', async () => {
    const doc = (scopes: string) => `openapi: 3.0.3
info:
  title: T
  version: 1.0.0
paths:
  /a:
    get:
      security:
        - oauth:
            ${scopes}
      responses:
        '200':
          description: OK
components:
  securitySchemes:
    oauth:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: 'https://ex.example/token'
          scopes:
            read: Read access
            write: Write access
`;
    const p = specPair(doc('- read'), doc('- read\n            - write'));
    const { report } = await analyze(p.old, p.cur, {});
    // old [read] is no longer satisfied by new [read, write] → requirement-changed (error, §10.6)
    expect(
      report.changes.some(
        (c) => c.ruleId === 'security-requirement-changed' && c.severity === 'error',
      ),
    ).toBe(true);

    const rev = specPair(fs.readFileSync(p.cur, 'utf8'), fs.readFileSync(p.old, 'utf8'));
    const { report: r2 } = await analyze(rev.old, rev.cur, {});
    // reverse: new accepts just [read] → narrower scope set, relaxation (info)
    expect(
      r2.changes.some(
        (c) => c.ruleId === 'security-scope-required-removed' && c.severity === 'info',
      ),
    ).toBe(true);
  });
});

describe('components doctrine (§10.5b)', () => {
  it('unreachable components are not diffed', async () => {
    const doc = (unused: string) =>
      DOC(
        `    Used:
      type: object
      properties:
        a:
          type: string
${unused}`,
        `  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Used'`,
      );
    const p = specPair(
      doc(
        '    Unreachable:\n      type: object\n      properties:\n        z:\n          type: string\n',
      ),
      doc(
        '    Unreachable:\n      type: object\n      properties:\n        z:\n          type: number\n',
      ),
    );
    const { report } = await analyze(p.old, p.cur, {});
    expect(report.changes).toHaveLength(0);
  });

  it('usageCount is stamped on component changes', async () => {
    const doc = (props: string) =>
      DOC(
        `    U:
      type: object
      properties:
${props}`,
        `  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/U'`,
      );
    const p = specPair(
      doc('        x:\n          type: string\n        y:\n          type: string\n'),
      doc('        x:\n          type: string\n'),
    );
    const { report } = await analyze(p.old, p.cur, {});
    const change = report.changes.find((c) => c.ruleId === 'property-removed');
    expect(change?.location.componentName).toBe('U');
    expect(change?.location.usageCount).toBeGreaterThan(0);
  });
});
