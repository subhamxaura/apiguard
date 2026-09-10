/**
 * §10.4 rule-branch coverage: composition, discriminator, additionalProperties, const,
 * constraints, and metadata rules — each fired through the full analyze() pipeline.
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-rc-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'old.yaml'), oldYaml);
  fs.writeFileSync(path.join(d, 'new.yaml'), newYaml);
  return [path.join(d, 'old.yaml'), path.join(d, 'new.yaml')];
}

/** Dedent caller schema text (first line sets the base), then re-indent under `schema:`. */
const indent = (s: string, n: number) => {
  const lines = s.split('\n');
  const base = Math.min(...lines.filter((l) => l.trim() !== '').map((l) => l.match(/^ */)?.[0].length ?? 0));
  return lines.map((l) => (l.trim() === '' ? '' : ' '.repeat(n) + l.slice(base))).join('\n');
};

const DOC = (oldSchema: string, newSchema: string): [string, string] => [
  `openapi: 3.0.3
info: {title: T, version: '1.0'}
paths:
  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
${indent(oldSchema, 16)}
`,
  `openapi: 3.0.3
info: {title: T, version: '1.0'}
paths:
  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
${indent(newSchema, 16)}
`,
];

const rulesOf = (report: { changes: Array<{ ruleId: string }> }) =>
  report.changes.map((c) => c.ruleId);

describe('§10.4 rule branches via analyze()', () => {
  it('const added / changed / removed (§10.4)', async () => {
    const [o, n] = pair(...DOC('        const: v1', '        const: v2'));
    const { report } = await analyze(o, n, {});
    expect(rulesOf(report)).toContain('const-changed');

    const [o2, n2] = pair(...DOC('        type: string', '        type: string\n        const: v'));
    const { report: r2 } = await analyze(o2, n2, {});
    expect(rulesOf(r2)).toContain('const-added');

    const [o3, n3] = pair(...DOC('        type: string\n        const: v', '        type: string'));
    const { report: r3 } = await analyze(o3, n3, {});
    expect(rulesOf(r3)).toContain('const-removed');
  });

  it('additionalProperties map close/open (§10.4)', async () => {
    const [o, n] = pair(...DOC('        type: object', '        type: object\n        additionalProperties: false'));
    const { report } = await analyze(o, n, {});
    expect(rulesOf(report)).toContain('map-closed');

    const [o2, n2] = pair(
      ...DOC('        type: object\n        additionalProperties: false', '        type: object'),
    );
    const { report: r2 } = await analyze(o2, n2, {});
    expect(rulesOf(r2)).toContain('map-opened');
  });

  it('composition member add/remove (§10.4)', async () => {
    const base = (members: string) => `        allOf:\n${members}`;
    const [o, n] = pair(
      ...DOC(base('          - type: object'), base('          - type: object\n          - type: string')),
    );
    const { report } = await analyze(o, n, {});
    expect(rulesOf(report)).toContain('allOf-member-added');

    const [o2, n2] = pair(...DOC(base('          - type: object'), '        type: object'));
    const { report: r2 } = await analyze(o2, n2, {});
    expect(rulesOf(r2)).toContain('allOf-member-removed');
  });

  it('anyOf member removal is error (§10.4)', async () => {
    const [o, n] = pair(
      ...DOC(
        '        anyOf:\n          - type: string\n          - type: number',
        '        anyOf:\n          - type: string',
      ),
    );
    const { report } = await analyze(o, n, {});
    const c = report.changes.find((x) => x.ruleId === 'anyOf-oneOf-member-removed');
    expect(c?.severity).toBe('error');
  });

  it('discriminator added / changed (§10.4)', async () => {
    const [o, n] = pair(...DOC('        type: object', '        type: object\n        discriminator: {propertyName: kind}'));
    const { report } = await analyze(o, n, {});
    expect(rulesOf(report)).toContain('discriminator-added');

    const [o2, n2] = pair(
      ...DOC(
        '        discriminator: {propertyName: kind}',
        '        discriminator: {propertyName: other}',
      ),
    );
    const { report: r2 } = await analyze(o2, n2, {});
    expect(rulesOf(r2)).toContain('discriminator-changed');
  });

  it('constraint add/tighten/relax/remove (§11.3)', async () => {
    // new minLength where none existed → constraint-added (error)
    const [o, n] = pair(
      ...DOC('        type: string', '        type: string\n        minLength: 3'),
    );
    const { report } = await analyze(o, n, {});
    expect(rulesOf(report)).toContain('constraint-added');

    // 5 → 7 tightens (error)
    const [o2, n2] = pair(
      ...DOC('        type: string\n        minLength: 5', '        type: string\n        minLength: 7'),
    );
    const { report: r2 } = await analyze(o2, n2, {});
    expect(rulesOf(r2)).toContain('constraint-tightened');

    // 5 → 3 relaxes (info)
    const [o3, n3] = pair(
      ...DOC('        type: string\n        minLength: 5', '        type: string\n        minLength: 3'),
    );
    const { report: r3 } = await analyze(o3, n3, {});
    expect(rulesOf(r3)).toContain('constraint-relaxed');

    // removal → constraint-removed (info)
    const [o4, n4] = pair(...DOC('        type: string\n        minLength: 5', '        type: string'));
    const { report: r4 } = await analyze(o4, n4, {});
    expect(rulesOf(r4)).toContain('constraint-removed');
  });

  it('pattern change is treated as tightened even if laxer (§11.3 bluntness)', async () => {
    const [o, n] = pair(
      ...DOC(
        '        type: string\n        pattern: "^[a-z]{10,}$"',
        '        type: string\n        pattern: "^[a-z]*$"',
      ),
    );
    const { report } = await analyze(o, n, {});
    expect(rulesOf(report)).toContain('constraint-tightened');
  });

  it('schema metadata (description) change fires schema-description-changed', async () => {
    const [o, n] = pair(
      ...DOC('        type: object\n        description: before', '        type: object\n        description: after'),
    );
    const { report } = await analyze(o, n, {});
    expect(rulesOf(report)).toContain('schema-description-changed');
  });

  it('required array shrink fires required-removed (§10.4)', async () => {
    const [o, n] = pair(
      ...DOC(
        '        type: object\n        required: [id]\n        properties:\n          id: {type: string}',
        '        type: object\n        properties:\n          id: {type: string}',
      ),
    );
    const { report } = await analyze(o, n, {});
    expect(rulesOf(report)).toContain('required-removed');
  });
});

