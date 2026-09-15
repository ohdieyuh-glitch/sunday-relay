import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { paidRunArchive, paidRunArchiveBody } from './julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive, juliusArchiveEntityId, sealJuliusPaidRunArchiveExport, type JuliusPaidRunArchiveExport } from './julius-brain-archive-import';
import { juliusPrincipal } from './julius-brain-contracts';
import { juliusBrainDraftFromLegacy } from './julius-brain-legacy';
import {
  deriveJuliusBrainRunPreservation,
  juliusArchiveRecoveryEntityId,
  juliusRunOpenedBody,
  juliusRunOpenedEntityId,
  juliusRunPreservedCheckpointLabel,
  juliusRunSealedBody,
  juliusRunSealedEntityId,
} from './julius-brain-preservation';
import { createJuliusBrainKeywordRetriever, juliusBrainSemanticCandidates } from './julius-brain-retrieval';
import { createJuliusProjectBrainService, defaultJuliusBrainReadGrant } from './julius-brain-service';
import { compileJuliusBrainContextForMode, pinJuliusBrainRegressionBaseline, selectJuliusBrainEntitiesForMode } from './julius-brain-state-modes';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, readAllJuliusBrainRecords } from './julius-brain-store';
import type { JuliusBrainAppend } from './julius-runtime-ports';

/**
 * ONE WORKFLOW ATTEMPT REACHES THE BRAIN ONCE, WHICHEVER PATH IT TAKES.
 *
 * The live mirror is simulated with the exact pure pieces the prepared binding
 * uses (open marker, legacy drafts, seal, run checkpoint), so these proofs hold
 * for what the binding writes, without importing the bridge.
 */

const BRAIN = 'brain:prj-julius-live-4';
const PROJECT = 'prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
const SHA = '0845c593aa1ef2b7d1c4e8f6a09b3c2d5e7f8a91';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const ATTEMPT_1 = 'workflow:34739303313/1';
const ATTEMPT_2 = 'workflow:34739303313/2';
const CURRENT = 'workflow:34739303313/3';
const content = { put: async (bytes: Uint8Array) => { const hex = createHash('sha256').update(bytes).digest('hex'); return { contentHash: `sha256:${hex}`, byteSize: bytes.byteLength, storageRef: `cas://sha256/${hex}` }; } };

/** The v1 entries the archive fixture lists, as the live runtime would have appended them. */
const V1: Readonly<Record<string, Pick<JuliusBrainAppend, 'kind' | 'taskId' | 'safeText'>>> = {
  'seed:constraint': { kind: 'CONSTRAINT', taskId: null, safeText: 'Edit only the trust core file' },
  'brain:decision:plan-1:ACCEPT:TASK_VERIFIED': { kind: 'DECISION', taskId: 'plan-1', safeText: 'ACCEPT (TASK_VERIFIED): The plan is reviewed and accepted.' },
  'brain:guidance-request:build-1': { kind: 'HANDOFF', taskId: 'build-1', safeText: 'Which ledger settles a hosted dispatch?' },
  'brain:decision:build-1:REPAIR:BLOCKING_FINDINGS': { kind: 'DECISION', taskId: 'build-1', safeText: 'REPAIR (BLOCKING_FINDINGS): the budget stopped the build.' },
  'brain:research-answer:build-1': { kind: 'HANDOFF', taskId: 'build-1', safeText: 'Not in the archive.' },
};

