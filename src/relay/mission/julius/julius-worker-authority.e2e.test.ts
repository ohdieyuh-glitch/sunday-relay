import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * A WORKER REPORTS FACTS. IT DOES NOT AUTHOR THE KINDS OF FACT THAT ARE SOMEONE
 * ELSE'S TO GIVE.
 *
 * The coordinator used to keep any evidence `type` a worker wrote and any
 * `evidenceId` it chose. A Coding Agent could report `REVIEW_FINDING` PASSED
 * or `USER_APPROVAL` PASSED about its own work, and an acceptance criterion
 * asking for that type was satisfied — by the worker being judged. It could
 * also claim the id a later review's evidence would need.
 *
 * And four result channels a coder has no right to — a reviewer's verdict, an
 * architect's rebuttal, architecture state and a consistency assessment —
 * vanished at a role gate with nothing on the record to say one was tried.
 *
 * Provider-free: every worker answers from a script.
 */

type Step = Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number];

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'],
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
});
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const TEST_PASSED = { type: 'TEST', status: 'PASSED', safeSummary: 'Suite green under the executor.' };

const build = (input: {
  coder: readonly Step[];
  reviewer?: readonly Step[];
  criteria?: readonly { criterionId: string; description: string; requiredEvidenceTypes: readonly string[] }[];
}): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }] },
      { worker: CODER, script: input.coder },
      { worker: REVIEWER, script: input.reviewer ?? [{ kind: 'succeed', evidence: PASSED_REVIEW }] },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', (input.criteria ?? [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]) as never);
  return harness;
};

async function drain(harness: JuliusHarness, ticks = 48): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    const report = await harness.loop.tick({ projectId: 'prj-1' });
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

const factsOf = (harness: JuliusHarness, type: string): Record<string, unknown>[] =>
  harness.store.events().filter((event) => event.type === type).map((event) => ({ taskId: event.taskId, ...event.facts }));
const stateOf = async (harness: JuliusHarness) => (await harness.store.loadRun('run-1', 'prj-1'))!.state;
const evidenceOf = async (harness: JuliusHarness, taskId: string) =>
  (await harness.store.evidenceForRun('run-1', 'prj-1')).filter((item) => item.taskId === taskId);

