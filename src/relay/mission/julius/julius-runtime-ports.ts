/**
 * THE PORTS THE JULIUS RUNTIME DEPENDS ON.
 *
 * WHY THESE EXIST. The inherited stack (#170–#179) built strong components —
 * a scheduler claim with real leases, a policy evaluator, a provider router, a
 * context compiler, a verification evaluator, a repair planner, idempotent
 * evidence and result acceptance, an event ledger with an outbox. An audit of
 * merged main found that NOTHING CALLED ANY OF THEM outside their own tests:
 * every capability existed and no capability was reached. What was missing was
 * not another mechanism but the application runtime that composes them.
 *
 * A runtime that referenced `JuliusPostgresRepository` directly would drag
 * `pg` — and a live database — into every test of the composition, which is
 * the reason the composition never got written. So the runtime depends on
 * these NARROW ports instead. Two things implement them: the Postgres
 * repositories, which already have these shapes (a conformance test in
 * `src/relay/persistence` holds them to it, and lives there because only that
 * layer may import type { JuliusMemoryClaim } from './julius-memory-trust';
import both sides), and a deterministic in-memory store that
 * models the same semantics precisely enough to prove concurrency, recovery
 * and idempotency invariants without a database.
 *
 * THE DEPENDENCY DIRECTION IS FIXED. `persistence` imports from
 * `mission/julius`; `mission/julius` never imports from `persistence`. These
 * interfaces are declared here, on the domain side, so that stays true.
 *
 * NOTE ON PURITY: this directory is deliberately NOT browser-safe — the
 * mission barrel does not re-export it and `julius-context-snapshot.ts`
 * already reaches for `node:crypto`. These ports are still free of `pg`, of
 * the network and of the clock; time and identity arrive through
 * {@link JuliusClock} and {@link JuliusIdFactory}.
 */

import type {
  JuliusEvidence,
  JuliusMissionState,
  JuliusRecordedDecision,
  JuliusTask,
  JuliusVerificationDecision,
  JuliusWorkerRole,
} from './julius-runtime';
import type { JuliusMemoryClaim } from './julius-memory-trust';
import type { JuliusOperationalEvent } from './julius-events';
import type { JuliusRecoveryAction } from './julius-recovery';
import type { JuliusReviewerFinding, JuliusAcceptanceCriterion } from './julius-verification-runtime';
import type { JuliusContextSnapshot } from './julius-context-snapshot';
import type { JuliusTrajectoryEvent } from './julius-trajectory';
import type { JuliusBrainEntry } from './julius-runtime';
import type { JuliusTaskContract, JuliusTaskContractBinding } from './julius-task-contract';

/* ------------------------------------------------------- ambient services */

/** The clock, injected. Nothing under `mission/` reads a real one. */
export interface JuliusClock { now(): string; }

/**
 * Identity, injected for the same reason the clock is: a runtime that minted
 * its own random ids could not be replayed, and replay is how every recovery
 * and idempotency test in this file set works.
 */
export interface JuliusIdFactory { next(kind: string): string; }

/* --------------------------------------------------------- the run record */

/**
 * Structurally identical to `JuliusRunRecord` in `julius-postgres.ts`, and
 * deliberately declared again rather than imported: importing it would make
 * this module depend on `pg`. `julius-store-conformance.test.ts` in the
 * persistence layer assigns one to the other, so the two cannot drift without
 * failing a compile.
 */
export interface JuliusRunRow {
  readonly runId: string;
  readonly missionId: string;
  readonly projectId: string;
  readonly state: JuliusMissionState;
  readonly cardRevision: string;
  readonly missionContractRevision: number;
  readonly projectBrainRevision: number;
  readonly version: number;
}

/** Structurally identical to `ClaimedJuliusTask` in `julius-postgres.ts`. */
export interface JuliusClaimedTask {
  readonly taskId: string;
  readonly runId: string;
  readonly role: string;
  readonly taskType: string;
  /** Scheduling ownership: incremented by EVERY claim, hand-backs included. */
  readonly leaseGeneration: number;
  /**
   * EXECUTION attempts this task has consumed, which a claim does not change.
   * As handed back by `claimRunnable` this is the count BEFORE this claim;
   * `admitTask` returns the value to run under.
   */
  readonly attempt: number;
}

