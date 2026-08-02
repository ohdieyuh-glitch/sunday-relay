/**
 * SUNDAY RELAY — LOOP TARGET RESOLUTION.
 *
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE:
 *
 *   a requested role is not an executing agent.
 *
 * `/loop architect,coding fix it` REQUESTS two roles. Whether an architect is
 * configured, whether a coding agent is connected, and which concrete agent
 * identity actually answers are three further questions, and each has its own
 * field here. Collapsing them — letting "I asked for a reviewer" render as
 * "a reviewer is working" — is precisely the class of claim Relay exists to
 * make impossible, and it is the same requested-versus-actual discipline
 * `RelayExecutionAttestation` and `RelayRuntimeReference` already carry.
 *
 * WHY RESOLUTION TAKES A SNAPSHOT RATHER THAN READING A REGISTRY. The mission
 * layer is a pure leaf projection: it may not import `../coordination`,
 * `../core` or anything with I/O, and a structural test proves it. So the
 * caller — the server, which can actually see the registry — passes what it
 * observed, and this module decides what that means. The decision is
 * deterministic and testable; the observation is somebody else's job.
 *
 * UNKNOWN IS NOT AVAILABLE. A role whose availability could not be determined
 * is never resolved. Staffing a Loop on the strength of a missing answer is
 * how a slot ends up appearing to work when nothing is there.
 */

import type { Provenance } from '../../protocol/enums';
import type { RelayAgentRole } from '../agent-operating';
import type { RelayLoopTargetSelector } from './loop-roles';

/* ---------------------------------------------------------- availability */

/**
 * Why a role can or cannot take work right now.
 *
 * `unknown` is a first-class value, not an error: after a restart, or with the
 * bridge unreachable, Relay genuinely does not know, and saying so is the
 * truthful answer. It never counts as available.
 */
export const RELAY_ROLE_AVAILABILITIES = [
  'available',
  'not_configured',
  'not_connected',
  'entitlement_locked',
  'unknown',
] as const;
export type RelayRoleAvailability = (typeof RELAY_ROLE_AVAILABILITIES)[number];

/** The only availability that permits assignment. */
export const ASSIGNABLE_ROLE_AVAILABILITY: RelayRoleAvailability = 'available';

/**
 * What the server observed about the agent registry, at one instant.
 *
 * `activeCompoundAgentRoles` is what the user's current Relay Dog is
 * configured with — the default `/loop` target. `eligibleRoles` is every role
 * the account could staff, which `/loop all` targets and which may be a LARGER
 * set. Keeping them apart is what lets a preview say "your compound agent is
 * architect + coding; `all` would add reviewer" instead of silently widening.
 */
export interface RelayAgentRegistrySnapshot {
  readonly activeCompoundAgentRoles: readonly RelayAgentRole[];
  readonly eligibleRoles: readonly RelayAgentRole[];
  readonly availability: Readonly<Partial<Record<RelayAgentRole, RelayRoleAvailability>>>;
  /** Where these observations came from. `null` is Unknown, and a snapshot
   *  that cannot say is never treated as live. */
  readonly provenance: Provenance | null;
  readonly observedAt: string;
}

/* -------------------------------------------------------------- outcomes */

export interface RelayLoopUnavailableRole {
  readonly role: RelayAgentRole;
  readonly availability: RelayRoleAvailability;
}

/**
 * One role's staffing, with requested and actual identity kept apart.
 *
 * `actualAgentId` is `null` until a real agent has been observed answering.
 * It is NEVER pre-filled from configuration — a configured adapter is a plan,
 * not a fact, and the field that says who is working must only ever say so
 * because someone watched it happen.
 */
export interface RelayLoopRoleAssignment {
  readonly role: RelayAgentRole;
  /** The adapter the Loop asked for. Always known once resolution succeeds. */
  readonly requestedAdapterId: string | null;
  /** Observed identity. `null` means Unknown — never inferred, never guessed. */
  readonly actualAgentId: string | null;
  readonly actualAdapterId: string | null;
}

