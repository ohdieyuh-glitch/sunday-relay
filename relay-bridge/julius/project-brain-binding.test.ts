import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { paidRunArchive } from '../../src/relay/mission/julius/julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive, juliusArchiveEntityId } from '../../src/relay/mission/julius/julius-brain-archive-import';
import { juliusPrincipal, juliusWorkerPrincipal } from '../../src/relay/mission/julius/julius-brain-contracts';
import { juliusBrainDraftFromLegacy } from '../../src/relay/mission/julius/julius-brain-legacy';
import { createJuliusProjectBrainService } from '../../src/relay/mission/julius/julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, type JuliusBrainStore } from '../../src/relay/mission/julius/julius-brain-store';
import { compileJuliusContext, type JuliusBrainEntry, type JuliusTask, type JuliusWorker } from '../../src/relay/mission/julius/julius-runtime';
import type { JuliusBrainAppend, JuliusRunRow } from '../../src/relay/mission/julius/julius-runtime-ports';
import { brainKindFromStored, brainKindToStored } from '../../src/relay/persistence/julius-brain-kinds';
import { createLiveJuliusProjectBrainBinding, juliusProjectBrainIdFor, type JuliusLiveBrainReport } from './project-brain-binding';

const PROJECT = 'prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
/** The Julius run id: derived from the mission contract, so every paid attempt of it has this one. */
const RUN = 'run:julius-live-4';
/** The Brain run of the attempt under test: its workflow run and attempt. */
const ATTEMPT = 'workflow:35000000000/1';
const ARCHIVED_RUN = 'workflow:34739303313/1';
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

