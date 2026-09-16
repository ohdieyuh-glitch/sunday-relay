import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { paidRunArchive } from '../../src/relay/mission/julius/julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive } from '../../src/relay/mission/julius/julius-brain-archive-import';
import { juliusPrincipal } from '../../src/relay/mission/julius/julius-brain-contracts';
import { classifyJuliusBrainFailure, decideJuliusBrainFailure } from '../../src/relay/mission/julius/julius-brain-failure-model';
import { createJuliusBrainRetryRunner } from '../../src/relay/mission/julius/julius-brain-retry';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, readAllJuliusBrainRecords, type JuliusBrainStore } from '../../src/relay/mission/julius/julius-brain-store';
import type { JuliusBrainEntry } from '../../src/relay/mission/julius/julius-runtime';
import type { JuliusBrainAppend, JuliusRunRow } from '../../src/relay/mission/julius/julius-runtime-ports';
import { brainKindFromStored, brainKindToStored } from '../../src/relay/persistence/julius-brain-kinds';
import { createLiveJuliusProjectBrainBinding, type JuliusLiveBrainReport } from './project-brain-binding';

/**
 * PRESERVATION IS WHAT THE RUN ACHIEVED; RECOVERY IS WHAT HISTORY HOLDS.
 *
 * Seven runs, each failing differently, each ending with the status the Brain
 * can show — and, where an archive arrives later, a completeness fact beside it
 * that never rewrites what the run itself achieved.
 */

const PROJECT = 'prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
const RUN = 'run:julius-live-4';
/** The attempt the paid-run archive fixture carries, so a later recovery is of this same run. */
const ATTEMPT = 'workflow:34739303313/1';
const clock = { now: () => '2026-09-15T12:00:00.000Z' };
const ROLES = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const;
const content = { put: async (bytes: Uint8Array) => { const hex = createHash('sha256').update(bytes).digest('hex'); return { contentHash: `sha256:${hex}`, byteSize: bytes.byteLength, storageRef: `cas://sha256/${hex}` }; } };
const runRow: JuliusRunRow = { runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'EXECUTING', cardRevision: 'card', missionContractRevision: 1, projectBrainRevision: 0, version: 1 };

/** The v1 entries the archive fixture lists, as the live table holds them. */
const V1: readonly JuliusBrainAppend[] = [
  { runId: RUN, projectId: PROJECT, taskId: null, workerId: 'julius', entryId: 'seed:constraint', kind: 'CONSTRAINT', safeText: 'Edit only the trust core file', evidenceIds: [], occurredAt: '2026-09-13T05:05:00.000Z' },
  { runId: RUN, projectId: PROJECT, taskId: 'plan-1', workerId: 'julius', entryId: 'brain:decision:plan-1:ACCEPT:TASK_VERIFIED', kind: 'DECISION', safeText: 'ACCEPT (TASK_VERIFIED): The plan is reviewed and accepted.', evidenceIds: [], occurredAt: '2026-09-13T05:05:00.000Z' },
  { runId: RUN, projectId: PROJECT, taskId: 'build-1', workerId: 'julius', entryId: 'brain:guidance-request:build-1', kind: 'HANDOFF', safeText: 'Which ledger settles a hosted dispatch?', evidenceIds: [], occurredAt: '2026-09-13T05:05:00.000Z' },
  { runId: RUN, projectId: PROJECT, taskId: 'build-1', workerId: 'julius', entryId: 'brain:decision:build-1:REPAIR:BLOCKING_FINDINGS', kind: 'DECISION', safeText: 'REPAIR (BLOCKING_FINDINGS): the budget stopped the build.', evidenceIds: [], occurredAt: '2026-09-13T05:05:00.000Z' },
];

