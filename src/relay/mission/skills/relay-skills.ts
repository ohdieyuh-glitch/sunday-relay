import {
  evaluatePermission,
  type McpAgentRole,
  type McpPermissionDecision,
  type McpPermissionEvaluationInput,
} from '../../mcp/policy/mcp-permissions';
import type { McpCapabilityKind } from '../../mcp/domain/mcp-capabilities';
import type { McpRiskClass } from '../../mcp/policy/mcp-risk';

/**
 * RELAY SKILLS — named capabilities, behind the permission model that exists.
 *
 * A skill is a declared bundle: what it does, which MCP capabilities it needs,
 * the highest risk any of its steps reaches, which roles may run it at all,
 * and what running it PRODUCES. It is a description, not an engine.
 *
 * THE ONE RULE THAT MATTERS: THERE IS NO SECOND JUDGEMENT.
 *
 * This module never decides whether a call is permitted. It narrows — a skill
 * may declare that only a coding agent should ever run it — and then it asks
 * `evaluatePermission`, which is the one place that answers. So the skill layer
 * can make an answer STRICTER and can never make one more permissive, and
 * `skills-are-never-more-permissive.test` holds exactly that by running both
 * and comparing.
 *
 * That asymmetry is the whole design. A skill catalogue that could grant is a
 * permission system wearing a friendlier name, and Relay would then have two —
 * which is the failure the direction names outright.
 *
 * WHAT A SKILL PRODUCES IS PART OF ITS DECLARATION, because "reads the
 * repository" and "opens a pull request" are not the same kind of act and a
 * Mission has to be able to tell them apart before running either.
 *
 * Pure: no clock, no network, no Node. Time arrives as an ISO string.
 */

export const SKILL_PRODUCTS = [
  /** Observations. Nothing outside Relay changes. */
  'evidence',
  /** Reasoning over what is already known. Nothing changes anywhere. */
  'analysis',
  /** A change inside the mission's own workspace. */
  'workspace_change',
  /** A change outside Relay: a service, an account, another system. */
  'external_change',
] as const;
export type SkillProduct = (typeof SKILL_PRODUCTS)[number];

export interface RelaySkill {
  readonly skillId: string;
  /** Skills are versioned because their permissions can change. */
  readonly version: number;
  readonly summary: string;
  /** MCP capability kinds this skill touches. */
  readonly capabilityKinds: readonly McpCapabilityKind[];
  /**
   * The HIGHEST risk any step of this skill reaches.
   *
   * Declared, not derived: a skill that reads ten files and then deletes one
   * is a destructive skill, and averaging its steps would hide that.
   */
  readonly highestRiskClass: McpRiskClass;
  /**
   * Roles that may run this skill AT ALL.
   *
   * A NARROWING, never a grant. A role listed here still has to pass the
   * permission evaluation; a role absent from here is refused before the
   * evaluation is even reached.
   */
  readonly permittedRoles: readonly McpAgentRole[];
  readonly produces: SkillProduct;
  /** Exact capability names this skill invokes. No wildcards, deliberately. */
  readonly requiredCapabilityNames: readonly string[];
}

export const SKILL_REFUSALS = [
  'skill_unknown',
  'role_not_permitted_for_skill',
  'capability_not_declared',
  'permission_denied',
  /**
   * The skill changes something and the Mission asked only to read. Distinct
   * from `permission_denied` because the agent may be perfectly entitled — the
   * MISSION is what did not ask for a change, and an operator told the wrong
   * one of those two would go and widen the wrong thing.
   */
  'mission_does_not_authorize_change',
] as const;
export type SkillRefusal = (typeof SKILL_REFUSALS)[number];

export type SkillDecision =
  | { readonly ok: true; readonly decision: McpPermissionDecision; readonly skill: RelaySkill }
  | { readonly ok: false; readonly refusal: SkillRefusal; readonly detail: string;
    /** Present when the permission model was the one that refused. */
    readonly decision: McpPermissionDecision | null };

/**
 * Whether one capability call, made in the name of a skill, may proceed.
 *
 * The order is the point. Skill-level narrowing first, because it is cheaper
 * and because a role that should never run this skill should be told that
 * rather than told about a capability. Then the permission model, whose answer
 * is FINAL — including `requires_approval`, which is passed through unchanged
 * rather than being resolved here.
 */
