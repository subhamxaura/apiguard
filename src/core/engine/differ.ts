/**
 * Differ: per-area dispatcher per spec §9. Emits ApiChange candidates; classification and
 * formatting are resolved via the registry (§10) and classify (§10.5). Detectors never
 * format text themselves — message/suggestion come from the registry templates.
 */
import type { ApiChange, ChangeKind, ChangeLocation, Context, Severity } from '../models/change.js';
import type { JsonObject, NormalizedSpec } from '../models/types.js';
import type { ResolvedConfig } from '../config/schema.js';
import { getRule } from '../rules/rule-registry.js';
import { classify } from './classify.js';
import { changeId } from '../../utils/hash.js';
import { buildSpecIndex, mergedParameters, type SpecIndex } from './index-build.js';
import { deepEqual, isObject } from './comparator.js';
import { diffSchemaNode, type LocationBase } from './schema-differ.js';
import { isHttpMethod } from '../../loaders/validate.js';
import { pointerJoin } from '../../utils/sort.js';

export interface DiffContext {
  baseline: NormalizedSpec;
  current: NormalizedSpec;
  baselineIndex: SpecIndex;
  currentIndex: SpecIndex;
  config: ResolvedConfig;
  /** Candidates collected across dispatchers. */
  candidates: ApiChange[];
}

/** Emit helper: resolves severity/kind via registry + config, builds the stable id. */
export function emit(
  ctx: DiffContext,
  opts: {
    ruleId: string;
    location: ChangeLocation;
    oldValue?: unknown;
    newValue?: unknown;
    doctrine?: { wasRequired?: boolean; sideClass?: import('./classify.js').SideClass };
    severityOverride?: Severity;
    kindOverride?: ChangeKind;
  },
): void {
  const resolved = classify(
    opts.ruleId,
    opts.location.context,
    { rules: ctx.config.rules },
    opts.doctrine,
  );
  const rule = getRule(opts.ruleId);
  const severity: Severity =
    opts.severityOverride ?? (resolved ? resolved.severity : rule.defaultSeverity);
  const kind: ChangeKind = opts.kindOverride ?? (resolved ? resolved.kind : rule.defaultKind);
  if (resolved === null) return; // rule disabled via config 'off'

  const templateCtx = {
    location: opts.location,
    oldValue: opts.oldValue,
    newValue: opts.newValue,
  };
  const change: ApiChange = {
    id: changeId({
      ruleId: opts.ruleId,
      context: opts.location.context,
      path: opts.location.path,
      method: opts.location.method,
      pointerOld: opts.location.pointerOld,
      pointerNew: opts.location.pointerNew,
      oldValue: opts.oldValue,
      newValue: opts.newValue,
    }),
    ruleId: opts.ruleId,
    severity,
    kind,
    breaking: severity === 'error',
    location: opts.location,
    message: rule.message(templateCtx),
    suggestion: rule.suggestion(templateCtx),
    ...(opts.oldValue !== undefined ? { oldValue: opts.oldValue } : {}),
    ...(opts.newValue !== undefined ? { newValue: opts.newValue } : {}),
  };
  ctx.candidates.push(change);
}

// ---------------------------------------------------------------------------
// Document-level (§10.1)
// ---------------------------------------------------------------------------

function diffDocumentLevel(ctx: DiffContext): void {
  const oldDoc = isObject(ctx.baseline.normalized) ? ctx.baseline.normalized : {};
  const newDoc = isObject(ctx.current.normalized) ? ctx.current.normalized : {};

  // openapi version (post-normalization per §10.1)
  if (!deepEqual(oldDoc.openapi, newDoc.openapi)) {
    emit(ctx, {
      ruleId: 'openapi-version-changed',
      location: {
        path: '/',
        pointerOld: pointerJoin('openapi'),
        pointerNew: pointerJoin('openapi'),
        context: 'api',
      },
      oldValue: oldDoc.openapi,
      newValue: newDoc.openapi,
    });
  }

  const infoOld = isObject(oldDoc.info) ? oldDoc.info : {};
  const infoNew = isObject(newDoc.info) ? newDoc.info : {};

  if (!deepEqual(infoOld.title, infoNew.title)) {
    emit(ctx, {
      ruleId: 'title-changed',
      location: {
        path: '/',
        pointerOld: pointerJoin('info', 'title'),
        pointerNew: pointerJoin('info', 'title'),
        context: 'api',
      },
      oldValue: infoOld.title,
      newValue: infoNew.title,
    });
  }
  if (!deepEqual(infoOld.description, infoNew.description)) {
    emit(ctx, {
      ruleId: 'description-changed',
      location: {
        path: '/',
        pointerOld: pointerJoin('info', 'description'),
        pointerNew: pointerJoin('info', 'description'),
        context: 'api',
      },
      oldValue: infoOld.description,
      newValue: infoNew.description,
    });
  }
  if (!deepEqual(infoOld.contact, infoNew.contact)) {
    emit(ctx, {
      ruleId: 'contact-changed',
      location: {
        path: '/',
        pointerOld: pointerJoin('info', 'contact'),
        pointerNew: pointerJoin('info', 'contact'),
        context: 'api',
      },
      oldValue: compact(infoOld.contact),
      newValue: compact(infoNew.contact),
    });
  }
  if (!deepEqual(infoOld.license, infoNew.license)) {
    emit(ctx, {
      ruleId: 'license-changed',
      location: {
        path: '/',
        pointerOld: pointerJoin('info', 'license'),
        pointerNew: pointerJoin('info', 'license'),
        context: 'api',
      },
      oldValue: compact(infoOld.license),
      newValue: compact(infoNew.license),
    });
  }
  if (!deepEqual(oldDoc.externalDocs, newDoc.externalDocs)) {
    emit(ctx, {
      ruleId: 'external-docs-changed',
      location: {
        path: '/',
        pointerOld: pointerJoin('externalDocs'),
        pointerNew: pointerJoin('externalDocs'),
        context: 'api',
      },
      oldValue: compact(oldDoc.externalDocs),
      newValue: compact(newDoc.externalDocs),
    });
  }

  diffServers(ctx, oldDoc, newDoc);
}

