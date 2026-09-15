import { describe, expect, it } from 'vitest';

import { juliusPrincipal } from './julius-brain-contracts';
import { backfillJuliusBrainFromLegacy, createJuliusBrainMirroringWriter, type JuliusBrainMirrorReport } from './julius-brain-legacy';
import { createJuliusProjectBrainService } from './julius-brain-service';
import { createJuliusBrainMemoryStore } from './julius-brain-store';
import type { JuliusRunLoop } from './julius-run-loop';
import { cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker } from './julius-runtime-fixtures';
import type { JuliusBrainAppend, JuliusRunRow } from './julius-runtime-ports';

/**
 * THE v1 → v2 BRIDGE, UNDER A REAL RUN LOOP.
 *
 * The harness's store is the in-memory model of the live runtime; its
 * `appendBrainEntry` is replaced by the mirroring decorator exactly as a
 * composition root would wrap the PostgreSQL store. Nothing in the pipeline
 * changes, and the v1 behaviour it already proves must hold unchanged.
 */

const ARCHITECT = worker({ workerId: 'architect', role: 'PROMPT_ARCHITECT', capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'openai', adapterId: 'architect-adapter' });
const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'anthropic', adapterId: 'coder-adapter' });
const REVIEWER = worker({ workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'], providerId: 'hermes', adapterId: 'reviewer-adapter' });
const RUN: JuliusRunRow = { runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY', cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 0, version: 1 };
const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const BUILD_OK = { kind: 'succeed' as const, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] };
const REVIEW_ACCEPT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] };
const capabilityFor = (item: { role: string }) => (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

async function drain(loop: JuliusRunLoop, maxTicks = 16) {
  for (let tick = 0; tick < maxTicks; tick += 1) if ((await loop.tick({ projectId: 'prj-1' })).claimed === 0) return;
}

async function mirroredRun() {
  const harness = createJuliusHarness({
    workers: [{ worker: ARCHITECT, script: [PLAN_OK] }, { worker: CODER, script: [BUILD_OK] }, { worker: REVIEWER, script: [REVIEW_ACCEPT, REVIEW_ACCEPT] }],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1 }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 3 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'Done.', requiredEvidenceTypes: [] }]);

  const brainStore = createJuliusBrainMemoryStore();
  const service = createJuliusProjectBrainService({ store: brainStore, clock: harness.clock });
  await service.initialize({ brainId: 'brain:prj-1', projectId: 'prj-1', title: 'Mirrored', principal: juliusPrincipal('JULIUS', 'julius') });
  const handle = (await service.open({ brainId: 'brain:prj-1', projectId: 'prj-1', principal: juliusPrincipal('JULIUS', 'julius') }))!;
  const reports: JuliusBrainMirrorReport[] = [];
  const v1Appends: JuliusBrainAppend[] = [];
  const inner = { appendBrainEntry: harness.store.appendBrainEntry };
  const mirror = createJuliusBrainMirroringWriter({
    inner: { appendBrainEntry: async (append) => { v1Appends.push(append); return inner.appendBrainEntry(append); } },
    resolve: async (append) => (append.projectId === 'prj-1' ? { handle, missionId: 'msn-1', brainRunId: 'workflow:1/1' } : null),
    onMirror: (report) => reports.push(report),
  });
  (harness.store as { appendBrainEntry: typeof mirror.appendBrainEntry }).appendBrainEntry = mirror.appendBrainEntry;
  return { harness, handle, reports, v1Appends };
}

