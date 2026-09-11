/**
 * Recursive schema differ per spec §10.4. Compares two schema nodes pairwise, emitting
 * candidates for property/composition/constraint changes. Cycle-safe: a depth cap plus a
 * seen-set on ref-target pairs guarantees termination (§11.7).
 */
import type { JsonObject } from '../models/types.js';
import type { DiffContext } from './differ.js';
import { emit } from './differ.js';
import { deepEqual, isObject, typeLabel, num, boundDirection, LOWER_BOUNDS } from './comparator.js';
import { escape as esc, isRefNode, dereffedPair } from './walker.js';
import type { ChangeLocation } from '../models/change.js';

/** Beyond this nesting depth comparison stops (deterministically) — §11.7 no-crash law. */
const MAX_DEPTH = 256;

export interface DiffOpts {
  requiredOld: string[];
  requiredNew: string[];
  sideClass: 'send' | 'parse';
  /** Internal: current recursion depth. */
  depth?: number;
  /** Internal: ref-target pairs already being compared (cycle guard). */
  seen?: Set<string>;
}

const CONSTRAINT_LABEL: Record<string, string> = {
  pattern: 'pattern',
  minLength: 'minLength',
  maxLength: 'maxLength',
  minItems: 'minItems',
  maxItems: 'maxItems',
  multipleOf: 'multipleOf',
  minimum: 'minimum',
  maximum: 'maximum',
  exclusiveMinimum: 'exclusiveMinimum',
  exclusiveMaximum: 'exclusiveMaximum',
};

const NUMERIC_KEYS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
]);

/** Partial location assembled by callers; pointerOld/pointerNew are added per-fact. */
export type LocationBase = Omit<ChangeLocation, 'pointerOld' | 'pointerNew'>;

