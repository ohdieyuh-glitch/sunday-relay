import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildArchitectContext } from './mission/prompt-architect/prompt-architect-context.ts';
import { validateArchitectPlan, planNeedsInput } from './mission/prompt-architect/prompt-architect-plan.ts';

/**
 * TWO LATENT DEFECTS IN RELAY'S PROMPT ARCHITECT MODULES — THE SPECIFICATION.
 *
 * Each module is real Relay code with a documented intent and a behaviour that does not match it. The tests pin the main behaviours of each fix; the acceptance
 * criteria in the contract state the wider invariants in words.
 *
 *   A. `buildArchitectContext` (prompt-architect/prompt-architect-context.ts). The interface says "Required blocks are never dropped; the build fails instead."
 *      The de-duplication keeps the FIRST block seen for an id or for identical content, whether or not it is required, so an optional block that comes
 *      first evicts a required one that duplicates it, and the optional survivor can then be dropped for budget while the build still reports success.
 *   B. `validateArchitectPlan` (prompt-architect/prompt-architect-plan.ts). The header says a malformed structure "is REJECTED. It never becomes a partial
 *      plan". Elements of `architectureDecisions` and `assumptions` are checked, but the elements of `unresolvedQuestions`, `requirements`,
 *      `implementationSteps` and `risks` are not: a null element throws a TypeError out of the validator, and a string element is accepted as a blank entry
 *      (a blocking question sent as a string becomes a non-blocking one).
 */

const block = (id: string, text: string, required: boolean, kind = 'constraint') => ({ id, kind, text, required }) as never;
type BuildOk = { ok: true; blocks: { id: string; text: string; required: boolean }[]; refs: string[]; totalChars: number; droppedOptional: string[] };
const build = (blocks: unknown[], maxChars: number) => buildArchitectContext(blocks as never, { maxChars }) as unknown as BuildOk | { ok: false; reason: string };

/* -------------------------------------------------------------------------------------------------- A: required blocks survive de-duplication */

test('A: control: duplicates of the same kind are still removed, the first of equal standing wins, and the budget still bounds optional blocks', () => {
  const r = build([block('a', 'same text', false), block('b', 'same text', false), block('c', 'other', false)], 1000) as BuildOk;
  assert.deepEqual(r.refs, ['a', 'c']);
  const two = build([block('r1', 'first required', true), block('r2', 'first required', true)], 1000) as BuildOk;
  assert.deepEqual(two.refs, ['r1']);
  const tight = build([block('r', 'required!', true), block('o', 'optional text', false)], 12) as BuildOk;
  assert.deepEqual(tight.refs, ['r']);
  assert.deepEqual(tight.droppedOptional, ['o']);
});

test('A: an optional block that comes first does not evict a required block with the same content', () => {
  const r = build([block('note-7', 'the contract constraint', false), block('contract-1', 'the contract constraint', true)], 23) as BuildOk;
  assert.equal(r.ok, true);
  assert.equal(r.blocks.some((b) => b.required && b.text === 'the contract constraint'), true, 'the required block is in the context');
  assert.equal(r.blocks.length, 1, 'still de-duplicated: one copy of that text');
  assert.deepEqual(r.droppedOptional, []);
});

test('A: an optional block that comes first does not evict a required block with the same id', () => {
  const r = build([block('c1', 'optional wording', false), block('c1', 'REQUIRED WORDING', true, 'mission_contract')], 1000) as BuildOk;
  assert.equal(r.ok, true);
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].required, true);
  assert.equal(r.blocks[0].text, 'REQUIRED WORDING', 'the kept copy is the required one, with its own text');
});

test('A: when the required block is evicted-by-duplicate in the old code, the new code fails honestly if it cannot fit', () => {
  const r = build([block('note', 'twenty characters!!', false), block('req', 'twenty characters!!', true)], 10);
  assert.equal(r.ok, false, 'required content that does not fit blocks the build');
});

