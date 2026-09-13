import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as learning from './julius-learning-loop';
import { JuliusRunLoop } from './julius-run-loop';
import { createJuliusHarness, seedRun, task, verificationPolicy, worker, cardPolicy } from './julius-runtime-fixtures';
import type { JuliusRecordedDecision, JuliusTask } from './julius-runtime';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/**
 * MISSION 6 — THE LEARNING LOOP. THE SPECIFICATION.
 *
 * Every case either calls `julius-learning-loop.ts` directly or drives the real
 * Julius kernel through its in-memory harness: the real scheduler, claim,
 * context compiler, verification evaluator, repair planner and Project Brain
 * writer, with scripted provider adapters in place of paid ones. What the brief
 * `LEARNING_LOOP_BRIEF.md` asks for is what these cases check.
 *
 * The module's functions are reached through its namespace so that each case
 * fails on its own, with its own message, while the module is still a stub.
 */

const fn = <K extends keyof typeof learning>(name: K): (typeof learning)[K] => {
  const value = learning[name];
  if (value === undefined) throw new Error(`julius-learning-loop exports no ${String(name)}`);
  return value;
};

/* ------------------------------------------------------------ fixtures */

const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter',
  capabilities: ['review'], taskTypes: ['review:build', 'review:repair:build'],
});
const scope = { projectId: 'prj-1' };
const capabilityFor = (item: { role: string }) => (item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const BUILT = { kind: 'succeed' as const, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] };
const ACCEPTS = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] };
const REJECTS = (claim: string) => ({ kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: claim }] });

const UNTESTED = '[blocking] The error branch of parseRow is untested.';
const SWALLOWED = '[blocking] parseRow swallows the decoder error instead of returning it.';
const UNTESTED_AGAIN = '[BLOCKING]   the error branch of parseRow is UNTESTED';

const R1 = 'repair:build-1:1:task';
const R2 = 'repair:repair:build-1:1:task:2:task';

/**
 * Two builds in one run, the second released by the first's acceptance, with an
 * independent review required on every piece of coding work.
 */
function twoBuilds(input: { reviewer: readonly ReturnType<typeof REJECTS>[]; maxRepairRounds?: number; contextCharacterBudget?: number }) {
  const harness = createJuliusHarness({
    workers: [
      { worker: CODER, script: [BUILT] },
      { worker: REVIEWER, script: input.reviewer },
    ],
    card: cardPolicy({ allowedProviders: ['anthropic', 'hermes'], capabilities: ['implement', 'review'], concurrency: 1 }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: input.maxRepairRounds ?? 3 }),
    capabilityFor,
    budgetUsdMicros: 100_000_000,
  });
  seedRun(harness, {
    tasks: [
      task({ taskId: 'build-1', ordinal: 0, requiredEvidenceTypes: ['TEST'] }),
      task({ taskId: 'build-2', ordinal: 1, state: 'BLOCKED', dependencyIds: ['build-1'], requiredEvidenceTypes: ['TEST'] }),
    ],
  });
  harness.store.seedBrain('run-1', [{
    entryId: 'brain-objective', kind: 'OBJECTIVE', text: 'Parse the ledger export without losing a row.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
  return harness;
}

async function drain(loop: JuliusRunLoop, ticks = 40): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    const report = await loop.tick(scope);
    if (report.claimed > 0) continue;
    const advance = await loop.advanceRun('run-1', 'prj-1');
    // Quiescent: nothing claimed and nothing left to advance.
    if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
  }
}

type Harness = ReturnType<typeof twoBuilds>;
const findingsOf = (harness: Harness) => harness.store.findingsForRun('run-1', 'prj-1');
const brainOf = (harness: Harness) => harness.store.brainEntriesForRun('run-1', 'prj-1');
const eventsOf = (harness: Harness, type: string) => harness.store.events().filter((event) => event.type === type);
const byClaim = (findings: readonly JuliusReviewerFinding[], claim: string) => {
  const found = findings.find((finding) => finding.claim === claim);
  assert.ok(found, `a finding with claim ${JSON.stringify(claim)} was recorded`);
  return found;
};

