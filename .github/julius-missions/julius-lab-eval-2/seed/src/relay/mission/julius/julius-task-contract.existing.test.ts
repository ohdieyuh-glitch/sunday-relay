import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createJuliusMemoryStore } from './julius-memory-store';
import {
  JULIUS_CONTRACT_MISSION_OWNED_FIELDS,
  JULIUS_CONTRACT_PROPOSAL_LIMITS,
  JULIUS_TASK_CONTRACT_VERSION,
  challengeJuliusTaskContract,
  evaluateJuliusBindingCurrency,
  juliusContractReviewCharge,
  juliusTaskContractBinding,
  juliusTaskContractBindingDigest,
  lockJuliusTaskContract,
  mayDispatchUnderContract,
  reviseJuliusTaskContract,
  sanitizeJuliusContractProposal,
  seedJuliusTaskContract,
  validateJuliusTaskContract,
  type JuliusTaskContract,
} from './julius-task-contract';

/**
 * WHAT MUST NOT CHANGE — THE TASK CONTRACT AS IT BEHAVES, AND THE ROWS IT HAS
 * ALREADY WRITTEN.
 *
 * This file is green before the mission starts and must be green when it ends.
 *
 * Its first half is about the rows in `julius-task-contract.stored-rows.json`.
 * They are contracts exactly as the store held them before this change — a
 * mission seed, the revision locked from it, and another task's revision still
 * at draft — together with the digests the code that wrote them computed. A
 * contract store keeps every revision and re-derives the binding digest on
 * every read, refusing a row whose terms no longer hash to it; a bootstrap that
 * is replayed re-seeds and the store compares digests. So these rows are not
 * history: they are what a run in flight when this change is deployed still
 * holds, and every case about them is a run that must still be able to finish.
 *
 * Its second half is the contract's own semantics — the digest, the cycle, the
 * fields a worker may not move, the gates, the sanitiser and the store — which
 * a paid run already depends on.
 */

const STORED = JSON.parse(readFileSync(new URL('./julius-task-contract.stored-rows.json', import.meta.url), 'utf8')) as {
  readonly capturedWith: string;
  readonly missionTerms: Parameters<typeof seedJuliusTaskContract>[0];
  readonly seededDraft: JuliusTaskContract;
  readonly seededDraftDigest: string;
  readonly lockedRevision: JuliusTaskContract;
  readonly pendingDraft: JuliusTaskContract;
  readonly pendingDraftDigest: string;
};

/** A row as a store hands it back: a fresh copy, never the fixture itself. */
const row = (value: JuliusTaskContract): JuliusTaskContract => JSON.parse(JSON.stringify(value)) as JuliusTaskContract;

const AT = '2026-09-12T12:00:00.000Z';
const ACCEPT = { verdict: 'ACCEPT', evaluatorId: 'evaluator-1' } as const;
const PROJECT = 'prj-lab-eval-2-legacy';

