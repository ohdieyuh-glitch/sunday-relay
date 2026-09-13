import { describe, expect, it } from 'vitest';

import { juliusPrincipal, juliusWorkerPrincipal, type JuliusBrainDraft } from './julius-brain-contracts';
import { handleJuliusBrainApi, type JuliusBrainApiEntity } from './julius-brain-api';
import { checkJuliusEnvironmentSubmission, openJuliusEvaluationSession, submitJuliusEnvironmentResults } from './julius-brain-environment';
import { createJuliusProjectBrainService, juliusLink } from './julius-brain-service';
import { createJuliusBrainMemoryStore } from './julius-brain-store';

const PROJECT = 'prj-api';
const BRAIN = 'brain:api';
const MISSION = 'mission:api';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const USER = juliusPrincipal('USER', 'founder');
const CODER = juliusWorkerPrincipal('coder', 'CODING_AGENT');

async function setup() {
  let tick = 0;
  const clock = { now: () => new Date(Date.parse('2026-09-13T10:00:00Z') + (tick++) * 1_000).toISOString() };
  const store = createJuliusBrainMemoryStore();
  const service = createJuliusProjectBrainService({ store, clock });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'API', principal: JULIUS });
  const julius = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
  const coder = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: CODER }))!;
  const objective = await julius.create('OBJECTIVE', { statement: 'Ship the API', successMeasure: null }, { key: 'o', scope: { missionId: MISSION } });
  const evidence = await coder.create('EVIDENCE', { evidenceClass: 'OBSERVATION', claim: 'routes answer', summary: 'ok', status: 'PASSED', verification: 'UNVERIFIED', data: null, juliusEvidenceId: null }, { key: 'e', scope: { missionId: MISSION } });
  if (objective.outcome !== 'COMMITTED' || evidence.outcome !== 'COMMITTED') throw new Error('seed');
  const api = (principal: typeof USER, request: Parameters<typeof handleJuliusBrainApi>[2]) => handleJuliusBrainApi({ service, store, clock }, principal, request);
  return { store, api, objectiveId: objective.receipts[0]!.entityId, evidenceId: evidence.receipts[0]!.entityId };
}

describe('the Project Brain API contract', () => {
  it('an overview tells the UI what a user may edit, from the same policy the planner enforces', async () => {
    const { api, objectiveId, evidenceId } = await setup();
    const overview = await api(USER, { op: 'overview', brainId: BRAIN, projectId: PROJECT, missionId: MISSION });
    expect(overview.status).toBe(200);
    const sections = (overview.body as { sections: Record<string, JuliusBrainApiEntity[]> }).sections;
    const objective = sections.MISSION!.find((entity) => entity.entityId === objectiveId)!;
    const evidence = sections.EVIDENCE!.find((entity) => entity.entityId === evidenceId)!;
    expect(objective).toMatchObject({ editable: true, revisableFields: '*' });
    expect(evidence).toMatchObject({ editable: false, revisableFields: [] });
    expect((await api(USER, { op: 'surface' })).status).toBe(200);
  });

  it('a user edit is governed: accepted where editable, 403 where system-owned, 409 when stale, idempotent on replay', async () => {
    const { api, objectiveId, evidenceId } = await setup();
    const edit = { op: 'revise' as const, brainId: BRAIN, projectId: PROJECT, entityId: objectiveId, expectedVersion: 1, body: { statement: 'Ship the API this week', successMeasure: 'all routes documented' }, idempotencyKey: 'user-edit-1' };
    const accepted = await api(USER, edit);
    expect(accepted.status).toBe(200);
    expect((accepted.body as { entity: JuliusBrainApiEntity }).entity).toMatchObject({ version: 2, updatedBy: { kind: 'USER', id: 'founder' } });
    expect((await api(USER, edit)).status).toBe(200);
    expect((await api(USER, { ...edit, idempotencyKey: 'user-edit-2', body: { statement: 'stale', successMeasure: null } })).status).toBe(409);
    const systemOwned = await api(USER, { op: 'revise', brainId: BRAIN, projectId: PROJECT, entityId: evidenceId, expectedVersion: 1, body: { evidenceClass: 'OBSERVATION', claim: 'routes answer', summary: 'ok', status: 'PASSED', verification: 'VERIFIED', data: null, juliusEvidenceId: null }, idempotencyKey: 'user-verify' });
    expect(systemOwned.status).toBe(403);
    expect((await api(USER, { op: 'create', brainId: BRAIN, projectId: PROJECT, kind: 'TRACE', body: { traceClass: 'ACTION', summary: 'x', facts: {} }, missionId: MISSION, idempotencyKey: 't' })).status).toBe(403);
    expect((await api(USER, { op: 'entity', brainId: BRAIN, projectId: PROJECT, entityId: 'nope' })).status).toBe(404);
    expect((await api(USER, { op: 'overview', brainId: 'brain:missing', projectId: PROJECT })).status).toBe(404);
  });

  it('serves history, provenance, context and export; export needs authority', async () => {
    const { api, objectiveId } = await setup();
    expect(((await api(USER, { op: 'history', brainId: BRAIN, projectId: PROJECT })).body as { records: unknown[] }).records).toHaveLength(2);
    expect((await api(USER, { op: 'provenance', brainId: BRAIN, projectId: PROJECT, entityId: objectiveId })).status).toBe(200);
    const context = await api(CODER, { op: 'context', brainId: BRAIN, projectId: PROJECT, missionId: MISSION, taskId: null, role: 'CODING_AGENT', budgetCharacters: 4_000, asOf: '2026-09-13T11:00:00Z' });
    expect((context.body as { items: { reason: string }[] }).items[0]!.reason).toBe('MISSION_AUTHORITY');
    const markdown = await api(USER, { op: 'export', brainId: BRAIN, projectId: PROJECT, format: 'markdown' });
    expect(markdown.status).toBe(200);
    expect(String(markdown.body)).toContain('# Project Brain — API');
    expect((await api(CODER, { op: 'export', brainId: BRAIN, projectId: PROJECT, format: 'json' })).status).toBe(403);
  });
});

