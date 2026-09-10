/** Zod config schema per spec §14.3. Keys use the kebab-case spelling from the spec. */
import { z } from 'zod';

export const severityValueSchema = z.enum(['error', 'warning', 'info', 'off']);

/** Rule keys are ruleIds or `ruleId@context` scoped overrides (§10.5/§14.3). */
export const rulesSchema = z.record(z.string().min(1), severityValueSchema);

export const ignoreSchema = z.strictObject({
  paths: z.array(z.string()).optional().default([]),
  operations: z.array(z.string()).optional().default([]),
  schemas: z.array(z.string()).optional().default([]),
  changes: z.array(z.string()).optional().default([]),
  'show-ignored': z.boolean().optional().default(false),
});

export const outputSchema = z.strictObject({
  format: z.enum(['terminal', 'json', 'markdown']).optional().default('terminal'),
  'include-non-breaking': z.boolean().optional().default(false),
  color: z.enum(['auto', 'always', 'never']).optional().default('auto'),
});

export const versioningSchema = z.strictObject({
  suggest: z.boolean().optional().default(true),
});

export const loaderSchema = z.strictObject({
  'allow-remote-refs': z.boolean().optional().default(false),
});

export const githubSchema = z.strictObject({
  comment: z.boolean().optional().default(true),
  'check-run': z.boolean().optional().default(true),
  'update-existing-comment': z.boolean().optional().default(true),
});

export const configSchema = z.strictObject({
  schemaVersion: z.literal(1, {
    error: 'schemaVersion must be 1 (other versions are rejected; see docs/configuration.md)',
  }),
  rules: rulesSchema.optional().default({}),
  ignore: ignoreSchema.optional(),
  output: outputSchema.optional(),
  'fail-on': z.enum(['error', 'warning', 'never']).optional(),
  versioning: versioningSchema.optional(),
  loader: loaderSchema.optional(),
  github: githubSchema.optional(),
});

export type RawFileConfig = z.input<typeof configSchema>;
export type ParsedFileConfig = z.output<typeof configSchema>;

/** Internal, camelCase-shaped resolved configuration consumed by the engine/CLI. */
export interface ResolvedConfig {
  schemaVersion: 1;
  rules: Record<string, 'error' | 'warning' | 'info' | 'off'>;
  ignore: {
    paths: string[];
    operations: string[];
    schemas: string[];
    changes: string[];
    showIgnored: boolean;
  };
  output: {
    format: 'terminal' | 'json' | 'markdown';
    includeNonBreaking: boolean;
    color: 'auto' | 'always' | 'never';
  };
  failOn: 'error' | 'warning' | 'never';
  versioning: { suggest: boolean };
  loader: { allowRemoteRefs: boolean };
  github: { comment: boolean; checkRun: boolean; updateExistingComment: boolean };
}
