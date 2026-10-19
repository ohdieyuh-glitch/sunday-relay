import { describe, expect, it } from 'vitest';

import { createJuliusMemoryStore, type JuliusMemoryStore } from './julius-memory-store';
import { createJuliusContextSnapshot } from './julius-context-snapshot';
import {
  juliusTaskContractBindingDigest,
  lockJuliusTaskContract,
  mayDispatchUnderContract,
  reviseJuliusTaskContract,
  type JuliusTaskContract,
} from './julius-task-contract';

/**
 * THE DURABLE SIDE OF THE TASK CONTRACT.
 *
 * `julius-task-contract.test.ts` proves what a contract MEANS. This proves what
 * the store guarantees, and the properties worth proving are the ones an
 * in-memory model can silently lack:
 *
 *   a revision is IMMUTABLE — a replay writes nothing, and a different proposal
 *   at a stored revision is refused rather than overwriting terms someone holds;
 *   at most ONE revision is locked, and a lock only ever moves forward;
 *   a locked row whose terms no longer hash to its binding is CORRUPT, not
 *   current, and is refused on read.
 *
 * The same cases run against real PostgreSQL in
 * `src/relay/persistence/real-infra-julius.test.ts`, where the lock is a partial
 * unique index rather than a check this file can see. Both are needed: the model
 * is what every other Julius test composes, so a model that disagreed with the
 * database would make every one of them prove the wrong thing.
 */

const RUN = {
  runId: 'run-1', missionId: 'mission-1', projectId: 'prj-1', state: 'EXECUTING' as const,
  cardRevision: 'card-1', missionContractRevision: 3, projectBrainRevision: 0, version: 1,
};

const contract = (overrides: Partial<JuliusTaskContract> = {}): JuliusTaskContract => ({
  contractId: 'contract-1', runId: 'run-1', taskId: 'run-1:build',
  missionContractRevision: 3, contractRevision: 1,
  objective: 'Add a deterministic slug helper and prove it.',
  responsibilityBoundary: 'Implementation and its unit tests only.',
  requiredInputs: ['the locked plan'], expectedOutputs: ['a unified diff'],
  inScope: ['src/slug.ts'], outOfScope: ['package.json'],
  blockingAcceptanceCriteria: [{ criterionId: 'AC-1', statement: 'slug("A B") === "a-b"', requiredEvidenceTypes: ['TEST'] }],
  requiredEvidence: ['TEST'], requiredChecks: ['npm test'],
  permittedPaths: ['src/slug.ts'], prohibitedActions: [], dependencyTaskIds: ['run-1:plan'],
  reviewCriteria: ['Does the diff satisfy AC-1?'], failureConditions: ['the suite does not pass'],
  repairRules: [], budget: { ceilingUsdMicros: 5_000_000, maxRepairRounds: 3 },
  stoppingCondition: 'Stop when the suite passes.',
  state: 'DRAFT', bindingDigest: null, lockedAt: null, lockedByEvaluatorId: null,
  ...overrides,
});

const AT = '2026-09-08T00:00:00.000Z';

function storeWithRun(): JuliusMemoryStore {
  const store = createJuliusMemoryStore();
  store.seedRun(RUN);
  return store;
}

const put = (store: JuliusMemoryStore, value: JuliusTaskContract) =>
  store.putTaskContract({ projectId: 'prj-1', contract: value, occurredAt: AT });

const lock = (store: JuliusMemoryStore, value: JuliusTaskContract, evaluatorId = 'evaluator-1') =>
  store.lockTaskContract({
    projectId: 'prj-1', contractId: value.contractId, contractRevision: value.contractRevision,
    bindingDigest: juliusTaskContractBindingDigest(value), lockedAt: AT, evaluatorId,
  });

