/**
 * SUNDAY RELAY — THE TRUTHFUL BLOCKER MODEL.
 *
 * THE INVARIANT, stated exactly as the founder directive states it:
 *
 *   No eligible slot is idle while useful runnable work exists unless Relay
 *   can produce a real blocker, or determine that additional parallel work
 *   would be unsafe or useless.
 *
 * Note what is NOT claimed: maximum utilization is not guaranteed and is not
 * mathematically provable. What IS enforceable — and is enforced here by
 * construction — is the right-hand side: an idle slot must carry a blocker,
 * and a blocker must come from something real.
 *
 * HOW "REAL" IS ENFORCED. A `RelayLoopBlocker` has no public constructor that
 * takes a free-text reason. It can be built in exactly two ways:
 *
 *   1. `blockersFromEligibility` — from FAILED checks in the existing
 *      pre-execution battery (`coordination/eligibility.ts`), carrying that
 *      check's own id and detail verbatim;
 *   2. `runtimeBlocker` — from one of a closed set of explicitly modelled
 *      runtime conditions the battery does not cover (a role the registry
 *      cannot staff, a disabled feature flag, an unreachable provider).
 *
 * A UI cannot invent a third. That is the whole design.
 *
 * WHY THIS FILE DOES NOT IMPORT `coordination`. The mission layer is a pure
 * leaf projection and a structural test forbids it. So the domain declares the
 * SHAPE it needs (`RelayEligibilityCheckLike`, which is structurally
 * `EligibilityCheck`) and a composition root passes the real value —
 * the same inversion the repository already uses when a connector needs a
 * domain type. `loop-blockers.test.ts`, which IS allowed to import both,
 * proves the two shapes cannot drift apart.
 */

import type { RelayAgentRole } from '../agent-operating';
import type { RelayRoleAvailability } from './loop-target';

/* --------------------------------------------------------------- reasons */

/**
 * Every state a slot may sit in without working. Closed set: a condition that
 * is not here cannot be rendered, which is what keeps "waiting" from becoming
 * a place to hide an unexplained pause.
 */
export const RELAY_LOOP_BLOCKER_REASONS = [
  'waiting_dependency',
  'waiting_approval',
  'waiting_evidence',
  'waiting_checkpoint',
  'budget_blocked',
  'rate_limited',
  'missing_model',
  'missing_tool',
  'unavailable_role',
  'workspace_conflict',
  'file_ownership_conflict',
  'provider_unavailable',
  'feature_disabled',
  'duplicate_work_suppressed',
  'unknown_blocker',
] as const;
export type RelayLoopBlockerReason = (typeof RELAY_LOOP_BLOCKER_REASONS)[number];

/**
 * Where a blocker came from. A surface may show this, and a reviewer may
 * assert on it: an `eligibility` blocker is backed by a named check that
 * actually ran, a `runtime` blocker by a modelled condition, and there is no
 * third source.
 */
export const RELAY_LOOP_BLOCKER_SOURCES = ['eligibility', 'runtime'] as const;
export type RelayLoopBlockerSource = (typeof RELAY_LOOP_BLOCKER_SOURCES)[number];

export interface RelayLoopBlocker {
  readonly reason: RelayLoopBlockerReason;
  readonly source: RelayLoopBlockerSource;
  /**
   * The originating check id, verbatim, when the source is the eligibility
   * battery (`budget-permits`, `dependencies-satisfied`, …). `null` for a
   * runtime condition, which has no check to point at.
   */
  readonly checkId: string | null;
  /** The originating detail, verbatim. Never re-worded, never embellished. */
  readonly detail: string;
  /** What the caller must do, when the battery says. `null` when nothing the
   *  user does would help — waiting on a dependency is not a user action. */
  readonly requiredUserAction: string | null;
  readonly slotId: string | null;
  readonly observedAt: string;
}

/* --------------------------------------------------- the eligibility port */

/**
 * Structurally `EligibilityCheck` from `coordination/eligibility.ts`, declared
 * here so the mission layer needs no import of it. If that type changes, the
 * assignability test in `loop-blockers.test.ts` fails and this must follow.
 */
export interface RelayEligibilityCheckLike {
  readonly id: string;
  readonly ok: boolean;
  readonly onFailure: 'denied' | 'checkpoint_required' | 'blocked';
  readonly detail: string;
}

/** Structurally the parts of `DispatchEligibilityResult` a blocker needs. */
export interface RelayEligibilityResultLike {
  readonly outcome: 'eligible' | 'denied' | 'checkpoint_required' | 'blocked';
  readonly failedChecks: readonly RelayEligibilityCheckLike[];
  readonly requiredUserActions: readonly string[];
}

/**
 * THE MAP from the battery's check ids to blocker reasons.
 *
 * Every id here is a real check emitted by `evaluateDispatchEligibility`.
 * `loop-blockers.test.ts` asserts that this table's keys are a SUBSET of the
 * ids the real battery can produce, so a typo cannot create a reason that
 * never fires, and a renamed check cannot silently stop mapping.
 *
 * An id with no entry maps to `unknown_blocker` and keeps its detail — which
 * is still truthful (a real check failed, and here is what it said) and is far
 * better than dropping it.
 */
