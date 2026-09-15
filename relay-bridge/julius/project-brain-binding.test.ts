import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { paidRunArchive } from '../../src/relay/mission/julius/julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive, juliusArchiveEntityId } from '../../src/relay/mission/julius/julius-brain-archive-import';
import { juliusPrincipal } from '../../src/relay/mission/julius/julius-brain-contracts';
import { juliusBrainDraftFromLegacy } from '../../src/relay/mission/julius/julius-brain-legacy';
import { createJuliusProjectBrainService } from '../../src/relay/mission/julius/julius-brain-service';
import { createJuliusBrainMemoryStore, type JuliusBrainStore } from '../../src/relay/mission/julius/julius-brain-store';
import { compileJuliusContext, type JuliusBrainEntry, type JuliusTask, type JuliusWorker } from '../../src/relay/mission/julius/julius-runtime';
import type { JuliusBrainAppend, JuliusRunRow } from '../../src/relay/mission/julius/julius-runtime-ports';
import { brainKindFromStored, brainKindToStored } from '../../src/relay/persistence/julius-brain-kinds';
import { createLiveJuliusProjectBrainBinding, juliusProjectBrainIdFor, type JuliusLiveBrainReport } from './project-brain-binding';

const PROJECT = 'prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
const RUN = 'run:julius-live-4:now';
const ARCHIVED_RUN = 'run:julius-live-4:1';
const clock = { now: () => '2026-09-15T12:00:00.000Z' };
const ROLES = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const;

const runRow = (runId: string): JuliusRunRow => ({ runId, missionId: MISSION, projectId: PROJECT, state: 'EXECUTING', cardRevision: 'card', missionContractRevision: 1, projectBrainRevision: 0, version: 1 });

/** `julius_brain_entries`, as the table stores and returns a row. */
function v1Table() {
  const rows: JuliusBrainAppend[] = [];
  const asRow = (append: JuliusBrainAppend): JuliusBrainAppend => ({ ...append, kind: brainKindFromStored(brainKindToStored(append.kind)), occurredAt: new Date(append.occurredAt).toISOString() });
  return {
    rows,
    seed: (append: JuliusBrainAppend) => { rows.push(asRow(append)); },
    writer: { appendBrainEntry: async (append: JuliusBrainAppend) => { if (rows.some((row) => row.entryId === append.entryId)) return false; rows.push(asRow(append)); return true; } },
    reader: {
      brainEntriesForRun: async (runId: string): Promise<readonly JuliusBrainEntry[]> => rows.filter((row) => row.runId === runId).map((row) => ({
        entryId: row.entryId, kind: row.kind, text: row.safeText, taskIds: row.taskId === null ? [] : [row.taskId], allowedRoles: [...ROLES], sensitivity: 'INTERNAL' as const,
      })),
    },
  };
}

const append = (entryId: string, kind: JuliusBrainAppend['kind'], safeText: string, occurredAt = '2026-09-15T10:00:00.000Z'): JuliusBrainAppend =>
  ({ runId: RUN, projectId: PROJECT, taskId: null, workerId: 'julius', entryId, kind, safeText, evidenceIds: [], occurredAt });

function harness(options: { store?: JuliusBrainStore; runs?: Map<string, JuliusRunRow>; budget?: number; stateModeFor?: Parameters<typeof createLiveJuliusProjectBrainBinding>[0]['stateModeFor'] } = {}) {
  const store = options.store ?? createJuliusBrainMemoryStore();
  const table = v1Table();
  const runs = options.runs ?? new Map([[RUN, runRow(RUN)], [ARCHIVED_RUN, runRow(ARCHIVED_RUN)]]);
  const reports: JuliusLiveBrainReport[] = [];
  const bind = () => createLiveJuliusProjectBrainBinding({
    store, clock, projectId: PROJECT, title: 'Julius',
    runs: { loadRun: async (runId) => runs.get(runId) ?? null },
    legacyEntries: async (runId) => table.rows.filter((row) => row.runId === runId),
    contextBudgetCharacters: options.budget, stateModeFor: options.stateModeFor,
    onReport: (report) => reports.push(report),
  });
  return { store, table, runs, reports, bind };
}

const content = { put: async (bytes: Uint8Array) => { const hex = createHash('sha256').update(bytes).digest('hex'); return { contentHash: `sha256:${hex}`, byteSize: bytes.byteLength, storageRef: `cas://sha256/${hex}` }; } };

