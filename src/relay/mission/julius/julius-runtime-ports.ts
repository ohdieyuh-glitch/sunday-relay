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
  JuliusTask,
  JuliusVerificationDecision,
  JuliusWorkerRole,
} from './julius-runtime';
import type { JuliusOperationalEvent } from './julius-events';
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
  readonly leaseGeneration: number;
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

export interface JuliusResultWriter {
  acceptWorkerResult(input: {
    resultId: string; idempotencyKey: string; runId: string; projectId: string;
    taskId: string; leaseGeneration: number; workerId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; safeSummary: string;
    evidenceIds: readonly string[]; providerReceiptIds: readonly string[]; occurredAt: string;
  }): Promise<JuliusResultReceiptRow>;
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
  decisionsForRun(runId: string, projectId: string): Promise<readonly JuliusVerificationDecision[]>;
  brainEntriesForRun(runId: string, projectId: string): Promise<readonly JuliusBrainEntry[]>;
  /** How many repair rounds this task has already had. Zero, not null. */
  repairRoundsFor(taskId: string, projectId: string): Promise<number>;
  /** Whether an INDEPENDENT_REVIEWER task for this task has already succeeded. */
  reviewCompletedFor(taskId: string, projectId: string): Promise<boolean>;
}

/** Everything the runtime writes and reads, in one bag the caller composes. */
export interface JuliusRuntimeStore
  extends JuliusRunWriter, JuliusResultWriter, JuliusContextWriter,
  JuliusEventWriter, JuliusTrajectoryWriter, JuliusRuntimeReader {}

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