function diffServers(ctx: DiffContext, oldDoc: JsonObject, newDoc: JsonObject): void {
  const oldServers = Array.isArray(oldDoc.servers) ? oldDoc.servers : [];
  const newServers = Array.isArray(newDoc.servers) ? newDoc.servers : [];
  const oldUrls = oldServers.map((s) => (isObject(s) ? s.url : undefined));
  const newUrls = newServers.map((s) => (isObject(s) ? s.url : undefined));

  for (const url of oldUrls) {
    if (typeof url === 'string' && !newUrls.includes(url)) {
      emit(ctx, {
        ruleId: 'server-url-removed',
        location: {
          path: '/',
          pointerOld: pointerJoin('servers'),
          pointerNew: pointerJoin('servers'),
          context: 'api',
        },
        oldValue: url,
      });
    }
  }
  for (const url of newUrls) {
    if (typeof url === 'string' && !oldUrls.includes(url)) {
      emit(ctx, {
        ruleId: 'server-url-added',
        location: {
          path: '/',
          pointerOld: pointerJoin('servers'),
          pointerNew: pointerJoin('servers'),
          context: 'api',
        },
        newValue: url,
      });
    }
  }
  // server description/variables changes for URLs present in both
  for (const oldS of oldServers) {
    if (!isObject(oldS)) continue;
    const url = oldS.url;
    if (typeof url !== 'string') continue;
    const newS = newServers.find((s) => isObject(s) && s.url === url);
    if (!newS || !isObject(newS)) continue;
    if (
      !deepEqual(oldS.description, newS.description) ||
      !deepEqual(oldS.variables, newS.variables)
    ) {
      emit(ctx, {
        ruleId: 'server-metadata-changed',
        location: {
          path: '/',
          pointerOld: pointerJoin('servers'),
          pointerNew: pointerJoin('servers'),
          context: 'api',
        },
        oldValue: compact({ description: oldS.description, variables: oldS.variables }),
        newValue: compact({ description: newS.description, variables: newS.variables }),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Operations (§10.2)
// ---------------------------------------------------------------------------

function diffOperations(ctx: DiffContext): void {
  const { baselineIndex: bi, currentIndex: ci } = ctx;

  // removed paths: entire path gone → single change instead of per-method rows (§10.2)
  for (const p of bi.paths) {
    if (!ci.pathItems.has(p)) {
      emit(ctx, {
        ruleId: 'removed-path',
        location: {
          path: p,
          pointerOld: pointerJoin('paths', p),
          pointerNew: '',
          context: 'operation',
        },
      });
    }
  }

  const commonPaths = bi.paths.filter((p) => ci.pathItems.has(p));
  for (const p of commonPaths) {
    const oldItem = bi.pathItems.get(p)!;
    const newItem = ci.pathItems.get(p)!;
    const oldMethods = methodKeys(oldItem);
    const newMethods = methodKeys(newItem);

    for (const m of oldMethods) {
      if (!newMethods.includes(m)) {
        emit(ctx, {
          ruleId: 'removed-method',
          location: {
            path: p,
            method: m,
            pointerOld: pointerJoin('paths', p, m.toLowerCase()),
            pointerNew: '',
            context: 'operation',
          },
        });
      }
    }
    for (const m of newMethods) {
      if (!oldMethods.includes(m)) {
        emit(ctx, {
          ruleId: 'operation-added',
          location: {
            path: p,
            method: m,
            pointerOld: '',
            pointerNew: pointerJoin('paths', p, m.toLowerCase()),
            context: 'operation',
          },
        });
      }
    }

    for (const m of oldMethods.filter((m) => newMethods.includes(m))) {
      diffOperationPair(ctx, p, m, oldItem, newItem);
    }
  }

  // brand-new paths → operation-added rows
  for (const p of ci.paths) {
    if (!bi.pathItems.has(p)) {
      const newItem = ci.pathItems.get(p)!;
      for (const m of methodKeys(newItem)) {
        emit(ctx, {
          ruleId: 'operation-added',
          location: {
            path: p,
            method: m,
            pointerOld: '',
            pointerNew: pointerJoin('paths', p, m.toLowerCase()),
            context: 'operation',
          },
        });
      }
    }
  }

  diffWebhooks(ctx);
}

function methodKeys(item: JsonObject): string[] {
  return Object.keys(item)
    .filter((k) =>
      ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(
        k.toLowerCase(),
      ),
    )
    .map((k) => k.toUpperCase())
    .sort();
}

function diffOperationPair(
  ctx: DiffContext,
  path: string,
  method: string,
  oldItem: JsonObject,
  newItem: JsonObject,
): void {
  const oldOp = isObject(oldItem[method.toLowerCase()])
    ? (oldItem[method.toLowerCase()] as JsonObject)
    : {};
  const newOp = isObject(newItem[method.toLowerCase()])
    ? (newItem[method.toLowerCase()] as JsonObject)
    : {};
  const baseLoc = { path, method };

  // operationId
  if (!deepEqual(oldOp.operationId, newOp.operationId)) {
    emit(ctx, {
      ruleId: 'operation-id-changed',
      location: {
        ...baseLoc,
        operationId: typeof newOp.operationId === 'string' ? newOp.operationId : undefined,
        pointerOld: pointerJoin('paths', path, method.toLowerCase(), 'operationId'),
        pointerNew: pointerJoin('paths', path, method.toLowerCase(), 'operationId'),
        context: 'operation',
      },
      oldValue: oldOp.operationId,
      newValue: newOp.operationId,
    });
  }

  // deprecated flag
  const oldDep = oldOp.deprecated === true;
  const newDep = newOp.deprecated === true;
  if (newDep && !oldDep) {
    emit(ctx, {
      ruleId: 'operation-deprecated-added',
      location: {
        ...baseLoc,
        pointerOld: pointerJoin('paths', path, method.toLowerCase(), 'deprecated'),
        pointerNew: pointerJoin('paths', path, method.toLowerCase(), 'deprecated'),
        context: 'operation',
      },
    });
  } else if (oldDep && !newDep) {
    emit(ctx, {
      ruleId: 'operation-deprecated-removed',
      location: {
        ...baseLoc,
        pointerOld: pointerJoin('paths', path, method.toLowerCase(), 'deprecated'),
        pointerNew: pointerJoin('paths', path, method.toLowerCase(), 'deprecated'),
        context: 'operation',
      },
    });
  }

  // tags
  if (!deepEqual(oldOp.tags, newOp.tags)) {
    emit(ctx, {
      ruleId: 'operation-tags-changed',
      location: {
        ...baseLoc,
        pointerOld: pointerJoin('paths', path, method.toLowerCase(), 'tags'),
        pointerNew: pointerJoin('paths', path, method.toLowerCase(), 'tags'),
        context: 'operation',
      },
      oldValue: compact(oldOp.tags),
      newValue: compact(newOp.tags),
    });
  }

  // summary / description
  if (!deepEqual(oldOp.summary, newOp.summary)) {
    emit(ctx, {
      ruleId: 'operation-summary-changed',
      location: {
        ...baseLoc,
        pointerOld: pointerJoin('paths', path, method.toLowerCase(), 'summary'),
        pointerNew: pointerJoin('paths', path, method.toLowerCase(), 'summary'),
        context: 'operation',
      },
      oldValue: oldOp.summary,
      newValue: newOp.summary,
    });
  }
  if (!deepEqual(oldOp.description, newOp.description)) {
    emit(ctx, {
      ruleId: 'operation-description-changed',
      location: {
        ...baseLoc,
        pointerOld: pointerJoin('paths', path, method.toLowerCase(), 'description'),
        pointerNew: pointerJoin('paths', path, method.toLowerCase(), 'description'),
        context: 'operation',
      },
      oldValue: oldOp.description,
      newValue: newOp.description,
    });
  }

  // callbacks (both 3.0 and 3.1; 3.1 webhooks handled separately)
  diffNamedMap(ctx, oldOp.callbacks, newOp.callbacks, 'callback-added', 'callback-removed', {
    ...baseLoc,
    context: 'operation',
  });

  // parameters (merged path+op level per §11.8)
  diffParameters(ctx, baseLoc, oldItem, oldOp, newItem, newOp);

  // request body
  diffRequestBody(ctx, baseLoc, oldOp, newOp);

  // responses
  diffResponses(ctx, baseLoc, oldOp, newOp);
}

function diffNamedMap(
  ctx: DiffContext,
  oldMap: unknown,
  newMap: unknown,
  addedRule: string,
  removedRule: string,
  baseLoc: { path: string; method?: string; context: Context },
): void {
  const oldObj = isObject(oldMap) ? oldMap : {};
  const newObj = isObject(newMap) ? newMap : {};
  for (const name of Object.keys(oldObj).sort()) {
    if (!(name in newObj)) {
      emit(ctx, {
        ruleId: removedRule,
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method?.toLowerCase() ?? '',
            'callbacks',
            name,
          ),
          pointerNew: '',
        },
        oldValue: name,
      });
    }
  }
  for (const name of Object.keys(newObj).sort()) {
    if (!(name in oldObj)) {
      emit(ctx, {
        ruleId: addedRule,
        location: {
          ...baseLoc,
          pointerOld: '',
          pointerNew: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method?.toLowerCase() ?? '',
            'callbacks',
            name,
          ),
        },
        newValue: name,
      });
    }
  }
}

function diffParameters(
  ctx: DiffContext,
  baseLoc: { path: string; method: string },
  oldItem: JsonObject,
  oldOp: JsonObject,
  newItem: JsonObject,
  newOp: JsonObject,
): void {
  const oldParams = mergedParameters(oldItem, oldOp);
  const newParams = mergedParameters(newItem, newOp);
  // Match by name only: a parameter that moved between in: query/header/path/cookie must
  // surface as parameter-location-changed (§10.3), not removal+addition.
  const keyOf = (p: JsonObject) => `${typeof p.name === 'string' ? p.name : ''}`;

  const oldByKey = new Map<string, JsonObject>();
  for (const p of oldParams) {
    const k = keyOf(p);
    if (!oldByKey.has(k)) oldByKey.set(k, p);
  }
  const newByKey = new Map<string, JsonObject>();
  for (const p of newParams) {
    const k = keyOf(p);
    if (!newByKey.has(k)) newByKey.set(k, p);
  }

  for (const [key, oldP] of oldByKey) {
    const name = typeof oldP.name === 'string' ? oldP.name : key;
    const wasIn = typeof oldP.in === 'string' ? oldP.in : '';
    const newP = newByKey.get(key);
    if (!newP) {
      const wasRequired = oldP.required === true || wasIn === 'path' || wasIn === 'header';
      emit(ctx, {
        ruleId: 'removed-parameter',
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'parameters',
            name,
          ),
          pointerNew: '',
          context: wasIn === 'header' ? 'request-header' : 'parameter',
        },
        oldValue: name,
        doctrine: { wasRequired },
      });
      continue;
    }
    const newIn = typeof newP.in === 'string' ? newP.in : '';
    if (newIn !== wasIn) {
      emit(ctx, {
        ruleId: 'parameter-location-changed',
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'parameters',
            name,
          ),
          pointerNew: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'parameters',
            name,
          ),
          context: 'parameter',
        },
        oldValue: wasIn,
        newValue: newIn,
      });
      continue;
    }
    const oldReq = oldP.required === true;
    const newReq = newP.required === true;
    if (!oldReq && newReq) {
      emit(ctx, {
        ruleId: 'parameter-made-required',
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'parameters',
            name,
          ),
          pointerNew: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'parameters',
            name,
          ),
          context: 'parameter',
        },
      });
    }
    // full schema differ over the parameter's inline schema (§10.3/§10.4)
    const oldSchema = isObject(oldP.schema) ? oldP.schema : undefined;
    const newSchema = isObject(newP.schema) ? newP.schema : undefined;
    if (oldSchema && newSchema) {
      diffSchemaNode(
        ctx,
        oldSchema,
        newSchema,
        pointerJoin(
          'paths',
          baseLoc.path,
          baseLoc.method.toLowerCase(),
          'parameters',
          name,
          'schema',
        ),
        pointerJoin(
          'paths',
          baseLoc.path,
          baseLoc.method.toLowerCase(),
          'parameters',
          name,
          'schema',
        ),
        { context: 'parameter', path: baseLoc.path, method: baseLoc.method },
        {
          requiredOld: stringArrayOf(oldSchema.required),
          requiredNew: stringArrayOf(newSchema.required),
          sideClass: 'send',
        },
      );
    }
    if (
      !deepEqual(oldP.description, newP.description) ||
      !deepEqual(oldP.example, newP.example) ||
      !deepEqual(oldP.deprecated, newP.deprecated)
    ) {
      emit(ctx, {
        ruleId: 'parameter-metadata-changed',
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'parameters',
            name,
          ),
          pointerNew: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'parameters',
            name,
          ),
          context: 'parameter',
        },
      });
    }
  }

  for (const [key, newP] of newByKey) {
    if (oldByKey.has(key)) continue;
    const name = typeof newP.name === 'string' ? newP.name : key;
    const isIn = typeof newP.in === 'string' ? newP.in : '';
    const required = newP.required === true || isIn === 'path';
    emit(ctx, {
      ruleId: required ? 'parameter-added-required' : 'parameter-added-optional',
      location: {
        ...baseLoc,
        pointerOld: '',
        pointerNew: pointerJoin(
          'paths',
          baseLoc.path,
          baseLoc.method.toLowerCase(),
          'parameters',
          name,
        ),
        context: 'parameter',
      },
      newValue: name,
    });
  }
}