describe('the prepared live Project Brain binding (not composed)', () => {
  it('bootstrap creates the Brain, re-drives the run\'s v1 entries exactly once, and refuses a Brain that does not verify', async () => {
    const h = harness();
    // The bootstrap seed writes v1 rows with SQL, past the writer port.
    h.table.seed(append('seed:objective', 'OBJECTIVE', 'Implement the trust core'));
    h.table.seed(append('seed:acceptance', 'REQUIREMENT', 'Admission tests pass'));
    expect(await h.bind().bootstrap({ runId: RUN })).toEqual({ outcome: 'READY', created: true });
    expect(await h.bind().bootstrap({ runId: RUN })).toEqual({ outcome: 'READY', created: false });
    expect(h.reports.filter((report) => report.event === 'BOOTSTRAPPED')).toMatchObject([
      { created: true, mirrored: 2, duplicates: 0, refused: 0 },
      { created: false, mirrored: 0, duplicates: 2, refused: 0 },
    ]);

    // A store whose head no longer matches its ledger.
    const lying: JuliusBrainStore = { ...h.store, head: async (brainId, projectId) => { const head = await h.store.head(brainId, projectId); return head && { ...head, chainHash: `sha256:${'f'.repeat(64)}` }; } };
    const refused = harness({ store: lying });
    expect(await refused.bind().bootstrap({ runId: RUN })).toMatchObject({ outcome: 'REFUSED', problems: ['stored head differs from the ledger head'] });
  });

  it('the mirror returns the v1 answer unchanged and builds the same draft the backfill does, so the two never conflict', async () => {
    const h = harness();
    const binding = h.bind();
    await binding.bootstrap({ runId: RUN });
    const writer = binding.wrapWriter(h.table.writer);
    // A domain kind the table stores as another, at a time the table returns in another form.
    const objective = append('brain:objective:1', 'OBJECTIVE', 'Implement the trust core', '2026-09-15T14:00:00+02:00');
    expect(await writer.appendBrainEntry(objective)).toBe(true);
    expect(await writer.appendBrainEntry(objective)).toBe(false);
    expect(h.reports.filter((report) => report.event === 'MIRROR').map((report) => report.event === 'MIRROR' && [report.v1Written, report.outcome])).toEqual([[true, 'MIRRORED'], [false, 'DUPLICATE']]);

    expect(await h.bind().bootstrap({ runId: RUN })).toEqual({ outcome: 'READY', created: false });
    expect(h.reports.at(-1)).toMatchObject({ event: 'BOOTSTRAPPED', mirrored: 0, duplicates: 1, refused: 0 });

    // Without the normalisation, the same entry under the same key is a different history — refused.
    const handle = (await createJuliusProjectBrainService({ store: h.store, clock }).open({ brainId: juliusProjectBrainIdFor(PROJECT), projectId: PROJECT, principal: juliusPrincipal('JULIUS', 'julius') }))!;
    expect(await handle.commit([juliusBrainDraftFromLegacy({ append: objective, missionId: MISSION })])).toMatchObject({ outcome: 'REFUSED', reasonCode: 'idempotency_key_conflict' });
  });

  it('typed context is FRESH by default: after v1, per role, without the run\'s own mirrors, and without the archived run', async () => {
    const h = harness();
    const binding = h.bind();
    h.table.seed(append('seed:objective', 'OBJECTIVE', 'Implement the trust core'));
    await binding.bootstrap({ runId: RUN });
    expect((await importJuliusPaidRunArchive({ store: h.store, brainId: binding.brainId, projectId: PROJECT, archive: paidRunArchive(), content, recordedAt: clock.now() })).outcome).toBe('IMPORTED');
    const handle = (await createJuliusProjectBrainService({ store: h.store, clock }).open({ brainId: binding.brainId, projectId: PROJECT, principal: juliusPrincipal('JULIUS', 'julius') }))!;
    const requirement = await handle.create('REQUIREMENT', { requirementClass: 'FUNCTIONAL', statement: 'Every admission is evidenced', priority: 'MUST', status: 'ACTIVE' }, { key: 'req', scope: { missionId: MISSION } });
    if (requirement.outcome !== 'COMMITTED') throw new Error(requirement.detail);

    const v1 = await h.table.reader.brainEntriesForRun(RUN);
    const entries = await binding.wrapContextReader(h.table.reader).brainEntriesForRun(RUN, PROJECT);
    expect(entries.slice(0, v1.length)).toEqual(v1);
    const typed = entries.slice(v1.length);
    expect(typed.map((entry) => `${entry.allowedRoles.join()}|${entry.entryId}`).sort()).toEqual(ROLES.map((role) => `${role}|brain2:${requirement.receipts[0]!.entityId}:v1`).sort());
    expect(JSON.stringify(typed)).not.toContain('archive:');
    expect(JSON.stringify(typed)).not.toContain('legacy:');
    const context = h.reports.filter((report) => report.event === 'CONTEXT');
    expect(context).toHaveLength(3);
    for (const report of context) expect(report).toMatchObject({ mode: 'FRESH', withheld: null, entries: 1 });
    expect((context[0] as { excluded: Record<string, number> }).excluded.PRIOR_RUN_STATE).toBeGreaterThan(0);

    // A run that declares LEARNING from the archived run is handed its finding.
    const learning = harness({ store: h.store, stateModeFor: (run) => ({ mode: 'LEARNING', missionId: run.missionId, runId: run.runId, learnFrom: { runIds: [ARCHIVED_RUN], kinds: ['FINDING'], requireVerified: false } }) });
    const learned = await learning.bind().wrapContextReader(h.table.reader).brainEntriesForRun(RUN, PROJECT);
    const finding = juliusArchiveEntityId(paidRunArchive().run, 'findings', 'f-budget');
    expect(learned.filter((entry) => entry.entryId === `brain2:${finding}:v1`)).toHaveLength(3);
  });

  it('the v1 compiler drops typed context before anything v1 already carried', async () => {
    const h = harness();
    h.table.seed(append('seed:objective', 'OBJECTIVE', 'Implement the trust core'));
    h.table.seed(append('seed:constraint', 'CONSTRAINT', 'Edit only the trust core file'));
    const binding = h.bind();
    await binding.bootstrap({ runId: RUN });
    const handle = (await createJuliusProjectBrainService({ store: h.store, clock }).open({ brainId: binding.brainId, projectId: PROJECT, principal: juliusPrincipal('JULIUS', 'julius') }))!;
    await handle.create('PROHIBITION', { statement: 'Never persist Python objects as truth', status: 'ACTIVE' }, { key: 'rule', scope: {} });
    const entries = await binding.wrapContextReader(h.table.reader).brainEntriesForRun(RUN, PROJECT);
    const v1 = await h.table.reader.brainEntriesForRun(RUN);
    expect(entries.length).toBeGreaterThan(v1.length);
    const packet = compileJuliusContext({
      missionId: MISSION, task: { taskId: 'task-1' } as JuliusTask, worker: { workerId: 'coder', role: 'CODING_AGENT' } as JuliusWorker,
      entries, maxCharacters: v1.reduce((sum, entry) => sum + entry.text.length, 0),
    });
    expect(packet.sourceEntryIds).toEqual(v1.map((entry) => entry.entryId));
    expect(packet.truncated).toBe(true);
  });

  it('typed context is withheld whole, and said to be, when it cannot be given whole', async () => {
    const tight = harness({ budget: 10 });
    const binding = tight.bind();
    await binding.bootstrap({ runId: RUN });
    const handle = (await createJuliusProjectBrainService({ store: tight.store, clock }).open({ brainId: binding.brainId, projectId: PROJECT, principal: juliusPrincipal('JULIUS', 'julius') }))!;
    await handle.create('CONSTRAINT', { statement: 'A constraint far longer than ten characters', status: 'ACTIVE' }, { key: 'c', scope: { missionId: MISSION } });
    expect(await binding.wrapContextReader(tight.table.reader).brainEntriesForRun(RUN, PROJECT)).toEqual([]);
    expect(tight.reports.filter((report) => report.event === 'CONTEXT').map((report) => report.event === 'CONTEXT' && report.withheld)).toEqual(['AUTHORITY_TRUNCATED', 'AUTHORITY_TRUNCATED', 'AUTHORITY_TRUNCATED']);

    // A live run under an archived run's id.
    const reused = harness();
    const reusedBinding = reused.bind();
    await reusedBinding.bootstrap({ runId: RUN });
    await importJuliusPaidRunArchive({ store: reused.store, brainId: reusedBinding.brainId, projectId: PROJECT, archive: paidRunArchive(), content, recordedAt: clock.now() });
    await reusedBinding.wrapContextReader(reused.table.reader).brainEntriesForRun(ARCHIVED_RUN, PROJECT);
    expect(reused.reports.filter((report) => report.event === 'CONTEXT').map((report) => report.event === 'CONTEXT' && report.withheld)).toEqual(Array(3).fill('STATE_MODE_REFUSED:current_run_is_archived_history'));

    // An unknown run, and a Brain that cannot be read: v1 exactly as it was.
    const broken = harness({ store: { ...createJuliusBrainMemoryStore(), head: async () => { throw new Error('connection terminated'); } }, runs: new Map([[RUN, runRow(RUN)]]) });
    broken.table.seed(append('seed:objective', 'OBJECTIVE', 'Implement the trust core'));
    const v1 = await broken.table.reader.brainEntriesForRun(RUN);
    expect(await broken.bind().wrapContextReader(broken.table.reader).brainEntriesForRun(RUN, PROJECT)).toEqual(v1);
    expect(await broken.bind().wrapContextReader(broken.table.reader).brainEntriesForRun('run:unknown', PROJECT)).toEqual([]);
    expect(broken.reports.map((report) => report.event === 'CONTEXT' && report.withheld)).toEqual([...Array(3).fill('FAILED'), ...Array(3).fill('RUN_NOT_FOUND')]);
  });

  it('a checkpoint pins the verified state the next bootstrap verifies against', async () => {
    const h = harness();
    const binding = h.bind();
    h.table.seed(append('seed:objective', 'OBJECTIVE', 'Implement the trust core'));
    await binding.bootstrap({ runId: RUN });
    expect(await binding.checkpoint('drive ended COMPLETED')).toBe('COMMITTED');
    expect(await h.bind().bootstrap({ runId: RUN })).toEqual({ outcome: 'READY', created: false });
    expect(await harness().bind().checkpoint('no brain yet')).toBe('REFUSED');
  });
});