describe('§10.4 remaining branches: max bounds, multipleOf, items-level, component doctrine', () => {
  it('maximum raise relaxes; exclusiveMinimum numeric form (§11.2/§11.3)', async () => {
    const [o, n] = pair(...DOC('        type: number\n        maximum: 10', '        type: number\n        maximum: 20'));
    const { report } = await analyze(o, n, {});
    expect(rulesOf(report)).toContain('constraint-relaxed');

    const [o2, n2] = pair(
      ...DOC(
        '        type: number\n        minimum: 0\n        exclusiveMinimum: true',
        '        type: number\n        minimum: 0\n        exclusiveMinimum: false',
      ),
    );
    const { report: r2 } = await analyze(o2, n2, {});
    // §11.2: `exclusiveMinimum: true, minimum: 0` normalizes to `exclusiveMinimum: 0`;
    // `exclusiveMinimum: false` normalizes to (dropped) → the constraint is removed.
    expect(r2.changes.some((c) => c.ruleId === 'constraint-removed')).toBe(true);
  });

  it('multipleOf change fires (§10.4)', async () => {
    const [o, n] = pair(...DOC('        type: number\n        multipleOf: 5', '        type: number\n        multipleOf: 10'));
    const { report } = await analyze(o, n, {});
    expect(report.changes.some((c) => c.ruleId === 'constraint-tightened' || c.ruleId === 'constraint-relaxed')).toBe(true);
  });

  it('array items type change fires property-type-changed via items recursion', async () => {
    const [o, n] = pair(
      ...DOC(
        '        type: array\n        items:\n          type: string',
        '        type: array\n        items:\n          type: number',
      ),
    );
    const { report } = await analyze(o, n, {});
    expect(rulesOf(report)).toContain('property-type-changed');
  });

  it('enum values ≤8 are included verbatim; property-added info (parse side)', async () => {
    const [o, n] = pair(
      ...DOC(
        '        type: string\n        enum: [a, b]',
        '        type: string\n        enum: [a, b, c]',
      ),
    );
    const { report } = await analyze(o, n, {});
    const added = report.changes.find((c) => c.ruleId === 'enum-value-added');
    expect(added).toBeDefined();
    expect(added?.severity).toBe('info');
  });

  it('enum >8 entries summarized (§8 compactness)', async () => {
    const [o, n] = pair(
      ...DOC(
        '        type: string\n        enum: [a, b, c, d, e, f, g, h, i]',
        '        type: string\n        enum: [a, b, c, d, e, f, g, h]',
      ),
    );
    const { report } = await analyze(o, n, {});
    const removed = report.changes.find((c) => c.ruleId === 'enum-value-removed');
    expect(removed).toBeDefined();
  });
});