function harness(store: JuliusBrainStore = createJuliusBrainMemoryStore()) {
  const rows: JuliusBrainAppend[] = [];
  const reports: JuliusLiveBrainReport[] = [];
  const table = {
    rows,
    writer: { appendBrainEntry: async (append: JuliusBrainAppend) => { if (rows.some((row) => row.entryId === append.entryId)) return false; rows.push({ ...append, kind: brainKindFromStored(brainKindToStored(append.kind)) }); return true; } },
    reader: { brainEntriesForRun: async (): Promise<readonly JuliusBrainEntry[]> => rows.map((row) => ({ entryId: row.entryId, kind: row.kind, text: row.safeText, taskIds: row.taskId === null ? [] : [row.taskId], allowedRoles: [...ROLES], sensitivity: 'INTERNAL' as const })) },
  };
  const binding = createLiveJuliusProjectBrainBinding({
    store, clock, projectId: PROJECT, title: 'Julius', runs: { loadRun: async () => runRow },
    legacyEntries: async () => rows, brainRunIdFor: () => ATTEMPT, acceptedMainShaFor: () => paidRunArchive().identity.acceptedMainSha,
    onReport: (report) => reports.push(report),
  });
  const write = async (index: number) => (await binding.wrapWriter(table.writer).appendBrainEntry(V1[index]!));
  return { store, table, reports, binding, write, all: async () => ({ records: await readAllJuliusBrainRecords(store, binding.brainId, PROJECT), entities: await readAllJuliusBrainEntities(store, binding.brainId, PROJECT) }) };
}

/** A store that can be taken away and brought back. */
function flaky() {
  const memory = createJuliusBrainMemoryStore();
  let down = false;
  const guard = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    if (down) throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5442'), { code: 'ECONNREFUSED' });
    return fn(...args);
  };
  const store: JuliusBrainStore = {
    createBrain: guard((i) => memory.createBrain(i)), loadBrain: guard((b, p) => memory.loadBrain(b, p)), listBrains: guard((p) => memory.listBrains(p)),
    head: guard((b, p) => memory.head(b, p)), commit: guard((i) => memory.commit(i)), commitGroup: guard((i) => memory.commitGroup(i)),
    records: guard((b, p, q) => memory.records(b, p, q)), entities: guard((b, p, f) => memory.entities(b, p, f)), restore: guard((i, r) => memory.restore(i, r)),
  };
  return { store, memory, stop: () => { down = true; }, start: () => { down = false; } };
}

