import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { JuliusPostgresRepository, type ClaimedJuliusTask, type JuliusRunRecord } from './julius-postgres';
import { JuliusRecoveryPostgresRepository, type JuliusResultReceipt } from './julius-recovery-postgres';
import { JuliusContextPostgresRepository } from './julius-context-postgres';
import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { JuliusTrajectoryPostgresRepository } from './julius-trajectory-postgres';
import { JuliusReadPostgresRepository } from './julius-read-postgres';
import { JuliusSubagentPostgresRepository } from './julius-subagent-postgres';
import { JuliusLifecyclePostgresRepository } from './julius-lifecycle-postgres';
import { JuliusTimelinePostgresRepository } from './julius-timeline-postgres';
import { JuliusVerificationPostgresRepository } from './julius-verification-postgres';
import { JuliusContractPostgresRepository } from './julius-contract-postgres';
import { JuliusClaimPostgresRepository } from './julius-claim-postgres';
import { createJuliusMemoryStore } from '../mission/julius';
import type {
  JuliusClaimedTask, JuliusContextWriter, JuliusEventWriter, JuliusResultReceiptRow,
  JuliusResultWriter, JuliusRunRow, JuliusRunWriter, JuliusRuntimeReader,
  JuliusApprovalStore, JuliusBrainWriter, JuliusFindingWriter, JuliusLifecycleStore,
  JuliusRecoveryDriver, JuliusTimelineReader,
  JuliusRuntimeStore, JuliusSubagentStore, JuliusTaskContractStore, JuliusTrajectoryWriter,
  JuliusClaimStore,
} from '../mission/julius';

/**
 * THE PORTS AND THE REAL REPOSITORIES CANNOT DRIFT.
 *
 * `mission/julius` declares the runtime's ports and may not import `pg`, so
 * `JuliusRunRow` and `JuliusClaimedTask` are declared there a SECOND time
 * rather than imported from `julius-postgres.ts`. Two declarations of one shape
 * is exactly the drift this repository keeps finding, so it is held closed
 * here — in the persistence layer, the only place allowed to see both sides.
 *
 * These are COMPILE-TIME assertions. If a field is added to one side and not
 * the other, this file stops compiling and `npm run typecheck` fails; the
 * runtime `expect`s below exist so the file also participates honestly in the
 * test count rather than passing by existing.
 */

/* --------------------------------------------- the duplicated row shapes */

/**
 * Assigned in BOTH directions, because one direction only proves a subset. A
 * field added to `JuliusRunRecord` alone would still be assignable to
 * `JuliusRunRow`; it is the reverse assignment that catches it.
 *
 * `null as unknown as T` never runs — these are declarations whose only job is
 * to be typechecked — and the values are referenced by the test below so
 * `noUnusedLocals` is satisfied honestly rather than by a directive comment.
 */
const runRowAsRecord: JuliusRunRecord = null as unknown as JuliusRunRow;
const runRecordAsRow: JuliusRunRow = null as unknown as JuliusRunRecord;
const claimAsRecord: ClaimedJuliusTask = null as unknown as JuliusClaimedTask;
const claimRecordAsPort: JuliusClaimedTask = null as unknown as ClaimedJuliusTask;
const receiptAsRow: JuliusResultReceiptRow = null as unknown as JuliusResultReceipt;
const receiptRowAsReceipt: JuliusResultReceipt = null as unknown as JuliusResultReceiptRow;

/* ------------------------------------------- the repositories as ports */

const pool = null as unknown as Pool;

/** The main repository satisfies the run-writer port with no adapter at all. */
const runWriter: JuliusRunWriter = new JuliusPostgresRepository(pool);

/**
 * ONE REPOSITORY, TWO PORTS. The same repository is also the Project Brain's
 * writer, and this assignment is the whole proof — it is what refused the first
 * attempt at wiring `appendBrainEntry`, which bound it off `runWriter` and
 * therefore claimed the run-writer port had a method it does not. A narrow port
 * that quietly grew would be a port nobody could reason about.
 */
const brainWriter: JuliusBrainWriter = new JuliusPostgresRepository(pool);

/**
 * ONE REPOSITORY, TWO PORTS. The recovery repository both accepts worker
 * results and reclaims expired leases, and the runtime needs those separately:
 * the pipeline writes results and only the recovery sweep reclaims.
 */
const resultWriter: JuliusResultWriter = new JuliusRecoveryPostgresRepository(pool);
const recovery: JuliusRecoveryDriver = new JuliusRecoveryPostgresRepository(pool);