export const RELAY_ELIGIBILITY_BLOCKER_REASONS: Readonly<Record<string, RelayLoopBlockerReason>> =
  Object.freeze({
    'dependencies-satisfied': 'waiting_dependency',
    'no-open-checkpoint': 'waiting_checkpoint',
    'no-duplicate-work': 'duplicate_work_suppressed',
    'budget-permits': 'budget_blocked',
    'file-claims-clear': 'file_ownership_conflict',
    'resource-claims-clear': 'workspace_conflict',
    'base-revision-current': 'workspace_conflict',
    'handoff-valid': 'waiting_evidence',
    'context-current': 'waiting_evidence',
    'ledger-current': 'waiting_evidence',
    'task-owned': 'unavailable_role',
    'lease-valid': 'unavailable_role',
    'assignment-matches': 'unavailable_role',
  });

/**
 * Project a Loop's blockers from ONE real eligibility evaluation.
 *
 * Only FAILED checks become blockers. An eligible result produces an empty
 * array, which is the honest answer: nothing is blocking, so if the slot is
 * still idle that is a scheduler bug and the watchdog should say so rather
 * than a blocker pretending otherwise.
 */
export function blockersFromEligibility(
  result: RelayEligibilityResultLike,
  context: { readonly slotId?: string | null; readonly observedAt: string },
): readonly RelayLoopBlocker[] {
  const slotId = context.slotId ?? null;
  // The battery emits one required action per checkpoint-required check, in
  // the same order, so they are matched positionally rather than re-derived.
  const actions = [...result.requiredUserActions];
  return result.failedChecks.map((check) => {
    const requiredUserAction =
      check.onFailure === 'checkpoint_required' ? (actions.shift() ?? null) : null;
    return {
      reason: RELAY_ELIGIBILITY_BLOCKER_REASONS[check.id] ?? 'unknown_blocker',
      source: 'eligibility' as const,
      checkId: check.id,
      detail: check.detail,
      requiredUserAction,
      slotId,
      observedAt: context.observedAt,
    };
  });
}

/* ------------------------------------------------------ runtime blockers */

/**
 * Conditions the pre-execution battery cannot see, because they are true
 * BEFORE there is a dispatch to evaluate. Each is explicitly modelled, and
 * this union is the only way to build one.
 */
export type RelayLoopRuntimeCondition =
  | { readonly kind: 'unavailable_role'; readonly role: RelayAgentRole; readonly availability: RelayRoleAvailability }
  | { readonly kind: 'feature_disabled'; readonly feature: string; readonly detail: string }
  | { readonly kind: 'provider_unavailable'; readonly provider: string; readonly detail: string }
  | { readonly kind: 'missing_model'; readonly role: RelayAgentRole; readonly detail: string }
  | { readonly kind: 'missing_tool'; readonly tool: string; readonly detail: string }
  | { readonly kind: 'rate_limited'; readonly provider: string; readonly detail: string }
  | { readonly kind: 'budget_blocked'; readonly detail: string }
  | { readonly kind: 'waiting_approval'; readonly detail: string; readonly requiredUserAction: string };

const AVAILABILITY_DETAIL: Readonly<Record<RelayRoleAvailability, string>> = Object.freeze({
  available: 'is available',
  not_configured: 'is not configured for this project',
  not_connected: 'is configured but not connected',
  entitlement_locked: 'is not included in the current entitlement',
  unknown: 'has an unknown availability, which never counts as available',
});

/** Build a blocker from one explicitly modelled runtime condition. */
export function runtimeBlocker(
  condition: RelayLoopRuntimeCondition,
  context: { readonly slotId?: string | null; readonly observedAt: string },
): RelayLoopBlocker {
  const slotId = context.slotId ?? null;
  const base = { source: 'runtime' as const, checkId: null, slotId, observedAt: context.observedAt };

  switch (condition.kind) {
    case 'unavailable_role':
      return {
        ...base,
        reason: 'unavailable_role',
        detail: `The ${condition.role} role ${AVAILABILITY_DETAIL[condition.availability]}.`,
        requiredUserAction:
          condition.availability === 'not_configured' || condition.availability === 'entitlement_locked'
            ? `Configure or enable the ${condition.role} role before this Loop can staff it.`
            : null,
      };
    case 'feature_disabled':
      return {
        ...base,
        reason: 'feature_disabled',
        detail: condition.detail,
        requiredUserAction: `Enable ${condition.feature} before this Loop can run.`,
      };
    case 'waiting_approval':
      return {
        ...base,
        reason: 'waiting_approval',
        detail: condition.detail,
        requiredUserAction: condition.requiredUserAction,
      };
    case 'provider_unavailable':
      return { ...base, reason: 'provider_unavailable', detail: condition.detail, requiredUserAction: null };
    case 'missing_model':
      return { ...base, reason: 'missing_model', detail: condition.detail, requiredUserAction: null };
    case 'missing_tool':
      return { ...base, reason: 'missing_tool', detail: condition.detail, requiredUserAction: null };
    case 'rate_limited':
      return { ...base, reason: 'rate_limited', detail: condition.detail, requiredUserAction: null };
    case 'budget_blocked':
      return { ...base, reason: 'budget_blocked', detail: condition.detail, requiredUserAction: null };
  }
}

/** Every unavailable role in a resolved target, as blockers. */
export function blockersForUnavailableRoles(
  unavailable: readonly { readonly role: RelayAgentRole; readonly availability: RelayRoleAvailability }[],
  context: { readonly slotId?: string | null; readonly observedAt: string },
): readonly RelayLoopBlocker[] {
  return unavailable.map((entry) =>
    runtimeBlocker({ kind: 'unavailable_role', role: entry.role, availability: entry.availability }, context),
  );
}
