import { describe, it, expect, afterEach } from 'vitest';
import { analyze } from '../../src/core/engine/analyze.js';
import { resolveContextSeverity } from '../../src/core/engine/classify.js';
import { normalizeDocument } from '../../src/core/engine/normalize.js';
import { renderJunit } from '../../src/reporters/junit.js';
import { renderSarif } from '../../src/reporters/sarif.js';
import { generateGatewayShim } from '../../src/codegen/shim.js';
import { run, type CliIo } from '../../src/cli/run.js';
import type { DiffReport } from '../../src/core/models/report.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tmpDirs = [];
});

function pair(oldYaml: string, newYaml: string): [string, string] {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-remed-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'old.yaml'), oldYaml);
  fs.writeFileSync(path.join(d, 'new.yaml'), newYaml);
  return [path.join(d, 'old.yaml'), path.join(d, 'new.yaml')];
}

describe('Phase 2 & 3: Postel Law Inversion for Constraints', () => {
  it('inverts severity for constraints between send (request) and parse (response)', () => {
    // Send side (request-body)
    expect(resolveContextSeverity('constraint-relaxed', 'request-body', {})).toBe('info');
    expect(resolveContextSeverity('constraint-removed', 'request-body', {})).toBe('info');
    expect(resolveContextSeverity('constraint-tightened', 'request-body', {})).toBe('error');
    expect(resolveContextSeverity('constraint-added', 'request-body', {})).toBe('error');

    // Parse side (response-body)
    expect(resolveContextSeverity('constraint-relaxed', 'response-body', {})).toBe('error');
    expect(resolveContextSeverity('constraint-removed', 'response-body', {})).toBe('error');
    expect(resolveContextSeverity('constraint-tightened', 'response-body', {})).toBe('info');
    expect(resolveContextSeverity('constraint-added', 'response-body', {})).toBe('info');

    // Webhooks are parse side
    expect(resolveContextSeverity('constraint-relaxed', 'webhook', {})).toBe('error');
    expect(resolveContextSeverity('constraint-tightened', 'webhook', {})).toBe('info');
  });

  it('reports constraint relaxation in responses as breaking error', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /users:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                type: string
                maxLength: 50
`;
    const newSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /users:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                type: string
                maxLength: 100
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    const change = report.changes.find((c) => c.ruleId === 'constraint-relaxed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('error');
    expect(change?.breaking).toBe(true);
  });
});

describe('Phase 3: Schemaless nullable: true Normalization', () => {
  it('normalizes schemaless nullable: true to type: ["null"]', () => {
    const raw = {
      nullable: true,
      description: 'anything or null',
    };
    const norm = normalizeDocument(raw) as Record<string, unknown>;
    expect(norm.nullable).toBeUndefined();
    expect(norm.type).toEqual(['null']);
    expect(Object.keys(norm)).toEqual(['description', 'type']);
  });
});

describe('Phase 3: Security Scheme Diffing', () => {
  it('detects apiKey name change as api-key-location-changed', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths: {}
components:
  securitySchemes:
    auth:
      type: apiKey
      name: X-Old-Key
      in: header
`;
    const newSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths: {}
components:
  securitySchemes:
    auth:
      type: apiKey
      name: X-New-Key
      in: header
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    const ch = report.changes.find(
      (c) => c.ruleId === 'api-key-location-changed' && c.location.pointerNew.includes('/name'),
    );
    expect(ch).toBeDefined();
    expect(ch?.oldValue).toBe('X-Old-Key');
    expect(ch?.newValue).toBe('X-New-Key');
  });

  it('detects http scheme and openIdConnectUrl changes', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths: {}
components:
  securitySchemes:
    httpAuth:
      type: http
      scheme: bearer
    oidcAuth:
      type: openIdConnect
      openIdConnectUrl: https://old.auth.com
`;
    const newSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths: {}
components:
  securitySchemes:
    httpAuth:
      type: http
      scheme: basic
    oidcAuth:
      type: openIdConnect
      openIdConnectUrl: https://new.auth.com
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    const httpCh = report.changes.find(
      (c) => c.ruleId === 'security-type-changed' && c.location.pointerNew.includes('/scheme'),
    );
    expect(httpCh).toBeDefined();
    expect(httpCh?.oldValue).toBe('bearer');
    expect(httpCh?.newValue).toBe('basic');

    const oidcCh = report.changes.find(
      (c) =>
        c.ruleId === 'security-type-changed' && c.location.pointerNew.includes('/openIdConnectUrl'),
    );
    expect(oidcCh).toBeDefined();
    expect(oidcCh?.oldValue).toBe('https://old.auth.com');
    expect(oidcCh?.newValue).toBe('https://new.auth.com');
  });
});

describe('Phase 2: Parameter Keying & Style Diffing', () => {
  it('distinguishes query and header parameters with identical names', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /data:
    get:
      parameters:
        - name: id
          in: query
          required: false
          schema: { type: string }
        - name: id
          in: header
          required: false
          schema: { type: string }
      responses:
        '200': { description: OK }
`;
    const newSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /data:
    get:
      parameters:
        - name: id
          in: query
          required: false
          schema: { type: string }
      responses:
        '200': { description: OK }
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    const removed = report.changes.filter((c) => c.ruleId === 'removed-parameter');
    expect(removed.length).toBe(1);
    expect(removed[0]!.location.context).toBe('request-header');
  });

  it('emits parameter-style-changed when style or explode changes', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /items:
    get:
      parameters:
        - name: tags
          in: query
          style: form
          explode: true
          schema:
            type: array
            items: { type: string }
      responses:
        '200': { description: OK }
`;
    const newSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /items:
    get:
      parameters:
        - name: tags
          in: query
          style: spaceDelimited
          explode: false
          schema:
            type: array
            items: { type: string }
      responses:
        '200': { description: OK }
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    const styleCh = report.changes.find((c) => c.ruleId === 'parameter-style-changed');
    expect(styleCh).toBeDefined();
    expect(styleCh?.severity).toBe('warning');
  });
});

describe('Phase 2 & 3: Webhook Operations, Response Headers & Multipart Encoding', () => {
  it('recurses into common webhook operations', async () => {
    const oldSpec = `openapi: 3.1.0
info: { title: T, version: '1.0' }
webhooks:
  userRegistered:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                userId: { type: string }
                role: { type: string }
              required: [userId, role]
      responses:
        '200': { description: OK }
`;
    const newSpec = `openapi: 3.1.0
info: { title: T, version: '1.0' }
webhooks:
  userRegistered:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                userId: { type: string }
              required: [userId]
      responses:
        '200': { description: OK }
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    const propRemoved = report.changes.find(
      (c) => c.ruleId === 'property-removed' && c.location.context === 'webhook',
    );
    expect(propRemoved).toBeDefined();
    expect(propRemoved?.oldValue).toBe('role');
    expect(propRemoved?.severity).toBe('error'); // webhook is parse side
  });

  it('diffs response header schemas', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /data:
    get:
      responses:
        '200':
          description: OK
          headers:
            X-Rate-Limit:
              schema:
                type: integer
`;
    const newSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /data:
    get:
      responses:
        '200':
          description: OK
          headers:
            X-Rate-Limit:
              schema:
                type: string
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    const typeCh = report.changes.find(
      (c) => c.location.context === 'response-header' && c.ruleId.includes('type-changed'),
    );
    expect(typeCh).toBeDefined();
  });

  it('diffs multipart/form-data encoding', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /upload:
    post:
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                avatar: { type: string, format: binary }
            encoding:
              avatar:
                contentType: image/png
      responses:
        '200': { description: OK }
`;
    const newSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /upload:
    post:
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                avatar: { type: string, format: binary }
            encoding:
              avatar:
                contentType: image/jpeg
      responses:
        '200': { description: OK }
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    const encCh = report.changes.find((c) => c.ruleId === 'encoding-changed');
    expect(encCh).toBeDefined();
    expect(encCh?.severity).toBe('warning');
  });
});

