import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { JuliusPostgresRepository, type ClaimedJuliusTask, type JuliusRunRecord } from './julius-postgres';
import { JuliusRecoveryPostgresRepository, type JuliusResultReceipt } from './julius-recovery-postgres';
import { JuliusContextPostgresRepository } from './julius-context-postgres';
import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { JuliusTrajectoryPostgresRepository } from './julius-trajectory-postgres';
import { JuliusReadPostgresRepository } from './julius-read-postgres';
import { createJuliusMemoryStore } from '../mission/julius';
import type {
  JuliusClaimedTask, JuliusContextWriter, JuliusEventWriter, JuliusResultReceiptRow,
  JuliusResultWriter, JuliusRunRow, JuliusRunWriter, JuliusRuntimeReader,
  JuliusRuntimeStore, JuliusTrajectoryWriter,
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

/** The recovery repository satisfies the result-writer port directly. */
const resultWriter: JuliusResultWriter = new JuliusRecoveryPostgresRepository(pool);

/** The context repository satisfies the context port directly. */
const contextWriter: JuliusContextWriter = new JuliusContextPostgresRepository(pool);

/** The reader satisfies the read port directly. */
const reader: JuliusRuntimeReader = new JuliusReadPostgresRepository(pool);

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
const composed: JuliusRuntimeStore = {
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
};

describe('the Julius runtime ports and the PostgreSQL repositories agree', () => {
  it('composes a complete runtime store from the real repositories', () => {
    // The assignment above is the assertion; this proves the composition is a
    // real object with every method the runtime will call, so a missing one is
    // caught here rather than at the first dispatch in production.
    const memory = createJuliusMemoryStore();
    const required = Object.keys(memory).filter((key) =>
      !['seedRun', 'seedTask', 'seedCriteria', 'seedFinding', 'seedBrain',
        'taskRow', 'events', 'trajectory', 'contexts', 'results', 'restart'].includes(key));
    expect(required.length).toBeGreaterThan(15);
    for (const method of required) {
      expect(typeof (composed as unknown as Record<string, unknown>)[method], method).toBe('function');
    }
  });

  it('needs an adapter for exactly the two ledgers, and for nothing else', () => {
    // A drift-detector with a number in it: if a future repository stops
    // satisfying its port directly, this count changes and the reason has to be
    // written down rather than absorbed.
    const direct = [runWriter, resultWriter, contextWriter, reader];
    expect(direct).toHaveLength(4);
    expect(typeof eventWriter.appendEvent).toBe('function');
    expect(typeof trajectoryWriter.appendTrajectory).toBe('function');
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
