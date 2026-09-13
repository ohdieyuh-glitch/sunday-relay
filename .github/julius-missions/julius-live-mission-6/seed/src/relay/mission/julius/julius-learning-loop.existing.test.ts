import { test } from 'node:test';
import assert from 'node:assert/strict';

import { JULIUS_OPERATIONAL_EVENT_TYPES } from './julius-events';
import { JuliusRunLoop } from './julius-run-loop';
import { createJuliusHarness, seedRun, task, verificationPolicy, worker, cardPolicy } from './julius-runtime-fixtures';

/**
 * WHAT MUST NOT CHANGE — THE KERNEL'S REVIEW, REPAIR AND MEMORY BEHAVIOUR AS IT
 * IS TODAY.
 *
 * Green before the mission starts and green when it ends. Each case is a
 * guarantee a paid run already depends on: a repair is told why it exists and
 * refuses to run blind, a decision is kept once, a replay changes nothing, a
 * repair lineage is bounded, a secret never reaches a packet, a dependent is
 * released exactly once, and nothing already recorded is renamed.
 */

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
const R1 = 'repair:build-1:1:task';

function twoBuilds(input: { reviewer: readonly ReturnType<typeof REJECTS>[]; maxRepairRounds?: number; secret?: boolean }) {
  const harness = createJuliusHarness({
    workers: [{ worker: CODER, script: [BUILT] }, { worker: REVIEWER, script: input.reviewer }],
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
  harness.store.seedBrain('run-1', [
    { entryId: 'brain-objective', kind: 'OBJECTIVE', text: 'Parse the ledger export without losing a row.', taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL' },
    ...(input.secret === true
      ? [{ entryId: 'brain-secret', kind: 'CONSTRAINT' as const, text: 'deploy credential is hunter2-never-shown', taskIds: [], allowedRoles: ['CODING_AGENT' as const, 'INDEPENDENT_REVIEWER' as const], sensitivity: 'SECRET' as const }]
      : []),
  ]);
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
const eventsOf = (harness: Harness, type: string) => harness.store.events().filter((event) => event.type === type);

test('a failed review becomes one blocking finding on the reviewed task, and a repair round is scheduled for it', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(UNTESTED), ACCEPTS, ACCEPTS] });
  await drain(harness.loop);
  const findings = await harness.store.findingsForRun('run-1', 'prj-1');
  const recorded = findings.filter((finding) => finding.claim === UNTESTED);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.taskId, 'build-1');
  assert.equal(recorded[0]!.blocking, true);
  assert.ok(harness.store.taskRow(R1), 'the repair round exists');
  assert.equal(eventsOf(harness, 'repair.scheduled').length, 1);
});

test('a first repair round is compiled with its subject’s finding, records the finding ids it was shown, and its re-review sees them too', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(UNTESTED), ACCEPTS, ACCEPTS] });
  await drain(harness.loop);
  const repair = harness.store.contexts().find((snapshot) => snapshot.taskId === R1);
  assert.ok(repair, 'the repair was compiled');
  assert.ok(repair.packet.blocks.some((block) => block.kind === 'FINDING' && block.text.includes('The error branch of parseRow is untested')));
  assert.ok(repair.findingIds.length > 0);
  const review = harness.store.contexts().find((snapshot) => snapshot.taskId === `${R1}:review`);
  assert.ok(review?.packet.blocks.some((block) => block.kind === 'FINDING'), 'the re-review judges the same finding');
});

test('work that is not a repair is never compiled with FINDING entries', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(UNTESTED), ACCEPTS, ACCEPTS] });
  await drain(harness.loop);
  for (const taskId of ['build-1', 'build-2']) {
    const snapshot = harness.store.contexts().find((value) => value.taskId === taskId);
    assert.ok(snapshot, `${taskId} was compiled`);
    assert.equal(snapshot.packet.blocks.some((block) => block.kind === 'FINDING'), false, `${taskId} has no FINDING block`);
  }
});

test('a repair whose findings cannot fit its character budget refuses to run blind', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(`${UNTESTED} ${'The fixture rows are not enough to show it. '.repeat(3)}`), ACCEPTS, ACCEPTS] });
  // Room for the objective and the build, and not for the objective plus the finding.
  const tight = new JuliusRunLoop({ ...harness.deps, contextCharacterBudget: 120 }, harness.policies, { claimLimit: 10, leaseMs: 60_000 });
  await drain(tight);
  const refused = eventsOf(harness, 'task.failed').filter((event) => event.facts.failureClass === 'repair_context_findings_dropped');
  assert.ok(refused.length > 0, 'the repair refused rather than running without its finding');
  assert.equal(harness.adapters.get('coder-adapter')!.dispatches.some((dispatch) => dispatch.taskId === R1), false, 'no provider was reached for it');
});

test('every verification decision is kept once in Project Brain under its deterministic id', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(UNTESTED), ACCEPTS, ACCEPTS] });
  await drain(harness.loop);
  await drain(harness.loop);
  const brain = await harness.store.brainEntriesForRun('run-1', 'prj-1');
  assert.equal(brain[0]!.entryId, 'brain-objective', 'the seed stays first');
  const decisions = brain.filter((entry) => entry.kind === 'DECISION');
  assert.ok(decisions.some((entry) => entry.entryId === 'brain:decision:build-1:REPAIR:BLOCKING_FINDINGS'));
  assert.ok(decisions.some((entry) => entry.entryId === `brain:decision:${R1}:ACCEPT:TASK_VERIFIED`));
  const ids = brain.map((entry) => entry.entryId);
  assert.equal(new Set(ids).size, ids.length, 'a replayed tick wrote nothing twice');
  const run = await harness.store.loadRun('run-1', 'prj-1');
  assert.equal(run?.projectBrainRevision, brain.length, 'one revision per entry, the seeded objective included');
});

