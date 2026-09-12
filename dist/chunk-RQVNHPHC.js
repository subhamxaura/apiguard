// src/core/config/loader.ts
import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";

// src/core/config/schema.ts
import { z } from "zod";
var severityValueSchema = z.enum(["error", "warning", "info", "off"]);
var rulesSchema = z.record(z.string().min(1), severityValueSchema);
var ignoreSchema = z.strictObject({
  paths: z.array(z.string()).optional().default([]),
  operations: z.array(z.string()).optional().default([]),
  schemas: z.array(z.string()).optional().default([]),
  changes: z.array(z.string()).optional().default([]),
  "show-ignored": z.boolean().optional().default(false)
});
var outputSchema = z.strictObject({
  format: z.enum(["terminal", "json", "markdown"]).optional().default("terminal"),
  "include-non-breaking": z.boolean().optional().default(false),
  color: z.enum(["auto", "always", "never"]).optional().default("auto")
});
var versioningSchema = z.strictObject({
  suggest: z.boolean().optional().default(true)
});
var loaderSchema = z.strictObject({
  "allow-remote-refs": z.boolean().optional().default(false)
});
var githubSchema = z.strictObject({
  comment: z.boolean().optional().default(true),
  "check-run": z.boolean().optional().default(true),
  "update-existing-comment": z.boolean().optional().default(true)
});
var configSchema = z.strictObject({
  schemaVersion: z.literal(1, {
    error: "schemaVersion must be 1 (other versions are rejected; see docs/configuration.md)"
  }),
  rules: rulesSchema.optional().default({}),
  ignore: ignoreSchema.optional(),
  output: outputSchema.optional(),
  "fail-on": z.enum(["error", "warning", "never"]).optional(),
  versioning: versioningSchema.optional(),
  loader: loaderSchema.optional(),
  github: githubSchema.optional()
});

// src/core/config/defaults.ts
var DEFAULT_CONFIG = {
  schemaVersion: 1,
  rules: {},
  ignore: {
    paths: [],
    operations: [],
    schemas: [],
    changes: [],
    showIgnored: false
  },
  output: {
    format: "terminal",
    includeNonBreaking: false,
    color: "auto"
  },
  failOn: "error",
  // §13 golden output shows the bump line "only with --suggest-version"; config may opt in.
  versioning: { suggest: false },
  loader: { allowRemoteRefs: false },
  github: { comment: true, checkRun: true, updateExistingComment: true }
};

// src/utils/errors.ts
var ExitCode = {
  Ok: 0,
  BreakingChanges: 1,
  Usage: 2,
  SpecError: 3,
  Internal: 4,
  Sigint: 130
};
var ApiguardError = class extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
};
var CliUsageError = class extends ApiguardError {
  exitCode = ExitCode.Usage;
  constructor(message) {
    super(message);
  }
};
var ConfigError = class extends ApiguardError {
  exitCode = ExitCode.Usage;
  constructor(message) {
    super(message);
  }
};
var SpecLoadError = class extends ApiguardError {
  exitCode = ExitCode.SpecError;
  constructor(message) {
    super(message);
  }
};
var SpecValidationError = class extends ApiguardError {
  exitCode = ExitCode.SpecError;
  constructor(message) {
    super(message);
  }
};
function errorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}

// src/core/config/loader.ts
var CONFIG_FILE_CANDIDATES = [
  "apiguard.yaml",
  "apiguard.yml",
  "apiguard.json",
  ".apiguard.yaml",
  ".apiguard.yml"
];
var LEGACY_RULE_ALIASES = {
  "removed-request-property": { canonical: "property-removed", scope: "request-body" },
  "removed-response-property": { canonical: "property-removed", scope: "response-body" },
  "new-required-request-property": { canonical: "required-property-added", scope: "request-body" }
};
function readConfigFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new ConfigError(`config file not found: ${filePath}`);
  }
  try {
    if (filePath.toLowerCase().endsWith(".json")) return JSON.parse(text);
    return parseYaml(text);
  } catch (e) {
    throw new ConfigError(`${filePath}: invalid YAML/JSON: ${errorMessage(e)}`);
  }
}
function toResolved(parsed) {
  return {
    schemaVersion: 1,
    rules: parsed.rules ?? {},
    ignore: {
      paths: parsed.ignore?.paths ?? [],
      operations: parsed.ignore?.operations ?? [],
      schemas: parsed.ignore?.schemas ?? [],
      changes: parsed.ignore?.changes ?? [],
      showIgnored: parsed.ignore?.["show-ignored"] ?? false
    },
    output: {
      format: parsed.output?.format ?? "terminal",
      includeNonBreaking: parsed.output?.["include-non-breaking"] ?? false,
      color: parsed.output?.color ?? "auto"
    },
    failOn: parsed["fail-on"] ?? "error",
    versioning: { suggest: parsed.versioning?.suggest ?? true },
    loader: { allowRemoteRefs: parsed.loader?.["allow-remote-refs"] ?? false },
    github: {
      comment: parsed.github?.comment ?? true,
      checkRun: parsed.github?.["check-run"] ?? true,
      updateExistingComment: parsed.github?.["update-existing-comment"] ?? true
    }
  };
}
function resolveConfigObject(raw, sourcePath) {
  let parsed;
  try {
    parsed = configSchema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      const where = first?.path?.length ? ` at key "${first.path.join(".")}"` : "";
      throw new ConfigError(
        `${sourcePath}: invalid config${where}: ${first?.message ?? "validation failed"}`
      );
    }
    throw new ConfigError(`${sourcePath}: invalid config: ${errorMessage(e)}`);
  }
  return toResolved(parsed);
}
function applyAliases(raw, warnings) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = raw;
  const rules = obj.rules;
  if (rules === null || typeof rules !== "object" || Array.isArray(rules)) return raw;
  const out = { ...obj, rules: { ...rules } };
  for (const key of Object.keys(out.rules)) {
    const alias = LEGACY_RULE_ALIASES[key];
    if (alias) {
      const canonicalKey = alias.scope ? `${alias.canonical}@${alias.scope}` : alias.canonical;
      const value = out.rules[key];
      delete out.rules[key];
      out.rules[canonicalKey] = value;
      warnings.push(
        `config: rule key "${key}" is deprecated (v1 alias); use "${canonicalKey}" instead`
      );
    }
  }
  return out;
}
function loadConfigFrom(explicitPath) {
  const warnings = [];
  const raw = readConfigFile(explicitPath);
  const withAliases = applyAliases(raw, warnings);
  const config = resolveConfigObject(withAliases, explicitPath);
  return { config, sourcePath: explicitPath, warnings };
}
function discoverAndLoadConfig(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.explicit || opts.env) {
    const target = opts.explicit ?? opts.env ?? "";
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
  return { config: { ...DEFAULT_CONFIG }, sourcePath: "", warnings: [] };
}
function mergeWithFlags(base, flags) {
  return {
    ...base,
    output: {
      format: flags.format ?? base.output.format,
      includeNonBreaking: flags.includeNonBreaking ?? base.output.includeNonBreaking,
      color: flags.noColor ? "never" : base.output.color
    },
    failOn: flags.failOn ?? base.failOn,
    versioning: {
      suggest: flags.suggestVersion ?? base.versioning.suggest
    }
  };
}

// src/loaders/spec-loader.ts
import fs2 from "fs";
import path2 from "path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { parse as parseYaml2 } from "yaml";

// src/utils/hash.ts
import { createHash } from "crypto";
function canonicalize(value) {
  return stableStringify(value);
}
function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
function sha256OfValue(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}
function changeId(parts) {
  const method = parts.method ?? "";
  const oldJson = parts.oldValue === void 0 ? "" : canonicalize(parts.oldValue);
  const newJson = parts.newValue === void 0 ? "" : canonicalize(parts.newValue);
  const key = [
    parts.ruleId,
    parts.context,
    parts.path,
    method,
    parts.pointerOld,
    parts.pointerNew,
    oldJson,
    newJson
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

// src/core/engine/normalize.ts
function normalizeDocument(document) {
  return normalizeNode(document);
}
function normalizeNode(node) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((v) => normalizeNode(v));
  }
  const obj = node;
  const minimum = obj.minimum;
  const maximum = obj.maximum;
  let exclusiveMin = obj.exclusiveMinimum;
  let exclusiveMax = obj.exclusiveMaximum;
  const minIsExclusive = exclusiveMin === true && typeof minimum === "number";
  const maxIsExclusive = exclusiveMax === true && typeof maximum === "number";
  if (minIsExclusive) exclusiveMin = minimum;
  else if (exclusiveMin === false) exclusiveMin = void 0;
  if (maxIsExclusive) exclusiveMax = maximum;
  else if (exclusiveMax === false) exclusiveMax = void 0;
  let typeValue = obj.type;
  const nullable = obj.nullable === true;
  if (typeof typeValue === "string") typeValue = [typeValue];
  if (Array.isArray(typeValue)) typeValue = [...typeValue].sort();
  if (nullable && Array.isArray(typeValue)) {
    typeValue = typeValue.includes("null") ? typeValue : [...typeValue, "null"].sort();
  }
  const out = {};
  for (const key of Object.keys(obj).sort()) {
    switch (key) {
      case "type":
        if (typeValue !== void 0) out.type = typeValue;
        break;
      case "nullable":
        break;
      case "exclusiveMinimum":
        if (exclusiveMin !== void 0) out.exclusiveMinimum = exclusiveMin;
        break;
      case "exclusiveMaximum":
        if (exclusiveMax !== void 0) out.exclusiveMaximum = exclusiveMax;
        break;
      case "minimum":
        if (!minIsExclusive && minimum !== void 0) out.minimum = minimum;
        break;
      case "maximum":
        if (!maxIsExclusive && maximum !== void 0) out.maximum = maximum;
        break;
      default:
        out[key] = normalizeNode(obj[key]);
        break;
    }
  }
  return out;
}
function toNormalizedSpec(loaded, normalized) {
  return { ...loaded, normalized, sha256: sha256OfValue(normalized) };
}

// src/loaders/spec-loader.ts
function parseSpecText(text, source) {
  let parsed;
  const isJsonByExt = source.trimEnd().toLowerCase().endsWith(".json");
  if (isJsonByExt) {
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new SpecLoadError(`${source}: JSON parse error: ${errorMessage(e)}`);
    }
  } else {
    try {
      parsed = parseYaml2(text, { schema: "core" });
    } catch (e) {
      throw new SpecLoadError(`${source}: YAML parse error: ${errorMessage(e)}`);
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SpecLoadError(
      `${source}: spec root must be a mapping object with an 'openapi' field (got ${describeRoot(parsed)})`
    );
  }
  return parsed;
}
function describeRoot(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return `a ${typeof v}`;
}
function findRemoteRefs(document) {
  const found = [];
  const stack = [document];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    const obj = node;
    for (const [k, v] of Object.entries(obj)) {
      if (k === "$ref" && typeof v === "string") {
        const target = v.split("#")[0] ?? "";
        if (/^https?:\/\//i.test(target)) found.push(v);
      } else if (v !== null && typeof v === "object") {
        stack.push(v);
      }
    }
  }
  return found;
}
function findExternalFileRefs(document, specDir) {
  const found = [];
  const stack = [document];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    const obj = node;
    for (const [k, v] of Object.entries(obj)) {
      if (k === "$ref" && typeof v === "string") {
        const filePart = v.split("#")[0] ?? "";
        if (filePart && !/^[a-z][a-z0-9+.-]*:/i.test(filePart)) {
          const resolved = path2.resolve(specDir, filePart);
          const rel = path2.relative(specDir, resolved);
          if (rel.startsWith("..") || path2.isAbsolute(rel)) found.push(v);
        }
      } else if (v !== null && typeof v === "object") {
        stack.push(v);
      }
    }
  }
  return found;
}
async function loadSpec(filePath, options = {}) {
  const abs = path2.resolve(filePath);
  let text;
  try {
    text = fs2.readFileSync(abs, "utf8");
  } catch (e) {
    throw new SpecLoadError(`${filePath}: cannot read file: ${errorMessage(e)}`);
  }
  if (text.trim() === "") {
    throw new SpecLoadError(`${filePath}: file is empty \u2014 a spec must contain an OpenAPI document`);
  }
  const parsed = parseSpecText(text, filePath);
  const openapi = typeof parsed.openapi === "string" ? parsed.openapi : "";
  if (!openapi) {
    throw new SpecLoadError(
      `${filePath}: missing 'openapi' version field \u2014 this does not look like an OpenAPI 3.x document`
    );
  }
  if (!openapi.startsWith("3.")) {
    throw new SpecLoadError(
      `${filePath}: unsupported OpenAPI version "${openapi}" \u2014 API Guard supports 3.0.x and 3.1.x only`
    );
  }
  const specDir = path2.dirname(abs);
  const allowRemote = options.loader?.allowRemoteRefs ?? false;
  const allowExternal = options.loader?.allowExternalFiles ?? false;
  const remoteRefs = findRemoteRefs(parsed);
  if (remoteRefs.length > 0 && !allowRemote) {
    throw new SpecLoadError(
      `${filePath}: remote $ref(s) denied by default (found ${remoteRefs.length}: ${remoteRefs.slice(0, 3).join(", ")}${remoteRefs.length > 3 ? ", \u2026" : ""}). Set loader.allow-remote-refs: true in apiguard.yaml to opt in.`
    );
  }
  const externalRefs = findExternalFileRefs(parsed, specDir);
  if (externalRefs.length > 0 && !allowExternal) {
    throw new SpecLoadError(
      `${filePath}: $ref(s) point outside the spec's directory (found ${externalRefs.length}: ${externalRefs.slice(0, 3).join(", ")}${externalRefs.length > 3 ? ", \u2026" : ""}). External-file refs are not supported in v1.`
    );
  }
  let document;
  try {
    document = await SwaggerParser.bundle(abs);
  } catch (e) {
    throw new SpecLoadError(`${filePath}: parser error: ${errorMessage(e)}`);
  }
  const info = parsed.info ?? {};
  const title = typeof info.title === "string" ? info.title : "";
  const loaded = {
    document,
    source: filePath,
    openapiVersion: openapi,
    title,
    sha256: ""
  };
  return toNormalizedSpec(loaded, normalizeDocument(document));
}

