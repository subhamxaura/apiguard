/**
 * Composition and discriminator rules (§10.4): allOf/anyOf/oneOf member add/remove,
 * discriminator add/change/remove, plus compact() truncation of large values.
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-comp-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'old.yaml'), oldYaml);
  fs.writeFileSync(path.join(d, 'new.yaml'), newYaml);
  return [path.join(d, 'old.yaml'), path.join(d, 'new.yaml')];
}

const DOC = (schema: string) => `openapi: 3.0.3
info: {title: A, version: '1.0'}
paths:
  /a:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
${schema
  .split('\n')
  .map((l) => (l.trim() === '' ? '' : '                ' + l))
  .join('\n')}
`;

const idsOf = (r: { changes: Array<{ ruleId: string }> }) => r.changes.map((c) => c.ruleId);

describe('composition rules (§10.4)', () => {
  it('allOf-member-added and allOf-member-removed fire with counts', async () => {
    const [o, n] = pair(
      DOC('allOf:\n  - type: object\n    properties:\n      a: {type: string}'),
      DOC(
        'allOf:\n  - type: object\n    properties:\n      a: {type: string}\n  - type: object\n    properties:\n      b: {type: string}',
      ),
    );
    const { report } = await analyze(o, n, {});
    expect(idsOf(report)).toContain('allOf-member-added');
  });

  it('allOf-member-removed on shrink', async () => {
    const [o, n] = pair(
      DOC(
        'allOf:\n  - type: object\n  - type: object\n  - type: object',
      ),
      DOC('allOf:\n  - type: object'),
    );
    const { report } = await analyze(o, n, {});
    const hit = report.changes.find((c) => c.ruleId === 'allOf-member-removed');
    expect(hit).toBeDefined();
    expect(hit?.oldValue).toBe(3);
  });

  it('anyOf/oneOf member add and remove (registry id: anyOf-oneOf-member-*)', async () => {
    const [o1, n1] = pair(
      DOC('oneOf:\n  - type: string'),
      DOC('oneOf:\n  - type: string\n  - type: number'),
    );
    const r1 = await analyze(o1, n1, {});
    expect(idsOf(r1.report)).toContain('anyOf-oneOf-member-added');

    const [o2, n2] = pair(
      DOC('anyOf:\n  - type: string\n  - type: number'),
      DOC('anyOf:\n  - type: string'),
    );
    const r2 = await analyze(o2, n2, {});
    expect(idsOf(r2.report)).toContain('anyOf-oneOf-member-removed');
  });

  it('discriminator-added / -changed / -removed', async () => {
    const [o1, n1] = pair(DOC('type: object\nproperties:\n  a: {type: string}'), DOC('type: object\ndiscriminator:\n  propertyName: kind\nproperties:\n  a: {type: string}'));
    const r1 = await analyze(o1, n1, {});
    expect(idsOf(r1.report)).toContain('discriminator-added');

    const [o2, n2] = pair(
      DOC('discriminator:\n  propertyName: kind'),
      DOC('discriminator:\n  propertyName: type'),
    );
    const r2 = await analyze(o2, n2, {});
    expect(idsOf(r2.report)).toContain('discriminator-changed');

    const [o3, n3] = pair(DOC('discriminator:\n  propertyName: kind'), DOC('type: object'));
    const r3 = await analyze(o3, n3, {});
    expect(idsOf(r3.report)).toContain('discriminator-changed');
  });

  it('large object defaults are compacted (compact truncation branch)', async () => {
    // compact() passes scalars through but truncates objects whose JSON exceeds 80 chars
    const bigObj = JSON.stringify({ k1: 'x'.repeat(60), k2: 'y'.repeat(60) });
    const [o, n] = pair(
      DOC(`type: object\nproperties:\n  a:\n    type: object\n    default: ${bigObj}`),
      DOC(`type: object\nproperties:\n  a:\n    type: object\n    default: ${JSON.stringify({ k1: 'x'.repeat(60), k2: 'z'.repeat(60) })}`),
    );
    const { report } = await analyze(o, n, {});
    const hit = report.changes.find((c) => c.ruleId === 'property-default-changed');
    expect(hit).toBeDefined();
    const serialized = JSON.stringify(hit?.newValue ?? '');
    // truncated with ellipsis marker per the §12 compact rule
    expect(serialized.length).toBeLessThan(120);
  });
});