test('a repaired task keeps REPAIR as its own verdict: completion flows through its repair’s ACCEPT, and nothing re-decides it', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(UNTESTED), ACCEPTS, ACCEPTS] });
  await drain(harness.loop);
  // Drained twice: the run loop re-verifies finished work on every advance, so
  // a verdict that could flip would have flipped by now.
  await drain(harness.loop);
  const decisions = await harness.store.decisionsForRun('run-1', 'prj-1');
  const build1 = decisions.filter((decision) => decision.taskId === 'build-1');
  assert.deepEqual(build1.map((decision) => decision.action), ['REPAIR'], 'build-1 was decided once, and it was sent back');
  assert.ok(decisions.some((decision) => decision.taskId === R1 && decision.action === 'ACCEPT'), 'the repair was accepted');
  assert.equal((await harness.store.loadRun('run-1', 'prj-1'))?.state, 'COMPLETED');
});

test('an accepted repair releases the dependent build exactly once, and the run completes', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(UNTESTED), ACCEPTS, ACCEPTS] });
  await drain(harness.loop);
  const releases = eventsOf(harness, 'task.runnable').filter((event) => event.taskId === 'build-2');
  assert.equal(releases.length, 1);
  assert.equal((await harness.store.loadRun('run-1', 'prj-1'))?.state, 'COMPLETED');
});

test('a repair lineage is bounded: past its rounds the run halts and the dependent never runs', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(UNTESTED), REJECTS(UNTESTED), REJECTS(UNTESTED)], maxRepairRounds: 1 });
  await drain(harness.loop);
  const repairs = (await harness.store.tasksForRun('run-1', 'prj-1')).filter((value) => value.taskType === 'repair:build');
  assert.equal(repairs.length, 1, 'one round and no more');
  assert.ok(eventsOf(harness, 'run.failed').length > 0, 'the run halted');
  assert.equal(harness.adapters.get('coder-adapter')!.dispatches.some((dispatch) => dispatch.taskId === 'build-2'), false);
});

test('a SECRET entry never reaches a packet, whatever the task', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(UNTESTED), ACCEPTS, ACCEPTS], secret: true });
  await drain(harness.loop);
  for (const snapshot of harness.store.contexts()) {
    const text = snapshot.packet.blocks.map((block) => block.text).join('\n');
    assert.equal(text.includes('hunter2'), false, `${snapshot.taskId} carries no secret`);
    assert.equal(snapshot.sourceEntryIds.includes('brain-secret'), false);
  }
});

test('a context record keeps every field it has today', async () => {
  const harness = twoBuilds({ reviewer: [ACCEPTS, ACCEPTS] });
  await drain(harness.loop);
  const compiled = eventsOf(harness, 'context.compiled');
  assert.ok(compiled.length > 0);
  for (const event of compiled) {
    for (const key of ['contextId', 'characterCount', 'truncated', 'redactionCount', 'contentHash']) {
      assert.ok(Object.hasOwn(event.facts, key), `${String(event.taskId)} context.compiled carries ${key}`);
    }
  }
});

test('no event type the ledger already records is renamed or removed', () => {
  const recorded = [
    'run.created', 'run.transitioned', 'run.paused', 'run.resumed', 'run.cancelled', 'run.completed', 'run.failed',
    'task.created', 'task.runnable', 'task.claimed', 'task.failed', 'task.cancelled',
    'worker.selected', 'worker.dispatched', 'worker.completed', 'provider.failure', 'reroute.selected', 'fallback.selected', 'retry.scheduled',
    'budget.allocated', 'context.compiled',
    'evidence.recorded', 'review.started', 'finding.recorded', 'verification.decided', 'repair.scheduled',
    'contract.proposed', 'contract.challenged', 'contract.locked', 'contract.refused', 'contract.disposition',
    'checkpoint.recorded', 'checkpoint.verdict', 'guidance.issued', 'guidance.refused',
    'research.refused', 'research.retrieved', 'guidance.deferred', 'research.attempted', 'worker.effort',
    'subagent.spawned', 'subagent.denied', 'subagent.completed',
    'budget.reserved', 'budget.settled', 'budget.denied', 'approval.requested', 'approval.decided', 'recovery.action',
  ];
  for (const type of recorded) assert.ok((JULIUS_OPERATIONAL_EVENT_TYPES as readonly string[]).includes(type), type);
});

test('recording the same review evidence twice is one finding', async () => {
  const harness = twoBuilds({ reviewer: [REJECTS(UNTESTED), ACCEPTS, ACCEPTS] });
  await drain(harness.loop);
  const [finding] = (await harness.store.findingsForRun('run-1', 'prj-1')).filter((value) => value.claim === UNTESTED);
  assert.ok(finding);
  const again = await harness.store.recordFinding({ projectId: 'prj-1', finding: { ...finding } });
  assert.equal(again, false);
  assert.equal((await harness.store.findingsForRun('run-1', 'prj-1')).filter((value) => value.claim === UNTESTED).length, 1);
});