/**
 * An admission the RUN refused, not the lease: the run was held (paused,
 * blocked, terminal, or holding a PENDING or DENIED approval) when the attempt
 * would have been spent. Nothing was spent, and the caller still holds the lease.
 */
export interface JuliusAdmissionHeld {
  readonly held: true;
  readonly runState: JuliusMissionState;
  readonly pendingApprovals: number;
  readonly deniedApprovals: number;
}

/** Structurally identical to `JuliusResultReceipt`. */
export interface JuliusResultReceiptRow {
  readonly recorded: boolean;
  readonly duplicate: boolean;
  readonly taskState: string;
}

/* ------------------------------------------------------------ write ports */

export interface JuliusRunWriter {
  loadRun(runId: string, projectId: string): Promise<JuliusRunRow | null>;
  transition(input: {
    commandId: string; runId: string; projectId: string; expectedVersion: number;
    to: JuliusMissionState; reasonCode: string; safeSummary: string;
    evidenceIds: readonly string[]; occurredAt: string;
  }): Promise<JuliusRunRow>;
  addTask(input: {
    commandId: string; runId: string; projectId: string; task: JuliusTask;
  }): Promise<boolean>;
  claimRunnable(input: {
    owner: string; now: string; leaseExpiresAt: string; limit: number; projectId?: string;
  }): Promise<JuliusClaimedTask[]>;
  /**
   * ADMIT A CLAIMED TASK INTO EXECUTION, consuming one execution attempt.
   *
   * THE CLAIM IS NOT THE ATTEMPT. `claimRunnable` takes scheduling ownership,
   * and the scheduler may then decide NOT to run the task — the run's C.A.R.D.
   * concurrency allowance is already spent, or the per-run fairness share is —
   * and hand it straight back. While the claim incremented `attempt`, those
   * hand-backs spent provider retries that no provider ever saw: a task yielded
   * twice arrived at its FIRST real dispatch on attempt 3 of 3, and a rate
   * limit there was refused as exhausted.
   *
   * So the attempt is consumed HERE, once the scheduler has decided to run the
   * task and before any provider-capable work begins. It is one atomic write
   * conditioned on the same lease the caller holds, which is what makes the
   * crash semantics honest in both directions: a crash after this point has
   * spent an attempt, because a worker may genuinely have been dispatched; a
   * crash before it has spent none, because nothing could have been.
   *
   * Returns the NEW execution attempt, or null when the lease has moved on —
   * the caller no longer owns the task and must not run it or finish it.
   *
   * AND THE LAST GOVERNANCE CHECK BEFORE MONEY. The dispatch boundary read the
   * run and its approvals before the context was compiled and the contract
   * checked; a pause, an approval gate or a denial committed in between was
   * never seen, and the provider was called for a run its operator had just
   * paused. So admission re-reads them in the same atomic write, and a run that
   * may not start new work (`JULIUS_CLAIMABLE_RUN_STATES`, and no PENDING or
   * DENIED approval, exactly as the claim) answers `JuliusAdmissionHeld`:
   * nothing is spent, and the caller still owns the task and must hand it back
   * or end it.
   */
  admitTask(input: {
    taskId: string; owner: string; leaseGeneration: number; now: string;
  }): Promise<number | null | JuliusAdmissionHeld>;
  heartbeat(input: {
    taskId: string; owner: string; leaseGeneration: number; now: string; leaseExpiresAt: string;
  }): Promise<boolean>;
  finishTask(input: {
    taskId: string; owner: string; leaseGeneration: number;
    /**
     * `SKIPPED` is how a task ends when its work was SUPERSEDED rather than
     * done or abandoned — the one producer is a content refusal that Julius
     * re-planned into a continuation segment. It is the only terminal state
     * besides SUCCEEDED that `missionMayComplete` accepts, which is exactly
     * why it may never be reached by any path that has not put the work
     * somewhere else.
     */
    state: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'SKIPPED'; now: string; nextAttemptAt?: string;
  }): Promise<boolean>;
  appendEvidence(input: {
    runId: string; projectId: string; idempotencyKey: string; evidence: JuliusEvidence;
  }): Promise<boolean>;
  /**
   * THE DECISION, ITS RELEASE, AND THE HISTORY THAT EXPLAINS BOTH ARE ONE
   * WRITE.
   *
   * `releaseTaskIds` names BLOCKED tasks this decision satisfies (computed by
   * `evaluateJuliusRelease`); they become RUNNABLE in the same durable write
   * as the decision, so no crash can leave an accepted plan with a build that
   * nothing will ever release, or a released build with no decision behind it.
   * A duplicate decision (idempotency conflict) moves nothing: the write that
   * recorded it first already did. Only Julius calls this, and the claim query
   * offers RUNNABLE tasks alone, so this is the only path from BLOCKED to
   * claimable.
   *
   * `events` ARE PART OF THAT SAME WRITE, for the reason the release is. They
   * used to be appended after it returned, which left a window a crash could
   * fall into: the decision stood, the release stood, and the events that
   * explain them were lost — permanently, because the resume sweep skips a
   * task that already has a decision, so nothing ever wrote them again. The
   * run's history then could not say that a verification was decided or that a
   * task became runnable, while the rows those events describe stood. The
   * behaviour was right and the record was wrong, which is the failure a
   * ledger exists to prevent.
   *
   * They are written ONLY when this call recorded the decision. A duplicate
   * wrote them the first time, and writing them again would be a second row
   * saying what the ledger already says.
   *
   * Their ids come from `juliusDecisionEventId`, so a replayed decision names
   * the same events and the append contract applies to them: idempotent for a
   * replay, a typed conflict for a rewrite.
   */
  appendDecision(input: {
    decisionId: string; runId: string; taskId: string; policyRevision: string;
    idempotencyKey: string; occurredAt: string; decision: JuliusVerificationDecision;
    releaseTaskIds?: readonly string[];
    events?: readonly JuliusOperationalEvent[];
  }): Promise<boolean>;
}

