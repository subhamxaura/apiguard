/** Config loading, discovery, aliases, and precedence per spec §14. */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';
import {
  configSchema,
  type ParsedFileConfig,
  type ResolvedConfig,
} from './schema.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { ConfigError, errorMessage } from '../../utils/errors.js';

/** Discovery order per §14.1 (relative to cwd). */
export const CONFIG_FILE_CANDIDATES = [
  'apiguard.yaml',
  'apiguard.yml',
  'apiguard.json',
  '.apiguard.yaml',
  '.apiguard.yml',
] as const;

/**
 * v1 alias map per §14.3. Each legacy id scoped to one context, so migrating configs never
 * silently downgrade the other contexts. Deprecation warnings go to stderr.
 */
export const LEGACY_RULE_ALIASES: Record<string, { canonical: string; scope?: string }> = {
  'removed-request-property': { canonical: 'property-removed', scope: 'request-body' },
  'removed-response-property': { canonical: 'property-removed', scope: 'response-body' },
  'new-required-request-property': { canonical: 'required-property-added', scope: 'request-body' },
};

export interface LoadedConfig {
  config: ResolvedConfig;
  /** Path of the file the config came from ('' when defaults only). */
  sourcePath: string;
  /** Deprecation warnings collected during load (printed to stderr by the CLI). */
  warnings: string[];
}

/** Candidate paths in discovery order; '' entries mean "not found". */
export function discoverConfigPaths(explicit?: string, env?: string): string[] {
  if (explicit) return [explicit];
  if (env) return [env];
  return CONFIG_FILE_CANDIDATES.map(String);
}

function readConfigFile(filePath: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new ConfigError(`config file not found: ${filePath}`);
  }
  try {
    if (filePath.toLowerCase().endsWith('.json')) return JSON.parse(text);
    return parseYaml(text);
  } catch (e) {
    throw new ConfigError(`${filePath}: invalid YAML/JSON: ${errorMessage(e)}`);
  }
}

/** Map kebab-case file keys onto the camelCase ResolvedConfig. */
function toResolved(parsed: ParsedFileConfig): ResolvedConfig {
  return {
    schemaVersion: 1,
    rules: parsed.rules ?? {},
    ignore: {
      paths: parsed.ignore?.paths ?? [],
      operations: parsed.ignore?.operations ?? [],
      schemas: parsed.ignore?.schemas ?? [],
      changes: parsed.ignore?.changes ?? [],
      showIgnored: parsed.ignore?.['show-ignored'] ?? false,
    },
    output: {
      format: parsed.output?.format ?? 'terminal',
      includeNonBreaking: parsed.output?.['include-non-breaking'] ?? false,
      color: parsed.output?.color ?? 'auto',
    },
    failOn: parsed['fail-on'] ?? 'error',
    versioning: { suggest: parsed.versioning?.suggest ?? true },
    loader: { allowRemoteRefs: parsed.loader?.['allow-remote-refs'] ?? false },
    github: {
      comment: parsed.github?.comment ?? true,
      checkRun: parsed.github?.['check-run'] ?? true,
      updateExistingComment: parsed.github?.['update-existing-comment'] ?? true,
    },
  };
}

/** Validate + resolve a raw config object (already alias-rewritten). */
export function resolveConfigObject(raw: unknown, sourcePath: string): ResolvedConfig {
  let parsed: ParsedFileConfig;
  try {
    parsed = configSchema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      const where = first?.path?.length ? ` at key "${first.path.join('.')}"` : '';
      throw new ConfigError(
        `${sourcePath}: invalid config${where}: ${first?.message ?? 'validation failed'}`,
      );
    }
    throw new ConfigError(`${sourcePath}: invalid config: ${errorMessage(e)}`);
  }
  return toResolved(parsed);
}

/** Apply legacy rule aliases to a raw config map, collecting deprecation warnings. */
export function applyAliases(raw: unknown, warnings: string[]): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  const rules = obj.rules;
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) return raw;
  const out: Record<string, unknown> = { ...obj, rules: { ...(rules as Record<string, unknown>) } };
  for (const key of Object.keys(out.rules as Record<string, unknown>)) {
    const alias = LEGACY_RULE_ALIASES[key];
    if (alias) {
      const canonicalKey = alias.scope ? `${alias.canonical}@${alias.scope}` : alias.canonical;
      const value = (out.rules as Record<string, unknown>)[key];
      delete (out.rules as Record<string, unknown>)[key];
      // never silently downgrade the other contexts: canonical non-scoped key untouched
      (out.rules as Record<string, unknown>)[canonicalKey] = value;
      warnings.push(
        `config: rule key "${key}" is deprecated (v1 alias); use "${canonicalKey}" instead`,
      );
    }
  }
  return out;
}

/** Load config from an explicit path (missing file → ConfigError, exit 2). */
export function loadConfigFrom(explicitPath: string): LoadedConfig {
  const warnings: string[] = [];
  const raw = readConfigFile(explicitPath);
  const withAliases = applyAliases(raw, warnings);
  const config = resolveConfigObject(withAliases, explicitPath);
  return { config, sourcePath: explicitPath, warnings };
}

/** Discover config per §14.1; returns defaults when nothing is found. */
export function discoverAndLoadConfig(opts: {
  explicit?: string;
  env?: string;
  cwd?: string;
} = {}): LoadedConfig {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.explicit || opts.env) {
    const target = opts.explicit ?? opts.env ?? '';
    const abs = path.isAbsolute(target) ? target : path.resolve(cwd, target);
    if (!fs.existsSync(abs)) {
      throw new ConfigError(`config file not found: ${abs}`);
    }
    return loadConfigFrom(abs);
  }
  for (const candidate of CONFIG_FILE_CANDIDATES) {
    const abs = path.resolve(cwd, candidate);
    if (fs.existsSync(abs)) {
      return loadConfigFrom(abs);
    }
  }
  return { config: { ...DEFAULT_CONFIG }, sourcePath: '', warnings: [] };
}

/** Merge CLI flags over a resolved config (§14.2 precedence: CLI > env > file > defaults). */
export function mergeWithFlags(
  base: ResolvedConfig,
  flags: {
    format?: 'terminal' | 'json' | 'markdown';
    failOn?: 'error' | 'warning' | 'never';
    includeNonBreaking?: boolean;
    suggestVersion?: boolean;
    noColor?: boolean;
    showIgnored?: boolean;
  },
): ResolvedConfig {
  return {
    ...base,
    output: {
      format: flags.format ?? base.output.format,
      includeNonBreaking: flags.includeNonBreaking ?? base.output.includeNonBreaking,
      color: flags.noColor ? 'never' : base.output.color,
    },
    failOn: flags.failOn ?? base.failOn,
    versioning: {
      suggest: flags.suggestVersion ?? base.versioning.suggest,
    },
  };
}

export { DEFAULT_CONFIG };
