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
 *
 * AND NO GRANT REACHES PAST A STOP ACTION. Some scopes name work that
 * `AUTONOMOUS_STOP_ACTIONS` stops in EVERY mode — a financial commitment, a
 * secret export, a new credential. UNCHAIN.md is explicit that unattended
 * agents run under those same seventeen, and mode policy is a ceiling, not a
 * thing an approval raises. The first version of this module never consulted
 * the list at all: a `financial_operations` grant authorized a wire transfer
 * outright. Review found it, and it is exactly the authority expansion every
 * module here exists to refuse.
 */

import type { BoundaryAction } from '../../modes';
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
 * absent — it authorizes a single act. Recording that the act happened is the
 * CALLER's job; this module is pure and marks nothing (see `consumesGrant`).
 */
export const RECURRING_SCOPES: readonly CronApprovalScope[] = [
  'read_only_recurring_work',
  'recurring_external_writes',
  'deployment',
  'financial_operations',
  'credential_access',
];

/**
 * Scopes whose work is stopped in every mode by the boundary list, and the
 * action each one runs into. An approval grant records that a human WANTED
 * the work; it does not lift a stop that applies to Autonomous itself.
 */
export const SCOPE_STOP_ACTIONS: Readonly<Partial<Record<CronApprovalScope, BoundaryAction>>> =
  Object.freeze({
    financial_operations: 'new_financial_commitment',
    credential_access: 'secret_export',
  });

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
  | 'unknown_scope'
  | 'ambiguous_grants_for_scope'
  | 'operation_names_no_arguments'
  | 'stopped_by_boundary_action'
  | 'schedule_creation_grants_no_operation'
  | 'grant_expired'
  | 'recurring_grant_without_expiry'
  | 'arguments_outside_grant'
  | 'single_act_grant_already_consumed'
  | 'deployment_prerequisites_missing'
  | 'unreadable_clock'
  | 'unreadable_expiry';

export type ApprovalDecision =
  | {
      readonly ok: true;
      readonly grant: ApprovalGrant;
      /**
       * True when this grant authorized a SINGLE act and the caller must now
       * record it as consumed. This module is pure and marks nothing —
       * review found the code and its comments claiming a grant was "spent by
       * use" when nothing anywhere spent it, so the obligation is returned
       * instead of asserted.
       */
      readonly consumesGrant: boolean;
    }
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

  if (!CRON_APPROVAL_SCOPES.includes(input.request.scope)) {
    // An unrecognized scope previously fell through to the SINGLE-ACT branch,
    // which requires no expiry — the most permissive path in the module,
    // reached by the least trustworthy input.
    return {
      ok: false,
      reason: 'unknown_scope',
      problem: `"${input.request.scope}" is not one of the seven approval scopes. An unrecognized `
        + 'scope is refused rather than handled by whichever branch it happens to fall into.',
    };
  }

  // AN OPERATION MUST NAME WHAT IT ACTS ON. With no arguments the scope check
  // below is vacuously satisfied, so "no arguments" and "arguments not
  // extracted" become indistinguishable — and the second one grants
  // everything. Review found this permitting a wire transfer.
  if (input.request.arguments.length === 0) {
    return {
      ok: false,
      reason: 'operation_names_no_arguments',
      problem: 'The operation names no arguments, so it cannot be shown to fall inside any '
        + 'argument-scoped grant. An unstated argument is not an absent one.',
    };
  }

  // A grant covers ONE scope. No widening, no implication: a read-only grant
  // does not become a write grant because the work looked similar.
  const matching = input.grants.filter((g) => g.scope === input.request.scope);
  if (matching.length > 1) {
    // Order decided the answer before: [expired, valid] refused and
    // [valid, expired] permitted. cron-versioning refuses exactly this
    // ambiguity, and an authority decision may not be the looser one.
    return {
      ok: false,
      reason: 'ambiguous_grants_for_scope',
      problem: `${matching.length} grants exist for ${input.request.scope}. Which one applies would `
        + 'be decided by array order, and an authority decision is not settled by ordering.',
    };
  }
  const grant = matching[0];
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
  } else {
    if (grant.consumed === true) {
      // A single-act grant authorizes one act, and the caller records that it
      // was used — see `consumesGrant` on the permitted decision.
      return {
        ok: false,
        reason: 'single_act_grant_already_consumed',
        problem: `The ${grant.scope} grant authorized a single act and has already been used.`,
      };
    }
    // A single-act grant needs no expiry, but one it DOES carry is honoured.
    // Review found an expired single-act grant authorizing in 2026 because
    // the whole branch skipped the expiry check.
    if (grant.expiresAt !== null) {
      const expiryMs = readIsoInstantWithOffset(grant.expiresAt);
      if (expiryMs === null) {
        return {
          ok: false,
          reason: 'unreadable_expiry',
          problem: `The ${grant.scope} grant carries an expiry that is not an ISO-8601 instant with `
            + 'an explicit offset, so it cannot be shown to be unexpired.',
        };
      }
      if (nowMs >= expiryMs) {
        return {
          ok: false,
          reason: 'grant_expired',
          problem: `The ${grant.scope} grant expired at ${grant.expiresAt}.`,
        };
      }
    }
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

  // NO GRANT REACHES PAST A STOP ACTION. Checked last so an operation that
  // would be refused anyway is refused for its own reason first, and so the
  // stop is reported as the final, unliftable one.
  const stopAction = SCOPE_STOP_ACTIONS[input.request.scope];
  if (stopAction !== undefined) {
    return {
      ok: false,
      reason: 'stopped_by_boundary_action',
      problem: `${input.request.scope} runs into "${stopAction}", which stops execution in EVERY `
        + 'mode including Autonomous. An approval records that a human wanted the work; it does not '
        + 'lift a boundary stop, and a schedule acting unattended runs under the same list.',
    };
  }

  return {
    ok: true,
    grant,
    // The obligation, returned rather than performed: this module is pure and
    // marks nothing consumed.
    consumesGrant: !RECURRING_SCOPES.includes(grant.scope),
  };
}
