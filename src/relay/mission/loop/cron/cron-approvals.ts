/**
 * SUNDAY RELAY — WHAT A SCHEDULE IS ACTUALLY ALLOWED TO DO.
 *
 * CRON_LOOPS.md: "Creating a schedule does **not** grant permanent approval
 * to every future operation. Seven approval scopes are distinguished […] A
 * recurring grant is time-limited **and** argument-scoped."
 *
 * The sentence this module exists to make true is the first one. A schedule
 * is a standing instruction to act unattended, and the tempting
 * implementation treats the act of creating it as consent to everything it
 * later does. That is how a nightly "inspect issues" job ends up merging pull
 * requests: not by a bug, but by an approval nobody scoped.
 *
 * FOUR REFUSALS.
 *
 * - **A grant covers ONE scope.** Schedule creation is its own scope and
 *   grants no operation at all. A grant for read-only recurring work does not
 *   authorize an external write, and a grant for one external write does not
 *   authorize recurring ones — "one" and "recurring" are separate scopes in
 *   the spec precisely because the second is the dangerous one.
 * - **A recurring grant is TIME-LIMITED.** No expiry means no grant. Not "no
 *   expiry means forever": a grant that never ends is the permanent approval
 *   the spec's first sentence denies, so its absence is a configuration
 *   defect rather than a generous default.
 * - **A recurring grant is ARGUMENT-SCOPED.** It authorizes the arguments it
 *   names and no others. An operation whose arguments the grant does not
 *   cover is a different operation, however similar it looks.
 * - **Deployment needs three things**, all of them: deployment authority, a
 *   rollback policy, and approval. The spec lists them together, and any one
 *   missing means Relay "may prepare a deployment" and no more.
 *
 * UNKNOWN IS NOT GRANTED. Every check that cannot be evaluated refuses. This
 * is an authority boundary, and the whole repository's habit at an unknown is
 * to fail closed.
 */

import { readIsoInstantWithOffset } from '../runtime/loop-scheduler';

/** The seven scopes, verbatim from CRON_LOOPS.md and in its order. */
export const CRON_APPROVAL_SCOPES = [
  'schedule_creation',
  'read_only_recurring_work',
  'one_external_write',
  'recurring_external_writes',
  'deployment',
  'financial_operations',
  'credential_access',
] as const;
export type CronApprovalScope = (typeof CRON_APPROVAL_SCOPES)[number];

/**
 * Scopes whose grants MUST be time-limited and argument-scoped: the ones that
 * authorize repeated unattended action. `one_external_write` is deliberately
 * absent — it authorizes a single act, and is consumed by performing it.
 */
export const RECURRING_SCOPES: readonly CronApprovalScope[] = [
  'read_only_recurring_work',
  'recurring_external_writes',
  'deployment',
  'financial_operations',
  'credential_access',
];

export interface ApprovalGrant {
  readonly scope: CronApprovalScope;
  /** When it stops authorizing. `null` is NOT "forever" — see the header. */
  readonly expiresAt: string | null;
  /**
   * The exact arguments this grant covers. An operation whose arguments are
   * not all listed here is a different operation.
   */
  readonly argumentScope: readonly string[];
  /** True once a single-act grant has been used. */
  readonly consumed?: boolean;
}

export interface OperationRequest {
  readonly scope: CronApprovalScope;
  /** The arguments this operation would actually act on. */
  readonly arguments: readonly string[];
  /** ISO-8601 with explicit offset. The server's clock, never the caller's
   *  wish. */
  readonly at: string;
}

/** Everything the deployment scope additionally requires, all three. */
export interface DeploymentAuthority {
  readonly hasDeploymentAuthority: boolean;
  readonly hasRollbackPolicy: boolean;
  readonly hasApproval: boolean;
}

export type ApprovalRefusalReason =
  | 'no_grant_for_scope'
  | 'schedule_creation_grants_no_operation'
  | 'grant_expired'
  | 'recurring_grant_without_expiry'
  | 'arguments_outside_grant'
  | 'single_act_grant_already_consumed'
  | 'deployment_prerequisites_missing'
  | 'unreadable_clock'
  | 'unreadable_expiry';

export type ApprovalDecision =
  | { readonly ok: true; readonly grant: ApprovalGrant }
  | {
      readonly ok: false;
      readonly reason: ApprovalRefusalReason;
      readonly problem: string;
    };

