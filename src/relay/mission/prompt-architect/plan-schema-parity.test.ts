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

  it('8. any CLAIM field may claim work that never happened — JSON Schema cannot express this at all', () => {
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

describe('a field that ENUMERATES a condition is not a field that CLAIMS one', () => {
  /**
   * THE LINE, and why it is drawn here rather than around two field names.
   *
   * The first repair exempted the two `prohibitedActions` lists, on the theory
   * that the architect had named the forbidden act while forbidding it. Paid
   * run 34186711214 then refused a SECOND independent `gpt-5.6-sol` sample of
   * the same mission with the same code — 14,550 bytes against 14,581, a
   * different response id — which makes the trip systematic rather than a
   * sampling accident, and means an exemption chosen by guesswork may not even
   * cover the field that fired.
   *
   * So the rule is aimed at what a completion claim IS: an assertion about the
   * state of the work. The fields below assert nothing of the kind — a
   * prohibition names an act that must not happen, an acceptance criterion
   * states a condition that must hold at the END, a test plan enumerates checks
   * still to be performed, expected evidence names artefacts that do not exist
   * yet, and a risk describes what might go wrong. "The tests were run and
   * exited zero" is the correct English for a criterion and could not mislead
   * anybody about what has already happened.
   */
  it('exempts the prohibition lists at either level', () => {
    const topLevel = mutate((p) => {
      (p as { prohibitedActions: string[] }).prohibitedActions = ['claiming that files were edited before the Coding Agent runs'];
    });
    expect(validateArchitectPlan(topLevel).ok, 'a top-level prohibition naming the act').toBe(true);

    const inHandoff = mutate((p) => {
      (p.handoff as { prohibitedActions: string[] }).prohibitedActions = ['stating that tests were run', 'saying I ran the tests'];
    });
    expect(validateArchitectPlan(inHandoff).ok, 'a handoff prohibition naming the act').toBe(true);
  });

  it('PAID RUN 34186711214 — a plan that forbids the claim at BOTH levels is accepted whole', () => {
    /**
     * THE REGRESSION THIS RULE COST A PAID MISSION TO LEARN, pinned as one
     * scenario rather than two field pokes. The architect's charter named all
     * four banned phrases inside the prohibition, and the schema then asks for
     * `prohibitedActions` at both levels — so the most obedient possible answer
     * carried them in both places at once, which is the document below.
     *
     * The 14,550-byte plan the run actually bought was never persisted: the
     * evidence bundle is built by allowlist and a model's plan is not on it. So
     * this is not that document; it is the SHAPE the rule could not tell apart
     * from a plan claiming the work, and the whole plan is validated rather
     * than one mutated field, because that is how it arrives.
     */
    const forbidsAtBothLevels = mutate((p) => {
      (p as { prohibitedActions: string[] }).prohibitedActions = [
        'claiming that files were edited before the Coding Agent has run',
      ];
      (p.handoff as { prohibitedActions: string[] }).prohibitedActions = [
        'stating that tests were run before the executor has run them',
        'saying I ran the tests',
      ];
      p.acceptanceCriteria = ['AC-1: the fixture test passes'];
      p.testPlan = ['npm run mission-test'];
      (p.risks[0] as { mitigation: string }).mitigation = 'Review the diff before claiming files were edited.';
    });
    const result = validateArchitectPlan(forbidsAtBothLevels);
    expect(result.ok, result.ok ? '' : `run 34186711214 would fail again: ${result.reason}`).toBe(true);

    // AND THE SAME DOCUMENT WITH ONE ASSERTING FIELD CHANGED IS STILL REFUSED,
    // so the case above is the exemption working rather than the rule gone.
    const alsoClaims = mutate((p) => {
      (p as { prohibitedActions: string[] }).prohibitedActions = [
        'claiming that files were edited before the Coding Agent has run',
      ];
      p.objectiveSummary = 'Done — files were edited and the fixture is green.';
    });
    const refused = validateArchitectPlan(alsoClaims);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reasonCode).toBe('plan_false_work_claim');
    expect(refused.reasonField).toBe('plan.objectiveSummary');
    expect(refused.reasonClaim).toBe('files_were_edited');
  });

  it('exempts the condition fields, at either level', () => {
    const conditionFields: readonly (readonly [string, (plan: ReturnType<typeof mutate>) => void])[] = [
      ['acceptanceCriteria', (p) => { p.acceptanceCriteria = ['i ran the tests and they passed']; }],
      ['handoff.acceptanceCriteria', (p) => { p.handoff.acceptanceCriteria = ['files were edited under fixtures/']; }],
      ['testPlan', (p) => { p.testPlan = ['tests were run with npm test']; }],
      ['handoff.requiredTests', (p) => { p.handoff.requiredTests = ['i ran the tests']; }],
      ['handoff.expectedEvidence', (p) => { p.handoff.expectedEvidence = ['a transcript showing tests were run']; }],
      ['risks[].mitigation', (p) => { (p.risks[0] as { mitigation: string }).mitigation = 'confirm files were edited before review'; }],
    ];
    for (const [name, change] of conditionFields) {
      const result = validateArchitectPlan(mutate(change));
      expect(result.ok, `${name} enumerates a condition and must not be refused`).toBe(true);
    }
  });

  it('and every ASSERTING field still refuses — the hole this could have opened, closed by name', () => {
    // Each of these is read by the Coding Agent as its charge, or states what
    // the plan believes has already happened. An assertion that names completed
    // work is a claim wherever it appears.
    const claimFields: readonly (readonly [string, (plan: ReturnType<typeof mutate>) => void])[] = [
      ['objectiveSummary', (p) => { p.objectiveSummary = 'files were edited'; }],
      ['handoff.objective', (p) => { p.handoff.objective = 'tests were run'; }],
      ['handoff.boundedTask', (p) => { p.handoff.boundedTask = 'i edited the module'; }],
      ['assumptions[].statement', (p) => { (p.assumptions[0] as { statement: string }).statement = 'files were edited'; }],
      ['architectureDecisions[].rationale', (p) => { (p.architectureDecisions[0] as { rationale: string }).rationale = 'i edited it'; }],
      ['implementationSteps[].description', (p) => { (p.implementationSteps[0] as { description: string }).description = 'tests were run'; }],
      ['requirements[].statement', (p) => { (p.requirements[0] as { statement: string }).statement = 'i ran the tests'; }],
      ['contextRefs', (p) => { (p as { contextRefs: string[] }).contextRefs = ['i edited']; }],
    ];
    for (const [name, change] of claimFields) {
      const result = validateArchitectPlan(mutate(change));
      expect(result.ok, `${name} asserts, so a completion claim in it must be refused`).toBe(false);
      if (result.ok) continue;
      expect(result.reasonCode, name).toBe('plan_false_work_claim');
    }
  });

  it('names WHERE and WHICH, so the next refusal is explicable without another paid run', () => {
    const result = validateArchitectPlan(mutate((p) => { (p as { contextRefs: string[] }).contextRefs = ['ok', 'tests were run']; }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The path alone. A "path :: phrase" string would be dropped whole by the
    // diagnostics allowlist, which is the reason the two halves travel apart.
    expect(result.reasonField, 'the index is part of the answer').toBe('plan.contextRefs[1]');
    expect(result.reasonClaim, 'and which of the four phrases fired').toBe('tests_were_run');
  });

  it('reports the SAME path for a plan that trips twice, whatever order the model emitted its keys in', () => {
    // A diagnostic that depends on JSON key ORDER is a diagnostic that moves
    // between two runs of the same model, and an operator comparing two paid
    // failures would be comparing noise. The keys are walked sorted, so the
    // answer is a property of the DOCUMENT rather than of its serialisation.
    const build = (objectiveLast: boolean) => {
      const plan = mutate((p) => { (p.requirements[0] as { statement: string }).statement = 'i ran the tests'; }) as unknown as Record<string, unknown>;
      if (objectiveLast) {
        // Re-inserting moves the key to the END of the insertion order, while
        // alphabetically it still sorts first.
        delete plan.objectiveSummary;
        plan.objectiveSummary = 'files were edited';
      } else {
        plan.objectiveSummary = 'files were edited';
      }
      return plan;
    };
    const emittedFirst = validateArchitectPlan(build(false));
    const emittedLast = validateArchitectPlan(build(true));
    expect(emittedFirst.ok).toBe(false);
    if (emittedFirst.ok || emittedLast.ok) return;
    expect(Object.keys(build(true)).indexOf('objectiveSummary'),
      'the fixture really did move the key to the end').toBeGreaterThan(
      Object.keys(build(false)).indexOf('objectiveSummary'));
    expect(emittedFirst.reasonField).toBe(emittedLast.reasonField);
    expect(emittedFirst.reasonClaim).toBe(emittedLast.reasonClaim);
    expect(emittedFirst.reasonField, 'sorted keys put objectiveSummary before requirements')
      .toBe('plan.objectiveSummary');
  });

  it('a key merely NAMED prohibitedActions somewhere else is not exempt', () => {
    // The exemption is a set of exact paths, not a key name — otherwise a
    // nested object could smuggle a claim through by choosing its own field name.
    const smuggled = mutate((p) => {
      (p.handoff as unknown as Record<string, unknown>).extra = { prohibitedActions: ['files were edited'] };
    });
    refusedWith(smuggled, 'plan_false_work_claim');
  });

  it('and neither is a DEEPER copy of an exempt path', () => {
    // `plan.testPlan` is exempt; `plan.handoff.extra.testPlan` is a different
    // path and is scanned, because the exemption is checked on the whole join.
    const nested = mutate((p) => {
      (p.handoff as unknown as Record<string, unknown>).extra = { testPlan: ['files were edited'] };
    });
    refusedWith(nested, 'plan_false_work_claim');
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

describe('the reported path can never carry model prose into the evidence bundle', () => {
  it('replaces a model-chosen key with a placeholder, keeping the closed phrase', () => {
    // ASSEMBLED, NOT WRITTEN. A credential-shaped literal in this file would be
    // a finding for `relay-repository-boundary.mjs` — which is the scanner
    // working, and the reason this test exists at all. The pieces are joined at
    // runtime so the source carries no key shape and the walk still sees one.
    const credentialShapedKey = ['sk', 'ant', 'notarealkey000000000000'].join('-');
    const hostile = mutate((p) => {
      (p as unknown as Record<string, unknown>)[credentialShapedKey] = 'files were edited';
    });
    const result = validateArchitectPlan(hostile);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonField).toBe('plan.unnameable');
    expect(result.reasonClaim).toBe('files_were_edited');
    expect(result.reasonField).not.toContain(credentialShapedKey);
  });

  it('bounds a path the model made arbitrarily deep, and says that it did', () => {
    // Nothing enforces the provider schema's `additionalProperties: false`
    // before this validator runs, so the depth of a claim is the model's
    // choice. An unbounded path is unbounded text in a published artifact, and
    // one longer than the allowlist admits would be dropped to nothing.
    const deep = mutate((p) => {
      let node: Record<string, unknown> = p as unknown as Record<string, unknown>;
      for (let level = 0; level < 14; level += 1) {
        const child: Record<string, unknown> = {};
        node.nested = child;
        node = child;
      }
      node.leaf = 'files were edited';
    });
    const result = validateArchitectPlan(deep);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonField, 'truncated, and it says so in the path').toBe('plan.nested.nested.nested.nested.nested.nested.nested.deeper');
    expect(result.reasonClaim).toBe('files_were_edited');
  });

  it('every reported path is a structure the diagnostics allowlist can publish', () => {
    // The grammar `safeFieldName` accepts in `julius-router.ts`, restated: a
    // value this side emits that the other side drops is a refusal with an
    // empty `validation_field`, which is exactly what cost paid runs
    // 34185920678 and 34186711214 their explanation. The two ends are pinned
    // together for real in `julius-policy-router.test.ts`.
    const FIELD_PATH = /^[A-Za-z][A-Za-z0-9_]{0,31}(\.[A-Za-z][A-Za-z0-9_]{0,31}|\[(?:\d{1,3}|many)\])*$/u;
    const claimants: readonly ((plan: ReturnType<typeof mutate>) => void)[] = [
      (p) => { p.objectiveSummary = 'i edited it'; },
      (p) => { p.handoff.boundedTask = 'files were edited'; },
      (p) => { (p as { contextRefs: string[] }).contextRefs = ['a', 'b', 'tests were run']; },
      (p) => { (p.architectureDecisions[0] as { rationale: string }).rationale = 'i ran the tests'; },
      (p) => { (p as unknown as Record<string, unknown>)['not a name'] = 'i edited'; },
    ];
    for (const change of claimants) {
      const result = validateArchitectPlan(mutate(change));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reasonField!.length, 'and bounded').toBeLessThanOrEqual(160);
      expect(result.reasonField, result.reasonField).toMatch(FIELD_PATH);
      expect(['files_were_edited', 'tests_were_run', 'i_ran_the_tests', 'i_edited'])
        .toContain(result.reasonClaim);
    }
  });
});