function diffRequestBody(
  ctx: DiffContext,
  baseLoc: { path: string; method: string },
  oldOp: JsonObject,
  newOp: JsonObject,
): void {
  const oldBody = isObject(oldOp.requestBody) ? oldOp.requestBody : undefined;
  const newBody = isObject(newOp.requestBody) ? newOp.requestBody : undefined;

  if (oldBody && !newBody) {
    emit(ctx, {
      ruleId: 'request-body-removed',
      location: {
        ...baseLoc,
        pointerOld: pointerJoin('paths', baseLoc.path, baseLoc.method.toLowerCase(), 'requestBody'),
        pointerNew: '',
        context: 'request-body',
      },
      doctrine: { wasRequired: oldBody.required === true },
    });
    return;
  }
  if (!oldBody && newBody) {
    emit(ctx, {
      ruleId:
        newBody.required === true ? 'request-body-added-required' : 'request-body-added-optional',
      location: {
        ...baseLoc,
        pointerOld: '',
        pointerNew: pointerJoin('paths', baseLoc.path, baseLoc.method.toLowerCase(), 'requestBody'),
        context: 'request-body',
      },
    });
    return;
  }
  if (oldBody && newBody) {
    if (!oldBody.required && newBody.required === true) {
      emit(ctx, {
        ruleId: 'request-body-required-changed',
        location: {
          ...baseLoc,
          pointerOld: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'requestBody',
            'required',
          ),
          pointerNew: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'requestBody',
            'required',
          ),
          context: 'request-body',
        },
      });
    }
    // media types
    const oldContent = isObject(oldBody.content) ? oldBody.content : {};
    const newContent = isObject(newBody.content) ? newBody.content : {};
    for (const mt of Object.keys(oldContent).sort()) {
      if (!(mt in newContent)) {
        emit(ctx, {
          ruleId: 'content-type-removed',
          location: {
            ...baseLoc,
            mediaType: mt,
            pointerOld: pointerJoin(
              'paths',
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              'requestBody',
              'content',
              mt,
            ),
            pointerNew: '',
            context: 'request-body',
          },
          oldValue: mt,
        });
      }
    }
    for (const mt of Object.keys(newContent).sort()) {
      if (!(mt in oldContent)) {
        emit(ctx, {
          ruleId: 'content-type-added',
          location: {
            ...baseLoc,
            mediaType: mt,
            pointerOld: '',
            pointerNew: pointerJoin(
              'paths',
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              'requestBody',
              'content',
              mt,
            ),
            context: 'request-body',
          },
          newValue: mt,
        });
      }
    }
    // schema bodies (request view: readOnly pruned, §11.5)
    for (const mt of Object.keys(oldContent).sort()) {
      if (!(mt in newContent)) continue;
      const oldMt = isObject(oldContent[mt]) ? oldContent[mt] : {};
      const newMt = isObject(newContent[mt]) ? newContent[mt] : {};
      const oldSchemaRaw = isObject(oldMt.schema) ? oldMt.schema : undefined;
      const newSchemaRaw = isObject(newMt.schema) ? newMt.schema : undefined;
      if (oldSchemaRaw && newSchemaRaw) {
        const oldSchema = applyView(oldSchemaRaw, 'request');
        const newSchema = applyView(newSchemaRaw, 'request');
        diffSchemaNode(
          ctx,
          oldSchema,
          newSchema,
          pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'requestBody',
            'content',
            mt,
            'schema',
          ),
          pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'requestBody',
            'content',
            mt,
            'schema',
          ),
          {
            context: 'request-body',
            path: baseLoc.path,
            method: baseLoc.method,
            mediaType: mt,
          },
          {
            requiredOld: stringArrayOf(oldSchema.required),
            requiredNew: stringArrayOf(newSchema.required),
            sideClass: 'send',
          },
        );
      }
    }
  }
}

