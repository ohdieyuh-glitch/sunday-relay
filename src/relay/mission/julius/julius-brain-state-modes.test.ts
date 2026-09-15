import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { paidRunArchive } from './julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive, juliusArchiveEntityId } from './julius-brain-archive-import';
import { juliusPrincipal } from './julius-brain-contracts';
import { createJuliusBrainEvaluationContext, exportJuliusBrain } from './julius-brain-export';
import { createJuliusBrainKeywordRetriever, juliusBrainSemanticCandidates } from './julius-brain-retrieval';
import { createJuliusProjectBrainService, defaultJuliusBrainReadGrant } from './julius-brain-service';
import {
  compileJuliusBrainContextForMode,
  pinJuliusBrainRegressionBaseline,
  selectJuliusBrainEntitiesForMode,
  type JuliusBrainStateModePolicy,
} from './julius-brain-state-modes';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, type JuliusBrainCommitResult } from './julius-brain-store';

const BRAIN = 'brain:julius';
const PROJECT = 'prj-julius-live-4';
const MISSION = 'mission:julius-live-4';
const ARCHIVED_RUN = 'workflow:34739303313/1';
const PREVIOUS_RUN = 'run:julius-live-4:prev';
const CURRENT_RUN = 'run:julius-live-4:now';
const JULIUS = juliusPrincipal('JULIUS', 'julius');

const ok = (result: JuliusBrainCommitResult): string => {
  if (result.outcome !== 'COMMITTED') throw new Error(`${result.reasonCode}: ${result.detail}`);
  return result.receipts[0]!.entityId;
};

async function brainWithHistory() {
  const store = createJuliusBrainMemoryStore();
  const service = createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-15T10:00:00.000Z' } });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'Julius', principal: JULIUS });
  const julius = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
  const bytes = new Map<string, Uint8Array>();
  const imported = await importJuliusPaidRunArchive({
    store, brainId: BRAIN, projectId: PROJECT, archive: paidRunArchive(), recordedAt: '2026-09-15T10:00:00.000Z',
    content: { put: async (content) => { const hex = createHash('sha256').update(content).digest('hex'); bytes.set(hex, content); return { contentHash: `sha256:${hex}`, byteSize: content.byteLength, storageRef: `cas://sha256/${hex}` }; } },
  });
  if (imported.outcome !== 'IMPORTED') throw new Error(JSON.stringify(imported));
  const ids = {
    projectRule: ok(await julius.create('PROHIBITION', { statement: 'Never persist Python objects as truth', status: 'ACTIVE' }, { key: 'project-rule', scope: {} })),
    objective: ok(await julius.create('OBJECTIVE', { statement: 'Implement the Project Brain v2 trust core', successMeasure: null }, { key: 'objective', scope: { missionId: MISSION } })),
    constraint: ok(await julius.create('CONSTRAINT', { statement: 'Edit only the trust core file', status: 'ACTIVE' }, { key: 'constraint', scope: { missionId: MISSION } })),
    missionHandoff: ok(await julius.create('HANDOFF', { handoffClass: 'OTHER', fromRole: 'JULIUS', toRole: 'CODING_AGENT', summary: 'Last week we tried a different allocation', openQuestions: [] }, { key: 'mission-handoff', scope: { missionId: MISSION } })),
    otherMission: ok(await julius.create('CONSTRAINT', { statement: 'Another mission rule', status: 'ACTIVE' }, { key: 'other', scope: { missionId: 'mission:other' } })),
    prevHandoff: ok(await julius.create('HANDOFF', { handoffClass: 'JULIUS_CONTINUATION', fromRole: 'JULIUS', toRole: 'CODING_AGENT', summary: 'Resume from the failing admission test', openQuestions: [] }, { key: 'prev-handoff', scope: { missionId: MISSION, runId: PREVIOUS_RUN } })),
    prevFact: ok(await julius.create('MEMORY_FACT', { statement: 'The admission tests take 2 seconds', trust: 'UNVERIFIED', expiresAt: null }, { key: 'prev-fact', scope: { missionId: MISSION, runId: PREVIOUS_RUN } })),
    currentQuestion: ok(await julius.create('OPEN_QUESTION', { question: 'Which provenance values are valid?', blocking: false, status: 'OPEN', answer: null }, { key: 'current-question', scope: { missionId: MISSION, runId: CURRENT_RUN } })),
  };
  const archived = (await readAllJuliusBrainEntities(store, BRAIN, PROJECT)).filter((state) => state.scope.runId === ARCHIVED_RUN).map((state) => state.entityId);
  return { store, julius, ids, archived, imported };
}