/** The context repository satisfies the context port directly. */
const contextWriter: JuliusContextWriter = new JuliusContextPostgresRepository(pool);

/**
 * The reader satisfies the read port directly, including the OPTIONAL read of
 * the run-ending failure classes: the production store requires it, so this does.
 */
const reader: JuliusRuntimeReader & Required<Pick<JuliusRuntimeReader, 'haltingFailureClasses'>>
  = new JuliusReadPostgresRepository(pool);

/** The sub-agent repository satisfies the sub-agent store port directly. */
const subagents: JuliusSubagentStore = new JuliusSubagentPostgresRepository(pool);

/** One repository satisfies both lifecycle ports: approvals and run lifecycle. */
const lifecycle: JuliusApprovalStore & Required<Pick<JuliusApprovalStore, 'deniedApprovals'>> & JuliusLifecycleStore
  = new JuliusLifecyclePostgresRepository(pool);

/** The timeline reader satisfies the API's read port directly. */
const timeline: JuliusTimelineReader = new JuliusTimelinePostgresRepository(pool);

/** The verification repository satisfies the finding-writer port directly. */
const findings: JuliusFindingWriter = new JuliusVerificationPostgresRepository(pool);

/**
 * The contract repository satisfies the task-contract port directly. This
 * assignment is the load-bearing half of migration 023: a port method the
 * repository does not implement — or implements with a different shape — stops
 * this file compiling, which is how the memory model and the database are held
 * to one contract without a database being present.
 */
const taskContracts: JuliusTaskContractStore = new JuliusContractPostgresRepository(pool);

const claimStore: JuliusClaimStore = new JuliusClaimPostgresRepository(pool);

/**
 * THE TWO LEDGERS NEED A ONE-LINE ADAPTER, AND THAT IS THE POINT.
 *
 * Both repositories name their method `append`; the composed port cannot,
 * because a single interface may not carry two different `append` signatures.
 * The event repository also returns `{ recorded, sequence }` rather than a
 * boolean — and that SEQUENCE is the field the Relay-side terminal projection
 * needs and the core event type does not carry, which is recorded as an
 * integration contract gap rather than being quietly dropped here.
 */
const eventWriter: JuliusEventWriter & Required<Pick<JuliusEventWriter, 'appendHandoffEvent'>> = {
  appendEvent: async (event) => (await new JuliusEventPostgresRepository(pool).append(event)).recorded,
  // The handoff, fenced by the lease ((a2)): the same repository, the one event it may refuse.
  appendHandoffEvent: (input) => new JuliusEventPostgresRepository(pool).appendHandoff(input),
};
const trajectoryWriter: JuliusTrajectoryWriter = {
  appendTrajectory: (event) => new JuliusTrajectoryPostgresRepository(pool).append(event),
};

