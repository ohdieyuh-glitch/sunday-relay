import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE REVIEWER'S VERDICT, ON THE LIVE PATH.
 *
 * Provider-free: every worker answers from a script. Numbered against the
 * founder's PR 1 proof list.
 */

type Step = Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number];

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan', 'guidance', 'repair:guidance'],
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter',
  capabilities: ['review'],
  taskTypes: ['review:plan', 'review:build', 'review:guidance', 'review:repair:plan', 'review:repair:build', 'review:repair:guidance'],
});

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The plan reads a flag psql does not have.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const ASKS = Object.freeze([{
  source: 'web', capability: 'read_item', reference: 'https://www.postgresql.org/docs/current/app-psql.html',
  purpose: 'Whether psql renders NULL as an empty field under -A.',
}]);
const RESUME = Object.freeze({ completedSoFar: ['read the plan'], nextIntent: 'judge the NULL claim against the manual' });

interface Scripts { architect?: readonly Step[]; coder?: readonly Step[]; reviewer?: readonly Step[] }

const build = (scripts: Scripts, over: { promotedWarningCategories?: readonly string[]; deploy?: boolean } = {}): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: scripts.architect ?? [{ kind: 'succeed', evidence: PLAN_EVIDENCE }] },
      { worker: CODER, script: scripts.coder ?? [{ kind: 'succeed' }] },
      { worker: REVIEWER, script: scripts.reviewer ?? [{ kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' }] },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({
      reviewerRequired: true, maxRepairRounds: 2,
      ...(over.promotedWarningCategories === undefined ? {} : { promotedWarningCategories: over.promotedWarningCategories }),
    }),
    capabilityFor,
    research: {
      async serve(request) {
        return request.asks.map((ask) => ({
          outcome: 'observed' as const, reference: ask.reference, purpose: ask.purpose,
          rendered: '<<<RELAY-EVIDENCE\nNULL is rendered as an empty string unless \\pset null is set.\nRELAY-EVIDENCE>>>',
          detail: 'The source answered.', evidenceId: 'ev-research-psql', injectionSignals: [], mayCorroborate: true,
        }));
      },
    },
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  if (over.deploy === true) {
    seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'deploy-1' });
    harness.store.seedTask('run-1', task({
      taskId: 'deploy-1', ordinal: 2, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['build-1'], requiredEvidenceTypes: ['TEST'],
    }));
  }
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
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

const log = (harness: JuliusHarness) => harness.store.events();
const indexOf = (harness: JuliusHarness, predicate: (event: ReturnType<JuliusHarness['store']['events']>[number]) => boolean) =>
  log(harness).findIndex(predicate);

describe('P8 — reviewer research waits for its answer before the verdict applies', () => {
  it('a reviewer that asks before concluding is not judged on the words it said before it looked', async () => {
    const harness = build({
      reviewer: [
        // The pre-research dispatch sounds like an approval, and asks to check.
        { kind: 'succeed', evidence: PASSED_REVIEW, researchAsks: ASKS, segmentResume: RESUME },
        // Having read the manual, it finds the plan wrong.
        { kind: 'succeed', evidence: FAILED_REVIEW },
        { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' },
        { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' },
      ],
      architect: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }, { kind: 'succeed', evidence: PLAN_EVIDENCE }],
    });
    await drain(harness);

    const continuation = 'segment:plan-1:review:2:task';
    const continuationDone = indexOf(harness, (event) => event.type === 'task.claimed' && event.taskId === continuation);
    expect(continuationDone, 'the research continuation ran').toBeGreaterThan(-1);

    // No decision about the plan exists before the reviewer has read the answer.
    const firstPlanDecision = indexOf(harness, (event) => event.type === 'verification.decided' && event.taskId === 'plan-1');
    expect(firstPlanDecision, 'the plan was decided').toBeGreaterThan(continuationDone);
    // The build did not start on a plan the reviewer had not finished judging.
    const buildClaimed = indexOf(harness, (event) => event.type === 'task.claimed' && event.taskId === 'build-1');
    expect(buildClaimed === -1 || buildClaimed > firstPlanDecision).toBe(true);

    // The decision it did reach is the one the researched review supports.
    const planDecisions = log(harness).filter((event) => event.type === 'verification.decided' && event.taskId === 'plan-1');
    expect(planDecisions[0]!.facts.action).toBe('REPAIR');
    expect(harness.store.taskRow('repair:plan-1:1:task'), 'the plan went to repair').not.toBeNull();
  });

  it('the continuation stays bound to the work it is reviewing', async () => {
    const harness = build({
      reviewer: [
        { kind: 'succeed', evidence: PASSED_REVIEW, researchAsks: ASKS, segmentResume: RESUME },
        { kind: 'succeed', evidence: FAILED_REVIEW },
        { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' },
        { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' },
      ],
      architect: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }, { kind: 'succeed', evidence: PLAN_EVIDENCE }],
    });
    await drain(harness);
    const findings = await harness.store.findingsForRun('run-1', 'prj-1');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map((finding) => finding.taskId), 'every finding is about the plan, never about a review').toEqual(findings.map(() => 'plan-1'));
    const decided = log(harness).filter((event) => event.type === 'verification.decided').map((event) => event.taskId);
    expect(decided.filter((taskId) => taskId?.includes(':review')), 'no review was decided as if it were work').toEqual([]);
  });
});

