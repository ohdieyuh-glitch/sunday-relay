import {
  MCP_AGENT_ROLES,
  MCP_FORBIDDEN_ROLES,
  MCP_HUMAN_APPROVAL_RISK_CLASSES,
  MCP_RISK_CLASSES,
  riskSeverity,
  type McpAgentRole,
  type McpRiskClass,
} from '../../mcp';
import {
  JULIUS_DEFAULT_ROLES,
  type JuliusPolicyEffect,
  type JuliusPolicyOperation,
  type JuliusToolRisk,
  type JuliusWorkerRole,
} from '../../mission/julius';

/**
 * ONE AUTHORITY, TWO VOCABULARIES — AND THE TYPED BRIDGE BETWEEN THEM.
 *
 * The MCP subsystem and Julius were built separately and have never met. Each
 * has a name for a ROLE and a name for how dangerous an ACTION is, and the two
 * sets are not the same size, not the same spelling, and not the same strength.
 * Comparing them with string equality anywhere would be the moment the
 * parallel architecture became permanent, so this is the only place they are
 * related, and the relation is a total function with proofs.
 *
 * WHICH MODEL IS CANONICAL, AND WHY IT IS NOT JULIUS'S.
 *
 * `JuliusToolDefinition.riskClass` is `LOW | MEDIUM | HIGH`. It is WRITTEN by
 * the default tool registry and READ by nothing: `JuliusToolController.invoke`
 * evaluates C.A.R.D. from the tool's capability and its filesystem / process /
 * network flags, and never consults the field. It is a declared value with no
 * consumer.
 *
 * MCP's eight classes are the opposite: `MCP_ROLE_DEFAULTS` gates on them, and
 * `requiresHumanApproval` turns six of them into a human decision. They also
 * encode a judgement the three-value scale cannot express — `unknown` sits
 * ABOVE `destructive`, because when Relay both recognises a destructive
 * pattern and fails to understand part of a call, the honest answer is that it
 * does not know what the call does.
 *
 * So "map MCP's risk into the canonical Julius model" cannot mean flattening
 * eight live classes into three dead ones. That would move a working gate into
 * a field nothing reads and call the result unification. The canonical model
 * ADOPTS the richer vocabulary, and `juliusToolRiskOf` remains only as a
 * lossy, monotone projection for callers that still speak the old scale.
 *
 * NOTHING HERE MAY ESCALATE. Every function is total, every unknown is a
 * refusal rather than a default, and the proofs read MCP's own exported
 * constants rather than restating them — so a class or role added over there
 * fails a test here instead of silently taking a fallback.
 */

/**
 * THE CANONICAL JULIUS ACTION-RISK MODEL.
 *
 * Adopted from MCP's vocabulary rather than invented beside it, and declared
 * as its own type so the canonical model is a Julius concept that MCP happens
 * to agree with — not an MCP type Julius imports and depends on the spelling
 * of. `juliusActionRiskOfMcp` is the declared relation between them.
 */
export const JULIUS_ACTION_RISKS = [
  'read_only',
  'workspace_write',
  'external_write',
  'deployment',
  'financial',
  'credential_access',
  'destructive',
  'unknown',
] as const;
export type JuliusActionRisk = (typeof JULIUS_ACTION_RISKS)[number];

/**
 * Severity order, `unknown` at the top for the reason above.
 *
 * Deliberately a copy rather than a re-export of `riskSeverity`: the canonical
 * order is Julius's to state, and a test asserts the two agree on every class,
 * so they cannot drift apart unnoticed.
 */
const SEVERITY: Readonly<Record<JuliusActionRisk, number>> = Object.freeze({
  read_only: 0,
  workspace_write: 1,
  external_write: 2,
  deployment: 3,
  financial: 4,
  credential_access: 5,
  destructive: 6,
  unknown: 7,
});

export const juliusActionRiskSeverity = (risk: JuliusActionRisk): number => SEVERITY[risk];