describe('storing a contract revision', () => {
  it('stores a draft and reads it back as the task’s current contract', async () => {
    const store = storeWithRun();
    expect(await put(store, contract())).toBe(true);
    const loaded = await store.loadTaskContract({ projectId: 'prj-1', taskId: 'run-1:build' });
    expect(loaded?.contractRevision).toBe(1);
    expect(loaded?.state).toBe('DRAFT');
  });

  it('a replay of the same revision writes nothing and is not an error', async () => {
    const store = storeWithRun();
    expect(await put(store, contract())).toBe(true);
    expect(await put(store, contract())).toBe(false);
    expect(await store.taskContractRevisions({ projectId: 'prj-1', taskId: 'run-1:build' })).toHaveLength(1);
  });

  it('DIFFERENT terms at a stored revision are refused, not merged', async () => {
    // Two parties would otherwise hold different documents under one revision
    // number, and every binding comparison between them would pass.
    const store = storeWithRun();
    await put(store, contract());
    await expect(put(store, contract({ inScope: ['src/everything.ts'] })))
      .rejects.toThrow('julius_task_contract_revision_conflict');
  });

  it('refuses a SECOND contract for one task at a revision — one agreement governs a task', async () => {
    // Production's `julius_task_contract_one_per_task` index refuses this; the
    // model must too, or a task could be bound to two agreements at once and
    // every "which contract governs" answer would depend on read order.
    const store = storeWithRun();
    await put(store, contract());
    await expect(put(store, contract({ contractId: 'contract-2' })))
      .rejects.toThrow('julius_task_contract_one_per_task');
  });

  it('refuses a contract for a run this project does not own', async () => {
    const store = storeWithRun();
    expect(await store.putTaskContract({ projectId: 'prj-other', contract: contract(), occurredAt: AT })).toBe(false);
    expect(await store.loadTaskContract({ projectId: 'prj-other', taskId: 'run-1:build' })).toBeNull();
  });

  it('a task with no contract reads null — a fact, not a failure', async () => {
    const store = storeWithRun();
    expect(await store.loadTaskContract({ projectId: 'prj-1', taskId: 'run-1:build' })).toBeNull();
    expect(mayDispatchUnderContract(null)).toEqual({ permitted: false, reasonCode: 'contract_absent' });
  });
});

describe('challenging a revision', () => {
  it('moves a draft to CHALLENGED, and says false when it is already there', async () => {
    const store = storeWithRun();
    await put(store, contract());
    const args = { projectId: 'prj-1', contractId: 'contract-1', contractRevision: 1 };
    expect(await store.challengeTaskContract(args)).toBe(true);
    expect((await store.loadTaskContract({ projectId: 'prj-1', taskId: 'run-1:build' }))?.state).toBe('CHALLENGED');
    expect(await store.challengeTaskContract(args)).toBe(false);
  });

  it('refuses to challenge a locked revision, and a revision that is not there', async () => {
    const store = storeWithRun();
    await put(store, contract());
    await lock(store, contract());
    expect(await store.challengeTaskContract({ projectId: 'prj-1', contractId: 'contract-1', contractRevision: 1 })).toBe(false);
    expect(await store.challengeTaskContract({ projectId: 'prj-1', contractId: 'contract-1', contractRevision: 9 })).toBe(false);
  });
});

