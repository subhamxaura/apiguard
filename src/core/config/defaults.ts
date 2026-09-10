import type { ResolvedConfig } from './schema.js';

/** Defaults per spec §14 — every field fully populated. */
export const DEFAULT_CONFIG: ResolvedConfig = {
  schemaVersion: 1,
  rules: {},
  ignore: {
    paths: [],
    operations: [],
    schemas: [],
    changes: [],
    showIgnored: false,
  },
  output: {
    format: 'terminal',
    includeNonBreaking: false,
    color: 'auto',
  },
  failOn: 'error',
  // §13 golden output shows the bump line "only with --suggest-version"; config may opt in.
  versioning: { suggest: false },
  loader: { allowRemoteRefs: false },
  github: { comment: true, checkRun: true, updateExistingComment: true },
};
