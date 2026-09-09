import { describe, expect, it } from 'vitest';

import {
  JULIUS_CONTRACT_MISSION_OWNED_FIELDS,
  JULIUS_CONTRACT_PROPOSAL_LIMITS,
  JULIUS_TASK_CONTRACT_VERSION,
  challengeJuliusTaskContract,
  evaluateJuliusBindingCurrency,
  evaluateJuliusSharedBinding,
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

const draft = (overrides: Partial<JuliusTaskContract> = {}): JuliusTaskContract => ({
  contractId: 'contract-1',
  runId: 'run-1',
  taskId: 'run-1:build',
  missionContractRevision: 3,
  contractRevision: 1,
  objective: 'Add a deterministic slug helper and prove it.',
  responsibilityBoundary: 'Implementation and its unit tests only; no release wiring.',
  requiredInputs: ['the locked plan', 'the repository at the mission commit'],
  expectedOutputs: ['a unified diff', 'passing unit tests'],
  inScope: ['src/slug.ts', 'src/slug.test.ts'],
  outOfScope: ['package.json'],
  blockingAcceptanceCriteria: [
    { criterionId: 'AC-1', statement: 'slug("A B") === "a-b"', requiredEvidenceTypes: ['TEST'] },
    { criterionId: 'AC-2', statement: 'the suite passes', requiredEvidenceTypes: ['TEST'] },
  ],
  requiredEvidence: ['TEST', 'DIFF'],
  requiredChecks: ['npm test -- src/slug.test.ts'],
  permittedPaths: ['src/slug.ts', 'src/slug.test.ts'],
  prohibitedActions: ['installing a dependency'],
  dependencyTaskIds: ['run-1:plan'],
  reviewCriteria: ['Does the diff satisfy AC-1 and AC-2 without touching package.json?'],
  failureConditions: ['the suite does not pass'],
  repairRules: ['a repair round addresses findings only'],
  budget: { ceilingUsdMicros: 5_000_000, maxRepairRounds: 3 },
  stoppingCondition: 'Stop when the suite passes or after two failed attempts.',
  state: 'DRAFT',
  bindingDigest: null,
  lockedAt: null,
  lockedByEvaluatorId: null,
  ...overrides,
});

const locked = (overrides: Partial<JuliusTaskContract> = {}): JuliusTaskContract => {
  const outcome = lockJuliusTaskContract({
    contract: draft(overrides),
    verdict: { verdict: 'ACCEPT', evaluatorId: 'evaluator-1' },
    lockedAt: '2026-09-08T00:00:00.000Z',
  });
  if (outcome.outcome !== 'LOCKED') throw new Error(`fixture did not lock: ${JSON.stringify(outcome)}`);
  return outcome.contract;
};

describe('validation — a contract that cannot be reviewed against is refused', () => {
  it('accepts a complete draft', () => {
    expect(validateJuliusTaskContract(draft())).toEqual({ valid: true, errors: [] });
  });

  it('refuses a contract with no blocking acceptance criteria', () => {
    const result = validateJuliusTaskContract(draft({ blockingAcceptanceCriteria: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('blocking_acceptance_criteria_required');
  });

  it('refuses a criterion nothing can prove — that is prose, not a criterion', () => {
    const result = validateJuliusTaskContract(draft({
      blockingAcceptanceCriteria: [{ criterionId: 'AC-1', statement: 'it is good', requiredEvidenceTypes: [] }],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('criterion_evidence_required:AC-1');
  });

  it('refuses duplicate criterion ids, which would make a finding ambiguous', () => {
    const result = validateJuliusTaskContract(draft({
      blockingAcceptanceCriteria: [
        { criterionId: 'AC-1', statement: 'a', requiredEvidenceTypes: ['TEST'] },
        { criterionId: 'AC-1', statement: 'b', requiredEvidenceTypes: ['TEST'] },
      ],
    }));
    expect(result.errors).toContain('criterion_id_duplicated:AC-1');
  });

  it.each([
    ['objective', { objective: '   ' }, 'objective_required'],
    ['responsibility boundary', { responsibilityBoundary: '' }, 'responsibility_boundary_required'],
    ['stopping condition', { stoppingCondition: '' }, 'stopping_condition_required'],
    ['required inputs', { requiredInputs: [] }, 'required_inputs_required'],
    ['expected outputs', { expectedOutputs: [] }, 'expected_outputs_required'],
    ['in scope', { inScope: [] }, 'in_scope_required'],
    ['required evidence', { requiredEvidence: [] }, 'required_evidence_required'],
    ['review criteria', { reviewCriteria: [] }, 'review_criteria_required'],
    ['failure conditions', { failureConditions: [] }, 'failure_conditions_required'],
  ])('refuses a contract missing its %s', (_label, overrides, code) => {
    const result = validateJuliusTaskContract(draft(overrides as Partial<JuliusTaskContract>));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(code);
  });

  it('permits the fields where emptiness is a real answer', () => {
    const result = validateJuliusTaskContract(draft({
      outOfScope: [], prohibitedActions: [], dependencyTaskIds: [], requiredChecks: [], repairRules: [],
    }));
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('refuses a budget that is zero, negative or fractional — unknown is not zero', () => {
    expect(validateJuliusTaskContract(draft({ budget: { ceilingUsdMicros: 0, maxRepairRounds: 1 } })).errors)
      .toContain('budget_ceiling_invalid');
    expect(validateJuliusTaskContract(draft({ budget: { ceilingUsdMicros: -1, maxRepairRounds: 1 } })).errors)
      .toContain('budget_ceiling_invalid');
    expect(validateJuliusTaskContract(draft({ budget: { ceilingUsdMicros: 1.5, maxRepairRounds: 1 } })).errors)
      .toContain('budget_ceiling_invalid');
    expect(validateJuliusTaskContract(draft({ budget: { ceilingUsdMicros: 1, maxRepairRounds: -1 } })).errors)
      .toContain('budget_repair_rounds_invalid');
  });

  it('refuses a LOCKED row with no digest, and a DRAFT row that carries one', () => {
    expect(validateJuliusTaskContract(draft({ state: 'LOCKED', bindingDigest: null })).errors)
      .toContain('locked_contract_requires_binding_digest');
    expect(validateJuliusTaskContract(draft({ state: 'DRAFT', bindingDigest: 'sha256:beef' })).errors)
      .toContain('unlocked_contract_must_not_carry_binding_digest');
  });
});

describe('the binding digest', () => {
  it('is stable across key order and repeated computation', () => {
    const a = draft();
    const b: JuliusTaskContract = { ...draft(), objective: a.objective };
    expect(juliusTaskContractBindingDigest(a)).toBe(juliusTaskContractBindingDigest(a));
    expect(juliusTaskContractBindingDigest(a)).toBe(juliusTaskContractBindingDigest(b));
  });

  it('ignores lock provenance — a draft and the contract it locks into agree', () => {
    const before = draft();
    const after = locked();
    expect(after.bindingDigest).toBe(juliusTaskContractBindingDigest(before));
  });

  it('changes when ANY term changes', () => {
    const base = juliusTaskContractBindingDigest(draft());
    const mutations: Partial<JuliusTaskContract>[] = [
      { objective: 'something else' },
      { responsibilityBoundary: 'wider' },
      { requiredInputs: ['only one'] },
      { expectedOutputs: ['nothing'] },
      { inScope: ['src/other.ts'] },
      { outOfScope: [] },
      { blockingAcceptanceCriteria: [{ criterionId: 'AC-1', statement: 'x', requiredEvidenceTypes: ['TEST'] }] },
      { requiredEvidence: ['TEST'] },
      { requiredChecks: [] },
      { permittedPaths: ['src/'] },
      { prohibitedActions: [] },
      { dependencyTaskIds: [] },
      { reviewCriteria: ['other'] },
      { failureConditions: ['other'] },
      { repairRules: [] },
      { budget: { ceilingUsdMicros: 5_000_001, maxRepairRounds: 3 } },
      { stoppingCondition: 'never' },
      { contractRevision: 2 },
      { missionContractRevision: 4 },
      { taskId: 'run-1:other' },
      { runId: 'run-2' },
      { contractId: 'contract-2' },
    ];
    for (const mutation of mutations) {
      expect(juliusTaskContractBindingDigest(draft(mutation)), JSON.stringify(mutation)).not.toBe(base);
    }
  });

  it('distinguishes a reordered criteria list — order is part of the agreement', () => {
    const forward = draft();
    const reversed = draft({ blockingAcceptanceCriteria: [...forward.blockingAcceptanceCriteria].reverse() });
    expect(juliusTaskContractBindingDigest(reversed)).not.toBe(juliusTaskContractBindingDigest(forward));
  });

  it('refuses to hash a field that went missing rather than silently dropping it', () => {
    // `JSON.stringify` omits an undefined value, so a lost constraint would
    // hash identically to a contract that never had one.
    const damaged = { ...draft(), stoppingCondition: undefined } as unknown as JuliusTaskContract;
    expect(() => juliusTaskContractBindingDigest(damaged)).toThrow(/canonical_undefined/u);
  });

  it('refuses a non-finite number, which JSON would render as null', () => {
    const damaged = draft({ budget: { ceilingUsdMicros: Number.NaN, maxRepairRounds: 1 } });
    expect(() => juliusTaskContractBindingDigest(damaged)).toThrow(/canonical_non_finite/u);
  });

  it('binds the compiler version, so changing canonicalisation invalidates old digests', () => {
    expect(JULIUS_TASK_CONTRACT_VERSION).toBe('julius-task-contract.v1');
  });
});

describe('the cycle — draft, challenge, revise, accept, lock', () => {
  it('a challenge does not edit the contract, it only moves it to CHALLENGED', () => {
    const before = draft();
    const outcome = challengeJuliusTaskContract(before, {
      verdict: 'CHALLENGE', evaluatorId: 'evaluator-1', objections: ['AC-2 is unmeasurable'],
    });
    expect(outcome.outcome).toBe('CHALLENGED');
    if (outcome.outcome !== 'CHALLENGED') throw new Error('unreachable');
    expect(outcome.contract.state).toBe('CHALLENGED');
    expect(juliusTaskContractBindingDigest(outcome.contract)).toBe(juliusTaskContractBindingDigest(before));
  });

  it('a challenge with no objection is refused — it is an accept wearing a challenge’s clothes', () => {
    expect(challengeJuliusTaskContract(draft(), { verdict: 'CHALLENGE', evaluatorId: 'e', objections: [] }))
      .toEqual({ outcome: 'REFUSED', reasonCode: 'challenge_requires_objections' });
  });

  it('a locked contract cannot be challenged or re-locked', () => {
    const contract = locked();
    expect(challengeJuliusTaskContract(contract, { verdict: 'CHALLENGE', evaluatorId: 'e', objections: ['x'] }))
      .toEqual({ outcome: 'REFUSED', reasonCode: 'contract_already_locked' });
    expect(lockJuliusTaskContract({
      contract, verdict: { verdict: 'ACCEPT', evaluatorId: 'e' }, lockedAt: '2026-09-08T01:00:00.000Z',
    })).toEqual({ outcome: 'REFUSED', reasonCode: 'contract_already_locked' });
  });

  it('locking records the evaluator and the instant, and computes the digest itself', () => {
    const contract = locked();
    expect(contract.state).toBe('LOCKED');
    expect(contract.lockedByEvaluatorId).toBe('evaluator-1');
    expect(contract.lockedAt).toBe('2026-09-08T00:00:00.000Z');
    expect(contract.bindingDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('refuses to lock an incomplete contract — a binding to an unreviewable document', () => {
    const outcome = lockJuliusTaskContract({
      contract: draft({ blockingAcceptanceCriteria: [] }),
      verdict: { verdict: 'ACCEPT', evaluatorId: 'e' },
      lockedAt: '2026-09-08T00:00:00.000Z',
    });
    expect(outcome).toEqual({
      outcome: 'REFUSED', reasonCode: 'contract_invalid:blocking_acceptance_criteria_required',
    });
  });

  it('refuses to lock without an evaluator or an instant', () => {
    expect(lockJuliusTaskContract({
      contract: draft(), verdict: { verdict: 'ACCEPT', evaluatorId: '' }, lockedAt: '2026-09-08T00:00:00.000Z',
    })).toEqual({ outcome: 'REFUSED', reasonCode: 'evaluator_required' });
    expect(lockJuliusTaskContract({
      contract: draft(), verdict: { verdict: 'ACCEPT', evaluatorId: 'e' }, lockedAt: '',
    })).toEqual({ outcome: 'REFUSED', reasonCode: 'locked_at_required' });
  });
});

describe('revision — rule 3, and the fields a worker may not rewrite', () => {
  it('a revision is a NEW revision, unlocked, with no digest', () => {
    const outcome = reviseJuliusTaskContract({
      contract: locked(), proposal: { objective: 'Add a deterministic slug helper, ASCII only, and prove it.' },
    });
    expect(outcome.outcome).toBe('REVISED');
    if (outcome.outcome !== 'REVISED') throw new Error('unreachable');
    expect(outcome.contract.contractRevision).toBe(2);
    expect(outcome.contract.state).toBe('DRAFT');
    expect(outcome.contract.bindingDigest).toBeNull();
    expect(outcome.contract.lockedAt).toBeNull();
    expect(outcome.contract.lockedByEvaluatorId).toBeNull();
  });

  it('revising a LOCKED contract supersedes it rather than overwriting it', () => {
    const previous = locked();
    const outcome = reviseJuliusTaskContract({ contract: previous, proposal: { outOfScope: ['package.json', 'README.md'] } });
    if (outcome.outcome !== 'REVISED') throw new Error('unreachable');
    expect(outcome.supersedes?.state).toBe('SUPERSEDED');
    // The superseded record keeps the terms and the digest that were dispatched under.
    expect(outcome.supersedes?.bindingDigest).toBe(previous.bindingDigest);
  });

  it('revising an unlocked draft supersedes nothing', () => {
    const outcome = reviseJuliusTaskContract({ contract: draft(), proposal: { outOfScope: [] } });
    if (outcome.outcome !== 'REVISED') throw new Error('unreachable');
    expect(outcome.supersedes).toBeNull();
  });

  it('a proposal cannot drop, add or rename an acceptance criterion', () => {
    const dropped = reviseJuliusTaskContract({
      contract: locked(),
      proposal: { blockingAcceptanceCriteria: [{ criterionId: 'AC-1', statement: 'a', requiredEvidenceTypes: ['TEST'] }] },
    });
    expect(dropped).toEqual({ outcome: 'REFUSED', reasonCode: 'criterion_ids_are_mission_owned' });

    const renamed = reviseJuliusTaskContract({
      contract: locked(),
      proposal: {
        blockingAcceptanceCriteria: [
          { criterionId: 'AC-1', statement: 'a', requiredEvidenceTypes: ['TEST'] },
          { criterionId: 'AC-9', statement: 'b', requiredEvidenceTypes: ['TEST'] },
        ],
      },
    });
    expect(renamed).toEqual({ outcome: 'REFUSED', reasonCode: 'criterion_ids_are_mission_owned' });
  });

  it('a proposal MAY reword a criterion it keeps — that is what the challenge cycle is for', () => {
    const outcome = reviseJuliusTaskContract({
      contract: locked(),
      proposal: {
        blockingAcceptanceCriteria: [
          { criterionId: 'AC-1', statement: 'slug("A  B") === "a-b" (runs collapse)', requiredEvidenceTypes: ['TEST'] },
          { criterionId: 'AC-2', statement: 'the suite passes', requiredEvidenceTypes: ['TEST'] },
        ],
      },
    });
    expect(outcome.outcome).toBe('REVISED');
  });

  it('a proposal carrying mission-owned keys at RUNTIME cannot move them', () => {
    // The type forbids these; provider output is not compiled, so the runtime
    // restatement is what actually holds. A spread-only implementation passes
    // the type check and fails this.
    const hostile = {
      budget: { ceilingUsdMicros: 999_000_000, maxRepairRounds: 99 },
      runId: 'run-hijack', taskId: 'run-hijack:build', missionContractRevision: 99,
      contractId: 'contract-hijack', contractRevision: 400,
    } as unknown as Parameters<typeof reviseJuliusTaskContract>[0]['proposal'];
    const outcome = reviseJuliusTaskContract({ contract: locked(), proposal: hostile });
    if (outcome.outcome !== 'REVISED') throw new Error('unreachable');
    expect(outcome.contract.budget).toEqual({ ceilingUsdMicros: 5_000_000, maxRepairRounds: 3 });
    expect(outcome.contract.runId).toBe('run-1');
    expect(outcome.contract.taskId).toBe('run-1:build');
    expect(outcome.contract.missionContractRevision).toBe(3);
    expect(outcome.contract.contractId).toBe('contract-1');
    expect(outcome.contract.contractRevision).toBe(2);
  });

  it('names every mission-owned field it protects', () => {
    expect([...JULIUS_CONTRACT_MISSION_OWNED_FIELDS]).toEqual(
      ['runId', 'taskId', 'missionContractRevision', 'criterionIds', 'budget'],
    );
  });

  it('a revision that would be invalid is refused rather than stored', () => {
    const outcome = reviseJuliusTaskContract({ contract: locked(), proposal: { inScope: [] } });
    expect(outcome).toEqual({ outcome: 'REFUSED', reasonCode: 'contract_invalid:in_scope_required' });
  });

  it('a superseded contract cannot be revised or locked', () => {
    const superseded = draft({ state: 'SUPERSEDED' });
    expect(reviseJuliusTaskContract({ contract: superseded, proposal: {} }))
      .toEqual({ outcome: 'REFUSED', reasonCode: 'contract_superseded' });
    expect(lockJuliusTaskContract({
      contract: superseded, verdict: { verdict: 'ACCEPT', evaluatorId: 'e' }, lockedAt: '2026-09-08T00:00:00.000Z',
    })).toEqual({ outcome: 'REFUSED', reasonCode: 'contract_superseded' });
  });
});

describe('rule 1 — coding must not begin before the contract is locked', () => {
  it('permits a locked contract, and returns the binding to carry', () => {
    const verdict = mayDispatchUnderContract(locked());
    expect(verdict.permitted).toBe(true);
    if (!verdict.permitted) throw new Error('unreachable');
    expect(verdict.binding.contractRevision).toBe(1);
    expect(verdict.binding.taskId).toBe('run-1:build');
  });

  it.each([
    ['a missing contract', null, 'contract_absent'],
    ['a draft', draft(), 'contract_not_locked'],
    ['a challenged draft', draft({ state: 'CHALLENGED' }), 'contract_challenged'],
    ['a superseded contract', draft({ state: 'SUPERSEDED' }), 'contract_superseded'],
  ])('refuses %s, and says which', (_label, contract, reasonCode) => {
    expect(mayDispatchUnderContract(contract)).toEqual({ permitted: false, reasonCode });
  });

  it('refuses a LOCKED row with no digest — that is corruption, not permission', () => {
    expect(mayDispatchUnderContract(draft({ state: 'LOCKED', bindingDigest: null })))
      .toEqual({ permitted: false, reasonCode: 'locked_contract_missing_binding' });
  });

  it('a binding is only ever taken from a locked contract', () => {
    expect(juliusTaskContractBinding(draft())).toBeNull();
    expect(juliusTaskContractBinding(draft({ state: 'CHALLENGED' }))).toBeNull();
    expect(juliusTaskContractBinding(draft({ state: 'SUPERSEDED', bindingDigest: 'sha256:x' }))).toBeNull();
    expect(juliusTaskContractBinding(locked())).not.toBeNull();
  });
});

describe('rule 2 — the coder and the reviewer hold the same binding', () => {
  const binding = juliusTaskContractBinding(locked());

  it('agrees when both name the same contract, revision and digest', () => {
    const verdict = evaluateJuliusSharedBinding({ implementation: binding, review: { ...binding! } });
    expect(verdict).toEqual({ shared: true, binding });
  });

  it.each([
    ['a different contract', { contractId: 'contract-2' }, 'binding_contract_mismatch'],
    ['a different task', { taskId: 'run-1:other' }, 'binding_task_mismatch'],
    ['a different revision', { contractRevision: 2 }, 'binding_revision_mismatch'],
    ['the same revision with different content', { bindingDigest: 'sha256:0' }, 'binding_digest_mismatch'],
  ])('refuses %s', (_label, overrides, reasonCode) => {
    expect(evaluateJuliusSharedBinding({ implementation: binding, review: { ...binding!, ...overrides } }))
      .toEqual({ shared: false, reasonCode });
  });

  it('refuses when either side has no binding at all', () => {
    expect(evaluateJuliusSharedBinding({ implementation: null, review: binding }))
      .toEqual({ shared: false, reasonCode: 'implementation_binding_absent' });
    expect(evaluateJuliusSharedBinding({ implementation: binding, review: null }))
      .toEqual({ shared: false, reasonCode: 'review_binding_absent' });
  });
});

describe('rule 4 — an old handoff is stale when the binding changes', () => {
  const first = locked();
  const revisionTwo = (() => {
    const revised = reviseJuliusTaskContract({ contract: first, proposal: { outOfScope: ['package.json', 'README.md'] } });
    if (revised.outcome !== 'REVISED') throw new Error('unreachable');
    const relocked = lockJuliusTaskContract({
      contract: revised.contract, verdict: { verdict: 'ACCEPT', evaluatorId: 'evaluator-2' },
      lockedAt: '2026-09-08T02:00:00.000Z',
    });
    if (relocked.outcome !== 'LOCKED') throw new Error('unreachable');
    return relocked.contract;
  })();

  it('CURRENT when the record names the locked revision and digest', () => {
    expect(evaluateJuliusBindingCurrency({
      recorded: juliusTaskContractBinding(revisionTwo), contract: revisionTwo,
    })).toBe('CURRENT');
  });

  it('STALE when the record was compiled from an earlier revision of the same contract', () => {
    expect(evaluateJuliusBindingCurrency({
      recorded: juliusTaskContractBinding(first), contract: revisionTwo,
    })).toBe('STALE');
  });

  it('FOREIGN when the digest disagrees at the same revision — a retry would hide that', () => {
    const forged = { ...juliusTaskContractBinding(revisionTwo)!, bindingDigest: 'sha256:0' };
    expect(evaluateJuliusBindingCurrency({ recorded: forged, contract: revisionTwo })).toBe('FOREIGN');
  });

  it('FOREIGN when the record names a NEWER revision than the one locked', () => {
    expect(evaluateJuliusBindingCurrency({
      recorded: juliusTaskContractBinding(revisionTwo), contract: first,
    })).toBe('FOREIGN');
  });

  it('FOREIGN for a newer revision even when it carries the CURRENT digest', () => {
    // The ordering check is what catches this. A record from a revision that
    // was rolled back, re-stamped with the digest of the revision now locked,
    // would otherwise read CURRENT and authorise work under terms nobody holds.
    const forged = { ...juliusTaskContractBinding(first)!, contractRevision: 9 };
    expect(evaluateJuliusBindingCurrency({ recorded: forged, contract: first })).toBe('FOREIGN');
  });

  it('FOREIGN when the record is about another contract or another task', () => {
    const base = juliusTaskContractBinding(first)!;
    expect(evaluateJuliusBindingCurrency({ recorded: { ...base, contractId: 'other' }, contract: first })).toBe('FOREIGN');
    expect(evaluateJuliusBindingCurrency({ recorded: { ...base, taskId: 'other' }, contract: first })).toBe('FOREIGN');
  });

  it('INDETERMINATE — never CURRENT — when there is nothing locked to compare against', () => {
    expect(evaluateJuliusBindingCurrency({ recorded: null, contract: first })).toBe('INDETERMINATE');
    expect(evaluateJuliusBindingCurrency({ recorded: juliusTaskContractBinding(first), contract: null }))
      .toBe('INDETERMINATE');
    expect(evaluateJuliusBindingCurrency({ recorded: juliusTaskContractBinding(first), contract: draft() }))
      .toBe('INDETERMINATE');
  });

  it('INDETERMINATE for an unreadable recorded revision', () => {
    const base = juliusTaskContractBinding(first)!;
    expect(evaluateJuliusBindingCurrency({ recorded: { ...base, contractRevision: 0 }, contract: first }))
      .toBe('INDETERMINATE');
    expect(evaluateJuliusBindingCurrency({ recorded: { ...base, contractRevision: 1.5 }, contract: first }))
      .toBe('INDETERMINATE');
  });
});

describe('rule 5 — the reviewer grades against the contract', () => {
  it('carries the terms, and quotes each criterion by its id so a finding can cite one', () => {
    const charge = juliusContractReviewCharge({ contract: locked(), stage: 'build' });
    expect(charge).not.toBeNull();
    expect(charge!.stage).toBe('build');
    expect(charge!.binding.bindingDigest).toBe(locked().bindingDigest);
    expect(charge!.blockingCriteria).toEqual(['[AC-1] slug("A B") === "a-b"', '[AC-2] the suite passes']);
    expect(charge!.requiredChecks).toEqual(['npm test -- src/slug.test.ts']);
    expect(charge!.permittedPaths).toEqual(['src/slug.ts', 'src/slug.test.ts']);
    expect(charge!.outOfScope).toEqual(['package.json']);
    expect(charge!.stoppingCondition).toContain('Stop when');
  });

  it('refuses to charge a reviewer with terms that are still being argued about', () => {
    expect(juliusContractReviewCharge({ contract: draft(), stage: 'plan' })).toBeNull();
    expect(juliusContractReviewCharge({ contract: draft({ state: 'CHALLENGED' }), stage: 'plan' })).toBeNull();
    expect(juliusContractReviewCharge({ contract: draft({ state: 'SUPERSEDED' }), stage: 'build' })).toBeNull();
  });

  it('refuses a SUPERSEDED contract that still carries the digest it was locked with', () => {
    // This is the shape a store actually holds: superseding keeps the terms and
    // the digest, because work was dispatched under them. The lock STATE is
    // what decides, so a reviewer is never charged with terms that no longer
    // bind — a digest-only test would pass this and be wrong.
    const retired = { ...locked(), state: 'SUPERSEDED' as const };
    expect(retired.bindingDigest).not.toBeNull();
    expect(juliusContractReviewCharge({ contract: retired, stage: 'build' })).toBeNull();
    expect(juliusTaskContractBinding(retired)).toBeNull();
  });
});

describe('rule 6 — Julius keeps mission authority through the whole cycle', () => {
  it('a full challenge/revise/accept cycle cannot move the ceiling or the criteria', () => {
    const first = locked();
    const challenged = challengeJuliusTaskContract(draft(), {
      verdict: 'CHALLENGE', evaluatorId: 'evaluator-1', objections: ['scope is too wide'],
    });
    if (challenged.outcome !== 'CHALLENGED') throw new Error('unreachable');

    const revised = reviseJuliusTaskContract({
      contract: challenged.contract,
      proposal: {
        inScope: ['src/slug.ts'],
        ...({ budget: { ceilingUsdMicros: 50_000_000, maxRepairRounds: 50 } } as object),
      },
    });
    if (revised.outcome !== 'REVISED') throw new Error('unreachable');

    const relocked = lockJuliusTaskContract({
      contract: revised.contract, verdict: { verdict: 'ACCEPT', evaluatorId: 'evaluator-1' },
      lockedAt: '2026-09-08T03:00:00.000Z',
    });
    if (relocked.outcome !== 'LOCKED') throw new Error('unreachable');

    expect(relocked.contract.budget).toEqual({ ceilingUsdMicros: 5_000_000, maxRepairRounds: 3 });
    expect(relocked.contract.blockingAcceptanceCriteria.map((c) => c.criterionId)).toEqual(['AC-1', 'AC-2']);
    expect(relocked.contract.contractRevision).toBe(2);
    expect(relocked.contract.bindingDigest).not.toBe(first.bindingDigest);
  });
});

describe('the seed — Julius authors revision 1, the architect proposes the rest', () => {
  const terms = (overrides: Partial<Parameters<typeof seedJuliusTaskContract>[0]> = {}) => ({
    runId: 'run-1', taskId: 'run-1:build', missionContractRevision: 2,
    objective: 'Add a deterministic slug helper.',
    requirements: ['ASCII output only'],
    constraints: ['no new dependency'],
    acceptanceCriteria: [
      { id: 'AC-1', text: 'slug("A B") === "a-b"', blocking: true },
      { id: 'AC-2', text: 'the README mentions it', blocking: false },
    ],
    filesInScope: ['src/slug.ts'], filesOutOfScope: ['package.json'],
    spendUsd: 20, repairCycles: 3,
    requiredEvidence: ['TEST'] as const,
    ...overrides,
  });

  it('produces a valid, unlocked revision 1 from the mission', () => {
    const outcome = seedJuliusTaskContract(terms());
    expect(outcome.seeded).toBe(true);
    if (!outcome.seeded) throw new Error('unreachable');
    expect(validateJuliusTaskContract(outcome.contract)).toEqual({ valid: true, errors: [] });
    expect(outcome.contract).toMatchObject({
      contractId: 'contract:run-1:build', contractRevision: 1, state: 'DRAFT',
      bindingDigest: null, missionContractRevision: 2,
      objective: 'Add a deterministic slug helper.',
    });
  });

  it('takes ONLY the blocking criteria, keeping the mission’s own ids', () => {
    const outcome = seedJuliusTaskContract(terms());
    if (!outcome.seeded) throw new Error('unreachable');
    expect(outcome.contract.blockingAcceptanceCriteria.map((c) => c.criterionId)).toEqual(['AC-1']);
  });

  it('states the money as the two numbers the allocator takes', () => {
    const outcome = seedJuliusTaskContract(terms());
    if (!outcome.seeded) throw new Error('unreachable');
    expect(outcome.contract.budget).toEqual({ ceilingUsdMicros: 20_000_000, maxRepairRounds: 3 });
  });

  it('carries the mission constraints and the out-of-scope paths as prohibitions', () => {
    const outcome = seedJuliusTaskContract(terms());
    if (!outcome.seeded) throw new Error('unreachable');
    expect(outcome.contract.prohibitedActions).toEqual([
      'violating the mission constraint: no new dependency',
      'writing to package.json',
    ]);
    expect(outcome.contract.permittedPaths).toEqual(['src/slug.ts']);
  });

  it('leaves requiredChecks EMPTY rather than inventing commands the mission never named', () => {
    const outcome = seedJuliusTaskContract(terms());
    if (!outcome.seeded) throw new Error('unreachable');
    expect(outcome.contract.requiredChecks).toEqual([]);
  });

  it.each([
    ['an unknown spend ceiling', { spendUsd: null }, 'mission_spend_ceiling_unknown'],
    ['unknown repair rounds', { repairCycles: null }, 'mission_repair_rounds_unknown'],
    ['no blocking criterion', { acceptanceCriteria: [{ id: 'AC-2', text: 'x', blocking: false }] }, 'mission_has_no_blocking_criterion'],
    ['a zero ceiling', { spendUsd: 0 }, 'mission_spend_ceiling_invalid'],
    ['a negative ceiling', { spendUsd: -1 }, 'mission_spend_ceiling_invalid'],
  ])('refuses to seed from %s rather than defaulting one', (_label, overrides, reasonCode) => {
    expect(seedJuliusTaskContract(terms(overrides as never))).toEqual({ seeded: false, reasonCode });
  });

  it('refuses a mission with no required evidence — a criterion nothing can prove', () => {
    const outcome = seedJuliusTaskContract(terms({ requiredEvidence: [] as never }));
    expect(outcome.seeded).toBe(false);
    if (outcome.seeded) throw new Error('unreachable');
    expect(outcome.reasonCode).toMatch(/^contract_invalid:/u);
  });

  it('says "the granted repository" rather than inventing a narrower scope', () => {
    const outcome = seedJuliusTaskContract(terms({ filesInScope: [] }));
    if (!outcome.seeded) throw new Error('unreachable');
    expect(outcome.contract.inScope).toEqual(['the granted repository']);
    expect(outcome.contract.permittedPaths).toEqual([]);
  });

  it('a replayed bootstrap seeds the SAME contract, not a second one', () => {
    const first = seedJuliusTaskContract(terms());
    const second = seedJuliusTaskContract(terms());
    if (!first.seeded || !second.seeded) throw new Error('unreachable');
    expect(second.contract.contractId).toBe(first.contract.contractId);
    expect(juliusTaskContractBindingDigest(second.contract)).toBe(juliusTaskContractBindingDigest(first.contract));
  });

  it('the architect may revise it, and still cannot move the money or the criteria', () => {
    const seeded = seedJuliusTaskContract(terms());
    if (!seeded.seeded) throw new Error('unreachable');
    const revised = reviseJuliusTaskContract({
      contract: seeded.contract,
      proposal: {
        requiredChecks: ['npm test -- src/slug.test.ts'],
        responsibilityBoundary: 'Implement src/slug.ts and its unit test; touch nothing else.',
        ...({ budget: { ceilingUsdMicros: 999_000_000, maxRepairRounds: 99 } } as object),
      },
    });
    if (revised.outcome !== 'REVISED') throw new Error('unreachable');
    expect(revised.contract.requiredChecks).toEqual(['npm test -- src/slug.test.ts']);
    expect(revised.contract.budget).toEqual({ ceilingUsdMicros: 20_000_000, maxRepairRounds: 3 });
    expect(revised.contract.blockingAcceptanceCriteria.map((c) => c.criterionId)).toEqual(['AC-1']);
    expect(revised.contract.contractRevision).toBe(2);
  });
});

describe('sanitising a proposal that came from a provider', () => {
  it('keeps the fields a worker may propose', () => {
    expect(sanitizeJuliusContractProposal({
      objective: '  Add a slug helper.  ',
      responsibilityBoundary: 'src/slug.ts only',
      requiredChecks: ['npm test'],
      permittedPaths: ['src/slug.ts'],
    })).toEqual({
      objective: 'Add a slug helper.',
      responsibilityBoundary: 'src/slug.ts only',
      requiredChecks: ['npm test'],
      permittedPaths: ['src/slug.ts'],
    });
  });

  it('DROPS every field not on the allowlist, mission-owned ones included', () => {
    const result = sanitizeJuliusContractProposal({
      objective: 'ok',
      budget: { ceilingUsdMicros: 999_000_000, maxRepairRounds: 99 },
      runId: 'run-hijack', taskId: 'other', contractRevision: 400,
      blockingAcceptanceCriteria: [], state: 'LOCKED', bindingDigest: 'sha256:0',
      somethingNobodyDeclared: true,
    });
    expect(result).toEqual({ objective: 'ok' });
  });

  it('refuses the whole proposal when a field it DID send is unusable', () => {
    // Half a proposal is a document nobody wrote, and keeping Julius's text for
    // the other half would attribute it to the worker.
    expect(sanitizeJuliusContractProposal({ objective: '   ' })).toBeNull();
    expect(sanitizeJuliusContractProposal({ objective: 42 })).toBeNull();
    expect(sanitizeJuliusContractProposal({ requiredChecks: 'npm test' })).toBeNull();
    expect(sanitizeJuliusContractProposal({ requiredChecks: ['ok', 7] })).toBeNull();
    expect(sanitizeJuliusContractProposal({ inScope: [''] })).toBeNull();
  });

  it('refuses anything that is not an object, which provider output often is not', () => {
    for (const value of [null, undefined, 'a plan', 7, true, ['a'], []]) {
      expect(sanitizeJuliusContractProposal(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('bounds the size, because a contract shares the context budget with the findings', () => {
    const { stringChars, entryChars, entriesPerList } = JULIUS_CONTRACT_PROPOSAL_LIMITS;
    expect(sanitizeJuliusContractProposal({ objective: 'x'.repeat(stringChars) })).not.toBeNull();
    expect(sanitizeJuliusContractProposal({ objective: 'x'.repeat(stringChars + 1) })).toBeNull();
    expect(sanitizeJuliusContractProposal({ inScope: ['x'.repeat(entryChars + 1)] })).toBeNull();
    expect(sanitizeJuliusContractProposal({
      inScope: Array.from({ length: entriesPerList + 1 }, (_, index) => `file-${index}.ts`),
    })).toBeNull();
  });

  it('a proposal that proposes nothing is null, not an empty revision', () => {
    expect(sanitizeJuliusContractProposal({})).toBeNull();
    expect(sanitizeJuliusContractProposal({ notAField: 'x' })).toBeNull();
  });

  it('what survives still cannot move a mission-owned field through the revision', () => {
    const sanitized = sanitizeJuliusContractProposal({ objective: 'narrower', inScope: ['src/slug.ts'] })!;
    const revised = reviseJuliusTaskContract({ contract: locked(), proposal: sanitized });
    if (revised.outcome !== 'REVISED') throw new Error('unreachable');
    expect(revised.contract.budget).toEqual({ ceilingUsdMicros: 5_000_000, maxRepairRounds: 3 });
    expect(revised.contract.blockingAcceptanceCriteria.map((c) => c.criterionId)).toEqual(['AC-1', 'AC-2']);
    expect(revised.contract.objective).toBe('narrower');
  });
});