/**
 * RECLAIMING EXPIRED LEASES.
 *
 * `recoverExpired` exists on the recovery repository and nothing called it —
 * the claim query USED to also pick up an expired ACTIVE task, so the
 * runtime worked without recovery and lost every RECOVERY FACT: what was
 * requeued, what was abandoned, how many attempts it had taken. Declaring the
 * port is what lets the run loop run the sweep and record what it did.
 */
export interface JuliusRecoveryDriver {
  // The action type is IMPORTED rather than restated. `taskId` is nullable on
  // it — a `RESUME_RUN` action is about the run and names no task — and a port
  // that declared it non-null would have compiled here and thrown there.
  recoverExpired(now: string, limit?: number, projectId?: string): Promise<readonly JuliusRecoveryAction[]>;
}

export interface JuliusResultWriter {
  acceptWorkerResult(input: {
    resultId: string; idempotencyKey: string; runId: string; projectId: string;
    taskId: string; leaseGeneration: number; workerId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; safeSummary: string;
    evidenceIds: readonly string[]; providerReceiptIds: readonly string[]; occurredAt: string;
  }): Promise<JuliusResultReceiptRow>;
}

/**
 * RECORDING A REVIEWER'S FINDING.
 *
 * `JuliusVerificationPostgresRepository.recordFinding` was written in #175 and
 * nothing called it, so `finding.recorded` sat in the event catalogue with no
 * emitter and a reviewer's FAILED evidence never became a blocking finding —
 * which meant `evaluateJuliusVerification` counted zero blocking findings for
 * every run and no repair could ever be triggered by a review.
 */
export interface JuliusFindingWriter {
  recordFinding(input: { projectId: string; finding: JuliusReviewerFinding }): Promise<boolean>;
}

export interface JuliusContextWriter {
  /**
   * PERSISTS A CONTEXT AND RETURNS THE ID THAT IS ACTUALLY STORED.
   *
   * This returned a boolean, and every caller discarded it. Context ids are
   * MINTED BY THE CALLER while the store deduplicates on
   * `(task_id, worker_id, content_hash)` — so a retry of a task whose context
   * has not changed mints a new id, matches the existing row, stores nothing,
   * and leaves the caller holding an id that exists nowhere. Paid Mission #2
   * crashed on exactly that: `julius_trajectory_events.context_id` is a foreign
   * key, and a review timeout made the retry path reachable for the first time.
   *
   * The invariant is now in the signature: a downstream record may reference
   * only an id this repository has PROVEN exists. `null` means it could not
   * prove one — the run does not have a context to point at, and the caller
   * must refuse rather than invent a reference.
   */
  persist(input: { projectId: string; snapshot: JuliusContextSnapshot }): Promise<string | null>;
}

