import { describe, expect, it } from 'vitest';

import { juliusPrincipal, juliusWorkerPrincipal, type JuliusBrainPrincipal } from './julius-brain-contracts';
import type { JuliusBrainReadGrant } from './julius-brain-policy';
import { compileJuliusBrainContext, juliusBrainContextAsEntries } from './julius-brain-query';
import { createJuliusProjectBrainService, defaultJuliusBrainReadGrant, juliusLink } from './julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities, type JuliusBrainCommitResult } from './julius-brain-store';
import { compileJuliusContext, type JuliusTask, type JuliusWorker } from './julius-runtime';

const PROJECT = 'prj-q';
const BRAIN = 'brain:q';
const MISSION = 'mission:q';
const JULIUS = juliusPrincipal('JULIUS', 'julius');
const CODER = juliusWorkerPrincipal('coder', 'CODING_AGENT');
const REVIEWER = juliusWorkerPrincipal('reviewer', 'INDEPENDENT_REVIEWER');

const ok = (result: JuliusBrainCommitResult): string => {
  if (result.outcome !== 'COMMITTED') throw new Error(`${result.reasonCode}: ${result.detail}`);
  return result.receipts[0]!.entityId;
};

async function brain() {
  let tick = 0;
  const store = createJuliusBrainMemoryStore();
  const service = createJuliusProjectBrainService({ store, clock: { now: () => new Date(Date.parse('2026-09-13T10:00:00Z') + (tick++) * 1000).toISOString() } });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'q', principal: JULIUS });
  const open = async (principal: JuliusBrainPrincipal) => (await service.open({ brainId: BRAIN, projectId: PROJECT, principal }))!;
  const julius = await open(JULIUS);
  const coder = await open(CODER);
  const reviewer = await open(REVIEWER);
  const scope = { missionId: MISSION };
  const ids = {
    mission: ok(await julius.create('MISSION', { missionId: MISSION, title: 'Q', status: 'ACTIVE', missionContract: null, parentProjectId: null }, { key: 'm', scope })),
    objective: ok(await julius.create('OBJECTIVE', { statement: 'Answer queries', successMeasure: null }, { key: 'o', scope })),
    constraint: ok(await julius.create('CONSTRAINT', { statement: 'No network in analysis', status: 'ACTIVE' }, { key: 'c', scope })),
    proposed: ok(await julius.create('CONSTRAINT', { statement: 'Maybe later', status: 'PROPOSED' }, { key: 'c2', scope })),
    otherMission: ok(await julius.create('CONSTRAINT', { statement: 'Belongs elsewhere', status: 'ACTIVE' }, { key: 'c3', scope: { missionId: 'mission:other' } })),
    projectWide: ok(await julius.create('PROHIBITION', { statement: 'Never pickle', status: 'ACTIVE' }, { key: 'p', scope: {} })),
    oldDecision: ok(await julius.create('DECISION', { decisionClass: 'MISSION', statement: 'use files', rationale: 'simple', alternatives: [], status: 'ACTIVE' }, { key: 'd1', scope })),
    evidence: ok(await coder.create('EVIDENCE', { evidenceClass: 'MEASUREMENT', claim: 'fast', summary: 'p95 4ms', status: 'PASSED', verification: 'UNVERIFIED', data: null, juliusEvidenceId: null }, { key: 'e1', scope, entityId: 'evidence:fast' })),
    lowFinding: ok(await reviewer.create('FINDING', { findingClass: 'RISK', severity: 'LOW', statement: 'minor', blocking: false, status: 'OPEN', juliusFindingId: null }, { key: 'f-low', scope })),
    blocking: ok(await reviewer.create('FINDING', { findingClass: 'DEFECT', severity: 'HIGH', statement: 'breaks restart', blocking: true, status: 'OPEN', juliusFindingId: null }, { key: 'f-high', scope })),
    taskNote: ok(await coder.create('OPEN_QUESTION', { question: 'Which port?', blocking: false, status: 'OPEN', answer: null }, { key: 'q', scope: { missionId: MISSION, taskId: 'task-build' } })),
    working: ok(await julius.create('MEMORY_FACT', { statement: 'temporary note', trust: 'UNVERIFIED', expiresAt: '2026-09-13T10:00:30Z' }, { key: 'w', scope, retention: 'WORKING' })),
    trace: ok(await julius.create('TRACE', { traceClass: 'ACTION', summary: 'ticked', facts: {} }, { key: 't', scope })),
  };
  const newDecision = ok(await julius.supersede(ids.oldDecision, 1, { decisionClass: 'MISSION', statement: 'use postgres', rationale: 'durable', alternatives: [], status: 'ACTIVE' }, { key: 'd2' }));
  const contradiction = ok(await reviewer.create('EVIDENCE', { evidenceClass: 'TEST_RESULT', claim: 'slow on CI', summary: 'p95 40ms', status: 'FAILED', verification: 'UNVERIFIED', data: null, juliusEvidenceId: null }, { key: 'e2', scope, links: [juliusLink('CONTRADICTS', ids.evidence)] }));
  return { store, ids: { ...ids, newDecision, contradiction } };
}