const request = { taskId: null, role: 'CODING_AGENT' as const, grant: defaultJuliusBrainReadGrant(juliusPrincipal('WORKER', 'coder', { role: 'CODING_AGENT' }), BRAIN), budgetCharacters: 50_000, asOf: '2026-09-15T12:00:00.000Z' };

describe('state modes — retention is not retrieval authority', () => {
  it('FRESH: the archived paid run is retained and auditable, yet nothing of it can reach the run', async () => {
    const { store, julius, ids, archived } = await brainWithHistory();
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    const policy: JuliusBrainStateModePolicy = { mode: 'FRESH', missionId: MISSION, runId: CURRENT_RUN };
    const selection = selectJuliusBrainEntitiesForMode(entities, policy);
    if (selection.outcome !== 'SELECTED') throw new Error(selection.detail);
    expect(selection.admitted.map((item) => `${item.admission}:${item.entity.entityId}`).sort()).toEqual([
      `AUTHORITY:${ids.constraint}`, `AUTHORITY:${ids.objective}`, `AUTHORITY:${ids.projectRule}`, `CURRENT_RUN:${ids.currentQuestion}`,
    ].sort());
    expect(selection.excluded).toEqual({ PRIOR_RUN_STATE: archived.length + 2, MISSION_LEVEL_STATE: 1, OTHER_MISSION: 1 });

    const view = compileJuliusBrainContextForMode(entities, request, policy);
    if ('outcome' in view) throw new Error(view.detail);
    const inContext = view.context.items.map((item) => item.entityId);
    for (const id of archived) expect(inContext).not.toContain(id);
    expect(view.priorState).toEqual({ resumed: [], learned: [] });

    // A fuzzy search WOULD surface the archive if the mode did not stand in the way…
    const query = 'coder ESTIMATE_NO_LEDGER allocation stopped before implementing';
    const retriever = createJuliusBrainKeywordRetriever();
    expect(juliusBrainSemanticCandidates({ retriever, query, entities, grant: request.grant, missionId: MISSION, limit: 5 })).toContain(juliusArchiveEntityId(paidRunArchive().run, 'findings', 'f-budget'));
    // …and under FRESH it cannot.
    const freshOnly = selection.admitted.map((item) => item.entity);
    expect(juliusBrainSemanticCandidates({ retriever, query, entities: freshOnly, grant: request.grant, missionId: MISSION, limit: 5 }).filter((id) => archived.includes(id))).toEqual([]);

    // RETAINED: the archive is in the Brain's history and in its export, untouched.
    const bundle = (await exportJuliusBrain({ store, brainId: BRAIN, projectId: PROJECT, exportedBy: JULIUS, exportedAt: '2026-09-15T12:00:00.000Z' }))!;
    for (const id of archived) expect(bundle.entities.some((state) => state.entityId === id)).toBe(true);
    expect((await julius.history({ limit: 500 })).records.filter((record) => record.scope.runId === ARCHIVED_RUN)).toHaveLength(archived.length);
  });

  it('CONTINUATION: the resumed run and the mission\'s own state return; other prior runs do not', async () => {
    const { store, ids, archived } = await brainWithHistory();
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    const view = compileJuliusBrainContextForMode(entities, request, { mode: 'CONTINUATION', missionId: MISSION, runId: CURRENT_RUN, resumes: [PREVIOUS_RUN] });
    if ('outcome' in view) throw new Error(view.detail);
    expect(view.priorState.resumed).toEqual(expect.arrayContaining([ids.prevHandoff, ids.prevFact, ids.missionHandoff]));
    expect(view.excluded).toEqual({ PRIOR_RUN_STATE: archived.length, OTHER_MISSION: 1 });
    for (const id of archived) expect(view.context.items.map((item) => item.entityId)).not.toContain(id);
  });

  it('LEARNING: only the selected kinds from the named run, and only verified evidence when required', async () => {
    const { store, julius, archived } = await brainWithHistory();
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    const run = paidRunArchive().run;
    const finding = juliusArchiveEntityId(run, 'findings', 'f-budget');
    const failedTest = juliusArchiveEntityId(run, 'evidence', 'ev-build');
    const strict: JuliusBrainStateModePolicy = { mode: 'LEARNING', missionId: MISSION, runId: CURRENT_RUN, learnFrom: { runIds: [ARCHIVED_RUN], kinds: ['FINDING', 'EVIDENCE'], requireVerified: true } };
    const selected = selectJuliusBrainEntitiesForMode(entities, strict);
    if (selected.outcome !== 'SELECTED') throw new Error(selected.detail);
    const learned = selected.admitted.filter((item) => item.admission === 'LEARNED').map((item) => item.entity.entityId);
    expect(learned).toEqual([finding]);
    expect(selected.excluded.UNVERIFIED).toBe(7);
    // Every other archived kind, plus the mission's run-less HANDOFF: considered, and not learnable.
    expect(selected.excluded.NOT_LEARNABLE).toBe(archived.length - 8 + 1);
    expect(selected.excluded.PRIOR_RUN_STATE).toBe(2);

    // Once the reviewer verifies the archived test evidence, strict LEARNING admits it.
    const reviewer = julius; // Julius may set verification on evidence it did not produce.
    const state = entities.find((candidate) => candidate.entityId === failedTest)!;
    expect((await reviewer.revise(failedTest, { ...state.body, verification: 'VERIFIED' }, { key: 'verify-archived-test', expectedVersion: 1 })).outcome).toBe('COMMITTED');
    const after = selectJuliusBrainEntitiesForMode(await readAllJuliusBrainEntities(store, BRAIN, PROJECT), strict);
    if (after.outcome !== 'SELECTED') throw new Error(after.detail);
    expect(after.admitted.filter((item) => item.admission === 'LEARNED').map((item) => item.entity.entityId).sort()).toEqual([failedTest, finding].sort());

    const view = compileJuliusBrainContextForMode(await readAllJuliusBrainEntities(store, BRAIN, PROJECT), request, strict);
    if ('outcome' in view) throw new Error(view.detail);
    expect([...view.priorState.learned].sort()).toEqual([failedTest, finding].sort());
  });

  it('REGRESSION: the pinned baseline is handed over for comparison, never as guidance, and refused once it moves', async () => {
    const { store, julius, archived } = await brainWithHistory();
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    const baseline = pinJuliusBrainRegressionBaseline(entities, ARCHIVED_RUN);
    expect(baseline.entityCount).toBe(archived.length);
    const policy: JuliusBrainStateModePolicy = { mode: 'REGRESSION', missionId: MISSION, runId: CURRENT_RUN, baseline };
    const view = compileJuliusBrainContextForMode(entities, request, policy);
    if ('outcome' in view) throw new Error(view.detail);
    expect(view.baseline!.map((state) => state.entityId).sort()).toEqual([...archived].sort());
    for (const id of archived) expect(view.context.items.map((item) => item.entityId)).not.toContain(id);

    const finding = juliusArchiveEntityId(paidRunArchive().run, 'findings', 'f-budget');
    const state = entities.find((candidate) => candidate.entityId === finding)!;
    expect((await julius.revise(finding, { ...state.body, status: 'RESOLVED' }, { key: 'resolve-archived-finding', expectedVersion: 1 })).outcome).toBe('COMMITTED');
    expect(compileJuliusBrainContextForMode(await readAllJuliusBrainEntities(store, BRAIN, PROJECT), request, policy)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'regression_baseline_moved' });
  });

  it('a live run cannot take the id of an archived run, under any mode', async () => {
    const { store } = await brainWithHistory();
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    const policies: JuliusBrainStateModePolicy[] = [
      { mode: 'FRESH', missionId: MISSION, runId: ARCHIVED_RUN },
      { mode: 'CONTINUATION', missionId: MISSION, runId: ARCHIVED_RUN, resumes: [PREVIOUS_RUN] },
      { mode: 'LEARNING', missionId: MISSION, runId: ARCHIVED_RUN, learnFrom: { runIds: null, kinds: ['FINDING'], requireVerified: false } },
      { mode: 'REGRESSION', missionId: MISSION, runId: ARCHIVED_RUN, baseline: pinJuliusBrainRegressionBaseline(entities, PREVIOUS_RUN) },
    ];
    for (const policy of policies) {
      expect(selectJuliusBrainEntitiesForMode(entities, policy)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'current_run_is_archived_history' });
    }
  });

  it('a snapshot carries no edge into state the mode withholds', async () => {
    const { store, julius, ids } = await brainWithHistory();
    const finding = juliusArchiveEntityId(paidRunArchive().run, 'findings', 'f-budget');
    // A prior run's judgment pointing AT an admitted authority record, and a current-run record pointing at the archive.
    const prior = ok(await julius.create('EVIDENCE', {
      evidenceClass: 'OBSERVATION', claim: 'the constraint was unworkable last time', summary: 'prior run', status: 'FAILED', verification: 'UNVERIFIED', data: {}, juliusEvidenceId: null,
    }, { key: 'prior-contradiction', scope: { missionId: MISSION, runId: PREVIOUS_RUN }, links: [{ relation: 'CONTRADICTS', target: ids.constraint, targetVersion: null }] }));
    const current = ok(await julius.create('OPEN_QUESTION', { question: 'Does the archived finding still apply?', blocking: false, status: 'OPEN', answer: null }, {
      key: 'current-link', scope: { missionId: MISSION, runId: CURRENT_RUN }, links: [{ relation: 'RELATES_TO', target: finding, targetVersion: null }],
    }));
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    expect(entities.find((state) => state.entityId === ids.constraint)!.inbound.map((edge) => edge.source)).toContain(prior);

    const selection = selectJuliusBrainEntitiesForMode(entities, { mode: 'FRESH', missionId: MISSION, runId: CURRENT_RUN });
    if (selection.outcome !== 'SELECTED') throw new Error(selection.detail);
    const snapshot = createJuliusBrainEvaluationContext({
      brainId: BRAIN, entities: selection.admitted.map((item) => item.entity), head: (await store.head(BRAIN, PROJECT))!, grant: request.grant,
      consumerRunId: 'exec-edges', createdAt: '2026-09-15T12:00:00.000Z', stateMode: { mode: selection.mode, policyHash: selection.policyHash, excluded: selection.excluded },
    });
    const held = new Set(snapshot.entities.map((state) => state.entityId));
    expect(held.has(ids.constraint) && held.has(current)).toBe(true);
    for (const state of snapshot.entities) {
      for (const link of state.links) expect(held.has(link.target)).toBe(true);
      for (const edge of state.inbound) expect(held.has(edge.source)).toBe(true);
    }
    expect(snapshot.entities.find((state) => state.entityId === ids.constraint)!.inbound).toEqual([]);
    expect(snapshot.withheldEdges).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(snapshot)).not.toContain(prior);
    expect(JSON.stringify(snapshot)).not.toContain(finding);
  });

  it('refuses a policy that does not say what it means', async () => {
    const { store } = await brainWithHistory();
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    expect(selectJuliusBrainEntitiesForMode(entities, { mode: 'CONTINUATION', missionId: MISSION, runId: CURRENT_RUN, resumes: [] })).toMatchObject({ outcome: 'REFUSED', reasonCode: 'invalid_state_mode_policy' });
    expect(selectJuliusBrainEntitiesForMode(entities, { mode: 'LEARNING', missionId: MISSION, runId: CURRENT_RUN, learnFrom: { runIds: null, kinds: ['TRACE'], requireVerified: false } })).toMatchObject({ outcome: 'REFUSED', detail: 'learnFrom.kinds: TRACE is not learnable' });
    expect(selectJuliusBrainEntitiesForMode(entities, { mode: 'FRESH', missionId: MISSION, runId: '' })).toMatchObject({ outcome: 'REFUSED' });
  });
});
