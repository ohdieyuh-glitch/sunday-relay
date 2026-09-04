import { describe, expect, it } from 'vitest';

import { ARCHITECT_PLAN_SCHEMA } from '../../connectors/gpt-architect/plan-schema';
import { validateArchitectPlan, type ArchitectPlanReasonCode } from './prompt-architect-plan';

/**
 * WHERE THE PROVIDER SCHEMA AND THE JULIUS VALIDATOR DISAGREE.
 *
 * Paid attempt #3 (run 33897565981) bought a GPT-5.6 Sol answer that satisfied
 * the strict JSON schema, parsed as JSON, and was then refused by
 * `validateArchitectPlan` — durable class `plan_validation_failed`, and nothing
 * else. Nobody had written down which states the schema lets through and the
 * validator refuses, so the gap was invisible until it cost a paid run.
 *
 * This file IS that list. Each case asserts BOTH halves of the drift: the
 * schema does not constrain the value, and the validator refuses it with a
 * named code. It deliberately does not run a JSON Schema engine — the claim
 * under test is about the schema DOCUMENT this repository sends, not about one
 * implementation's reading of it, and the Responses API is the only reader
 * whose opinion decides a paid run.
 */

const prop = (path: readonly string[]): Record<string, unknown> => {
  let node = ARCHITECT_PLAN_SCHEMA as Record<string, unknown>;
  for (const key of path) node = (node[key] ?? {}) as Record<string, unknown>;
  return node;
};

const VALID = () => ({
  objectiveSummary: 'Implement the mission fixture change.',
  assumptions: [{ id: 'A1', statement: 'The fixture exists.', confidence: 'medium' }],
  unresolvedQuestions: [],
  requirements: [{ id: 'R1', statement: 'It must pass.', rationale: 'The contract says so.' }],
  architectureDecisions: [{ id: 'D1', decision: 'Edit in place.', rationale: 'Smallest change.', alternativesConsidered: [], accepted: false }],
  implementationSteps: [{ order: 1, description: 'Edit the fixture.', filesTouched: ['fixtures/a.ts'] }],
  acceptanceCriteria: ['AC-1'], testPlan: ['npm test'],
  risks: [{ id: 'RISK1', risk: 'None material.', mitigation: 'Review.', severity: 'low' }],
  prohibitedActions: [], proposedContractAmendments: [], contextRefs: [],
  handoff: {
    objective: 'Implement the fixture change.',
    boundedTask: 'Edit exactly the fixture files and make the test pass.',
    acceptanceCriteria: ['AC-1'], requiredTests: ['npm test'],
    allowedFileScope: ['fixtures/'], prohibitedActions: [], grantedTools: [],
    missionContractRef: 'contract-1', environmentRef: null, expectedEvidence: ['TEST'],
  },
});

/** Mutate a deep copy, so no case can leak into the next. */
const mutate = (change: (plan: ReturnType<typeof VALID>) => void) => {
  const plan = JSON.parse(JSON.stringify(VALID())) as ReturnType<typeof VALID>;
  change(plan);
  return plan;
};

const refusedWith = (plan: unknown, code: ArchitectPlanReasonCode) => {
  const result = validateArchitectPlan(plan);
  expect(result.ok, 'the validator must refuse this plan').toBe(false);
  if (result.ok) return;
  expect(result.reasonCode).toBe(code);
};

describe('the baseline both sides accept', () => {
  it('a complete plan passes the validator', () => {
    const result = validateArchitectPlan(VALID());
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
  });
});