async function brain() {
  const store = createJuliusBrainMemoryStore();
  const service = createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T12:00:00.000Z' } });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
  const julius = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
  const importArchive = (archive: JuliusPaidRunArchiveExport) => importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: PROJECT, archive, content, recordedAt: '2026-09-15T12:00:00.000Z' });
  const all = async () => ({ records: await readAllJuliusBrainRecords(store, BRAIN, PROJECT), entities: await readAllJuliusBrainEntities(store, BRAIN, PROJECT) });
  const derive = async (brainRunId: string) => deriveJuliusBrainRunPreservation({ brainId: BRAIN, brainRunId, ...(await all()) });

  /** What the prepared binding writes for a live attempt. */
  const live = async (brainRunId: string, options: { entries: readonly string[]; seal?: number; checkpoint?: boolean; juliusRunId?: string; acceptedMainSha?: string | null }) => {
    const scope = { missionId: MISSION, runId: brainRunId };
    const opened = await julius.create('TRACE', juliusRunOpenedBody({ brainRunId, juliusRunId: options.juliusRunId ?? 'run:julius-live-4', missionId: MISSION, acceptedMainSha: options.acceptedMainSha === undefined ? SHA : options.acceptedMainSha }), { key: juliusRunOpenedEntityId(brainRunId), entityId: juliusRunOpenedEntityId(brainRunId), scope });
    expect(opened.outcome).toBe('COMMITTED');
    for (const entryId of options.entries) {
      const append: JuliusBrainAppend = { runId: 'run:julius-live-4', projectId: PROJECT, workerId: 'julius', entryId, evidenceIds: [], occurredAt: '2026-09-13T05:05:00.000Z', ...V1[entryId]! };
      expect((await julius.commit([juliusBrainDraftFromLegacy({ append, missionId: MISSION, brainRunId })])).outcome).toBe('COMMITTED');
    }
    if (options.seal !== undefined) {
      await julius.create('TRACE', juliusRunSealedBody({ brainRunId, expectedEntries: options.seal, writtenEntries: options.entries.length, missingEntryIds: [] }), { key: juliusRunSealedEntityId(brainRunId), entityId: juliusRunSealedEntityId(brainRunId), scope });
    }
    if (options.checkpoint) await julius.checkpoint(juliusRunPreservedCheckpointLabel(brainRunId));
  };
  return { store, julius, importArchive, all, derive, live };
}

const ALL_FOUR = ['seed:constraint', 'brain:decision:plan-1:ACCEPT:TASK_VERIFIED', 'brain:guidance-request:build-1', 'brain:decision:build-1:REPAIR:BLOCKING_FINDINGS'];
const decisionsOf = (entities: Awaited<ReturnType<Awaited<ReturnType<typeof brain>>['all']>>['entities'], runId: string) =>
  entities.filter((state) => state.kind === 'DECISION' && state.scope.runId === runId).map((state) => String(state.body.statement)).sort();