// src/loaders/validate.ts
function asObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : void 0;
}
function asRecordArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x !== null && typeof x === "object" && !Array.isArray(x));
}
function validateSemantics(document, file) {
  const issues = [];
  const doc = asObject(document);
  if (!doc)
    return { issues: [{ level: "error", file, message: "document is not an object" }], ok: false };
  const schemes = asObject(doc.components)?.securitySchemes;
  const schemeNames = new Set(schemes ? Object.keys(schemes) : []);
  const checkRequirements = (reqs, where) => {
    for (const req of asRecordArray(reqs)) {
      for (const name of Object.keys(req)) {
        if (!schemeNames.has(name)) {
          issues.push({
            level: "error",
            file,
            message: `${where}: security requirement references unknown scheme "${name}"`
          });
        }
      }
    }
  };
  checkRequirements(doc.security, "#/");
  const paths = asObject(doc.paths) ?? {};
  for (const [p, item] of Object.entries(paths)) {
    const pathItem = asObject(item);
    if (!pathItem) continue;
    checkRequirements(pathItem.security, `${p} (path-level)`);
    for (const method of Object.keys(pathItem)) {
      if (!isHttpMethod(method)) continue;
      const op = asObject(pathItem[method]);
      if (!op) continue;
      checkRequirements(op.security, `${p} ${method.toUpperCase()}`);
    }
  }
  const seenIds = /* @__PURE__ */ new Map();
  for (const [p, item] of Object.entries(paths)) {
    const pathItem = asObject(item);
    if (!pathItem) continue;
    for (const method of Object.keys(pathItem)) {
      if (!isHttpMethod(method)) continue;
      const op = asObject(pathItem[method]);
      const opId = op?.operationId;
      if (typeof opId === "string" && opId.length > 0) {
        const prev = seenIds.get(opId);
        if (prev !== void 0) {
          issues.push({
            level: "warning",
            file,
            message: `duplicate operationId "${opId}" (also at ${prev})`
          });
        } else {
          seenIds.set(opId, `${p} ${method.toUpperCase()}`);
        }
      }
    }
  }
  for (const [p, item] of Object.entries(paths)) {
    const pathItem = asObject(item);
    if (!pathItem) {
      issues.push({ level: "warning", file, message: `${p}: path item is empty` });
      continue;
    }
    const hasOp = Object.keys(pathItem).some((k) => isHttpMethod(k));
    if (!hasOp) {
      issues.push({ level: "warning", file, message: `${p}: path item has no operations` });
    }
    for (const method of Object.keys(pathItem)) {
      if (!isHttpMethod(method)) continue;
      const op = asObject(pathItem[method]);
      if (!op) continue;
      const where = `${p} ${method.toUpperCase()}`;
      const responses = asObject(op.responses);
      if (responses) {
        for (const key of Object.keys(responses)) {
          if (!/^(default|[1-5](\d{2}|XX))$/.test(key)) {
            issues.push({
              level: "error",
              file,
              message: `${where}: invalid response status key "${key}" (expected 1XX-5XX, code, or "default")`
            });
          }
        }
      }
      for (const param of asRecordArray(op.parameters)) {
        checkParameterShape(param, where, issues, file);
      }
      for (const param of asRecordArray(pathItem.parameters)) {
        checkParameterShape(param, `${p} (path-level)`, issues, file);
      }
    }
  }
  const schemas = asObject(doc.components)?.schemas;
  for (const [name, schema] of Object.entries(schemas ?? {})) {
    const obj = asObject(schema);
    if (!obj) continue;
    const props = asObject(obj.properties);
    for (const req of stringArray(obj.required)) {
      if (props && !(req in props)) {
        issues.push({
          level: "warning",
          file,
          message: `components.schemas.${name}: required entry "${req}" is not a declared property`
        });
      }
    }
  }
  return { issues, ok: !issues.some((i) => i.level === "error") };
}
function checkParameterShape(param, where, issues, file) {
  const name = typeof param.name === "string" ? param.name : "<unnamed>";
  if ("schema" in param && "content" in param) {
    issues.push({
      level: "error",
      file,
      message: `${where}: parameter "${name}" has both 'schema' and 'content' (mutually exclusive)`
    });
  }
}
function stringArray(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
function isHttpMethod(key) {
  return ["get", "post", "put", "patch", "delete", "head", "options", "trace"].includes(
    key.toLowerCase()
  );
}
function formatIssues(issues) {
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const lines = [];
  if (errors.length > 0) {
    lines.push("Errors:");
    for (const i of errors) lines.push(`  ${i.file}: ${i.message}`);
  }
  if (warnings.length > 0) {
    lines.push("Warnings:");
    for (const i of warnings) lines.push(`  ${i.file}: ${i.message}`);
  }
  return lines;
}

// src/core/versioning/semver-advisor.ts
function suggestVersion(changes) {
  const errors = changes.filter((c) => c.severity === "error");
  if (errors.length > 0) {
    const counts = /* @__PURE__ */ new Map();
    for (const c of errors) counts.set(c.ruleId, (counts.get(c.ruleId) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([id, n]) => `${id}(${n})`);
    return {
      bump: "major",
      reason: `${errors.length} breaking change(s); driven by ${top.join(", ")}`,
      triggers: [...new Set(errors.map((c) => c.ruleId))].sort()
    };
  }
  const minorish = changes.filter(
    (c) => c.severity === "warning" || c.kind === "addition" || c.kind === "removal" || c.kind === "modification"
  );
  if (minorish.length > 0) {
    const triggers = [...new Set(minorish.map((c) => c.ruleId))].sort();
    return {
      bump: "minor",
      reason: `${minorish.length} non-breaking functional change(s) (additions/modifications/warnings)`,
      triggers
    };
  }
  const patchish = changes.filter((c) => c.kind === "relaxation" || c.kind === "documentation");
  if (patchish.length > 0) {
    const triggers = [...new Set(patchish.map((c) => c.ruleId))].sort();
    return {
      bump: "patch",
      reason: `${patchish.length} documentation/relaxation change(s)`,
      triggers
    };
  }
  return { bump: "none", reason: "no changes", triggers: [] };
}

// src/core/models/report.ts
var TOOL_VERSION = "0.1.0";

// src/core/rules/rule-registry.ts
function fmt(v) {
  if (v === void 0) return "absent";
  if (typeof v === "string") return `\`${v}\``;
  if (v === null) return "null";
  return `\`${JSON.stringify(v)}\``;
}
function sideLabel(loc) {
  switch (loc.context) {
    case "request-body":
      return "Request property";
    case "response-body":
      return "Response property";
    case "request-header":
      return "Request header";
    case "response-header":
      return "Response header";
    case "parameter":
      return "Parameter";
    case "component":
      return "Component property";
    case "callback":
      return "Callback payload property";
    case "webhook":
      return "Webhook payload property";
    default:
      return "Property";
  }
}
function whereLabel(loc) {
  switch (loc.context) {
    case "component":
      return loc.componentName ? ` in component ${loc.componentName}` : " in component";
    case "parameter":
      return " parameter";
    default:
      return "";
  }
}
function nameOf(ctx) {
  const source = ctx.location.pointerNew || ctx.location.pointerOld;
  const tokens = source.split("/").filter(Boolean);
  const last = tokens[tokens.length - 1];
  return (last ?? "value").replace(/~1/g, "/").replace(/~0/g, "~");
}
var RULES = [
  // ---------------- §10.1 API / document level ----------------
  {
    id: "openapi-version-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["api"],
    trigger: "The `openapi` version field changed (after normalization).",
    message: (c) => `OpenAPI version changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "verify tooling supports the new OpenAPI version"
  },
  {
    id: "title-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["api"],
    trigger: "The document title changed.",
    message: (c) => `API title changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "update generated clients/docs that embed the title"
  },
  {
    id: "description-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["api"],
    trigger: "The document description changed.",
    message: (c) => `API description changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "no functional impact; update dependent docs if desired"
  },
  {
    id: "server-url-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["api"],
    trigger: "A server URL was added (treated as additive in v1).",
    message: (c) => `Server URL added: ${fmt(c.newValue)}`,
    suggestion: () => "clients can now target the new server; no action required"
  },
  {
    id: "server-url-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["api"],
    trigger: "A server URL was removed (clients may still target it).",
    message: (c) => `Server URL removed: ${fmt(c.oldValue)}`,
    suggestion: () => "publish a migration note; clients pinned to this URL will fail"
  },
  {
    id: "server-metadata-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["api"],
    trigger: "Server description or variables changed.",
    message: (c) => `Server metadata changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "review server variable defaults for environment impact"
  },
  {
    id: "external-docs-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["api"],
    trigger: "externalDocs changed.",
    message: (c) => `External docs changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "update bookmarks/links to external documentation"
  },
  {
    id: "license-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["api"],
    trigger: "License metadata changed.",
    message: (c) => `License changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "review licensing implications before publishing"
  },
  {
    id: "contact-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["api"],
    trigger: "Contact metadata changed.",
    message: (c) => `Contact changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "update support contacts in client tooling"
  },
  // ---------------- §10.2 Operation level ----------------
  {
    id: "operation-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["operation"],
    trigger: "A new path+method was added.",
    message: (c) => `Operation added: ${String(c.location.method ?? "").toUpperCase()} ${c.location.path}`,
    suggestion: () => "additive; regenerate clients to expose the new operation"
  },
  {
    id: "removed-method",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["operation"],
    trigger: "The path still exists but a method disappeared.",
    message: (c) => `Operation removed: ${String(c.location.method ?? "").toUpperCase()} ${c.location.path}`,
    suggestion: () => "clients calling this operation will get 404/405; version the API instead"
  },
  {
    id: "removed-path",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["operation"],
    trigger: "An entire path disappeared (reported once instead of per-method rows).",
    message: (c) => `Path removed: ${c.location.path} (all operations)`,
    suggestion: () => "clients using any operation under this path will break; version the API"
  },
  {
    id: "operation-id-changed",
    defaultSeverity: "warning",
    defaultKind: "modification",
    contexts: ["operation"],
    trigger: "operationId changed (SDK/client code impact).",
    message: (c) => `operationId changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "regenerate SDKs; code referencing the old method name must be updated"
  },
  {
    id: "operation-deprecated-added",
    defaultSeverity: "warning",
    defaultKind: "modification",
    contexts: ["operation"],
    trigger: "`deprecated: true` was added to an operation.",
    message: () => "Operation is now deprecated",
    suggestion: () => "plan migration before the deprecation window ends"
  },
  {
    id: "operation-deprecated-removed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["operation"],
    trigger: "Deprecation was removed from an operation.",
    message: () => "Operation deprecation removed",
    suggestion: () => "update client roadmaps that tracked this deprecation"
  },
  {
    id: "operation-tags-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["operation"],
    trigger: "The operation tag list changed in either direction.",
    message: (c) => `Operation tags changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "update client grouping/filtering that relies on tags"
  },
  {
    id: "operation-summary-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["operation"],
    trigger: "The operation summary changed.",
    message: (c) => `Operation summary changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "documentation-only change"
  },
  {
    id: "operation-description-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["operation"],
    trigger: "The operation description changed.",
    message: (c) => `Operation description changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "documentation-only change"
  },
  {
    id: "callback-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["operation"],
    trigger: "A new callback was added (OpenAPI 3.0/3.1).",
    message: (c) => `Callback added: ${fmt(c.newValue)}`,
    suggestion: () => "additive; implement the new callback when ready"
  },
  {
    id: "callback-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["operation"],
    trigger: "A callback was removed.",
    message: (c) => `Callback removed: ${fmt(c.oldValue)}`,
    suggestion: () => "consumers relying on this callback will stop receiving events"
  },
  {
    id: "webhook-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["webhook"],
    trigger: "A new top-level webhook was added (OpenAPI 3.1).",
    message: (c) => `Webhook added: ${fmt(c.newValue)}`,
    suggestion: () => "additive; subscribe to the new webhook when ready"
  },
  {
    id: "webhook-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["webhook"],
    trigger: "A top-level webhook was removed (OpenAPI 3.1).",
    message: (c) => `Webhook removed: ${fmt(c.oldValue)}`,
    suggestion: () => "consumers listening for this webhook will break"
  },
  // ---------------- §10.3 Parameters and bodies ----------------
  {
    id: "parameter-added-required",
    defaultSeverity: "error",
    defaultKind: "addition",
    contexts: ["parameter"],
    trigger: "A new required header/query/cookie/path parameter was added.",
    message: (c) => `Required parameter \`${nameOf(c)}\` added`,
    suggestion: (c) => `clients must now send \`${nameOf(c)}\` on every request`
  },
  {
    id: "parameter-added-optional",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["parameter"],
    trigger: "A new optional parameter was added.",
    message: (c) => `Optional parameter \`${nameOf(c)}\` added`,
    suggestion: () => "additive; clients can adopt the parameter when ready"
  },
  {
    id: "removed-parameter",
    defaultSeverity: "warning",
    defaultKind: "removal",
    contexts: ["parameter", "request-header"],
    trigger: "A parameter was removed; error when it was required, a header, or a path param \u2014 else warning (\xA710.5).",
    message: (c) => `Parameter \`${nameOf(c)}\` removed`,
    suggestion: (c) => `stop sending \`${nameOf(c)}\`; servers will ignore unknown parameters`
  },
  {
    id: "parameter-made-required",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["parameter"],
    trigger: "An optional parameter became required.",
    message: (c) => `Parameter \`${nameOf(c)}\` changed from optional to required`,
    suggestion: (c) => `clients must now provide \`${nameOf(c)}\` on every request`
  },
  {
    id: "parameter-type-changed",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["parameter"],
    trigger: "A parameter schema type changed.",
    message: (c) => `Parameter \`${nameOf(c)}\` type changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "update clients to send the new type; old payloads will be rejected"
  },
  {
    id: "parameter-format-changed",
    defaultSeverity: "warning",
    defaultKind: "modification",
    contexts: ["parameter"],
    trigger: "A parameter format changed.",
    message: (c) => `Parameter \`${nameOf(c)}\` format changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "formats are advisory but commonly validated; verify client payloads"
  },
  {
    id: "parameter-location-changed",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["parameter"],
    trigger: "A parameter moved between in: query/header/path/cookie (same name).",
    message: (c) => `Parameter \`${nameOf(c)}\` moved from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "clients must send the value in the new location"
  },
  {
    id: "parameter-style-changed",
    defaultSeverity: "warning",
    defaultKind: "modification",
    contexts: ["parameter"],
    trigger: "A parameter style/explode changed.",
    message: (c) => `Parameter \`${nameOf(c)}\` style changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "update serialization of array/object parameters in clients"
  },
  {
    id: "parameter-default-changed",
    defaultSeverity: "warning",
    defaultKind: "modification",
    contexts: ["parameter"],
    trigger: "A parameter default changed (server-side behavior may differ).",
    message: (c) => `Parameter \`${nameOf(c)}\` default changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "verify clients that relied on the previous default behavior"
  },
  {
    id: "parameter-metadata-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["parameter"],
    trigger: "description/example/deprecated changed on a parameter.",
    message: (c) => `Parameter \`${nameOf(c)}\` metadata changed`,
    suggestion: () => "documentation-only change"
  },
  {
    id: "request-body-removed",
    defaultSeverity: "warning",
    defaultKind: "removal",
    contexts: ["request-body"],
    trigger: "The request body existed and is gone; error if the old body was required (\xA710.5).",
    message: () => "Request body removed",
    suggestion: () => "clients must stop sending a body; verify server tolerance"
  },
  {
    id: "request-body-added-required",
    defaultSeverity: "error",
    defaultKind: "addition",
    contexts: ["request-body"],
    trigger: "No body before; a body with `required: true` now.",
    message: () => "Required request body added",
    suggestion: () => "clients must now send a body on every request"
  },
  {
    id: "request-body-added-optional",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["request-body"],
    trigger: "An optional request body was added.",
    message: () => "Optional request body added",
    suggestion: () => "additive; clients can send the body when ready"
  },
  {
    id: "request-body-required-changed",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["request-body"],
    trigger: "An optional body became `required: true`.",
    message: () => "Request body changed from optional to required",
    suggestion: () => "clients must now send the body on every request"
  },
  {
    id: "content-type-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["request-body", "response-body"],
    trigger: "A previously supported media type was removed (request or response).",
    message: (c) => `Media type ${fmt(c.oldValue)} removed from ${c.location.context === "request-body" ? "request" : "response"}`,
    suggestion: () => "clients sending/accepting this media type will fail content negotiation"
  },
  {
    id: "content-type-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["request-body", "response-body"],
    trigger: "A media type was added.",
    message: (c) => `Media type ${fmt(c.newValue)} added to ${c.location.context === "request-body" ? "request" : "response"}`,
    suggestion: () => "additive; adopt when ready"
  },
  {
    id: "encoding-changed",
    defaultSeverity: "warning",
    defaultKind: "modification",
    contexts: ["request-body"],
    trigger: "multipart/form-data encoding properties changed.",
    message: (c) => `Multipart encoding changed for ${fmt(c.oldValue)} \u2192 ${fmt(c.newValue)}`,
    suggestion: () => "verify multipart part serialization in clients"
  },
  {
    id: "response-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["response-body"],
    trigger: "A new status code (or `default` when none existed) was added.",
    message: (c) => `Response ${fmt(c.newValue)} added`,
    suggestion: () => "additive; handle the new status in clients when ready"
  },
  {
    id: "response-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["response-body"],
    trigger: "A declared status code was removed.",
    message: (c) => `Response ${fmt(c.oldValue)} removed`,
    suggestion: () => "clients expecting this status will treat it as unexpected; update error handling"
  },
  {
    id: "default-response-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["response-body"],
    trigger: "The `default` response was removed while it existed.",
    message: () => "Default response removed",
    suggestion: () => "clients relying on the default error contract lose their fallback schema"
  },
  {
    id: "response-header-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["response-header"],
    trigger: "A response header was removed.",
    message: (c) => `Response header \`${nameOf(c)}\` removed`,
    suggestion: () => "clients reading this header will see it missing; update parsing"
  },
  {
    id: "response-header-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["response-header"],
    trigger: "A response header was added.",
    message: (c) => `Response header \`${nameOf(c)}\` added`,
    suggestion: () => "additive; parse the header when ready"
  },
  {
    id: "request-header-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["request-header"],
    trigger: "A property inside a header parameter schema disappeared (\xA710.3).",
    message: (c) => `Request header schema property \`${nameOf(c)}\` removed`,
    suggestion: () => "stop sending this header property; verify server acceptance"
  },
  // ---------------- §10.4 Schema / property level ----------------
  {
    id: "property-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: [
      "request-body",
      "response-body",
      "parameter",
      "component",
      "callback",
      "webhook",
      "request-header",
      "response-header"
    ],
    trigger: "A new property that is NOT required was added.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` added${whereLabel(c.location)}`,
    suggestion: () => "additive; clients can consume the new field when ready"
  },
  {
    id: "required-property-added",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: [
      "request-body",
      "response-body",
      "parameter",
      "component",
      "callback",
      "webhook",
      "request-header",
      "response-header"
    ],
    trigger: "A property is newly present and required, or an optional property became required (\xA710.5).",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` changed from optional to required`,
    suggestion: (c) => `clients must now provide \`${nameOf(c)}\``
  },
  {
    id: "property-removed",
    defaultSeverity: "warning",
    defaultKind: "removal",
    contexts: [
      "request-body",
      "response-body",
      "parameter",
      "component",
      "callback",
      "webhook",
      "request-header",
      "response-header"
    ],
    trigger: "A property was removed; severity resolves per the \xA710.5 context table.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` was removed${whereLabel(c.location)}`,
    suggestion: (c) => `stop relying on \`${nameOf(c)}\`${c.location.context === "response-body" ? "; it will no longer be returned" : ""}`
  },
  {
    id: "property-type-changed",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: [
      "request-body",
      "response-body",
      "parameter",
      "component",
      "callback",
      "webhook",
      "request-header",
      "response-header"
    ],
    trigger: "A schema type changed (including array item type via pointer to items).",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` type changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "update serializers/deserializers for the new type"
  },
  {
    id: "property-format-changed",
    defaultSeverity: "warning",
    defaultKind: "modification",
    contexts: [
      "request-body",
      "response-body",
      "parameter",
      "component",
      "callback",
      "webhook",
      "request-header",
      "response-header"
    ],
    trigger: "A schema format changed (advisory; pair with type change for error).",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` format changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "verify validation libraries that enforce the format"
  },
  {
    id: "property-default-changed",
    defaultSeverity: "warning",
    defaultKind: "modification",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "A schema default changed.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` default changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "verify clients that relied on the previous default"
  },
  {
    id: "enum-value-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: [
      "request-body",
      "response-body",
      "parameter",
      "component",
      "callback",
      "webhook",
      "request-header",
      "response-header"
    ],
    trigger: "An enum member was removed (anywhere).",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` enum value ${fmt(c.oldValue)} removed`,
    suggestion: () => "stop sending/expecting the removed enum value; update switch statements"
  },
  {
    id: "enum-value-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: [
      "request-body",
      "response-body",
      "parameter",
      "component",
      "callback",
      "webhook",
      "request-header",
      "response-header"
    ],
    trigger: "An enum member was added.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` enum value ${fmt(c.newValue)} added`,
    suggestion: () => "handle the new enum value in client logic"
  },
  {
    id: "const-added",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "`const` was introduced where none existed.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` must now be exactly ${fmt(c.newValue)}`,
    suggestion: () => "clients sending other values will be rejected"
  },
  {
    id: "const-changed",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "A `const` value changed.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` const changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "update clients to the new constant value"
  },
  {
    id: "const-removed",
    defaultSeverity: "info",
    defaultKind: "relaxation",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "A `const` constraint was removed.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` const constraint removed`,
    suggestion: () => "relaxation; no client action required"
  },
  {
    id: "constraint-added",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "A restrictive constraint was introduced where none existed (pattern, minLength, minItems, min/max, exclusive*, multipleOf).",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` now requires ${constraintText(c)}`,
    suggestion: () => "update clients to satisfy the new constraint"
  },
  {
    id: "constraint-tightened",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "An existing constraint was made stricter (numeric compare after normalization).",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` constraint tightened: ${constraintText(c)}`,
    suggestion: () => "previously-valid payloads may now be rejected; update clients"
  },
  {
    id: "constraint-relaxed",
    defaultSeverity: "info",
    defaultKind: "relaxation",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "A constraint was loosened.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` constraint relaxed: ${constraintText(c)}`,
    suggestion: () => "relaxation; no client action required"
  },
  {
    id: "constraint-removed",
    defaultSeverity: "info",
    defaultKind: "relaxation",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "A constraint was deleted.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` constraint ${constraintText(c)} removed`,
    suggestion: () => "relaxation; no client action required"
  },
  {
    id: "required-removed",
    defaultSeverity: "info",
    defaultKind: "relaxation",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "A property was removed from the `required` array (either context).",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` is no longer required`,
    suggestion: () => "relaxation; clients may omit the field"
  },
  {
    id: "map-closed",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "`additionalProperties` became false or a schema where previously true/absent.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` no longer allows unknown properties`,
    suggestion: () => "clients sending extra fields will be rejected"
  },
  {
    id: "map-opened",
    defaultSeverity: "info",
    defaultKind: "relaxation",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "`additionalProperties` became true/absent where it was false or a schema.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` now allows unknown properties`,
    suggestion: () => "relaxation; no client action required"
  },
  {
    id: "allOf-member-added",
    defaultSeverity: "warning",
    defaultKind: "modification",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "A new allOf member was added (may restrict or conflict).",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` gained an allOf constraint`,
    suggestion: () => "verify payloads still satisfy the combined schema"
  },
  {
    id: "allOf-member-removed",
    defaultSeverity: "info",
    defaultKind: "relaxation",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "An allOf member was removed.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` lost an allOf constraint`,
    suggestion: () => "relaxation; no client action required"
  },
  {
    id: "anyOf-oneOf-member-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "A new anyOf/oneOf alternative branch was added.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` gained an alternative schema`,
    suggestion: () => "additive; clients can use the new branch when ready"
  },
  {
    id: "anyOf-oneOf-member-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "An anyOf/oneOf alternative was removed (payloads matching only that branch break).",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` lost an alternative schema`,
    suggestion: () => "payloads matching only the removed branch will fail validation"
  },
  {
    id: "discriminator-added",
    defaultSeverity: "warning",
    defaultKind: "modification",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "A discriminator was introduced.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` now requires a discriminator`,
    suggestion: () => "clients must include the discriminator field in polymorphic payloads"
  },
  {
    id: "discriminator-changed",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "The discriminator property or mapping changed/removed.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` discriminator changed`,
    suggestion: () => "update polymorphic deserialization to the new discriminator"
  },
  {
    id: "schema-description-changed",
    defaultSeverity: "info",
    defaultKind: "documentation",
    contexts: ["request-body", "response-body", "parameter", "component", "callback", "webhook"],
    trigger: "A schema-level description/title/example changed.",
    message: (c) => `${sideLabel(c.location)} \`${nameOf(c)}\` documentation changed`,
    suggestion: () => "documentation-only change"
  },
  // ---------------- §10.6 Security ----------------
  {
    id: "security-scheme-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["security"],
    trigger: "A new scheme was added to components.securitySchemes.",
    message: (c) => `Security scheme ${fmt(c.newValue)} added`,
    suggestion: () => "additive; adopt the new scheme when ready"
  },
  {
    id: "security-scheme-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["security"],
    trigger: "A scheme was removed and is still referenced by \u22651 requirement; else info.",
    message: (c) => `Security scheme ${fmt(c.oldValue)} removed`,
    suggestion: () => "clients authenticating with this scheme will fail; migrate first"
  },
  {
    id: "security-type-changed",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["security"],
    trigger: "A scheme type changed (http/apiKey/oauth2/openIdConnect/mutualTLS).",
    message: (c) => `Security scheme \`${nameOf(c)}\` type changed from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "client credentials/flows for the old type will fail"
  },
  {
    id: "api-key-location-changed",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["security"],
    trigger: "An apiKey scheme in: header/query/cookie changed.",
    message: (c) => `API key \`${nameOf(c)}\` moved from ${fmt(c.oldValue)} to ${fmt(c.newValue)}`,
    suggestion: () => "clients must send the key in the new location"
  },
  {
    id: "oauth-scope-removed",
    defaultSeverity: "error",
    defaultKind: "removal",
    contexts: ["security"],
    trigger: "A scope was removed from a scheme that \u22651 operation requirement references; else info.",
    message: (c) => `OAuth scope \`${nameOf(c)}\` removed`,
    suggestion: () => "tokens granted only the removed scope will fail authorization"
  },
  {
    id: "oauth-scope-added",
    defaultSeverity: "info",
    defaultKind: "addition",
    contexts: ["security"],
    trigger: "A scope was added to a scheme.",
    message: (c) => `OAuth scope \`${nameOf(c)}\` added`,
    suggestion: () => "additive; request the new scope when needed"
  },
  {
    id: "security-requirement-added",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["security"],
    trigger: "An operation with no/optional security now requires security.",
    message: (c) => `Operation ${c.location.path} now requires authentication`,
    suggestion: () => "previously-anonymous clients must obtain credentials"
  },
  {
    id: "security-requirement-changed",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["security"],
    trigger: "The scheme set changed with no overlap (old credentials fail).",
    message: (c) => `Operation ${c.location.path} security requirements changed incompatibly`,
    suggestion: () => "clients must obtain credentials for the new scheme(s)"
  },
  {
    id: "security-scope-required-added",
    defaultSeverity: "error",
    defaultKind: "modification",
    contexts: ["security"],
    trigger: "An operation requirement now demands a scope not previously required.",
    message: (c) => `Operation ${c.location.path} now requires scope \`${String(c.newValue ?? "")}\``,
    suggestion: () => "clients must request the additional scope from the authorization server"
  },
  {
    id: "security-requirement-removed",
    defaultSeverity: "warning",
    defaultKind: "relaxation",
    contexts: ["security"],
    trigger: "Operation-level security was removed entirely (exposure risk \u2192 warning).",
    message: (c) => `Operation ${c.location.path} no longer requires authentication`,
    suggestion: () => "review exposure: the operation is now reachable anonymously"
  },
  {
    id: "security-scope-required-removed",
    defaultSeverity: "info",
    defaultKind: "relaxation",
    contexts: ["security"],
    trigger: "A narrower scope set is now accepted.",
    message: (c) => `Operation ${c.location.path} no longer requires scope \`${String(c.oldValue ?? "")}\``,
    suggestion: () => "relaxation; existing tokens keep working"
  }
];
function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`internal error: unknown rule id "${id}"`);
  return rule;
}
function constraintText(c) {
  const name = nameOf(c);
  const oldV = c.oldValue === void 0 ? void 0 : JSON.stringify(c.oldValue);
  const newV = c.newValue === void 0 ? void 0 : JSON.stringify(c.newValue);
  if (oldV !== void 0 && newV !== void 0) return `${name}: ${oldV} \u2192 ${newV}`;
  if (newV !== void 0) return `${name}: ${newV}`;
  return name;
}