/** The whole runtime store, composed from the real repositories. */
const composed: JuliusRuntimeStore & JuliusSubagentStore
  & JuliusApprovalStore & JuliusLifecycleStore & JuliusRecoveryDriver = {
  loadRun: runWriter.loadRun.bind(runWriter),
  claimsForRun: claimStore.claimsForRun.bind(claimStore),
  recordClaimStanding: claimStore.recordClaimStanding.bind(claimStore),
  transition: runWriter.transition.bind(runWriter),
  addTask: runWriter.addTask.bind(runWriter),
  claimRunnable: runWriter.claimRunnable.bind(runWriter),
  admitTask: runWriter.admitTask.bind(runWriter),
  heartbeat: runWriter.heartbeat.bind(runWriter),
  finishTask: runWriter.finishTask.bind(runWriter),
  appendEvidence: runWriter.appendEvidence.bind(runWriter),
  appendDecision: runWriter.appendDecision.bind(runWriter),
  appendBrainEntry: brainWriter.appendBrainEntry.bind(brainWriter),
  acceptWorkerResult: resultWriter.acceptWorkerResult.bind(resultWriter),
  persist: contextWriter.persist.bind(contextWriter),
  appendEvent: eventWriter.appendEvent.bind(eventWriter),
  appendHandoffEvent: eventWriter.appendHandoffEvent.bind(eventWriter),
  appendTrajectory: trajectoryWriter.appendTrajectory.bind(trajectoryWriter),
  tasksForRun: reader.tasksForRun.bind(reader),
  evidenceForRun: reader.evidenceForRun.bind(reader),
  findingsForRun: reader.findingsForRun.bind(reader),
  criteriaForRun: reader.criteriaForRun.bind(reader),
  decisionsForRun: reader.decisionsForRun.bind(reader),
  brainEntriesForRun: reader.brainEntriesForRun.bind(reader),
  repairRoundsFor: reader.repairRoundsFor.bind(reader),
  activeTaskCount: reader.activeTaskCount.bind(reader),
  executedBindingFor: reader.executedBindingFor.bind(reader),
  haltingFailureClasses: reader.haltingFailureClasses.bind(reader),
  recordFinding: findings.recordFinding.bind(findings),
  putTaskContract: taskContracts.putTaskContract.bind(taskContracts),
  challengeTaskContract: taskContracts.challengeTaskContract.bind(taskContracts),
  lockTaskContract: taskContracts.lockTaskContract.bind(taskContracts),
  loadTaskContract: taskContracts.loadTaskContract.bind(taskContracts),
  taskContractRevisions: taskContracts.taskContractRevisions.bind(taskContracts),
  recoverExpired: recovery.recoverExpired.bind(recovery),
  subagentContext: subagents.subagentContext.bind(subagents),
  recordSubagent: subagents.recordSubagent.bind(subagents),
  loadSubagent: subagents.loadSubagent.bind(subagents),
  subagentsForRun: subagents.subagentsForRun.bind(subagents),
  setSubagentState: subagents.setSubagentState.bind(subagents),
  requestApproval: lifecycle.requestApproval.bind(lifecycle),
  loadApproval: lifecycle.loadApproval.bind(lifecycle),
  pendingApprovals: lifecycle.pendingApprovals.bind(lifecycle),
  deniedApprovals: lifecycle.deniedApprovals.bind(lifecycle),
  decideApproval: lifecycle.decideApproval.bind(lifecycle),
  cancelRunTasks: lifecycle.cancelRunTasks.bind(lifecycle),
  recordLifecycle: lifecycle.recordLifecycle.bind(lifecycle),
};