/**
 * TWO LEDGERS, TWO METHOD NAMES.
 *
 * `JuliusEventPostgresRepository.append` and
 * `JuliusTrajectoryPostgresRepository.append` are separate CLASSES, so they
 * can share a name. A single port that composes both cannot, and giving them
 * one name here would have silently made whichever signature TypeScript
 * resolved first the only one callable. The names are distinct so a caller
 * always says which ledger it means.
 */
export interface JuliusEventWriter {
  /**
   * APPEND ONE EVENT, WITH ONE CONTRACT IN EVERY STORE.
   *
   *   a new id                        -> recorded; returns true.
   *   the same id, the same event     -> idempotent; no duplicate, no error,
   *                                      returns false. The ledger keeps the
   *                                      instant of the FIRST write.
   *   the same id, a different event  -> throws {@link JuliusEventIdConflict};
   *                                      nothing is written and the recorded
   *                                      event stands.
   *
   * "The same event" is {@link canonicalJuliusEventIdentity}: the subject and
   * the facts, at any key order and any depth, and NOT `occurredAt` — a replay
   * after a restart reads a later clock and is still the same event.
   *
   * The two stores used to disagree here, in opposite directions, and
   * `julius-event-append-conformance.ts` now runs one set of cases against both.
   */
  appendEvent(event: JuliusOperationalEvent): Promise<boolean>;
  /**
   * THE HANDOFF, FENCED BY THE LEASE ((a2)).
   *
   * `worker.dispatched` is the fact that makes an attempt "handed": everything
   * after it may have been paid for, and recovery never dispatches it again. So
   * it is written only while the attempt still OWNS the task (ACTIVE, this
   * owner, this lease generation), with the task row locked for the write. A
   * recovery that took the task first makes this answer LEASE_LOST, and the
   * caller must not call the provider. A recovery that comes second skips the
   * locked task and reads it as handed on its next sweep. Optional: a store
   * without it is written through unfenced, as before.
   */
  appendHandoffEvent?(input: {
    event: JuliusOperationalEvent; owner: string; leaseGeneration: number;
  }): Promise<'RECORDED' | 'DUPLICATE' | 'LEASE_LOST'>;
  /**
   * A RELEASE, WRITTEN ONLY WHEN IT SAYS SOMETHING ((a2) step 3).
   *
   * A `budget.settled` row from the coordinator's own release, decided against
   * the settlements its reservation already carries, under the run-row lock
   * (`juliusLateSettlementDecision`): a row carrying cost is always written; a
   * FREE release after closes that were all released is SAME_MEANING and not
   * written; a FREE release after a close that says money may have gone is
   * written with a `budget.settlement.conflict` event (CONFLICT): two readings
   * that disagree, neither shown false, both kept.
   * Optional: a store without it writes every release, as before.
   */
  appendSettlementEvent?(event: JuliusOperationalEvent): Promise<'RECORDED' | 'DUPLICATE' | 'SAME_MEANING' | 'CONFLICT'>;
}

export interface JuliusTrajectoryWriter {
  appendTrajectory(event: JuliusTrajectoryEvent): Promise<boolean>;
}

/**
 * BUDGET, AS THE RUNTIME NEEDS IT.
 *
 * Wonderland's `reserveBudget` already exists and is keyed by an execution id.
 * The runtime speaks in reservation ids and outcomes, so this port is the
 * narrow shape it needs; the adapter that maps a Julius task onto a Wonderland
 * execution lives in the persistence layer, where both vocabularies are
 * visible. A DENIED reservation is a VALUE, not a throw: running out of budget
 * is an ordinary outcome and ordinary outcomes are values.
 */