describe('Phase 4: JUnit XML Reporter', () => {
  it('renders clean JUnit XML for reports with and without failures', () => {
    const emptyReport: DiffReport = {
      schemaVersion: '1.0',
      tool: { name: 'apiguard', version: '1.0.0' },
      baseline: { source: 'a.yaml', openapiVersion: '3.0.3', title: 'A', sha256: 'sha1' },
      current: { source: 'b.yaml', openapiVersion: '3.0.3', title: 'B', sha256: 'sha2' },
      summary: {
        total: 0,
        bySeverity: { error: 0, warning: 0, info: 0 },
        byKind: { addition: 0, removal: 0, modification: 0, relaxation: 0, documentation: 0 },
        ignored: 0,
      },
      semver: { bump: 'none', reason: 'clean', triggers: [] },
      changes: [],
    };
    const xml = renderJunit(emptyReport);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('failures="0"');
    expect(xml).toContain('<testcase classname="api" name="contract-compatibility" time="0"/>');

    const errorReport: DiffReport = {
      ...emptyReport,
      summary: {
        total: 2,
        bySeverity: { error: 1, warning: 1, info: 0 },
        byKind: { addition: 0, removal: 1, modification: 1, relaxation: 0, documentation: 0 },
        ignored: 0,
      },
      changes: [
        {
          id: '1',
          ruleId: 'removed-path',
          severity: 'error',
          kind: 'removal',
          breaking: true,
          message: 'Path /v1/users removed',
          suggestion: 'Check clients',
          location: { path: '/v1/users', context: 'operation', pointerOld: '', pointerNew: '' },
        },
        {
          id: '2',
          ruleId: 'parameter-style-changed',
          severity: 'warning',
          kind: 'modification',
          breaking: false,
          message: 'Style changed',
          suggestion: 'Check serialization',
          location: { path: '/v1/items', context: 'parameter', pointerOld: '', pointerNew: '' },
        },
      ],
    };
    const errorXml = renderJunit(errorReport);
    expect(errorXml).toContain('tests="2" failures="1"');
    expect(errorXml).toContain('<failure message="Path /v1/users removed" type="removed-path">');
    expect(errorXml).toContain('<system-out>[WARNING] Style changed');
  });
});