describe('P8 — a researching review of bound work still holds the terms that work ran under', () => {
  it('the continuation of a build review is dispatched under the locked contract of the build and decides the build', async () => {
    const harness = build({
      reviewer: [
        { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' },
        { kind: 'succeed', evidence: PASSED_REVIEW, researchAsks: ASKS, segmentResume: RESUME },
        { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' },
      ],
    });
    await drain(harness);
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    const claimed = log(harness).find((event) => event.type === 'task.claimed' && event.taskId === 'segment:build-1:review:2:task');
    expect(claimed, 'the researching review continued').not.toBeUndefined();
    expect(claimed!.facts.contractRevision).toBe(contract!.contractRevision);
    expect(claimed!.facts.bindingDigest).toBe(contract!.bindingDigest);
    expect(log(harness).some((event) => event.type === 'contract.refused'), 'no binding mismatch was invented').toBe(false);
    expect(log(harness).filter((event) => event.type === 'verification.decided' && event.taskId === 'build-1').map((event) => event.facts.action)).toEqual(['ACCEPT']);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });
});

/* ------------------------------------------------------------ the canonical verdicts */

const PLAN_PASS: Step = { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' };
const verdict = (value: Record<string, unknown>, evidence = PASSED_REVIEW): Step => ({ kind: 'succeed', evidence, reviewVerdict: value });
const factsOf = (harness: JuliusHarness, type: string) =>
  log(harness).filter((event) => event.type === type).map((event) => ({ taskId: event.taskId, ...event.facts } as Record<string, unknown>));
const decisionsOn = (harness: JuliusHarness, taskId: string) =>
  factsOf(harness, 'verification.decided').filter((facts) => facts.taskId === taskId);

describe('P13 — a WARNING stays visible and does not block', () => {
  const WARNED = verdict({
    verdict: 'WARNING', claim: 'Accepted with two concerns.',
    warnings: [
      { category: 'superficial_test', claim: 'The test asserts the exit code and not the output.' },
      { category: 'unsafe_implementation', claim: 'The temporary file is created world-readable.' },
    ],
  });

  it('every warning is a retained, non-blocking finding on the work, and the work is accepted', async () => {
    const harness = build({ reviewer: [PLAN_PASS, WARNED] }, { deploy: true });
    await drain(harness);

    const findings = (await harness.store.findingsForRun('run-1', 'prj-1')).filter((finding) => finding.taskId === 'build-1');
    expect(findings.map((finding) => [finding.category, finding.blocking, finding.status])).toEqual([
      ['superficial_test', false, 'OPEN'],
      ['unsafe_implementation', false, 'OPEN'],
    ]);
    expect(decisionsOn(harness, 'build-1').map((facts) => facts.action)).toEqual(['ACCEPT']);
    expect(factsOf(harness, 'review.verdict.applied').find((facts) => facts.reviewTaskId === 'build-1:review'))
      .toMatchObject({ verdict: 'WARNING', route: 'RETAIN', warningsRetained: 2, warningsPromoted: 0, source: 'DECLARED' });
    expect(harness.store.taskRow('deploy-1')!.state, 'what depended on the work ran').toBe('SUCCEEDED');
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });

  it('only Julius promotes a warning, by its own policy, and then the work is repaired', async () => {
    const harness = build({
      reviewer: [PLAN_PASS, WARNED, PLAN_PASS, PLAN_PASS],
      coder: [{ kind: 'succeed' }, { kind: 'succeed' }],
    }, { promotedWarningCategories: ['unsafe_implementation'] });
    await drain(harness);
    const findings = (await harness.store.findingsForRun('run-1', 'prj-1')).filter((finding) => finding.taskId === 'build-1');
    expect(findings.map((finding) => [finding.category, finding.blocking])).toEqual([
      ['superficial_test', false],
      ['unsafe_implementation', true],
    ]);
    expect(decisionsOn(harness, 'build-1').map((facts) => facts.action)).toEqual(['REPAIR']);
    expect(harness.store.taskRow('repair:build-1:1:task')).not.toBeNull();
  });
});

describe('P12 — REPAIR_REQUIRED leads to a bounded repair and an independent re-review', () => {
  it('the repair is reviewed by a fresh review request, and its acceptance completes the work', async () => {
    const harness = build({
      reviewer: [
        PLAN_PASS,
        verdict({ verdict: 'REPAIR_REQUIRED', category: 'missed_acceptance_criterion', claim: 'NULL renders as the literal word.' }, FAILED_REVIEW),
        PLAN_PASS,
      ],
      coder: [{ kind: 'succeed' }, { kind: 'succeed' }],
    });
    await drain(harness);

    expect(decisionsOn(harness, 'build-1').map((facts) => facts.action)).toEqual(['REPAIR']);
    const repairId = 'repair:build-1:1:task';
    expect(harness.store.taskRow(repairId)!.state).toBe('SUCCEEDED');
    const reviews = factsOf(harness, 'peer.request.opened').filter((facts) => facts.kind === 'REVIEW_REQUEST');
    expect(reviews.map((facts) => facts.carrierTaskId)).toEqual(['plan-1:review', 'build-1:review', `${repairId}:review`]);
    // Independent: a separate review task, dispatched separately, deciding the repair.
    const reviewerDispatches = harness.adapters.get(REVIEWER.adapterId)!.dispatches.map((dispatch) => dispatch.taskId);
    expect(reviewerDispatches).toEqual(['plan-1:review', 'build-1:review', `${repairId}:review`]);
    expect(decisionsOn(harness, repairId).map((facts) => facts.action)).toEqual(['ACCEPT']);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });

  it('a declared REPAIR_REQUIRED is not talked out of by PASSED evidence', async () => {
    const harness = build({
      reviewer: [PLAN_PASS, verdict({ verdict: 'REPAIR_REQUIRED', claim: 'The migration is not reversible.' }), PLAN_PASS],
      coder: [{ kind: 'succeed' }, { kind: 'succeed' }],
    });
    await drain(harness);
    expect(decisionsOn(harness, 'build-1').map((facts) => facts.action)).toEqual(['REPAIR']);
    expect(factsOf(harness, 'review.verdict.applied').find((facts) => facts.reviewTaskId === 'build-1:review'))
      .toMatchObject({ verdict: 'REPAIR_REQUIRED', declared: 'REPAIR_REQUIRED', derived: 'CONTINUE', source: 'DECLARED' });
  });

  it('a CONTINUE declaration cannot talk FAILED evidence into an acceptance', async () => {
    const harness = build({
      reviewer: [PLAN_PASS, verdict({ verdict: 'CONTINUE', claim: 'Looks fine.' }, FAILED_REVIEW), PLAN_PASS],
      coder: [{ kind: 'succeed' }, { kind: 'succeed' }],
    });
    await drain(harness);
    expect(decisionsOn(harness, 'build-1').map((facts) => facts.action)).toEqual(['REPAIR']);
    expect(factsOf(harness, 'review.verdict.applied').find((facts) => facts.reviewTaskId === 'build-1:review'))
      .toMatchObject({ verdict: 'REPAIR_REQUIRED', source: 'EVIDENCE' });
  });
});

describe('P14 — BLOCK halts the affected path', () => {
  it('a BLOCK is a HALT Julius writes: no repair, nothing downstream runs, the mission does not complete', async () => {
    const harness = build({
      reviewer: [PLAN_PASS, verdict({ verdict: 'BLOCK', category: 'unsafe_implementation', claim: 'The build drops the production schema.' })],
    }, { deploy: true });
    await drain(harness);

    expect(decisionsOn(harness, 'build-1')).toEqual([expect.objectContaining({ action: 'HALT', reasonCode: 'REVIEW_BLOCKED', reviewRoute: 'HALT' })]);
    expect(harness.store.taskRow('repair:build-1:1:task'), 'a block is not a repair order').toBeNull();
    expect(harness.store.taskRow('deploy-1')!.state).toBe('BLOCKED');
    expect(log(harness).some((event) => event.type === 'task.claimed' && event.taskId === 'deploy-1')).toBe(false);
    const finding = (await harness.store.findingsForRun('run-1', 'prj-1')).find((item) => item.findingId === 'finding:verdict:build-1:review');
    expect(finding).toMatchObject({ severity: 'CRITICAL', blocking: true, category: 'unsafe_implementation', taskId: 'build-1' });
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).not.toBe('COMPLETED');
  });
});

describe('P15 — a provider failure stays outside verdict semantics', () => {
  it('a review that failed to run has no verdict, no finding and no decision, and its error text is not recorded', async () => {
    const hostile = ['Upstream said:', ['sk', 'ant', 'FAKETESTNOTREAL0123456789'].join('-'), 'Authorization: Bearer', 'x'.repeat(24)].join(' ');
    const harness = build({
      reviewer: [PLAN_PASS, { kind: 'fail', code: 'PROVIDER_UNAVAILABLE', message: hostile }],
    });
    await drain(harness);

    expect(harness.store.taskRow('build-1:review')!.state).toBe('FAILED');
    expect(log(harness).filter((event) => event.type.startsWith('review.verdict.'))
      .filter((event) => event.facts.reviewTaskId === 'build-1:review')).toEqual([]);
    expect((await harness.store.findingsForRun('run-1', 'prj-1')).filter((finding) => finding.taskId === 'build-1')).toEqual([]);
    expect(decisionsOn(harness, 'build-1'), 'Julius decided nothing about the build').toEqual([]);
    const review = factsOf(harness, 'peer.request.opened').find((facts) => facts.carrierTaskId === 'build-1:review');
    const moves = factsOf(harness, 'peer.request.transitioned').filter((facts) => facts.requestId === review!.requestId);
    expect(moves, 'the review request is still owed an answer').toEqual([]);
    const everything = JSON.stringify({ events: log(harness), trajectory: harness.store.trajectory(), findings: await harness.store.findingsForRun('run-1', 'prj-1') });
    expect(everything).not.toContain('FAKETESTNOTREAL');
    expect(everything).not.toContain('Bearer');
  });
});

describe('P4 — the reviewer cannot mint VERIFIED', () => {
  it.each([
    ['a VERIFIED verdict', { verdict: 'VERIFIED', claim: 'All done.' }],
    ['a CONTINUE that declares the task complete', { verdict: 'CONTINUE', claim: 'Fine.', status: 'COMPLETE' }],
    ['a WARNING that reaches for the budget', { verdict: 'WARNING', claim: 'Fine.', budget: { spendUsd: 50 } }],
  ])('%s is refused by name, and the work is decided on its evidence by Julius', async (_label, declared) => {
    const harness = build({ reviewer: [PLAN_PASS, verdict(declared)] });
    await drain(harness);
    const refused = factsOf(harness, 'review.verdict.refused').find((facts) => facts.reviewTaskId === 'build-1:review');
    expect(refused!.reasonCode).toMatch(/^peer_response_(mints_julius_only_outcome|mutates_protected_term)$/u);
    expect(factsOf(harness, 'review.verdict.applied').find((facts) => facts.reviewTaskId === 'build-1:review'))
      .toMatchObject({ declared: null, source: 'EVIDENCE', verdict: 'CONTINUE' });
    for (const decided of log(harness).filter((event) => event.type === 'verification.decided')) {
      expect(['ACCEPT', 'COMPLETE', 'REPAIR', 'RETRY', 'HALT']).toContain(decided.facts.action);
    }
  });
});

describe('P9 (verdict half) — a CHALLENGE is recorded, never revises the contract, and pauses only when material', () => {
  it('a material challenge of the plan holds the work and leaves the contract byte-identical', async () => {
    const harness = build({
      reviewer: [PLAN_PASS, verdict({ verdict: 'CHALLENGE', category: 'contract_drift', target: 'plan', claim: 'The plan writes outside the permitted paths.' })],
    }, { deploy: true });
    for (let index = 0; index < 8; index += 1) await harness.loop.tick({ projectId: 'prj-1' });
    const before = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    await drain(harness);

    const challenge = factsOf(harness, 'peer.request.opened').find((facts) => facts.kind === 'EVIDENCE_CHALLENGE');
    expect(challenge).toMatchObject({
      sourceRole: 'INDEPENDENT_REVIEWER', targetRole: 'JULIUS', mediatedFor: 'PROMPT_ARCHITECT',
      subjectTaskId: 'build-1', carrierTaskId: 'build-1:review', mandatory: true, pausedTaskIds: 'deploy-1',
    });
    expect(String(challenge!.evidenceIds).length, 'it cites the review').toBeGreaterThan(0);
    // Nothing serves a rebuttal in this graph, so Julius resolves the
    // disagreement at once by its own rule — the challenge stands — and only
    // then decides the work. Nothing was decided, and nothing downstream ran,
    // before that resolution existed.
    const resolvedAt = log(harness).findIndex((event) => event.type === 'disagreement.resolved');
    expect(log(harness)[resolvedAt]!.facts).toMatchObject({ resolution: 'CHALLENGE_UPHELD', resolutionBasis: 'REBUTTAL_UNROUTABLE' });
    const firstDecision = log(harness).findIndex((event) => event.type === 'verification.decided' && event.taskId === 'build-1');
    expect(firstDecision, 'no decision while it was unresolved').toBeGreaterThan(resolvedAt);
    expect(decisionsOn(harness, 'build-1').map((facts) => facts.action)).toEqual(['REPAIR']);
    expect(log(harness).some((event) => event.type === 'task.claimed' && event.taskId === 'deploy-1'
      && log(harness).indexOf(event) < resolvedAt)).toBe(false);
    expect(await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' })).toEqual(before);
    expect(await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' })).toHaveLength(1);
    expect(log(harness).some((event) => event.type === 'contract.challenged' || event.type === 'contract.proposed')).toBe(false);
  });

  it('a challenge that is not material is recorded and the work proceeds', async () => {
    const harness = build({
      reviewer: [PLAN_PASS, verdict({ verdict: 'CHALLENGE', category: 'superficial_test', target: 'work', claim: 'The test cannot fail.' })],
    }, { deploy: true });
    await drain(harness);
    const challenge = factsOf(harness, 'peer.request.opened').find((facts) => facts.kind === 'CHALLENGE');
    expect(challenge).toMatchObject({ mandatory: false, pausedTaskIds: '', subjectTaskId: 'build-1' });
    expect(decisionsOn(harness, 'build-1').map((facts) => facts.action)).toEqual(['ACCEPT']);
    const finding = (await harness.store.findingsForRun('run-1', 'prj-1')).find((item) => item.findingId === 'finding:challenge:build-1:review');
    expect(finding).toMatchObject({ blocking: false, category: 'superficial_test' });
    expect(harness.store.taskRow('deploy-1')!.state).toBe('SUCCEEDED');
  });
});

describe('a concluded review is not re-verified forever', () => {
  it('after the mission completes, an idle advance resumes nothing and writes no decision', async () => {
    const harness = build({ reviewer: [PLAN_PASS, verdict({ verdict: 'WARNING', claim: 'One concern.', warnings: [{ category: 'superficial_test', claim: 'Thin test.' }] })] });
    await drain(harness);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
    const decided = factsOf(harness, 'verification.decided').length;
    const applied = factsOf(harness, 'review.verdict.applied').length;
    for (let index = 0; index < 5; index += 1) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      expect(advance!.resumedVerifications).toBe(0);
    }
    expect(factsOf(harness, 'verification.decided')).toHaveLength(decided);
    expect(factsOf(harness, 'review.verdict.applied')).toHaveLength(applied);
    expect(decided, 'one decision per reviewed unit').toBe(2);
  });
});