export interface JuliusBudgetPort {
  reserve(input: {
    reservationId: string; runId: string; projectId: string; taskId: string;
    usdMicros: number; inputTokens: number; outputTokens: number;
    toolCalls: number; runtimeMs: number; now: string;
  }): Promise<{ readonly state: 'RESERVED' | 'DENIED'; readonly denialReason: string | null }>;
  /**
   * UNKNOWN SPEND IS NOT ZERO SPEND. `usdMicros: null` means the boundary
   * reported no cost, and the ledger must then keep holding what it reserved
   * rather than freeing it: a runtime that answers without a cost has still
   * been paid, and treating that as $0 hands the rest of the mission money it
   * may already have spent.
   */
  commit(input: {
    reservationId: string; usdMicros: number | null; inputTokens: number; outputTokens: number;
    toolCalls: number; runtimeMs: number; receiptId: string | null; now: string;
  }): Promise<void>;
  /**
   * Hand a reservation back. `usdMicros` is what the failed attempt actually
   * billed, when the boundary reported it — money already spent is CHARGED,
   * never released, or a timed-out attempt would return its whole allocation
   * to the ledger and the retry would be granted it a second time.
   */
  release(input: {
    reservationId: string; reason: string; now: string;
    usdMicros?: number | null;
    /**
     * The attempt reached a provider that started work and reported no cost.
     * Unknown spend is not zero spend either: the hold is KEPT rather than
     * freed, because a hosted runtime reports its cost only in a final message
     * a timeout never delivers — the case where a hand-back would most often
     * hand the retry money the first attempt had already spent.
     */
    spendUnknown?: boolean;
  }): Promise<void>;
  /**
   * WHAT REMAINS, so an allocation can be derived from it: the ceiling minus
   * every outstanding reservation and commitment, in micro-dollars. `null`
   * means the ledger cannot say — Unknown, not zero — and the allocator then
   * takes its conservative branch. Optional so a ledger that cannot answer is
   * honest by omission rather than by inventing a number.
   */
  available?(input: { runId: string; projectId: string; now: string }): Promise<number | null>;
}

/* ------------------------------------------------------------- read ports */

/**
 * WHAT VERIFICATION NEEDS AND THE INHERITED STACK COULD NOT SUPPLY.
 *
 * `evaluateJuliusVerification` needs every task in the run, the evidence, the
 * reviewer findings, the acceptance criteria and the prior decisions. The
 * inherited Postgres repositories are write-shaped: they can APPEND all five
 * and read back none of them. That is precisely why verification could never
 * be invoked after execution, and it is a read port rather than a new table.
 */
export interface JuliusRuntimeReader {
  tasksForRun(runId: string, projectId: string): Promise<readonly JuliusTask[]>;
  evidenceForRun(runId: string, projectId: string): Promise<readonly JuliusEvidence[]>;
  findingsForRun(runId: string, projectId: string): Promise<readonly JuliusReviewerFinding[]>;
  criteriaForRun(runId: string, projectId: string): Promise<readonly JuliusAcceptanceCriterion[]>;
  /**
   * The run's verification decisions WITH the task each one governs, in the
   * durable log's order (`occurred_at, decision_id` on PostgreSQL, append
   * order in the model). The order is contractual: completion reads a task's
   * CURRENT decision as its last entry here, so an implementation that
   * reorders would silently change which decision is effective.
   */
  decisionsForRun(runId: string, projectId: string): Promise<readonly JuliusRecordedDecision[]>;
  brainEntriesForRun(runId: string, projectId: string): Promise<readonly JuliusBrainEntry[]>;
  /** How many repair rounds this task has already had. Zero, not null. */
  repairRoundsFor(taskId: string, projectId: string): Promise<number>;
  /**
   * How many of this run's tasks are ACTIVE right now, across every worker.
   *
   * The C.A.R.D. concurrency bound is about a RUN, not about a worker process,
   * so counting only what this tick claimed would let N workers each run the
   * run's full allowance. This is the number the bound is checked against.
   */
  activeTaskCount(runId: string, projectId: string): Promise<number>;
  /**
   * THE BINDING A TASK WAS ACTUALLY DISPATCHED UNDER, read back off the durable
   * `task.claimed` record rather than recomputed from whatever is locked now.
   *
   * Those are different questions once a contract has been revised. The lock
   * moves forward — revision 2 supersedes 1 — and a reviewer that read "the
   * current lock" would grade work against terms the coder was never given.
   * The reviewer's gate compares this record with its own binding, so the
   * thing being graded and the thing being graded AGAINST are provably one
   * document. Null when the task was never dispatched under a binding, which
   * is a fact about the record and not an absence of one.
   */
  executedBindingFor(taskId: string, projectId: string): Promise<JuliusTaskContractBinding | null>;
  /**
   * THE CLASSES ON THIS RUN'S `task.failed` ROWS THAT END THE RUN
   * (`JULIUS_RUN_HALTING_FAILURE_CLASSES`), each once, first recorded first.
   *
   * Read back off the durable record, like the binding above, and not written
   * anywhere new: the coordinator already records the class when a task fails.
   * `advanceRun` enacts it (FAILED, with the class as the run's reason), and the
   * dispatch boundary refuses the run's claims. Optional, so a store that cannot
   * say reads as holding none. The PostgreSQL store's own type requires it.
   */
  haltingFailureClasses?(runId: string, projectId: string): Promise<readonly string[]>;
}