describe('live mirror and archive recovery: one attempt, one history', () => {
  it('FULLY PRESERVED: the archive import is refused, writes nothing, and is refused again', async () => {
    const h = await brain();
    await h.live(ATTEMPT_1, { entries: ALL_FOUR, seal: 4, checkpoint: true });
    expect((await h.derive(ATTEMPT_1)).status).toBe('PRESERVED');
    const head = await h.store.head(BRAIN, PROJECT);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await h.importArchive(paidRunArchive())).toMatchObject({ outcome: 'REFUSED', reasonCode: 'attempt_already_preserved', preservation: { status: 'PRESERVED' } });
      expect(await h.store.head(BRAIN, PROJECT)).toEqual(head);
    }
  });

  it('PARTIALLY PRESERVED: recovery adds only what is missing, links what the live run already holds, and repeats as a no-op', async () => {
    const h = await brain();
    // The run opened and mirrored two entries, then its Brain went away: no seal, no checkpoint.
    await h.live(ATTEMPT_1, { entries: ['seed:constraint', 'brain:decision:plan-1:ACCEPT:TASK_VERIFIED'] });
    expect((await h.derive(ATTEMPT_1)).status).toBe('PARTIALLY_PRESERVED');

    const result = await h.importArchive(paidRunArchive());
    if (result.outcome !== 'IMPORTED') throw new Error(JSON.stringify(result));
    expect(result.reconciliation).toEqual({ mode: 'RECONCILED', preservationBefore: 'PARTIALLY_PRESERVED', recoveryEntityId: juliusArchiveRecoveryEntityId(ATTEMPT_1, paidRunArchive().integrity.contentHash) });
    // seed:constraint and the plan-1 decision entry are held live; dec-plan is that same decision; the build-1 entry is its review.
    expect(result.represented).toEqual({ entriesByReview: 1, entriesByLiveMirror: 2, reviewsByLiveMirror: 1 });

    const { entities } = await h.all();
    // Two decisions happened in attempt 1, and the Brain holds exactly two: the live one for plan-1, the recovered one for build-1.
    expect(decisionsOf(entities, ATTEMPT_1)).toEqual(['ACCEPT (TASK_VERIFIED): The plan is reviewed and accepted.', 'REPAIR (BLOCKING_FINDINGS) on build-1'].sort());
    expect(entities.some((state) => state.entityId === juliusArchiveEntityId(paidRunArchive().identity, 'reviews', 'dec-plan'))).toBe(false);
    expect(entities.filter((state) => state.entityId.startsWith('archive:34739303313/1:brainEntries:')).map((state) => (state.body.facts as { entryId: string }).entryId)).toEqual(['brain:guidance-request:build-1']);
    // The recovery is auditable: mode, basis, counts, and the live records it relied on.
    const recovery = entities.find((state) => state.entityId === result.reconciliation!.recoveryEntityId)!;
    expect(recovery).toMatchObject({ createdBy: juliusPrincipal('JULIUS', 'julius:archive-importer'), body: { traceClass: 'RECOVERY', facts: { mode: 'RECONCILED', preservationBefore: 'PARTIALLY_PRESERVED', representedEntriesByLiveMirror: 2, representedReviewsByLiveMirror: 1, liveRecordsBefore: 3 } } });
    expect(recovery.links.filter((link) => link.relation === 'RELATES_TO').map((link) => link.target).sort()).toEqual([
      `legacy:${ATTEMPT_1}:brain:decision:plan-1:ACCEPT:TASK_VERIFIED`, `legacy:${ATTEMPT_1}:seed:constraint`, juliusRunOpenedEntityId(ATTEMPT_1),
    ].sort());
    // Recovery never turns a live run PRESERVED; it is listed beside it.
    expect(await h.derive(ATTEMPT_1)).toMatchObject({ status: 'PARTIALLY_PRESERVED', evidence: { recoveries: [{ entityId: result.reconciliation!.recoveryEntityId }] } });
    expect((await h.store.head(BRAIN, PROJECT))!.sequence).toBe((await h.all()).records.length);

    // Idempotent: the same recovery again writes nothing.
    const head = await h.store.head(BRAIN, PROJECT);
    expect(await h.importArchive(JSON.parse(JSON.stringify(paidRunArchive())))).toMatchObject({ outcome: 'ALREADY_IMPORTED', appended: 0, reconciliation: { mode: 'RECONCILED' } });
    expect(await h.store.head(BRAIN, PROJECT)).toEqual(head);
    // No silent overwrite: a different history of the same attempt, correctly sealed, is refused.
    const rewritten = sealJuliusPaidRunArchiveExport({ ...paidRunArchiveBody(), evidence: paidRunArchiveBody().evidence.map((item, i) => (i === 2 ? { ...item, status: 'PASSED' as const } : item)) });
    expect(await h.importArchive(rewritten)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'idempotency_key_conflict' });
    expect(await h.store.head(BRAIN, PROJECT)).toEqual(head);
  });

  it('a live write to the same attempt between the read and the commit makes the import plan again, not duplicate', async () => {
    const memory = createJuliusBrainMemoryStore();
    let raced = false;
    const store: typeof memory = {
      ...memory,
      commitGroup: async (input) => {
        if (!raced && input.runGuard !== undefined) {
          raced = true;
          // The live mirror records attempt 1's plan-1 decision just as the import is about to commit.
          const append: JuliusBrainAppend = { runId: 'run:julius-live-4', projectId: PROJECT, workerId: 'julius', entryId: 'brain:decision:plan-1:ACCEPT:TASK_VERIFIED', evidenceIds: [], occurredAt: '2026-09-13T05:45:00.000Z', ...V1['brain:decision:plan-1:ACCEPT:TASK_VERIFIED']! };
          expect((await memory.commit({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS, recordedAt: '2026-09-15T12:00:00.000Z', grant: null, drafts: [juliusBrainDraftFromLegacy({ append, missionId: MISSION, brainRunId: ATTEMPT_1 })] })).outcome).toBe('COMMITTED');
        }
        return memory.commitGroup(input);
      },
    };
    await createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T12:00:00.000Z' } }).initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
    const result = await importJuliusPaidRunArchive({ store, brainId: BRAIN, projectId: PROJECT, archive: paidRunArchive(), content, recordedAt: '2026-09-15T12:00:00.000Z' });
    expect(raced).toBe(true);
    // Planned first as a reconstruction; the guard refused it; planned again as a reconciliation with the new live record.
    expect(result).toMatchObject({ outcome: 'IMPORTED', reconciliation: { mode: 'RECONCILED', preservationBefore: 'PARTIALLY_PRESERVED' }, represented: { reviewsByLiveMirror: 1 } });
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    expect(entities.filter((state) => state.kind === 'DECISION' && String(state.body.statement).startsWith('ACCEPT (TASK_VERIFIED)'))).toHaveLength(1);
  });

  it('a history that contradicts the live run is refused, never merged', async () => {
    const cases: readonly [string, Parameters<Awaited<ReturnType<typeof brain>>['live']>[1], string][] = [
      ['a live entry the export does not list', { entries: ['seed:constraint', 'brain:research-answer:build-1'] }, 'the live run holds v1 entry the export does not list: brain:research-answer:build-1'],
      ['another accepted main', { entries: ['seed:constraint'], acceptedMainSha: 'f'.repeat(40) }, `the live run executed ${'f'.repeat(40)}; the export says ${SHA}`],
      ['another Julius run', { entries: [], juliusRunId: 'run:julius-live-5' }, 'the live run was Julius run run:julius-live-5; the export says run:julius-live-4'],
      ['a seal that counted differently', { entries: ['seed:constraint'], seal: 7 }, 'the live run sealed 7 v1 entries; the export lists 4'],
    ];
    for (const [, live, conflict] of cases) {
      const h = await brain();
      await h.live(ATTEMPT_1, live);
      const head = await h.store.head(BRAIN, PROJECT);
      const refused = await h.importArchive(paidRunArchive());
      expect(refused).toMatchObject({ outcome: 'REFUSED', reasonCode: 'conflicting_history', conflicts: [conflict] });
      expect(await h.store.head(BRAIN, PROJECT)).toEqual(head);
    }
  });

  it('NOT PRESERVED: the archive reconstructs the whole attempt; another attempt is judged on its own', async () => {
    const h = await brain();
    // Attempt 2 was preserved live; attempt 1 left nothing durable.
    await h.live(ATTEMPT_2, { entries: ALL_FOUR, seal: 4, checkpoint: true });
    const result = await h.importArchive(paidRunArchive());
    expect(result).toMatchObject({ outcome: 'IMPORTED', reconciliation: { mode: 'RECONSTRUCTED', preservationBefore: 'NOT_PRESERVED' }, represented: { entriesByLiveMirror: 0, reviewsByLiveMirror: 0, entriesByReview: 2 } });
    const { entities } = await h.all();
    expect(decisionsOf(entities, ATTEMPT_1)).toEqual(['ACCEPT (TASK_VERIFIED) on plan-1, by INDEPENDENT_REVIEWER', 'REPAIR (BLOCKING_FINDINGS) on build-1'].sort());
    expect(await h.importArchive(paidRunArchive({ attempt: 2 }))).toMatchObject({ outcome: 'REFUSED', reasonCode: 'attempt_already_preserved' });
  });

  it('recovery does not broaden retrieval: FRESH stays isolated; CONTINUATION, LEARNING and REGRESSION see only what they name', async () => {
    const h = await brain();
    await h.live(ATTEMPT_1, { entries: ['seed:constraint', 'brain:decision:plan-1:ACCEPT:TASK_VERIFIED'] });
    expect((await h.importArchive(paidRunArchive())).outcome).toBe('IMPORTED');
    expect((await h.importArchive(paidRunArchive({ attempt: 2 }))).outcome).toBe('IMPORTED');
    await h.julius.create('OBJECTIVE', { statement: 'Implement the trust core', successMeasure: null }, { key: 'objective', scope: { missionId: MISSION } });
    const { entities } = await h.all();
    const prior = entities.filter((state) => state.scope.runId === ATTEMPT_1 || state.scope.runId === ATTEMPT_2);
    const request = { taskId: null, role: 'CODING_AGENT' as const, grant: defaultJuliusBrainReadGrant(juliusPrincipal('WORKER', 'coder', { role: 'CODING_AGENT' }), BRAIN), budgetCharacters: 50_000, asOf: '2026-09-15T12:00:00.000Z' };

    // FRESH: every recovered and live record of both prior attempts is withheld, and fuzzy search over what FRESH admits finds none of it.
    const fresh = selectJuliusBrainEntitiesForMode(entities, { mode: 'FRESH', missionId: MISSION, runId: CURRENT });
    if (fresh.outcome !== 'SELECTED') throw new Error(fresh.detail);
    expect(fresh.admitted.filter((item) => item.entity.scope.runId !== null)).toEqual([]);
    expect(fresh.excluded.PRIOR_RUN_STATE).toBe(prior.length);
    const retriever = createJuliusBrainKeywordRetriever();
    const query = 'coder ESTIMATE_NO_LEDGER allocation stopped before implementing';
    expect(juliusBrainSemanticCandidates({ retriever, query, entities, grant: request.grant, missionId: MISSION, limit: 5 }).length).toBeGreaterThan(0);
    expect(juliusBrainSemanticCandidates({ retriever, query, entities: fresh.admitted.map((item) => item.entity), grant: request.grant, missionId: MISSION, limit: 5 })).toEqual([]);

    // CONTINUATION of attempt 1: its live and recovered history, as one — each decision once — and nothing of attempt 2.
    const continued = selectJuliusBrainEntitiesForMode(entities, { mode: 'CONTINUATION', missionId: MISSION, runId: CURRENT, resumes: [ATTEMPT_1] });
    if (continued.outcome !== 'SELECTED') throw new Error(continued.detail);
    const resumed = continued.admitted.filter((item) => item.admission === 'RESUMED_RUN').map((item) => item.entity);
    expect(resumed.every((state) => state.scope.runId === ATTEMPT_1)).toBe(true);
    expect(resumed.filter((state) => state.kind === 'DECISION').map((state) => String(state.body.statement)).sort()).toEqual(['ACCEPT (TASK_VERIFIED): The plan is reviewed and accepted.', 'REPAIR (BLOCKING_FINDINGS) on build-1'].sort());
    const view = compileJuliusBrainContextForMode(entities, request, { mode: 'CONTINUATION', missionId: MISSION, runId: CURRENT, resumes: [ATTEMPT_1] });
    if ('outcome' in view) throw new Error(view.detail);
    expect(view.context.items.filter((item) => item.text.includes('plan is reviewed and accepted'))).toHaveLength(1);

    // LEARNING from attempt 1, findings only: exactly the recovered finding.
    const learned = selectJuliusBrainEntitiesForMode(entities, { mode: 'LEARNING', missionId: MISSION, runId: CURRENT, learnFrom: { runIds: [ATTEMPT_1], kinds: ['FINDING'], requireVerified: false } });
    if (learned.outcome !== 'SELECTED') throw new Error(learned.detail);
    expect(learned.admitted.filter((item) => item.admission === 'LEARNED').map((item) => item.entity.entityId)).toEqual([juliusArchiveEntityId(paidRunArchive().identity, 'findings', 'f-budget')]);

    // REGRESSION against attempt 1: the baseline holds its live and recovered records, handed over separately, never as guidance.
    const baseline = pinJuliusBrainRegressionBaseline(entities, ATTEMPT_1);
    const regression = compileJuliusBrainContextForMode(entities, request, { mode: 'REGRESSION', missionId: MISSION, runId: CURRENT, baseline });
    if ('outcome' in regression) throw new Error(regression.detail);
    const baselineIds = regression.baseline!.map((state) => state.entityId);
    expect(baselineIds).toContain(`legacy:${ATTEMPT_1}:brain:decision:plan-1:ACCEPT:TASK_VERIFIED`);
    expect(baselineIds).toContain(juliusArchiveEntityId(paidRunArchive().identity, 'findings', 'f-budget'));
    for (const id of baselineIds) expect(regression.context.items.map((item) => item.entityId)).not.toContain(id);
  });
});