describe('states the strict schema PERMITS and Julius refuses', () => {
  /**
   * Each case names the schema node that does not constrain the value. When a
   * constraint is added to the schema AND proven accepted by the Responses API,
   * the matching assertion here is what should be inverted — deliberately, not
   * silently.
   */
  it('1. objectiveSummary may be empty', () => {
    expect(prop(['properties', 'objectiveSummary']).minLength, 'schema does not bound it').toBeUndefined();
    refusedWith(mutate((p) => { p.objectiveSummary = ''; }), 'objective_summary_empty');
    refusedWith(mutate((p) => { p.objectiveSummary = '   '; }), 'objective_summary_empty');
  });

  it('2. an assumption statement may be empty', () => {
    expect(prop(['properties', 'assumptions', 'items', 'properties', 'statement']).minLength).toBeUndefined();
    refusedWith(mutate((p) => { p.assumptions[0]!.statement = ''; }), 'assumption_statement_empty');
  });

  it('3. an architecture decision statement may be empty', () => {
    expect(prop(['properties', 'architectureDecisions', 'items', 'properties', 'decision']).minLength).toBeUndefined();
    refusedWith(mutate((p) => { p.architectureDecisions[0]!.decision = ''; }), 'decision_statement_empty');
  });

  it('4. an architecture decision rationale may be empty', () => {
    expect(prop(['properties', 'architectureDecisions', 'items', 'properties', 'rationale']).minLength).toBeUndefined();
    refusedWith(mutate((p) => { p.architectureDecisions[0]!.rationale = ''; }), 'decision_rationale_empty');
  });

  it('5. handoff.objective may be empty', () => {
    expect(prop(['properties', 'handoff', 'properties', 'objective']).minLength).toBeUndefined();
    refusedWith(mutate((p) => { p.handoff.objective = ''; }), 'handoff_objective_empty');
  });

  it('6. handoff.boundedTask may be empty', () => {
    expect(prop(['properties', 'handoff', 'properties', 'boundedTask']).minLength).toBeUndefined();
    refusedWith(mutate((p) => { p.handoff.boundedTask = ''; }), 'handoff_bounded_task_empty');
  });

  it('7. handoff.allowedFileScope may be empty — an unbounded handoff', () => {
    expect(prop(['properties', 'handoff', 'properties', 'allowedFileScope']).minItems).toBeUndefined();
    refusedWith(mutate((p) => { p.handoff.allowedFileScope = []; }), 'handoff_allowed_scope_empty');
  });

  it('8. any field may claim work that never happened — JSON Schema cannot express this at all', () => {
    // The only drift no schema keyword could close. It is a claim about
    // MEANING, so the charter is the only place it can be prevented, and the
    // validator is the only place it can be caught.
    for (const claim of ['files were edited', 'tests were run', 'i ran the tests', 'i edited']) {
      refusedWith(mutate((p) => { p.objectiveSummary = `Done — ${claim} already.`; }), 'plan_false_work_claim');
    }
    // Case-insensitively, and anywhere in the document.
    refusedWith(mutate((p) => { p.handoff.boundedTask = 'I EDITED the fixture.'; }), 'plan_false_work_claim');
  });
});

describe('states the strict schema DOES prevent, so the validator is a second line', () => {
  it('a self-accepted decision is unrepresentable: the only legal value is false', () => {
    expect(prop(['properties', 'architectureDecisions', 'items', 'properties', 'accepted']).enum).toEqual([false]);
    // And the validator refuses it anyway, because defense in depth is the point.
    refusedWith(mutate((p) => { (p.architectureDecisions[0] as { accepted: boolean }).accepted = true; }), 'decision_pre_accepted');
  });

  it('every object is closed and every field required, so nothing may be omitted or added', () => {
    expect(ARCHITECT_PLAN_SCHEMA.additionalProperties).toBe(false);
    expect(prop(['properties', 'handoff']).additionalProperties).toBe(false);
    const required = ARCHITECT_PLAN_SCHEMA.required as string[];
    for (const key of Object.keys(ARCHITECT_PLAN_SCHEMA.properties as object)) {
      expect(required, `${key} must be required, or strict mode would let it be omitted`).toContain(key);
    }
    const handoffRequired = prop(['properties', 'handoff']).required as string[];
    for (const key of Object.keys(prop(['properties', 'handoff']).properties as object)) {
      expect(handoffRequired, `handoff.${key} must be required`).toContain(key);
    }
  });

  it('and the validator still refuses the shapes the schema would have caught', () => {
    // Belt and braces: if the schema were ever relaxed, these do not become
    // acceptable. Each is a state strict mode already makes unreachable.
    refusedWith('not an object', 'plan_object_invalid');
    refusedWith(mutate((p) => { (p as { assumptions: unknown }).assumptions = 'nope'; }), 'required_array_invalid');
    refusedWith(mutate((p) => { (p as { acceptanceCriteria: unknown }).acceptanceCriteria = [1]; }), 'required_string_array_invalid');
    refusedWith(mutate((p) => { (p as { architectureDecisions: unknown[] }).architectureDecisions = ['nope']; }), 'decision_object_invalid');
    refusedWith(mutate((p) => { (p as { handoff: unknown }).handoff = null; }), 'handoff_missing');
    refusedWith(mutate((p) => { (p.handoff as { requiredTests: unknown }).requiredTests = [1]; }), 'handoff_array_invalid');
  });
});

describe('the reason code is a closed vocabulary', () => {
  it('every refusal carries one, and it is a lower-case machine token', () => {
    const cases: unknown[] = [
      'not an object', {},
      mutate((p) => { p.objectiveSummary = ''; }),
      mutate((p) => { p.handoff.allowedFileScope = []; }),
      mutate((p) => { p.objectiveSummary = 'i edited it'; }),
    ];
    for (const value of cases) {
      const result = validateArchitectPlan(value);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reasonCode, `"${String(result.reason).slice(0, 40)}"`).toMatch(/^[a-z][a-z0-9_]{0,63}$/u);
      // The prose reason may name a field; the CODE never carries model text.
      expect(result.reasonCode).not.toContain(' ');
    }
  });

  it('a field name travels separately, and is a literal this repository wrote', () => {
    const arrayFailure = validateArchitectPlan(mutate((p) => { (p as { risks: unknown }).risks = 'nope'; }));
    expect(arrayFailure.ok).toBe(false);
    if (arrayFailure.ok) return;
    expect(arrayFailure.reasonField).toBe('risks');
    expect(arrayFailure.reasonField).toMatch(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)?$/u);
  });
});