/** Classes no autonomous run may take on its own authority. */
export const JULIUS_APPROVAL_REQUIRED_RISKS: readonly JuliusActionRisk[] = Object.freeze([
  'external_write', 'deployment', 'financial', 'credential_access', 'destructive', 'unknown',
]);

export const juliusRiskRequiresApproval = (risk: JuliusActionRisk): boolean =>
  JULIUS_APPROVAL_REQUIRED_RISKS.includes(risk);

/**
 * The MCP class this action is, in canonical terms.
 *
 * Written out rather than cast, so the compiler checks the mapping is TOTAL:
 * a ninth MCP class cannot compile until someone decides what it means here.
 * A cast would have accepted it silently and a lookup with a fallback would
 * have given it whatever the fallback was.
 */
const CANONICAL_RISK: Readonly<Record<McpRiskClass, JuliusActionRisk>> = Object.freeze({
  read_only: 'read_only',
  workspace_write: 'workspace_write',
  external_write: 'external_write',
  deployment: 'deployment',
  financial: 'financial',
  credential_access: 'credential_access',
  destructive: 'destructive',
  unknown: 'unknown',
});

export const juliusActionRiskOfMcp = (risk: McpRiskClass): JuliusActionRisk => CANONICAL_RISK[risk];

/**
 * THE LOSSY PROJECTION, for callers that still speak `LOW | MEDIUM | HIGH`.
 *
 * Monotone by construction and proven so: a higher canonical severity never
 * lands on a lower rung. Everything that needs a human is HIGH, so a reader
 * of the old scale is never told an approval-gated action is routine — it
 * simply cannot tell `destructive` from `unknown`, which is exactly the
 * information the old scale never had.
 */
export const juliusToolRiskOf = (risk: JuliusActionRisk): JuliusToolRisk => {
  if (risk === 'read_only') return 'LOW';
  if (risk === 'workspace_write') return 'MEDIUM';
  return 'HIGH';
};

/* ------------------------------------------------------------------ *
 * Roles.
 * ------------------------------------------------------------------ */

/**
 * A ROLE THAT COULD NOT BE TRANSLATED IS REFUSED, NOT SUBSTITUTED.
 *
 * `JuliusWorkerRole` is `PROMPT_ARCHITECT | CODING_AGENT | INDEPENDENT_REVIEWER`
 * plus the OPEN set `SPECIALIST:${string}` — anyone may name a new specialist,
 * and nothing declares what one is entitled to. Three ways to handle that were
 * available and two are escalations wearing different clothes:
 *
 *   map it to `coding-agent`, and `SPECIALIST:anything` silently gains
 *   mission-scoped workspace writes and approvable external writes; or
 *
 *   map it to a role that currently has empty defaults, such as `operations`,
 *   which is correct only for as long as that role stays empty — the day
 *   somebody gives `operations` a grant, every specialist inherits it.
 *
 * So an untranslatable role produces NO MCP role at all. The gateway is never
 * called, which means no server, process or network contact, and the refusal
 * names itself.
 */
export type JuliusMcpRoleTranslation =
  | { readonly translated: true; readonly role: McpAgentRole }
  | { readonly translated: false; readonly reasonCode: string; readonly safeRationale: string };

const CANONICAL_ROLE: Readonly<Record<(typeof JULIUS_DEFAULT_ROLES)[number], McpAgentRole>> = Object.freeze({
  PROMPT_ARCHITECT: 'architect',
  CODING_AGENT: 'coding-agent',
  // Maps to a role MCP itself forbids. Translation states what the role IS;
  // it is not where the refusal happens. Both the execution adapter and the
  // gateway refuse it, and both do so by reading MCP_FORBIDDEN_ROLES — the
  // rule no grant can override — so there is one rule consulted at two
  // depths rather than a copy here that could drift away from it.
  INDEPENDENT_REVIEWER: 'reviewer',
});

