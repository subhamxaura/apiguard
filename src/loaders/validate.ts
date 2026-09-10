/** Semantic validation pass per spec §13 (validate command). */
import type { JsonObject } from '../core/models/types.js';

export interface ValidationIssue {
  /** Severity class of the issue. */
  level: 'error' | 'warning';
  /** e.g. "spec.yaml" — rendered as `file: message` (line when known). */
  file: string;
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  /** true when no structural (level=error) issues were found. */
  ok: boolean;
}

function asObject(v: unknown): JsonObject | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : undefined;
}

function asRecordArray(v: unknown): JsonObject[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is JsonObject => x !== null && typeof x === 'object' && !Array.isArray(x),
  );
}

/**
 * Run semantic checks on a parsed (bundled) document. Structural errors that prevent diffing
 * surface earlier as SpecLoadError; these checks are advisory quality issues.
 */
export function validateSemantics(document: unknown, file: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const doc = asObject(document);
  if (!doc) return { issues: [{ level: 'error', file, message: 'document is not an object' }], ok: false };

  // --- unknown security-scheme references
  const schemes = asObject(doc.components)?.securitySchemes;
  const schemeNames = new Set<string>(schemes ? Object.keys(schemes) : []);
  const checkRequirements = (reqs: unknown, where: string) => {
    for (const req of asRecordArray(reqs)) {
      for (const name of Object.keys(req)) {
        if (!schemeNames.has(name)) {
          issues.push({
            level: 'error',
            file,
            message: `${where}: security requirement references unknown scheme "${name}"`,
          });
        }
      }
    }
  };
  checkRequirements(doc.security, '#/');
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

  // --- duplicate operationIds
  const seenIds = new Map<string, string>();
  for (const [p, item] of Object.entries(paths)) {
    const pathItem = asObject(item);
    if (!pathItem) continue;
    for (const method of Object.keys(pathItem)) {
      if (!isHttpMethod(method)) continue;
      const op = asObject(pathItem[method]);
      const opId = op?.operationId;
      if (typeof opId === 'string' && opId.length > 0) {
        const prev = seenIds.get(opId);
        if (prev !== undefined) {
          issues.push({
            level: 'warning',
            file,
            message: `duplicate operationId "${opId}" (also at ${prev})`,
          });
        } else {
          seenIds.set(opId, `${p} ${method.toUpperCase()}`);
        }
      }
    }
  }

  // --- invalid response keys + empty path items + parameter shape checks
  for (const [p, item] of Object.entries(paths)) {
    const pathItem = asObject(item);
    if (!pathItem) {
      issues.push({ level: 'warning', file, message: `${p}: path item is empty` });
      continue;
    }
    const hasOp = Object.keys(pathItem).some((k) => isHttpMethod(k));
    if (!hasOp) {
      issues.push({ level: 'warning', file, message: `${p}: path item has no operations` });
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
              level: 'error',
              file,
              message: `${where}: invalid response status key "${key}" (expected 1XX-5XX, code, or "default")`,
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

  // --- required entries not present as properties
  const schemas = asObject(doc.components)?.schemas;
  for (const [name, schema] of Object.entries(schemas ?? {})) {
    const obj = asObject(schema);
    if (!obj) continue;
    const props = asObject(obj.properties);
    for (const req of stringArray(obj.required)) {
      if (props && !(req in props)) {
        issues.push({
          level: 'warning',
          file,
          message: `components.schemas.${name}: required entry "${req}" is not a declared property`,
        });
      }
    }
  }

  return { issues, ok: !issues.some((i) => i.level === 'error') };
}

function checkParameterShape(
  param: JsonObject,
  where: string,
  issues: ValidationIssue[],
  file: string,
): void {
  const name = typeof param.name === 'string' ? param.name : '<unnamed>';
  if ('schema' in param && 'content' in param) {
    issues.push({
      level: 'error',
      file,
      message: `${where}: parameter "${name}" has both 'schema' and 'content' (mutually exclusive)`,
    });
  }
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function isHttpMethod(key: string): boolean {
  return ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(
    key.toLowerCase(),
  );
}

/** Render issues grouped by level in the `file: message` shape used by the CLI. */
export function formatIssues(issues: ValidationIssue[]): string[] {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const lines: string[] = [];
  if (errors.length > 0) {
    lines.push('Errors:');
    for (const i of errors) lines.push(`  ${i.file}: ${i.message}`);
  }
  if (warnings.length > 0) {
    lines.push('Warnings:');
    for (const i of warnings) lines.push(`  ${i.file}: ${i.message}`);
  }
  return lines;
}
