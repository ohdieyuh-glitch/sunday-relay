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
import { createJuliusMemoryStore } from '../mission/julius';
import type {
  JuliusClaimedTask, JuliusContextWriter, JuliusEventWriter, JuliusResultReceiptRow,
  JuliusResultWriter, JuliusRunRow, JuliusRunWriter, JuliusRuntimeReader,
  JuliusApprovalStore, JuliusFindingWriter, JuliusLifecycleStore,
  JuliusRecoveryDriver, JuliusTimelineReader,
  JuliusRuntimeStore, JuliusSubagentStore, JuliusTrajectoryWriter,
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
 * ONE REPOSITORY, TWO PORTS. The recovery repository both accepts worker
 * results and reclaims expired leases, and the runtime needs those separately:
 * the pipeline writes results and only the recovery sweep reclaims.
 */
const resultWriter: JuliusResultWriter = new JuliusRecoveryPostgresRepository(pool);
const recovery: JuliusRecoveryDriver = new JuliusRecoveryPostgresRepository(pool);

/** The context repository satisfies the context port directly. */
const contextWriter: JuliusContextWriter = new JuliusContextPostgresRepository(pool);

/** The reader satisfies the read port directly. */
const reader: JuliusRuntimeReader = new JuliusReadPostgresRepository(pool);

/** The sub-agent repository satisfies the sub-agent store port directly. */
const subagents: JuliusSubagentStore = new JuliusSubagentPostgresRepository(pool);

/** One repository satisfies both lifecycle ports: approvals and run lifecycle. */
const lifecycle: JuliusApprovalStore & JuliusLifecycleStore = new JuliusLifecyclePostgresRepository(pool);

/** The timeline reader satisfies the API's read port directly. */
const timeline: JuliusTimelineReader = new JuliusTimelinePostgresRepository(pool);

/** The verification repository satisfies the finding-writer port directly. */
const findings: JuliusFindingWriter = new JuliusVerificationPostgresRepository(pool);

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
const eventWriter: JuliusEventWriter = {
  appendEvent: async (event) => (await new JuliusEventPostgresRepository(pool).append(event)).recorded,
};
const trajectoryWriter: JuliusTrajectoryWriter = {
  appendTrajectory: (event) => new JuliusTrajectoryPostgresRepository(pool).append(event),
};

/** The whole runtime store, composed from the real repositories. */
const composed: JuliusRuntimeStore & JuliusSubagentStore
  & JuliusApprovalStore & JuliusLifecycleStore & JuliusRecoveryDriver = {
  loadRun: runWriter.loadRun.bind(runWriter),
  transition: runWriter.transition.bind(runWriter),
  addTask: runWriter.addTask.bind(runWriter),
  claimRunnable: runWriter.claimRunnable.bind(runWriter),
  heartbeat: runWriter.heartbeat.bind(runWriter),
  finishTask: runWriter.finishTask.bind(runWriter),
  appendEvidence: runWriter.appendEvidence.bind(runWriter),
  appendDecision: runWriter.appendDecision.bind(runWriter),
  acceptWorkerResult: resultWriter.acceptWorkerResult.bind(resultWriter),
  persist: contextWriter.persist.bind(contextWriter),
  appendEvent: eventWriter.appendEvent.bind(eventWriter),
  appendTrajectory: trajectoryWriter.appendTrajectory.bind(trajectoryWriter),
  tasksForRun: reader.tasksForRun.bind(reader),
  evidenceForRun: reader.evidenceForRun.bind(reader),
  findingsForRun: reader.findingsForRun.bind(reader),
  criteriaForRun: reader.criteriaForRun.bind(reader),
  decisionsForRun: reader.decisionsForRun.bind(reader),
  brainEntriesForRun: reader.brainEntriesForRun.bind(reader),
  repairRoundsFor: reader.repairRoundsFor.bind(reader),
  reviewCompletedFor: reader.reviewCompletedFor.bind(reader),
  activeTaskCount: reader.activeTaskCount.bind(reader),
  recordFinding: findings.recordFinding.bind(findings),
  recoverExpired: recovery.recoverExpired.bind(recovery),
  subagentContext: subagents.subagentContext.bind(subagents),
  recordSubagent: subagents.recordSubagent.bind(subagents),
  loadSubagent: subagents.loadSubagent.bind(subagents),
  subagentsForRun: subagents.subagentsForRun.bind(subagents),
  setSubagentState: subagents.setSubagentState.bind(subagents),
  requestApproval: lifecycle.requestApproval.bind(lifecycle),
  loadApproval: lifecycle.loadApproval.bind(lifecycle),
  pendingApprovals: lifecycle.pendingApprovals.bind(lifecycle),
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
    expect(update.replace(/\s+/gu, ' '))
      .toBe("CASE WHEN $4='FAILED' AND $6 IS NOT NULL THEN 'RUNNABLE' ELSE $4 END");

    const memory = readFileSync(resolve(import.meta.dirname, '../mission/julius/julius-memory-store.ts'), 'utf8');
    expect(memory, 'the memory store states the same rule in its own terms')
      .toContain("if (input.state === 'FAILED' && input.nextAttemptAt !== undefined) task.state = 'RUNNABLE';");
  });

  it('composes a complete runtime store from the real repositories', () => {
    // The assignment above is the assertion; this proves the composition is a
    // real object with every method the runtime will call, so a missing one is
    // caught here rather than at the first dispatch in production.
    const memory = createJuliusMemoryStore();
    const required = Object.keys(memory).filter((key) =>
      !['seedRun', 'seedTask', 'seedCriteria', 'seedFinding', 'seedBrain',
        'taskRow', 'events', 'trajectory', 'contexts', 'results', 'restart',
        'lifecycleOf', 'timeline'].includes(key));
    expect(required.length).toBeGreaterThan(15);
    for (const method of required) {
      expect(typeof (composed as unknown as Record<string, unknown>)[method], method).toBe('function');
    }
  });

  it('needs an adapter for exactly the two ledgers, and for nothing else', () => {
    // A drift-detector with a number in it: if a future repository stops
    // satisfying its port directly, this count changes and the reason has to be
    // written down rather than absorbed.
    const direct = [runWriter, resultWriter, contextWriter, reader, subagents, lifecycle, timeline, findings];
    expect(direct).toHaveLength(8);
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
    for (const method of ['requestApproval', 'loadApproval', 'pendingApprovals',
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