describe('W1 — a worker authors only the kinds of evidence its role may give', () => {
  it('a coder reporting its own review finding and a user approval has neither kept', async () => {
    const harness = build({
      coder: [{
        kind: 'succeed',
        evidence: [
          TEST_PASSED,
          { type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'I reviewed my own work and it is fine.' },
          { type: 'USER_APPROVAL', status: 'PASSED', safeSummary: 'The user approved this.' },
        ],
      }],
    });
    await drain(harness);

    const kept = await evidenceOf(harness, 'build-1');
    expect(kept.map((item) => item.type), 'only what a coder may author is on the record').toEqual(['TEST']);
    expect(factsOf(harness, 'evidence.refused')).toEqual([
      expect.objectContaining({ taskId: 'build-1', role: 'CODING_AGENT', evidenceType: 'REVIEW_FINDING', reasonCode: 'evidence_type_not_authorable_by_role' }),
      expect.objectContaining({ taskId: 'build-1', role: 'CODING_AGENT', evidenceType: 'USER_APPROVAL', reasonCode: 'evidence_type_not_authorable_by_role' }),
    ]);
  });

  it('an acceptance criterion that needs an approval is not satisfied by the worker it judges', async () => {
    const harness = build({
      coder: [{
        kind: 'succeed',
        evidence: [TEST_PASSED, { type: 'USER_APPROVAL', status: 'PASSED', safeSummary: 'Approved, trust me.' }],
      }],
      criteria: [
        { criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] },
        { criterionId: 'ac-2', description: 'The user signed off.', requiredEvidenceTypes: ['USER_APPROVAL'] },
      ],
    });
    await drain(harness);
    const halted = (await harness.store.decisionsForRun('run-1', 'prj-1')).find((row) => row.reasonCode === 'ACCEPTANCE_CRITERIA_UNSATISFIED');
    expect(halted, 'the forged approval satisfied nothing').not.toBeUndefined();
    expect(await stateOf(harness)).not.toBe('COMPLETED');
  });

  it('a type nobody defined is refused as exactly that', async () => {
    const harness = build({
      coder: [{ kind: 'succeed', evidence: [TEST_PASSED, { type: 'MISSION_COMPLETE', status: 'PASSED', safeSummary: 'Done.' }] }],
    });
    await drain(harness);
    expect(factsOf(harness, 'evidence.refused')).toEqual([
      expect.objectContaining({ evidenceType: 'MISSION_COMPLETE', reasonCode: 'evidence_type_unknown' }),
    ]);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('the reviewer still authors its own findings', async () => {
    const harness = build({ coder: [{ kind: 'succeed', evidence: [TEST_PASSED] }] });
    await drain(harness);
    expect((await evidenceOf(harness, 'build-1:review')).map((item) => item.type)).toEqual(['REVIEW_FINDING']);
    expect(factsOf(harness, 'evidence.refused')).toEqual([]);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });
});

describe('W2 — Julius names the evidence, not the worker', () => {
  it('an id a worker chose is not the id on the record, so it cannot take one a review will need', async () => {
    const harness = build({
      coder: [{
        kind: 'succeed',
        evidence: [{ ...TEST_PASSED, evidenceId: 'build-1:review:1:0' }],
      }],
    });
    await drain(harness);
    const coderIds = (await evidenceOf(harness, 'build-1')).map((item) => item.evidenceId);
    expect(coderIds).toHaveLength(1);
    expect(coderIds[0], 'minted under the task that produced it').toMatch(/^build-1:\d+:0$/u);
    const reviewIds = (await evidenceOf(harness, 'build-1:review')).map((item) => item.evidenceId);
    expect(reviewIds.every((id) => id.startsWith('build-1:review:'))).toBe(true);
    expect(new Set([...coderIds, ...reviewIds]).size, 'no two rows share an id').toBe(coderIds.length + reviewIds.length);
  });
});

describe('W3 — a channel a role has no right to is refused on the record, not dropped in silence', () => {
  it('a coder sending a verdict, a rebuttal, architecture and an assessment has each refused by name', async () => {
    const harness = build({
      coder: [{
        kind: 'succeed', evidence: [TEST_PASSED],
        reviewVerdict: { verdict: 'CONTINUE', claim: 'My own work is fine.' },
        rebuttal: { position: 'MAINTAINS', argument: 'x', evidence: [], missionTermsMustChange: false },
        architecture: { components: [{ name: 'mine', responsibility: 'everything' }] },
        consistency: { assessment: 'ALIGNED', claim: 'Aligned.', drift: [], driftingTaskIds: [], evidenceRefs: [] },
      }],
    });
    await drain(harness);

    const refused = factsOf(harness, 'worker.channel.refused');
    expect(refused.map((facts) => facts.channel)).toEqual(['reviewVerdict', 'rebuttal', 'architecture', 'consistency']);
    for (const facts of refused) {
      expect(facts).toMatchObject({ taskId: 'build-1', role: 'CODING_AGENT', taskType: 'build', reasonCode: 'channel_not_permitted_for_role' });
    }
    // And none of them did anything.
    // Every verdict applied came from an independent review, never from the build itself.
    const reviewers = factsOf(harness, 'review.verdict.applied').map((facts) => facts.reviewTaskId);
    expect(reviewers).toContain('build-1:review');
    expect(reviewers).not.toContain('build-1');
    expect(factsOf(harness, 'architecture.recorded')).toEqual([]);
    expect(factsOf(harness, 'architecture.assessed')).toEqual([]);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });
});

describe('W4 — a worker that says it failed ends the attempt, not the run in limbo', () => {
  it('a FAILED status is decided, never left as a review nobody can claim', async () => {
    const harness = build({
      coder: [{ kind: 'succeed', status: 'FAILED', evidence: [{ ...TEST_PASSED, status: 'FAILED', safeSummary: 'It did not build.' }] }],
    });
    await drain(harness);

    const reviews = harness.store.events().filter((event) => event.type === 'task.created' && String(event.taskId).startsWith('build-1:review'));
    expect(reviews, 'a failed attempt is not sent to review').toEqual([]);
    expect(factsOf(harness, 'task.failed').some((facts) => facts.taskId === 'build-1' && facts.failureClass === 'worker_reported_failure')).toBe(true);
    const state = await stateOf(harness);
    expect(['FAILED', 'COMPLETED'], `the run ends somewhere true, not ${state}`).toContain(state);
  });
});