function diffResponses(
  ctx: DiffContext,
  baseLoc: { path: string; method: string },
  oldOp: JsonObject,
  newOp: JsonObject,
): void {
  const oldRes = isObject(oldOp.responses) ? oldOp.responses : {};
  const newRes = isObject(newOp.responses) ? newOp.responses : {};

  for (const status of Object.keys(oldRes).sort()) {
    if (!(status in newRes)) {
      emit(ctx, {
        ruleId: status === 'default' ? 'default-response-removed' : 'response-removed',
        location: {
          ...baseLoc,
          statusCode: status,
          pointerOld: pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'responses',
            status,
          ),
          pointerNew: '',
          context: 'response-body',
        },
        oldValue: status,
      });
      continue;
    }
    // headers
    const oldR = isObject(oldRes[status]) ? oldRes[status] : {};
    const newR = isObject(newRes[status]) ? newRes[status] : {};
    const oldHeaders = isObject(oldR.headers) ? oldR.headers : {};
    const newHeaders = isObject(newR.headers) ? newR.headers : {};
    for (const h of Object.keys(oldHeaders).sort()) {
      if (!(h in newHeaders)) {
        emit(ctx, {
          ruleId: 'response-header-removed',
          location: {
            ...baseLoc,
            statusCode: status,
            pointerOld: pointerJoin(
              'paths',
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              'responses',
              status,
              'headers',
              h,
            ),
            pointerNew: '',
            context: 'response-header',
          },
          oldValue: h,
        });
      }
    }
    for (const h of Object.keys(newHeaders).sort()) {
      if (!(h in oldHeaders)) {
        emit(ctx, {
          ruleId: 'response-header-added',
          location: {
            ...baseLoc,
            statusCode: status,
            pointerOld: '',
            pointerNew: pointerJoin(
              'paths',
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              'responses',
              status,
              'headers',
              h,
            ),
            context: 'response-header',
          },
          newValue: h,
        });
      }
    }
    // media types
    const oldContent = isObject(oldR.content) ? oldR.content : {};
    const newContent = isObject(newR.content) ? newR.content : {};
    for (const mt of Object.keys(oldContent).sort()) {
      if (!(mt in newContent)) {
        emit(ctx, {
          ruleId: 'content-type-removed',
          location: {
            ...baseLoc,
            statusCode: status,
            mediaType: mt,
            pointerOld: pointerJoin(
              'paths',
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              'responses',
              status,
              'content',
              mt,
            ),
            pointerNew: '',
            context: 'response-body',
          },
          oldValue: mt,
        });
      }
    }
    for (const mt of Object.keys(newContent).sort()) {
      if (!(mt in oldContent)) {
        emit(ctx, {
          ruleId: 'content-type-added',
          location: {
            ...baseLoc,
            statusCode: status,
            mediaType: mt,
            pointerOld: '',
            pointerNew: pointerJoin(
              'paths',
              baseLoc.path,
              baseLoc.method.toLowerCase(),
              'responses',
              status,
              'content',
              mt,
            ),
            context: 'response-body',
          },
          newValue: mt,
        });
      }
    }
    // schema bodies (response view: writeOnly pruned, §11.5)
    for (const mt of Object.keys(oldContent).sort()) {
      if (!(mt in newContent)) continue;
      const oldMt = isObject(oldContent[mt]) ? oldContent[mt] : {};
      const newMt = isObject(newContent[mt]) ? newContent[mt] : {};
      const oldSchemaRaw = isObject(oldMt.schema) ? oldMt.schema : undefined;
      const newSchemaRaw = isObject(newMt.schema) ? newMt.schema : undefined;
      if (oldSchemaRaw && newSchemaRaw) {
        const oldSchema = applyView(oldSchemaRaw, 'response');
        const newSchema = applyView(newSchemaRaw, 'response');
        diffSchemaNode(
          ctx,
          oldSchema,
          newSchema,
          pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'responses',
            status,
            'content',
            mt,
            'schema',
          ),
          pointerJoin(
            'paths',
            baseLoc.path,
            baseLoc.method.toLowerCase(),
            'responses',
            status,
            'content',
            mt,
            'schema',
          ),
          {
            context: 'response-body',
            path: baseLoc.path,
            method: baseLoc.method,
            statusCode: status,
            mediaType: mt,
          },
          {
            requiredOld: stringArrayOf(oldSchema.required),
            requiredNew: stringArrayOf(newSchema.required),
            sideClass: 'parse',
          },
        );
      }
    }
  }
  for (const status of Object.keys(newRes).sort()) {
    if (status in oldRes) continue;
    emit(ctx, {
      ruleId: 'response-added',
      location: {
        ...baseLoc,
        statusCode: status,
        pointerOld: '',
        pointerNew: pointerJoin(
          'paths',
          baseLoc.path,
          baseLoc.method.toLowerCase(),
          'responses',
          status,
        ),
        context: 'response-body',
      },
      newValue: status,
    });
  }
}

