/**
 * Canonical rule registry per spec §10 — the normative table as code.
 * Every rule has: id, default severity, default kind, trigger description, and message/
 * suggestion templates. Detectors emit candidates; classify() resolves severity here.
 * Docs (docs/breaking-changes.md) are generated from this registry (§20.1).
 */
import type { ChangeKind, Context, Severity } from '../models/change.js';
import type { ChangeLocation } from '../models/change.js';

export interface TemplateContext {
  location: ChangeLocation;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface RuleDefinition {
  id: string;
  defaultSeverity: Severity;
  defaultKind: ChangeKind;
  /** Contexts this rule can fire in (§4 taxonomy). */
  contexts: Context[];
  /** Trigger description used for docs. */
  trigger: string;
  /** Human sentence, stable template. */
  message: (ctx: TemplateContext) => string;
  /** Required suggestion for every change. */
  suggestion: (ctx: TemplateContext) => string;
}

// ---- shared wording helpers -------------------------------------------------

function fmt(v: unknown): string {
  if (v === undefined) return 'absent';
  if (typeof v === 'string') return `\`${v}\``;
  if (v === null) return 'null';
  return `\`${JSON.stringify(v)}\``;
}

function sideLabel(loc: ChangeLocation): string {
  switch (loc.context) {
    case 'request-body':
      return 'Request property';
    case 'response-body':
      return 'Response property';
    case 'request-header':
      return 'Request header';
    case 'response-header':
      return 'Response header';
    case 'parameter':
      return 'Parameter';
    case 'component':
      return 'Component property';
    case 'callback':
      return 'Callback payload property';
    case 'webhook':
      return 'Webhook payload property';
    default:
      return 'Property';
  }
}

function whereLabel(loc: ChangeLocation): string {
  switch (loc.context) {
    case 'component':
      return loc.componentName ? ` in component ${loc.componentName}` : ' in component';
    case 'parameter':
      return ' parameter';
    default:
      return '';
  }
}

function nameOf(ctx: TemplateContext): string {
  // last pointer token is the property/param name; removals carry only pointerOld
  const source = ctx.location.pointerNew || ctx.location.pointerOld;
  const tokens = source.split('/').filter(Boolean);
  const last = tokens[tokens.length - 1];
  return (last ?? 'value').replace(/~1/g, '/').replace(/~0/g, '~');
}

// ---- registry ---------------------------------------------------------------

export const RULES: RuleDefinition[] = [
  // ---------------- §10.1 API / document level ----------------
  {
    id: 'openapi-version-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['api'],
    trigger: 'The `openapi` version field changed (after normalization).',
    message: (c) => `OpenAPI version changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'verify tooling supports the new OpenAPI version',
  },
  {
    id: 'title-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['api'],
    trigger: 'The document title changed.',
    message: (c) => `API title changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'update generated clients/docs that embed the title',
  },
  {
    id: 'description-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['api'],
    trigger: 'The document description changed.',
    message: (c) => `API description changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'no functional impact; update dependent docs if desired',
  },
  {
    id: 'server-url-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['api'],
    trigger: 'A server URL was added (treated as additive in v1).',
    message: (c) => `Server URL added: ${fmt(c.newValue)}`,
    suggestion: () => 'clients can now target the new server; no action required',
  },
  {
    id: 'server-url-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['api'],
    trigger: 'A server URL was removed (clients may still target it).',
    message: (c) => `Server URL removed: ${fmt(c.oldValue)}`,
    suggestion: () => 'publish a migration note; clients pinned to this URL will fail',
  },
  {
    id: 'server-metadata-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['api'],
    trigger: 'Server description or variables changed.',
    message: (c) => `Server metadata changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'review server variable defaults for environment impact',
  },
  {
    id: 'external-docs-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['api'],
    trigger: 'externalDocs changed.',
    message: (c) => `External docs changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'update bookmarks/links to external documentation',
  },
  {
    id: 'license-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['api'],
    trigger: 'License metadata changed.',
    message: (c) => `License changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'review licensing implications before publishing',
  },
  {
    id: 'contact-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['api'],
    trigger: 'Contact metadata changed.',
    message: (c) => `Contact changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'update support contacts in client tooling',
  },

  // ---------------- §10.2 Operation level ----------------
  {
    id: 'operation-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['operation'],
    trigger: 'A new path+method was added.',
    message: (c) =>
      `Operation added: ${String(c.location.method ?? '').toUpperCase()} ${c.location.path}`,
    suggestion: () => 'additive; regenerate clients to expose the new operation',
  },
  {
    id: 'removed-method',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['operation'],
    trigger: 'The path still exists but a method disappeared.',
    message: (c) =>
      `Operation removed: ${String(c.location.method ?? '').toUpperCase()} ${c.location.path}`,
    suggestion: () => 'clients calling this operation will get 404/405; version the API instead',
  },
  {
    id: 'removed-path',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['operation'],
    trigger: 'An entire path disappeared (reported once instead of per-method rows).',
    message: (c) => `Path removed: ${c.location.path} (all operations)`,
    suggestion: () => 'clients using any operation under this path will break; version the API',
  },
  {
    id: 'operation-id-changed',
    defaultSeverity: 'warning',
    defaultKind: 'modification',
    contexts: ['operation'],
    trigger: 'operationId changed (SDK/client code impact).',
    message: (c) =>
      `operationId changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'regenerate SDKs; code referencing the old method name must be updated',
  },
  {
    id: 'operation-deprecated-added',
    defaultSeverity: 'warning',
    defaultKind: 'modification',
    contexts: ['operation'],
    trigger: '`deprecated: true` was added to an operation.',
    message: () => 'Operation is now deprecated',
    suggestion: () => 'plan migration before the deprecation window ends',
  },
  {
    id: 'operation-deprecated-removed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['operation'],
    trigger: 'Deprecation was removed from an operation.',
    message: () => 'Operation deprecation removed',
    suggestion: () => 'update client roadmaps that tracked this deprecation',
  },
  {
    id: 'operation-tags-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['operation'],
    trigger: 'The operation tag list changed in either direction.',
    message: (c) => `Operation tags changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'update client grouping/filtering that relies on tags',
  },
  {
    id: 'operation-summary-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['operation'],
    trigger: 'The operation summary changed.',
    message: (c) => `Operation summary changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'documentation-only change',
  },
  {
    id: 'operation-description-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['operation'],
    trigger: 'The operation description changed.',
    message: (c) => `Operation description changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'documentation-only change',
  },
  {
    id: 'callback-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['operation'],
    trigger: 'A new callback was added (OpenAPI 3.0/3.1).',
    message: (c) => `Callback added: ${fmt(c.newValue)}`,
    suggestion: () => 'additive; implement the new callback when ready',
  },
  {
    id: 'callback-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['operation'],
    trigger: 'A callback was removed.',
    message: (c) => `Callback removed: ${fmt(c.oldValue)}`,
    suggestion: () => 'consumers relying on this callback will stop receiving events',
  },
  {
    id: 'webhook-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['webhook'],
    trigger: 'A new top-level webhook was added (OpenAPI 3.1).',
    message: (c) => `Webhook added: ${fmt(c.newValue)}`,
    suggestion: () => 'additive; subscribe to the new webhook when ready',
  },
  {
    id: 'webhook-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['webhook'],
    trigger: 'A top-level webhook was removed (OpenAPI 3.1).',
    message: (c) => `Webhook removed: ${fmt(c.oldValue)}`,
    suggestion: () => 'consumers listening for this webhook will break',
  },

  // ---------------- §10.3 Parameters and bodies ----------------
  {
    id: 'parameter-added-required',
    defaultSeverity: 'error',
    defaultKind: 'addition',
    contexts: ['parameter'],
    trigger: 'A new required header/query/cookie/path parameter was added.',
    message: (c) =>
      `Required parameter \`${nameOf(c)}\` added`,
    suggestion: (c) => `clients must now send \`${nameOf(c)}\` on every request`,
  },
  {
    id: 'parameter-added-optional',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['parameter'],
    trigger: 'A new optional parameter was added.',
    message: (c) => `Optional parameter \`${nameOf(c)}\` added`,
    suggestion: () => 'additive; clients can adopt the parameter when ready',
  },
  {
    id: 'removed-parameter',
    defaultSeverity: 'warning',
    defaultKind: 'removal',
    contexts: ['parameter', 'request-header'],
    trigger:
      'A parameter was removed; error when it was required, a header, or a path param — else warning (§10.5).',
    message: (c) => `Parameter \`${nameOf(c)}\` removed`,
    suggestion: (c) =>
      `stop sending \`${nameOf(c)}\`; servers will ignore unknown parameters`,
  },
  {
    id: 'parameter-made-required',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['parameter'],
    trigger: 'An optional parameter became required.',
    message: (c) => `Parameter \`${nameOf(c)}\` changed from optional to required`,
    suggestion: (c) => `clients must now provide \`${nameOf(c)}\` on every request`,
  },
  {
    id: 'parameter-type-changed',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['parameter'],
    trigger: 'A parameter schema type changed.',
    message: (c) =>
      `Parameter \`${nameOf(c)}\` type changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'update clients to send the new type; old payloads will be rejected',
  },
  {
    id: 'parameter-format-changed',
    defaultSeverity: 'warning',
    defaultKind: 'modification',
    contexts: ['parameter'],
    trigger: 'A parameter format changed.',
    message: (c) =>
      `Parameter \`${nameOf(c)}\` format changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'formats are advisory but commonly validated; verify client payloads',
  },
  {
    id: 'parameter-location-changed',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['parameter'],
    trigger: 'A parameter moved between in: query/header/path/cookie (same name).',
    message: (c) =>
      `Parameter \`${nameOf(c)}\` moved from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'clients must send the value in the new location',
  },
  {
    id: 'parameter-style-changed',
    defaultSeverity: 'warning',
    defaultKind: 'modification',
    contexts: ['parameter'],
    trigger: 'A parameter style/explode changed.',
    message: (c) =>
      `Parameter \`${nameOf(c)}\` style changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'update serialization of array/object parameters in clients',
  },
  {
    id: 'parameter-default-changed',
    defaultSeverity: 'warning',
    defaultKind: 'modification',
    contexts: ['parameter'],
    trigger: 'A parameter default changed (server-side behavior may differ).',
    message: (c) =>
      `Parameter \`${nameOf(c)}\` default changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'verify clients that relied on the previous default behavior',
  },
  {
    id: 'parameter-metadata-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['parameter'],
    trigger: 'description/example/deprecated changed on a parameter.',
    message: (c) => `Parameter \`${nameOf(c)}\` metadata changed`,
    suggestion: () => 'documentation-only change',
  },
  {
    id: 'request-body-removed',
    defaultSeverity: 'warning',
    defaultKind: 'removal',
    contexts: ['request-body'],
    trigger: 'The request body existed and is gone; error if the old body was required (§10.5).',
    message: () => 'Request body removed',
    suggestion: () => 'clients must stop sending a body; verify server tolerance',
  },
  {
    id: 'request-body-added-required',
    defaultSeverity: 'error',
    defaultKind: 'addition',
    contexts: ['request-body'],
    trigger: 'No body before; a body with `required: true` now.',
    message: () => 'Required request body added',
    suggestion: () => 'clients must now send a body on every request',
  },
  {
    id: 'request-body-added-optional',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['request-body'],
    trigger: 'An optional request body was added.',
    message: () => 'Optional request body added',
    suggestion: () => 'additive; clients can send the body when ready',
  },
  {
    id: 'request-body-required-changed',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['request-body'],
    trigger: 'An optional body became `required: true`.',
    message: () => 'Request body changed from optional to required',
    suggestion: () => 'clients must now send the body on every request',
  },
  {
    id: 'content-type-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['request-body', 'response-body'],
    trigger: 'A previously supported media type was removed (request or response).',
    message: (c) =>
      `Media type ${fmt(c.oldValue)} removed from ${c.location.context === 'request-body' ? 'request' : 'response'}`,
    suggestion: () => 'clients sending/accepting this media type will fail content negotiation',
  },
  {
    id: 'content-type-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['request-body', 'response-body'],
    trigger: 'A media type was added.',
    message: (c) => `Media type ${fmt(c.newValue)} added to ${c.location.context === 'request-body' ? 'request' : 'response'}`,
    suggestion: () => 'additive; adopt when ready',
  },
  {
    id: 'encoding-changed',
    defaultSeverity: 'warning',
    defaultKind: 'modification',
    contexts: ['request-body'],
    trigger: 'multipart/form-data encoding properties changed.',
    message: (c) => `Multipart encoding changed for ${fmt(c.oldValue)} → ${fmt(c.newValue)}`,
    suggestion: () => 'verify multipart part serialization in clients',
  },
  {
    id: 'response-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['response-body'],
    trigger: 'A new status code (or `default` when none existed) was added.',
    message: (c) => `Response ${fmt(c.newValue)} added`,
    suggestion: () => 'additive; handle the new status in clients when ready',
  },
  {
    id: 'response-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['response-body'],
    trigger: 'A declared status code was removed.',
    message: (c) => `Response ${fmt(c.oldValue)} removed`,
    suggestion: () => 'clients expecting this status will treat it as unexpected; update error handling',
  },
  {
    id: 'default-response-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['response-body'],
    trigger: 'The `default` response was removed while it existed.',
    message: () => 'Default response removed',
    suggestion: () => 'clients relying on the default error contract lose their fallback schema',
  },
  {
    id: 'response-header-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['response-header'],
    trigger: 'A response header was removed.',
    message: (c) => `Response header \`${nameOf(c)}\` removed`,
    suggestion: () => 'clients reading this header will see it missing; update parsing',
  },
  {
    id: 'response-header-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['response-header'],
    trigger: 'A response header was added.',
    message: (c) => `Response header \`${nameOf(c)}\` added`,
    suggestion: () => 'additive; parse the header when ready',
  },
  {
    id: 'request-header-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['request-header'],
    trigger: 'A property inside a header parameter schema disappeared (§10.3).',
    message: (c) => `Request header schema property \`${nameOf(c)}\` removed`,
    suggestion: () => 'stop sending this header property; verify server acceptance',
  },

  // ---------------- §10.4 Schema / property level ----------------
  {
    id: 'property-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook', 'request-header', 'response-header'],
    trigger: 'A new property that is NOT required was added.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` added${whereLabel(c.location)}`,
    suggestion: () => 'additive; clients can consume the new field when ready',
  },
  {
    id: 'required-property-added',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook', 'request-header', 'response-header'],
    trigger: 'A property is newly present and required, or an optional property became required (§10.5).',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` changed from optional to required`,
    suggestion: (c) => `clients must now provide \`${nameOf(c)}\``,
  },
  {
    id: 'property-removed',
    defaultSeverity: 'warning',
    defaultKind: 'removal',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook', 'request-header', 'response-header'],
    trigger: 'A property was removed; severity resolves per the §10.5 context table.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` was removed${whereLabel(c.location)}`,
    suggestion: (c) => `stop relying on \`${nameOf(c)}\`${c.location.context === 'response-body' ? '; it will no longer be returned' : ''}`,
  },
  {
    id: 'property-type-changed',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook', 'request-header', 'response-header'],
    trigger: 'A schema type changed (including array item type via pointer to items).',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` type changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'update serializers/deserializers for the new type',
  },
  {
    id: 'property-format-changed',
    defaultSeverity: 'warning',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook', 'request-header', 'response-header'],
    trigger: 'A schema format changed (advisory; pair with type change for error).',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` format changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'verify validation libraries that enforce the format',
  },
  {
    id: 'property-default-changed',
    defaultSeverity: 'warning',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'A schema default changed.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` default changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'verify clients that relied on the previous default',
  },
  {
    id: 'enum-value-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook', 'request-header', 'response-header'],
    trigger: 'An enum member was removed (anywhere).',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` enum value ${fmt(c.oldValue)} removed`,
    suggestion: () => 'stop sending/expecting the removed enum value; update switch statements',
  },
  {
    id: 'enum-value-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook', 'request-header', 'response-header'],
    trigger: 'An enum member was added.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` enum value ${fmt(c.newValue)} added`,
    suggestion: () => 'handle the new enum value in client logic',
  },
  {
    id: 'const-added',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: '`const` was introduced where none existed.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` must now be exactly ${fmt(c.newValue)}`,
    suggestion: () => 'clients sending other values will be rejected',
  },
  {
    id: 'const-changed',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'A `const` value changed.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` const changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'update clients to the new constant value',
  },
  {
    id: 'const-removed',
    defaultSeverity: 'info',
    defaultKind: 'relaxation',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'A `const` constraint was removed.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` const constraint removed`,
    suggestion: () => 'relaxation; no client action required',
  },
  {
    id: 'constraint-added',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'A restrictive constraint was introduced where none existed (pattern, minLength, minItems, min/max, exclusive*, multipleOf).',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` now requires ${constraintText(c)}`,
    suggestion: () => 'update clients to satisfy the new constraint',
  },
  {
    id: 'constraint-tightened',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'An existing constraint was made stricter (numeric compare after normalization).',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` constraint tightened: ${constraintText(c)}`,
    suggestion: () => 'previously-valid payloads may now be rejected; update clients',
  },
  {
    id: 'constraint-relaxed',
    defaultSeverity: 'info',
    defaultKind: 'relaxation',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'A constraint was loosened.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` constraint relaxed: ${constraintText(c)}`,
    suggestion: () => 'relaxation; no client action required',
  },
  {
    id: 'constraint-removed',
    defaultSeverity: 'info',
    defaultKind: 'relaxation',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'A constraint was deleted.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` constraint ${constraintText(c)} removed`,
    suggestion: () => 'relaxation; no client action required',
  },
  {
    id: 'required-removed',
    defaultSeverity: 'info',
    defaultKind: 'relaxation',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'A property was removed from the `required` array (either context).',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` is no longer required`,
    suggestion: () => 'relaxation; clients may omit the field',
  },
  {
    id: 'map-closed',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: '`additionalProperties` became false or a schema where previously true/absent.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` no longer allows unknown properties`,
    suggestion: () => 'clients sending extra fields will be rejected',
  },
  {
    id: 'map-opened',
    defaultSeverity: 'info',
    defaultKind: 'relaxation',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: '`additionalProperties` became true/absent where it was false or a schema.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` now allows unknown properties`,
    suggestion: () => 'relaxation; no client action required',
  },
  {
    id: 'allOf-member-added',
    defaultSeverity: 'warning',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'A new allOf member was added (may restrict or conflict).',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` gained an allOf constraint`,
    suggestion: () => 'verify payloads still satisfy the combined schema',
  },
  {
    id: 'allOf-member-removed',
    defaultSeverity: 'info',
    defaultKind: 'relaxation',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'An allOf member was removed.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` lost an allOf constraint`,
    suggestion: () => 'relaxation; no client action required',
  },
  {
    id: 'anyOf-oneOf-member-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'A new anyOf/oneOf alternative branch was added.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` gained an alternative schema`,
    suggestion: () => 'additive; clients can use the new branch when ready',
  },
  {
    id: 'anyOf-oneOf-member-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'An anyOf/oneOf alternative was removed (payloads matching only that branch break).',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` lost an alternative schema`,
    suggestion: () => 'payloads matching only the removed branch will fail validation',
  },
  {
    id: 'discriminator-added',
    defaultSeverity: 'warning',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'A discriminator was introduced.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` now requires a discriminator`,
    suggestion: () => 'clients must include the discriminator field in polymorphic payloads',
  },
  {
    id: 'discriminator-changed',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'The discriminator property or mapping changed/removed.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` discriminator changed`,
    suggestion: () => 'update polymorphic deserialization to the new discriminator',
  },
  {
    id: 'schema-description-changed',
    defaultSeverity: 'info',
    defaultKind: 'documentation',
    contexts: ['request-body', 'response-body', 'parameter', 'component', 'callback', 'webhook'],
    trigger: 'A schema-level description/title/example changed.',
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` documentation changed`,
    suggestion: () => 'documentation-only change',
  },

  // ---------------- §10.6 Security ----------------
  {
    id: 'security-scheme-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['security'],
    trigger: 'A new scheme was added to components.securitySchemes.',
    message: (c) => `Security scheme ${fmt(c.newValue)} added`,
    suggestion: () => 'additive; adopt the new scheme when ready',
  },
  {
    id: 'security-scheme-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['security'],
    trigger: 'A scheme was removed and is still referenced by ≥1 requirement; else info.',
    message: (c) => `Security scheme ${fmt(c.oldValue)} removed`,
    suggestion: () => 'clients authenticating with this scheme will fail; migrate first',
  },
  {
    id: 'security-type-changed',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['security'],
    trigger: 'A scheme type changed (http/apiKey/oauth2/openIdConnect/mutualTLS).',
    message: (c) => `Security scheme \`${nameOf(c)}\` type changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'client credentials/flows for the old type will fail',
  },
  {
    id: 'api-key-location-changed',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['security'],
    trigger: 'An apiKey scheme in: header/query/cookie changed.',
    message: (c) => `API key \`${nameOf(c)}\` moved from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => 'clients must send the key in the new location',
  },
  {
    id: 'oauth-scope-removed',
    defaultSeverity: 'error',
    defaultKind: 'removal',
    contexts: ['security'],
    trigger: 'A scope was removed from a scheme that ≥1 operation requirement references; else info.',
    message: (c) => `OAuth scope \`${nameOf(c)}\` removed`,
    suggestion: () => 'tokens granted only the removed scope will fail authorization',
  },
  {
    id: 'oauth-scope-added',
    defaultSeverity: 'info',
    defaultKind: 'addition',
    contexts: ['security'],
    trigger: 'A scope was added to a scheme.',
    message: (c) => `OAuth scope \`${nameOf(c)}\` added`,
    suggestion: () => 'additive; request the new scope when needed',
  },
  {
    id: 'security-requirement-added',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['security'],
    trigger: 'An operation with no/optional security now requires security.',
    message: (c) => `Operation ${c.location.path} now requires authentication`,
    suggestion: () => 'previously-anonymous clients must obtain credentials',
  },
  {
    id: 'security-requirement-changed',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['security'],
    trigger: 'The scheme set changed with no overlap (old credentials fail).',
    message: (c) => `Operation ${c.location.path} security requirements changed incompatibly`,
    suggestion: () => 'clients must obtain credentials for the new scheme(s)',
  },
  {
    id: 'security-scope-required-added',
    defaultSeverity: 'error',
    defaultKind: 'modification',
    contexts: ['security'],
    trigger: 'An operation requirement now demands a scope not previously required.',
    message: (c) => `Operation ${c.location.path} now requires scope \`${String(c.newValue ?? '')}\``,
    suggestion: () => 'clients must request the additional scope from the authorization server',
  },
  {
    id: 'security-requirement-removed',
    defaultSeverity: 'warning',
    defaultKind: 'relaxation',
    contexts: ['security'],
    trigger: 'Operation-level security was removed entirely (exposure risk → warning).',
    message: (c) => `Operation ${c.location.path} no longer requires authentication`,
    suggestion: () => 'review exposure: the operation is now reachable anonymously',
  },
  {
    id: 'security-scope-required-removed',
    defaultSeverity: 'info',
    defaultKind: 'relaxation',
    contexts: ['security'],
    trigger: 'A narrower scope set is now accepted.',
    message: (c) => `Operation ${c.location.path} no longer requires scope \`${String(c.oldValue ?? '')}\``,
    suggestion: () => 'relaxation; existing tokens keep working',
  },
];

/** Lookup by id. Throws for unknown ids — typos must fail loud (§5.5). */
export function getRule(id: string): RuleDefinition {
  const rule = RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`internal error: unknown rule id "${id}"`);
  return rule;
}

/** All rule ids (used by parity tests, ignore engine, docs generation). */
export function allRuleIds(): string[] {
  return RULES.map((r) => r.id);
}

function constraintText(c: TemplateContext): string {
  const name = nameOf(c);
  const oldV = c.oldValue === undefined ? undefined : JSON.stringify(c.oldValue);
  const newV = c.newValue === undefined ? undefined : JSON.stringify(c.newValue);
  if (oldV !== undefined && newV !== undefined) return `${name}: ${oldV} → ${newV}`;
  if (newV !== undefined) return `${name}: ${newV}`;
  return name;
}
