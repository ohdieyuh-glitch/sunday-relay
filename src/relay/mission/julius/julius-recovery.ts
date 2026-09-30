import type { JuliusOperationalEvent } from './julius-events';
import type { JuliusMissionState } from './julius-runtime';

export interface JuliusRecoveryCandidate {
  readonly runId: string;
  readonly projectId: string;
  readonly runState: JuliusMissionState;
  readonly taskId: string;
  /** EXECUTION admissions this task has consumed — not claims. */
  readonly attempt: number;
  readonly maxRetries: number;
  readonly leaseGeneration: number;
  /**
   * How many times recovery has already requeued this task from an expired
   * lease. Additive: omitted behaves exactly as before.
   */
  readonly recoveries?: number;
  /** The ceiling for {@link recoveries}. Omitted means {@link MAX_TASK_RECOVERIES}. */
  readonly maxRecoveries?: number;
  /**
   * WHETHER THIS ATTEMPT WAS HANDED TO A PROVIDER: a durable `worker.dispatched`
   * event exists for the task at its current attempt, and no result was
   * accepted (an accepted result would have ended the lease). Such an attempt
   * may have been PAID FOR, and its answer never reached the record. Additive:
   * omitted behaves exactly as before.
   *
   * KEYED BY ATTEMPT, NOT BY LEASE GENERATION, and that has one conservative
   * consequence (the review of fd588ed4, finding 2, its probe R3). `attempt` is
   * raised only by admission, so between a re-claim and its admission the row
   * still names the PREVIOUS attempt. A task whose handed attempt failed
   * retryably, was re-claimed, and was lost before admission therefore reads as
   * handed, and it is FAILED as HANDED_OUTCOME_UNKNOWN instead of requeued: a
   * spurious mission failure, never a double spend. Keying by the generation
   * (it would have to ride on the handoff's facts) would requeue it; that waits
   * until something needs it. The reservations recovery closes are NOT exposed
   * to this: a reservation is written only after admission, so the attempt it
   * names is its own.
   */
  readonly handed?: boolean;
}

export interface JuliusRecoveryAction {
  readonly action: 'REQUEUE' | 'FAIL_TASK' | 'CANCEL_TASK' | 'RESUME_RUN';
  readonly reasonCode: 'LEASE_EXPIRED' | 'RETRIES_EXHAUSTED' | 'RECOVERY_LIMIT_REACHED' | 'RUN_CANCELLED' | 'RUN_RESUMABLE' | 'HANDED_OUTCOME_UNKNOWN';
  readonly runId: string;
  readonly taskId: string | null;
  readonly expectedLeaseGeneration: number | null;
  /**
   * The reservations this recovery closed for the task, in the order they were opened ((a2) step
   * 2). Written by the store in the same atomic step as the lease change. Present only when there
   * was one to close: omitted means none was open.
   */
  readonly settlements?: readonly JuliusRecoverySettlement[];
}

/* ------------------------------------------------ (a2) step 2: closing what the attempt left open */

/** One reservation a recovered task left open: a `budget.reserved` row with no `budget.settled`. */
export interface JuliusOpenReservation {
  readonly reservationId: string;
  /** The slot the reservation was made for, copied onto the closing row so the two stay one reservation to every reader. */
  readonly role: string | null;
  /** The admission the reservation was made under, when its row names one. */
  readonly attempt: number | null;
}

export interface JuliusRecoverySettlement {
  readonly reservationId: string;
  readonly released: boolean;
  readonly reasonCode: 'RECOVERED_BEFORE_HANDOFF' | 'RECOVERED_HANDED_OUTCOME_UNKNOWN';
}

/**
 * HOW RECOVERY CLOSES A RESERVATION ITS LOST ATTEMPT LEFT OPEN ((a2) step 2).
 *
 * The coordinator writes `budget.reserved`, then `worker.dispatched`, then `budget.settled`. A
 * process that died in between left the reservation open for ever, and the slot ledger, which is
 * projected from those rows, kept charging a dead attempt's hold as outstanding. Each reservation of
 * a recovered task is judged by its OWN attempt:
 *   - no `worker.dispatched` for that attempt: RELEASED. Nothing was sent, and the lease-fenced
 *     handoff (step 1) means nothing can be sent under that attempt any more, because recovery is
 *     clearing its lease in this same step;
 *   - a `worker.dispatched` for it: closed as an UNKNOWN outcome, charged at what it held. It may
 *     have been paid for, and unknown is not free.
 * A HANDOFF THAT NAMES ITS RESERVATION SPEAKS FOR THAT RESERVATION ONLY (the review of 2475bcc1,
 * finding 2). One admission can hold several reservations: a reroute calls the coordinator again
 * under the same claim and the same attempt, and each leg reserves. Matched by attempt alone, the
 * first leg's handoff made a reroute's never-sent reservation read "handed". The coordinator now
 * writes the reservation on the handoff; a handoff that names none (an older build's) falls back to
 * the attempt rule.
 * WHEN THE ROWS CANNOT TELL, IT IS HELD. A reservation that names no attempt is released only when
 * the task was never handed at all; a handoff that names neither holds every reservation.
 *
 * Pure, so the memory store and PostgreSQL take the same decision by the same function.
 * `dispatched` holds, for each of the task's `worker.dispatched` rows, the attempt and the
 * reservation it names, or null for each it does not.
 */