function diffWebhooks(ctx: DiffContext): void {
  for (const name of ctx.baselineIndex.webhooks.keys()) {
    if (!ctx.currentIndex.webhooks.has(name)) {
      emit(ctx, {
        ruleId: 'webhook-removed',
        location: {
          path: '',
          pointerOld: pointerJoin('webhooks', name),
          pointerNew: '',
          context: 'webhook',
        },
        oldValue: name,
      });
    }
  }
  for (const name of ctx.currentIndex.webhooks.keys()) {
    if (!ctx.baselineIndex.webhooks.has(name)) {
      emit(ctx, {
        ruleId: 'webhook-added',
        location: {
          path: '',
          pointerOld: '',
          pointerNew: pointerJoin('webhooks', name),
          context: 'webhook',
        },
        newValue: name,
      });
    }
  }
}

/** Compact a value for oldValue/newValue: scalars pass through; objects truncate. */
export function compact(v: unknown): unknown {
  if (v === undefined || v === null) return v;
  if (typeof v !== 'object') return v;
  const json = JSON.stringify(v);
  if (json === undefined || json.length <= 80) return v;
  // Blind slicing produces invalid JSON; emit a truncated *string* marker instead (§12).
  return `${json.slice(0, 77)}…`;
}

/**
 * Main pipeline dispatcher (§9): document → operations (params/bodies/responses via the
 * recursive schema differ) → components (usage-classified) → security.
 */
export function runStructuralDiff(ctx: DiffContext): ApiChange[] {
  ctx.candidates = [];
  diffDocumentLevel(ctx);
  diffOperations(ctx);
  diffComponents(ctx);
  diffSecurity(ctx);
  return ctx.candidates;
}

export { buildSpecIndex };

// ---------------------------------------------------------------------------
// Components (§10.5b): usage-classified, strictest severity wins, usageCount kept
// ---------------------------------------------------------------------------