const storeWithRun = () => {
  const store = createJuliusMemoryStore();
  store.seedRun({
    runId: STORED.missionTerms.runId, missionId: 'mission:lab-eval-2-legacy', projectId: PROJECT,
    state: 'EXECUTING', cardRevision: 'card:julius-live:1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  return store;
};
const put = (store: ReturnType<typeof storeWithRun>, contract: JuliusTaskContract) =>
  store.putTaskContract({ projectId: PROJECT, contract, occurredAt: AT });
const storeLock = (store: ReturnType<typeof storeWithRun>, contract: JuliusTaskContract, bindingDigest: string) =>
  store.lockTaskContract({
    projectId: PROJECT, contractId: contract.contractId, contractRevision: contract.contractRevision,
    bindingDigest, lockedAt: AT, evaluatorId: 'evaluator-1',
  });

/* =========================================== A. the rows already written */

test('the captured rows are what the store held: a v1 seed, the revision locked from it, and a pending draft', () => {
  assert.equal(STORED.capturedWith, 'julius-task-contract.v1');
  assert.equal(STORED.seededDraft.state, 'DRAFT');
  assert.equal(STORED.seededDraft.contractRevision, 1);
  assert.equal(STORED.lockedRevision.state, 'LOCKED');
  assert.equal(STORED.lockedRevision.contractRevision, 2);
  assert.equal(STORED.pendingDraft.state, 'DRAFT');
  assert.equal(STORED.pendingDraft.contractRevision, 2);
});

test('a stored draft and a stored seed are still valid contracts', () => {
  assert.deepEqual(validateJuliusTaskContract(row(STORED.pendingDraft)), { valid: true, errors: [] });
  assert.deepEqual(validateJuliusTaskContract(row(STORED.seededDraft)), { valid: true, errors: [] });
});

test('a stored locked row still hashes to the binding it was locked with', () => {
  assert.equal(juliusTaskContractBindingDigest(row(STORED.lockedRevision)), STORED.lockedRevision.bindingDigest);
});

test('a stored draft still locks, and to the digest it had when it was stored', () => {
  const outcome = lockJuliusTaskContract({ contract: row(STORED.pendingDraft), verdict: ACCEPT, lockedAt: AT });
  assert.equal(outcome.outcome, 'LOCKED', JSON.stringify(outcome));
  assert.equal(outcome.outcome === 'LOCKED' ? outcome.contract.bindingDigest : null, STORED.pendingDraftDigest);
});

test('a binding a dispatch recorded against a stored locked row is still CURRENT, and the build may still dispatch under it', () => {
  const locked = row(STORED.lockedRevision);
  const recorded = juliusTaskContractBinding(row(STORED.lockedRevision));
  assert.equal(evaluateJuliusBindingCurrency({ recorded, contract: locked }), 'CURRENT');
  const verdict = mayDispatchUnderContract(locked);
  assert.equal(verdict.permitted, true);
  assert.equal(verdict.permitted ? verdict.binding.bindingDigest : null, STORED.lockedRevision.bindingDigest);
});

test('a reviewer is still charged against a stored locked row, with every term it was locked with', () => {
  const locked = row(STORED.lockedRevision);
  const charge = juliusContractReviewCharge({ contract: locked, stage: 'build' });
  assert.ok(charge !== null, 'a locked row must produce a charge');
  assert.equal(charge.stage, 'build');
  assert.deepEqual(charge.binding, juliusTaskContractBinding(locked));
  assert.equal(charge.objective, locked.objective);
  assert.equal(charge.responsibilityBoundary, locked.responsibilityBoundary);
  assert.equal(charge.stoppingCondition, locked.stoppingCondition);
  assert.deepEqual(charge.inScope, locked.inScope);
  assert.deepEqual(charge.outOfScope, locked.outOfScope);
  assert.deepEqual(charge.permittedPaths, locked.permittedPaths);
  assert.deepEqual(charge.prohibitedActions, locked.prohibitedActions);
  assert.deepEqual(charge.requiredEvidence, locked.requiredEvidence);
  assert.deepEqual(charge.requiredChecks, locked.requiredChecks);
  assert.deepEqual(charge.contractReviewCriteria, locked.reviewCriteria);
  assert.deepEqual(charge.failureConditions, locked.failureConditions);
  assert.deepEqual(charge.blockingCriteria, locked.blockingAcceptanceCriteria.map((c) => `[${c.criterionId}] ${c.statement}`));
});

test('a stored locked row can still be revised, and the revision supersedes it rather than overwriting it', () => {
  const outcome = reviseJuliusTaskContract({
    contract: row(STORED.lockedRevision),
    proposal: { requiredChecks: ['node --test src/slug.test.ts', 'node --check src/slug.ts'] },
  });
  assert.equal(outcome.outcome, 'REVISED', JSON.stringify(outcome));
  if (outcome.outcome !== 'REVISED') return;
  assert.equal(outcome.contract.contractRevision, 3);
  assert.equal(outcome.contract.state, 'DRAFT');
  assert.equal(outcome.contract.bindingDigest, null);
  assert.equal(outcome.supersedes?.state, 'SUPERSEDED');
  assert.equal(outcome.supersedes?.bindingDigest, STORED.lockedRevision.bindingDigest);
});

test('the same mission still seeds the same contract — a replayed bootstrap is not a new agreement', () => {
  const again = seedJuliusTaskContract(JSON.parse(JSON.stringify(STORED.missionTerms)));
  assert.equal(again.seeded, true);
  assert.equal(again.seeded ? juliusTaskContractBindingDigest(again.contract) : null, STORED.seededDraftDigest);
});

test('a seed replayed into a store that already holds the stored one is a replay, not a conflict', async () => {
  const store = storeWithRun();
  assert.equal(await put(store, row(STORED.seededDraft)), true);
  const again = seedJuliusTaskContract(JSON.parse(JSON.stringify(STORED.missionTerms)));
  assert.equal(again.seeded, true);
  if (!again.seeded) return;
  assert.equal(await put(store, again.contract), false, 'a replay writes nothing and is not an error');
});

test('a stored draft locks through the store with its stored digest, reads back as the task’s contract, and survives a restart', async () => {
  const store = storeWithRun();
  const draft = row(STORED.pendingDraft);
  assert.equal(await put(store, draft), true);
  const result = await storeLock(store, draft, STORED.pendingDraftDigest);
  assert.equal(result.locked, true, JSON.stringify(result));
  const loaded = await store.loadTaskContract({ projectId: PROJECT, taskId: draft.taskId });
  assert.equal(loaded?.state, 'LOCKED');
  assert.equal(loaded?.bindingDigest, STORED.pendingDraftDigest);
  store.restart();
  const afterRestart = await store.loadTaskContract({ projectId: PROJECT, taskId: draft.taskId });
  assert.equal(afterRestart?.bindingDigest, STORED.pendingDraftDigest, 'nothing has to be re-agreed after a restart');
});

test('a stored locked row, handed back to the store as it was written, reads as the task’s current contract', async () => {
  const store = storeWithRun();
  const locked = row(STORED.lockedRevision);
  assert.equal(await put(store, locked), true);
  const loaded = await store.loadTaskContract({ projectId: PROJECT, taskId: locked.taskId });
  assert.ok(loaded !== null, 'the store re-derives the digest on read and refuses a row that disagrees');
  assert.equal(loaded.bindingDigest, STORED.lockedRevision.bindingDigest);
});

/* ====================================== B. the contract's own semantics */

const base = (): JuliusTaskContract => row(STORED.pendingDraft);

test('the digest is stable across key order and repeated computation', () => {
  const contract = base();
  const reversed = Object.fromEntries(Object.entries(contract).reverse()) as unknown as JuliusTaskContract;
  assert.equal(juliusTaskContractBindingDigest(reversed), juliusTaskContractBindingDigest(contract));
  assert.equal(juliusTaskContractBindingDigest(contract), juliusTaskContractBindingDigest(base()));
});

test('the digest ignores lock provenance: a draft and the contract it locks into agree', () => {
  const draft = base();
  const outcome = lockJuliusTaskContract({ contract: draft, verdict: ACCEPT, lockedAt: AT });
  assert.equal(outcome.outcome, 'LOCKED');
  if (outcome.outcome !== 'LOCKED') return;
  assert.equal(juliusTaskContractBindingDigest(outcome.contract), juliusTaskContractBindingDigest(draft));
  assert.equal(outcome.contract.bindingDigest, juliusTaskContractBindingDigest(draft));
});

test('the digest changes when any term changes', () => {
  const contract = base();
  const digest = juliusTaskContractBindingDigest(contract);
  const mutations: readonly Partial<JuliusTaskContract>[] = [
    { objective: `${contract.objective} ` }, { responsibilityBoundary: 'another boundary' },
    { requiredInputs: [...contract.requiredInputs, 'x'] }, { expectedOutputs: ['x'] }, { inScope: ['x'] },
    { outOfScope: [] }, { requiredChecks: [] }, { permittedPaths: ['x'] }, { prohibitedActions: [] },
    { dependencyTaskIds: ['x'] }, { reviewCriteria: ['x'] }, { failureConditions: ['x'] }, { repairRules: [] },
    { stoppingCondition: 'x' }, { contractRevision: contract.contractRevision + 1 },
    { budget: { ...contract.budget, ceilingUsdMicros: contract.budget.ceilingUsdMicros + 1 } },
    { requiredEvidence: ['TEST'] },
  ];
  for (const mutation of mutations) {
    assert.notEqual(juliusTaskContractBindingDigest({ ...contract, ...mutation }), digest, JSON.stringify(mutation));
  }
});

test('the order of the criteria is part of the agreement', () => {
  const contract = { ...base(), blockingAcceptanceCriteria: [
    { criterionId: 'criterion-slug', statement: 'slug("A  B") returns "a-b".', requiredEvidenceTypes: ['DIFF', 'TEST'] as const },
    { criterionId: 'criterion-tests', statement: 'the workspace test command exits zero.', requiredEvidenceTypes: ['DIFF', 'TEST'] as const },
  ] } as JuliusTaskContract;
  const reordered = { ...contract, blockingAcceptanceCriteria: [...contract.blockingAcceptanceCriteria].reverse() };
  assert.notEqual(juliusTaskContractBindingDigest(reordered), juliusTaskContractBindingDigest(contract));
});

test('a field that went missing is refused rather than silently dropped, and so is a non-finite number', () => {
  assert.throws(() => juliusTaskContractBindingDigest({ ...base(), objective: undefined } as unknown as JuliusTaskContract), /julius_contract_canonical_undefined/u);
  assert.throws(() => juliusTaskContractBindingDigest({ ...base(), budget: { ceilingUsdMicros: Number.NaN, maxRepairRounds: 1 } }), /julius_contract_canonical_non_finite/u);
});

test('the digest binds the compiler version', () => {
  assert.equal(JULIUS_TASK_CONTRACT_VERSION, 'julius-task-contract.v1');
});

test('a challenge does not edit the contract, and a challenge with no objection is refused', () => {
  const draft = base();
  const challenged = challengeJuliusTaskContract(draft, { verdict: 'CHALLENGE', evaluatorId: 'evaluator-1', objections: ['the checks are not named'] });
  assert.equal(challenged.outcome, 'CHALLENGED');
  if (challenged.outcome === 'CHALLENGED') {
    assert.equal(challenged.contract.state, 'CHALLENGED');
    assert.equal(juliusTaskContractBindingDigest(challenged.contract), juliusTaskContractBindingDigest(draft));
  }
  assert.deepEqual(
    challengeJuliusTaskContract(draft, { verdict: 'CHALLENGE', evaluatorId: 'evaluator-1', objections: [] }),
    { outcome: 'REFUSED', reasonCode: 'challenge_requires_objections' },
  );
  assert.deepEqual(
    challengeJuliusTaskContract(row(STORED.lockedRevision), { verdict: 'CHALLENGE', evaluatorId: 'evaluator-1', objections: ['late'] }),
    { outcome: 'REFUSED', reasonCode: 'contract_already_locked' },
  );
});

test('a lock refuses an incomplete contract, and one without an evaluator or an instant', () => {
  assert.equal(lockJuliusTaskContract({ contract: { ...base(), blockingAcceptanceCriteria: [] }, verdict: ACCEPT, lockedAt: AT }).outcome, 'REFUSED');
  assert.deepEqual(lockJuliusTaskContract({ contract: base(), verdict: { verdict: 'ACCEPT', evaluatorId: '' }, lockedAt: AT }), { outcome: 'REFUSED', reasonCode: 'evaluator_required' });
  assert.deepEqual(lockJuliusTaskContract({ contract: base(), verdict: ACCEPT, lockedAt: '' }), { outcome: 'REFUSED', reasonCode: 'locked_at_required' });
});

test('a proposal cannot drop, add or rename a criterion, but may reword one it keeps', () => {
  const contract = base();
  const renamed = contract.blockingAcceptanceCriteria.map((c, i) => (i === 0 ? { ...c, criterionId: 'criterion-renamed' } : c));
  assert.deepEqual(reviseJuliusTaskContract({ contract, proposal: { blockingAcceptanceCriteria: renamed } }), { outcome: 'REFUSED', reasonCode: 'criterion_ids_are_mission_owned' });
  const dropped = contract.blockingAcceptanceCriteria.slice(1);
  assert.equal(reviseJuliusTaskContract({ contract, proposal: { blockingAcceptanceCriteria: dropped } }).outcome, 'REFUSED');
  const reworded = contract.blockingAcceptanceCriteria.map((c) => ({ ...c, statement: `${c.statement} (clarified)` }));
  assert.equal(reviseJuliusTaskContract({ contract, proposal: { blockingAcceptanceCriteria: reworded } }).outcome, 'REVISED');
});

test('the mission-owned fields are named, and a proposal carrying them at runtime cannot move them', () => {
  assert.deepEqual([...JULIUS_CONTRACT_MISSION_OWNED_FIELDS], ['runId', 'taskId', 'missionContractRevision', 'criterionIds', 'budget']);
  const contract = base();
  const outcome = reviseJuliusTaskContract({
    contract,
    proposal: { objective: 'reworded', runId: 'run:other', taskId: 'other', missionContractRevision: 9, budget: { ceilingUsdMicros: 1, maxRepairRounds: 99 } } as never,
  });
  assert.equal(outcome.outcome, 'REVISED');
  if (outcome.outcome !== 'REVISED') return;
  assert.equal(outcome.contract.runId, contract.runId);
  assert.equal(outcome.contract.taskId, contract.taskId);
  assert.equal(outcome.contract.missionContractRevision, contract.missionContractRevision);
  assert.deepEqual(outcome.contract.budget, contract.budget);
});

test('coding may not begin before a lock: absent, draft, challenged and superseded are each refused by name', () => {
  assert.deepEqual(mayDispatchUnderContract(null), { permitted: false, reasonCode: 'contract_absent' });
  assert.deepEqual(mayDispatchUnderContract(base()), { permitted: false, reasonCode: 'contract_not_locked' });
  assert.deepEqual(mayDispatchUnderContract({ ...base(), state: 'CHALLENGED' }), { permitted: false, reasonCode: 'contract_challenged' });
  assert.deepEqual(mayDispatchUnderContract({ ...row(STORED.lockedRevision), state: 'SUPERSEDED' }), { permitted: false, reasonCode: 'contract_superseded' });
});

test('currency: STALE for an older revision, FOREIGN for a disagreeing digest or a newer revision, INDETERMINATE with nothing locked', () => {
  const locked = row(STORED.lockedRevision);
  const binding = juliusTaskContractBinding(locked)!;
  assert.equal(evaluateJuliusBindingCurrency({ recorded: { ...binding, contractRevision: 1 }, contract: locked }), 'STALE');
  assert.equal(evaluateJuliusBindingCurrency({ recorded: { ...binding, bindingDigest: `sha256:${'0'.repeat(64)}` }, contract: locked }), 'FOREIGN');
  assert.equal(evaluateJuliusBindingCurrency({ recorded: { ...binding, contractRevision: 3 }, contract: locked }), 'FOREIGN');
  assert.equal(evaluateJuliusBindingCurrency({ recorded: binding, contract: base() }), 'INDETERMINATE');
  assert.equal(evaluateJuliusBindingCurrency({ recorded: null, contract: locked }), 'INDETERMINATE');
});

test('a reviewer is never charged against terms that are still being argued about', () => {
  assert.equal(juliusContractReviewCharge({ contract: base(), stage: 'build' }), null);
});

test('the sanitiser keeps what a worker may propose, trimmed', () => {
  const proposal = sanitizeJuliusContractProposal({ objective: '  Implement slug.  ', requiredChecks: [' node --test src/slug.test.ts '] });
  assert.deepEqual(proposal, { objective: 'Implement slug.', requiredChecks: ['node --test src/slug.test.ts'] });
});

test('the sanitiser drops every key not on its allowlist, mission-owned ones included', () => {
  const proposal = sanitizeJuliusContractProposal({
    repairRules: ['address only the recorded findings'],
    runId: 'run:other', taskId: 'other', budget: { ceilingUsdMicros: 1 }, criterionIds: ['x'],
    bindingDigest: 'sha256:x', lockedAt: AT, approvedBy: 'the worker itself',
  });
  assert.deepEqual(proposal, { repairRules: ['address only the recorded findings'] });
});

test('a present but unusable field refuses the whole proposal, and so does anything that is not an object', () => {
  assert.equal(sanitizeJuliusContractProposal({ objective: '   ', repairRules: ['ok'] }), null);
  assert.equal(sanitizeJuliusContractProposal({ requiredChecks: ['ok', 7] }), null);
  assert.equal(sanitizeJuliusContractProposal({ requiredChecks: Array.from({ length: JULIUS_CONTRACT_PROPOSAL_LIMITS.entriesPerList + 1 }, () => 'x') }), null);
  assert.equal(sanitizeJuliusContractProposal({ requiredChecks: ['x'.repeat(JULIUS_CONTRACT_PROPOSAL_LIMITS.entryChars + 1)] }), null);
  for (const value of [null, 'text', 42, ['objective']]) assert.equal(sanitizeJuliusContractProposal(value), null);
  assert.equal(sanitizeJuliusContractProposal({ nothingProposable: true }), null);
});

test('the store refuses different terms at a stored revision rather than merging them', async () => {
  const store = storeWithRun();
  const draft = row(STORED.pendingDraft);
  assert.equal(await put(store, draft), true);
  await assert.rejects(put(store, { ...draft, objective: 'something else' }), /julius_task_contract_revision_conflict/u);
});

test('the store locks only forward: a second lock of a revision and an older revision under a newer one are refused by name', async () => {
  const store = storeWithRun();
  const seed = row(STORED.seededDraft);
  const locked = row(STORED.lockedRevision);
  const revisionTwo = { ...locked, state: 'DRAFT', bindingDigest: null, lockedAt: null, lockedByEvaluatorId: null } as JuliusTaskContract;
  assert.equal(await put(store, seed), true);
  assert.equal((await storeLock(store, seed, STORED.seededDraftDigest)).locked, true);
  assert.equal(await put(store, revisionTwo), true);
  const second = await storeLock(store, revisionTwo, STORED.lockedRevision.bindingDigest!);
  assert.equal(second.locked, true, JSON.stringify(second));
  assert.deepEqual(await storeLock(store, revisionTwo, STORED.lockedRevision.bindingDigest!), { locked: false, reasonCode: 'contract_revision_already_locked', lockedRevision: 2 });
  assert.deepEqual(await storeLock(store, seed, STORED.seededDraftDigest), { locked: false, reasonCode: 'newer_revision_is_locked', lockedRevision: 2 });
});

test('the store refuses to lock terms to another document’s digest', async () => {
  const store = storeWithRun();
  const draft = row(STORED.pendingDraft);
  assert.equal(await put(store, draft), true);
  assert.deepEqual(await storeLock(store, draft, STORED.seededDraftDigest), { locked: false, reasonCode: 'binding_digest_mismatch', lockedRevision: null });
});

test('a locked row whose terms no longer hash to its binding reads as absent, not as current', async () => {
  const store = storeWithRun();
  const tampered = { ...row(STORED.lockedRevision), objective: 'an objective nobody agreed to' };
  assert.equal(await put(store, tampered), true);
  assert.equal(await store.loadTaskContract({ projectId: PROJECT, taskId: tampered.taskId }), null);
});
