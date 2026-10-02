import { describe, expect, it } from 'vitest';

import { injectJuliusFault } from './julius-fault-injection';
import { JuliusRunLoop } from './julius-run-loop';
import {
  cardPolicy, createJuliusHarness, seedRun, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * AN ACCEPT CITES THE REVIEW THAT LET IT HAPPEN (V2; `julius-accept-review-gate.ts`).
 *
 * Paid run 37039013641 accepted its reviewed plan citing only `…:plan:1:0` and
 * its reviewed build citing tool runs, DIFF and TEST: no `REVIEW_FINDING` id in
 * either decision, though both reviews were on the record. Each case below reads
 * the gating review the way a reader of the bundle does — the
 * `review.verdict.applied` row that names the subject, then that review's PASSED
 * `REVIEW_FINDING` rows — and asserts the decision cites exactly those.
 *
 * Provider-free: every worker answers from a script.
 */

type Step = Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number];

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const scope = { projectId: 'prj-1' };
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The plan does not name the boundary case.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
/** A reviewer that answers, by id, every finding its packet shows it — silence is not resolution. */
const PASS: Step = { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' };
const REJECT: Step = { kind: 'succeed', evidence: FAILED_REVIEW };
const PLAN: Step = { kind: 'succeed', evidence: PLAN_EVIDENCE };
const verdict = (value: Record<string, unknown>): Step => ({ kind: 'succeed', evidence: PASSED_REVIEW, reviewVerdict: value });
const MATERIAL = verdict({ verdict: 'CHALLENGE', category: 'contract_drift', target: 'plan', claim: 'The plan writes outside the permitted paths.' });
const MINOR = verdict({ verdict: 'CHALLENGE', category: 'superficial_test', target: 'work', claim: 'The test cannot fail.' });
const rebut = (value: unknown): Step => ({ kind: 'succeed', evidence: PLAN_EVIDENCE, rebuttal: value });
const CONCEDE = rebut({ position: 'CONCEDES', argument: 'The reviewer is right: the test cannot fail.' });
const MAINTAIN = rebut({
  position: 'MAINTAINS', argument: 'The path is a symlink into the permitted workspace.',
  evidence: [{ locator: 'workspace/etc -> ./local-etc', claim: 'The target resolves inside the workspace.' }],
});

const build = (input: { reviewer: readonly Step[]; architect?: readonly Step[] }): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      {
        worker: worker({
          workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
          capabilities: ['plan'], taskTypes: ['plan', 'repair:plan', 'rebuttal'],
        }),
        script: input.architect ?? [PLAN, PLAN, PLAN],
      },
      {
        worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }),
        script: [{ kind: 'succeed', evidence: BUILD_EVIDENCE }, { kind: 'succeed', evidence: BUILD_EVIDENCE }],
      },
      {
        worker: worker({
          workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'],
          taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build', 'review:rebuttal'],
        }),
        script: input.reviewer,
      },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1', state: 'draft' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  return harness;
};

async function drain(harness: JuliusHarness, ticks = 64): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    const report = await harness.loop.tick(scope);
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

const decisionsOf = async (harness: JuliusHarness, taskId: string) =>
  (await harness.store.decisionsForRun('run-1', 'prj-1')).filter((row) => row.taskId === taskId);
const acceptOf = async (harness: JuliusHarness, taskId: string) => {
  const accepts = (await decisionsOf(harness, taskId)).filter((row) => row.action === 'ACCEPT');
  expect(accepts, `exactly one ACCEPT on ${taskId}`).toHaveLength(1);
  return accepts[0]!;
};
/** The review whose verdict was applied to `subjectTaskId`, as the bundle's lifecycle names it. */
const appliedReviewOf = (harness: JuliusHarness, subjectTaskId: string): string => {
  const applied = harness.store.events().filter((event) => event.type === 'review.verdict.applied' && event.facts.reviewedTaskId === subjectTaskId);
  expect(applied.length, `a verdict was applied to ${subjectTaskId}`).toBeGreaterThan(0);
  return String(applied.at(-1)!.facts.reviewTaskId);
};
const reviewRowsOf = async (harness: JuliusHarness, reviewTaskId: string, status: 'PASSED' | 'FAILED' = 'PASSED') =>
  (await harness.store.evidenceForRun('run-1', 'prj-1'))
    .filter((item) => item.taskId === reviewTaskId && item.type === 'REVIEW_FINDING' && item.status === status)
    .map((item) => item.evidenceId);
