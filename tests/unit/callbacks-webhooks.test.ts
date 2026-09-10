/** §10.2 callback/webhook rules through the full pipeline. */
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-cb-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'old.yaml'), oldYaml);
  fs.writeFileSync(path.join(d, 'new.yaml'), newYaml);
  return [path.join(d, 'old.yaml'), path.join(d, 'new.yaml')];
}

const DOC = (version: string, extras: string) => `openapi: ${version}
info: {title: T, version: '1.0'}
paths:
  /subscribe:
    post:
      responses:
        '200': {description: OK}
${extras}
`;

describe('§10.2 callbacks & webhooks', () => {
  it('callback added → info, removed → error (3.0)', async () => {
    const without = '';
    const withCb = `      callbacks:
        userChanged:
          '{$request.body#/url}':
            post:
              responses:
                '200': {description: OK}
`;
    const [o1, n1] = pair(DOC('3.0.3', without), DOC('3.0.3', withCb));
    const { report } = await analyze(o1, n1, {});
    const added = report.changes.find((c) => c.ruleId === 'callback-added');
    expect(added?.severity).toBe('info');

    const [o2, n2] = pair(DOC('3.0.3', withCb), DOC('3.0.3', without));
    const { report: r2 } = await analyze(o2, n2, {});
    const removed = r2.changes.find((c) => c.ruleId === 'callback-removed');
    expect(removed?.severity).toBe('error');
  });

  it('webhook added → info, removed → error (3.1)', async () => {
    const without = '';
    const withWh = `webhooks:
  userCreated:
    post:
      responses:
        '200': {description: OK}
`;
    const [o1, n1] = pair(DOC('3.1.0', without), DOC('3.1.0', withWh));
    const { report } = await analyze(o1, n1, {});
    expect(report.changes.some((c) => c.ruleId === 'webhook-added' && c.severity === 'info')).toBe(true);

    const [o2, n2] = pair(DOC('3.1.0', withWh), DOC('3.1.0', without));
    const { report: r2 } = await analyze(o2, n2, {});
    expect(r2.changes.some((c) => c.ruleId === 'webhook-removed' && c.severity === 'error')).toBe(true);
  });
});