/** Build one: rejected, repaired, rejected again, repaired again, accepted. Build two: rejected with a repeat, repaired, accepted. */
const FULL = [REJECTS(UNTESTED), REJECTS(SWALLOWED), ACCEPTS, REJECTS(UNTESTED_AGAIN), ACCEPTS];

/* ------------------------------------------------- the recurrence key */

test('a recurrence key ignores case, whitespace, a leading tag and trailing punctuation', () => {
  const key = fn('juliusFindingRecurrenceKey');
  assert.equal(key({ stage: 'build', claim: UNTESTED }), key({ stage: 'build', claim: UNTESTED_AGAIN }));
  assert.equal(key({ stage: 'build', claim: 'The branch is untested.' }), key({ stage: 'build', claim: '  the   BRANCH is untested ' }));
});

test('a recurrence key never equates different words, however similar they mean', () => {
  const key = fn('juliusFindingRecurrenceKey');
  assert.notEqual(key({ stage: 'build', claim: 'The error branch is untested.' }), key({ stage: 'build', claim: 'No test covers the error branch.' }));
  assert.notEqual(key({ stage: 'build', claim: 'parseRow swallows the error.' }), key({ stage: 'build', claim: 'parseRow ignores the error.' }));
});

test('a recurrence key carries the base stage: repairs fold to their stage, and a plan is not a build', () => {
  const key = fn('juliusFindingRecurrenceKey');
  assert.equal(key({ stage: 'repair:repair:build', claim: 'X is untested.' }), key({ stage: 'build', claim: 'X is untested.' }));
  assert.notEqual(key({ stage: 'plan', claim: 'X is untested.' }), key({ stage: 'build', claim: 'X is untested.' }));
});

/* ------------------------------------------------------------- lineage */

const T = (over: Partial<JuliusTask> & { taskId: string }): JuliusTask => ({
  missionId: 'msn-1', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: ['TEST'],
  taskType: 'build', role: 'CODING_AGENT', ordinal: 0, state: 'SUCCEEDED', ...over,
});
const F = (over: Partial<JuliusReviewerFinding> & { findingId: string; taskId: string }): JuliusReviewerFinding => ({
  runId: 'run-1', reviewerWorkerId: 'reviewer', severity: 'HIGH', category: 'review', claim: 'x',
  criterionId: null, evidenceIds: ['e'], blocking: true, status: 'OPEN', createdAt: '2026-09-13T00:00:00.000Z', ...over,
});
const LINEAGE: readonly JuliusTask[] = [
  T({ taskId: 'build-1' }),
  T({ taskId: R1, parentTaskId: 'build-1', taskType: 'repair:build' }),
  T({ taskId: R2, parentTaskId: R1, taskType: 'repair:build', state: 'ACTIVE' }),
  T({ taskId: `${R2}:review`, parentTaskId: R2, taskType: 'review:repair:build', role: 'INDEPENDENT_REVIEWER', state: 'RUNNABLE' }),
  T({ taskId: 'build-2', ordinal: 1, dependencyIds: ['build-1'], state: 'BLOCKED' }),
];

test('a second repair round sees every OPEN blocking finding of its lineage, root first — not only its parent’s', () => {
  const findings = [
    F({ findingId: 'f-r1', taskId: R1, claim: 'second', createdAt: '2026-09-13T00:02:00.000Z' }),
    F({ findingId: 'f-root', taskId: 'build-1', claim: 'first', createdAt: '2026-09-13T00:01:00.000Z' }),
    F({ findingId: 'f-info', taskId: 'build-1', blocking: false }),
    F({ findingId: 'f-done', taskId: 'build-1', status: 'RESOLVED' }),
    F({ findingId: 'f-other', taskId: 'build-2' }),
  ];
  const lineage = fn('juliusLineageFindings');
  const r2 = LINEAGE.find((value) => value.taskId === R2)!;
  assert.deepEqual(lineage(r2, LINEAGE, findings).map((value) => value.findingId), ['f-root', 'f-r1']);
  const review = LINEAGE.find((value) => value.taskId === `${R2}:review`)!;
  assert.deepEqual(lineage(review, LINEAGE, findings).map((value) => value.findingId), ['f-root', 'f-r1'], 'and so does its re-review');
  assert.deepEqual(lineage(LINEAGE.find((value) => value.taskId === R1)!, LINEAGE, findings).map((value) => value.findingId), ['f-root']);
  assert.deepEqual(lineage(LINEAGE[0]!, LINEAGE, findings), [], 'a task that is not a repair addresses no lineage');
});

