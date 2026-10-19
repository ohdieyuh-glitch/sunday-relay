import { describe, expect, it } from 'vitest';

import { JuliusRuntimeApi, type JuliusApiIdentity } from './julius-runtime-api';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import type { JuliusBrainEntry } from './julius-runtime';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * WHAT A RESTART KEEPS — for the things this session added.
 *
 * The chaos suite already proves the runtime's own restart contract: a crash at
 * every transaction boundary, nothing executed twice, a resumed run reaching the
 * same state. What it could not prove is anything about records that did not
 * exist when it was written: the context integrity decision on a snapshot, the
 * measurement columns on a trajectory row, the slot view a client draws. Each of
 * those is a claim a restart could silently falsify — a decision recomputed
 * differently, a cost that was only ever in one process's memory, a slot that
 * reads NEVER_DISPATCHED after the process that dispatched it died.
 *
 * `createJuliusHarness({ store })` is the harness's own restart: fresh workers,
 * a fresh id epoch, the SAME durable rows. Every case below runs a mission in
 * process A, discards A, and asks process B — through the same API a client
 * uses — what it can see.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'openai', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'anthropic', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'hermes', adapterId: 'reviewer-adapter',
});

const scope = { projectId: 'prj-1' };
const IDENTITY: JuliusApiIdentity = { tenantId: 'tenant', projectId: 'prj-1', actorId: 'operator', scopes: ['run:read'] };
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');
const ALL_ROLES: JuliusBrainEntry['allowedRoles'] = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'];

const PLAN_OK = { kind: 'succeed' as const, usdMicros: null, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan.' }] };
const BUILD_PRICED = { kind: 'succeed' as const, usdMicros: 608_861, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Green.' }] };
const REVIEW_OK = { kind: 'succeed' as const, usdMicros: null, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'Fine.' }] };

const workers = () => [
  { worker: ARCHITECT, script: [PLAN_OK] },
  { worker: CODER, script: [BUILD_PRICED] },
  { worker: REVIEWER, script: [REVIEW_OK, REVIEW_OK] },
];
const policies = {
  card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1 }),
  verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 1 }),
  capabilityFor,
};

