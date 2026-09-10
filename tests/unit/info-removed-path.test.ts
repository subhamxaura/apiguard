/**
 * Remaining document/info rules: contact, license, termsOfService, removed-path,
 * and config-driven rule disabling (classify → null branch).
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

function pairIn(dir: string, oldYaml: string, newYaml: string): [string, string] {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'old.yaml'), oldYaml);
  fs.writeFileSync(path.join(dir, 'new.yaml'), newYaml);
  return [path.join(dir, 'old.yaml'), path.join(dir, 'new.yaml')];
}

function tmpDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

const OP = `paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
`;

describe('info metadata rules (§10.1)', () => {
  it('contact-changed and license-changed fire', async () => {
    const d = tmpDir('apiguard-info-');
    const [o, n] = pairIn(
      d,
      `openapi: 3.0.3\ninfo:\n  title: A\n  version: '1.0'\n  contact:\n    name: Team A\n    email: a@example.com\n  license:\n    name: MIT\n${OP}`,
      `openapi: 3.0.3\ninfo:\n  title: A\n  version: '1.0'\n  contact:\n    name: Team B\n  license:\n    name: Apache-2.0\n${OP}`,
    );
    const { report } = await analyze(o, n, {});
    const ids = report.changes.map((c) => c.ruleId);
    expect(ids).toContain('contact-changed');
    expect(ids).toContain('license-changed');
  });
});

describe('removed-path (§10.2)', () => {
  it('a vanished path emits removed-path, not per-method rows', async () => {
    const d = tmpDir('apiguard-rp-');
    const [o, n] = pairIn(
      d,
      `openapi: 3.0.3\ninfo: {title: A, version: '1.0'}\npaths:\n  /gone:\n    get:\n      responses:\n        '200': {description: OK}\n  /kept:\n    get:\n      responses:\n        '200': {description: OK}\n`,
      `openapi: 3.0.3\ninfo: {title: A, version: '1.0'}\npaths:\n  /kept:\n    get:\n      responses:\n        '200': {description: OK}\n`,
    );
    const { report } = await analyze(o, n, {});
    const ids = report.changes.map((c) => c.ruleId);
    expect(ids).toContain('removed-path');
    expect(ids).not.toContain('removed-method');
  });
});

describe('config-driven disabling (classify → null branch)', () => {
  it('rules set to off in apiguard.yaml do not appear in the report', async () => {
    const d = tmpDir('apiguard-off-');
    const [o, n] = pairIn(
      d,
      `openapi: 3.0.3\ninfo: {title: A, version: '1.0'}\n${OP}`,
      `openapi: 3.0.3\ninfo: {title: B, version: '1.0'}\n${OP}`,
    );
    const cfgPath = path.join(d, 'apiguard.yaml');
    fs.writeFileSync(cfgPath, 'schemaVersion: 1\nrules:\n  title-changed: off\n');
    // config discovery is cwd-based (§14.1); pass the path explicitly here
    const { report } = await analyze(o, n, { configPath: cfgPath });
    expect(report.changes.find((c) => c.ruleId === 'title-changed')).toBeUndefined();
  });
});
