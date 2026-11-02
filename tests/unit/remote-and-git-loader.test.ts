import { describe, it, expect, vi, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isPrivateHost,
  fetchRemoteSpec,
  fetchGitSpec,
  loadSpec,
} from '../../src/loaders/spec-loader.js';

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
  vi.restoreAllMocks();
});

describe('SSRF Protection (isPrivateHost)', () => {
  it('correctly flags loopback and private IPv4 / IPv6 addresses', () => {
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('127.0.0.1')).toBe(true);
    expect(isPrivateHost('127.1.2.3')).toBe(true);
    expect(isPrivateHost('10.0.0.1')).toBe(true);
    expect(isPrivateHost('172.16.0.1')).toBe(true);
    expect(isPrivateHost('172.31.255.255')).toBe(true);
    expect(isPrivateHost('192.168.1.1')).toBe(true);
    expect(isPrivateHost('169.254.169.254')).toBe(true);
    expect(isPrivateHost('::1')).toBe(true);
    expect(isPrivateHost('fe80::1')).toBe(true);
    expect(isPrivateHost('fc00::1')).toBe(true);
    expect(isPrivateHost('0.0.0.0')).toBe(true);
  });

  it('allows public domain names and public IP addresses', () => {
    expect(isPrivateHost('api.example.com')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(isPrivateHost('1.1.1.1')).toBe(false);
    expect(isPrivateHost('172.15.0.1')).toBe(false);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
  });
});

describe('fetchRemoteSpec', () => {
  it('rejects private hosts when allowPrivateIps is false (SSRF guard)', async () => {
    await expect(fetchRemoteSpec('http://127.0.0.1:8080/openapi.yaml')).rejects.toThrow(
      /SSRF protection/,
    );
    await expect(fetchRemoteSpec('https://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /SSRF protection/,
    );
  });

  it('rejects unsupported protocols', async () => {
    await expect(fetchRemoteSpec('ftp://example.com/spec.yaml')).rejects.toThrow(
      /unsupported protocol/,
    );
  });

  it('fetches remote spec and saves to temp file when fetch succeeds', async () => {
    const fakeSpec = `openapi: 3.0.3\ninfo:\n  title: Remote API\n  version: '1.0'\npaths: {}\n`;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => fakeSpec,
      }),
    );

    const result = await fetchRemoteSpec('https://api.example.com/openapi.yaml');
    expect(result.text).toBe(fakeSpec);
    expect(fs.existsSync(result.localPath)).toBe(true);
    expect(fs.readFileSync(result.localPath, 'utf8')).toBe(fakeSpec);
  });
});

describe('fetchGitSpec & loadSpec git URI', () => {
  it('retrieves spec from git commit/branch using git:// URI', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiguard-git-test-'));
    tmpDirs.push(dir);
    const g = (args: string[]) => execFileSync('git', args, { cwd: dir });
    g(['init', '-q']);
    g(['config', 'user.email', 't@t']);
    g(['config', 'user.name', 't']);
    const specContent = `openapi: 3.0.3\ninfo:\n  title: Git Spec\n  version: '1.0'\npaths: {}\n`;
    fs.writeFileSync(path.join(dir, 'spec.yaml'), specContent);
    g(['add', '.']);
    g(['commit', '-qm', 'initial spec']);

    const res = fetchGitSpec(`git:HEAD:spec.yaml`, dir);
    expect(res.text).toBe(specContent);
    expect(fs.existsSync(res.localPath)).toBe(true);

    // Test through loadSpec
    const loaded = await loadSpec(`git:HEAD:spec.yaml`, { cwd: dir });
    expect(loaded.title).toBe('Git Spec');
    expect(loaded.openapiVersion).toBe('3.0.3');
  });
});