const runState = async (harness: JuliusHarness) => (await harness.store.loadRun('run-1', 'prj-1'))!.state;

describe('V2-1 — an ACCEPT cites the review whose verdict was applied', () => {
  it('the plan and the build each cite their own review’s PASSED REVIEW_FINDING, after their own evidence', async () => {
    const harness = build({ reviewer: [PASS, PASS, PASS] });
    await drain(harness);
    expect(await runState(harness)).toBe('COMPLETED');

    for (const subject of ['plan-1', 'build-1']) {
      const review = appliedReviewOf(harness, subject);
      expect(review).toBe(`${subject}:review`);
      const cited = await reviewRowsOf(harness, review);
      expect(cited.length, `${review} left a PASSED row`).toBeGreaterThan(0);
      const accept = await acceptOf(harness, subject);
      expect(accept.reasonCode).toBe('TASK_VERIFIED');
      expect(accept.evidenceIds, `${subject}'s ACCEPT cites ${review}`).toEqual(expect.arrayContaining(cited));
      // The subject's own evidence is still cited, and first.
      const own = (await harness.store.evidenceForRun('run-1', 'prj-1')).filter((item) => item.taskId === subject).map((item) => item.evidenceId);
      expect(accept.evidenceIds.slice(0, own.length)).toEqual(own);
    }
  });
});

describe('V2-2 — after a repair and its re-review, the ACCEPT cites the LATEST applied review', () => {
  it('REJECT → repair → re-review PROCEED: the repair is accepted on the re-review, never on the review that rejected', async () => {
    const harness = build({ reviewer: [REJECT, PASS, PASS, PASS] });
    await drain(harness);
    expect(await runState(harness)).toBe('COMPLETED');

    expect((await decisionsOf(harness, 'plan-1')).map((row) => `${row.action}:${row.reasonCode}`)).toEqual(['REPAIR:BLOCKING_FINDINGS']);
    const rejected = await reviewRowsOf(harness, 'plan-1:review', 'FAILED');
    expect(rejected.length, 'the first review rejected the plan').toBeGreaterThan(0);

    const repair = 'repair:plan-1:1:task';
    const latest = appliedReviewOf(harness, repair);
    expect(latest).toBe(`${repair}:review`);
    const accept = await acceptOf(harness, repair);
    expect(accept.evidenceIds, 'cites the re-review').toEqual(expect.arrayContaining(await reviewRowsOf(harness, latest)));
    const stale = (await harness.store.evidenceForRun('run-1', 'prj-1')).filter((item) => item.taskId === 'plan-1:review').map((item) => item.evidenceId);
    expect(accept.evidenceIds.filter((id) => stale.includes(id)), 'and nothing of the review that rejected').toEqual([]);
  });
});

describe('V2-3 — an ACCEPT that cannot cite a passing review is not written', () => {
  it('a review that declared CONTINUE but left no REVIEW_FINDING row: no ACCEPT, a HALT naming why, and nothing released on it', async () => {
    const silent: Step = { kind: 'succeed', evidence: [], reviewVerdict: { verdict: 'CONTINUE', claim: 'Looks fine.' } };
    const harness = build({ reviewer: [silent, PASS, PASS] });
    await drain(harness);

    const decided = await decisionsOf(harness, 'plan-1');
    expect(decided.map((row) => row.action), 'never accepted').not.toContain('ACCEPT');
    expect(decided.map((row) => `${row.action}:${row.reasonCode}`)).toEqual(['HALT:REVIEW_EVIDENCE_MISSING']);
    expect(decided[0]!.safeSummary).toContain('plan-1:review');
    expect(harness.store.taskRow('build-1')!.state, 'the build is never released').toBe('BLOCKED');
    expect(harness.store.events().some((event) => event.type === 'contract.locked'), 'and its terms are never agreed').toBe(false);
  });
});