/** Compare one pair of schema nodes (already known to be at the same logical position). */
export function diffSchemaNode(
  ctx: DiffContext,
  oldSchema: JsonObject,
  newSchema: JsonObject,
  pointerOld: string,
  pointerNew: string,
  location: LocationBase,
  opts: DiffOpts,
): void {
  const depth = opts.depth ?? 0;
  const seen = opts.seen ?? new Set<string>();
  if (depth > MAX_DEPTH) return; // §11.7: deep nesting must not throw

  // $ref nodes: op-level top sites (depth 0) are covered by the component diff (§10.5b);
  // deeper refs resolve pairwise so ref-target content changes are caught (§11.4).
  if (isRefNode(oldSchema) || isRefNode(newSchema)) {
    if (depth === 0) return;
    const pair = dereffedPair(
      oldSchema,
      newSchema,
      ctx.baselineIndex.schemas,
      ctx.currentIndex.schemas,
      seen,
    );
    if (!pair) return;
    oldSchema = pair.old;
    newSchema = pair.new;
  }
  const name = lastToken(pointerNew) || lastToken(pointerOld) || 'value';

  // ---- type
  if (!deepEqual(oldSchema.type, newSchema.type)) {
    emit(ctx, {
      ruleId: 'property-type-changed',
      location: { ...location, pointerOld, pointerNew },
      oldValue: compactType(oldSchema.type),
      newValue: compactType(newSchema.type),
    });
  }

  // ---- format
  if (!deepEqual(oldSchema.format, newSchema.format)) {
    emit(ctx, {
      ruleId: 'property-format-changed',
      location: {
        ...location,
        pointerOld: `${pointerOld}/format`,
        pointerNew: `${pointerNew}/format`,
      },
      oldValue: oldSchema.format,
      newValue: newSchema.format,
    });
  }

  // ---- default
  if (!deepEqual(oldSchema.default, newSchema.default)) {
    emit(ctx, {
      ruleId: 'property-default-changed',
      location: {
        ...location,
        pointerOld: `${pointerOld}/default`,
        pointerNew: `${pointerNew}/default`,
      },
      oldValue: compact(oldSchema.default),
      newValue: compact(newSchema.default),
    });
  }

  // ---- enum
  diffEnum(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);

  // ---- const
  diffConst(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);

  // ---- constraints
  diffConstraints(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);

  // ---- additionalProperties (map open/close)
  diffAdditionalProperties(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);

  // ---- composition members
  diffComposition(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);

  // ---- discriminator
  diffDiscriminator(ctx, oldSchema, newSchema, pointerOld, pointerNew, location, name);

  // ---- description/title/example metadata
  if (
    !deepEqual(oldSchema.description, newSchema.description) ||
    !deepEqual(oldSchema.title, newSchema.title) ||
    !deepEqual(oldSchema.example, newSchema.example)
  ) {
    emit(ctx, {
      ruleId: 'schema-description-changed',
      location: { ...location, pointerOld, pointerNew },
    });
  }

  // ---- properties (recursive)
  const oldProps = isObject(oldSchema.properties) ? oldSchema.properties : {};
  const newProps = isObject(newSchema.properties) ? newSchema.properties : {};
  const reqOld = opts.requiredOld;
  const reqNew = opts.requiredNew;

  for (const propName of Object.keys(oldProps).sort()) {
    const oldChild = oldProps[propName];
    const newChild = newProps[propName];
    if (newChild === undefined) {
      // property removed — severity by §10.5
      emit(ctx, {
        ruleId: 'property-removed',
        location: {
          ...location,
          pointerOld: `${pointerOld}/properties/${esc(propName)}`,
          pointerNew: '',
        },
        oldValue: propName,
        doctrine: {
          wasRequired: reqOld.includes(propName),
          sideClass: opts.sideClass,
        },
      });
      continue;
    }
    if (!isObject(oldChild) || !isObject(newChild)) continue;

    // §10.5: required-property-added — existing optional property became required
    const wasReq = reqOld.includes(propName);
    const isReq = reqNew.includes(propName);
    if (!wasReq && isReq) {
      emit(ctx, {
        ruleId: 'required-property-added',
        location: {
          ...location,
          pointerOld: `${pointerOld}/properties/${esc(propName)}`,
          pointerNew: `${pointerNew}/properties/${esc(propName)}`,
        },
        oldValue: propName,
        doctrine: { wasRequired: true, sideClass: opts.sideClass },
      });
    } else if (!wasReq && !isReq) {
      // existing optional stays optional; recurse
    }

    diffSchemaNode(
      ctx,
      oldChild,
      newChild,
      `${pointerOld}/properties/${esc(propName)}`,
      `${pointerNew}/properties/${esc(propName)}`,
      location,
      {
        requiredOld: stringArray(oldChild.required),
        requiredNew: stringArray(newChild.required),
        sideClass: opts.sideClass,
      },
    );
  }

  for (const propName of Object.keys(newProps).sort()) {
    if (oldProps[propName] !== undefined) continue;
    const newChild = newProps[propName];
    if (!isObject(newChild)) continue;
    const isReq = reqNew.includes(propName);
    if (!isReq) {
      emit(ctx, {
        ruleId: 'property-added',
        location: {
          ...location,
          pointerOld: '',
          pointerNew: `${pointerNew}/properties/${esc(propName)}`,
        },
        newValue: propName,
      });
    } else {
      // newly present AND required
      emit(ctx, {
        ruleId: 'required-property-added',
        location: {
          ...location,
          pointerOld: '',
          pointerNew: `${pointerNew}/properties/${esc(propName)}`,
        },
        newValue: propName,
        doctrine: { wasRequired: true, sideClass: opts.sideClass },
      });
    }
  }

  // ---- items (array item type changes surface here, §10.4)
  const oldItems = isObject(oldSchema.items) ? oldSchema.items : undefined;
  const newItems = isObject(newSchema.items) ? newSchema.items : undefined;
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
        sideClass: opts.sideClass,
      },
    );
  }

  // ---- required array shrink (either context)
  for (const propName of reqOld) {
    if (!reqNew.includes(propName) && newProps[propName] !== undefined) {
      emit(ctx, {
        ruleId: 'required-removed',
        location: {
          ...location,
          pointerOld: `${pointerOld}/required`,
          pointerNew: `${pointerNew}/required`,
        },
        oldValue: propName,
      });
    }
  }
}

function diffEnum(
  ctx: DiffContext,
  oldSchema: JsonObject,
  newSchema: JsonObject,
  pointerOld: string,
  pointerNew: string,
  location: LocationBase,
  name: string,
): void {
  const oldEnum = Array.isArray(oldSchema.enum) ? oldSchema.enum : undefined;
  const newEnum = Array.isArray(newSchema.enum) ? newSchema.enum : undefined;
  if (!oldEnum || !newEnum) return;
  const ptr = `${pointerOld}/enum`;
  const ptrNew = `${pointerNew}/enum`;
  const compactOld = compactEnum(oldEnum);
  const compactNew = compactEnum(newEnum);
  for (const v of oldEnum) {
    if (!newEnum.some((n) => deepEqual(n, v))) {
      emit(ctx, {
        ruleId: 'enum-value-removed',
        location: { ...location, pointerOld: ptr, pointerNew: ptrNew },
        oldValue: v,
        newValue: compactNew,
      });
    }
  }
  for (const v of newEnum) {
    if (!oldEnum.some((o) => deepEqual(o, v))) {
      emit(ctx, {
        ruleId: 'enum-value-added',
        location: { ...location, pointerOld: ptr, pointerNew: ptrNew },
        oldValue: compactOld,
        newValue: v,
      });
    }
  }
  void name;
}