// src/core/engine/classify.ts
function sideClassOf(context) {
  switch (context) {
    case "request-body":
    case "request-header":
    case "parameter":
      return "send";
    case "response-body":
    case "response-header":
    case "callback":
    case "webhook":
      return "parse";
    case "component":
      return "parse";
    default:
      return "parse";
  }
}
function parseRuleKey(key) {
  const at = key.indexOf("@");
  if (at === -1) return { ruleId: key };
  return { ruleId: key.slice(0, at), context: key.slice(at + 1) };
}
function resolveContextSeverity(ruleId, context, opts) {
  const side = opts.sideClass ?? sideClassOf(context);
  if (ruleId === "property-removed") {
    if (side === "parse") return "error";
    if (context === "request-header") return "error";
    if (context === "parameter") return "error";
    return opts.wasRequired ? "error" : "warning";
  }
  if (ruleId === "required-property-added") {
    if (side === "parse") return "info";
    return "error";
  }
  if (ruleId === "request-body-removed") {
    return opts.wasRequired ? "error" : "warning";
  }
  if (ruleId === "removed-parameter") {
    return opts.wasRequired ? "error" : "warning";
  }
  return getRule(ruleId).defaultSeverity;
}
function classify(ruleId, context, options, doctrine) {
  const rule = getRule(ruleId);
  let override;
  for (const [key, value] of Object.entries(options.rules)) {
    const parsed = parseRuleKey(key);
    if (parsed.ruleId !== ruleId) continue;
    if (parsed.context !== void 0 && parsed.context === context) override = value;
    else if (parsed.context === void 0 && override === void 0) override = value;
  }
  if (override === "off") return null;
  const DOCTRINE_RULES = /* @__PURE__ */ new Set([
    "property-removed",
    "required-property-added",
    "request-body-removed",
    "removed-parameter"
  ]);
  const severity = override ?? (DOCTRINE_RULES.has(ruleId) ? resolveContextSeverity(ruleId, context, doctrine ?? {}) : rule.defaultSeverity);
  return { severity, kind: rule.defaultKind };
}