function diffComponents(ctx: DiffContext): void {
  const { baselineIndex: bi, currentIndex: ci } = ctx;
  const usedOld = usedSchemas(ctx.baseline.normalized);
  const usedNew = usedSchemas(ctx.current.normalized);

  for (const name of bi.schemas.keys()) {
    const oldSchema = bi.schemas.get(name);
    const newSchema = ci.schemas.get(name);
    if (!newSchema) continue; // removed component: op-level removals already cover usage sites
    if (!oldSchema) continue; // added components are informational and not diffed in v1
    if (!usedOld.has(name) && !usedNew.has(name)) continue; // unreachable — not diffed (§10.5b)

    // §10.5b: op-level $ref sites resolve to the component, so the component is diffed
    // exactly once; strictest usage class wins and usageCount is stamped on every change.
    const usages = usageClasses(ctx, name);
    const sideClass: 'send' | 'parse' = usages.parse > 0 ? 'parse' : 'send';
    const usageCount = usages.send + usages.parse;
    const firstUsage = firstUsagePointer(ctx, name);

    diffComponentSchema(ctx, name, oldSchema, newSchema, sideClass, usageCount, firstUsage);
  }
}

function diffComponentSchema(
  ctx: DiffContext,
  name: string,
  oldSchema: JsonObject,
  newSchema: JsonObject,
  sideClass: 'send' | 'parse',
  usageCount: number,
  firstUsage: string,
): void {
  const base: LocationBase = {
    context: 'component',
    path: '',
    componentName: name,
  };
  void firstUsage;

  // §10.5b/§11.5: the usage class picks the view (send → request view, parse → response view)
  // so readOnly/writeOnly flips surface through the correct lens.
  const view = sideClass === 'send' ? 'request' : 'response';
  const before = ctx.candidates.length;
  diffSchemaNode(
    ctx,
    applyView(oldSchema, view),
    applyView(newSchema, view),
    pointerJoin('components', 'schemas', name),
    pointerJoin('components', 'schemas', name),
    base,
    {
      requiredOld: stringArrayOf(applyView(oldSchema, view).required),
      requiredNew: stringArrayOf(applyView(newSchema, view).required),
      sideClass,
    },
  );
  // stamp usageCount onto component-context changes emitted by this call
  for (let i = before; i < ctx.candidates.length; i++) {
    const c = ctx.candidates[i];
    if (c !== undefined && c.location.context === 'component') {
      c.location.usageCount = usageCount;
    }
  }
}

function stringArrayOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

const VIEW_MAX_DEPTH = 512;

/**
 * §11.5 request/response views: drop readOnly (request) / writeOnly (response) properties
 * and their `required` membership. Recursive over properties/items/composition with a
 * depth bound (cycle-safe: bundled documents are acyclic trees).
 */
function applyView(schema: JsonObject, view: 'request' | 'response'): JsonObject {
  const pruneKey = view === 'request' ? 'readOnly' : 'writeOnly';
  const visit = (node: JsonObject, depth: number): JsonObject => {
    if (depth > VIEW_MAX_DEPTH) return node;
    const out: JsonObject = { ...node };
    const props = isObject(out.properties) ? out.properties : undefined;
    if (props) {
      const kept: JsonObject = {};
      for (const [name, child] of Object.entries(props)) {
        const childObj = isObject(child) ? child : undefined;
        if (childObj && childObj[pruneKey] === true) continue;
        kept[name] = childObj ? visit(childObj, depth + 1) : child;
      }
      out.properties = kept;
    }
    if (Array.isArray(out.required)) {
      out.required = out.required.filter((r) => {
        if (typeof r !== 'string') return true;
        const prop = props?.[r];
        const propObj = isObject(prop) ? prop : undefined;
        return !(propObj && propObj[pruneKey] === true);
      });
    }
    for (const key of ['items', 'additionalProperties'] as const) {
      const child = out[key];
      const childObj = isObject(child) ? child : undefined;
      if (childObj) out[key] = visit(childObj, depth + 1);
    }
    for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
      if (Array.isArray(out[key])) {
        out[key] = (out[key] as unknown[]).map((m) => {
          const mObj = isObject(m) ? m : undefined;
          return mObj ? visit(mObj, depth + 1) : m;
        });
      }
    }
    return out;
  };
  return visit(schema, 0);
}

/** Collect schema names referenced from operations (request/response/parameter/headers). */
function usedSchemas(document: unknown): Set<string> {
  const used = new Set<string>();
  const stack: unknown[] = [document];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    const obj = node as JsonObject;
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$ref' && typeof v === 'string') {
        const m = v.match(/^#\/components\/schemas\/([^/]+)/);
        if (m && m[1]) used.add(m[1].replace(/~1/g, '/').replace(/~0/g, '~'));
      } else if (v !== null && typeof v === 'object') {
        stack.push(v);
      }
    }
  }
  return used;
}

/** Count send-side vs parse-side usages of a component (§10.5b). */
function usageClasses(ctx: DiffContext, name: string): { send: number; parse: number } {
  let send = 0;
  let parse = 0;
  const refPattern = new RegExp(`^#/components/schemas/${escapeRegExp(name)}$`);
  const classifyUse = (doc: unknown) => {
    const docObj = isObject(doc) ? doc : {};
    const pathsObj = isObject(docObj.paths) ? docObj.paths : {};
    for (const p of Object.keys(pathsObj).sort()) {
      const item = isObject(pathsObj[p]) ? pathsObj[p] : {};
      for (const method of Object.keys(item).sort()) {
        if (!isHttpMethod(method)) continue;
        const op = isObject(item[method]) ? item[method] : {};
        countIn(op.requestBody, 'send');
        countIn(op.responses, 'parse');
        countIn(op.parameters, 'send');
        countIn(item.parameters, 'send');
      }
    }
    // webhooks are parse-side
    const webhooksObj = isObject(docObj.webhooks) ? docObj.webhooks : {};
    for (const w of Object.keys(webhooksObj)) {
      countIn(webhooksObj[w], 'parse');
    }
  };
  const countIn = (node: unknown, side: 'send' | 'parse') => {
    const stack: unknown[] = [node];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === null || typeof n !== 'object') continue;
      if (Array.isArray(n)) {
        for (const v of n) stack.push(v);
        continue;
      }
      const obj = n as JsonObject;
      for (const [k, v] of Object.entries(obj)) {
        if (k === '$ref' && typeof v === 'string' && refPattern.test(v)) {
          if (side === 'send') send++;
          else parse++;
        } else if (v !== null && typeof v === 'object') {
          stack.push(v);
        }
      }
    }
  };
  classifyUse(ctx.baseline.normalized);
  classifyUse(ctx.current.normalized);
  return { send, parse };
}