/**
 * WRITING TO THE PROJECT BRAIN.
 *
 * `julius_brain_entries` existed from migration 014 with eight entry kinds, and
 * the runtime READ it to compile every worker's context — but it had exactly one
 * writer, the bootstrap seed, so five of those kinds had no producer at all. A
 * Project Brain that only ever holds what was written before the run started is
 * a read-only seed, not durable project intelligence.
 *
 * THE ENTRY ID IS THE IDEMPOTENCY KEY. Every other append on this store carries
 * a separate `idempotencyKey`; this one does not, because the brain table's
 * primary key already is one and a second key would be a second thing to keep
 * consistent. A caller derives the id from what produced the entry — a decision,
 * a finding, a repair — so a replayed tick writes nothing and, importantly,
 * does not advance the revision either.
 *
 * REVISIONS ARE ALLOCATED BY THE STORE, never by the caller. `UNIQUE(run_id,
 * revision)` means two workers that both computed "the next one" would collide,
 * so the implementation takes the run row's own `project_brain_revision` as an
 * atomic counter and returns entries in that order. That is what the column was
 * for; nothing else was advancing it.
 */
export interface JuliusBrainAppend {
  readonly runId: string;
  readonly projectId: string;
  /** The task this knowledge came out of, or null for run-level knowledge. */
  readonly taskId: string | null;
  readonly workerId: string;
  /** Deterministic per source. This IS the idempotency key. */
  readonly entryId: string;
  readonly kind: JuliusBrainEntry['kind'];
  /**
   * ALREADY SAFE. This text is persisted verbatim and read back into another
   * worker's context packet, so the caller owns its safety — the store does not
   * redact, and a store that did would be redaction nobody could audit.
   */
  readonly safeText: string;
  readonly evidenceIds: readonly string[];
  readonly occurredAt: string;
}

export interface JuliusBrainWriter {
  /**
   * True when this call wrote a new entry. False when the entry already existed
   * — a replay — or when the run does not exist in this project. False is not
   * an error: it is the answer "nothing was added", and the revision did not
   * move either.
   */
  appendBrainEntry(input: JuliusBrainAppend): Promise<boolean>;
}

/**
 * THE CLAIM STORE — a memory's standing, durable, with its history.
 *
 * One append per standing a claim has held: admission when the entry is
 * written, a promotion when a reviewer verifies what the entry's task did.
 * `recordClaimStanding` returns false for a replay whose content equals the
 * latest row, so a re-run tick cannot manufacture history; `claimsForRun`
 * answers the CURRENT standing per claim, which is what the context compiler
 * reads in place of the derived one. See `julius-claim-ledger.ts`.
 */
export interface JuliusClaimStandingAppend {
  readonly runId: string;
  readonly projectId: string;
  readonly claim: JuliusMemoryClaim;
  /** Why this standing was recorded — `ADMITTED`, `REVIEW_ACCEPTED`. */
  readonly reason: string;
  readonly occurredAt: string;
}

export interface JuliusClaimStore {
  claimsForRun(runId: string, projectId: string): Promise<readonly JuliusMemoryClaim[]>;
  recordClaimStanding(input: JuliusClaimStandingAppend): Promise<boolean>;
}