function harness(options: { store?: JuliusBrainStore; runs?: Map<string, JuliusRunRow>; budget?: number; brainRunId?: string; stateModeFor?: Parameters<typeof createLiveJuliusProjectBrainBinding>[0]['stateModeFor'] } = {}) {
  const store = options.store ?? createJuliusBrainMemoryStore();
  const table = v1Table();
  const runs = options.runs ?? new Map([[RUN, runRow(RUN)]]);
  const reports: JuliusLiveBrainReport[] = [];
  const bind = () => createLiveJuliusProjectBrainBinding({
    store, clock, projectId: PROJECT, title: 'Julius',
    runs: { loadRun: async (runId) => runs.get(runId) ?? null },
    legacyEntries: async (runId) => table.rows.filter((row) => row.runId === runId),
    brainRunIdFor: () => options.brainRunId ?? ATTEMPT,
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
    expect(await h.bind().bootstrap({ runId: RUN })).toEqual({ outcome: 'READY', created: true, requirement: 'ADDITIVE', proceed: true });
    expect(await h.bind().bootstrap({ runId: RUN })).toEqual({ outcome: 'READY', created: false, requirement: 'ADDITIVE', proceed: true });
    expect(h.reports.filter((report) => report.event === 'BOOTSTRAPPED')).toMatchObject([
      { created: true, mirrored: 2, duplicates: 0, refused: 0 },
      { created: false, mirrored: 0, duplicates: 2, refused: 0 },
    ]);

    // A store whose head no longer matches its ledger.
    const lying: JuliusBrainStore = { ...h.store, head: async (brainId, projectId) => { const head = await h.store.head(brainId, projectId); return head && { ...head, chainHash: `sha256:${'f'.repeat(64)}` }; } };
    const refused = harness({ store: lying });
    expect(await refused.bind().bootstrap({ runId: RUN })).toMatchObject({ outcome: 'REFUSED', problems: ['stored head differs from the ledger head'], requirement: 'ADDITIVE', proceed: true });
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

    expect(await h.bind().bootstrap({ runId: RUN })).toEqual({ outcome: 'READY', created: false, requirement: 'ADDITIVE', proceed: true });
    expect(h.reports.at(-1)).toMatchObject({ event: 'BOOTSTRAPPED', mirrored: 0, duplicates: 1, refused: 0 });

    // Without the normalisation, the same entry under the same key is a different history — refused.
    const handle = (await createJuliusProjectBrainService({ store: h.store, clock }).open({ brainId: juliusProjectBrainIdFor(PROJECT), projectId: PROJECT, principal: juliusPrincipal('JULIUS', 'julius') }))!;
    expect(await handle.commit([juliusBrainDraftFromLegacy({ append: objective, missionId: MISSION, brainRunId: ATTEMPT })])).toMatchObject({ outcome: 'REFUSED', reasonCode: 'idempotency_key_conflict' });
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
    const learning = harness({ store: h.store, stateModeFor: (run, brainRunId) => ({ mode: 'LEARNING', missionId: run.missionId, runId: brainRunId, learnFrom: { runIds: [ARCHIVED_RUN], kinds: ['FINDING'], requireVerified: false } }) });
    const learned = await learning.bind().wrapContextReader(h.table.reader).brainEntriesForRun(RUN, PROJECT);
    const finding = juliusArchiveEntityId(paidRunArchive().identity, 'findings', 'f-budget');
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

    // A live run claiming an archived attempt's identity.
    const reused = harness({ brainRunId: ARCHIVED_RUN });
    const reusedBinding = reused.bind();
    await reusedBinding.bootstrap({ runId: RUN });
    await importJuliusPaidRunArchive({ store: reused.store, brainId: reusedBinding.brainId, projectId: PROJECT, archive: paidRunArchive(), content, recordedAt: clock.now() });
    await reusedBinding.wrapContextReader(reused.table.reader).brainEntriesForRun(RUN, PROJECT);
    expect(reused.reports.filter((report) => report.event === 'CONTEXT').map((report) => report.event === 'CONTEXT' && report.withheld)).toEqual(Array(3).fill('STATE_MODE_REFUSED:current_run_is_archived_history'));

    // An unknown run, and a Brain that cannot be read: v1 exactly as it was.
    const broken = harness({ store: { ...createJuliusBrainMemoryStore(), head: async () => { throw new Error('connection terminated'); } }, runs: new Map([[RUN, runRow(RUN)]]) });
    broken.table.seed(append('seed:objective', 'OBJECTIVE', 'Implement the trust core'));
    const v1 = await broken.table.reader.brainEntriesForRun(RUN);
    expect(await broken.bind().wrapContextReader(broken.table.reader).brainEntriesForRun(RUN, PROJECT)).toEqual(v1);
    expect(await broken.bind().wrapContextReader(broken.table.reader).brainEntriesForRun('run:unknown', PROJECT)).toEqual([]);
    expect(broken.reports.map((report) => report.event === 'CONTEXT' && report.withheld)).toEqual([...Array(3).fill('FAILED'), ...Array(3).fill('RUN_NOT_FOUND')]);
  });

  it('an unreachable Brain: a FRESH run may proceed unpreserved; a run that needs prior state may not start', async () => {
    const down = (): JuliusBrainStore => {
      const store = createJuliusBrainMemoryStore();
      const fail = async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432'); };
      return { ...store, createBrain: fail, loadBrain: fail, head: fail, commit: fail, commitGroup: fail, records: fail, entities: fail };
    };
    const fresh = harness({ store: down() });
    fresh.table.seed(append('seed:objective', 'OBJECTIVE', 'Implement the trust core'));
    const binding = fresh.bind();
    const unreachable = { failureClass: 'DATABASE_UNAVAILABLE', outcome: 'NOT_APPLIED', retryable: true, code: null };
    expect(await binding.bootstrap({ runId: RUN })).toEqual({ outcome: 'UNAVAILABLE', detail: 'connect ECONNREFUSED 10.0.0.5:5432', failure: unreachable, requirement: 'ADDITIVE', proceed: true });
    // Detached: v1 exactly as it was, and nothing pretends to have reached the Brain.
    expect(await binding.wrapWriter(fresh.table.writer).appendBrainEntry(append('brain:decision:1', 'DECISION', 'ACCEPT'))).toBe(true);
    expect(await binding.wrapContextReader(fresh.table.reader).brainEntriesForRun(RUN, PROJECT)).toEqual(await fresh.table.reader.brainEntriesForRun(RUN));
    expect(await binding.seal({ runId: RUN })).toEqual({ outcome: 'NOT_SEALED', reason: 'BRAIN_DETACHED', detail: null });
    // Nothing can be read, so nothing — least of all PRESERVED — can be claimed.
    expect(await binding.preservation({ runId: RUN })).toEqual({ outcome: 'UNREADABLE', detail: 'connect ECONNREFUSED 10.0.0.5:5432', failure: unreachable });
    expect(fresh.reports.map((report) => report.event)).toEqual(['BRAIN_UNAVAILABLE', 'MIRROR', 'CONTEXT', 'CONTEXT', 'CONTEXT', 'SEAL']);

    const learning = harness({ store: down(), stateModeFor: (run, brainRunId) => ({ mode: 'LEARNING', missionId: run.missionId, runId: brainRunId, learnFrom: { runIds: null, kinds: ['FINDING'], requireVerified: true } }) });
    expect(await learning.bind().bootstrap({ runId: RUN })).toMatchObject({ outcome: 'UNAVAILABLE', requirement: 'REQUIRED', proceed: false });

    // A Brain that does not verify is detached the same way.
    const sound = harness();
    await sound.bind().bootstrap({ runId: RUN });
    const lying: JuliusBrainStore = { ...sound.store, head: async (brainId, projectId) => { const head = await sound.store.head(brainId, projectId); return head && { ...head, chainHash: `sha256:${'f'.repeat(64)}` }; } };
    const continuation = harness({ store: lying, stateModeFor: (run, brainRunId) => ({ mode: 'CONTINUATION', missionId: run.missionId, runId: brainRunId, resumes: ['workflow:34999999999/1'] }) });
    expect(await continuation.bind().bootstrap({ runId: RUN })).toMatchObject({ outcome: 'REFUSED', requirement: 'REQUIRED', proceed: false });

    // The runtime store is the run's authority: no run, no bootstrap at all.
    await expect(harness({ runs: new Map() }).bind().bootstrap({ runId: RUN })).rejects.toThrow('julius_live_brain_run_not_found');
  });

  it('mid-run failure: a FRESH dispatch keeps its v1 context; a dispatch that requires prior state it cannot read is refused, with nothing standing in', async () => {
    const memory = createJuliusBrainMemoryStore();
    let up = true;
    const guard = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => { if (!up) throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5442'), { code: 'ECONNREFUSED' }); return fn(...args); };
    const flaky: JuliusBrainStore = {
      createBrain: guard((identity) => memory.createBrain(identity)), loadBrain: guard((b, p) => memory.loadBrain(b, p)), listBrains: guard((p) => memory.listBrains(p)),
      head: guard((b, p) => memory.head(b, p)), commit: guard((input) => memory.commit(input)), commitGroup: guard((input) => memory.commitGroup(input)),
      records: guard((b, p, q) => memory.records(b, p, q)), entities: guard((b, p, f) => memory.entities(b, p, f)), restore: guard((i, r) => memory.restore(i, r)),
    };
    const learningFor: Parameters<typeof createLiveJuliusProjectBrainBinding>[0]['stateModeFor'] = (run, brainRunId) => ({ mode: 'LEARNING', missionId: run.missionId, runId: brainRunId, learnFrom: { runIds: null, kinds: ['FINDING'], requireVerified: false } });
    const unreachable = { failureClass: 'DATABASE_UNAVAILABLE', outcome: 'NOT_APPLIED', retryable: true, code: 'ECONNREFUSED' };

    // FRESH: the Brain goes away after bootstrap; the dispatch gets v1 exactly, and the failure is classified.
    const fresh = harness({ store: flaky });
    fresh.table.seed(append('seed:objective', 'OBJECTIVE', 'Implement the trust core'));
    const freshBinding = fresh.bind();
    expect((await freshBinding.bootstrap({ runId: RUN })).outcome).toBe('READY');
    up = false;
    expect(await freshBinding.wrapContextReader(fresh.table.reader).brainEntriesForRun(RUN, PROJECT)).toEqual(await fresh.table.reader.brainEntriesForRun(RUN));
    expect(fresh.reports.filter((report) => report.event === 'CONTEXT')).toEqual(ROLES.map((role) => expect.objectContaining({ role, withheld: 'FAILED', failure: unreachable })));
    up = true;

    // LEARNING: the same failure refuses the dispatch; v1 alone is not its context.
    const learning = harness({ store: flaky, stateModeFor: learningFor });
    const learningBinding = learning.bind();
    expect((await learningBinding.bootstrap({ runId: RUN })).outcome).toBe('READY');
    up = false;
    const refused = await learningBinding.wrapContextReader(learning.table.reader).brainEntriesForRun(RUN, PROJECT).catch((error: unknown) => error);
    expect(refused).toMatchObject({ name: 'JuliusBrainRequiredStateUnavailableError', mode: 'LEARNING', failure: unreachable });
    expect(learning.reports.filter((report) => report.event === 'CONTEXT')).toEqual(ROLES.map((role) => expect.objectContaining({ role, mode: 'LEARNING', withheld: 'FAILED', dispatchRefused: true })));
    up = true;
    // Back up: the next dispatch gets its context.
    expect(await learningBinding.wrapContextReader(learning.table.reader).brainEntriesForRun(RUN, PROJECT)).toEqual([]);

    // Detached at bootstrap, or a mode the Brain refuses, or context that cannot be given whole: refused too.
    up = false;
    const detached = harness({ store: flaky, stateModeFor: learningFor });
    const detachedBinding = detached.bind();
    expect(await detachedBinding.bootstrap({ runId: RUN })).toMatchObject({ outcome: 'UNAVAILABLE', proceed: false, failure: unreachable });
    await expect(detachedBinding.wrapContextReader(detached.table.reader).brainEntriesForRun(RUN, PROJECT)).rejects.toThrow(/LEARNING run cannot act without its prior state/);
    up = true;
    const baselineless = harness({ stateModeFor: (run, brainRunId) => ({ mode: 'REGRESSION', missionId: run.missionId, runId: brainRunId, baseline: { runId: 'workflow:34739303313/1', entityCount: 9, throughSequence: 9, snapshotHash: `sha256:${'0'.repeat(64)}` } }) });
    const regression = baselineless.bind();
    await regression.bootstrap({ runId: RUN });
    await expect(regression.wrapContextReader(baselineless.table.reader).brainEntriesForRun(RUN, PROJECT)).rejects.toThrow(/regression_baseline_moved|REGRESSION run cannot act/);
    const tight = harness({ budget: 10, stateModeFor: (run, brainRunId) => ({ mode: 'CONTINUATION', missionId: run.missionId, runId: brainRunId, resumes: ['workflow:34999999999/1'] }) });
    const tightBinding = tight.bind();
    await tightBinding.bootstrap({ runId: RUN });
    const handle = (await createJuliusProjectBrainService({ store: tight.store, clock }).open({ brainId: tightBinding.brainId, projectId: PROJECT, principal: juliusPrincipal('JULIUS', 'julius') }))!;
    await handle.create('CONSTRAINT', { statement: 'A constraint far longer than ten characters', status: 'ACTIVE' }, { key: 'c', scope: { missionId: MISSION } });
    await expect(tightBinding.wrapContextReader(tight.table.reader).brainEntriesForRun(RUN, PROJECT)).rejects.toThrow(/CONTINUATION run cannot act/);
  });

  it('PRESERVED is derived from the Brain: a verified open, every v1 entry held with its content, and a checkpoint covering the seal', async () => {
    const h = harness();
    h.table.seed(append('seed:objective', 'OBJECTIVE', 'Implement the trust core'));
    const binding = h.bind();
    await binding.bootstrap({ runId: RUN });
    await binding.wrapWriter(h.table.writer).appendBrainEntry(append('brain:decision:build-1:ACCEPT:TASK_VERIFIED', 'DECISION', 'ACCEPT'));
    const sealed = await binding.seal({ runId: RUN });
    if (sealed.outcome !== 'SEALED') throw new Error(JSON.stringify(sealed));
    expect(sealed.preservation).toMatchObject({
      brainRunId: ATTEMPT, status: 'PRESERVED', reasons: [],
      evidence: { opened: { juliusRunId: RUN, missionId: MISSION }, sealed: { expectedEntries: 2, writtenEntries: 2, missingEntries: 0 }, checkpoint: { matches: true }, recoveries: [] },
    });
    // Any process can read the same answer back from the Brain alone.
    expect(await h.bind().preservation({ runId: RUN })).toEqual({ outcome: 'DERIVED', preservation: sealed.preservation });
    // A restart of the same attempt replays its open; it is not a second, different run.
    expect(await h.bind().bootstrap({ runId: RUN })).toMatchObject({ outcome: 'READY', created: false });
    // The same attempt identity opened against a different accepted main is not this run's history.
    const other = createLiveJuliusProjectBrainBinding({
      store: h.store, clock, projectId: PROJECT, title: 'Julius', runs: { loadRun: async () => runRow(RUN) }, legacyEntries: async () => [],
      brainRunIdFor: () => ATTEMPT, acceptedMainShaFor: () => 'f'.repeat(40),
    });
    expect(await other.bootstrap({ runId: RUN })).toMatchObject({ outcome: 'REFUSED', proceed: true });
  });

  it('a failed final checkpoint cannot claim PRESERVED', async () => {
    const memory = createJuliusBrainMemoryStore();
    // The checkpoint's commit fails; everything else commits.
    const store: JuliusBrainStore = { ...memory, commit: async (input) => { if (input.drafts.some((draft) => draft.kind === 'CHECKPOINT')) throw new Error('terminating connection due to administrator command'); return memory.commit(input); } };
    const h = harness({ store });
    const binding = h.bind();
    await binding.bootstrap({ runId: RUN });
    await binding.wrapWriter(h.table.writer).appendBrainEntry(append('brain:decision:build-1:ACCEPT:TASK_VERIFIED', 'DECISION', 'ACCEPT'));
    expect(await binding.seal({ runId: RUN })).toEqual({ outcome: 'NOT_SEALED', reason: 'UNAVAILABLE', detail: 'terminating connection due to administrator command', failure: { failureClass: 'NETWORK_PARTIAL', outcome: 'UNKNOWN', retryable: true, code: null } });
    const read = await binding.preservation({ runId: RUN });
    expect(read).toMatchObject({ outcome: 'DERIVED', preservation: { status: 'PARTIALLY_PRESERVED', evidence: { sealed: { missingEntries: 0 }, checkpoint: null }, reasons: ['no checkpoint was committed for the run'] } });
  });

  it('a v1 write that never reached the Brain, or reached it with other content, cannot claim PRESERVED', async () => {
    const memory = createJuliusBrainMemoryStore();
    let up = true;
    const store: JuliusBrainStore = { ...memory, commit: async (input) => { if (!up) throw new Error('connection terminated'); return memory.commit(input); } };
    const h = harness({ store });
    const binding = h.bind();
    await binding.bootstrap({ runId: RUN });
    const writer = binding.wrapWriter(h.table.writer);
    await writer.appendBrainEntry(append('brain:decision:build-1:REPAIR:BLOCKING_FINDINGS', 'DECISION', 'REPAIR'));
    // The Brain goes away for one write: v1 still has it, the Brain does not.
    up = false;
    expect(await writer.appendBrainEntry(append('brain:decision:build-1:ACCEPT:TASK_VERIFIED', 'DECISION', 'ACCEPT'))).toBe(true);
    up = true;
    // And one v1 row whose content the Brain holds differently (a mirror of an older text).
    h.table.rows.push({ ...append('brain:guidance-request:build-1', 'HANDOFF', 'use the ledger'), occurredAt: '2026-09-15T10:00:00.000Z' });
    const handle = (await createJuliusProjectBrainService({ store: memory, clock }).open({ brainId: binding.brainId, projectId: PROJECT, principal: juliusPrincipal('JULIUS', 'julius') }))!;
    await handle.commit([juliusBrainDraftFromLegacy({ append: append('brain:guidance-request:build-1', 'HANDOFF', 'use the old path'), missionId: MISSION, brainRunId: ATTEMPT })]);

    const sealed = await binding.seal({ runId: RUN });
    if (sealed.outcome !== 'SEALED') throw new Error(JSON.stringify(sealed));
    expect(sealed.preservation).toMatchObject({
      status: 'PARTIALLY_PRESERVED', evidence: { sealed: { expectedEntries: 3, writtenEntries: 1, missingEntries: 2 }, checkpoint: { matches: true } },
      reasons: ["2 of the run's 3 v1 entries did not reach the Brain"],
    });
    const seal = (await readAllJuliusBrainEntities(memory, binding.brainId, PROJECT)).find((state) => state.entityId === `run-sealed:${ATTEMPT}`)!;
    expect((seal.body.facts as { missingEntryIds: string }).missingEntryIds).toBe('brain:decision:build-1:ACCEPT:TASK_VERIFIED,brain:guidance-request:build-1');
  });

  it('evidence a lesser principal wrote is not evidence', async () => {
    const h = harness();
    const binding = h.bind();
    await binding.bootstrap({ runId: RUN });
    const coder = (await createJuliusProjectBrainService({ store: h.store, clock }).open({ brainId: binding.brainId, projectId: PROJECT, principal: juliusWorkerPrincipal('coder', 'CODING_AGENT') }))!;
    const forged = await coder.create('TRACE', { traceClass: 'LIFECYCLE', summary: 'sealed, trust me', facts: { expectedEntries: 0, writtenEntries: 0 } }, { key: 'forged-seal', entityId: `run-sealed:${ATTEMPT}`, scope: { missionId: MISSION, runId: ATTEMPT } });
    expect(forged.outcome).toBe('COMMITTED');
    // Julius cannot seal over it, and the forged record never counts.
    expect(await binding.seal({ runId: RUN })).toMatchObject({ outcome: 'NOT_SEALED', reason: 'SEAL_REFUSED' });
    const read = await binding.preservation({ runId: RUN });
    expect(read).toMatchObject({ outcome: 'DERIVED', preservation: { status: 'PARTIALLY_PRESERVED', evidence: { sealed: null } } });
    expect(read.outcome === 'DERIVED' && read.preservation.reasons).toContain('a run-sealed record exists that Julius did not write; it is not evidence');
  });

  it('two paid attempts of one mission contract are two Brain runs, though their Julius run and v1 entry ids are identical', async () => {
    const store = createJuliusBrainMemoryStore();
    const entryId = 'brain:decision:run:julius-live-4:build-1:1';
    // Each attempt has its own disposable runtime database, and so its own v1 table.
    const first = harness({ store, brainRunId: 'workflow:35000000000/1' });
    const firstBinding = first.bind();
    await firstBinding.bootstrap({ runId: RUN });
    expect(await firstBinding.wrapWriter(first.table.writer).appendBrainEntry(append(entryId, 'DECISION', 'REPAIR: the admission tests fail'))).toBe(true);
    const second = harness({ store, brainRunId: 'workflow:35000000000/2' });
    const secondBinding = second.bind();
    await secondBinding.bootstrap({ runId: RUN });
    expect(await secondBinding.wrapWriter(second.table.writer).appendBrainEntry(append(entryId, 'DECISION', 'ACCEPT: the admission tests pass'))).toBe(true);
    for (const h of [first, second]) expect(h.reports.filter((report) => report.event === 'MIRROR').map((report) => report.event === 'MIRROR' && report.outcome)).toEqual(['MIRRORED']);
    const decisions = (await readAllJuliusBrainEntities(store, juliusProjectBrainIdFor(PROJECT), PROJECT)).filter((state) => state.kind === 'DECISION');
    expect(decisions.map((state) => [state.scope.runId, state.body.statement]).sort()).toEqual([
      ['workflow:35000000000/1', 'REPAIR: the admission tests fail'], ['workflow:35000000000/2', 'ACCEPT: the admission tests pass'],
    ]);

    // FRESH attempt 2 is not shaped by attempt 1…
    const fresh = await secondBinding.wrapContextReader(second.table.reader).brainEntriesForRun(RUN, PROJECT);
    expect(JSON.stringify(fresh)).not.toContain('REPAIR: the admission tests fail');
    expect((second.reports.filter((report) => report.event === 'CONTEXT')[0] as { excluded: Record<string, number> }).excluded.PRIOR_RUN_STATE).toBeGreaterThanOrEqual(1);
    // …and a CONTINUATION of attempt 1 is, by name.
    const resumed = harness({ store, brainRunId: 'workflow:35000000000/2', stateModeFor: (run, brainRunId) => ({ mode: 'CONTINUATION', missionId: run.missionId, runId: brainRunId, resumes: ['workflow:35000000000/1'] }) });
    const continued = await resumed.bind().wrapContextReader(second.table.reader).brainEntriesForRun(RUN, PROJECT);
    expect(continued.some((entry) => entry.text.includes('REPAIR: the admission tests fail'))).toBe(true);

    // A Brain run id the root cannot name is a configuration error, not a guess.
    await expect(harness({ store, brainRunId: 'not a valid id' }).bind().bootstrap({ runId: RUN })).rejects.toThrow('julius_live_brain_run_id_invalid');
  });

  it('the seal checkpoint pins the verified state the next bootstrap verifies against; a run never bootstrapped cannot be sealed', async () => {
    const h = harness();
    const binding = h.bind();
    h.table.seed(append('seed:objective', 'OBJECTIVE', 'Implement the trust core'));
    await binding.bootstrap({ runId: RUN });
    expect(await binding.seal({ runId: RUN })).toMatchObject({ outcome: 'SEALED', preservation: { status: 'PRESERVED' } });
    expect(await h.bind().bootstrap({ runId: RUN })).toEqual({ outcome: 'READY', created: false, requirement: 'ADDITIVE', proceed: true });
    expect(await harness().bind().seal({ runId: RUN })).toEqual({ outcome: 'NOT_SEALED', reason: 'NOT_BOOTSTRAPPED', detail: null });
    expect(await harness().bind().preservation({ runId: RUN })).toMatchObject({ outcome: 'DERIVED', preservation: { status: 'NOT_PRESERVED' } });
  });
});