describe('Phase 2: Structural Composition Matching', () => {
  it('does not emit false-positive property-type-changed when prepending oneOf variant', async () => {
    const oldSpec = `openapi: 3.1.0
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                oneOf:
                  - type: string
`;
    const newSpec = `openapi: 3.1.0
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                oneOf:
                  - type: number
                  - type: string
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    const ruleIds = report.changes.map((c) => c.ruleId);
    expect(ruleIds).toContain('anyOf-oneOf-member-added');
    expect(ruleIds).not.toContain('property-type-changed');
  });

  it('emits no diffs when oneOf variants are simply reordered', async () => {
    const oldSpec = `openapi: 3.1.0
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                oneOf:
                  - type: string
                  - type: number
`;
    const newSpec = `openapi: 3.1.0
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                oneOf:
                  - type: number
                  - type: string
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    expect(report.changes).toHaveLength(0);
  });
});

describe('Phase 4: SARIF URI Sanitization', () => {
  it('strips leading ./ from artifactLocation.uri for GitHub Code Scanning compliance', () => {
    const dummyReport: DiffReport = {
      schemaVersion: '1.0',
      tool: { name: 'apiguard', version: '1.0.0' },
      baseline: { source: './specs/old.yaml', openapiVersion: '3.0.3', title: 'A', sha256: 'sha1' },
      current: { source: './specs/new.yaml', openapiVersion: '3.0.3', title: 'B', sha256: 'sha2' },
      summary: {
        total: 1,
        bySeverity: { error: 1, warning: 0, info: 0 },
        byKind: { addition: 0, removal: 1, modification: 0, relaxation: 0, documentation: 0 },
        ignored: 0,
      },
      semver: { bump: 'major', reason: 'breaking', triggers: [] },
      changes: [
        {
          id: '1',
          ruleId: 'removed-path',
          severity: 'error',
          kind: 'removal',
          breaking: true,
          message: 'Path removed',
          suggestion: 'Fix it',
          location: {
            path: '/users',
            context: 'operation',
            pointerOld: '',
            pointerNew: '',
            file: './specs/new.yaml',
          },
        },
      ],
    };
    const sarifJson = JSON.parse(renderSarif(dummyReport));
    const uri = sarifJson.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    expect(uri).toBe('specs/new.yaml');
    expect(uri.startsWith('./')).toBe(false);
  });
});

describe('Phase 1: CLI Error & Help Stderr Cleanliness', () => {
  function ioFor(argv: string[]): CliIo & { out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      argv: ['node', 'apiguard', ...argv],
      env: { ...process.env },
      out,
      err,
    };
  }

  it('--help prints to stdout with zero stderr output', async () => {
    const io = ioFor(['--help']);
    const code = await run(io);
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('Usage: apiguard');
    expect(io.err).toEqual([]);
  });

  it('missing argument emits exactly one error line on stderr', async () => {
    const io = ioFor(['diff']);
    const code = await run(io);
    expect(code).toBe(2);
    expect(io.err).toHaveLength(1);
    expect(io.err[0]).toContain("error: missing required argument 'old-spec'");
  });
});