describe('evaluation sessions — the primitive a future GVE uses', () => {
  async function session() {
    const { store, objectiveId, evidenceId } = await setup();
    const opened = await openJuliusEvaluationSession({
      store, brainId: BRAIN, projectId: PROJECT, issuedBy: JULIUS, environmentId: 'gve-castle', environmentRunId: 'gve-run-7',
      missionId: MISSION, taskId: null, readKinds: ['OBJECTIVE', 'EVIDENCE'], writeKinds: ['EVAL', 'EVIDENCE'], maxRecords: 5,
      issuedAt: '2026-09-13T10:30:00Z', expiresAt: '2026-09-13T12:00:00Z',
    });
    const evalDraft = (overrides: { snapshot?: string; run?: string } = {}): JuliusBrainDraft => ({
      kind: 'EVAL', op: 'CREATE', entityId: 'eval:gve-run-7:1', expectedVersion: 0,
      body: {
        evaluationName: 'arena-verification', target: { targetKind: 'ENTITY', reference: objectiveId },
        inputs: [{ name: 'brain-context', reference: opened.sessionId, contentHash: overrides.snapshot ?? opened.context.snapshotHash }],
        outcome: 'PASS', score: 9, maxScore: 10, metrics: [{ name: 'rounds', value: 3, unit: null }], evaluator: 'gve-castle',
        reproducibility: { seed: 7, codeHash: null, inputsHash: null, environmentHash: null, commit: null, command: null, environmentRunId: overrides.run ?? 'gve-run-7' },
      },
      links: [juliusLink('SUPPORTS', evidenceId)], scope: { missionId: MISSION, runId: null, taskId: null }, retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL',
      provenance: { source: 'tool_observed', provider: null, model: null, tool: 'gve-castle', commit: null, externalRef: null, executionId: 'gve-run-7' },
      idempotencyKey: 'gve-run-7:eval-1', occurredAt: '2026-09-13T11:00:00Z',
    });
    return { store, opened, evalDraft };
  }

  it('admits results that cite the exact snapshot and run they were given', async () => {
    const { store, opened, evalDraft } = await session();
    expect(opened.principal).toMatchObject({ kind: 'ENVIRONMENT', grantId: 'environment-grant:gve-run-7' });
    expect(opened.context.entities.map((state) => state.kind).sort()).toEqual(['EVIDENCE', 'OBJECTIVE']);
    const result = await submitJuliusEnvironmentResults({ store, session: opened, drafts: [evalDraft()], recordedAt: '2026-09-13T11:00:01Z' });
    expect(result.outcome).toBe('COMMITTED');
  });

  it('refuses a result about a different snapshot, a different run, or outside its grant', async () => {
    const { store, opened, evalDraft } = await session();
    expect(checkJuliusEnvironmentSubmission(opened, [evalDraft({ snapshot: `sha256:${'f'.repeat(64)}` })])).toEqual(['drafts[0]: must cite the context snapshot it evaluated against']);
    expect(checkJuliusEnvironmentSubmission(opened, [evalDraft({ run: 'gve-run-8' })])).toContain('drafts[0]: reproducibility.environmentRunId must be gve-run-7');
    const decision: JuliusBrainDraft = { ...evalDraft(), kind: 'DECISION', entityId: 'decision:gve', idempotencyKey: 'gve-decision', body: { decisionClass: 'MISSION', statement: 'the environment decides', rationale: 'no', alternatives: [], status: 'ACTIVE' }, links: [] };
    expect(await submitJuliusEnvironmentResults({ store, session: opened, drafts: [decision], recordedAt: '2026-09-13T11:00:01Z' })).toMatchObject({ outcome: 'REFUSED', reasonCode: 'grant_kind_not_permitted' });
    expect(await submitJuliusEnvironmentResults({ store, session: opened, drafts: [evalDraft()], recordedAt: '2026-09-13T12:30:00Z' })).toMatchObject({ outcome: 'REFUSED', reasonCode: 'grant_expired' });
    await expect(openJuliusEvaluationSession({ ...opened, store, issuedBy: USER, readKinds: [], writeKinds: [], maxRecords: 1, issuedAt: opened.issuedAt, expiresAt: opened.expiresAt, taskId: null })).rejects.toThrow('julius_evaluation_session_requires_julius');
  });
});
