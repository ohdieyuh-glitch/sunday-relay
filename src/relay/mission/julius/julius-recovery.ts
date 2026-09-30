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
 * WHEN THE ROWS CANNOT TELL, IT IS HELD. A reservation that names no attempt is released only when
 * the task was never handed at all; a handoff that names no attempt holds every reservation.
 *
 * Pure, so the memory store and PostgreSQL take the same decision by the same function.
 * `dispatchedAttempts` holds the attempt each of the task's `worker.dispatched` rows names, or null
 * for one that names none.
 */
export function planJuliusRecoverySettlements(
  open: readonly JuliusOpenReservation[],
  dispatchedAttempts: readonly (number | null)[],
): JuliusRecoverySettlement[] {
  return open.map((reservation) => {
    const handed = dispatchedAttempts.some((attempt) => attempt === null || reservation.attempt === null || attempt === reservation.attempt);
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
