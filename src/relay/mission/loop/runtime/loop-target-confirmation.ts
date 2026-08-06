/**
 * SUNDAY RELAY — `/loop all`: STAFFING A RESOLVED TARGET WITH RUNS.
 *
 * `resolveLoopTarget` decides WHO. `confirmLoopRun` creates ONE run for one
 * decision. This is the layer between them: a confirmed `/loop all` (or any
 * multi-role target) becomes ONE RUN PER RESOLVED ROLE, all under one Loop.
 * Until now the bridge created a single run and parked the other roles in a
 * side map — a `/loop all` that says "the team is working" while one
 * coding agent runs is exactly the requested-versus-actual collapse the
 * target module's header forbids.
 *
 * WHAT THE FAN-OUT REFUSES.
 *
 * - **To staff anyone resolution did not.** `target.resolvedRoles` is the
 *   whole guest list. Unavailable roles ride along VERBATIM in the report —
 *   including `unknown`, which never staffs, because staffing a Loop on the
 *   strength of a missing answer is how a slot appears to work when nothing
 *   is there.
 * - **To collapse two roles into one decision.** Each role's confirmation
 *   derives its own request id (`<requestId>#<role>`) and therefore its own
 *   idempotency key and its own derived run id. The store's invariant — one
 *   key, one run — stays true, and a retry of the SAME decision converges to
 *   the same runs as duplicates instead of minting a second team.
 * - **To let one role's failure silently cancel the rest.** Each role is
 *   confirmed independently; a failure is reported beside the successes, per
 *   role, by name. Runs already created are NOT rolled back — they are
 *   durable and idempotent, so the honest recovery is a retry that converges,
 *   not a deletion that pretends the spend never happened.
 * - **To pretend N budgets are one.** The budget in the input is PER RUN:
 *   confirming three roles authorizes three of it. The report totals the
 *   authorized spend caps, or says `null` when any cap is unbounded — a team
 *   whose total cannot be bounded must not display a bounded-looking number.
 */

import { RELAY_AGENT_ROLES, type RelayAgentRole } from '../../agent-operating';
import type { RelayLoopTarget, RelayLoopUnavailableRole } from '../loop-target';
import {
  confirmLoopRun,
  loopConfirmationKey,
  type LoopConfirmationInput,
  type LoopOperationDeps,
} from './loop-operations';
import type { RelayLoopRun } from './loop-runtime-types';

/** Everything shared by every role's confirmation. `runId` and the role-scoped
 *  request id are derived per role, so they are deliberately absent. */
export type TargetConfirmationBase = Omit<LoopConfirmationInput, 'runId'>;

export interface TargetConfirmationInput {
  /** The resolution, verbatim from `resolveLoopTarget`. The authority on WHO. */
  readonly target: RelayLoopTarget;
  readonly base: TargetConfirmationBase;
  /**
   * Derive the durable run id from a role-scoped confirmation key. The
   * bridge's discipline, injected: a DERIVED id lands a retry on the same
   * run; a minted one would create a second team on the second delivery.
   */
  readonly runIdFor: (confirmationKey: string) => string;
}

export interface StaffedRole {
  readonly role: RelayAgentRole;
  readonly run: RelayLoopRun;
  /** True when this confirmation had already created the run. */
  readonly duplicate: boolean;
}

export interface FailedRole {
  readonly role: RelayAgentRole;
  readonly status: number;
  readonly kind: string;
  readonly problem: string;
}

export interface TargetConfirmationReport {
  /** One entry per resolved role that now has a run, in resolution order. */
  readonly staffed: readonly StaffedRole[];
  /** Resolved roles whose confirmation failed, each with the store's answer. */
  readonly failed: readonly FailedRole[];
  /** Requested roles resolution could not staff, verbatim — requested versus
   *  actual, preserved rather than trimmed. */
  readonly unstaffed: readonly RelayLoopUnavailableRole[];
  /** How many runs this confirmation authorized (staffed, including
   *  duplicates — a duplicate is an authorization that already existed). */
  readonly runsAuthorized: number;
  /**
   * The SUM of the staffed runs' spend caps, in integer micros — or `null`
   * when any staffed run's cap is unbounded. Unknown is not zero, and an
   * unbounded team total must not render as a bounded number.
   */
  readonly authorizedSpendMicrosTotal: string | null;
}

/** The role-scoped request id: one decision, N roles, N distinct keys. */
export function roleConfirmationRequestId(
  confirmationRequestId: string,
  role: RelayAgentRole,
): string {
  return `${confirmationRequestId}#${role}`;
}

/**
 * Which role a run was CREATED FOR, recovered from its durable idempotency
 * key — the `#role` suffix `roleConfirmationRequestId` wrote there. Making
 * the encoding a stated contract with a decoder is what keeps it from being
 * an accident someone parses anyway.
 *
 * This is the confirmation's INTENT, not an observation: the run's observed
 * role arrives only with `loop.agent_assigned`, and nothing here prefills it.
 * `null` means the key names no known role — a single-role run confirmed
 * before this layer existed, or a tampered suffix — and unknown is not
 * guessed at.
 */
export function staffedRoleOf(run: RelayLoopRun): RelayAgentRole | null {
  const key = run.idempotencyKey;
  const suffixAt = key.lastIndexOf('#');
  if (suffixAt === -1) return null;
  const suffix = key.slice(suffixAt + 1);
  const role = RELAY_AGENT_ROLES.find((r) => r === suffix);
  return role ?? null;
}

/**
 * Staff every resolved role of one confirmed target.
 *
 * Deterministic: roles are processed in resolution order, ids derive from
 * content, and the same input converges to the same report. Total: a failing
 * role is reported, not thrown, and does not stop the roles after it.
 */
export function confirmLoopRunsForTarget(
  deps: LoopOperationDeps,
  input: TargetConfirmationInput,
): TargetConfirmationReport {
  const staffed: StaffedRole[] = [];
  const failed: FailedRole[] = [];

  for (const role of input.target.resolvedRoles) {
    const confirmationRequestId = roleConfirmationRequestId(
      input.base.confirmationRequestId,
      role,
    );
    const key = loopConfirmationKey({
      principal: input.base.principal,
      workspaceId: input.base.workspaceId,
      projectId: input.base.projectId,
      contractBindingDigest: input.base.contractBindingDigest,
      confirmationRequestId,
    });
    const outcome = confirmLoopRun(deps, {
      ...input.base,
      confirmationRequestId,
      runId: input.runIdFor(key),
    });
    if (outcome.ok) {
      staffed.push({ role, run: outcome.run, duplicate: outcome.duplicate });
    } else {
      failed.push({
        role, status: outcome.status, kind: outcome.kind, problem: outcome.problem,
      });
    }
  }

  return {
    staffed,
    failed,
    unstaffed: input.target.unavailableRoles,
    runsAuthorized: staffed.length,
    authorizedSpendMicrosTotal: totalSpendCap(staffed),
  };
}

/** Integer-micros sum of spend caps; `null` the moment any cap is unbounded. */
function totalSpendCap(staffed: readonly StaffedRole[]): string | null {
  let total = 0n;
  for (const { run } of staffed) {
    const cap = run.budget.maxSpendMicros;
    if (cap === null) return null;
    total += BigInt(cap);
  }
  return total.toString();
}