describe('locking — at most one revision, and only ever forward', () => {
  it('locks a revision and hands back the binding a dispatch may cite', async () => {
    const store = storeWithRun();
    await put(store, contract());
    const result = await lock(store, contract());
    expect(result.locked).toBe(true);
    if (!result.locked) throw new Error('unreachable');
    expect(result.contract.state).toBe('LOCKED');
    expect(result.contract.lockedByEvaluatorId).toBe('evaluator-1');
    expect(result.supersededRevision).toBeNull();

    const verdict = mayDispatchUnderContract(await store.loadTaskContract({ projectId: 'prj-1', taskId: 'run-1:build' }));
    expect(verdict.permitted).toBe(true);
  });

  it('refuses a second lock of the same revision, and names what is locked', async () => {
    const store = storeWithRun();
    await put(store, contract());
    await lock(store, contract());
    expect(await lock(store, contract()))
      .toEqual({ locked: false, reasonCode: 'contract_revision_already_locked', lockedRevision: 1 });
  });

  it('locking revision 2 supersedes revision 1 — that IS what superseding is', async () => {
    const store = storeWithRun();
    await put(store, contract());
    await lock(store, contract());
    const revised = reviseJuliusTaskContract({
      contract: (await store.loadTaskContract({ projectId: 'prj-1', taskId: 'run-1:build' }))!,
      proposal: { outOfScope: ['package.json', 'README.md'] },
    });
    if (revised.outcome !== 'REVISED') throw new Error('unreachable');
    await put(store, revised.contract);

    const result = await lock(store, revised.contract, 'evaluator-2');
    expect(result.locked).toBe(true);
    if (!result.locked) throw new Error('unreachable');
    expect(result.supersededRevision).toBe(1);

    const revisions = await store.taskContractRevisions({ projectId: 'prj-1', taskId: 'run-1:build' });
    expect(revisions.map((row) => [row.contractRevision, row.state])).toEqual([[1, 'SUPERSEDED'], [2, 'LOCKED']]);
    // The superseded row KEEPS its digest: work was dispatched under those terms.
    expect(revisions[0]?.bindingDigest).not.toBeNull();
    expect(await store.loadTaskContract({ projectId: 'prj-1', taskId: 'run-1:build' }))
      .toMatchObject({ contractRevision: 2, state: 'LOCKED' });
  });

  it('refuses to lock an OLDER revision than the one held — an agreement does not roll back', async () => {
    const store = storeWithRun();
    await put(store, contract());
    const revised = reviseJuliusTaskContract({ contract: contract(), proposal: { outOfScope: [] } });
    if (revised.outcome !== 'REVISED') throw new Error('unreachable');
    await put(store, revised.contract);
    await lock(store, revised.contract);

    expect(await lock(store, contract()))
      .toEqual({ locked: false, reasonCode: 'newer_revision_is_locked', lockedRevision: 2 });
  });

  it('refuses to lock terms to another document’s digest', async () => {
    const store = storeWithRun();
    await put(store, contract());
    const result = await store.lockTaskContract({
      projectId: 'prj-1', contractId: 'contract-1', contractRevision: 1,
      bindingDigest: juliusTaskContractBindingDigest(contract({ inScope: ['src/other.ts'] })),
      lockedAt: AT, evaluatorId: 'evaluator-1',
    });
    expect(result).toEqual({ locked: false, reasonCode: 'binding_digest_mismatch', lockedRevision: null });
  });

  it('refuses to lock a revision that is not stored', async () => {
    const store = storeWithRun();
    expect(await lock(store, contract()))
      .toEqual({ locked: false, reasonCode: 'contract_revision_not_found', lockedRevision: null });
  });

  it('only ONE of two concurrent locks of the SAME revision wins', async () => {
    const store = storeWithRun();
    await put(store, contract());
    const [first, second] = await Promise.all([lock(store, contract()), lock(store, contract())]);
    expect([first.locked, second.locked].sort()).toEqual([false, true]);
  });

  it('two concurrent locks of DIFFERENT revisions leave exactly one locked, the newer', async () => {
    // Both may legitimately succeed — the second one supersedes the first, which
    // is the ordinary revision path arriving in an unlucky order. What must hold
    // regardless is the invariant the partial unique index exists for: exactly
    // one LOCKED row, and it is the highest revision that was locked.
    const store = storeWithRun();
    await put(store, contract());
    const revised = reviseJuliusTaskContract({ contract: contract(), proposal: { outOfScope: [] } });
    if (revised.outcome !== 'REVISED') throw new Error('unreachable');
    await put(store, revised.contract);

    await Promise.all([lock(store, contract()), lock(store, revised.contract)]);

    const revisions = await store.taskContractRevisions({ projectId: 'prj-1', taskId: 'run-1:build' });
    const held = revisions.filter((row) => row.state === 'LOCKED');
    expect(held).toHaveLength(1);
    expect(held[0]?.contractRevision).toBe(2);
  });
});

describe('a locked row whose terms no longer hash to its binding is refused', () => {
  it('reads as absent rather than as current', async () => {
    const store = storeWithRun();
    await put(store, contract());
    const locked = lockJuliusTaskContract({
      contract: contract(), verdict: { verdict: 'ACCEPT', evaluatorId: 'e' }, lockedAt: AT,
    });
    if (locked.outcome !== 'LOCKED') throw new Error('unreachable');

    // The shape a corrupted row has: LOCKED, carrying a digest, with terms that
    // no longer produce it. Whatever caused it — an edit outside this code, a
    // storage layer that normalised a value — the answer must not be "current".
    const corrupted: JuliusTaskContract = { ...locked.contract, objective: 'something else entirely' };
    expect(juliusTaskContractBindingDigest(corrupted)).not.toBe(corrupted.bindingDigest);
    const store2 = storeWithRun();
    await store2.putTaskContract({ projectId: 'prj-1', contract: corrupted, occurredAt: AT });

    expect(await store2.loadTaskContract({ projectId: 'prj-1', taskId: 'run-1:build' })).toBeNull();
    // And the gate then blocks, rather than dispatching under a binding that
    // describes different terms.
    expect(mayDispatchUnderContract(await store2.loadTaskContract({ projectId: 'prj-1', taskId: 'run-1:build' })))
      .toEqual({ permitted: false, reasonCode: 'contract_absent' });
  });
});