test('a lineage is the repair planner’s lineage: an impostor child addresses nothing', () => {
  const impostor = T({ taskId: 'repair:build-1:x:task', parentTaskId: 'build-1', taskType: 'repair:build' });
  const lineage = fn('juliusLineageFindings');
  assert.deepEqual(lineage(impostor, [...LINEAGE, impostor], [F({ findingId: 'f-root', taskId: 'build-1' })]), []);
});

/* ---------------------------------------------------------- resolution */

const decided = (taskId: string, action: JuliusRecordedDecision['action']): JuliusRecordedDecision =>
  ({ taskId, action, reasonCode: action === 'ACCEPT' ? 'TASK_VERIFIED' : 'BLOCKING_FINDINGS', evidenceIds: [], safeSummary: 'x' });

test('an accepted lineage resolves every OPEN blocking finding in it, attributed to the repair that was accepted', () => {
  const tasks = LINEAGE.map((value) => (value.taskId === R2 ? { ...value, state: 'SUCCEEDED' as const } : value));
  const findings = [
    F({ findingId: 'f-root', taskId: 'build-1' }), F({ findingId: 'f-r1', taskId: R1, createdAt: '2026-09-13T00:05:00.000Z' }),
    F({ findingId: 'f-info', taskId: 'build-1', blocking: false }), F({ findingId: 'f-done', taskId: R1, status: 'RESOLVED' }),
  ];
  const resolvable = fn('juliusResolvableFindings')({
    tasks, findings, decisions: [decided('build-1', 'REPAIR'), decided(R1, 'REPAIR'), decided(R2, 'ACCEPT')],
  });
  assert.deepEqual(resolvable.map((value) => [value.finding.findingId, value.resolvedByTaskId, value.stage]), [
    ['f-root', R2, 'build'], ['f-r1', R2, 'build'],
  ]);
});

test('a lineage nobody accepted resolves nothing: a REPAIR still waiting, and a HALT', () => {
  const findings = [F({ findingId: 'f-root', taskId: 'build-1' }), F({ findingId: 'f-r1', taskId: R1 })];
  const resolvable = fn('juliusResolvableFindings');
  assert.deepEqual(resolvable({ tasks: LINEAGE, findings, decisions: [decided('build-1', 'REPAIR'), decided(R1, 'REPAIR')] }), []);
  assert.deepEqual(resolvable({ tasks: LINEAGE, findings, decisions: [decided('build-1', 'REPAIR'), decided(R1, 'HALT')] }), []);
});

/* -------------------------------------------------------------- entries */

test('a lesson is one run-level REPAIR entry that names its stage, finding, resolving repair and claim', () => {
  const finding = F({ findingId: 'finding:e-7', taskId: 'build-1', claim: UNTESTED, evidenceIds: ['e-7'] });
  const lesson = fn('juliusLessonAppend')({
    runId: 'run-1', projectId: 'prj-1', workerId: 'reviewer', occurredAt: '2026-09-13T01:00:00.000Z',
    resolution: { finding, resolvedByTaskId: R2, stage: 'build' },
  });
  assert.equal(lesson.entryId, 'brain:lesson:finding:e-7');
  assert.equal(lesson.kind, 'REPAIR');
  assert.equal(lesson.taskId, null);
  assert.deepEqual(lesson.evidenceIds, ['e-7']);
  for (const part of ['finding:e-7', R2, 'build', 'The error branch of parseRow is untested']) assert.ok(lesson.safeText.includes(part), part);
});