/**
 * THE NARROWING, ON ITS OWN — everything the skill layer knows, and nothing
 * about who governs the operation.
 *
 * Split out because Relay has TWO kinds of skill and only one kind of judge
 * per kind:
 *
 *   EXTERNAL capabilities go to `evaluatePermission`, where a server identity,
 *   an approved snapshot and real grants exist to reason about.
 *
 *   RELAY'S OWN operations are already governed — Live Reach retrieval by
 *   `evaluateLiveReach`, a workspace write by the mission's write scope. Those
 *   ARE the permissions, and asking the MCP model about them would mean
 *   inventing a server identity and an approved snapshot for Relay's own
 *   internals: a second judgement, which is the thing this file exists to
 *   avoid.
 *
 * One implementation, so the two paths cannot drift into disagreeing about
 * which role may run what.
 */
export type SkillNarrowing =
  | { readonly ok: true; readonly skill: RelaySkill }
  | { readonly ok: false; readonly refusal: SkillRefusal; readonly detail: string };

export function narrowSkill(input: {
  readonly skill: RelaySkill | null;
  readonly capabilityName: string;
  readonly role: string;
}): SkillNarrowing {
  const { skill } = input;
  if (skill === null) {
    return { ok: false, refusal: 'skill_unknown', detail: 'No such skill is registered.' };
  }

  if (!skill.permittedRoles.includes(input.role as McpAgentRole)) {
    return {
      ok: false,
      refusal: 'role_not_permitted_for_skill',
      detail: `${skill.skillId} may not be run by ${input.role}.`,
    };
  }

  if (!skill.requiredCapabilityNames.includes(input.capabilityName)) {
    // A skill invoking something it never declared is the skill equivalent of
    // an undeclared dependency: it may be harmless, and nobody reviewed it.
    return {
      ok: false,
      refusal: 'capability_not_declared',
      detail: `${skill.skillId} did not declare ${input.capabilityName}.`,
    };
  }

  return { ok: true, skill };
}

export function evaluateSkillCall(input: {
  readonly skill: RelaySkill | null;
  readonly capabilityName: string;
  readonly permission: McpPermissionEvaluationInput;
}): SkillDecision {
  const narrowed = narrowSkill({
    skill: input.skill,
    capabilityName: input.capabilityName,
    role: input.permission.role,
  });
  if (!narrowed.ok) {
    return { ok: false, refusal: narrowed.refusal, detail: narrowed.detail, decision: null };
  }
  const { skill } = narrowed;

  // THE ONE JUDGEMENT. Whatever it says stands, including approval.
  const decision = evaluatePermission(input.permission);
  if (decision.decision === 'deny') {
    return {
      ok: false,
      refusal: 'permission_denied',
      detail: decision.reason,
      decision,
    };
  }
  return { ok: true, decision, skill };
}

/**
 * A skill over one of RELAY'S OWN operations.
 *
 * The governing verdict is a PARAMETER, and that is the design rather than an
 * inconvenience: this function cannot be called without having already asked
 * whoever actually governs the operation. There is no branch in here that
 * decides whether retrieval is allowed — `evaluateLiveReach` decided that
 * before the call, and this only narrows what the skill layer knows.
 *
 * The order is narrowing, then Mission authority, then the governing verdict:
 *
 *   NARROWING FIRST because a role that may never run this skill should hear
 *   that, rather than hear about a capability it was never going to reach.
 *
 *   MISSION AUTHORITY next, because a Mission that asked only to read has not
 *   asked for a change however entitled the agent is — the same line Live
 *   Reach already draws between availability and a Mission having asked.
 *
 *   THE GOVERNING VERDICT LAST AND FINAL. It can only ever remove permission
 *   here; there is no path through this function that returns `ok` while it
 *   says no, which is the same asymmetry `evaluateSkillCall` has against
 *   `evaluatePermission`.
 */
export type InternalSkillDecision =
  | { readonly ok: true; readonly skill: RelaySkill }
  | { readonly ok: false; readonly refusal: SkillRefusal; readonly detail: string };