/** Process A: seed a hostile-enough brain, run the mission to completion. */
async function processA(): Promise<JuliusHarness> {
  const a = createJuliusHarness({ workers: workers(), ...policies, contextCharacterBudget: 700 });
  a.store.seedRun(RUN);
  seedTaskContractInto(a.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  a.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  a.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  a.store.seedBrain('run-1', [
    { entryId: 'brain:contract', kind: 'CONSTRAINT', text: 'Edit only inside the workspace.', taskIds: [], allowedRoles: ALL_ROLES, sensitivity: 'INTERNAL',
      provenance: { workerId: 'julius', recordedAt: '2026-09-27T01:00:00.000Z', evidenceIds: [] } },
    { entryId: 'brain:finding', kind: 'FINDING', text: 'The migration must run before the deploy.', taskIds: [], allowedRoles: ALL_ROLES, sensitivity: 'INTERNAL',
      provenance: { workerId: 'reviewer', recordedAt: '2026-09-27T02:00:00.000Z', evidenceIds: ['evidence:migration'] } },
    ...Array.from({ length: 20 }, (_v, i): JuliusBrainEntry => ({
      entryId: `brain:noise-${String(i).padStart(2, '0')}`, kind: 'HANDOFF',
      text: `Note ${i}: the migration probably does not need to run first. ${'recollection '.repeat(8)}`,
      taskIds: [], allowedRoles: ALL_ROLES, sensitivity: 'INTERNAL',
      provenance: { workerId: 'coder', recordedAt: '2026-09-27T03:00:00.000Z', evidenceIds: [] },
    })),
    { entryId: 'brain:secret', kind: 'ARTIFACT', text: 'deploy token: hunter2', taskIds: [], allowedRoles: ALL_ROLES, sensitivity: 'SECRET',
      provenance: { workerId: 'julius', recordedAt: '2026-09-27T03:00:00.000Z', evidenceIds: [] } },
  ]);
  for (let tick = 0; tick < 20; tick += 1) {
    if ((await a.loop.tick(scope)).claimed === 0) break;
  }
  return a;
}

/** Process B: the same durable rows, nothing else. */
const processB = (a: JuliusHarness): JuliusHarness =>
  createJuliusHarness({ workers: workers(), ...policies, store: a.store, contextCharacterBudget: 700 });

const apiOf = (h: JuliusHarness) => new JuliusRuntimeApi({
  store: h.store as never, timeline: h.store as never,
  approvers: { mayApprove: async () => false }, clock: h.clock,
});

describe('a restart keeps what this session made durable', () => {
  it('ran to completion in process A, so there is something to survive', async () => {
    const a = await processA();
    expect((await a.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
  });

  it('keeps the context integrity decision, and recompiles it identically', async () => {
    const a = await processA();
    const coderDispatch = a.adapters.get('coder-adapter')!.dispatches.at(0)!;
    const before = a.store.contexts().find((s) => s.contextId === coderDispatch.contextId)!;
    expect(before.integrityVersion, 'A recorded a decision').toBe('julius-context-integrity.v1');
    expect(before.integrityExcludedEntryIds).toContain('brain:secret');
    expect(before.sourceEntryIds.slice(0, 2)).toEqual(['brain:contract', 'brain:finding']);

    const b = processB(a);
    // B reads A's snapshot from the store — the decision was not in A's memory.
    const kept = b.store.contexts().find((s) => s.contextId === coderDispatch.contextId)!;
    expect(kept.integrityExcludedEntryIds).toEqual(before.integrityExcludedEntryIds);
    expect(kept.integrityEvictedEntryIds).toEqual(before.integrityEvictedEntryIds);
    expect(kept.contentHash).toBe(before.contentHash);
    // And nothing was dispatched twice: B has a completed run and no work to claim.
    expect((await b.loop.tick(scope)).claimed).toBe(0);
    expect(b.adapters.get('coder-adapter')!.dispatches, 'B re-executed nothing').toHaveLength(0);
  });

  it('keeps the measurement columns the evals read', async () => {
    const a = await processA();
    const b = processB(a);
    const rows = b.store.trajectory().filter((e) => e.kind === 'DISPATCH' && e.outcome === 'COMPLETED');
    expect(rows.length).toBeGreaterThan(2);
    const coder = rows.find((e) => e.workerId === 'coder')!;
    expect(coder.providerId).toBe('anthropic');
    expect(coder.usdMicros, 'the reported cost outlives the process that reported it').toBe(608_861);
    for (const row of rows.filter((e) => e.workerId !== 'coder')) {
      expect(row.usdMicros, `${row.taskId}: silence is still null after a restart, not zero`).toBeNull();
    }
  });

  it('serves the same slot view to a client after the restart as before it', async () => {
    const a = await processA();
    const before = await apiOf(a).inspectSlots(IDENTITY, 'run-1');
    const b = processB(a);
    const after = await apiOf(b).inspectSlots(IDENTITY, 'run-1');
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) throw new Error('unreachable');
    // A client that polled across the restart must see no change at all.
    expect(after.value).toEqual(before.value);
    const coder = after.value.find((s) => s.role === 'CODING_AGENT')!;
    expect(coder.state, 'a slot that finished before the restart is not NEVER_DISPATCHED after it').toBe('IDLE');
    expect(coder.knownUsdMicros).toBe(608_861);
    expect(coder.costComplete).toBe(true);
    const reviewer = after.value.find((s) => s.role === 'INDEPENDENT_REVIEWER')!;
    expect(reviewer.costComplete, 'and a floor is still a floor').toBe(false);
  });

  it('keeps the brain the run wrote, with provenance, for the next mission to weigh', async () => {
    const a = await processA();
    const b = processB(a);
    const authored = (await b.store.brainEntriesForRun('run-1', 'prj-1'))
      .filter((e) => e.entryId.startsWith('brain:decision:'));
    expect(authored.length).toBeGreaterThan(0);
    for (const entry of authored) {
      expect(entry.provenance?.workerId, 'attribution survives, so standing can be derived again').toBeTruthy();
    }
  });
});
