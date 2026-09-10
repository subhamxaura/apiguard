/** Fully-commented apiguard.yaml template (§14.3), emitted by `apiguard init`. */
export const CONFIG_TEMPLATE = `# API Guard configuration
# Docs: https://github.com/apiguard/apiguard/blob/main/docs/configuration.md
schemaVersion: 1            # required; other versions are rejected with exit 2
rules:                      # optional; values: error|warning|info|off; key = ruleId, or
  removed-path: error       #   ruleId@context-class to override one context (see docs/breaking-changes.md)
  removed-method: error
  property-removed@request-body: warning
  property-removed@response-body: error
  required-property-added: error
  property-type-changed: error
  enum-value-removed: error
ignore:                     # optional; globs via micromatch; applied after classification
  paths: []                 # matches path templates, all methods, e.g. ["/internal/**", "/metrics"]
  operations: []            # exact "METHOD /path" entries, e.g. ["GET /health", "POST /users"]
  schemas: []               # component names / pointer prefixes, e.g. ["InternalModel", "components/schemas/V1*"]
  changes: []               # ruleId globs, e.g. ["operation-id-changed", "server-*"]
  show-ignored: false       # if true: records appear flagged, excluded from counts+exit
output:
  format: terminal          # terminal|json|markdown
  include-non-breaking: false
  color: auto               # auto|always|never
fail-on: error              # error|warning|never
versioning:
  suggest: false            # print bump suggestion after every diff (same as --suggest-version)
loader:
  allow-remote-refs: false
github:                     # read only by the GitHub Action, ignored by the CLI
  comment: true
  check-run: true
  update-existing-comment: true
`;
