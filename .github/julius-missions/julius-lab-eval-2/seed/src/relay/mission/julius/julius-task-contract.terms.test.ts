import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJuliusMemoryStore } from './julius-memory-store';
import {
  JULIUS_CONTRACT_PROPOSAL_LIMITS,
  juliusContractReviewCharge,
  juliusTaskContractBindingDigest,
  lockJuliusTaskContract,
  reviseJuliusTaskContract,
  sanitizeJuliusContractProposal,
  seedJuliusTaskContract,
  validateJuliusTaskContract,
  type JuliusTaskContract,
} from './julius-task-contract';

/**
 * ASSUMPTIONS AND OPEN QUESTIONS — THE SPECIFICATION OF THE NEW TERMS.
 *
 * Every architect plan states the assumptions it rests on and the questions it
 * could not resolve. None of that reaches the task contract today, so a coder is
 * bound to an agreement that silently depends on premises nobody wrote into it,
 * a reviewer cannot check them, and a contract locks while its own author said a
 * question was still open.
 *
 * The rule the new terms exist to hold: AN AGREEMENT WITH AN OPEN QUESTION IS
 * NOT AN AGREEMENT. It may be drafted, challenged and revised; it may not lock —
 * not through the domain gate and not at the store — until a revision answers
 * the question, and the answer can be kept as an assumption the reviewer is then
 * charged with.
 *
 * Contracts built here come from the real seed, revised through the real
 * sanitiser, exactly as a worker's proposal travels. What must not change while
 * these terms are added is `julius-task-contract.existing.test.ts`.
 */

const AT = '2026-09-12T12:00:00.000Z';
const PROJECT = 'prj-terms';
const ACCEPT = { verdict: 'ACCEPT', evaluatorId: 'evaluator-1' } as const;

const TERMS = {
  runId: 'run:terms', taskId: 'run:terms:build', missionContractRevision: 1,
  objective: 'Teach the manifest parser to read a leading byte-order mark and prove it.',
  requirements: ['the parser accepts UTF-8 input with or without a BOM'],
  constraints: ['add no dependency'],
  acceptanceCriteria: [{ id: 'criterion-bom', text: 'a manifest with a leading BOM parses identically to one without.', blocking: true }],
  filesInScope: ['src/manifest.ts'], filesOutOfScope: ['package.json'],
  spendUsd: 30, repairCycles: 2, requiredEvidence: ['DIFF', 'TEST'] as const,
};

const seeded = (): JuliusTaskContract => {
  const outcome = seedJuliusTaskContract({ ...TERMS, requiredEvidence: [...TERMS.requiredEvidence] });
  assert.equal(outcome.seeded, true);
  return (outcome as { contract: JuliusTaskContract }).contract;
};

/** A worker's proposal as it really travels: through the sanitiser, then into a revision. */
const propose = (contract: JuliusTaskContract, raw: Record<string, unknown>): JuliusTaskContract => {
  const proposal = sanitizeJuliusContractProposal(raw);
  assert.ok(proposal !== null, `the sanitiser refused a proposal a worker may make: ${JSON.stringify(raw)}`);
  const outcome = reviseJuliusTaskContract({ contract, proposal });
  assert.equal(outcome.outcome, 'REVISED', JSON.stringify(outcome));
  return (outcome as { contract: JuliusTaskContract }).contract;
};

const termsOf = (contract: JuliusTaskContract): Record<string, unknown> => contract as unknown as Record<string, unknown>;