describe('the v1 Brain writes of a real run, mirrored into the typed ledger', () => {
  it('every v1 decision becomes a typed VERIFICATION decision, scoped and attributed, and v1 is unchanged', async () => {
    const { harness, handle, reports, v1Appends } = await mirroredRun();
    await drain(harness.loop);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');

    const v1 = (await harness.store.brainEntriesForRun('run-1', 'prj-1')).filter((entry) => entry.entryId.startsWith('brain:decision:'));
    expect(v1.length).toBeGreaterThan(0);
    const mirrored = await handle.current('DECISION');
    expect(mirrored.map((state) => state.entityId).sort()).toEqual(v1.map((entry) => `legacy:workflow:1/1:${entry.entryId}`).sort());
    for (const state of mirrored) {
      expect(state.body.decisionClass).toBe('VERIFICATION');
      expect(state.scope).toMatchObject({ missionId: 'msn-1', runId: 'workflow:1/1' });
      expect(state.scope.taskId).not.toBeNull();
      expect(state.provenance.externalRef).toMatch(/^julius_brain_entries:run-1#brain:decision:/);
    }
    expect(reports.every((report) => report.outcome === 'MIRRORED' && report.v1Written)).toBe(true);
    expect((await handle.verify()).ok).toBe(true);

    // A replay of every v1 append mirrors nothing twice.
    const before = (await handle.history()).records.length;
    // A SNAPSHOT: the wrapped writer records every append, replays included,
    // so iterating the live array would never end.
    const originals = [...v1Appends];
    for (const append of originals) await harness.store.appendBrainEntry(append);
    expect((await handle.history()).records.length).toBe(before);
    expect(reports.slice(-originals.length).every((report) => report.outcome === 'DUPLICATE' && !report.v1Written)).toBe(true);
  });

  it('a refused mirror is reported and never fails the v1 write', async () => {
    const { handle } = await mirroredRun();
    const reports: JuliusBrainMirrorReport[] = [];
    const writer = createJuliusBrainMirroringWriter({ inner: { appendBrainEntry: async () => true }, resolve: async () => ({ handle, missionId: null, brainRunId: 'workflow:1/1' }), onMirror: (report) => reports.push(report) });
    const append: JuliusBrainAppend = { runId: 'run-1', projectId: 'prj-1', taskId: null, workerId: 'w', entryId: 'brain:guidance-request:t1', kind: 'HANDOFF', safeText: 'use token=abcdefghijklmnop please', evidenceIds: [], occurredAt: '2026-09-13T10:00:00Z' };
    expect(await writer.appendBrainEntry(append)).toBe(true);
    expect(reports).toEqual([{ entryId: append.entryId, v1Written: true, outcome: 'REFUSED', detail: expect.stringContaining('credential_shaped_content') }]);
    const noBrain = createJuliusBrainMirroringWriter({ inner: { appendBrainEntry: async () => false }, resolve: async () => null, onMirror: (report) => reports.push(report) });
    expect(await noBrain.appendBrainEntry({ ...append, safeText: 'fine' })).toBe(false);
    expect(reports.at(-1)!.outcome).toBe('SKIPPED_NO_BRAIN');
  });

  it('backfill classifies handoffs by the pipeline\'s own id prefixes and is safe to repeat', async () => {
    const { handle } = await mirroredRun();
    const base = { runId: 'run-1', projectId: 'prj-1', workerId: 'w', evidenceIds: [], occurredAt: '2026-09-13T10:00:00Z' } as const;
    const entries: JuliusBrainAppend[] = [
      { ...base, taskId: 't1', entryId: 'brain:research-answer:t1', kind: 'HANDOFF', safeText: 'The file exists.' },
      { ...base, taskId: 't2', entryId: 'brain:guidance-answer:t2:r1', kind: 'HANDOFF', safeText: 'Split the module.' },
      { ...base, taskId: null, entryId: 'seed-objective', kind: 'OBJECTIVE', safeText: 'Print a summary.' },
      { ...base, taskId: null, entryId: 'seed-req', kind: 'REQUIREMENT', safeText: 'Exit 0.' },
      { ...base, taskId: 't3', entryId: 'v1-finding', kind: 'FINDING', safeText: 'Something off.' },
    ];
    expect(await backfillJuliusBrainFromLegacy({ handle, missionId: 'msn-1', brainRunId: 'workflow:1/1', entries })).toEqual({ mirrored: 5, duplicates: 0, refused: [] });
    expect(await backfillJuliusBrainFromLegacy({ handle, missionId: 'msn-1', brainRunId: 'workflow:1/1', entries })).toEqual({ mirrored: 0, duplicates: 5, refused: [] });
    // Another paid attempt of the same contract repeats every v1 entry id: it is another run, not a duplicate.
    expect(await backfillJuliusBrainFromLegacy({ handle, missionId: 'msn-1', brainRunId: 'workflow:1/2', entries })).toEqual({ mirrored: 5, duplicates: 0, refused: [] });
    const byId = new Map((await handle.entities()).map((state) => [state.entityId, state]));
    expect(byId.get('legacy:workflow:1/1:brain:research-answer:t1')!.body).toMatchObject({ handoffClass: 'RESEARCH_ANSWER', fromRole: 'JULIUS', toRole: 'UNKNOWN' });
    expect(byId.get('legacy:workflow:1/1:brain:guidance-answer:t2:r1')!.body).toMatchObject({ handoffClass: 'ARCHITECT_TO_CODER' });
    expect(byId.get('legacy:workflow:1/1:seed-req')!.body).toMatchObject({ requirementClass: 'UNCLASSIFIED', priority: null });
    expect(byId.get('legacy:workflow:1/1:v1-finding')!.kind).toBe('TRACE');
    expect(byId.get('legacy:workflow:1/2:v1-finding')!.scope.runId).toBe('workflow:1/2');
  });
});