export function mcpRoleForJuliusRole(role: JuliusWorkerRole): JuliusMcpRoleTranslation {
  const known = (JULIUS_DEFAULT_ROLES as readonly string[]).includes(role)
    ? CANONICAL_ROLE[role as (typeof JULIUS_DEFAULT_ROLES)[number]]
    : undefined;
  if (known !== undefined) return { translated: true, role: known };
  return {
    translated: false,
    reasonCode: 'MCP_ROLE_UNTRANSLATABLE',
    safeRationale: role.startsWith('SPECIALIST:')
      ? 'A specialist role has no declared MCP entitlement; an invocation under it is refused rather than granted another role’s.'
      : 'This worker role has no MCP translation; an invocation under it is refused rather than granted another role’s.',
  };
}

/* ------------------------------------------------------------------ *
 * The composite decision.
 * ------------------------------------------------------------------ */

/** Which transport this connection uses, because it decides what the act IS. */
export type JuliusMcpTransport = 'stdio' | 'http';

/**
 * The C.A.R.D. operations an MCP invocation actually performs.
 *
 * `USE_TOOL` always. Then the truth about the act rather than about the
 * protocol: a stdio server is a CHILD PROCESS this host spawns, and an HTTP
 * server is a NETWORK call — Julius already governs both, and declaring the
 * wrong one would let a policy that forbids process execution authorise a
 * spawn. `workspace_write` adds filesystem mutation on top.
 *
 * Deliberately not over-declared: naming every operation for every call would
 * make a read-only documentation lookup fail a policy that forbids mutation,
 * and a gate that refuses everything teaches operators to widen the policy.
 */
export function juliusPolicyOperationsForMcp(input: {
  readonly risk: JuliusActionRisk;
  readonly transport: JuliusMcpTransport;
}): readonly JuliusPolicyOperation[] {
  return [
    'USE_TOOL',
    input.transport === 'stdio' ? 'EXECUTE_PROCESS' : 'ACCESS_NETWORK',
    ...(input.risk === 'workspace_write' ? (['MUTATE_FILESYSTEM'] as const) : []),
  ];
}

/**
 * THE MOST RESTRICTIVE OF THE TWO, NEVER EITHER ALONE.
 *
 * This is the whole shape of "one authority, multiple protocols". The MCP
 * gateway keeps its own checks and they still run — role scoping, the approved
 * snapshot, denial before contact, sanitisation — but its `allow` is
 * NECESSARY AND NOT SUFFICIENT. Julius's C.A.R.D. decision is applied on top,
 * and the answer is whichever refuses harder.
 *
 * So the gateway can never become a second tool authority beside
 * `JuliusToolController`: there is no path on which its permission stands
 * alone, and no path on which Julius's does either.
 */
const EFFECT_ORDER: Readonly<Record<JuliusPolicyEffect, number>> = Object.freeze({
  ALLOW: 0, LIMITED: 1, REQUIRE_APPROVAL: 2, DENY: 3,
});

export const strictestJuliusEffect = (a: JuliusPolicyEffect, b: JuliusPolicyEffect): JuliusPolicyEffect =>
  EFFECT_ORDER[a] >= EFFECT_ORDER[b] ? a : b;

/**
 * What the RISK alone demands, before any policy is consulted.
 *
 * Never `ALLOW` for a class MCP would put to a human: an approval-gated action
 * that arrived at Julius as routine would be the escalation this whole module
 * exists to make impossible.
 */
export const juliusEffectForRisk = (risk: JuliusActionRisk): JuliusPolicyEffect =>
  juliusRiskRequiresApproval(risk) ? 'REQUIRE_APPROVAL' : 'ALLOW';

/** Re-exported for proofs that must read the source of truth, not a copy of it. */
export const MCP_VOCABULARY = Object.freeze({
  risks: MCP_RISK_CLASSES,
  roles: MCP_AGENT_ROLES,
  forbiddenRoles: MCP_FORBIDDEN_ROLES,
  humanApprovalRisks: MCP_HUMAN_APPROVAL_RISK_CLASSES,
  severityOf: riskSeverity,
});
