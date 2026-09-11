/**
 * validateSemantics branch matrix (§17.2): unknown security schemes, invalid response
 * keys, parameter shape violations, required-without-property, empty path items.
 */
import { describe, it, expect } from 'vitest';
import { validateSemantics, formatIssues, isHttpMethod } from '../../src/loaders/validate.js';
import { parse as parseYaml } from 'yaml';

const sem = (text: string, file = 'spec.yaml') => validateSemantics(parseYaml(text), file);

const WRAP = (body: string) => `openapi: 3.0.3\ninfo: {title: A, version: '1.0'}\n${body}`;

describe('validateSemantics branches (§17.2)', () => {
  it('flags security requirements referencing unknown schemes (op-level and path-level)', () => {
    const doc = WRAP(`paths:
  /a:
    security:
      - ghostA: []
    get:
      security:
        - ghostB: []
        - known: []
      responses:
        '200': {description: OK}
components:
  securitySchemes:
    known: {type: apiKey, name: k, in: header}
`);
    const r = sem(doc);
    const msgs = r.issues.map((i) => i.message);
    expect(msgs.some((m) => m.includes('ghostA'))).toBe(true);
    expect(msgs.some((m) => m.includes('ghostB'))).toBe(true);
    // the legitimate scheme must NOT be flagged (beware: "unknown" contains "known"!)
    expect(msgs.some((m) => m.includes('scheme "known"'))).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('flags invalid response status keys', () => {
    const doc = WRAP(`paths:
  /a:
    get:
      responses:
        '999': {description: bad}
        '200': {description: OK}
        default: {description: fallback}
`);
    const r = sem(doc);
    const msgs = r.issues.map((i) => i.message);
    expect(msgs.some((m) => m.includes('invalid response status key "999"'))).toBe(true);
    expect(r.issues.filter((i) => i.message.includes('invalid response status key'))).toHaveLength(
      1,
    );
  });

  it('flags empty path items and path items without operations', () => {
    const doc = WRAP(`paths:
  /empty: null
  /noop:
    summary: no operations here
  /ok:
    get:
      responses:
        '200': {description: OK}
`);
    const r = sem(doc);
    const msgs = r.issues.map((i) => i.message);
    expect(msgs).toContain('/empty: path item is empty');
    expect(msgs).toContain('/noop: path item has no operations');
  });

  it('flags parameters with both schema and content', () => {
    const doc = WRAP(`paths:
  /a:
    get:
      parameters:
        - name: p
          in: query
          schema: {type: string}
          content:
            application/json: {schema: {type: string}}
      responses:
        '200': {description: OK}
`);
    const r = sem(doc);
    expect(r.issues.some((i) => i.message.includes("both 'schema' and 'content'"))).toBe(true);
  });

  it('flags required entries not present as properties', () => {
    const doc = WRAP(`components:
  schemas:
    User:
      type: object
      required: [id, ghost]
      properties:
        id: {type: string}
`);
    const r = sem(doc);
    expect(r.issues.some((i) => i.message.includes('required entry "ghost"'))).toBe(true);
    expect(r.issues.some((i) => i.message.includes('required entry "id"'))).toBe(false);
  });

  it('non-object document yields a single error issue', () => {
    const r = validateSemantics([1, 2, 3], 'spec.yaml');
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.message).toBe('document is not an object');
  });

  it('formatIssues groups errors and warnings', () => {
    const lines = formatIssues([
      { level: 'error', file: 'a.yaml', message: 'e1' },
      { level: 'warning', file: 'a.yaml', message: 'w1' },
    ]);
    expect(lines).toEqual(['Errors:', '  a.yaml: e1', 'Warnings:', '  a.yaml: w1']);
    expect(formatIssues([])).toEqual([]);
  });

  it('isHttpMethod is case-insensitive and excludes non-methods', () => {
    expect(isHttpMethod('GET')).toBe(true);
    expect(isHttpMethod('Post')).toBe(true);
    expect(isHttpMethod('parameters')).toBe(false);
    expect(isHttpMethod('x-custom')).toBe(false);
  });
});