test('a lesson quotes a long claim only to the stated bound', () => {
  const finding = F({ findingId: 'finding:e-8', taskId: 'build-1', claim: `${'word '.repeat(300)}END` });
  const lesson = fn('juliusLessonAppend')({
    runId: 'run-1', projectId: 'prj-1', workerId: 'reviewer', occurredAt: '2026-09-13T01:00:00.000Z',
    resolution: { finding, resolvedByTaskId: R1, stage: 'build' },
  });
  assert.equal(lesson.safeText.includes('END'), false);
  assert.ok(lesson.safeText.length <= learning.JULIUS_LESSON_CLAIM_MAX_CHARACTERS + 300, `${lesson.safeText.length} characters`);
});

test('a repeat is recognised only against a RESOLVED finding of another lineage, and the earliest wins', () => {
  const tasks = [...LINEAGE.map((value) => ({ ...value, state: 'SUCCEEDED' as const })), T({ taskId: 'build-3', ordinal: 2 })];
  const repeat = F({ findingId: 'f-new', taskId: 'build-2', claim: UNTESTED_AGAIN, createdAt: '2026-09-13T02:00:00.000Z' });
  const recurrence = fn('juliusRecurrenceOf');
  const resolvedEarly = F({ findingId: 'f-early', taskId: 'build-1', claim: UNTESTED, status: 'RESOLVED', createdAt: '2026-09-13T00:01:00.000Z' });
  const resolvedLate = F({ findingId: 'f-late', taskId: 'build-3', claim: UNTESTED, status: 'RESOLVED', createdAt: '2026-09-13T01:00:00.000Z' });
  assert.equal(recurrence({ finding: repeat, tasks, findings: [resolvedLate, resolvedEarly, repeat] })?.findingId, 'f-early');
  assert.equal(recurrence({ finding: repeat, tasks, findings: [F({ ...resolvedEarly, status: 'OPEN' }), repeat] }), null, 'an unresolved finding taught nothing');
  const sameLineage = F({ findingId: 'f-same', taskId: R1, claim: UNTESTED_AGAIN });
  assert.equal(recurrence({ finding: sameLineage, tasks, findings: [resolvedEarly, sameLineage] }), null, 'a lineage still being repaired is not a lesson failing');
  assert.equal(recurrence({ finding: F({ ...repeat, claim: 'No test covers the error branch of parseRow.' }), tasks, findings: [resolvedEarly] }), null);
});

test('a lesson that did not hold is recorded as its own run-level entry', () => {
  const finding = F({ findingId: 'f-new', taskId: 'build-2', claim: UNTESTED_AGAIN, evidenceIds: ['e-9'] });
  const entry = fn('juliusLessonNotHeldAppend')({
    runId: 'run-1', projectId: 'prj-1', workerId: 'reviewer', occurredAt: '2026-09-13T02:00:00.000Z',
    finding, recurrenceOf: F({ findingId: 'f-early', taskId: 'build-1', claim: UNTESTED, status: 'RESOLVED' }),
  });
  assert.equal(entry.entryId, 'brain:lesson-not-held:f-new');
  assert.equal(entry.kind, 'REPAIR');
  assert.equal(entry.taskId, null);
  for (const part of ['f-new', 'f-early', 'build-2']) assert.ok(entry.safeText.includes(part), part);
});

test('delivery counts learning entries only, split by what the packet admitted', () => {
  const delivery = fn('juliusLessonDelivery')({
    brain: [{ entryId: 'brain-objective' }, { entryId: 'brain:lesson:a' }, { entryId: 'brain:decision:x' }, { entryId: 'brain:lesson-not-held:b' }, { entryId: 'brain:lesson:c' }],
    sourceEntryIds: ['brain-objective', 'brain:lesson:a', 'brain:decision:x'],
  });
  assert.deepEqual(delivery, { delivered: ['brain:lesson:a'], withheld: ['brain:lesson-not-held:b', 'brain:lesson:c'] });
});

/* ------------------------------------------------ the loop, through the kernel */