/**
 * May this scheduled operation proceed?
 *
 * Pure and total. Every refusal names itself, and there is no partial
 * authorization: an operation is permitted or it is not.
 */
export function authorizeScheduledOperation(input: {
  readonly request: OperationRequest;
  readonly grants: readonly ApprovalGrant[];
  /** Required only when the request's scope is `deployment`. */
  readonly deployment?: DeploymentAuthority;
}): ApprovalDecision {
  const nowMs = readIsoInstantWithOffset(input.request.at);
  if (nowMs === null) {
    return {
      ok: false,
      reason: 'unreadable_clock',
      problem: 'The operation instant must be ISO-8601 with an explicit UTC offset. Without a '
        + 'readable clock no expiry can be checked, and an unchecked expiry is a permanent grant.',
    };
  }

  // CREATING A SCHEDULE AUTHORIZES NOTHING IT LATER DOES. The scope exists so
  // that consent to create is recordable — not so it can be spent on work.
  if (input.request.scope === 'schedule_creation') {
    return {
      ok: false,
      reason: 'schedule_creation_grants_no_operation',
      problem: 'schedule_creation is the approval to CREATE a schedule; it authorizes no operation '
        + 'the schedule later performs. Creating a schedule does not grant permanent approval to '
        + 'every future operation.',
    };
  }

  // A grant covers ONE scope. No widening, no implication: a read-only grant
  // does not become a write grant because the work looked similar.
  const grant = input.grants.find((g) => g.scope === input.request.scope);
  if (grant === undefined) {
    return {
      ok: false,
      reason: 'no_grant_for_scope',
      problem: `No approval grant exists for ${input.request.scope}. A grant for another scope does `
        + 'not widen to cover this one.',
    };
  }

  if (RECURRING_SCOPES.includes(grant.scope)) {
    if (grant.expiresAt === null) {
      return {
        ok: false,
        reason: 'recurring_grant_without_expiry',
        problem: `The ${grant.scope} grant has no expiry. A recurring grant is time-limited; an `
          + 'endless one is exactly the permanent approval that creating a schedule does not give.',
      };
    }
    const expiryMs = readIsoInstantWithOffset(grant.expiresAt);
    if (expiryMs === null) {
      return {
        ok: false,
        reason: 'unreadable_expiry',
        problem: `The ${grant.scope} grant's expiry is not an ISO-8601 instant with an explicit `
          + 'offset, so it cannot be shown to be unexpired.',
      };
    }
    if (nowMs >= expiryMs) {
      return {
        ok: false,
        reason: 'grant_expired',
        problem: `The ${grant.scope} grant expired at ${grant.expiresAt}.`,
      };
    }
  } else if (grant.consumed === true) {
    // A single-act grant authorizes one act. Performing it spends it.
    return {
      ok: false,
      reason: 'single_act_grant_already_consumed',
      problem: `The ${grant.scope} grant authorized a single act and has already been used.`,
    };
  }

  // ARGUMENT-SCOPED. Every argument the operation would act on must be named
  // by the grant; an unnamed one makes it a different operation.
  const uncovered = input.request.arguments
    .filter((argument) => !grant.argumentScope.includes(argument));
  if (uncovered.length > 0) {
    return {
      ok: false,
      reason: 'arguments_outside_grant',
      problem: `The ${grant.scope} grant does not cover: ${uncovered.join(', ')}. A recurring grant `
        + 'is argument-scoped, and an operation on arguments it never named is a different '
        + 'operation.',
    };
  }

  // DEPLOYMENT NEEDS ALL THREE. "It may prepare a deployment. It may not
  // deploy without deployment authority, rollback policy and approval."
  if (input.request.scope === 'deployment') {
    const d = input.deployment;
    const missing = d === undefined
      ? ['deployment authority', 'rollback policy', 'approval']
      : [
        ...(d.hasDeploymentAuthority ? [] : ['deployment authority']),
        ...(d.hasRollbackPolicy ? [] : ['rollback policy']),
        ...(d.hasApproval ? [] : ['approval']),
      ];
    if (missing.length > 0) {
      return {
        ok: false,
        reason: 'deployment_prerequisites_missing',
        problem: `Deploying needs deployment authority, a rollback policy and approval; missing: `
          + `${missing.join(', ')}. Relay may PREPARE a deployment without them and no more.`,
      };
    }
  }

  return { ok: true, grant };
}