describe('preservation against service failure', () => {
  it('1. a Brain that is there throughout: PRESERVED, and preserved live', async () => {
    const h = harness();
    expect((await h.binding.bootstrap({ runId: RUN })).outcome).toBe('READY');
    for (let i = 0; i < V1.length; i += 1) expect(await h.write(i)).toBe(true);
    const sealed = await h.binding.seal({ runId: RUN });
    expect(sealed).toMatchObject({ outcome: 'SEALED', preservation: { status: 'PRESERVED', completeness: 'PRESERVED_LIVE', reasons: [] } });
  });

  it('2. a Brain that was never reachable: a FRESH run runs, unpreserved, and says so', async () => {
    const world = flaky();
    world.stop();
    const h = harness(world.store);
    const bootstrap = await h.binding.bootstrap({ runId: RUN });
    expect(bootstrap).toMatchObject({ outcome: 'UNAVAILABLE', proceed: true, requirement: 'ADDITIVE', failure: { failureClass: 'DATABASE_UNAVAILABLE' } });
    expect(decideJuliusBrainFailure({ mode: 'FRESH', phase: 'OPEN', failure: bootstrap.outcome === 'UNAVAILABLE' ? bootstrap.failure : classifyJuliusBrainFailure(null) }))
      .toMatchObject({ then: 'PROCEED_WITHOUT_BRAIN', preservation: 'NOT_PRESERVED', memoryFallback: 'NONE' });
    for (let i = 0; i < V1.length; i += 1) expect(await h.write(i)).toBe(true); // the mission's own writes never fail
    expect(await h.binding.seal({ runId: RUN })).toMatchObject({ outcome: 'NOT_SEALED', reason: 'BRAIN_DETACHED' });
    // When it comes back, it holds nothing of this attempt: NOT_PRESERVED, not recovered.
    world.start();
    expect(await h.binding.preservation({ runId: RUN })).toMatchObject({ outcome: 'DERIVED', preservation: { status: 'NOT_PRESERVED', completeness: 'NOT_RECOVERED' } });
  });

  it('3. a Brain that disappears mid-run: PARTIALLY_PRESERVED, with the missing entries named', async () => {
    const world = flaky();
    const h = harness(world.store);
    expect((await h.binding.bootstrap({ runId: RUN })).outcome).toBe('READY');
    expect(await h.write(0)).toBe(true);
    expect(await h.write(1)).toBe(true);
    world.stop();
    expect(await h.write(2)).toBe(true); // v1 still records it; the mirror cannot
    expect(await h.write(3)).toBe(true);
    world.start();
    const sealed = await h.binding.seal({ runId: RUN });
    expect(sealed).toMatchObject({
      outcome: 'SEALED',
      preservation: { status: 'PARTIALLY_PRESERVED', completeness: 'NOT_RECOVERED', evidence: { sealed: { expectedEntries: 4, writtenEntries: 2, missingEntries: 2 } } },
    });
  });

  it('4. a seal that lands and a checkpoint that does not: PARTIALLY_PRESERVED', async () => {
    const memory = createJuliusBrainMemoryStore();
    const store: JuliusBrainStore = { ...memory, commit: async (input) => { if (input.drafts.some((draft) => draft.kind === 'CHECKPOINT')) throw Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }); return memory.commit(input); } };
    const h = harness(store);
    await h.binding.bootstrap({ runId: RUN });
    for (let i = 0; i < V1.length; i += 1) await h.write(i);
    const sealed = await h.binding.seal({ runId: RUN });
    expect(sealed).toMatchObject({ outcome: 'NOT_SEALED', reason: 'UNAVAILABLE', failure: { failureClass: 'NETWORK_PARTIAL', outcome: 'UNKNOWN' } });
    expect(await h.binding.preservation({ runId: RUN })).toMatchObject({
      outcome: 'DERIVED',
      preservation: { status: 'PARTIALLY_PRESERVED', completeness: 'NOT_RECOVERED', evidence: { sealed: { missingEntries: 0 }, checkpoint: null }, reasons: ['no checkpoint was committed for the run'] },
    });
  });

  it('5. a response lost after the checkpoint committed: the Brain is read before anything is classified', async () => {
    const memory = createJuliusBrainMemoryStore();
    let swallow = true;
    // The checkpoint commits, and the answer never arrives.
    const store: JuliusBrainStore = {
      ...memory,
      commit: async (input) => {
        const result = await memory.commit(input);
        if (swallow && input.drafts.some((draft) => draft.kind === 'CHECKPOINT')) { swallow = false; throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }); }
        return result;
      },
    };
    const h = harness(store);
    await h.binding.bootstrap({ runId: RUN });
    for (let i = 0; i < V1.length; i += 1) await h.write(i);
    const lost = await h.binding.seal({ runId: RUN });
    expect(lost).toMatchObject({ outcome: 'NOT_SEALED', reason: 'UNAVAILABLE', failure: { failureClass: 'NETWORK_PARTIAL', outcome: 'UNKNOWN' } });
    // UNKNOWN is not FAILED: the retry contract reconciles by reading the Brain, which says it did land.
    const runner = createJuliusBrainRetryRunner({ clock, sleep: async () => undefined, random: () => 0.5, attempts: 2 });
    const reconciled = await runner.run({
      operation: 'SEAL',
      attempt: async () => { throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }); },
      reconcile: async () => {
        const read = await h.binding.preservation({ runId: RUN });
        return read.outcome === 'DERIVED' && read.preservation.status === 'PRESERVED' ? { applied: true, value: read.preservation } : { applied: false };
      },
    });
    expect(reconciled).toMatchObject({ status: 'PRESERVED', completeness: 'PRESERVED_LIVE' });
  });

  it('6. an open circuit breaker: the run is told the Brain is unreachable, and nothing claims PRESERVED', async () => {
    const world = flaky();
    const h = harness(world.store);
    await h.binding.bootstrap({ runId: RUN });
    for (let i = 0; i < 2; i += 1) await h.write(i);
    world.stop();
    const runner = createJuliusBrainRetryRunner({ clock, sleep: async () => undefined, attempts: 1, breaker: { failureThreshold: 2, openMs: 30_000 } });
    for (let i = 0; i < 2; i += 1) await expect(runner.run({ operation: 'SEAL', attempt: () => h.binding.seal({ runId: RUN }).then((result) => { if (result.outcome !== 'SEALED') throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); return result; }) })).rejects.toThrow();
    expect(runner.breaker().state).toBe('OPEN');
    const open = await runner.run({ operation: 'GET_PRESERVATION_STATUS', attempt: async () => 'never asked' }).catch((error: unknown) => error);
    expect(decideJuliusBrainFailure({ mode: 'FRESH', phase: 'SEAL', failure: classifyJuliusBrainFailure(open) })).toMatchObject({ preservation: 'NOT_PRESERVED', memoryFallback: 'NONE' });
    world.start();
    // What the Brain itself says is all that counts, and it does not say preserved.
    expect(await h.binding.preservation({ runId: RUN })).toMatchObject({ outcome: 'DERIVED', preservation: { status: 'PARTIALLY_PRESERVED', completeness: 'NOT_RECOVERED' } });
  });

  it('7. the archive recovers a partial attempt later: a recovery record, RECOVERED_AFTER_RUN, and a run-time status that is not rewritten', async () => {
    const world = flaky();
    const h = harness(world.store);
    await h.binding.bootstrap({ runId: RUN });
    expect(await h.write(0)).toBe(true);
    expect(await h.write(1)).toBe(true);
    world.stop();
    expect(await h.write(2)).toBe(true);
    expect(await h.write(3)).toBe(true);
    world.start();
    const sealed = await h.binding.seal({ runId: RUN });
    if (sealed.outcome !== 'SEALED') throw new Error(JSON.stringify(sealed));
    expect(sealed.preservation).toMatchObject({ status: 'PARTIALLY_PRESERVED', completeness: 'NOT_RECOVERED', evidence: { sealed: { missingEntries: 2 } } });

    // The paid-run archive of the same attempt arrives afterwards.
    const imported = await importJuliusPaidRunArchive({ store: world.store, brainId: h.binding.brainId, projectId: PROJECT, archive: paidRunArchive(), content, recordedAt: '2026-09-16T09:00:00.000Z' });
    expect(imported).toMatchObject({ outcome: 'IMPORTED', reconciliation: { mode: 'RECONCILED', preservationBefore: 'PARTIALLY_PRESERVED' } });

    const after = await h.binding.preservation({ runId: RUN });
    if (after.outcome !== 'DERIVED') throw new Error(after.detail);
    // What the run achieved is unchanged; what history holds is now recorded beside it.
    expect(after.preservation).toMatchObject({
      status: 'PARTIALLY_PRESERVED', completeness: 'RECOVERED_AFTER_RUN',
      evidence: { sealed: { expectedEntries: 4, writtenEntries: 2, missingEntries: 2 }, recoveries: [{ facts: { mode: 'RECONCILED', preservationBefore: 'PARTIALLY_PRESERVED' } }] },
    });
    expect(after.preservation.reasons).toContain('the attempt was recovered after the run from the paid-run archive (1 recovery record); it was not preserved live');
    expect(after.preservation.reasons).toContain("2 of the run's 4 v1 entries did not reach the Brain");
    // And the same archive again changes neither fact.
    expect(await importJuliusPaidRunArchive({ store: world.store, brainId: h.binding.brainId, projectId: PROJECT, archive: paidRunArchive(), content, recordedAt: '2026-09-16T10:00:00.000Z' })).toMatchObject({ outcome: 'ALREADY_IMPORTED', appended: 0 });
    expect((await h.binding.preservation({ runId: RUN })) as { preservation: { status: string; completeness: string } }).toMatchObject({ preservation: { status: 'PARTIALLY_PRESERVED', completeness: 'RECOVERED_AFTER_RUN' } });
  });
});