// src/utils/sort.ts
var SEVERITY_RANK = { error: 0, warning: 1, info: 2 };
var METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];
var METHOD_RANK = {};
for (const [i, m] of METHOD_ORDER.entries()) METHOD_RANK[m] = i;
function methodRank(method) {
  if (!method) return METHOD_ORDER.length;
  const r = METHOD_RANK[method.toUpperCase()];
  return r ?? METHOD_ORDER.length + 1;
}
function compareChanges(a, b) {
  const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sev !== 0) return sev;
  const path3 = (a.location.path ?? "").localeCompare(b.location.path ?? "", "en", {
    sensitivity: "variant"
  });
  if (path3 !== 0) return path3;
  const meth = methodRank(a.location.method) - methodRank(b.location.method);
  if (meth !== 0) return meth;
  const po = a.location.pointerOld.localeCompare(b.location.pointerOld, "en", {
    sensitivity: "variant"
  });
  if (po !== 0) return po;
  const pn = a.location.pointerNew.localeCompare(b.location.pointerNew, "en", {
    sensitivity: "variant"
  });
  if (pn !== 0) return pn;
  const rule = a.ruleId.localeCompare(b.ruleId, "en", { sensitivity: "variant" });
  if (rule !== 0) return rule;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function sortChanges(changes) {
  changes.sort(compareChanges);
  return changes;
}
function dedupeChanges(changes) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const c of changes) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}
function escapePointerToken(token) {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}
function pointerJoin(...tokens) {
  return `#/${tokens.map((t) => escapePointerToken(String(t))).join("/")}`;
}

// src/core/engine/index-build.ts
function asObject2(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : void 0;
}
function buildSpecIndex(document) {
  const doc = asObject2(document) ?? {};
  const pathsObj = asObject2(doc.paths) ?? {};
  const paths = Object.keys(pathsObj).sort();
  const pathItems = /* @__PURE__ */ new Map();
  const operations = [];
  for (const p of paths) {
    const item = asObject2(pathsObj[p]);
    if (!item) continue;
    pathItems.set(p, item);
    const methods = Object.keys(item).filter((k) => isHttpMethod(k)).sort((a, b) => (METHOD_RANK[a.toUpperCase()] ?? 99) - (METHOD_RANK[b.toUpperCase()] ?? 99));
    for (const m of methods) {
      const op = asObject2(item[m]);
      if (!op) continue;
      operations.push({ path: p, method: m.toUpperCase(), operation: op, pathItem: item });
    }
  }
  const components = asObject2(doc.components) ?? {};
  const schemasObj = asObject2(components.schemas) ?? {};
  const schemas = /* @__PURE__ */ new Map();
  for (const [name, schema] of Object.entries(schemasObj)) {
    const obj = asObject2(schema);
    if (obj) schemas.set(name, obj);
  }
  const webhooksObj = asObject2(doc.webhooks) ?? {};
  const webhooks = /* @__PURE__ */ new Map();
  for (const [name, wh] of Object.entries(webhooksObj)) {
    const obj = asObject2(wh);
    if (obj) webhooks.set(name, obj);
  }
  return { paths, pathItems, operations, schemas, webhooks };
}
function mergedParameters(pathItem, operation) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const opParams = paramList(operation.parameters);
  for (const p of opParams) {
    const key = paramKey(p);
    seen.add(key);
    out.push(p);
  }
  for (const p of paramList(pathItem.parameters)) {
    const key = paramKey(p);
    if (!seen.has(key)) out.push(p);
  }
  return out;
}
function paramList(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x !== null && typeof x === "object" && !Array.isArray(x));
}
function paramKey(p) {
  const name = typeof p.name === "string" ? p.name : "";
  const loc = typeof p.in === "string" ? p.in : "";
  return `${name}::${loc}`;
}

// src/core/engine/comparator.ts
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a;
  const bo = b;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length) return false;
  if (!ak.every((k, i) => k === bk[i])) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}
function typeLabel(t) {
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.join("|");
  return JSON.stringify(t) ?? "unknown";
}
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function boundDirection(kind, oldV, newV) {
  if (oldV === void 0 && newV === void 0) return "same";
  if (oldV === newV) return "same";
  if (oldV === void 0)
    return newV === void 0 ? "same" : kind === "lower" ? "tightened" : "tightened";
  if (newV === void 0) return "relaxed";
  if (oldV === newV) return "same";
  if (kind === "lower") return newV > oldV ? "tightened" : "relaxed";
  return newV < oldV ? "tightened" : "relaxed";
}
var LOWER_BOUNDS = ["minimum", "minLength", "minItems"];

// src/core/engine/walker.ts
function escape(token) {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}
function unescape(token) {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}
var REF = "$ref";
var MAX_DEREF_DEPTH = 256;
function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function structuralDeref(root) {
  const components = root.components;
  if (!isObj(components)) return;
  const schemasMap = components.schemas;
  if (!isObj(schemasMap)) return;
  const schemas = schemasMap;
  const resolved = /* @__PURE__ */ new Map();
  const inProgress = /* @__PURE__ */ new Set();
  const resolve = (name, schema, depth) => {
    const memo = resolved.get(name);
    if (memo) return memo;
    if (inProgress.has(name)) return schema;
    inProgress.add(name);
    const out = expand(schema, depth);
    inProgress.delete(name);
    resolved.set(name, out);
    return out;
  };
  function expand(node, depth) {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === REF && typeof v === "string") {
        const target = depth >= MAX_DEREF_DEPTH ? void 0 : targetOf(v, schemas);
        if (target) {
          const expanded = resolve(target.name, target.schema, depth + 1);
          for (const [ek, ev] of Object.entries(expanded)) out[ek] = ev;
          continue;
        }
        out[k] = v;
        continue;
      }
      out[k] = walkValue(v, depth);
    }
    return out;
  }
  function walkValue(v, depth) {
    if (Array.isArray(v)) return v.map((x) => walkValue(x, depth));
    if (isObj(v)) return expand(v, depth);
    return v;
  }
  for (const [name, schema] of Object.entries(schemas)) {
    if (isObj(schema)) schemas[name] = resolve(name, schema, 0);
  }
}
function targetOf(ref, schemas) {
  if (!ref.startsWith("#/components/schemas/")) return void 0;
  const parts = ref.slice("#/components/schemas/".length).split("/").map(unescape);
  let cur = schemas;
  for (const part of parts) {
    if (!isObj(cur)) return void 0;
    cur = cur[part];
  }
  return isObj(cur) ? { name: parts.join("/"), schema: cur } : void 0;
}
function isRefNode(node) {
  return isObj(node) && typeof node[REF] === "string";
}
function dereffedPair(oldNode, newNode, oldSchemas, newSchemas, seen) {
  const oldRef = isRefNode(oldNode) ? refTarget(oldNode.$ref, oldSchemas) : void 0;
  const newRef = isRefNode(newNode) ? refTarget(newNode.$ref, newSchemas) : void 0;
  if (!oldRef && !newRef) {
    return isObj(oldNode) && isObj(newNode) ? { old: oldNode, new: newNode } : void 0;
  }
  const oldResolved = oldRef ? oldRef.schema : isObj(oldNode) ? stripRef(oldNode) : void 0;
  const newResolved = newRef ? newRef.schema : isObj(newNode) ? stripRef(newNode) : void 0;
  if (!oldResolved || !newResolved) return void 0;
  const key = `${oldRef?.name ?? "\u2022"}|${newRef?.name ?? "\u2022"}`;
  if (oldRef && newRef && seen.has(key)) return void 0;
  if (oldRef && newRef) seen.add(key);
  return { old: oldResolved, new: newResolved };
}
function refTarget(ref, schemas) {
  if (!isObj(schemas) || !ref.startsWith("#/components/schemas/")) return void 0;
  const parts = ref.slice("#/components/schemas/".length).split("/").map(unescape);
  let cur = schemas;
  for (const part of parts) {
    if (!isObj(cur)) return void 0;
    cur = cur[part];
  }
  return isObj(cur) ? { name: parts.join("/"), schema: cur } : void 0;
}
function stripRef(node) {
  if (!(REF in node)) return node;
  const out = { ...node };
  delete out[REF];
  return out;
}