function compactEnum(e: unknown[]): unknown {
  if (e.length <= 8) return e;
  return `${e.length} values`;
}

function diffConst(
  ctx: DiffContext,
  oldSchema: JsonObject,
  newSchema: JsonObject,
  pointerOld: string,
  pointerNew: string,
  location: LocationBase,
  name: string,
): void {
  const oldConst = oldSchema.const;
  const newConst = newSchema.const;
  const base = { ...location };
  void name;
  if (oldConst === undefined && newConst !== undefined) {
    emit(ctx, {
      ruleId: 'const-added',
      location: { ...base, pointerOld: `${pointerOld}/const`, pointerNew: `${pointerNew}/const` },
      oldValue: undefined,
      newValue: newConst,
    });
  } else if (oldConst !== undefined && newConst !== undefined && !deepEqual(oldConst, newConst)) {
    emit(ctx, {
      ruleId: 'const-changed',
      location: { ...base, pointerOld: `${pointerOld}/const`, pointerNew: `${pointerNew}/const` },
      oldValue: oldConst,
      newValue: newConst,
    });
  } else if (oldConst !== undefined && newConst === undefined) {
    emit(ctx, {
      ruleId: 'const-removed',
      location: { ...base, pointerOld: `${pointerOld}/const`, pointerNew: `${pointerNew}/const` },
      oldValue: oldConst,
    });
  }
}

function diffConstraints(
  ctx: DiffContext,
  oldSchema: JsonObject,
  newSchema: JsonObject,
  pointerOld: string,
  pointerNew: string,
  location: LocationBase,
  name: string,
): void {
  for (const key of Object.keys(CONSTRAINT_LABEL)) {
    const oldV = oldSchema[key];
    const newV = newSchema[key];
    if (oldV === undefined && newV === undefined) continue;
    const ptrOld = `${pointerOld}/${key}`;
    const ptrNew = `${pointerNew}/${key}`;
    const base = { ...location };

    if (oldV === undefined && newV !== undefined) {
      // new restrictive constraint (§11.3)
      emit(ctx, {
        ruleId: 'constraint-added',
        location: { ...base, pointerOld: ptrOld, pointerNew: ptrNew },
        oldValue: undefined,
        newValue: newV,
      });
      continue;
    }
    if (oldV !== undefined && newV === undefined) {
      emit(ctx, {
        ruleId: 'constraint-removed',
        location: { ...base, pointerOld: ptrOld, pointerNew: ptrNew },
        oldValue: oldV,
      });
      continue;
    }
    if (deepEqual(oldV, newV)) continue;

    if (key === 'pattern') {
      // §11.3: changed pattern → tightened (no sound subset analysis in v1)
      emit(ctx, {
        ruleId: 'constraint-tightened',
        location: { ...base, pointerOld: ptrOld, pointerNew: ptrNew },
        oldValue: oldV,
        newValue: newV,
      });
      continue;
    }
    if (NUMERIC_KEYS.has(key)) {
      const o = num(oldV);
      const n = num(newV);
      const isLower =
        (LOWER_BOUNDS as readonly string[]).includes(key) || key === 'exclusiveMinimum';
      const dir = boundDirection(isLower ? 'lower' : 'upper', o, n);
      emit(ctx, {
        ruleId: dir === 'tightened' ? 'constraint-tightened' : 'constraint-relaxed',
        location: { ...base, pointerOld: ptrOld, pointerNew: ptrNew },
        oldValue: oldV,
        newValue: newV,
      });
      continue;
    }
    // string-length bounds are numeric too; anything else: fall back to modified comparison
    const o = num(oldV);
    const n = num(newV);
    if (o !== undefined && n !== undefined) {
      const isLower = (LOWER_BOUNDS as readonly string[]).includes(key);
      const dir = boundDirection(isLower ? 'lower' : 'upper', o, n);
      emit(ctx, {
        ruleId: dir === 'tightened' ? 'constraint-tightened' : 'constraint-relaxed',
        location: { ...base, pointerOld: ptrOld, pointerNew: ptrNew },
        oldValue: oldV,
        newValue: newV,
      });
    }
    void name;
  }
}

function diffAdditionalProperties(
  ctx: DiffContext,
  oldSchema: JsonObject,
  newSchema: JsonObject,
  pointerOld: string,
  pointerNew: string,
  location: LocationBase,
  name: string,
): void {
  const oldClosed = isClosed(oldSchema.additionalProperties);
  const newClosed = isClosed(newSchema.additionalProperties);
  void name;
  if (!oldClosed && newClosed) {
    emit(ctx, {
      ruleId: 'map-closed',
      location: {
        ...location,
        pointerOld: `${pointerOld}/additionalProperties`,
        pointerNew: `${pointerNew}/additionalProperties`,
      },
    });
  } else if (oldClosed && !newClosed) {
    emit(ctx, {
      ruleId: 'map-opened',
      location: {
        ...location,
        pointerOld: `${pointerOld}/additionalProperties`,
        pointerNew: `${pointerNew}/additionalProperties`,
      },
    });
  }
}

