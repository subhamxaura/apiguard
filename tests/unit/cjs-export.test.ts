import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CJS_PATH = path.resolve(import.meta.dirname, '../../dist/index.cjs');

describe('CJS library export (dist/index.cjs)', () => {
  beforeAll(() => {
    if (!fs.existsSync(CJS_PATH)) {
      const ROOT = path.resolve(import.meta.dirname, '../..');
      execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'pipe' });
    }
  });

  it('exports public library API without side effects', () => {
    const mod = require(CJS_PATH);
    expect(typeof mod.analyze).toBe('function');
    expect(typeof mod.validateSpec).toBe('function');
    expect(typeof mod.suggestVersion).toBe('function');
    expect(typeof mod.renderHtml).toBe('function');
    expect(typeof mod.renderSarif).toBe('function');
    expect(typeof mod.renderJunit).toBe('function');
    expect(typeof mod.renderChangelog).toBe('function');
    expect(typeof mod.generateGatewayShim).toBe('function');
    expect(typeof mod.discoverAndLoadConfig).toBe('function');
  });
});