function firstUsagePointer(ctx: DiffContext, name: string): string {
  const ref = `#/components/schemas/${name}`;
  const findIn = (doc: unknown): string => {
    const docObj = isObject(doc) ? doc : {};
    const pathsObj = isObject(docObj.paths) ? docObj.paths : {};
    for (const p of Object.keys(pathsObj).sort()) {
      const item = isObject(pathsObj[p]) ? pathsObj[p] : {};
      const found = findRefIn(item, ref, pointerJoin('paths', p));
      if (found) return found;
    }
    return '';
  };
  return findIn(ctx.current.normalized) || findIn(ctx.baseline.normalized);
}

function findRefIn(node: unknown, ref: string, pointer: string): string {
  const stack: Array<{ node: unknown; pointer: string }> = [{ node, pointer }];
  while (stack.length > 0) {
    const { node: n, pointer: ptr } = stack.pop()!;
    if (n === null || typeof n !== 'object') continue;
    if (Array.isArray(n)) {
      n.forEach((v, i) => stack.push({ node: v, pointer: `${ptr}/${i}` }));
      continue;
    }
    const obj = n as JsonObject;
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$ref' && v === ref) return ptr;
      if (v !== null && typeof v === 'object') {
        stack.push({ node: v, pointer: `${ptr}/${k}` });
      }
    }
  }
  return '';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Security (§10.6)
// ---------------------------------------------------------------------------

function diffSecurity(ctx: DiffContext): void {
  const oldDoc = isObject(ctx.baseline.normalized) ? ctx.baseline.normalized : {};
  const newDoc = isObject(ctx.current.normalized) ? ctx.current.normalized : {};
  const oldComp = isObject(oldDoc.components) ? oldDoc.components : {};
  const newComp = isObject(newDoc.components) ? newDoc.components : {};
  const oldSchemes = isObject(oldComp.securitySchemes) ? oldComp.securitySchemes : {};
  const newSchemes = isObject(newComp.securitySchemes) ? newComp.securitySchemes : {};

  const oldGlobal = Array.isArray(oldDoc.security) ? oldDoc.security : [];
  const newGlobal = Array.isArray(newDoc.security) ? newDoc.security : [];

  // referenced scheme names per document (global + operation requirements)
  const referencedOld = referencedSchemeNames(oldDoc);
  const referencedNew = referencedSchemeNames(newDoc);

  // scheme-level diffs
  for (const name of Object.keys(oldSchemes).sort()) {
    const oldScheme = isObject(oldSchemes[name]) ? oldSchemes[name] : {};
    const newScheme = isObject(newSchemes[name]) ? newSchemes[name] : {};
    if (!(name in newSchemes)) {
      // §10.6: error when the removed scheme was still referenced by ≥1 requirement in the
      // old document (that is where clients were actually using it); else info.
      const wasReferenced = referencedOld.has(name);
      emit(ctx, {
        ruleId: 'security-scheme-removed',
        location: {
          context: 'security',
          path: '/',
          pointerOld: pointerJoin('components', 'securitySchemes', name),
          pointerNew: '',
        },
        oldValue: name,
        severityOverride: wasReferenced ? 'error' : 'info',
      });
      continue;
    }
    if (!deepEqual(oldScheme.type, newScheme.type)) {
      emit(ctx, {
        ruleId: 'security-type-changed',
        location: {
          context: 'security',
          path: '/',
          pointerOld: pointerJoin('components', 'securitySchemes', name, 'type'),
          pointerNew: pointerJoin('components', 'securitySchemes', name, 'type'),
        },
        oldValue: oldScheme.type,
        newValue: newScheme.type,
      });
    }
    if (
      oldScheme.type === 'apiKey' &&
      newScheme.type === 'apiKey' &&
      !deepEqual(oldScheme.in, newScheme.in)
    ) {
      emit(ctx, {
        ruleId: 'api-key-location-changed',
        location: {
          context: 'security',
          path: '/',
          pointerOld: pointerJoin('components', 'securitySchemes', name, 'in'),
          pointerNew: pointerJoin('components', 'securitySchemes', name, 'in'),
        },
        oldValue: oldScheme.in,
        newValue: newScheme.in,
      });
    }
    // oauth flows/scopes
    diffOauthScopes(ctx, name, oldScheme, newScheme, referencedOld, referencedNew);
  }
  for (const name of Object.keys(newSchemes).sort()) {
    if (name in oldSchemes) continue;
    emit(ctx, {
      ruleId: 'security-scheme-added',
      location: {
        context: 'security',
        path: '/',
        pointerOld: '',
        pointerNew: pointerJoin('components', 'securitySchemes', name),
      },
      newValue: name,
    });
  }

  // operation-level security requirements
  diffSecurityRequirements(ctx, oldDoc, newDoc, oldGlobal, newGlobal, oldSchemes, newSchemes);
}

function diffOauthScopes(
  ctx: DiffContext,
  name: string,
  oldScheme: JsonObject,
  newScheme: JsonObject,
  referencedOld: Set<string>,
  referencedNew: Set<string>,
): void {
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
        ruleId: 'oauth-scope-removed',
        location: {
          context: 'security',
          path: '/',
          pointerOld: pointerJoin(
            'components',
            'securitySchemes',
            name,
            'flows',
            flow,
            'scopes',
            scope,
          ),
          pointerNew: '',
        },
        oldValue: scope,
        severityOverride: stillUsed ? undefined : 'info',
      });
    }
    for (const scope of Object.keys(newScopes).sort()) {
      if (scope in oldScopes) continue;
      emit(ctx, {
        ruleId: 'oauth-scope-added',
        location: {
          context: 'security',
          path: '/',
          pointerOld: '',
          pointerNew: pointerJoin(
            'components',
            'securitySchemes',
            name,
            'flows',
            flow,
            'scopes',
            scope,
          ),
        },
        newValue: scope,
      });
    }
  }
  void referencedOld;
}

