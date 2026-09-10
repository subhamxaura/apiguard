import { describe, it, expect } from 'vitest';
import { structuralDeref } from '../../src/core/engine/walker.js';
import { analyze } from '../../src/core/engine/analyze.js';
import type { JsonObject } from '../../src/core/models/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('structural deref (§11.4/§11.7)', () => {
  it('inlines ref targets so ref-target content changes are detected', async () => {
    const mk = (emailFormat: string) => `openapi: 3.0.3
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
                $ref: '#/components/schemas/Person'
components:
  schemas:
    Person:
      type: object
      required: [id]
      properties:
        id: {type: string}
        email: {type: string, format: ${emailFormat}}
`;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-w-'));
    fs.writeFileSync(path.join(d, 'old.yaml'), mk('email'));
    fs.writeFileSync(path.join(d, 'new.yaml'), mk('date'));
    try {
      const { report } = await analyze(path.join(d, 'old.yaml'), path.join(d, 'new.yaml'), {});
      expect(report.changes.some((c) => c.ruleId === 'property-format-changed')).toBe(true);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('aliasing to identical content is NOT a change (§5.4)', async () => {
    const inline = `openapi: 3.0.3
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
                type: object
                properties:
                  id: {type: string}
`;
    const refd = `openapi: 3.0.3
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
                $ref: '#/components/schemas/Id'
components:
  schemas:
    Id:
      type: object
      properties:
        id: {type: string}
`;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-w-'));
    fs.writeFileSync(path.join(d, 'old.yaml'), inline);
    fs.writeFileSync(path.join(d, 'new.yaml'), refd);
    try {
      const { report } = await analyze(path.join(d, 'old.yaml'), path.join(d, 'new.yaml'), {});
      expect(report.changes.filter((c) => c.severity === 'error')).toHaveLength(0);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('10k-deep ref chain terminates without RangeError (§11.7)', () => {
    const schemas: JsonObject = {};
    const doc: JsonObject = {
      openapi: '3.0.3',
      info: { title: 'T', version: '1.0' },
      components: { schemas },
    };
    for (let i = 0; i < 10_000; i++) {
      schemas[`N${i}`] = { $ref: `#/components/schemas/N${i + 1}` };
    }
    schemas.N10000 = { type: 'object' };
    expect(() => structuralDeref(doc)).not.toThrow();
  });

  it('direct ref cycle terminates (§11.7)', () => {
    const schemas: JsonObject = {};
    const doc: JsonObject = {
      openapi: '3.0.3',
      info: { title: 'T', version: '1.0' },
      components: { schemas },
    };
    schemas.A = { $ref: '#/components/schemas/A' };
    expect(() => structuralDeref(doc)).not.toThrow();
  });
});