const storeWithRun = () => {
  const store = createJuliusMemoryStore();
  store.seedRun({
    runId: TERMS.runId, missionId: 'mission:terms', projectId: PROJECT, state: 'EXECUTING',
    cardRevision: 'card:julius-live:1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  return store;
};

/* ------------------------------------------------------------ proposing */

test('a worker may propose the assumptions an agreement rests on and the questions it leaves open, kept in order and trimmed', () => {
  const proposal = sanitizeJuliusContractProposal({
    assumptions: ['  Manifests are UTF-8.  ', 'An empty manifest is legal.'],
    openQuestions: [' Is the BOM stripped before hashing, or preserved? '],
  }) as Record<string, unknown> | null;
  assert.ok(proposal !== null, 'both are proposable');
  assert.deepEqual(proposal.assumptions, ['Manifests are UTF-8.', 'An empty manifest is legal.']);
  assert.deepEqual(proposal.openQuestions, ['Is the BOM stripped before hashing, or preserved?']);
});

test('the proposal bounds apply to both: too many, too long, empty, non-string or not a list refuses the whole proposal', () => {
  for (const field of ['assumptions', 'openQuestions']) {
    const bad: readonly unknown[] = [
      Array.from({ length: JULIUS_CONTRACT_PROPOSAL_LIMITS.entriesPerList + 1 }, () => 'x'),
      ['x'.repeat(JULIUS_CONTRACT_PROPOSAL_LIMITS.entryChars + 1)],
      ['   '],
      ['ok', 3],
      'a single string is not a list',
    ];
    for (const value of bad) {
      assert.equal(sanitizeJuliusContractProposal({ repairRules: ['ok'], [field]: value }), null, `${field}: ${JSON.stringify(value).slice(0, 40)}`);
    }
  }
});

test('a revision carries both, and a proposal that sends only one leaves the other as it was', () => {
  const first = propose(seeded(), { assumptions: ['Manifests are UTF-8.'], openQuestions: ['Is the BOM stripped before hashing?'] });
  assert.deepEqual(termsOf(first).assumptions, ['Manifests are UTF-8.']);
  assert.deepEqual(termsOf(first).openQuestions, ['Is the BOM stripped before hashing?']);
  const second = propose(first, { assumptions: ['Manifests are UTF-8.', 'An empty manifest is legal.'] });
  assert.deepEqual(termsOf(second).assumptions, ['Manifests are UTF-8.', 'An empty manifest is legal.']);
  assert.deepEqual(termsOf(second).openQuestions, ['Is the BOM stripped before hashing?']);
});

/* ------------------------------------------------------------- the gate */

test('an agreement with an open question cannot lock, whatever the evaluator said, and no binding is published', () => {
  const open = propose(seeded(), { openQuestions: ['Is the BOM stripped before hashing?'] });
  assert.deepEqual(lockJuliusTaskContract({ contract: open, verdict: ACCEPT, lockedAt: AT }), {
    outcome: 'REFUSED', reasonCode: 'contract_has_open_questions',
  });
});

test('a revision that answers the question makes the agreement lockable, and the answer can be kept as an assumption', () => {
  const open = propose(seeded(), { openQuestions: ['Is the BOM stripped before hashing?'] });
  const answered = propose(open, { openQuestions: [], assumptions: ['A leading BOM is stripped before the manifest is hashed.'] });
  const outcome = lockJuliusTaskContract({ contract: answered, verdict: ACCEPT, lockedAt: AT });
  assert.equal(outcome.outcome, 'LOCKED', JSON.stringify(outcome));
  if (outcome.outcome !== 'LOCKED') throw new Error('unreachable');
  assert.equal(outcome.contract.bindingDigest, juliusTaskContractBindingDigest(answered));
  assert.deepEqual(termsOf(outcome.contract).assumptions, ['A leading BOM is stripped before the manifest is hashed.']);
});

test('a seeded contract states no open question, so Julius can lock it without waiting for a revision', () => {
  assert.equal(lockJuliusTaskContract({ contract: seeded(), verdict: ACCEPT, lockedAt: AT }).outcome, 'LOCKED');
});

test('a LOCKED record carrying an open question is not a valid contract, while a DRAFT carrying one is', () => {
  const drafted = propose(seeded(), { openQuestions: ['Is the BOM stripped before hashing?'] });
  assert.deepEqual(validateJuliusTaskContract(drafted), { valid: true, errors: [] });
  const lockedOutcome = lockJuliusTaskContract({ contract: propose(seeded(), { assumptions: ['Manifests are UTF-8.'] }), verdict: ACCEPT, lockedAt: AT });
  assert.equal(lockedOutcome.outcome, 'LOCKED');
  if (lockedOutcome.outcome !== 'LOCKED') throw new Error('unreachable');
  const corrupt = { ...lockedOutcome.contract, openQuestions: ['Is the BOM stripped before hashing?'] } as JuliusTaskContract;
  const validation = validateJuliusTaskContract(corrupt);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('locked_contract_has_open_questions'), JSON.stringify(validation.errors));
});

/* ------------------------------------------------------- the agreement */

test('the assumptions and the open questions are part of the agreement: changing either, or their order, changes the binding', () => {
  const contract = propose(seeded(), { assumptions: ['A1', 'A2'], openQuestions: ['Q1'] });
  const digest = juliusTaskContractBindingDigest(contract);
  assert.equal(juliusTaskContractBindingDigest({ ...contract }), digest);
  const variants: readonly Record<string, unknown>[] = [
    { assumptions: ['A1'] }, { assumptions: ['A2', 'A1'] }, { assumptions: ['A1', 'A2', 'A3'] },
    { openQuestions: ['Q2'] }, { openQuestions: ['Q1', 'Q2'] },
  ];
  for (const variant of variants) {
    assert.notEqual(juliusTaskContractBindingDigest({ ...contract, ...variant } as JuliusTaskContract), digest, JSON.stringify(variant));
  }
});

/* --------------------------------------------------------- the reviewer */

test('the reviewer is charged with the assumptions the agreement rests on, in order', () => {
  const outcome = lockJuliusTaskContract({ contract: propose(seeded(), { assumptions: ['Manifests are UTF-8.', 'An empty manifest is legal.'] }), verdict: ACCEPT, lockedAt: AT });
  assert.equal(outcome.outcome, 'LOCKED');
  if (outcome.outcome !== 'LOCKED') throw new Error('unreachable');
  const charge = juliusContractReviewCharge({ contract: outcome.contract, stage: 'build' }) as Record<string, unknown> | null;
  assert.ok(charge !== null);
  assert.deepEqual(charge.assumptions, ['Manifests are UTF-8.', 'An empty manifest is legal.']);
});

test('an agreement that states no assumption is charged with an empty list, never with nothing', () => {
  const outcome = lockJuliusTaskContract({ contract: propose(seeded(), { requiredChecks: ['node --test src/manifest.test.ts'] }), verdict: ACCEPT, lockedAt: AT });
  assert.equal(outcome.outcome, 'LOCKED');
  if (outcome.outcome !== 'LOCKED') throw new Error('unreachable');
  const charge = juliusContractReviewCharge({ contract: outcome.contract, stage: 'build' }) as Record<string, unknown> | null;
  assert.ok(charge !== null);
  assert.deepEqual(charge.assumptions, []);
});

/* ------------------------------------------------------------ the store */

test('the store refuses to lock a revision with an open question, even when handed the right digest', async () => {
  const store = storeWithRun();
  const open = propose(seeded(), { openQuestions: ['Is the BOM stripped before hashing?'] });
  assert.equal(await store.putTaskContract({ projectId: PROJECT, contract: open, occurredAt: AT }), true);
  const result = await store.lockTaskContract({
    projectId: PROJECT, contractId: open.contractId, contractRevision: open.contractRevision,
    bindingDigest: juliusTaskContractBindingDigest(open), lockedAt: AT, evaluatorId: 'evaluator-1',
  });
  assert.deepEqual(result, { locked: false, reasonCode: 'contract_has_open_questions', lockedRevision: null });
  assert.equal((await store.loadTaskContract({ projectId: PROJECT, taskId: open.taskId }))?.state, 'DRAFT');
});

test('and the store locks the revision that answers it, which then reads back as the task’s contract', async () => {
  const store = storeWithRun();
  const open = propose(seeded(), { openQuestions: ['Is the BOM stripped before hashing?'] });
  const answered = propose(open, { openQuestions: [], assumptions: ['A leading BOM is stripped before hashing.'] });
  for (const revision of [open, answered]) {
    assert.equal(await store.putTaskContract({ projectId: PROJECT, contract: revision, occurredAt: AT }), true);
  }
  const result = await store.lockTaskContract({
    projectId: PROJECT, contractId: answered.contractId, contractRevision: answered.contractRevision,
    bindingDigest: juliusTaskContractBindingDigest(answered), lockedAt: AT, evaluatorId: 'evaluator-1',
  });
  assert.equal(result.locked, true, JSON.stringify(result));
  const loaded = await store.loadTaskContract({ projectId: PROJECT, taskId: answered.taskId });
  assert.equal(loaded?.contractRevision, answered.contractRevision);
  assert.equal(loaded?.bindingDigest, juliusTaskContractBindingDigest(answered));
});