function referencedSchemeNames(doc: JsonObject): Set<string> {
  const names = new Set<string>();
  const collect = (reqs: unknown) => {
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

function isNoSecurity(v: unknown): boolean {
  return Array.isArray(v) && v.length === 1 && isObject(v[0]) && Object.keys(v[0]).length === 0;
}

function diffSecurityRequirements(
  ctx: DiffContext,
  oldDoc: JsonObject,
  newDoc: JsonObject,
  oldGlobal: unknown[],
  newGlobal: unknown[],
  oldSchemes: JsonObject,
  newSchemes: JsonObject,
): void {
  void oldSchemes;
  void newSchemes;
  void oldDoc;
  void newDoc;
  const effectiveOld = (op: JsonObject, item: JsonObject): unknown[] =>
    op.security !== undefined
      ? safeArray(op.security)
      : item.security !== undefined
        ? safeArray(item.security)
        : oldGlobal;
  const effectiveNew = (op: JsonObject, item: JsonObject): unknown[] =>
    op.security !== undefined
      ? safeArray(op.security)
      : item.security !== undefined
        ? safeArray(item.security)
        : newGlobal;

  const walk = (doc: JsonObject, other: JsonObject, side: 'old' | 'new') => {
    const pathsObj = isObject(doc.paths) ? doc.paths : {};
    const otherPaths = isObject(other.paths) ? other.paths : {};
    for (const p of Object.keys(pathsObj).sort()) {
      const item = isObject(pathsObj[p]) ? pathsObj[p] : {};
      const otherItem = isObject(otherPaths[p]) ? otherPaths[p] : {};
      for (const m of Object.keys(item).sort()) {
        if (!isHttpMethod(m)) continue;
        const op = isObject(item[m]) ? item[m] : {};
        const otherOp = isObject(otherItem[m]) ? otherItem[m] : {};
        const reqs = side === 'old' ? effectiveOld(op, item) : effectiveNew(op, item);
        const otherReqs =
          side === 'old' ? effectiveNew(otherOp, otherItem) : effectiveOld(otherOp, otherItem);
        if (side === 'old') {
          compareSecurity(ctx, p, m, reqs, otherReqs);
        }
      }
    }
  };
  walk(ctx.baseline.normalized as JsonObject, ctx.current.normalized as JsonObject, 'old');
  void newDoc;
}

function safeArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** §10.6 requirement comparisons between an operation's old and new effective security. */
function compareSecurity(
  ctx: DiffContext,
  path: string,
  method: string,
  oldReqs: unknown[],
  newReqs: unknown[],
): void {
  const oldEmpty = oldReqs.length === 0 || oldReqs.every(isNoSecurity);
  const newEmpty = newReqs.length === 0 || newReqs.every(isNoSecurity);

  if (!oldEmpty && newEmpty) {
    emit(ctx, {
      ruleId: 'security-requirement-removed',
      location: {
        context: 'security',
        path,
        method,
        pointerOld: pointerJoin('paths', path, method.toLowerCase(), 'security'),
        pointerNew: pointerJoin('paths', path, method.toLowerCase(), 'security'),
      },
    });
    return;
  }
  if (oldEmpty && !newEmpty) {
    emit(ctx, {
      ruleId: 'security-requirement-added',
      location: {
        context: 'security',
        path,
        method,
        pointerOld: pointerJoin('paths', path, method.toLowerCase(), 'security'),
        pointerNew: pointerJoin('paths', path, method.toLowerCase(), 'security'),
      },
    });
    return;
  }
  if (oldEmpty && newEmpty) return;

  // requirement-set comparison: every old (scheme[,scopes]) must be satisfied by some new
  const oldSatisfied = oldReqs.every((oldReq) => satisfiesAny(oldReq, newReqs));
  if (!oldSatisfied) {
    emit(ctx, {
      ruleId: 'security-requirement-changed',
      location: {
        context: 'security',
        path,
        method,
        pointerOld: pointerJoin('paths', path, method.toLowerCase(), 'security'),
        pointerNew: pointerJoin('paths', path, method.toLowerCase(), 'security'),
      },
      oldValue: compact(oldReqs),
      newValue: compact(newReqs),
    });
  } else {
    // scheme satisfied; check scope narrowing (scope-required-added)
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
              // old demanded the scope, new does not → relaxation (info, §10.6)
              emit(ctx, {
                ruleId: 'security-scope-required-removed',
                location: {
                  context: 'security',
                  path,
                  method,
                  pointerOld: pointerJoin('paths', path, method.toLowerCase(), 'security'),
                  pointerNew: pointerJoin('paths', path, method.toLowerCase(), 'security'),
                },
                oldValue: s,
              });
            }
          }
          for (const s of newScopes) {
            if (!scopeList.includes(s)) {
              // new requirement demands a scope not previously required → error (§10.6)
              emit(ctx, {
                ruleId: 'security-scope-required-added',
                location: {
                  context: 'security',
                  path,
                  method,
                  pointerOld: pointerJoin('paths', path, method.toLowerCase(), 'security'),
                  pointerNew: pointerJoin('paths', path, method.toLowerCase(), 'security'),
                },
                newValue: s,
              });
            }
          }
        }
      }
    }
  }
}

/** Does any new requirement satisfy the old (scheme[,scopes]) combination? (§10.6) */
function satisfiesAny(oldReq: unknown, newReqs: unknown[]): boolean {
  if (!isObject(oldReq)) return true;
  return newReqs.some((newReq) => {
    if (!isObject(newReq)) return false;
    for (const [scheme, scopes] of Object.entries(oldReq)) {
      if (!(scheme in newReq)) continue;
      const oldScopes = Array.isArray(scopes) ? scopes : [];
      const newScopes = Array.isArray(newReq[scheme]) ? newReq[scheme] : [];
      // Same scheme: the new requirement satisfies old credentials when it demands a
      // subset of the previously-required scopes (narrower = more permissive, §10.6).
      if (newScopes.every((s) => oldScopes.includes(s))) return true;
    }
    return false;
  });
}