export function planJuliusRecoverySettlements(
  open: readonly JuliusOpenReservation[],
  dispatched: readonly { readonly attempt: number | null; readonly reservationId: string | null }[],
): JuliusRecoverySettlement[] {
  return open.map((reservation) => {
    const handed = dispatched.some((handoff) => (handoff.reservationId !== null
      ? handoff.reservationId === reservation.reservationId
      : handoff.attempt === null || reservation.attempt === null || handoff.attempt === reservation.attempt));
    return handed
      ? { reservationId: reservation.reservationId, released: false, reasonCode: 'RECOVERED_HANDED_OUTCOME_UNKNOWN' }
      : { reservationId: reservation.reservationId, released: true, reasonCode: 'RECOVERED_BEFORE_HANDOFF' };
  });
}

/**
 * THE CLOSING ROW, identical in both stores and shaped as the coordinator's own release: no
 * amount, basis UNKNOWN, `released` the discriminator the slot ledger reads, and the reservation's
 * own role, so a reader grouping by reservation and role sees the two rows as one reservation.
 *
 * ONE ID PER RESERVATION. A recovery that is retried whole rewrites the same event; nothing else
 * writes this id. A LATE coordinator settlement of the same reservation (an attempt whose lease
 * lapsed while it was still alive) keeps its own minted id and lands as a second row. The slot
 * ledger keeps the first; the settlement-integrity check reports the pair.
 */
export function juliusRecoverySettlementEvent(input: {
  readonly runId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly reservation: JuliusOpenReservation;
  readonly settlement: JuliusRecoverySettlement;
  readonly occurredAt: string;
}): JuliusOperationalEvent {
  return {
    eventId: `event:budget.settled:recovered:${input.reservation.reservationId}`,
    runId: input.runId,
    projectId: input.projectId,
    type: 'budget.settled',
    taskId: input.taskId,
    workerId: null,
    correlationId: input.taskId,
    causationId: null,
    occurredAt: input.occurredAt,
    facts: {
      reservationId: input.reservation.reservationId,
      usdMicros: null,
      reason: input.settlement.reasonCode,
      role: input.reservation.role,
      released: input.settlement.released,
      costBasis: 'UNKNOWN',
      estimatedUsdMicros: null,
      attempt: input.reservation.attempt,
      runId: input.runId,
    },
  };
}

/**
 * THE CEILING ON RECOVERY ITSELF, which the execution-attempt counter cannot
 * express.
 *
 * `attempt` counts EXECUTION ADMISSIONS. A task that is claimed, crashes
 * before it is ever admitted, and is recovered leaves that number untouched —
 * correctly, since no worker ran — so recovery bounded only by `attempt` would
 * requeue such a task forever. This is the bound for that loop: how many times
 * recovery has reclaimed this task's expired lease, whatever came of it.
 *
 * The two ceilings are deliberately the same number and deliberately NOT the
 * same counter. Sharing one counter is what made a scheduling hand-back spend
 * a provider retry.
 */
export const MAX_TASK_RECOVERIES = 3;