export function evaluateInternalSkillCall(input: {
  readonly skill: RelaySkill | null;
  readonly capabilityName: string;
  readonly role: string;
  /**
   * Whether THIS Mission asked for a change. Only consulted for a skill that
   * makes one, and supplied rather than inferred.
   */
  readonly missionAuthorisesChange: boolean;
  /**
   * The verdict of the judgement that already governs this operation, with its
   * own words. Relay has exactly one of these per operation and this is where
   * it arrives — never re-derived here.
   */
  readonly governing: { readonly allowed: boolean; readonly detail: string };
}): InternalSkillDecision {
  const narrowed = narrowSkill({
    skill: input.skill,
    capabilityName: input.capabilityName,
    role: input.role,
  });
  if (!narrowed.ok) return narrowed;
  const { skill } = narrowed;

  if (skillChangesSomething(skill) && !input.missionAuthorisesChange) {
    return {
      ok: false,
      refusal: 'mission_does_not_authorize_change',
      detail: `${skill.skillId} ${skill.produces === 'external_change'
        ? 'changes something outside Relay'
        : 'changes the workspace'}, and this Mission authorised only reading.`,
    };
  }

  if (!input.governing.allowed) {
    return { ok: false, refusal: 'permission_denied', detail: input.governing.detail };
  }

  return { ok: true, skill };
}

/**
 * Whether a Mission that authorised only reading may run this skill.
 *
 * Separate from permission on purpose: a Mission's authority and an agent's
 * permission are different questions, and Live Reach already draws the same
 * line. A skill that changes something needs a Mission that asked for a
 * change, however permitted the agent is.
 */
export function skillChangesSomething(skill: RelaySkill): boolean {
  return skill.produces === 'workspace_change' || skill.produces === 'external_change';
}

/** Find a skill by id and version. Unknown is null, never a nearest match. */
export function findSkill(
  catalogue: readonly RelaySkill[],
  skillId: string,
  version?: number,
): RelaySkill | null {
  const matches = catalogue.filter((s) => s.skillId === skillId);
  if (matches.length === 0) return null;
  if (version !== undefined) return matches.find((s) => s.version === version) ?? null;
  // Highest version wins when none is named, and a caller that cares pins one.
  return matches.reduce((best, s) => (s.version > best.version ? s : best));
}

/**
 * The skills Relay ships.
 *
 * Deliberately few, and every one of them is something Relay can already do:
 * a catalogue naming skills with no implementation is the fabricated-capability
 * failure in another costume.
 */
export const RELAY_SKILLS: readonly RelaySkill[] = Object.freeze([
  Object.freeze({
    skillId: 'relay.evidence.gather',
    version: 1,
    summary: 'Retrieve current external information through Live Reach and record it as evidence.',
    capabilityKinds: Object.freeze(['tool'] as McpCapabilityKind[]),
    highestRiskClass: 'read_only' as McpRiskClass,
    // The architect plans with evidence; the reviewer checks claims against it.
    permittedRoles: Object.freeze(['architect', 'reviewer', 'security-reviewer'] as McpAgentRole[]),
    produces: 'evidence' as SkillProduct,
    requiredCapabilityNames: Object.freeze(['relay.live_reach.retrieve']),
  }),
  Object.freeze({
    skillId: 'relay.repository.read',
    version: 1,
    summary: 'Read files inside the mission workspace.',
    capabilityKinds: Object.freeze(['tool', 'resource'] as McpCapabilityKind[]),
    highestRiskClass: 'read_only' as McpRiskClass,
    permittedRoles: Object.freeze([
      'architect', 'coding-agent', 'reviewer', 'security-reviewer', 'verification',
    ] as McpAgentRole[]),
    produces: 'analysis' as SkillProduct,
    requiredCapabilityNames: Object.freeze(['relay.workspace.read']),
  }),
  Object.freeze({
    skillId: 'relay.repository.edit',
    version: 1,
    summary: 'Write files inside the paths a mission scoped.',
    capabilityKinds: Object.freeze(['tool'] as McpCapabilityKind[]),
    highestRiskClass: 'workspace_write' as McpRiskClass,
    // ONLY the coding agent. An architect that can write is a coding agent
    // with a different name, which is the reasoning the role defaults already
    // carry — restated here so the skill cannot quietly widen it.
    permittedRoles: Object.freeze(['coding-agent'] as McpAgentRole[]),
    produces: 'workspace_change' as SkillProduct,
    requiredCapabilityNames: Object.freeze(['relay.workspace.write']),
  }),
]);
