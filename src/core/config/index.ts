export {
  discoverAndLoadConfig,
  loadConfigFrom,
  discoverConfigPaths,
  applyAliases,
  mergeWithFlags,
  CONFIG_FILE_CANDIDATES,
  LEGACY_RULE_ALIASES,
  type LoadedConfig,
} from './loader.js';
export {
  configSchema,
  severityValueSchema,
  type ResolvedConfig,
  type RawFileConfig,
  type ParsedFileConfig,
} from './schema.js';
export { DEFAULT_CONFIG } from './defaults.js';