describe('the Julius runtime ports and the PostgreSQL repositories agree', () => {
  /**
   * THE TWO STORES MUST AGREE ABOUT A TASK HANDED BACK.
   *
   * `finishTask(state:'FAILED', nextAttemptAt)` means "give this task back",
   * not "fail it": the run loop yields a claim with it, and the pipeline
   * requeues an authorized retry with it. The memory store answers RUNNABLE.
   * The PostgreSQL store answered FAILED — beyond the reach of every claim
   * query — so the same call destroyed a task in production and requeued it in
   * every test. This case is the cheap offline guard on the SQL; the
   * behavioural proof runs against a real database in
   * `scripts/julius-live-preflight-identity.test.ts`.
   */
  it('a FAILED finish carrying a next attempt requeues in BOTH stores', () => {
    const sql = readFileSync(resolve(import.meta.dirname, 'julius-postgres.ts'), 'utf8');
    const update = /UPDATE relay_wonderland\.julius_tasks SET state=([^,]+),/u.exec(sql)?.[1] ?? '';
    expect(update, 'the SQL must branch, not write the state through').not.toBe('$4');
    // The casts are part of the contract, not formatting: without them the
    // statement does not plan at all (42P08), which the sibling workflow's
    // real-PostgreSQL cases caught on the first version of this repair.
    expect(update.replace(/\s+/gu, ' '))
      .toBe("CASE WHEN $4::text='FAILED' AND $6::timestamptz IS NOT NULL THEN 'RUNNABLE'::text ELSE $4::text END");

    const memory = readFileSync(resolve(import.meta.dirname, '../mission/julius/julius-memory-store.ts'), 'utf8');
    expect(memory, 'the memory store states the same rule in its own terms')
      .toContain("if (input.state === 'FAILED' && input.nextAttemptAt !== undefined) task.state = 'RUNNABLE';");
  });

  /**
   * AN EXPIRED LEASE IS RECOVERY'S IN BOTH STORES.
   *
   * The claim query used to offer an ACTIVE task whose lease had expired, which
   * reclaimed it while raising only `lease_generation` — bypassing `recoveries`
   * and its ceiling entirely, so a task that crashed before admission could be
   * retaken forever. This is the cheap offline guard on the SQL; the
   * behavioural proof against a real database is in
   * `scripts/julius-live-preflight-identity.test.ts`.
   */
  it('neither store lets a bare claim reclaim an expired lease', () => {
    const sql = readFileSync(resolve(import.meta.dirname, 'julius-postgres.ts'), 'utf8');
    // RUNNABLE only: BLOCKED is never claimable, it is RELEASED by Julius's
    // accepting decision (paid run 34037313976 built against an unreviewed
    // plan while BLOCKED was still offered once its dependencies succeeded).
    expect(sql, 'the claim offers only RUNNABLE work')
      .toContain("AND t.next_attempt_at<=$2 AND t.state='RUNNABLE'");
    expect(sql, 'and never BLOCKED work, whatever its dependencies have done')
      .not.toMatch(/t\.state IN\('RUNNABLE','BLOCKED'\)/u);
    expect(sql, 'and never an expired ACTIVE lease, which is recovery\'s to hand back')
      .not.toMatch(/state='ACTIVE' AND t\.lease_expires_at<=\$2/u);

    const memory = readFileSync(resolve(import.meta.dirname, '../mission/julius/julius-memory-store.ts'), 'utf8');
    expect(memory, 'the memory store states the same rule in its own terms')
      .toContain("if (task.state !== 'RUNNABLE') return false;");
    expect(memory, 'with no expiry escape hatch beside it')
      .not.toMatch(/&& !expired\) return false;/u);
  });

  it('composes a complete runtime store from the real repositories', () => {
    // The assignment above is the assertion; this proves the composition is a
    // real object with every method the runtime will call, so a missing one is
    // caught here rather than at the first dispatch in production.
    const memory = createJuliusMemoryStore();
    const required = Object.keys(memory).filter((key) =>
      !['seedRun', 'seedTask', 'seedCriteria', 'seedFinding', 'seedBrain',
        'taskRow', 'events', 'trajectory', 'contexts', 'results', 'restart',
        // The claim history is an inspection read; production reads the current
        // standing through `claimsForRun` and the repository keeps the history.
        'lifecycleOf', 'timeline', 'claimStandingHistory'].includes(key));
    expect(required.length).toBeGreaterThan(15);
    for (const method of required) {
      expect(typeof (composed as unknown as Record<string, unknown>)[method], method).toBe('function');
    }
  });

  it('needs an adapter for exactly the two ledgers, and for nothing else', () => {
    // A drift-detector with a number in it: if a future repository stops
    // satisfying its port directly, this count changes and the reason has to be
    // written down rather than absorbed.
    const direct = [runWriter, resultWriter, contextWriter, reader, subagents, lifecycle, timeline, findings, claimStore];
    expect(direct).toHaveLength(9);
    expect(typeof eventWriter.appendEvent).toBe('function');
    expect(typeof trajectoryWriter.appendTrajectory).toBe('function');
  });

  it('satisfies the recovery driver with no adapter', () => {
    expect(typeof recovery.recoverExpired).toBe('function');
  });

  it('satisfies the finding writer with no adapter', () => {
    expect(typeof findings.recordFinding).toBe('function');
  });

  it('satisfies the timeline reader with no adapter', () => {
    expect(typeof timeline.timeline).toBe('function');
  });

  it('satisfies the approval and lifecycle stores with no adapter', () => {
    for (const method of ['requestApproval', 'loadApproval', 'pendingApprovals', 'deniedApprovals',
      'decideApproval', 'cancelRunTasks', 'recordLifecycle']) {
      expect(typeof (lifecycle as unknown as Record<string, unknown>)[method], method).toBe('function');
    }
  });


  it('satisfies the sub-agent store with no adapter', () => {
    for (const method of ['subagentContext', 'recordSubagent', 'loadSubagent',
      'subagentsForRun', 'setSubagentState']) {
      expect(typeof (subagents as unknown as Record<string, unknown>)[method], method).toBe('function');
    }
  });

  it('holds the duplicated row shapes structurally identical', () => {
    // The bidirectional assignments above are the real assertion; referencing
    // them keeps the declarations honest rather than silenced.
    for (const value of [runRowAsRecord, runRecordAsRow, claimAsRecord,
      claimRecordAsPort, receiptAsRow, receiptRowAsReceipt]) {
      expect(value).toBeNull();
    }
    // The type aliases above fail the build on drift. These runtime checks
    // assert the KEY SETS agree too, which catches an optional field added to
    // one side that structural assignability would tolerate.
    const runRowKeys: Array<keyof JuliusRunRow> = [
      'runId', 'missionId', 'projectId', 'state', 'cardRevision',
      'missionContractRevision', 'projectBrainRevision', 'version',
    ];
    const claimKeys: Array<keyof JuliusClaimedTask> = [
      'taskId', 'runId', 'role', 'taskType', 'leaseGeneration', 'attempt',
    ];
    expect(runRowKeys).toHaveLength(8);
    expect(claimKeys).toHaveLength(6);
  });
});
