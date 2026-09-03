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
 * layer may import both sides), and a deterministic in-memory store that
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
import type { JuliusOperationalEvent } from './julius-events';
import type { JuliusRecoveryAction } from './julius-recovery';
import type { JuliusReviewerFinding, JuliusAcceptanceCriterion } from './julius-verification-runtime';
import type { JuliusContextSnapshot } from './julius-context-snapshot';
import type { JuliusTrajectoryEvent } from './julius-trajectory';
import type { JuliusBrainEntry } from './julius-runtime';

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
   */
  admitTask(input: {
    taskId: string; owner: string; leaseGeneration: number; now: string;
  }): Promise<number | null>;
  heartbeat(input: {
    taskId: string; owner: string; leaseGeneration: number; now: string; leaseExpiresAt: string;
  }): Promise<boolean>;
  finishTask(input: {
    taskId: string; owner: string; leaseGeneration: number;
    state: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; now: string; nextAttemptAt?: string;
  }): Promise<boolean>;
  appendEvidence(input: {
    runId: string; projectId: string; idempotencyKey: string; evidence: JuliusEvidence;
  }): Promise<boolean>;
  appendDecision(input: {
    decisionId: string; runId: string; taskId: string; policyRevision: string;
    idempotencyKey: string; occurredAt: string; decision: JuliusVerificationDecision;
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
  persist(input: { projectId: string; snapshot: JuliusContextSnapshot }): Promise<boolean>;
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
  appendEvent(event: JuliusOperationalEvent): Promise<boolean>;
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
  commit(input: {
    reservationId: string; usdMicros: number; inputTokens: number; outputTokens: number;
    toolCalls: number; runtimeMs: number; receiptId: string | null; now: string;
  }): Promise<void>;
  release(input: { reservationId: string; reason: string; now: string }): Promise<void>;
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
  /** Whether an INDEPENDENT_REVIEWER task for this task has already succeeded. */
  reviewCompletedFor(taskId: string, projectId: string): Promise<boolean>;
  /**
   * How many of this run's tasks are ACTIVE right now, across every worker.
   *
   * The C.A.R.D. concurrency bound is about a RUN, not about a worker process,
   * so counting only what this tick claimed would let N workers each run the
   * run's full allowance. This is the number the bound is checked against.
   */
  activeTaskCount(runId: string, projectId: string): Promise<number>;
}

/** Everything the runtime writes and reads, in one bag the caller composes. */
export interface JuliusRuntimeStore
  extends JuliusRunWriter, JuliusResultWriter, JuliusContextWriter,
  JuliusEventWriter, JuliusTrajectoryWriter, JuliusRuntimeReader, JuliusFindingWriter {}

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
