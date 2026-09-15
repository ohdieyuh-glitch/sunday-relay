import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { paidRunArchive, paidRunArchiveBody } from './julius-brain-archive-fixtures';
import {
  importJuliusPaidRunArchive,
  juliusArchiveEntityId,
  sealJuliusPaidRunArchiveExport,
  type JuliusPaidRunArchiveExport,
  type JuliusPaidRunArchiveExportBody,
} from './julius-brain-archive-import';
import { juliusPrincipal } from './julius-brain-contracts';
import { exportJuliusBrain, restoreJuliusBrainFromExport } from './julius-brain-export';
import { juliusBrainDraftFromLegacy } from './julius-brain-legacy';
import { LIVE_ATTEMPT_ALL_ENTRIES, LIVE_ATTEMPT_JULIUS_RUN, LIVE_ATTEMPT_MISSION, writeLiveAttempt, type LiveAttemptOptions } from './julius-brain-live-attempt-fixtures';
import { deriveJuliusBrainRunPreservation, juliusArchiveRecoveryEntityId, juliusRunOpenedEntityId } from './julius-brain-preservation';
import { verifyJuliusBrainLedger } from './julius-brain-projection';
import { createJuliusProjectBrainService } from './julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, readAllJuliusBrainRecords, type JuliusBrainStore } from './julius-brain-store';

/**
 * RECOVERY UNDER ADVERSARIAL HISTORIES AND FAILURES.
 *
 * Every case ends in one of two states: exactly one history of the attempt
 * (live records linked, the rest added once, one RECOVERY trace), or a refusal
 * that wrote nothing. Never a merge of two stories, never a duplicate, never a
 * partial import. The real-PostgreSQL half (a transaction killed mid-commit,
 * racing recoveries in separate pools, a cold retry) is
 * scripts/julius-brain-archive-recovery-postgres.test.ts.
 */

const BRAIN = 'brain:prj-julius-live-4';
const PROJECT = 'prj-julius-live-4';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const ATTEMPT = 'workflow:34739303313/1';
const NOW = '2026-09-15T12:00:00.000Z';
const content = { put: async (bytes: Uint8Array) => { const hex = createHash('sha256').update(bytes).digest('hex'); return { contentHash: `sha256:${hex}`, byteSize: bytes.byteLength, storageRef: `cas://sha256/${hex}` }; } };
const archiveId = (section: Parameters<typeof juliusArchiveEntityId>[1], sourceId: string) => juliusArchiveEntityId(paidRunArchive().identity, section, sourceId);

async function brain(store: JuliusBrainStore = createJuliusBrainMemoryStore()) {
  const service = createJuliusProjectBrainService({ store, clock: { now: () => NOW } });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
  const julius = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
  const importArchive = (archive: JuliusPaidRunArchiveExport, on: JuliusBrainStore = store) => importJuliusPaidRunArchive({ store: on, brainId: BRAIN, projectId: PROJECT, archive, content, recordedAt: NOW });
  const all = async (on: JuliusBrainStore = store) => ({ records: await readAllJuliusBrainRecords(on, BRAIN, PROJECT), entities: await readAllJuliusBrainEntities(on, BRAIN, PROJECT) });
  const live = (options: LiveAttemptOptions, runId = ATTEMPT) => writeLiveAttempt(julius, runId, options);
  return { store, julius, importArchive, all, live };
}
/** A store that behaves like `store` except where overridden. */
const delegating = (store: JuliusBrainStore, overrides: Partial<JuliusBrainStore>): JuliusBrainStore => ({
  createBrain: (identity) => store.createBrain(identity), loadBrain: (brainId, projectId) => store.loadBrain(brainId, projectId), listBrains: (projectId) => store.listBrains(projectId),
  head: (brainId, projectId) => store.head(brainId, projectId), commit: (input) => store.commit(input), commitGroup: (input) => store.commitGroup(input),
  records: (brainId, projectId, query) => store.records(brainId, projectId, query), entities: (brainId, projectId, filter) => store.entities(brainId, projectId, filter),
  restore: (identity, records) => store.restore(identity, records),
  ...overrides,
});
const resealed = (mutate: (body: JuliusPaidRunArchiveExportBody) => JuliusPaidRunArchiveExportBody) => sealJuliusPaidRunArchiveExport(mutate(paidRunArchiveBody()));