test('A: order of the surviving blocks is unchanged: required first, then optional blocks in their input order', () => {
  const r = build([block('o1', 'one', false), block('r1', 'two', true), block('o2', 'three', false), block('r2', 'four', true)], 1000) as BuildOk;
  assert.deepEqual(r.refs, ['r1', 'r2', 'o1', 'o2']);
});

/* ----------------------------------------------------------------------------------------------------------- B: every plan array element is checked */

const validPlan = (over: Record<string, unknown> = {}) => ({
  objectiveSummary: 'Add a retry limit to the queue worker',
  assumptions: [{ id: 'A1', statement: 'The queue is single consumer', confidence: 'high' }],
  unresolvedQuestions: [{ id: 'Q1', question: 'Which backoff?', blocksImplementation: true }],
  requirements: [{ id: 'R1', statement: 'Retries are bounded', rationale: 'avoid loops' }],
  architectureDecisions: [{ id: 'D1', decision: 'Use a counter', rationale: 'simple', alternativesConsidered: [], accepted: false }],
  implementationSteps: [{ order: 1, description: 'Add the counter', filesTouched: ['src/queue.ts'] }],
  acceptanceCriteria: ['Retries stop at the limit'],
  testPlan: ['Unit test the counter'],
  risks: [{ id: 'RISK1', risk: 'Off by one', mitigation: 'Boundary test', severity: 'low' }],
  prohibitedActions: ['Do not change the schema'],
  handoff: {
    objective: 'Bound retries', boundedTask: 'Add a counter', acceptanceCriteria: ['limit holds'], requiredTests: ['unit'], allowedFileScope: ['src/queue.ts'],
    prohibitedActions: ['no schema change'], grantedTools: ['Read'], missionContractRef: 'mc-1', environmentRef: null, expectedEvidence: ['test output'],
  },
  proposedContractAmendments: [], contextRefs: ['mc-1'],
  ...over,
});
const validate = (over: Record<string, unknown>) => validateArchitectPlan(validPlan(over)) as { ok: boolean; reasonCode?: string; reasonField?: string; plan?: { unresolvedQuestions: { blocksImplementation: boolean }[] } };

test('B: control: a well-formed plan is accepted and its blocking question still blocks', () => {
  const r = validate({});
  assert.equal(r.ok, true);
  assert.equal(planNeedsInput(r.plan as never), true);
});

test('B: a non-object element of unresolvedQuestions, requirements, implementationSteps or risks is rejected, and the validator never throws', () => {
  for (const key of ['unresolvedQuestions', 'requirements', 'implementationSteps', 'risks']) {
    for (const bad of [null, 'Which auth provider?', 7, true]) {
      let r: { ok: boolean; reasonCode?: string; reasonField?: string } | undefined;
      assert.doesNotThrow(() => { r = validate({ [key]: [bad] }); }, `${key} with ${JSON.stringify(bad)}`);
      assert.equal(r?.ok, false, `${key} with ${JSON.stringify(bad)}`);
      assert.equal(r?.reasonCode, 'required_array_invalid');
      assert.equal(r?.reasonField, key);
    }
  }
});

test('B: one bad element among good ones is enough, wherever it sits', () => {
  const good = { id: 'Q1', question: 'Which backoff?', blocksImplementation: true };
  assert.equal(validate({ unresolvedQuestions: [good, good, null] }).ok, false);
  assert.equal(validate({ unresolvedQuestions: [null, good] }).ok, false);
});

test('B: the existing checks are unchanged: decisions, assumptions, empty arrays and objects with missing fields', () => {
  assert.equal(validate({ architectureDecisions: [null] }).reasonCode, 'decision_object_invalid');
  assert.equal(validate({ assumptions: ['text'] }).reasonCode, 'assumption_statement_empty');
  assert.equal(validate({ unresolvedQuestions: [], requirements: [], implementationSteps: [], risks: [] }).ok, true);
  assert.equal(validate({ unresolvedQuestions: [{ blocksImplementation: true }] }).ok, true, 'an object with a missing text field is still normalized as before');
  assert.equal(validate({ risks: 'not an array' }).reasonCode, 'required_array_invalid');
});