describe('V2-1 — the gating review of a disagreement', () => {
  it('ARCHITECT_UPHELD: the held work cites the re-review that upheld the architect, never the challenge it overruled', async () => {
    const harness = build({ architect: [PLAN, MAINTAIN], reviewer: [PASS, MATERIAL, PASS, PASS] });
    await drain(harness);
    expect(await runState(harness)).toBe('COMPLETED');

    const reReview = 'rebuttal:build-1:review:task:review';
    const accept = await acceptOf(harness, 'build-1');
    const upheld = await reviewRowsOf(harness, reReview);
    expect(upheld.length, 'the re-review left a PASSED row').toBeGreaterThan(0);
    expect(accept.evidenceIds, 'cites the re-review').toEqual(expect.arrayContaining(upheld));
    const challenge = (await harness.store.evidenceForRun('run-1', 'prj-1')).filter((item) => item.taskId === 'build-1:review').map((item) => item.evidenceId);
    expect(challenge.length, 'the challenge left rows').toBeGreaterThan(0);
    expect(accept.evidenceIds.filter((id) => challenge.includes(id)), 'and none of the challenge').toEqual([]);
  });

  it('a challenge that is not material: the work proceeds, and its ACCEPT cites that review', async () => {
    const harness = build({ architect: [PLAN, CONCEDE], reviewer: [PASS, MINOR, PASS] });
    await drain(harness);

    const review = appliedReviewOf(harness, 'build-1');
    expect(harness.store.events().find((event) => event.type === 'review.verdict.applied' && event.facts.reviewTaskId === review)!.facts)
      .toMatchObject({ verdict: 'CHALLENGE', route: 'RECORD' });
    const accept = await acceptOf(harness, 'build-1');
    expect(accept.evidenceIds).toEqual(expect.arrayContaining(await reviewRowsOf(harness, review)));
  });
});

describe('V2-4 — what needs no review is unchanged', () => {
  it('without a required review, the ACCEPT cites exactly the task’s own evidence', async () => {
    const coder = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'] });
    const harness = createJuliusHarness({
      workers: [{ worker: coder, script: [{ kind: 'succeed', evidence: BUILD_EVIDENCE }] }],
      card: cardPolicy({ allowedProviders: [coder.providerId] }),
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1', requiredEvidenceTypes: ['TEST'] })] });
    await drain(harness);
    const accept = await acceptOf(harness, 'task-1');
    const own = (await harness.store.evidenceForRun('run-1', 'prj-1')).filter((item) => item.taskId === 'task-1').map((item) => item.evidenceId);
    expect(accept.evidenceIds).toEqual(own);
  });
});

describe('RESUME — a review that concluded but whose verification never ran', () => {
  /**
   * THE CRASH WINDOW. The reviewer's result is durably accepted (the review task
   * is SUCCEEDED) and the process dies before the review's verification records
   * its finding. On restart the resume sweep finds BOTH the work and its review
   * undecided. Before the sweep left the work to its review, it verified the
   * work first, and on main 11c1c890 that ACCEPTED the plan over the review that
   * rejected it, locked the build's terms and released the build.
   */
  it('a restart does not accept the work over the review that rejected it', async () => {
    const harness = build({ reviewer: [REJECT, PASS, PASS, PASS] });
    await harness.loop.tick(scope); // plan-1 runs; its verification schedules plan-1:review
    expect(harness.store.taskRow('plan-1:review')?.state).toBe('RUNNABLE');

    const faulted = injectJuliusFault(harness.store, { method: 'recordFinding', onCall: 1 });
    const crashing = new JuliusRunLoop({ ...harness.deps, store: faulted.store }, harness.policies, { claimLimit: 5, leaseMs: 60_000 });
    await crashing.tick(scope).catch(() => undefined);
    expect(faulted.report.fired, 'the crash came inside the review verification').toBe(true);
    expect(harness.store.taskRow('plan-1:review')!.state, 'the rejecting review is durably done').toBe('SUCCEEDED');
    expect(await decisionsOf(harness, 'plan-1'), 'and nothing was decided').toEqual([]);

    harness.store.restart();
    await harness.loop.advanceRun('run-1', 'prj-1');

    expect((await decisionsOf(harness, 'plan-1')).map((row) => `${row.action}:${row.reasonCode}`), 'the resume repairs the plan the review rejected')
      .toEqual(['REPAIR:BLOCKING_FINDINGS']);
    expect(harness.store.taskRow('build-1')!.state, 'and the build is not released on it').toBe('BLOCKED');
    expect(harness.store.events().some((event) => event.type === 'contract.locked'), 'nor its terms agreed').toBe(false);
  });
});