/**
 * The resolved target. Carries the whole chain — what was typed, what that
 * normalized to, what the registry could staff, what it could not and why, and
 * who (if anyone) is actually working — so no surface has to reconstruct it
 * and none of them can round a gap up to a claim.
 */
export interface RelayLoopTarget {
  readonly selector: RelayLoopTargetSelector;
  readonly requestedRoles: readonly RelayAgentRole[];
  readonly resolvedRoles: readonly RelayAgentRole[];
  readonly unavailableRoles: readonly RelayLoopUnavailableRole[];
  readonly assignments: readonly RelayLoopRoleAssignment[];
  /** Provenance of the registry observation this resolution stands on. */
  readonly registryProvenance: Provenance | null;
  readonly resolvedAt: string;
}

/* ------------------------------------------------------------- resolution */

function availabilityOf(
  registry: RelayAgentRegistrySnapshot,
  role: RelayAgentRole,
): RelayRoleAvailability {
  return registry.availability[role] ?? 'unknown';
}

/** Deduplicate while preserving first-seen order. */
function unique(roles: readonly RelayAgentRole[]): RelayAgentRole[] {
  const seen = new Set<RelayAgentRole>();
  const out: RelayAgentRole[] = [];
  for (const role of roles) {
    if (seen.has(role)) continue;
    seen.add(role);
    out.push(role);
  }
  return out;
}

/**
 * Expand a target selector into the roles it REQUESTS.
 *
 * `exact_roles` is taken verbatim, including roles the registry cannot staff —
 * dropping them here would erase the user's request before anyone could be
 * told it failed. The unavailable ones surface in `unavailableRoles` instead,
 * which is what produces a truthful blocker rather than a shorter Loop.
 */
export function requestedRolesFor(
  selector: RelayLoopTargetSelector,
  registry: RelayAgentRegistrySnapshot,
): readonly RelayAgentRole[] {
  switch (selector.kind) {
    case 'active_compound_agent':
      return unique(registry.activeCompoundAgentRoles);
    case 'all_eligible_agents':
      return unique(registry.eligibleRoles);
    case 'exact_roles':
      return unique(selector.requestedRoles);
  }
}

/**
 * Resolve a target against one registry observation.
 *
 * PURE and clock-free: `resolvedAt` comes from the snapshot the caller made,
 * not from a clock read here, so the same inputs always produce the same
 * output and a test can pin an instant without faking time.
 */
export function resolveLoopTarget(
  selector: RelayLoopTargetSelector,
  registry: RelayAgentRegistrySnapshot,
): RelayLoopTarget {
  const requestedRoles = requestedRolesFor(selector, registry);
  const resolvedRoles: RelayAgentRole[] = [];
  const unavailableRoles: RelayLoopUnavailableRole[] = [];

  for (const role of requestedRoles) {
    const availability = availabilityOf(registry, role);
    if (availability === ASSIGNABLE_ROLE_AVAILABILITY) resolvedRoles.push(role);
    else unavailableRoles.push({ role, availability });
  }

  return {
    selector,
    requestedRoles,
    resolvedRoles,
    unavailableRoles,
    // Nothing has run yet, so nothing is claimed to be working. Assignments
    // are filled in by the runtime when an agent is actually observed.
    assignments: [],
    registryProvenance: registry.provenance,
    resolvedAt: registry.observedAt,
  };
}

/** Did the target resolve to anyone at all? */
export function targetIsStaffable(target: RelayLoopTarget): boolean {
  return target.resolvedRoles.length > 0;
}

/**
 * Record that a real agent answered for a role.
 *
 * Refuses a role that did not resolve — an agent cannot be "actually working"
 * on a role the registry said was unavailable, and accepting it would let a
 * runtime paper over a resolution bug with a claim.
 */
export function withObservedAssignment(
  target: RelayLoopTarget,
  assignment: RelayLoopRoleAssignment,
): RelayLoopTarget {
  if (!target.resolvedRoles.includes(assignment.role)) return target;
  const others = target.assignments.filter((a) => a.role !== assignment.role);
  return { ...target, assignments: [...others, assignment] };
}