/** Deterministic recovery plan derived exclusively from durable state. */
export function planJuliusRecovery(candidate: JuliusRecoveryCandidate): JuliusRecoveryAction {
  if (candidate.runState === 'CANCELLED') return { action: 'CANCEL_TASK', reasonCode: 'RUN_CANCELLED', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
  /**
   * A HANDED TASK IS NEVER REQUEUED (the live lane's decision C, 2026-09-29).
   *
   * An expired lease used to be requeued whatever had happened under it. When
   * the attempt had already been handed to a provider, the next claim
   * dispatched the worker AGAIN, and the first answer, paid for, was never
   * recorded: at-least-once, which is paying twice without anyone seeing it.
   * The attempt now ends as what it is, an outcome Julius does not know. The
   * reservation is left held, so the spend stays counted as unknown and never
   * as $0.
   *
   * Checked before the exhaustion ceilings, because it is the fact an operator
   * acts on. The executor takes the same stance for tools
   * (`STARTED_UNKNOWN_OUTCOME`, never replayed blind). Under SUPERVISED
   * autonomy the decision is to PARK the task for a person instead. Until that
   * path exists, the stricter answer applies there too: nothing is requeued.
   */
  if (candidate.handed === true) return { action: 'FAIL_TASK', reasonCode: 'HANDED_OUTCOME_UNKNOWN', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
  if (candidate.attempt >= candidate.maxRetries + 1) return { action: 'FAIL_TASK', reasonCode: 'RETRIES_EXHAUSTED', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
  // The recovery ceiling is checked SECOND so an execution-exhausted task keeps
  // reporting RETRIES_EXHAUSTED, which is the cause an operator acts on; a task
  // that never got to execute reports the loop that actually stopped it.
  if ((candidate.recoveries ?? 0) >= (candidate.maxRecoveries ?? MAX_TASK_RECOVERIES)) {
    return { action: 'FAIL_TASK', reasonCode: 'RECOVERY_LIMIT_REACHED', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
  }
  return { action: 'REQUEUE', reasonCode: 'LEASE_EXPIRED', runId: candidate.runId, taskId: candidate.taskId, expectedLeaseGeneration: candidate.leaseGeneration };
}

export function resumableJuliusState(state: JuliusMissionState): boolean {
  return ['EXECUTING', 'WAITING', 'REVIEWING', 'REPAIRING', 'VERIFYING'].includes(state);
}

/* ------------------------------------ (a2) step 3: a late FREE release after a close */

/** One settlement a reservation already carries, as the store reads it before a new one is written. */
export interface JuliusPriorSettlement {
  readonly eventId: string;
  readonly released: boolean;
  readonly reason: string | null;
}

/**
 * WHAT A NEW SETTLEMENT ROW DOES TO A RESERVATION THAT ALREADY HAS ONE (agreed with JUJU, 2026-09-29).
 *
 * The sweep closes what a lost attempt left open ((a2) step 2), and an attempt whose lease lapsed while
 * it was still ALIVE can then release its own hold late. That second row landed whatever it said, and
 * the settlement-integrity gate failed a bundle in which no money had moved. Suppress only what
 * carries no information, and never hide a disagreement:
 *   - a row that CARRIES COST (not released): always WRITE. Step 3's rule charges the larger.
 *   - a FREE release (released: true) on a reservation with no settlement yet: WRITE.
 *   - a FREE release after closes that were ALL released: SAME_MEANING, not written.
 *   - a FREE release after a close that says money MAY have gone (not released): CONFLICT. Two
 *     readings disagree, and neither is shown false: the sweep read a handoff (so money may have
 *     gone), and the attempt says nothing was sent (a provider can refuse unprocessed after the
 *     handoff). The release is written and a `budget.settlement.conflict` event names both sides, so
 *     the gate reports a conflict rather than a bare duplicate. The slot ledger keeps the hold
 *     charged: a release never outweighs such a close.
 * The store takes this decision under the run-row lock every append takes, so no two writers of one
 * reservation decide at once. Pure, so both stores take it by the same function.
 */
export function juliusLateSettlementDecision(
  settlement: { readonly released: boolean },
  prior: readonly JuliusPriorSettlement[],
): 'WRITE' | 'SAME_MEANING' | 'CONFLICT' {
  if (!settlement.released || prior.length === 0) return 'WRITE';
  return prior.every((row) => row.released) ? 'SAME_MEANING' : 'CONFLICT';
}

/** The event that names a conflict: one per release, and it names the close it disagrees with. */
export function juliusSettlementConflictEvent(input: {
  readonly release: JuliusOperationalEvent;
  readonly prior: readonly JuliusPriorSettlement[];
}): JuliusOperationalEvent {
  const close = input.prior.find((row) => !row.released) ?? input.prior[0];
  return {
    eventId: `event:budget.settlement.conflict:${input.release.eventId}`,
    runId: input.release.runId,
    projectId: input.release.projectId,
    type: 'budget.settlement.conflict',
    taskId: input.release.taskId,
    workerId: input.release.workerId,
    correlationId: input.release.correlationId,
    causationId: input.release.eventId,
    occurredAt: input.release.occurredAt,
    facts: {
      reservationId: typeof input.release.facts.reservationId === 'string' ? input.release.facts.reservationId : null,
      closedAs: close?.reason ?? null,
      closedBy: close?.eventId ?? null,
      releasedAs: typeof input.release.facts.reason === 'string' ? input.release.facts.reason : null,
      runId: input.release.runId,
    },
  };
}
