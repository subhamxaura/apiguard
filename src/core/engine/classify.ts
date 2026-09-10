/**
 * Severity/kind classification: registry defaults + §10.5 context-class doctrine + config
 * overrides (plain or `ruleId@context` scoped). Kept in one pure module per §28.
 */
import type { ChangeKind, Context, Severity } from '../models/change.js';
import { getRule } from '../rules/rule-registry.js';

/** Context classes for the §10.5 doctrine. */
export type SideClass = 'send' | 'parse';

/** Context → side class per §10.5. Callbacks/webhooks are parse-side (consumers receive). */
export function sideClassOf(context: Context): SideClass {
  switch (context) {
    case 'request-body':
    case 'request-header':
    case 'parameter':
      return 'send';
    case 'response-body':
    case 'response-header':
    case 'callback':
    case 'webhook':
      return 'parse';
    case 'component':
      // component changes carry their usage class via severity resolution at emit time
      return 'parse';
    default:
      return 'parse';
  }
}

export interface ClassifyOptions {
  /** config rules map: ruleId or ruleId@context → severity (may include 'off'). */
  rules: Record<string, 'error' | 'warning' | 'info' | 'off'>;
}

/** Parse a config rules key into ruleId + optional context scope. */
export function parseRuleKey(key: string): { ruleId: string; context?: string } {
  const at = key.indexOf('@');
  if (at === -1) return { ruleId: key };
  return { ruleId: key.slice(0, at), context: key.slice(at + 1) };
}

/**
 * §10.5 doctrine for the two [ctx] schema rules whose default severity depends on context
 * and on whether the removed item was mandatory (send-side) or on the parse side.
 */
export function resolveContextSeverity(
  ruleId: string,
  context: Context,
  opts: { wasRequired?: boolean; sideClass?: SideClass },
): Severity {
  const side = opts.sideClass ?? sideClassOf(context);
  if (ruleId === 'property-removed') {
    if (side === 'parse') return 'error'; // parse-side removals always break parsers
    // send-side
    if (context === 'request-header') return 'error'; // protocol-relevant
    if (context === 'parameter') return 'error'; // path/query/cookie removal surfaced at param level
    return opts.wasRequired ? 'error' : 'warning'; // request-body doctrine
  }
  if (ruleId === 'required-property-added') {
    if (side === 'parse') return 'info'; // extra data never breaks a parser
    return 'error'; // send-side: forces the consumer
  }
  if (ruleId === 'request-body-removed') {
    return opts.wasRequired ? 'error' : 'warning'; // §10.3/§10.5 doctrine
  }
  if (ruleId === 'removed-parameter') {
    // emitter's wasRequired folds in in: path / in: header (§10.5)
    return opts.wasRequired ? 'error' : 'warning';
  }
  return getRule(ruleId).defaultSeverity;
}

/** Resolve the final severity+kind for a candidate. Returns null when the rule is 'off'. */
export function classify(
  ruleId: string,
  context: Context,
  options: ClassifyOptions,
  doctrine?: { wasRequired?: boolean; sideClass?: SideClass },
): { severity: Severity; kind: ChangeKind } | null {
  const rule = getRule(ruleId);

  // 1. config override: scoped key wins over plain key (§14.3)
  let override: 'error' | 'warning' | 'info' | 'off' | undefined;
  for (const [key, value] of Object.entries(options.rules)) {
    const parsed = parseRuleKey(key);
    if (parsed.ruleId !== ruleId) continue;
    if (parsed.context !== undefined && parsed.context === context) override = value;
    else if (parsed.context === undefined && override === undefined) override = value;
  }

  // 2. §10.5 doctrine for context-sensitive rules
  if (override === 'off') return null;
  const DOCTRINE_RULES: ReadonlySet<string> = new Set([
    'property-removed',
    'required-property-added',
    'request-body-removed',
    'removed-parameter',
  ]);
  const severity: Severity =
    override ??
    (DOCTRINE_RULES.has(ruleId)
      ? resolveContextSeverity(ruleId, context, doctrine ?? {})
      : rule.defaultSeverity);
  return { severity, kind: rule.defaultKind };
}