/** Refused, with exactly these conflicts, and not one record written. */
async function expectRefusedUnchanged(h: Awaited<ReturnType<typeof brain>>, archive: JuliusPaidRunArchiveExport, conflicts: readonly string[]) {
  const head = await h.store.head(BRAIN, PROJECT);
  expect(await h.importArchive(archive)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'conflicting_history', conflicts });
  expect(await h.store.head(BRAIN, PROJECT)).toEqual(head);
}

describe('archive recovery, adversarially', () => {
  it('first half live, full archive: the first half is linked, only the rest is added, and each fact exists once', async () => {
    const clean = await brain();
    const reconstructed = await clean.importArchive(paidRunArchive());
    if (reconstructed.outcome !== 'IMPORTED') throw new Error(JSON.stringify(reconstructed));
    const cleanIds = new Set((await clean.all()).entities.map((state) => state.entityId));

    const h = await brain();
    const firstHalf = LIVE_ATTEMPT_ALL_ENTRIES.slice(0, 2);
    await h.live({ entries: firstHalf });
    const result = await h.importArchive(paidRunArchive());
    if (result.outcome !== 'IMPORTED') throw new Error(JSON.stringify(result));
    expect(result.reconciliation?.mode).toBe('RECONCILED');
    const ids = new Set((await h.all()).entities.map((state) => state.entityId));
    // Exactly the reconstruction, with the two facts the live run holds swapped for the live records, plus its open marker.
    const heldLive = [archiveId('brainEntries', 'seed:constraint'), archiveId('reviews', 'dec-plan')];
    const expected = new Set([...cleanIds].filter((id) => !heldLive.includes(id)));
    for (const entryId of firstHalf) expected.add(`legacy:${ATTEMPT}:${entryId}`);
    expected.add(juliusRunOpenedEntityId(ATTEMPT));
    expect([...ids].sort()).toEqual([...expected].sort());
    expect(result.appended).toBe(reconstructed.appended - heldLive.length);
    expect((await h.all()).entities.filter((state) => state.kind === 'DECISION' && state.scope.runId === ATTEMPT)).toHaveLength(2);
    expect(verifyJuliusBrainLedger(BRAIN, (await h.all()).records).ok).toBe(true);
  });

  it('the same fact under a different id: linked when a logical key proves it, refused when only the words match', async () => {
    // The v1 decision entry and the archived review are one decision: the review is not added.
    const linked = await brain();
    await linked.live({ entries: ['brain:decision:plan-1:ACCEPT:TASK_VERIFIED'] });
    expect(await linked.importArchive(paidRunArchive())).toMatchObject({ outcome: 'IMPORTED', represented: { reviewsByLiveMirror: 1 } });
    expect((await linked.all()).entities.some((state) => state.entityId === archiveId('reviews', 'dec-plan'))).toBe(false);

    // A live constraint with the same words under an id the export does not list is not provably the same fact.
    const h = await brain();
    await h.live({ entries: ['seed:constraint:copy'], append: { 'seed:constraint:copy': { kind: 'CONSTRAINT', taskId: null, safeText: 'Edit only the trust core file' } } });
    await expectRefusedUnchanged(h, paidRunArchive(), ['the live run holds v1 entry the export does not list: seed:constraint:copy']);
  });

  it('the same id with different content is refused; an Unknown field in the export contradicts nothing', async () => {
    const kind = await brain();
    await kind.live({ entries: ['seed:constraint'], append: { 'seed:constraint': { kind: 'REQUIREMENT' } } });
    await expectRefusedUnchanged(kind, paidRunArchive(), ['v1 entry seed:constraint is a REQUIREMENT in the live run; the export says CONSTRAINT']);

    const task = await brain();
    await task.live({ entries: ['brain:guidance-request:build-1'], append: { 'brain:guidance-request:build-1': { taskId: 'plan-1' } } });
    await expectRefusedUnchanged(task, paidRunArchive(), ['v1 entry brain:guidance-request:build-1 belongs to task plan-1 in the live run; the export says build-1']);

    const unknown = await brain();
    await unknown.live({ entries: ['brain:guidance-request:build-1'], append: { 'brain:guidance-request:build-1': { taskId: 'plan-1' } } });
    const taskUnknown = resealed((body) => ({ ...body, brainEntries: body.brainEntries.map((item) => (item.entryId === 'brain:guidance-request:build-1' ? { ...item, taskId: null, unknown: [...item.unknown, 'taskId'].sort() as typeof item.unknown } : item)) }));
    expect(await unknown.importArchive(taskUnknown)).toMatchObject({ outcome: 'IMPORTED', reconciliation: { mode: 'RECONCILED' }, represented: { entriesByLiveMirror: 1 } });
  });

  it('one accepted main with another mission, one mission with another accepted main: both refused', async () => {
    const mission = await brain();
    await mission.live({ entries: ['seed:constraint'], missionId: 'mission:julius-live-5' });
    await expectRefusedUnchanged(mission, paidRunArchive(), [`the live run opened for mission mission:julius-live-5; the export is for ${LIVE_ATTEMPT_MISSION}`]);

    const main = await brain();
    await main.live({ entries: ['seed:constraint'], acceptedMainSha: 'e'.repeat(40) });
    await expectRefusedUnchanged(main, paidRunArchive(), [`the live run executed ${'e'.repeat(40)}; the export says ${paidRunArchive().identity.acceptedMainSha}`]);
  });

  it('an archive missing what the seal claims, or holding more than the seal counted, is refused; an unsealed run takes the extra fact', async () => {
    const missing = await brain();
    await missing.live({ entries: LIVE_ATTEMPT_ALL_ENTRIES.slice(0, 3), seal: 4 });
    const short = resealed((body) => ({ ...body, brainEntries: body.brainEntries.slice(0, 3) }));
    await expectRefusedUnchanged(missing, short, ['the live run sealed 4 v1 entries; the export lists 3']);

    const extraFact = { entryId: 'brain:note:late', kind: 'TRACE_NOTE', workerId: null, taskId: null, revision: null, occurredAt: null, unknown: ['occurredAt', 'revision', 'workerId'] as const };
    const extra = resealed((body) => ({ ...body, brainEntries: [...body.brainEntries, { ...extraFact, unknown: [...extraFact.unknown] }] }));
    const sealed = await brain();
    await sealed.live({ entries: LIVE_ATTEMPT_ALL_ENTRIES, seal: 4 });
    await expectRefusedUnchanged(sealed, extra, ['the live run sealed 4 v1 entries; the export lists 5']);

    const open = await brain();
    await open.live({ entries: LIVE_ATTEMPT_ALL_ENTRIES.slice(0, 2) });
    const result = await open.importArchive(extra);
    expect(result).toMatchObject({ outcome: 'IMPORTED', reconciliation: { mode: 'RECONCILED' } });
    const { records, entities } = await open.all();
    expect(entities.filter((state) => state.entityId === juliusArchiveEntityId(extra.identity, 'brainEntries', 'brain:note:late'))).toHaveLength(1);
    // Recovery adds history; it never makes the live run PRESERVED.
    expect(deriveJuliusBrainRunPreservation({ brainId: BRAIN, brainRunId: ATTEMPT, records, entities }).status).toBe('PARTIALLY_PRESERVED');
  });

  it('a contradicting live write that lands between the plan and the commit: re-planned, then refused, and the archive wrote nothing', async () => {
    const h = await brain();
    await h.live({ entries: ['seed:constraint'] });
    let injected = false;
    const racing = delegating(h.store, {
      async commitGroup(input) {
        if (!injected) {
          injected = true;
          const append = { runId: LIVE_ATTEMPT_JULIUS_RUN, projectId: PROJECT, workerId: 'julius', entryId: 'brain:unexported', kind: 'CONSTRAINT' as const, taskId: null, safeText: 'written while recovery planned', evidenceIds: [], occurredAt: '2026-09-13T07:00:00.000Z' };
          expect((await h.julius.commit([juliusBrainDraftFromLegacy({ append, missionId: LIVE_ATTEMPT_MISSION, brainRunId: ATTEMPT })])).outcome).toBe('COMMITTED');
        }
        return h.store.commitGroup(input);
      },
    });
    const head = await h.store.head(BRAIN, PROJECT);
    expect(await h.importArchive(paidRunArchive(), racing)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'conflicting_history', conflicts: ['the live run holds v1 entry the export does not list: brain:unexported'] });
    expect((await h.store.head(BRAIN, PROJECT))!.sequence).toBe(head!.sequence + 1);
    expect((await h.all()).entities.some((state) => state.entityId.startsWith('archive:'))).toBe(false);
  });

  it('two recoveries of one attempt at once: one imports, the other finds it imported; one history, one RECOVERY trace', async () => {
    const h = await brain();
    await h.live({ entries: LIVE_ATTEMPT_ALL_ENTRIES.slice(0, 2) });
    const [a, b] = await Promise.all([h.importArchive(paidRunArchive()), h.importArchive(JSON.parse(JSON.stringify(paidRunArchive())))]);
    expect([a.outcome, b.outcome].sort()).toEqual(['ALREADY_IMPORTED', 'IMPORTED']);
    const { records, entities } = await h.all();
    expect(entities.filter((state) => state.body.traceClass === 'RECOVERY')).toHaveLength(1);
    expect(entities.filter((state) => state.entityId === juliusArchiveRecoveryEntityId(ATTEMPT, paidRunArchive().integrity.contentHash))).toHaveLength(1);
    expect(new Set(records.map((record) => record.idempotencyKey)).size).toBe(records.length);
    expect(verifyJuliusBrainLedger(BRAIN, records).ok).toBe(true);
  });

  it('a crash after planning writes nothing; the retry imports exactly what a clean import would; a restart and a retry change nothing', async () => {
    const clean = await brain();
    await clean.live({ entries: LIVE_ATTEMPT_ALL_ENTRIES.slice(0, 2) });
    expect((await clean.importArchive(paidRunArchive())).outcome).toBe('IMPORTED');
    const cleanRecords = (await clean.all()).records;

    const h = await brain();
    await h.live({ entries: LIVE_ATTEMPT_ALL_ENTRIES.slice(0, 2) });
    const head = await h.store.head(BRAIN, PROJECT);
    const crashing = delegating(h.store, { async commitGroup() { throw new Error('process killed after planning'); } });
    await expect(h.importArchive(paidRunArchive(), crashing)).rejects.toThrow('process killed after planning');
    expect(await h.store.head(BRAIN, PROJECT)).toEqual(head);

    expect((await h.importArchive(paidRunArchive())).outcome).toBe('IMPORTED');
    expect((await h.all()).records).toEqual(cleanRecords);

    // Restart: the Brain comes back from its export into a new store; the same recovery is a no-op there.
    const bundle = await exportJuliusBrain({ store: h.store, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: NOW });
    const restarted = createJuliusBrainMemoryStore();
    expect(await restoreJuliusBrainFromExport(restarted, JSON.parse(JSON.stringify(bundle)))).toMatchObject({ outcome: 'RESTORED' });
    const restartedHead = await restarted.head(BRAIN, PROJECT);
    expect(await h.importArchive(paidRunArchive(), restarted)).toMatchObject({ outcome: 'ALREADY_IMPORTED', appended: 0, reconciliation: { mode: 'RECONCILED' } });
    expect(await restarted.head(BRAIN, PROJECT)).toEqual(restartedHead);
  });
});