describe('Phase 4: Codegen Shims Enhancements', () => {
  const sampleReport: DiffReport = {
    schemaVersion: '1.0',
    tool: { name: 'apiguard', version: '1.0.0' },
    baseline: { source: 'a.yaml', openapiVersion: '3.0.3', title: 'A', sha256: 'sha1' },
    current: { source: 'b.yaml', openapiVersion: '3.0.3', title: 'B', sha256: 'sha2' },
    summary: {
      total: 2,
      bySeverity: { error: 2, warning: 0, info: 0 },
      byKind: { addition: 1, removal: 1, modification: 0, relaxation: 0, documentation: 0 },
      ignored: 0,
    },
    semver: { bump: 'major', reason: 'breaking', triggers: [] },
    changes: [
      {
        id: '1',
        ruleId: 'removed-path',
        severity: 'error',
        kind: 'removal',
        breaking: true,
        message: 'Path /v1/old removed',
        suggestion: '',
        location: { path: '/v1/old', context: 'operation', pointerOld: '', pointerNew: '' },
      },
      {
        id: '2',
        ruleId: 'parameter-added-required',
        severity: 'error',
        kind: 'addition',
        breaking: true,
        message: 'Required parameter apiKey added',
        suggestion: '',
        location: {
          path: '/v1/users/{id}',
          method: 'GET',
          context: 'parameter',
          pointerOld: '',
          pointerNew: '/paths/~1v1~1users~1{id}/get/parameters/apiKey',
        },
      },
    ],
  };

  it('generates Express shim with path matching and parameter defaults', () => {
    const res = generateGatewayShim(sampleReport, 'express');
    expect(res.target).toBe('express');
    expect(res.handledChanges).toBe(2);
    expect(res.code).toContain("path === '/v1/old'");
    expect(res.code).toContain('res.status(410).json');
    expect(res.code).toContain("req.query['apiKey'] = 'default'");
  });

  it('generates Cloudflare Worker shim with path intercept and searchParams defaults', () => {
    const res = generateGatewayShim(sampleReport, 'cloudflare-worker');
    expect(res.target).toBe('cloudflare-worker');
    expect(res.handledChanges).toBe(2);
    expect(res.code).toContain("url.pathname === '/v1/old'");
    expect(res.code).toContain('status: 410');
    expect(res.code).toContain("url.searchParams.set('apiKey', 'default')");
  });

  it('matches composition members by title', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                oneOf:
                  - title: ModelA
                    type: string
`;
    const newSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                oneOf:
                  - title: ModelA
                    type: integer
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    expect(report.changes.some((c) => c.ruleId === 'property-type-changed')).toBe(true);
  });

  it('detects discriminator removed', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                discriminator:
                  propertyName: petType
`;
    const newSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    expect(report.changes.some((c) => c.ruleId === 'discriminator-changed')).toBe(true);
  });

  it('detects response header schema changes', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          description: ok
          headers:
            X-Rate-Limit:
              schema:
                type: integer
`;
    const newSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          description: ok
          headers:
            X-Rate-Limit:
              schema:
                type: string
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    expect(report.changes.some((c) => c.ruleId === 'property-type-changed')).toBe(true);
  });

  it('supports --format junit in cli diff', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths: {}
`;
    const [o, n] = pair(oldSpec, oldSpec);
    const stdoutLines: string[] = [];
    const io: CliIo = {
      argv: ['node', 'apiguard', 'diff', o, n, '--format', 'junit', '--allow-external-files'],
      env: {},
      stdout: (m) => stdoutLines.push(m),
      stderr: () => {},
    };
    const code = await run(io);
    expect(code).toBe(0);
    expect(stdoutLines.join('')).toContain('<?xml version="1.0"');
  });

  it('covers diff-command branches for gitBase, missing spec, and open flag', async () => {
    const ioMissing: CliIo = {
      argv: ['node', 'apiguard', 'diff'],
      env: {},
      stdout: () => {},
      stderr: () => {},
    };
    expect(await run(ioMissing)).toBe(2);

    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths: {}
`;
    const [o, n] = pair(oldSpec, oldSpec);
    const ioGit: CliIo = {
      argv: ['node', 'apiguard', 'diff', o, '--git-base', 'main'],
      env: {},
      stdout: () => {},
      stderr: () => {},
    };
    await run(ioGit).catch(() => {});

    const outHtml = path.join(path.dirname(o), 'out.html');
    const ioOpen: CliIo = {
      argv: ['node', 'apiguard', 'diff', o, n, '--output', outHtml, '--open'],
      env: {},
      stdout: () => {},
      stderr: () => {},
    };
    expect(await run(ioOpen)).toBe(0);
    expect(fs.existsSync(outHtml)).toBe(true);
  });

  it('covers composition matching by type and positional fallback', async () => {
    const oldSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                oneOf:
                  - type: string
                    minLength: 2
                  - minimum: 1
`;
    const newSpec = `openapi: 3.0.3
info: { title: T, version: '1.0' }
paths:
  /test:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                oneOf:
                  - type: string
                    minLength: 5
                  - minimum: 10
`;
    const [o, n] = pair(oldSpec, newSpec);
    const { report } = await analyze(o, n, {});
    expect(report.changes.length).toBeGreaterThan(0);
  });
});