describe('what survives a restart', () => {
  it('contracts and their lock survive; nothing has to be re-agreed', async () => {
    const store = storeWithRun();
    await put(store, contract());
    await lock(store, contract());
    const before = await store.loadTaskContract({ projectId: 'prj-1', taskId: 'run-1:build' });

    store.restart();

    const after = await store.loadTaskContract({ projectId: 'prj-1', taskId: 'run-1:build' });
    expect(after).toEqual(before);
    expect(after?.state).toBe('LOCKED');
    // A restart must not re-open the agreement: locking again after recovery
    // would mint a second lock instant and a second evaluator attribution.
    expect(await lock(store, contract(), 'evaluator-after-restart'))
      .toEqual({ locked: false, reasonCode: 'contract_revision_already_locked', lockedRevision: 1 });
  });
});

/**
 * THE CONTEXT A WORKER IS HANDED NAMES THE AGREEMENT IT WAS COMPILED UNDER.
 *
 * `JuliusContextWriter.persist` deduplicates on
 * `(task_id, worker_id, content_hash)`. Two packets whose TEXT is identical but
 * whose contracts differ are not the same document — one describes terms that
 * no longer bind — and a store that returned the older row would hand a retry a
 * context recorded against an agreement nobody holds. This is that property,
 * proven at the hash rather than asserted about the caller.
 */
describe('a context carries its contract binding, and the hash says so', () => {
  const packetFor = (binding: { revision: number; digest: string } | null) => createJuliusContextSnapshot({
    contextId: 'context-1', runId: 'run-1',
    task: {
      taskId: 'run-1:build', missionId: 'mission-1', parentTaskId: null, dependencyIds: [],
      requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'RUNNABLE',
    },
    worker: {
      workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter',
      capabilities: ['implement'], taskTypes: ['build'],
      concurrencyLimit: 1, timeoutMs: 60_000, maxRetries: 1, status: 'AVAILABLE',
    },
    entries: [], maxCharacters: 4_000,
    missionContractRevision: 3, cardRevision: 'card-1', projectBrainRevision: 0,
    taskContractRevision: binding?.revision ?? null,
    taskContractDigest: binding?.digest ?? null,
    dependencyTaskIds: [], evidenceIds: [], findingIds: [], acceptanceCriterionIds: [],
  });

  it('two contexts that differ ONLY in the contract revision are different documents', () => {
    const first = packetFor({ revision: 1, digest: 'sha256:aaa' });
    const second = packetFor({ revision: 2, digest: 'sha256:aaa' });
    expect(second.contentHash).not.toBe(first.contentHash);
  });

  it('and two that differ only in the digest are too — a reworded revision is a new agreement', () => {
    const first = packetFor({ revision: 2, digest: 'sha256:aaa' });
    const second = packetFor({ revision: 2, digest: 'sha256:bbb' });
    expect(second.contentHash).not.toBe(first.contentHash);
  });

  it('an unbound role records null rather than a zero nobody measured', () => {
    const unbound = packetFor(null);
    expect(unbound.taskContractRevision).toBeNull();
    expect(unbound.taskContractDigest).toBeNull();
    expect(unbound.contentHash).not.toBe(packetFor({ revision: 1, digest: 'sha256:aaa' }).contentHash);
  });

  it('the same agreement compiles to the same hash, so an honest retry still deduplicates', () => {
    expect(packetFor({ revision: 1, digest: 'sha256:aaa' }).contentHash)
      .toBe(packetFor({ revision: 1, digest: 'sha256:aaa' }).contentHash);
  });
});