test('THE KERNEL: round two of a repair is compiled with round one’s finding as well as its own subject’s', async () => {
  const harness = twoBuilds({ reviewer: FULL });
  await drain(harness.loop);
  const r2 = harness.store.contexts().filter((snapshot) => snapshot.taskId === R2);
  assert.equal(r2.length, 1, 'round two was dispatched once');
  const text = r2[0]!.packet.blocks.map((block) => block.text).join('\n');
  assert.ok(text.includes('The error branch of parseRow is untested'), 'the finding round one was repairing');
  assert.ok(text.includes('parseRow swallows the decoder error'), 'the finding on round one itself');
  const review = harness.store.contexts().find((snapshot) => snapshot.taskId === `${R2}:review`);
  assert.ok(review?.packet.blocks.map((block) => block.text).join('\n').includes('The error branch of parseRow is untested'), 'and its re-review judges both');
});

test('THE KERNEL: accepting the lineage resolves both findings, attributed to round two, and leaves one lesson each', async () => {
  const harness = twoBuilds({ reviewer: FULL });
  await drain(harness.loop);
  const findings = await findingsOf(harness);
  const untested = byClaim(findings, UNTESTED);
  const swallowed = byClaim(findings, SWALLOWED);
  assert.equal(untested.status, 'RESOLVED');
  assert.equal(swallowed.status, 'RESOLVED');
  const resolved = eventsOf(harness, 'finding.resolved');
  for (const finding of [untested, swallowed]) {
    const rows = resolved.filter((event) => event.facts.findingId === finding.findingId);
    assert.equal(rows.length, 1, `${finding.findingId} resolved exactly once`);
    assert.equal(rows[0]!.facts.resolvedByTaskId, R2);
  }
  const brain = await brainOf(harness);
  for (const finding of [untested, swallowed]) {
    assert.equal(brain.filter((entry) => entry.entryId === `brain:lesson:${finding.findingId}`).length, 1, `one lesson for ${finding.findingId}`);
    assert.equal(eventsOf(harness, 'lesson.recorded').filter((event) => event.facts.findingId === finding.findingId).length, 1);
  }
});

test('THE KERNEL: the next build is compiled with both lessons, and its context record says it was handed them', async () => {
  const harness = twoBuilds({ reviewer: FULL });
  await drain(harness.loop);
  const findings = await findingsOf(harness);
  const lessons = [byClaim(findings, UNTESTED), byClaim(findings, SWALLOWED)].map((finding) => `brain:lesson:${finding.findingId}`);
  const build2 = harness.store.contexts().find((snapshot) => snapshot.taskId === 'build-2');
  assert.ok(build2, 'build-2 was dispatched');
  for (const lesson of lessons) assert.ok(build2.sourceEntryIds.includes(lesson), `build-2 was handed ${lesson}`);
  const compiled = eventsOf(harness, 'context.compiled').find((event) => event.taskId === 'build-2');
  assert.equal(compiled?.facts.lessonsDelivered, 2);
  assert.equal(compiled?.facts.lessonsWithheld, 0);
});

test('THE KERNEL: a later review that repeats a resolved finding is recorded as the lesson not holding', async () => {
  const harness = twoBuilds({ reviewer: FULL });
  await drain(harness.loop);
  const findings = await findingsOf(harness);
  const original = byClaim(findings, UNTESTED);
  const repeat = byClaim(findings, UNTESTED_AGAIN);
  assert.equal(repeat.taskId, 'build-2');
  const recurred = eventsOf(harness, 'lesson.recurred');
  assert.equal(recurred.length, 1);
  assert.equal(recurred[0]!.facts.findingId, repeat.findingId);
  assert.equal(recurred[0]!.facts.recurrenceOf, original.findingId);
  const brain = await brainOf(harness);
  assert.equal(brain.filter((entry) => entry.entryId === `brain:lesson-not-held:${repeat.findingId}`).length, 1);
  // The repeat is still an ordinary blocking finding: it was repaired, the repair was accepted, and it too became a lesson.
  assert.equal(repeat.status, 'RESOLVED');
  assert.equal(brain.filter((entry) => entry.entryId === `brain:lesson:${repeat.findingId}`).length, 1);
  assert.equal((await harness.store.loadRun('run-1', 'prj-1'))?.state, 'COMPLETED');
});