/** absent/true = open in OAS; false or schema = closed (§10.4). */
function isClosed(v: unknown): boolean {
  if (v === undefined || v === true) return false;
  return true; // false or a schema object
}

function diffComposition(
  ctx: DiffContext,
  oldSchema: JsonObject,
  newSchema: JsonObject,
  pointerOld: string,
  pointerNew: string,
  location: LocationBase,
  name: string,
): void {
  void name;
  // allOf
  const oldAll = Array.isArray(oldSchema.allOf) ? oldSchema.allOf : [];
  const newAll = Array.isArray(newSchema.allOf) ? newSchema.allOf : [];
  if (newAll.length > oldAll.length) {
    emit(ctx, {
      ruleId: 'allOf-member-added',
      location: {
        ...location,
        pointerOld: `${pointerOld}/allOf`,
        pointerNew: `${pointerNew}/allOf`,
      },
      oldValue: oldAll.length,
      newValue: newAll.length,
    });
  } else if (newAll.length < oldAll.length) {
    emit(ctx, {
      ruleId: 'allOf-member-removed',
      location: {
        ...location,
        pointerOld: `${pointerOld}/allOf`,
        pointerNew: `${pointerNew}/allOf`,
      },
      oldValue: oldAll.length,
      newValue: newAll.length,
    });
  }

  // anyOf/oneOf
  for (const key of ['anyOf', 'oneOf'] as const) {
    const oldArr = Array.isArray(oldSchema[key]) ? oldSchema[key] : [];
    const newArr = Array.isArray(newSchema[key]) ? newSchema[key] : [];
    if (newArr.length > oldArr.length) {
      emit(ctx, {
        ruleId: 'anyOf-oneOf-member-added',
        location: {
          ...location,
          pointerOld: `${pointerOld}/${key}`,
          pointerNew: `${pointerNew}/${key}`,
        },
        oldValue: oldArr.length,
        newValue: newArr.length,
      });
    } else if (newArr.length < oldArr.length) {
      emit(ctx, {
        ruleId: 'anyOf-oneOf-member-removed',
        location: {
          ...location,
          pointerOld: `${pointerOld}/${key}`,
          pointerNew: `${pointerNew}/${key}`,
        },
        oldValue: oldArr.length,
        newValue: newArr.length,
      });
    }
  }
}

function diffDiscriminator(
  ctx: DiffContext,
  oldSchema: JsonObject,
  newSchema: JsonObject,
  pointerOld: string,
  pointerNew: string,
  location: LocationBase,
  name: string,
): void {
  void name;
  const oldDisc = isObject(oldSchema.discriminator) ? oldSchema.discriminator : undefined;
  const newDisc = isObject(newSchema.discriminator) ? newSchema.discriminator : undefined;
  if (!oldDisc && newDisc) {
    emit(ctx, {
      ruleId: 'discriminator-added',
      location: {
        ...location,
        pointerOld: `${pointerOld}/discriminator`,
        pointerNew: `${pointerNew}/discriminator`,
      },
      newValue: newDisc.propertyName,
    });
  } else if (oldDisc && newDisc && !deepEqual(oldDisc, newDisc)) {
    emit(ctx, {
      ruleId: 'discriminator-changed',
      location: {
        ...location,
        pointerOld: `${pointerOld}/discriminator`,
        pointerNew: `${pointerNew}/discriminator`,
      },
      oldValue: oldDisc.propertyName,
      newValue: newDisc.propertyName,
    });
  } else if (oldDisc && !newDisc) {
    emit(ctx, {
      ruleId: 'discriminator-changed',
      location: {
        ...location,
        pointerOld: `${pointerOld}/discriminator`,
        pointerNew: `${pointerNew}/discriminator`,
      },
      oldValue: oldDisc.propertyName,
      newValue: undefined,
    });
  }
}

function compactType(t: unknown): unknown {
  if (t === undefined) return undefined;
  return typeLabel(t);
}

function compact(v: unknown): unknown {
  if (v === undefined || v === null) return v;
  if (typeof v !== 'object') return v;
  const json = JSON.stringify(v);
  if (json === undefined || json.length <= 80) return v;
  // Blind slicing produces invalid JSON; emit a truncated *string* marker instead (§12).
  return `${json.slice(0, 77)}…`;
}

function stringArrayOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function lastToken(pointer: string): string {
  const tokens = pointer.split('/').filter(Boolean);
  const last = tokens[tokens.length - 1];
  return (last ?? '').replace(/~1/g, '/').replace(/~0/g, '~');
}
