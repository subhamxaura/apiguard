/** Unit tests for the semantic validator (§17.2) and the public library entry (§18). */
import { describe, it, expect } from 'vitest';
import { validateSemantics, formatIssues } from '../../src/loaders/validate.js';
import { validateSpec } from '../../src/index.js';
import { findRemoteRefs, findExternalFileRefs } from '../../src/loaders/spec-loader.js';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/** validateSemantics takes the PARSED document. */
const sem = (text: string, file = 'spec.yaml') => validateSemantics(parseYaml(text), file);

const OK = `openapi: 3.0.3
info: {title: T, version: '1.0'}
paths:
  /a:
    get:
      responses:
        '200': {description: OK}
`;

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-val-'));
}

describe('semantic validation (§17.2)', () => {
  it('clean spec: no issues', () => {
    const r = sem(OK);
    expect(r.issues).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it('missing openapi field is the loader error, not semantic (layering)', () => {
    // validateSemantics never sees the raw load failure; the loader throws SpecLoadError
    // before semantic checks run (§5.5 fail loud, fail early).
    const r = sem('info: {title: T, version: "1.0"}');
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('duplicate operationId is a warning (§11.8)', () => {
    const doc = `openapi: 3.0.3
info: {title: T, version: '1.0'}
paths:
  /a:
    get:
      operationId: dupe
      responses: {'200': {description: OK}}
  /b:
    get:
      operationId: dupe
      responses: {'200': {description: OK}}
`;
    const r = sem(doc);
    expect(r.ok).toBe(true); // warning, not structural error
    expect(r.issues.some((i) => i.level === 'warning' && i.message.includes('dupe'))).toBe(true);
  });

  it('invalid response status key is an error', () => {
    const doc = `openapi: 3.0.3
info: {title: T, version: '1.0'}
paths:
  /a:
    get:
      responses:
        '2oo': {description: OK}
`;
    const r = sem(doc);
    expect(r.ok).toBe(false);
  });

  it('parameter with both schema and content is an error', () => {
    const doc = `openapi: 3.0.3
info: {title: T, version: '1.0'}
paths:
  /a:
    get:
      parameters:
        - name: x
          in: query
          schema: {type: string}
          content:
            application/json: {schema: {type: string}}
      responses: {'200': {description: OK}}
`;
    const r = sem(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('mutually exclusive'))).toBe(true);
  });

  it('required entry without matching property is a warning', () => {
    const doc = `openapi: 3.0.3
info: {title: T, version: '1.0'}
paths: {}
components:
  schemas:
    S:
      type: object
      required: [ghost]
      properties:
        real: {type: string}
`;
    const r = sem(doc);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.message.includes('ghost'))).toBe(true);
  });

  it('formatIssues groups by level with file+message lines', () => {
    const lines = formatIssues([
      { level: 'error', file: 'a.yaml', message: 'boom' },
      { level: 'warning', file: 'b.yaml', message: 'meh' },
    ]);
    expect(lines.join('\n')).toContain('Errors:');
    expect(lines.join('\n')).toContain('a.yaml: boom');
    expect(lines.join('\n')).toContain('b.yaml: meh');
  });
});

describe('$ref scanning (§11.4)', () => {
  it('findRemoteRefs spots http(s) targets', () => {
    const refs = findRemoteRefs({
      components: {
        schemas: {
          A: { $ref: 'https://elsewhere.example/x.json#/Y' },
          B: { $ref: 'http://elsewhere.example/z.json' },
        },
      },
    });
    expect(refs).toHaveLength(2);
  });

  it('findExternalFileRefs flags paths leaving the spec directory', () => {
    const refs = findExternalFileRefs(
      { components: { schemas: { A: { $ref: '../outside.yaml#/X' } } } },
      '/specs',
    );
    expect(refs).toHaveLength(1);
  });
});

describe('public library API (§18)', () => {
  it('validateSpec returns spec metadata plus validation', async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'ok.yaml'), OK);
    try {
      const { spec, validation } = await validateSpec(path.join(d, 'ok.yaml'));
      expect(spec.openapiVersion).toBe('3.0.3');
      expect(spec.title).toBe('T');
      expect(validation.ok).toBe(true);
      expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