// src/core/engine/schema-differ.ts
var MAX_DEPTH = 256;
var CONSTRAINT_LABEL = {
  pattern: "pattern",
  minLength: "minLength",
  maxLength: "maxLength",
  minItems: "minItems",
  maxItems: "maxItems",
  multipleOf: "multipleOf",
  minimum: "minimum",
  maximum: "maximum",
  exclusiveMinimum: "exclusiveMinimum",
  exclusiveMaximum: "exclusiveMaximum"
};
var NUMERIC_KEYS = /* @__PURE__ */ new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf"
]);
function diffSchemaNode(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, opts) {
  const depth = opts.depth ?? 0;
  const seen = opts.seen ?? /* @__PURE__ */ new Set();
  if (depth > MAX_DEPTH) return;
  if (isRefNode(oldSchema) || isRefNode(newSchema)) {
    if (depth === 0) return;
    const pair = dereffedPair(
      oldSchema,
      newSchema,
      ctx.baselineIndex.schemas,
      ctx.currentIndex.schemas,
      seen
    );
    if (!pair) return;
    oldSchema = pair.old;
    newSchema = pair.new;
  }
  const name = lastToken(pointerNew) || lastToken(pointerOld) || "value";
  if (!deepEqual(oldSchema.type, newSchema.type)) {
    emit(ctx, {
      ruleId: "property-type-changed",
      location: { ...location, pointerOld, pointerNew },
      oldValue: compactType(oldSchema.type),
      newValue: compactType(newSchema.type)
    });
  }
  if (!deepEqual(oldSchema.format, newSchema.format)) {
    emit(ctx, {
      ruleId: "property-format-changed",
      location: {
        ...location,
        pointerOld: `${pointerOld}/format`,
        pointerNew: `${pointerNew}/format`
      },
      oldValue: oldSchema.format,
      newValue: newSchema.format
    });
  }
  if (!deepEqual(oldSchema.default, newSchema.default)) {
    emit(ctx, {
      ruleId: "property-default-changed",
      location: {
        ...location,
        pointerOld: `${pointerOld}/default`,
        pointerNew: `${pointerNew}/default`
      },
      oldValue: compact(oldSchema.default),
      newValue: compact(newSchema.default)
    });
  }
  diffEnum(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);
  diffConst(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);
  diffConstraints(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);
  diffAdditionalProperties(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);
  diffComposition(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);
  diffDiscriminator(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);
  if (!deepEqual(oldSchema.description, newSchema.description) || !deepEqual(oldSchema.title, newSchema.title) || !deepEqual(oldSchema.example, newSchema.example)) {
    emit(ctx, {
      ruleId: "schema-description-changed",
      location: { ...location, pointerOld, pointerNew }
    });
  }
  const oldProps = isObject(oldSchema.properties) ? oldSchema.properties : {};
  const newProps = isObject(newSchema.properties) ? newSchema.properties : {};
  const reqOld = opts.requiredOld;
  const reqNew = opts.requiredNew;
  for (const propName of Object.keys(oldProps).sort()) {
    const oldChild = oldProps[propName];
    const newChild = newProps[propName];
    if (newChild === void 0) {
      emit(ctx, {
        ruleId: "property-removed",
        location: {
          ...location,
          pointerOld: `${pointerOld}/properties/${escape(propName)}`,
          pointerNew: ""
        },
        oldValue: propName,
        doctrine: {
          wasRequired: reqOld.includes(propName),
          sideClass: opts.sideClass
        }
      });
      continue;
    }
    if (!isObject(oldChild) || !isObject(newChild)) continue;
    const wasReq = reqOld.includes(propName);
    const isReq = reqNew.includes(propName);
    if (!wasReq && isReq) {
      emit(ctx, {
        ruleId: "required-property-added",
        location: {
          ...location,
          pointerOld: `${pointerOld}/properties/${escape(propName)}`,
          pointerNew: `${pointerNew}/properties/${escape(propName)}`
        },
        oldValue: propName,
        doctrine: { wasRequired: true, sideClass: opts.sideClass }
      });
    } else if (!wasReq && !isReq) {
    }
    diffSchemaNode(
      ctx,
      oldChild,
      newChild,
      `${pointerOld}/properties/${escape(propName)}`,
      `${pointerNew}/properties/${escape(propName)}`,
      location,
      {
        requiredOld: stringArray2(oldChild.required),
        requiredNew: stringArray2(newChild.required),
        sideClass: opts.sideClass
      }
    );
  }
  for (const propName of Object.keys(newProps).sort()) {
    if (oldProps[propName] !== void 0) continue;
    const newChild = newProps[propName];
    if (!isObject(newChild)) continue;
    const isReq = reqNew.includes(propName);
    if (!isReq) {
      emit(ctx, {
        ruleId: "property-added",
        location: {
          ...location,
          pointerOld: "",
          pointerNew: `${pointerNew}/properties/${escape(propName)}`
        },
        newValue: propName
      });
    } else {
      emit(ctx, {
        ruleId: "required-property-added",
        location: {
          ...location,
          pointerOld: "",
          pointerNew: `${pointerNew}/properties/${escape(propName)}`
        },
        newValue: propName,
        doctrine: { wasRequired: true, sideClass: opts.sideClass }
      });
    }
  }
  const oldItems = isObject(oldSchema.items) ? oldSchema.items : void 0;
  const newItems = isObject(newSchema.items) ? newSchema.items : void 0;
  if (oldItems && newItems) {
    diffSchemaNode(
      ctx,
      oldItems,
      newItems,
      `${pointerOld}/items`,
      `${pointerNew}/items`,
      location,
      {
        requiredOld: stringArrayOf(oldItems.required),
        requiredNew: stringArrayOf(newItems.required),
        sideClass: opts.sideClass
      }
    );
  }
  for (const propName of reqOld) {
    if (!reqNew.includes(propName) && newProps[propName] !== void 0) {
      emit(ctx, {
        ruleId: "required-removed",
        location: {
          ...location,
          pointerOld: `${pointerOld}/required`,
          pointerNew: `${pointerNew}/required`
        },
        oldValue: propName
      });
    }
  }
}
function diffEnum(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name) {
  const oldEnum = Array.isArray(oldSchema.enum) ? oldSchema.enum : void 0;
  const newEnum = Array.isArray(newSchema.enum) ? newSchema.enum : void 0;
  if (!oldEnum || !newEnum) return;
  const ptr = `${pointerOld}/enum`;
  const ptrNew = `${pointerNew}/enum`;
  const compactOld = compactEnum(oldEnum);
  const compactNew = compactEnum(newEnum);
  for (const v of oldEnum) {
    if (!newEnum.some((n) => deepEqual(n, v))) {
      emit(ctx, {
        ruleId: "enum-value-removed",
        location: { ...location, pointerOld: ptr, pointerNew: ptrNew },
        oldValue: v,
        newValue: compactNew
      });
    }
  }
  for (const v of newEnum) {
    if (!oldEnum.some((o) => deepEqual(o, v))) {
      emit(ctx, {
        ruleId: "enum-value-added",
        location: { ...location, pointerOld: ptr, pointerNew: ptrNew },
        oldValue: compactOld,
        newValue: v
      });
    }
  }
  void name;
}
function compactEnum(e) {
  if (e.length <= 8) return e;
  return `${e.length} values`;
}
function diffConst(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name) {
  const oldConst = oldSchema.const;
  const newConst = newSchema.const;
  const base = { ...location };
  void name;
  if (oldConst === void 0 && newConst !== void 0) {
    emit(ctx, {
      ruleId: "const-added",
      location: { ...base, pointerOld: `${pointerOld}/const`, pointerNew: `${pointerNew}/const` },
      oldValue: void 0,
      newValue: newConst
    });
  } else if (oldConst !== void 0 && newConst !== void 0 && !deepEqual(oldConst, newConst)) {
    emit(ctx, {
      ruleId: "const-changed",
      location: { ...base, pointerOld: `${pointerOld}/const`, pointerNew: `${pointerNew}/const` },
      oldValue: oldConst,
      newValue: newConst
    });
  } else if (oldConst !== void 0 && newConst === void 0) {
    emit(ctx, {
      ruleId: "const-removed",
      location: { ...base, pointerOld: `${pointerOld}/const`, pointerNew: `${pointerNew}/const` },
      oldValue: oldConst
    });
  }
}
function diffConstraints(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name) {
  for (const key of Object.keys(CONSTRAINT_LABEL)) {
    const oldV = oldSchema[key];
    const newV = newSchema[key];
    if (oldV === void 0 && newV === void 0) continue;
    const ptrOld = `${pointerOld}/${key}`;
    const ptrNew = `${pointerNew}/${key}`;
    const base = { ...location };
    if (oldV === void 0 && newV !== void 0) {
      emit(ctx, {
        ruleId: "constraint-added",
        location: { ...base, pointerOld: ptrOld, pointerNew: ptrNew },
        oldValue: void 0,
        newValue: newV
      });
      continue;
    }
    if (oldV !== void 0 && newV === void 0) {
      emit(ctx, {
        ruleId: "constraint-removed",
        location: { ...base, pointerOld: ptrOld, pointerNew: ptrNew },
        oldValue: oldV
      });
      continue;
    }
    if (deepEqual(oldV, newV)) continue;
    if (key === "pattern") {
      emit(ctx, {
        ruleId: "constraint-tightened",
        location: { ...base, pointerOld: ptrOld, pointerNew: ptrNew },
        oldValue: oldV,
        newValue: newV
      });
      continue;
    }
    if (NUMERIC_KEYS.has(key)) {
      const o2 = num(oldV);
      const n2 = num(newV);
      const isLower = LOWER_BOUNDS.includes(key) || key === "exclusiveMinimum";
      const dir = boundDirection(isLower ? "lower" : "upper", o2, n2);
      emit(ctx, {
        ruleId: dir === "tightened" ? "constraint-tightened" : "constraint-relaxed",
        location: { ...base, pointerOld: ptrOld, pointerNew: ptrNew },
        oldValue: oldV,
        newValue: newV
      });
      continue;
    }
    const o = num(oldV);
    const n = num(newV);
    if (o !== void 0 && n !== void 0) {
      const isLower = LOWER_BOUNDS.includes(key);
      const dir = boundDirection(isLower ? "lower" : "upper", o, n);
      emit(ctx, {
        ruleId: dir === "tightened" ? "constraint-tightened" : "constraint-relaxed",
        location: { ...base, pointerOld: ptrOld, pointerNew: ptrNew },
        oldValue: oldV,
        newValue: newV
      });
    }
    void name;
  }
}
function diffAdditionalProperties(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name) {
  const oldClosed = isClosed(oldSchema.additionalProperties);
  const newClosed = isClosed(newSchema.additionalProperties);
  void name;
  if (!oldClosed && newClosed) {
    emit(ctx, {
      ruleId: "map-closed",
      location: {
        ...location,
        pointerOld: `${pointerOld}/additionalProperties`,
        pointerNew: `${pointerNew}/additionalProperties`
      }
    });
  } else if (oldClosed && !newClosed) {
    emit(ctx, {
      ruleId: "map-opened",
      location: {
        ...location,
        pointerOld: `${pointerOld}/additionalProperties`,
        pointerNew: `${pointerNew}/additionalProperties`
      }
    });
  }
}
function isClosed(v) {
  if (v === void 0 || v === true) return false;
  return true;
}
function diffComposition(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name) {
  void name;
  const oldAll = Array.isArray(oldSchema.allOf) ? oldSchema.allOf : [];
  const newAll = Array.isArray(newSchema.allOf) ? newSchema.allOf : [];
  if (newAll.length > oldAll.length) {
    emit(ctx, {
      ruleId: "allOf-member-added",
      location: {
        ...location,
        pointerOld: `${pointerOld}/allOf`,
        pointerNew: `${pointerNew}/allOf`
      },
      oldValue: oldAll.length,
      newValue: newAll.length
    });
  } else if (newAll.length < oldAll.length) {
    emit(ctx, {
      ruleId: "allOf-member-removed",
      location: {
        ...location,
        pointerOld: `${pointerOld}/allOf`,
        pointerNew: `${pointerNew}/allOf`
      },
      oldValue: oldAll.length,
      newValue: newAll.length
    });
  }
  for (const key of ["anyOf", "oneOf"]) {
    const oldArr = Array.isArray(oldSchema[key]) ? oldSchema[key] : [];
    const newArr = Array.isArray(newSchema[key]) ? newSchema[key] : [];
    if (newArr.length > oldArr.length) {
      emit(ctx, {
        ruleId: "anyOf-oneOf-member-added",
        location: {
          ...location,
          pointerOld: `${pointerOld}/${key}`,
          pointerNew: `${pointerNew}/${key}`
        },
        oldValue: oldArr.length,
        newValue: newArr.length
      });
    } else if (newArr.length < oldArr.length) {
      emit(ctx, {
        ruleId: "anyOf-oneOf-member-removed",
        location: {
          ...location,
          pointerOld: `${pointerOld}/${key}`,
          pointerNew: `${pointerNew}/${key}`
        },
        oldValue: oldArr.length,
        newValue: newArr.length
      });
    }
  }
}
function diffDiscriminator(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name) {
  void name;
  const oldDisc = isObject(oldSchema.discriminator) ? oldSchema.discriminator : void 0;
  const newDisc = isObject(newSchema.discriminator) ? newSchema.discriminator : void 0;
  if (!oldDisc && newDisc) {
    emit(ctx, {
      ruleId: "discriminator-added",
      location: {
        ...location,
        pointerOld: `${pointerOld}/discriminator`,
        pointerNew: `${pointerNew}/discriminator`
      },
      newValue: newDisc.propertyName
    });
  } else if (oldDisc && newDisc && !deepEqual(oldDisc, newDisc)) {
    emit(ctx, {
      ruleId: "discriminator-changed",
      location: {
        ...location,
        pointerOld: `${pointerOld}/discriminator`,
        pointerNew: `${pointerNew}/discriminator`
      },
      oldValue: oldDisc.propertyName,
      newValue: newDisc.propertyName
    });
  } else if (oldDisc && !newDisc) {
    emit(ctx, {
      ruleId: "discriminator-changed",
      location: {
        ...location,
        pointerOld: `${pointerOld}/discriminator`,
        pointerNew: `${pointerNew}/discriminator`
      },
      oldValue: oldDisc.propertyName,
      newValue: void 0
    });
  }
}
function compactType(t) {
  if (t === void 0) return void 0;
  return typeLabel(t);
}
function compact(v) {
  if (v === void 0 || v === null) return v;
  if (typeof v !== "object") return v;
  const json = JSON.stringify(v);
  if (json === void 0 || json.length <= 80) return v;
  return `${json.slice(0, 77)}\u2026`;
}
function stringArrayOf(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
function stringArray2(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
function lastToken(pointer) {
  const tokens = pointer.split("/").filter(Boolean);
  const last = tokens[tokens.length - 1];
  return (last ?? "").replace(/~1/g, "/").replace(/~0/g, "~");
}

// src/core/engine/differ.ts
function emit(ctx, opts) {
  const resolved = classify(
    opts.ruleId,
    opts.location.context,
    { rules: ctx.config.rules },
    opts.doctrine
  );
  const rule = getRule(opts.ruleId);
  const severity = opts.severityOverride ?? (resolved ? resolved.severity : rule.defaultSeverity);
  const kind = opts.kindOverride ?? (resolved ? resolved.kind : rule.defaultKind);
  if (resolved === null) return;
  const templateCtx = {
    location: opts.location,
    oldValue: opts.oldValue,
    newValue: opts.newValue
  };
  const change = {
    id: changeId({
      ruleId: opts.ruleId,
      context: opts.location.context,
      path: opts.location.path,
      method: opts.location.method,
      pointerOld: opts.location.pointerOld,
      pointerNew: opts.location.pointerNew,
      oldValue: opts.oldValue,
      newValue: opts.newValue
    }),
    ruleId: opts.ruleId,
    severity,
    kind,
    breaking: severity === "error",
    location: opts.location,
    message: rule.message(templateCtx),
    suggestion: rule.suggestion(templateCtx),
    ...opts.oldValue !== void 0 ? { oldValue: opts.oldValue } : {},
    ...opts.newValue !== void 0 ? { newValue: opts.newValue } : {}
  };
  ctx.candidates.push(change);
}
function diffDocumentLevel(ctx) {
  const oldDoc = isObject(ctx.baseline.normalized) ? ctx.baseline.normalized : {};
  const newDoc = isObject(ctx.current.normalized) ? ctx.current.normalized : {};
  if (!deepEqual(oldDoc.openapi, newDoc.openapi)) {
    emit(ctx, {
      ruleId: "openapi-version-changed",
      location: {
        path: "/",
        pointerOld: pointerJoin("openapi"),
        pointerNew: pointerJoin("openapi"),
        context: "api"
      },
      oldValue: oldDoc.openapi,
      newValue: newDoc.openapi
    });
  }
  const infoOld = isObject(oldDoc.info) ? oldDoc.info : {};
  const infoNew = isObject(newDoc.info) ? newDoc.info : {};
  if (!deepEqual(infoOld.title, infoNew.title)) {
    emit(ctx, {
      ruleId: "title-changed",
      location: {
        path: "/",
        pointerOld: pointerJoin("info", "title"),
        pointerNew: pointerJoin("info", "title"),
        context: "api"
      },
      oldValue: infoOld.title,
      newValue: infoNew.title
    });
  }
  if (!deepEqual(infoOld.description, infoNew.description)) {
    emit(ctx, {
      ruleId: "description-changed",
      location: {
        path: "/",
        pointerOld: pointerJoin("info", "description"),
        pointerNew: pointerJoin("info", "description"),
        context: "api"
      },
      oldValue: infoOld.description,
      newValue: infoNew.description
    });
  }
  if (!deepEqual(infoOld.contact, infoNew.contact)) {
    emit(ctx, {
      ruleId: "contact-changed",
      location: {
        path: "/",
        pointerOld: pointerJoin("info", "contact"),
        pointerNew: pointerJoin("info", "contact"),
        context: "api"
      },
      oldValue: compact2(infoOld.contact),
      newValue: compact2(infoNew.contact)
    });
  }
  if (!deepEqual(infoOld.license, infoNew.license)) {
    emit(ctx, {
      ruleId: "license-changed",
      location: {
        path: "/",
        pointerOld: pointerJoin("info", "license"),
        pointerNew: pointerJoin("info", "license"),
        context: "api"
      },
      oldValue: compact2(infoOld.license),
      newValue: compact2(infoNew.license)
    });
  }
  if (!deepEqual(oldDoc.externalDocs, newDoc.externalDocs)) {
    emit(ctx, {
      ruleId: "external-docs-changed",
      location: {
        path: "/",
        pointerOld: pointerJoin("externalDocs"),
        pointerNew: pointerJoin("externalDocs"),
        context: "api"
      },
      oldValue: compact2(oldDoc.externalDocs),
      newValue: compact2(newDoc.externalDocs)
    });
  }
  diffServers(ctx, oldDoc, newDoc);
}
function diffServers(ctx, oldDoc, newDoc) {
  const oldServers = Array.isArray(oldDoc.servers) ? oldDoc.servers : [];
  const newServers = Array.isArray(newDoc.servers) ? newDoc.servers : [];
  const oldUrls = oldServers.map((s) => isObject(s) ? s.url : void 0);
  const newUrls = newServers.map((s) => isObject(s) ? s.url : void 0);
  for (const url of oldUrls) {
    if (typeof url === "string" && !newUrls.includes(url)) {
      emit(ctx, {
        ruleId: "server-url-removed",
        location: {
          path: "/",
          pointerOld: pointerJoin("servers"),
          pointerNew: pointerJoin("servers"),
          context: "api"
        },
        oldValue: url
      });
    }
  }
  for (const url of newUrls) {
    if (typeof url === "string" && !oldUrls.includes(url)) {
      emit(ctx, {
        ruleId: "server-url-added",
        location: {
          path: "/",
          pointerOld: pointerJoin("servers"),
          pointerNew: pointerJoin("servers"),
          context: "api"
        },
        newValue: url
      });
    }
  }
  for (const oldS of oldServers) {
    if (!isObject(oldS)) continue;
    const url = oldS.url;
    if (typeof url !== "string") continue;
    const newS = newServers.find((s) => isObject(s) && s.url === url);
    if (!newS || !isObject(newS)) continue;
    if (!deepEqual(oldS.description, newS.description) || !deepEqual(oldS.variables, newS.variables)) {
      emit(ctx, {
        ruleId: "server-metadata-changed",
        location: {
          path: "/",
          pointerOld: pointerJoin("servers"),
          pointerNew: pointerJoin("servers"),
          context: "api"
        },
        oldValue: compact2({ description: oldS.description, variables: oldS.variables }),
        newValue: compact2({ description: newS.description, variables: newS.variables })
      });
    }
  }
}
function diffOperations(ctx) {
  const { baselineIndex: bi, currentIndex: ci } = ctx;
  for (const p of bi.paths) {
    if (!ci.pathItems.has(p)) {
      emit(ctx, {
        ruleId: "removed-path",
        location: {
          path: p,
          pointerOld: pointerJoin("paths", p),
          pointerNew: "",
          context: "operation"
        }
      });
    }
  }
  const commonPaths = bi.paths.filter((p) => ci.pathItems.has(p));
  for (const p of commonPaths) {
    const oldItem = bi.pathItems.get(p);
    const newItem = ci.pathItems.get(p);
    const oldMethods = methodKeys(oldItem);
    const newMethods = methodKeys(newItem);
    for (const m of oldMethods) {
      if (!newMethods.includes(m)) {
        emit(ctx, {
          ruleId: "removed-method",
          location: {
            path: p,
            method: m,
            pointerOld: pointerJoin("paths", p, m.toLowerCase()),
            pointerNew: "",
            context: "operation"
          }
        });
      }
    }
    for (const m of newMethods) {
      if (!oldMethods.includes(m)) {
        emit(ctx, {
          ruleId: "operation-added",
          location: {
            path: p,
            method: m,
            pointerOld: "",
            pointerNew: pointerJoin("paths", p, m.toLowerCase()),
            context: "operation"
          }
        });
      }
    }
    for (const m of oldMethods.filter((m2) => newMethods.includes(m2))) {
      diffOperationPair(ctx, p, m, oldItem, newItem);
    }
  }
  for (const p of ci.paths) {
    if (!bi.pathItems.has(p)) {
      const newItem = ci.pathItems.get(p);
      for (const m of methodKeys(newItem)) {
        emit(ctx, {
          ruleId: "operation-added",
          location: {
            path: p,
            method: m,
            pointerOld: "",
            pointerNew: pointerJoin("paths", p, m.toLowerCase()),
            context: "operation"
          }
        });
      }
    }
  }
  diffWebhooks(ctx);
}
function methodKeys(item) {
  return Object.keys(item).filter(
    (k) => ["get", "post", "put", "patch", "delete", "head", "options", "trace"].includes(
      k.toLowerCase()
    )
  ).map((k) => k.toUpperCase()).sort();
}
function diffOperationPair(ctx, path3, method, oldItem, newItem) {
  const oldOp = isObject(oldItem[method.toLowerCase()]) ? oldItem[method.toLowerCase()] : {};
  const newOp = isObject(newItem[method.toLowerCase()]) ? newItem[method.toLowerCase()] : {};
  const baseLoc = { path: path3, method };
  if (!deepEqual(oldOp.operationId, newOp.operationId)) {
    emit(ctx, {
      ruleId: "operation-id-changed",
      location: {
        ...baseLoc,
        operationId: typeof newOp.operationId === "string" ? newOp.operationId : void 0,
        pointerOld: pointerJoin("paths", path3, method.toLowerCase(), "operationId"),
        pointerNew: pointerJoin("paths", path3, method.toLowerCase(), "operationId"),
        context: "operation"
      },
      oldValue: oldOp.operationId,
      newValue: newOp.operationId
    });
  }
  const oldDep = oldOp.deprecated === true;
  const newDep = newOp.deprecated === true;
  if (newDep && !oldDep) {
    emit(ctx, {
      ruleId: "operation-deprecated-added",
      location: {
        ...baseLoc,
        pointerOld: pointerJoin("paths", path3, method.toLowerCase(), "deprecated"),
        pointerNew: pointerJoin("paths", path3, method.toLowerCase(), "deprecated"),
        context: "operation"
      }
    });
  } else if (oldDep && !newDep) {
    emit(ctx, {
      ruleId: "operation-deprecated-removed",
      location: {
        ...baseLoc,
        pointerOld: pointerJoin("paths", path3, method.toLowerCase(), "deprecated"),
        pointerNew: pointerJoin("paths", path3, method.toLowerCase(), "deprecated"),
        context: "operation"
      }
    });
  }
  if (!deepEqual(oldOp.tags, newOp.tags)) {
    emit(ctx, {
      ruleId: "operation-tags-changed",
      location: {
        ...baseLoc,
        pointerOld: pointerJoin("paths", path3, method.toLowerCase(), "tags"),
        pointerNew: pointerJoin("paths", path3, method.toLowerCase(), "tags"),
        context: "operation"
      },
      oldValue: compact2(oldOp.tags),
      newValue: compact2(newOp.tags)
    });
  }
  if (!deepEqual(oldOp.summary, newOp.summary)) {
    emit(ctx, {
      ruleId: "operation-summary-changed",
      location: {
        ...baseLoc,
        pointerOld: pointerJoin("paths", path3, method.toLowerCase(), "summary"),
        pointerNew: pointerJoin("paths", path3, method.toLowerCase(), "summary"),
        context: "operation"
      },
      oldValue: oldOp.summary,
      newValue: newOp.summary
    });
  }
  if (!deepEqual(oldOp.description, newOp.description)) {
    emit(ctx, {
      ruleId: "operation-description-changed",
      location: {
        ...baseLoc,
        pointerOld: pointerJoin("paths", path3, method.toLowerCase(), "description"),
        pointerNew: pointerJoin("paths", path3, method.toLowerCase(), "description"),
        context: "operation"
      },
      oldValue: oldOp.description,
      newValue: newOp.description
    });
  }
  diffNamedMap(ctx, oldOp.callbacks, newOp.callbacks, "callback-added", "callback-removed", {
    ...baseLoc,
    context: "operation"
  });
  diffParameters(ctx, baseLoc, oldItem, oldOp, newItem, newOp);
  diffRequestBody(ctx, baseLoc, oldOp, newOp);
  diffResponses(ctx, baseLoc, oldOp, newOp);
}
function diffNamedMap(ctx, oldMap, newMap, addedRule, removedRule, baseLoc) {
  const oldObj = isObject(oldMap) ? oldMap : {};
  const newObj = isObject(newMap) ? newMap : {};
  for (const name of Object.keys(oldObj).sort()) {
    if (!(name in newObj)) {
      emit(ctx, {
        ruleId: removedRule,
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method?.toLowerCase() ?? "",
            "callbacks",
            name
          ),
          pointerNew: ""
        },
        oldValue: name
      });
    }
  }
  for (const name of Object.keys(newObj).sort()) {
    if (!(name in oldObj)) {
      emit(ctx, {
        ruleId: addedRule,
        location: {
          ...baseLoc,
          pointerOld: "",
          pointerNew: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method?.toLowerCase() ?? "",
            "callbacks",
            name
          )
        },
        newValue: name
      });
    }
  }
}
function diffParameters(ctx, baseLoc, oldItem, oldOp, newItem, newOp) {
  const oldParams = mergedParameters(oldItem, oldOp);
  const newParams = mergedParameters(newItem, newOp);
  const keyOf = (p) => `${typeof p.name === "string" ? p.name : ""}`;
  const oldByKey = /* @__PURE__ */ new Map();
  for (const p of oldParams) {
    const k = keyOf(p);
    if (!oldByKey.has(k)) oldByKey.set(k, p);
  }
  const newByKey = /* @__PURE__ */ new Map();
  for (const p of newParams) {
    const k = keyOf(p);
    if (!newByKey.has(k)) newByKey.set(k, p);
  }
  for (const [key, oldP] of oldByKey) {
    const name = typeof oldP.name === "string" ? oldP.name : key;
    const wasIn = typeof oldP.in === "string" ? oldP.in : "";
    const newP = newByKey.get(key);
    if (!newP) {
      const wasRequired = oldP.required === true || wasIn === "path" || wasIn === "header";
      emit(ctx, {
        ruleId: "removed-parameter",
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "parameters",
            name
          ),
          pointerNew: "",
          context: wasIn === "header" ? "request-header" : "parameter"
        },
        oldValue: name,
        doctrine: { wasRequired }
      });
      continue;
    }
    const newIn = typeof newP.in === "string" ? newP.in : "";
    if (newIn !== wasIn) {
      emit(ctx, {
        ruleId: "parameter-location-changed",
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "parameters",
            name
          ),
          pointerNew: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "parameters",
            name
          ),
          context: "parameter"
        },
        oldValue: wasIn,
        newValue: newIn
      });
      continue;
    }
    const oldReq = oldP.required === true;
    const newReq = newP.required === true;
    if (!oldReq && newReq) {
      emit(ctx, {
        ruleId: "parameter-made-required",
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "parameters",
            name
          ),
          pointerNew: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "parameters",
            name
          ),
          context: "parameter"
        }
      });
    }
    const oldSchema = isObject(oldP.schema) ? oldP.schema : void 0;
    const newSchema = isObject(newP.schema) ? newP.schema : void 0;
    if (oldSchema && newSchema) {
      diffSchemaNode(
        ctx,
        oldSchema,
        newSchema,
        pointerJoin(
          "paths",
          baseLoc.path,
          baseLoc.method.toLowerCase(),
          "parameters",
          name,
          "schema"
        ),
        pointerJoin(
          "paths",
          baseLoc.path,
          baseLoc.method.toLowerCase(),
          "parameters",
          name,
          "schema"
        ),
        { context: "parameter", path: baseLoc.path, method: baseLoc.method },
        {
          requiredOld: stringArrayOf2(oldSchema.required),
          requiredNew: stringArrayOf2(newSchema.required),
          sideClass: "send"
        }
      );
    }
    if (!deepEqual(oldP.description, newP.description) || !deepEqual(oldP.example, newP.example) || !deepEqual(oldP.deprecated, newP.deprecated)) {
      emit(ctx, {
        ruleId: "parameter-metadata-changed",
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "parameters",
            name
          ),
          pointerNew: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "parameters",
            name
          ),
          context: "parameter"
        }
      });
    }
  }
  for (const [key, newP] of newByKey) {
    if (oldByKey.has(key)) continue;
    const name = typeof newP.name === "string" ? newP.name : key;
    const isIn = typeof newP.in === "string" ? newP.in : "";
    const required = newP.required === true || isIn === "path";
    emit(ctx, {
      ruleId: required ? "parameter-added-required" : "parameter-added-optional",
      location: {
        ...baseLoc,
        pointerOld: "",
        pointerNew: pointerJoin(
          "paths",
          baseLoc.path,
          baseLoc.method.toLowerCase(),
          "parameters",
          name
        ),
        context: "parameter"
      },
      newValue: name
    });
  }
}
function diffRequestBody(ctx, baseLoc, oldOp, newOp) {
  const oldBody = isObject(oldOp.requestBody) ? oldOp.requestBody : void 0;
  const newBody = isObject(newOp.requestBody) ? newOp.requestBody : void 0;
  if (oldBody && !newBody) {
    emit(ctx, {
      ruleId: "request-body-removed",
      location: {
        ...baseLoc,
        pointerOld: pointerJoin("paths", baseLoc.path, baseLoc.method.toLowerCase(), "requestBody"),
        pointerNew: "",
        context: "request-body"
      },
      doctrine: { wasRequired: oldBody.required === true }
    });
    return;
  }
  if (!oldBody && newBody) {
    emit(ctx, {
      ruleId: newBody.required === true ? "request-body-added-required" : "request-body-added-optional",
      location: {
        ...baseLoc,
        pointerOld: "",
        pointerNew: pointerJoin("paths", baseLoc.path, baseLoc.method.toLowerCase(), "requestBody"),
        context: "request-body"
      }
    });
    return;
  }
  if (oldBody && newBody) {
    if (!oldBody.required && newBody.required === true) {
      emit(ctx, {
        ruleId: "request-body-required-changed",
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "requestBody",
            "required"
          ),
          pointerNew: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "requestBody",
            "required"
          ),
          context: "request-body"
        }
      });
    }
    const oldContent = isObject(oldBody.content) ? oldBody.content : {};
    const newContent = isObject(newBody.content) ? newBody.content : {};
    for (const mt of Object.keys(oldContent).sort()) {
      if (!(mt in newContent)) {
        emit(ctx, {
          ruleId: "content-type-removed",
          location: {
            ...baseLoc,
            mediaType: mt,
            pointerOld: pointerJoin(
              "paths",
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              "requestBody",
              "content",
              mt
            ),
            pointerNew: "",
            context: "request-body"
          },
          oldValue: mt
        });
      }
    }
    for (const mt of Object.keys(newContent).sort()) {
      if (!(mt in oldContent)) {
        emit(ctx, {
          ruleId: "content-type-added",
          location: {
            ...baseLoc,
            mediaType: mt,
            pointerOld: "",
            pointerNew: pointerJoin(
              "paths",
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              "requestBody",
              "content",
              mt
            ),
            context: "request-body"
          },
          newValue: mt
        });
      }
    }
    for (const mt of Object.keys(oldContent).sort()) {
      if (!(mt in newContent)) continue;
      const oldMt = isObject(oldContent[mt]) ? oldContent[mt] : {};
      const newMt = isObject(newContent[mt]) ? newContent[mt] : {};
      const oldSchemaRaw = isObject(oldMt.schema) ? oldMt.schema : void 0;
      const newSchemaRaw = isObject(newMt.schema) ? newMt.schema : void 0;
      if (oldSchemaRaw && newSchemaRaw) {
        const oldSchema = applyView(oldSchemaRaw, "request");
        const newSchema = applyView(newSchemaRaw, "request");
        diffSchemaNode(
          ctx,
          oldSchema,
          newSchema,
          pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "requestBody",
            "content",
            mt,
            "schema"
          ),
          pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "requestBody",
            "content",
            mt,
            "schema"
          ),
          {
            context: "request-body",
            path: baseLoc.path,
            method: baseLoc.method,
            mediaType: mt
          },
          {
            requiredOld: stringArrayOf2(oldSchema.required),
            requiredNew: stringArrayOf2(newSchema.required),
            sideClass: "send"
          }
        );
      }
    }
  }
}
function diffResponses(ctx, baseLoc, oldOp, newOp) {
  const oldRes = isObject(oldOp.responses) ? oldOp.responses : {};
  const newRes = isObject(newOp.responses) ? newOp.responses : {};
  for (const status of Object.keys(oldRes).sort()) {
    if (!(status in newRes)) {
      emit(ctx, {
        ruleId: status === "default" ? "default-response-removed" : "response-removed",
        location: {
          ...baseLoc,
          statusCode: status,
          pointerOld: pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "responses",
            status
          ),
          pointerNew: "",
          context: "response-body"
        },
        oldValue: status
      });
      continue;
    }
    const oldR = isObject(oldRes[status]) ? oldRes[status] : {};
    const newR = isObject(newRes[status]) ? newRes[status] : {};
    const oldHeaders = isObject(oldR.headers) ? oldR.headers : {};
    const newHeaders = isObject(newR.headers) ? newR.headers : {};
    for (const h of Object.keys(oldHeaders).sort()) {
      if (!(h in newHeaders)) {
        emit(ctx, {
          ruleId: "response-header-removed",
          location: {
            ...baseLoc,
            statusCode: status,
            pointerOld: pointerJoin(
              "paths",
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              "responses",
              status,
              "headers",
              h
            ),
            pointerNew: "",
            context: "response-header"
          },
          oldValue: h
        });
      }
    }
    for (const h of Object.keys(newHeaders).sort()) {
      if (!(h in oldHeaders)) {
        emit(ctx, {
          ruleId: "response-header-added",
          location: {
            ...baseLoc,
            statusCode: status,
            pointerOld: "",
            pointerNew: pointerJoin(
              "paths",
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              "responses",
              status,
              "headers",
              h
            ),
            context: "response-header"
          },
          newValue: h
        });
      }
    }
    const oldContent = isObject(oldR.content) ? oldR.content : {};
    const newContent = isObject(newR.content) ? newR.content : {};
    for (const mt of Object.keys(oldContent).sort()) {
      if (!(mt in newContent)) {
        emit(ctx, {
          ruleId: "content-type-removed",
          location: {
            ...baseLoc,
            statusCode: status,
            mediaType: mt,
            pointerOld: pointerJoin(
              "paths",
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              "responses",
              status,
              "content",
              mt
            ),
            pointerNew: "",
            context: "response-body"
          },
          oldValue: mt
        });
      }
    }
    for (const mt of Object.keys(newContent).sort()) {
      if (!(mt in oldContent)) {
        emit(ctx, {
          ruleId: "content-type-added",
          location: {
            ...baseLoc,
            statusCode: status,
            mediaType: mt,
            pointerOld: "",
            pointerNew: pointerJoin(
              "paths",
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              "responses",
              status,
              "content",
              mt
            ),
            context: "response-body"
          },
          newValue: mt
        });
      }
    }
    for (const mt of Object.keys(oldContent).sort()) {
      if (!(mt in newContent)) continue;
      const oldMt = isObject(oldContent[mt]) ? oldContent[mt] : {};
      const newMt = isObject(newContent[mt]) ? newContent[mt] : {};
      const oldSchemaRaw = isObject(oldMt.schema) ? oldMt.schema : void 0;
      const newSchemaRaw = isObject(newMt.schema) ? newMt.schema : void 0;
      if (oldSchemaRaw && newSchemaRaw) {
        const oldSchema = applyView(oldSchemaRaw, "response");
        const newSchema = applyView(newSchemaRaw, "response");
        diffSchemaNode(
          ctx,
          oldSchema,
          newSchema,
          pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "responses",
            status,
            "content",
            mt,
            "schema"
          ),
          pointerJoin(
            "paths",
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            "responses",
            status,
            "content",
            mt,
            "schema"
          ),
          {
            context: "response-body",
            path: baseLoc.path,
            method: baseLoc.method,
            statusCode: status,
            mediaType: mt
          },
          {
            requiredOld: stringArrayOf2(oldSchema.required),
            requiredNew: stringArrayOf2(newSchema.required),
            sideClass: "parse"
          }
        );
      }
    }
  }
  for (const status of Object.keys(newRes).sort()) {
    if (status in oldRes) continue;
    emit(ctx, {
      ruleId: "response-added",
      location: {
        ...baseLoc,
        statusCode: status,
        pointerOld: "",
        pointerNew: pointerJoin(
          "paths",
          baseLoc.path,
          baseLoc.method.toLowerCase(),
          "responses",
          status
        ),
        context: "response-body"
      },
      newValue: status
    });
  }
}
function diffWebhooks(ctx) {
  for (const name of ctx.baselineIndex.webhooks.keys()) {
    if (!ctx.currentIndex.webhooks.has(name)) {
      emit(ctx, {
        ruleId: "webhook-removed",
        location: {
          path: "",
          pointerOld: pointerJoin("webhooks", name),
          pointerNew: "",
          context: "webhook"
        },
        oldValue: name
      });
    }
  }
  for (const name of ctx.currentIndex.webhooks.keys()) {
    if (!ctx.baselineIndex.webhooks.has(name)) {
      emit(ctx, {
        ruleId: "webhook-added",
        location: {
          path: "",
          pointerOld: "",
          pointerNew: pointerJoin("webhooks", name),
          context: "webhook"
        },
        newValue: name
      });
    }
  }
}
function compact2(v) {
  if (v === void 0 || v === null) return v;
  if (typeof v !== "object") return v;
  const json = JSON.stringify(v);
  if (json === void 0 || json.length <= 80) return v;
  return `${json.slice(0, 77)}\u2026`;
}
function runStructuralDiff(ctx) {
  ctx.candidates = [];
  diffDocumentLevel(ctx);
  diffOperations(ctx);
  diffComponents(ctx);
  diffSecurity(ctx);
  return ctx.candidates;
}
function diffComponents(ctx) {
  const { baselineIndex: bi, currentIndex: ci } = ctx;
  const usedOld = usedSchemas(ctx.baseline.normalized);
  const usedNew = usedSchemas(ctx.current.normalized);
  for (const name of bi.schemas.keys()) {
    const oldSchema = bi.schemas.get(name);
    const newSchema = ci.schemas.get(name);
    if (!newSchema) continue;
    if (!oldSchema) continue;
    if (!usedOld.has(name) && !usedNew.has(name)) continue;
    const usages = usageClasses(ctx, name);
    const sideClass = usages.parse > 0 ? "parse" : "send";
    const usageCount = usages.send + usages.parse;
    const firstUsage = firstUsagePointer(ctx, name);
    diffComponentSchema(ctx, name, oldSchema, newSchema, sideClass, usageCount, firstUsage);
  }
}
function diffComponentSchema(ctx, name, oldSchema, newSchema, sideClass, usageCount, firstUsage) {
  const base = {
    context: "component",
    path: "",
    componentName: name
  };
  void firstUsage;
  const view = sideClass === "send" ? "request" : "response";
  const before = ctx.candidates.length;
  diffSchemaNode(
    ctx,
    applyView(oldSchema, view),
    applyView(newSchema, view),
    pointerJoin("components", "schemas", name),
    pointerJoin("components", "schemas", name),
    base,
    {
      requiredOld: stringArrayOf2(applyView(oldSchema, view).required),
      requiredNew: stringArrayOf2(applyView(newSchema, view).required),
      sideClass
    }
  );
  for (let i = before; i < ctx.candidates.length; i++) {
    const c = ctx.candidates[i];
    if (c !== void 0 && c.location.context === "component") {
      c.location.usageCount = usageCount;
    }
  }
}
function stringArrayOf2(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
var VIEW_MAX_DEPTH = 512;
function applyView(schema, view) {
  const pruneKey = view === "request" ? "readOnly" : "writeOnly";
  const visit = (node, depth) => {
    if (depth > VIEW_MAX_DEPTH) return node;
    const out = { ...node };
    const props = isObject(out.properties) ? out.properties : void 0;
    if (props) {
      const kept = {};
      for (const [name, child] of Object.entries(props)) {
        const childObj = isObject(child) ? child : void 0;
        if (childObj && childObj[pruneKey] === true) continue;
        kept[name] = childObj ? visit(childObj, depth + 1) : child;
      }
      out.properties = kept;
    }
    if (Array.isArray(out.required)) {
      out.required = out.required.filter((r) => {
        if (typeof r !== "string") return true;
        const prop = props?.[r];
        const propObj = isObject(prop) ? prop : void 0;
        return !(propObj && propObj[pruneKey] === true);
      });
    }
    for (const key of ["items", "additionalProperties"]) {
      const child = out[key];
      const childObj = isObject(child) ? child : void 0;
      if (childObj) out[key] = visit(childObj, depth + 1);
    }
    for (const key of ["allOf", "anyOf", "oneOf"]) {
      if (Array.isArray(out[key])) {
        out[key] = out[key].map((m) => {
          const mObj = isObject(m) ? m : void 0;
          return mObj ? visit(mObj, depth + 1) : m;
        });
      }
    }
    return out;
  };
  return visit(schema, 0);
}
function usedSchemas(document) {
  const used = /* @__PURE__ */ new Set();
  const stack = [document];
  const seen = /* @__PURE__ */ new Set();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    const obj = node;
    for (const [k, v] of Object.entries(obj)) {
      if (k === "$ref" && typeof v === "string") {
        const m = v.match(/^#\/components\/schemas\/([^/]+)/);
        if (m && m[1]) used.add(m[1].replace(/~1/g, "/").replace(/~0/g, "~"));
      } else if (v !== null && typeof v === "object") {
        stack.push(v);
      }
    }
  }
  return used;
}
function usageClasses(ctx, name) {
  let send = 0;
  let parse = 0;
  const refPattern = new RegExp(`^#/components/schemas/${escapeRegExp(name)}$`);
  const classifyUse = (doc) => {
    const docObj = isObject(doc) ? doc : {};
    const pathsObj = isObject(docObj.paths) ? docObj.paths : {};
    for (const p of Object.keys(pathsObj).sort()) {
      const item = isObject(pathsObj[p]) ? pathsObj[p] : {};
      for (const method of Object.keys(item).sort()) {
        if (!isHttpMethod(method)) continue;
        const op = isObject(item[method]) ? item[method] : {};
        countIn(op.requestBody, "send");
        countIn(op.responses, "parse");
        countIn(op.parameters, "send");
        countIn(item.parameters, "send");
      }
    }
    const webhooksObj = isObject(docObj.webhooks) ? docObj.webhooks : {};
    for (const w of Object.keys(webhooksObj)) {
      countIn(webhooksObj[w], "parse");
    }
  };
  const countIn = (node, side) => {
    const stack = [node];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === null || typeof n !== "object") continue;
      if (Array.isArray(n)) {
        for (const v of n) stack.push(v);
        continue;
      }
      const obj = n;
      for (const [k, v] of Object.entries(obj)) {
        if (k === "$ref" && typeof v === "string" && refPattern.test(v)) {
          if (side === "send") send++;
          else parse++;
        } else if (v !== null && typeof v === "object") {
          stack.push(v);
        }
      }
    }
  };
  classifyUse(ctx.baseline.normalized);
  classifyUse(ctx.current.normalized);
  return { send, parse };
}
function firstUsagePointer(ctx, name) {
  const ref = `#/components/schemas/${name}`;
  const findIn = (doc) => {
    const docObj = isObject(doc) ? doc : {};
    const pathsObj = isObject(docObj.paths) ? docObj.paths : {};
    for (const p of Object.keys(pathsObj).sort()) {
      const item = isObject(pathsObj[p]) ? pathsObj[p] : {};
      const found = findRefIn(item, ref, pointerJoin("paths", p));
      if (found) return found;
    }
    return "";
  };
  return findIn(ctx.current.normalized) || findIn(ctx.baseline.normalized);
}
function findRefIn(node, ref, pointer) {
  const stack = [{ node, pointer }];
  while (stack.length > 0) {
    const { node: n, pointer: ptr } = stack.pop();
    if (n === null || typeof n !== "object") continue;
    if (Array.isArray(n)) {
      n.forEach((v, i) => stack.push({ node: v, pointer: `${ptr}/${i}` }));
      continue;
    }
    const obj = n;
    for (const [k, v] of Object.entries(obj)) {
      if (k === "$ref" && v === ref) return ptr;
      if (v !== null && typeof v === "object") {
        stack.push({ node: v, pointer: `${ptr}/${k}` });
      }
    }
  }
  return "";
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function diffSecurity(ctx) {
  const oldDoc = isObject(ctx.baseline.normalized) ? ctx.baseline.normalized : {};
  const newDoc = isObject(ctx.current.normalized) ? ctx.current.normalized : {};
  const oldComp = isObject(oldDoc.components) ? oldDoc.components : {};
  const newComp = isObject(newDoc.components) ? newDoc.components : {};
  const oldSchemes = isObject(oldComp.securitySchemes) ? oldComp.securitySchemes : {};
  const newSchemes = isObject(newComp.securitySchemes) ? newComp.securitySchemes : {};
  const oldGlobal = Array.isArray(oldDoc.security) ? oldDoc.security : [];
  const newGlobal = Array.isArray(newDoc.security) ? newDoc.security : [];
  const referencedOld = referencedSchemeNames(oldDoc);
  const referencedNew = referencedSchemeNames(newDoc);
  for (const name of Object.keys(oldSchemes).sort()) {
    const oldScheme = isObject(oldSchemes[name]) ? oldSchemes[name] : {};
    const newScheme = isObject(newSchemes[name]) ? newSchemes[name] : {};
    if (!(name in newSchemes)) {
      const wasReferenced = referencedOld.has(name);
      emit(ctx, {
        ruleId: "security-scheme-removed",
        location: {
          context: "security",
          path: "/",
          pointerOld: pointerJoin("components", "securitySchemes", name),
          pointerNew: ""
        },
        oldValue: name,
        severityOverride: wasReferenced ? "error" : "info"
      });
      continue;
    }
    if (!deepEqual(oldScheme.type, newScheme.type)) {
      emit(ctx, {
        ruleId: "security-type-changed",
        location: {
          context: "security",
          path: "/",
          pointerOld: pointerJoin("components", "securitySchemes", name, "type"),
          pointerNew: pointerJoin("components", "securitySchemes", name, "type")
        },
        oldValue: oldScheme.type,
        newValue: newScheme.type
      });
    }
    if (oldScheme.type === "apiKey" && newScheme.type === "apiKey" && !deepEqual(oldScheme.in, newScheme.in)) {
      emit(ctx, {
        ruleId: "api-key-location-changed",
        location: {
          context: "security",
          path: "/",
          pointerOld: pointerJoin("components", "securitySchemes", name, "in"),
          pointerNew: pointerJoin("components", "securitySchemes", name, "in")
        },
        oldValue: oldScheme.in,
        newValue: newScheme.in
      });
    }
    diffOauthScopes(ctx, name, oldScheme, newScheme, referencedOld, referencedNew);
  }
  for (const name of Object.keys(newSchemes).sort()) {
    if (name in oldSchemes) continue;
    emit(ctx, {
      ruleId: "security-scheme-added",
      location: {
        context: "security",
        path: "/",
        pointerOld: "",
        pointerNew: pointerJoin("components", "securitySchemes", name)
      },
      newValue: name
    });
  }
  diffSecurityRequirements(ctx, oldDoc, newDoc, oldGlobal, newGlobal, oldSchemes, newSchemes);
}
function diffOauthScopes(ctx, name, oldScheme, newScheme, referencedOld, referencedNew) {
  const oldFlows = isObject(oldScheme.flows) ? oldScheme.flows : {};
  const newFlows = isObject(newScheme.flows) ? newScheme.flows : {};
  for (const flow of Object.keys(oldFlows).sort()) {
    const oldFlow = isObject(oldFlows[flow]) ? oldFlows[flow] : {};
    const newFlow = isObject(newFlows[flow]) ? newFlows[flow] : {};
    const oldScopes = isObject(oldFlow.scopes) ? oldFlow.scopes : {};
    const newScopes = isObject(newFlow.scopes) ? newFlow.scopes : {};
    for (const scope of Object.keys(oldScopes).sort()) {
      if (scope in newScopes) continue;
      const stillUsed = referencedNew.has(name);
      emit(ctx, {
        ruleId: "oauth-scope-removed",
        location: {
          context: "security",
          path: "/",
          pointerOld: pointerJoin(
            "components",
            "securitySchemes",
            name,
            "flows",
            flow,
            "scopes",
            scope
          ),
          pointerNew: ""
        },
        oldValue: scope,
        severityOverride: stillUsed ? void 0 : "info"
      });
    }
    for (const scope of Object.keys(newScopes).sort()) {
      if (scope in oldScopes) continue;
      emit(ctx, {
        ruleId: "oauth-scope-added",
        location: {
          context: "security",
          path: "/",
          pointerOld: "",
          pointerNew: pointerJoin(
            "components",
            "securitySchemes",
            name,
            "flows",
            flow,
            "scopes",
            scope
          )
        },
        newValue: scope
      });
    }
  }
  void referencedOld;
}
function referencedSchemeNames(doc) {
  const names = /* @__PURE__ */ new Set();
  const collect = (reqs) => {
    if (!Array.isArray(reqs)) return;
    for (const req of reqs) {
      if (isObject(req)) for (const n of Object.keys(req)) names.add(n);
    }
  };
  collect(doc.security);
  const pathsObj = isObject(doc.paths) ? doc.paths : {};
  for (const p of Object.keys(pathsObj)) {
    const item = isObject(pathsObj[p]) ? pathsObj[p] : {};
    collect(item.security);
    for (const m of Object.keys(item)) {
      if (!isHttpMethod(m)) continue;
      const op = isObject(item[m]) ? item[m] : {};
      collect(op.security);
    }
  }
  return names;
}
function isNoSecurity(v) {
  return Array.isArray(v) && v.length === 1 && isObject(v[0]) && Object.keys(v[0]).length === 0;
}
function diffSecurityRequirements(ctx, oldDoc, newDoc, oldGlobal, newGlobal, oldSchemes, newSchemes) {
  void oldSchemes;
  void newSchemes;
  void oldDoc;
  void newDoc;
  const effectiveOld = (op, item) => op.security !== void 0 ? safeArray(op.security) : item.security !== void 0 ? safeArray(item.security) : oldGlobal;
  const effectiveNew = (op, item) => op.security !== void 0 ? safeArray(op.security) : item.security !== void 0 ? safeArray(item.security) : newGlobal;
  const walk = (doc, other, side) => {
    const pathsObj = isObject(doc.paths) ? doc.paths : {};
    const otherPaths = isObject(other.paths) ? other.paths : {};
    for (const p of Object.keys(pathsObj).sort()) {
      const item = isObject(pathsObj[p]) ? pathsObj[p] : {};
      const otherItem = isObject(otherPaths[p]) ? otherPaths[p] : {};
      for (const m of Object.keys(item).sort()) {
        if (!isHttpMethod(m)) continue;
        const op = isObject(item[m]) ? item[m] : {};
        const otherOp = isObject(otherItem[m]) ? otherItem[m] : {};
        const reqs = side === "old" ? effectiveOld(op, item) : effectiveNew(op, item);
        const otherReqs = side === "old" ? effectiveNew(otherOp, otherItem) : effectiveOld(otherOp, otherItem);
        if (side === "old") {
          compareSecurity(ctx, p, m, reqs, otherReqs);
        }
      }
    }
  };
  walk(ctx.baseline.normalized, ctx.current.normalized, "old");
  void newDoc;
}
function safeArray(v) {
  return Array.isArray(v) ? v : [];
}
function compareSecurity(ctx, path3, method, oldReqs, newReqs) {
  const oldEmpty = oldReqs.length === 0 || oldReqs.every(isNoSecurity);
  const newEmpty = newReqs.length === 0 || newReqs.every(isNoSecurity);
  if (!oldEmpty && newEmpty) {
    emit(ctx, {
      ruleId: "security-requirement-removed",
      location: {
        context: "security",
        path: path3,
        method,
        pointerOld: pointerJoin("paths", path3, method.toLowerCase(), "security"),
        pointerNew: pointerJoin("paths", path3, method.toLowerCase(), "security")
      }
    });
    return;
  }
  if (oldEmpty && !newEmpty) {
    emit(ctx, {
      ruleId: "security-requirement-added",
      location: {
        context: "security",
        path: path3,
        method,
        pointerOld: pointerJoin("paths", path3, method.toLowerCase(), "security"),
        pointerNew: pointerJoin("paths", path3, method.toLowerCase(), "security")
      }
    });
    return;
  }
  if (oldEmpty && newEmpty) return;
  const oldSatisfied = oldReqs.every((oldReq) => satisfiesAny(oldReq, newReqs));
  if (!oldSatisfied) {
    emit(ctx, {
      ruleId: "security-requirement-changed",
      location: {
        context: "security",
        path: path3,
        method,
        pointerOld: pointerJoin("paths", path3, method.toLowerCase(), "security"),
        pointerNew: pointerJoin("paths", path3, method.toLowerCase(), "security")
      },
      oldValue: compact2(oldReqs),
      newValue: compact2(newReqs)
    });
  } else {
    for (const oldReq of oldReqs) {
      if (!isObject(oldReq)) continue;
      for (const [scheme, scopes] of Object.entries(oldReq)) {
        const scopeList = Array.isArray(scopes) ? scopes : [];
        for (const newReq of newReqs) {
          if (!isObject(newReq)) continue;
          if (!(scheme in newReq)) continue;
          const newScopes = Array.isArray(newReq[scheme]) ? newReq[scheme] : [];
          for (const s of scopeList) {
            if (!newScopes.includes(s)) {
              emit(ctx, {
                ruleId: "security-scope-required-removed",
                location: {
                  context: "security",
                  path: path3,
                  method,
                  pointerOld: pointerJoin("paths", path3, method.toLowerCase(), "security"),
                  pointerNew: pointerJoin("paths", path3, method.toLowerCase(), "security")
                },
                oldValue: s
              });
            }
          }
          for (const s of newScopes) {
            if (!scopeList.includes(s)) {
              emit(ctx, {
                ruleId: "security-scope-required-added",
                location: {
                  context: "security",
                  path: path3,
                  method,
                  pointerOld: pointerJoin("paths", path3, method.toLowerCase(), "security"),
                  pointerNew: pointerJoin("paths", path3, method.toLowerCase(), "security")
                },
                newValue: s
              });
            }
          }
        }
      }
    }
  }
}
function satisfiesAny(oldReq, newReqs) {
  if (!isObject(oldReq)) return true;
  return newReqs.some((newReq) => {
    if (!isObject(newReq)) return false;
    for (const [scheme, scopes] of Object.entries(oldReq)) {
      if (!(scheme in newReq)) continue;
      const oldScopes = Array.isArray(scopes) ? scopes : [];
      const newScopes = Array.isArray(newReq[scheme]) ? newReq[scheme] : [];
      if (newScopes.every((s) => oldScopes.includes(s))) return true;
    }
    return false;
  });
}

// src/core/ignore/ignore.ts
import micromatch from "micromatch";
function changePath(change) {
  return change.location.path ?? "";
}
function isIgnored(change, config) {
  const ignore = config.ignore;
  if (ignore.changes.length > 0) {
    if (micromatch.isMatch(change.ruleId, ignore.changes, { nocase: false })) return true;
  }
  const path3 = changePath(change);
  if (ignore.schemas.length > 0) {
    const name = change.location.componentName;
    if (name && micromatch.isMatch(name, ignore.schemas)) return true;
    const pointer = (change.location.pointerNew || change.location.pointerOld || "").replace(
      /^#\//,
      ""
    );
    const SCHEMAS_SEG = "components/schemas/";
    if (pointer && (pointer.includes(`/${SCHEMAS_SEG}`) || pointer.startsWith(SCHEMAS_SEG))) {
      const after = pointer.split(SCHEMAS_SEG)[1] ?? "";
      const rootName = after.split("/")[0]?.replace(/~1/g, "/");
      if (rootName) {
        if (micromatch.isMatch(rootName, ignore.schemas)) return true;
        const lastSegments = ignore.schemas.map((s) => s.split("/").pop() ?? s);
        if (micromatch.isMatch(rootName, lastSegments)) return true;
        const prefixGlobs = ignore.schemas.map((s) => `components/schemas/${s}**`);
        if (micromatch.isMatch(pointer, prefixGlobs)) return true;
      }
    }
  }
  if (ignore.operations.length > 0 && change.location.method !== void 0) {
    const opKey = `${change.location.method.toUpperCase()} ${path3}`;
    if (ignore.operations.includes(opKey)) return true;
  }
  if (ignore.paths.length > 0 && path3 && path3 !== "") {
    if (micromatch.isMatch(path3, ignore.paths)) return true;
  }
  return false;
}
function applyIgnores(changes, config) {
  const kept = [];
  const ignored = [];
  for (const c of changes) {
    if (isIgnored(c, config)) ignored.push(c);
    else kept.push(c);
  }
  return { kept, ignored };
}

// src/core/engine/analyze.ts
function summarize(changes, ignoredCount) {
  const summary = {
    total: changes.length,
    bySeverity: { error: 0, warning: 0, info: 0 },
    byKind: { addition: 0, removal: 0, modification: 0, relaxation: 0, documentation: 0 },
    ignored: ignoredCount
  };
  for (const c of changes) {
    summary.bySeverity[c.severity]++;
    summary.byKind[c.kind]++;
  }
  return summary;
}
function metaOf(spec) {
  return {
    source: spec.source,
    openapiVersion: spec.openapiVersion,
    title: spec.title,
    sha256: spec.sha256
  };
}
async function analyze(baselinePath, currentPath, options = {}) {
  const loaded = options.config ? { config: options.config, sourcePath: "", warnings: [] } : discoverAndLoadConfig({ explicit: options.configPath });
  const config = loaded.config;
  const [baseline, current] = await Promise.all([
    loadSpec(baselinePath, { loader: { allowRemoteRefs: config.loader.allowRemoteRefs } }),
    loadSpec(currentPath, { loader: { allowRemoteRefs: config.loader.allowRemoteRefs } })
  ]);
  structuralDeref(baseline.normalized);
  structuralDeref(current.normalized);
  const ctx = {
    baseline,
    current,
    baselineIndex: buildSpecIndex(baseline.normalized),
    currentIndex: buildSpecIndex(current.normalized),
    config,
    candidates: []
  };
  runStructuralDiff(ctx);
  const deduped = dedupeChanges(sortChanges([...ctx.candidates]));
  const { kept, ignored } = applyIgnores(deduped, config);
  const summary = summarize(kept, ignored.length);
  const semver = suggestVersion(kept);
  const report = {
    schemaVersion: "1.0",
    tool: { name: "apiguard", version: TOOL_VERSION },
    baseline: metaOf(baseline),
    current: metaOf(current),
    summary,
    changes: kept,
    semver
  };
  if (options.showIgnored && ignored.length > 0) {
    report.ignored = ignored.map((c) => ({ ...c, ignored: true }));
  }
  return { report, ignored };
}

export {
  ExitCode,
  ApiguardError,
  CliUsageError,
  SpecValidationError,
  errorMessage,
  loadConfigFrom,
  discoverAndLoadConfig,
  mergeWithFlags,
  loadSpec,
  TOOL_VERSION,
  validateSemantics,
  formatIssues,
  suggestVersion,
  analyze
};