const grant = (principal: JuliusBrainPrincipal): JuliusBrainReadGrant => defaultJuliusBrainReadGrant(principal, BRAIN);

describe('relevant context — structured, budgeted, explained', () => {
  it('admits mission authority first, skips proposals, other missions, superseded decisions, traces and expired working memory', async () => {
    const { store, ids } = await brain();
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    const view = compileJuliusBrainContext(entities, { missionId: MISSION, taskId: 'task-build', role: 'CODING_AGENT', grant: grant(CODER), budgetCharacters: 20_000, asOf: '2026-09-13T11:00:00Z' });
    const admitted = view.items.map((item) => item.entityId);
    expect(view.items.slice(0, 4).map((item) => item.reason)).toEqual(['MISSION_AUTHORITY', 'MISSION_AUTHORITY', 'MISSION_AUTHORITY', 'MISSION_AUTHORITY']);
    expect(admitted).toEqual(expect.arrayContaining([ids.mission, ids.objective, ids.constraint, ids.projectWide, ids.newDecision, ids.taskNote]));
    for (const excluded of [ids.proposed, ids.otherMission, ids.oldDecision, ids.trace, ids.working]) expect(admitted).not.toContain(excluded);
    // Blocking and severe findings first.
    const findings = view.items.filter((item) => item.reason === 'OPEN_FINDING').map((item) => item.entityId);
    expect(findings).toEqual([ids.blocking, ids.lowFinding]);
    expect(view.authorityTruncated).toBe(false);
    expect(view.omitted.count).toBe(0);
  });

  it('flags contradicted evidence instead of hiding either side', async () => {
    const { store, ids } = await brain();
    const view = compileJuliusBrainContext(await readAllJuliusBrainEntities(store, BRAIN, PROJECT), { missionId: MISSION, taskId: null, role: 'JULIUS', grant: grant(JULIUS), budgetCharacters: 20_000, asOf: '2026-09-13T10:00:00Z' });
    const fast = view.items.find((item) => item.entityId === ids.evidence)!;
    expect(fast.contradictedBy).toEqual([ids.contradiction]);
    expect(fast.text.startsWith(`[CONTRADICTED by ${ids.contradiction}]`)).toBe(true);
    expect(view.conflicts).toEqual([{ entityId: ids.evidence, contradictedBy: [ids.contradiction] }]);
    expect(view.items.map((item) => item.entityId)).toContain(ids.contradiction);
  });

  it('counts every omission by reason and flags an authority truncation', async () => {
    const { store } = await brain();
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    const view = compileJuliusBrainContext(entities, { missionId: MISSION, taskId: 'task-build', role: 'CODING_AGENT', grant: grant(CODER), budgetCharacters: 200, asOf: '2026-09-13T11:00:00Z' });
    expect(view.characters).toBeLessThanOrEqual(200);
    expect(view.omitted.count).toBeGreaterThan(0);
    expect(Object.values(view.omitted.byReason).reduce((a, b) => a + (b ?? 0), 0)).toBeGreaterThanOrEqual(view.omitted.count);
    expect(view.authorityTruncated).toBe(true);
  });

  it('focus admits history on request, and the hash is stable for the same state', async () => {
    const { store, ids } = await brain();
    const entities = await readAllJuliusBrainEntities(store, BRAIN, PROJECT);
    const request = { missionId: MISSION, taskId: null, role: 'JULIUS' as const, grant: grant(JULIUS), budgetCharacters: 20_000, asOf: '2026-09-13T11:00:00Z', focusEntityIds: [ids.oldDecision] };
    const view = compileJuliusBrainContext(entities, request);
    expect(view.items[0]).toMatchObject({ entityId: ids.oldDecision, reason: 'FOCUS', lifecycle: 'SUPERSEDED' });
    expect(compileJuliusBrainContext([...entities].reverse(), request).contextHash).toBe(view.contextHash);
  });

  it('feeds the existing v1 context compiler without changing it', async () => {
    const { store } = await brain();
    const view = compileJuliusBrainContext(await readAllJuliusBrainEntities(store, BRAIN, PROJECT), { missionId: MISSION, taskId: 'task-build', role: 'CODING_AGENT', grant: grant(CODER), budgetCharacters: 20_000, asOf: '2026-09-13T11:00:00Z' });
    const entries = juliusBrainContextAsEntries(view, ['CODING_AGENT']);
    const task: JuliusTask = { taskId: 'task-build', missionId: MISSION, parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'ACTIVE' };
    const worker: JuliusWorker = { workerId: 'coder', role: 'CODING_AGENT', adapterId: 'a', providerId: 'p', capabilities: ['implement'], taskTypes: ['build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 0, status: 'AVAILABLE' };
    const packet = compileJuliusContext({ missionId: MISSION, task, worker, entries, maxCharacters: 50_000 });
    expect(packet.sourceEntryIds).toHaveLength(entries.length);
    expect(packet.blocks.map((block) => block.text).join('')).toContain('No network in analysis');
  });
});