/**
 * THE TASK/SPRINT CONTRACT STORE.
 *
 * `julius-task-contract.ts` decides what a contract MEANS; this stores it. The
 * split matters because two of the invariants can only be held by the store:
 *
 *   AT MOST ONE LOCKED REVISION. A second lock is refused by a partial unique
 *   index, not by an application check — two workers racing to lock two
 *   revisions of the same contract would both read "not locked yet" and both
 *   write, and the coder and the reviewer would then hold different agreements
 *   while every domain function said they agreed.
 *
 *   A REVISION IS IMMUTABLE. `putContract` inserts and never updates, so a
 *   replayed tick that re-proposes the same revision writes nothing, and one
 *   that proposes DIFFERENT terms at a revision already stored is refused
 *   rather than silently overwriting terms someone may already hold.
 *
 * READING A LOCKED CONTRACT RE-DERIVES ITS DIGEST and refuses the row when it
 * disagrees with what was recorded. The terms are stored as a document; a
 * storage layer that normalised one of its values — or an edit made outside
 * this code — would otherwise hand a caller a binding that no longer describes
 * the terms beside it, and every downstream equality check would pass while
 * comparing the wrong thing.
 */
export interface JuliusTaskContractStore {
  /**
   * Insert one contract revision. True when this call stored it.
   *
   * False is a REPLAY — the same revision with the same terms already exists.
   * A conflicting proposal at an existing revision throws
   * `julius_task_contract_revision_conflict`, because silently keeping either
   * version would leave two parties holding different documents under one
   * revision number.
   */
  putTaskContract(input: { projectId: string; contract: JuliusTaskContract; occurredAt: string }): Promise<boolean>;
  /**
   * Record an evaluator's challenge against a revision. True when this call
   * moved it; false when it was already CHALLENGED. Refuses a locked or
   * superseded revision — see {@link challengeJuliusTaskContract}, which
   * decides the same thing on the domain side and is the caller's gate.
   */
  challengeTaskContract(input: {
    projectId: string; contractId: string; contractRevision: number;
  }): Promise<boolean>;
  /**
   * LOCK ONE REVISION, and supersede whichever revision was locked before, in
   * one write. Julius calls this; an evaluator's ACCEPT is its input.
   *
   * The digest is supplied by the caller because {@link lockJuliusTaskContract}
   * computed it from the accepted terms; the store re-derives it from what it
   * holds and refuses a mismatch, so a caller cannot lock terms to a digest of
   * something else.
   */
  lockTaskContract(input: {
    projectId: string; contractId: string; contractRevision: number;
    bindingDigest: string; lockedAt: string; evaluatorId: string;
  }): Promise<JuliusTaskContractLockResult>;
  /**
   * The contract governing this task: the LOCKED revision when one exists,
   * otherwise the highest revision on record. `null` when the task has none —
   * which is a fact, not an error, and the dispatch gate reports it as
   * `contract_absent` rather than as a failure to read.
   */
  loadTaskContract(input: { projectId: string; taskId: string }): Promise<JuliusTaskContract | null>;
  /** Every revision of this task's contract, ascending. The audit trail. */
  taskContractRevisions(input: { projectId: string; taskId: string }): Promise<readonly JuliusTaskContract[]>;
}

/**
 * Why a value rather than a throw: losing a lock race is an ORDINARY outcome
 * in a runtime with more than one worker, and the loser needs to know which
 * revision won so it can re-read rather than retry into the same refusal.
 */
export type JuliusTaskContractLockResult =
  | { readonly locked: true; readonly contract: JuliusTaskContract; readonly supersededRevision: number | null }
  | { readonly locked: false; readonly reasonCode: string; readonly lockedRevision: number | null };

/** Everything the runtime writes and reads, in one bag the caller composes. */
export interface JuliusRuntimeStore
  extends JuliusRunWriter, JuliusResultWriter, JuliusContextWriter,
  JuliusEventWriter, JuliusTrajectoryWriter, JuliusRuntimeReader, JuliusFindingWriter,
  JuliusBrainWriter, JuliusTaskContractStore, JuliusClaimStore {}

/* --------------------------------------------------- role/task vocabulary */

/**
 * The role a task string names, resolved to the runtime's own union.
 *
 * A stored `role` column is a string; the runtime needs a `JuliusWorkerRole`.
 * An unrecognised value is refused rather than coerced — a task whose role
 * Julius cannot resolve must not be dispatched to whichever worker happens to
 * sort first.
 */
export function resolveWorkerRole(role: string): JuliusWorkerRole | null {
  if (role === 'PROMPT_ARCHITECT' || role === 'CODING_AGENT' || role === 'INDEPENDENT_REVIEWER') return role;
  return role.startsWith('SPECIALIST:') && role.length > 'SPECIALIST:'.length
    ? role as JuliusWorkerRole
    : null;
}