test('THE KERNEL: a lineage that halts at its repair bound resolves nothing and teaches nothing', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(UNTESTED), REJECTS(SWALLOWED), REJECTS(SWALLOWED)], maxRepairRounds: 1 });
  await drain(harness.loop);
  const findings = await findingsOf(harness);
  assert.ok(findings.length > 0, 'the review did find something');
  assert.ok(findings.every((finding) => finding.status === 'OPEN'), 'nothing was resolved');
  assert.equal(eventsOf(harness, 'finding.resolved').length, 0);
  assert.equal((await brainOf(harness)).filter((entry) => entry.entryId.startsWith('brain:lesson')).length, 0);
});

test('THE KERNEL: a store that cannot resolve findings is REPORTED as unable to learn, and the run still completes', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(UNTESTED), ACCEPTS, ACCEPTS] });
  const { resolveFindings: _absent, ...withoutResolution } = harness.store as typeof harness.store & { resolveFindings?: unknown };
  const loop = new JuliusRunLoop({ ...harness.deps, store: withoutResolution as typeof harness.store }, harness.policies, { claimLimit: 10, leaseMs: 60_000 });
  await drain(loop);
  const unavailable = eventsOf(harness, 'learning.unavailable');
  assert.equal(unavailable.length, 1, 'said once, for the lineage whose acceptance would have resolved something — not again when an unrelated build is accepted');
  assert.equal(unavailable[0]!.facts.reason, 'STORE_CANNOT_RESOLVE_FINDINGS');
  assert.equal(unavailable[0]!.facts.resolvable, 1);
  assert.ok((await findingsOf(harness)).every((finding) => finding.status === 'OPEN'));
  assert.equal((await brainOf(harness)).filter((entry) => entry.entryId.startsWith('brain:lesson')).length, 0);
  assert.equal((await harness.store.loadRun('run-1', 'prj-1'))?.state, 'COMPLETED');
});

test('THE KERNEL: a lesson the character budget cannot fit is counted as withheld, and the dispatch still runs', async () => {
  const harness = twoBuilds({ reviewer: FULL });
  // Build one's lineage with room to learn...
  for (let index = 0; index < 40 && harness.store.taskRow('build-2')!.state === 'BLOCKED'; index += 1) {
    const report = await harness.loop.tick(scope);
    if (report.claimed === 0) await harness.loop.advanceRun('run-1', 'prj-1');
  }
  assert.equal(harness.store.taskRow('build-2')!.state, 'RUNNABLE', 'build-1 was accepted and released build-2');
  // ...then the next dispatch under a budget that holds the objective and nothing after it.
  const tight = new JuliusRunLoop({ ...harness.deps, contextCharacterBudget: 60 }, harness.policies, { claimLimit: 10, leaseMs: 60_000 });
  await tight.tick(scope);
  const compiled = eventsOf(harness, 'context.compiled').find((event) => event.taskId === 'build-2');
  assert.ok(compiled, 'build-2 was compiled and dispatched');
  assert.equal(compiled.facts.lessonsDelivered, 0);
  assert.equal(compiled.facts.lessonsWithheld, 2);
  assert.ok(harness.adapters.get('coder-adapter')!.dispatches.some((dispatch) => dispatch.taskId === 'build-2'));
});

test('THE KERNEL: learning never rewrites itself — every learning row is written once, and the brain revision counts them exactly', async () => {
  const harness = twoBuilds({ reviewer: FULL });
  await drain(harness.loop);
  // Drain again: every task is terminal, so nothing may be learned twice.
  await drain(harness.loop);
  const brain = await brainOf(harness);
  const ids = brain.map((entry) => entry.entryId);
  assert.equal(new Set(ids).size, ids.length, 'no entry id twice');
  const learningRows = ids.filter((id) => id.startsWith('brain:lesson'));
  assert.equal(learningRows.length, 4, 'three lessons and one lesson that did not hold');
  const run = await harness.store.loadRun('run-1', 'prj-1');
  assert.equal(run?.projectBrainRevision, brain.length, 'one revision per entry, the seeded objective included');
  const resolvedIds = eventsOf(harness, 'finding.resolved').map((event) => event.facts.findingId);
  assert.equal(new Set(resolvedIds).size, resolvedIds.length);
});
