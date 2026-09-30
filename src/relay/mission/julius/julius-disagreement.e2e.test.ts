import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { foldJuliusDisagreements } from './julius-disagreement';
import { foldJuliusPeerRequests } from './julius-peer-channel';
import { readJuliusPeerChannel } from './julius-peer-runtime';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * WHEN THE ARCHITECT AND THE REVIEWER DISAGREE, THROUGH THE REAL PIPELINE.
 *
 * Provider-free. The graph is a plan, a build under a locked contract, and a
 * deploy that depends on the build — so a held challenge has something to hold.
 * Numbered against the founder's PR 1 proof list.
 */

type Step = Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number];

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
/** A reviewer that answers, by id, every finding its packet shows it — silence is not resolution. */
const PASS: Step = { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' };
const PLAN: Step = { kind: 'succeed', evidence: PLAN_EVIDENCE };
const verdict = (value: Record<string, unknown>): Step => ({ kind: 'succeed', evidence: PASSED_REVIEW, reviewVerdict: value });
const MATERIAL = verdict({ verdict: 'CHALLENGE', category: 'contract_drift', target: 'plan', claim: 'The plan writes outside the permitted paths.' });
const MINOR = verdict({ verdict: 'CHALLENGE', category: 'superficial_test', target: 'work', claim: 'The test cannot fail.' });
const rebut = (value: unknown): Step => ({ kind: 'succeed', evidence: PLAN_EVIDENCE, rebuttal: value });
const CONCEDE = rebut({ position: 'CONCEDES', argument: 'The reviewer is right: step 4 writes to /etc.' });
const MAINTAIN = rebut({
  position: 'MAINTAINS', argument: 'The path is a symlink into the permitted workspace.',
  evidence: [{ locator: 'workspace/etc -> ./local-etc', claim: 'The target resolves inside the workspace.' }],
});

interface Scripts { architect: readonly Step[]; coder?: readonly Step[]; reviewer: readonly Step[] }

const build = (scripts: Scripts, over: { rebuttalRoutable?: boolean; executionScope?: string } = {}): JuliusHarness => {
  const routable = over.rebuttalRoutable ?? true;
  const harness = createJuliusHarness({
    workers: [
      {
        worker: worker({
          workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter', capabilities: ['plan'],
          taskTypes: ['plan', 'repair:plan', 'guidance', 'repair:guidance', ...(routable ? ['rebuttal'] : [])],
        }),
        script: scripts.architect,
      },
      {
        worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }),
        script: scripts.coder ?? [{ kind: 'succeed' }, { kind: 'succeed' }, { kind: 'succeed' }],
      },
      {
        worker: worker({
          workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'],
          taskTypes: ['review:plan', 'review:build', 'review:repair:build', 'review:rebuttal'],
        }),
        script: scripts.reviewer,
      },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
    ...(over.executionScope === undefined ? {} : { executionScope: over.executionScope }),
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'deploy-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  harness.store.seedTask('run-1', task({ taskId: 'deploy-1', ordinal: 2, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['build-1'], requiredEvidenceTypes: ['TEST'] }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  return harness;
};

async function step(harness: JuliusHarness): Promise<boolean> {
  const report = await harness.loop.tick({ projectId: 'prj-1' });
  if (report.claimed > 0) return true;
  const advance = await harness.loop.advanceRun('run-1', 'prj-1');
  return advance !== null && (advance.changed || advance.resumedVerifications > 0);
}
async function drain(harness: JuliusHarness, ticks = 60): Promise<void> {
  for (let index = 0; index < ticks; index += 1) if (!(await step(harness))) break;
}

const log = (harness: JuliusHarness) => harness.store.events();
const rows = (harness: JuliusHarness) => log(harness).map((event) => ({ type: event.type, facts: event.facts, taskId: event.taskId }));
const disagreements = (harness: JuliusHarness) => foldJuliusDisagreements(rows(harness));
const requests = (harness: JuliusHarness) => foldJuliusPeerRequests(rows(harness));
const decisionsOn = (harness: JuliusHarness, taskId: string) =>
  log(harness).filter((event) => event.type === 'verification.decided' && event.taskId === taskId).map((event) => `${String(event.facts.action)}:${String(event.facts.reasonCode)}`);
const claimed = (harness: JuliusHarness, taskId: string) => log(harness).some((event) => event.type === 'task.claimed' && event.taskId === taskId);
const stateOf = async (harness: JuliusHarness) => (await harness.store.loadRun('run-1', 'prj-1'))!.state;
const REBUTTAL = 'rebuttal:build-1:review:task';
const RE_REVIEW = `${REBUTTAL}:review`;

describe('P9 — a CHALLENGE opens a disagreement and never touches the contract', () => {
  it('the record names the subject, both sides’ evidence, the binding, and asks the architect once', async () => {
    const harness = build({ architect: [PLAN, CONCEDE], reviewer: [PASS, MATERIAL, PASS, PASS] });
    for (let index = 0; index < 5; index += 1) await harness.loop.tick({ projectId: 'prj-1' });
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    await drain(harness);

    const opened = log(harness).find((event) => event.type === 'disagreement.opened');
    expect(opened!.facts).toMatchObject({
      disagreementId: 'disagreement:local:build-1:review', subjectTaskId: 'build-1', reviewTaskId: 'build-1:review',
      material: true, category: 'contract_drift', target: 'PLAN', reviewerPosition: 'The plan writes outside the permitted paths.',
      contractBindingDigest: contract!.bindingDigest,
    });
    expect(String(opened!.facts.reviewerEvidenceIds).length, 'the reviewer cites its review').toBeGreaterThan(0);
    expect(String(opened!.facts.codingAgentEvidenceIds).length, 'and the record holds what the build produced').toBeGreaterThan(0);
    const challenge = requests(harness).find((request) => request.kind === 'EVIDENCE_CHALLENGE')!;
    expect(opened!.facts.challengeRequestId).toBe(challenge.requestId);

    const rebuttalRequest = requests(harness).find((request) => request.kind === 'REBUTTAL_REQUEST')!;
    expect(rebuttalRequest).toMatchObject({
      sourceRole: 'JULIUS', targetRole: 'PROMPT_ARCHITECT', carrierTaskId: REBUTTAL, subjectTaskId: 'build-1',
      mandatory: true, pausedTaskIds: ['deploy-1'], contractBindingDigest: contract!.bindingDigest,
    });

    // The contract is exactly what the plan review locked, throughout.
    expect(await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' })).toEqual(contract);
    expect(await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' })).toHaveLength(1);
    expect(log(harness).some((event) => ['contract.proposed', 'contract.challenged'].includes(event.type))).toBe(false);
  });

  it('the architect CONCEDES: the challenge is upheld and the work is repaired, never argued again', async () => {
    const harness = build({ architect: [PLAN, CONCEDE], reviewer: [PASS, MATERIAL, PASS, PASS] });
    await drain(harness);
    const [disagreement] = disagreements(harness);
    expect(disagreement).toMatchObject({ status: 'RESOLVED', resolution: 'CHALLENGE_UPHELD', resolutionBasis: 'ARCHITECT_CONCEDED', architectPosition: 'CONCEDES', reReviewTaskId: null });
    expect(harness.store.taskRow(RE_REVIEW), 'a concession needs no re-review').toBeNull();
    expect(decisionsOn(harness, 'build-1')).toEqual(['REPAIR:BLOCKING_FINDINGS']);
    const finding = (await harness.store.findingsForRun('run-1', 'prj-1')).find((item) => item.findingId === 'finding:disagreement:build-1:review');
    expect(finding).toMatchObject({ blocking: true, taskId: 'build-1', category: 'contract_drift' });
    expect(harness.store.taskRow('repair:build-1:1:task')!.state).toBe('SUCCEEDED');
    // Deploy waited for the whole argument and the repair.
    const resolvedAt = log(harness).findIndex((event) => event.type === 'disagreement.resolved');
    const deployClaimed = log(harness).findIndex((event) => event.type === 'task.claimed' && event.taskId === 'deploy-1');
    expect(deployClaimed).toBeGreaterThan(resolvedAt);
    expect(requests(harness).find((request) => request.kind === 'EVIDENCE_CHALLENGE')).toMatchObject({ status: 'RESOLVED', transitionCode: 'CHALLENGE_UPHELD' });
    expect(decisionsOn(harness, REBUTTAL)).toEqual(['ACCEPT:DISAGREEMENT_REBUTTAL_RECEIVED']);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });
});

describe('P11 — a maintained Architect position is independently re-reviewed', () => {
  it('MAINTAINS with evidence → one re-review by the reviewer, carrying the argument → CONTINUE upholds the architect', async () => {
    const harness = build({ architect: [PLAN, MAINTAIN], reviewer: [PASS, MATERIAL, PASS, PASS] });
    await drain(harness);

    const reviewer = harness.adapters.get('reviewer-adapter')!.dispatches.map((dispatch) => dispatch.taskId);
    expect(reviewer).toContain(RE_REVIEW);
    const handoff = (await harness.store.brainEntriesForRun('run-1', 'prj-1')).find((entry) => entry.entryId === `brain:disagreement-rebuttal:${RE_REVIEW}`);
    expect(handoff!.taskIds, 'the argument reaches the re-review and nothing else').toEqual([RE_REVIEW]);
    expect(handoff!.text).toContain('The path is a symlink into the permitted workspace.');
    expect(handoff!.text).toContain('workspace/etc -> ./local-etc');

    const [disagreement] = disagreements(harness);
    expect(disagreement).toMatchObject({ resolution: 'ARCHITECT_UPHELD', resolutionBasis: 'RE_REVIEW_CONTINUED', architectPosition: 'MAINTAINS', reReviewTaskId: RE_REVIEW });
    expect(decisionsOn(harness, 'build-1')).toEqual(['ACCEPT:TASK_VERIFIED']);
    expect(harness.store.taskRow('repair:build-1:1:task'), 'nothing was repaired').toBeNull();
    expect(claimed(harness, 'deploy-1')).toBe(true);
    const reReview = requests(harness).find((request) => request.carrierTaskId === RE_REVIEW)!;
    expect(reReview).toMatchObject({ kind: 'REVIEW_REQUEST', targetRole: 'INDEPENDENT_REVIEWER', status: 'RESOLVED', transitionCode: 'DISAGREEMENT_ARCHITECT_UPHELD' });
    expect(await stateOf(harness)).toBe('COMPLETED');
  });
});

/**
 * THE RE-REVIEW IS ANSWERED BY THE ATTEMPT THAT WAS ACCEPTED (defect A's A-6). The verdict applied is
 * the accepted attempt's: the decision reads each task's rows reduced to the attempt its task row names.
 * The REVIEW_REQUEST's answer was the FIRST verdict row of the re-review across every attempt, so a row a
 * lost lease left behind was named as the answer to a question it did not decide.
 */
describe('A-6 — the re-review is answered by the attempt that was accepted', () => {
  /** Runs to the waiting re-review; an earlier process claims it, persists a FAILED verdict under that attempt, and loses the lease. */
  const aLostLeaseLeftAVerdict = async (harness: JuliusHarness): Promise<{ readonly lostGeneration: number; readonly stale: string }> => {
    for (let index = 0; index < 60 && harness.store.taskRow(RE_REVIEW)?.state !== 'RUNNABLE'; index += 1) {
      if (!(await step(harness))) break;
    }
    expect(harness.store.taskRow(RE_REVIEW)?.state, 'the re-review waits to be claimed').toBe('RUNNABLE');
    const now = harness.clock.now();
    const [lost] = await harness.store.claimRunnable({ owner: 'an-earlier-process', now, leaseExpiresAt: harness.clock.now(), limit: 1, projectId: 'prj-1' });
    expect(lost?.taskId).toBe(RE_REVIEW);
    const stale = `${RE_REVIEW}:${String(lost!.leaseGeneration)}:0`;
    expect(await harness.store.appendEvidence({
      runId: 'run-1', projectId: 'prj-1', idempotencyKey: `${RE_REVIEW}:${String(lost!.leaseGeneration)}:${stale}`,
      evidence: {
        evidenceId: stale, missionId: 'msn-1', taskId: RE_REVIEW, workerId: 'reviewer', type: 'REVIEW_FINDING', status: 'FAILED',
        safeSummary: 'The symlink escapes (an attempt whose lease was lost).', artifactRef: null, integrityHash: null, occurredAt: now,
      },
    })).toBe(true);
    expect(await harness.store.finishTask({ taskId: RE_REVIEW, owner: 'an-earlier-process', leaseGeneration: lost!.leaseGeneration, state: 'FAILED', now, nextAttemptAt: now })).toBe(true);
    return { lostGeneration: lost!.leaseGeneration, stale };
  };

  it('RED FIRST: a verdict row a lost lease left behind is not named as the answer, and decides nothing', async () => {
    const harness = build({ architect: [PLAN, MAINTAIN], reviewer: [PASS, MATERIAL, PASS, PASS] });
    const { lostGeneration } = await aLostLeaseLeftAVerdict(harness);
    await drain(harness);

    const accepted = harness.store.taskRow(RE_REVIEW)!;
    expect(accepted.leaseGeneration, 'the re-review was accepted on a later lease').toBeGreaterThan(lostGeneration);
    const own = `${RE_REVIEW}:${String(accepted.leaseGeneration)}:0`;
    expect((await harness.store.evidenceForRun('run-1', 'prj-1')).some((item) => item.evidenceId === own && item.type === 'REVIEW_FINDING')).toBe(true);
    const reReview = requests(harness).find((request) => request.carrierTaskId === RE_REVIEW)!;
    expect(reReview.responseRef, 'answered by the verdict that was applied').toBe(own);
    // The decision already read the accepted attempt: the stale FAILED verdict changed nothing but the answer.
    expect(disagreements(harness)[0]).toMatchObject({ resolution: 'ARCHITECT_UPHELD', resolutionBasis: 'RE_REVIEW_CONTINUED' });
    expect(decisionsOn(harness, 'build-1')).toEqual(['ACCEPT:TASK_VERIFIED']);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('DA1 shape: an accepted re-review that wrote no verdict row is answered by the task, never by the lost lease’s row', async () => {
    const silent: Step = { kind: 'succeed', evidence: [], reviewVerdict: { verdict: 'CONTINUE', claim: 'The symlink resolves inside the workspace.' } };
    const harness = build({ architect: [PLAN, MAINTAIN], reviewer: [PASS, MATERIAL, silent, PASS] });
    const { stale } = await aLostLeaseLeftAVerdict(harness);
    await drain(harness);

    expect((await harness.store.evidenceForRun('run-1', 'prj-1')).filter((item) => item.taskId === RE_REVIEW).map((item) => item.evidenceId),
      'the only verdict row is the lost lease’s').toEqual([stale]);
    const reReview = requests(harness).find((request) => request.carrierTaskId === RE_REVIEW)!;
    expect(reReview.responseRef, 'the latest attempt WITH a row is the lost one: only the task row names the accepted attempt').toBe(RE_REVIEW);
  });
});

describe('P10 — the rebuttal is bounded', () => {
  it.each([
    ['challenges again', verdict({ verdict: 'CHALLENGE', category: 'contract_drift', target: 'plan', claim: 'The symlink is itself outside the paths.' }), 'RE_REVIEW_MAINTAINED'],
    ['requires repair', { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The symlink escapes.' }] } as Step, 'RE_REVIEW_MAINTAINED'],
  ])('a re-review that %s resolves the disagreement: one rebuttal, one re-review, no second disagreement, no repair of the argument', async (_label, reReview, basis) => {
    const harness = build({ architect: [PLAN, MAINTAIN, PLAN, PLAN], reviewer: [PASS, MATERIAL, reReview, PASS, PASS, PASS] });
    await drain(harness);

    expect(disagreements(harness)).toHaveLength(1);
    expect(disagreements(harness)[0]).toMatchObject({ resolution: 'CHALLENGE_UPHELD', resolutionBasis: basis });
    const all = await harness.store.tasksForRun('run-1', 'prj-1');
    expect(all.filter((row) => row.taskType === 'rebuttal').map((row) => row.taskId)).toEqual([REBUTTAL]);
    expect(all.filter((row) => row.taskType === 'review:rebuttal').map((row) => row.taskId)).toEqual([RE_REVIEW]);
    expect(all.some((row) => row.taskId.startsWith('repair:rebuttal')), 'the argument is never repaired').toBe(false);
    expect(requests(harness).filter((request) => request.kind === 'REBUTTAL_REQUEST')).toHaveLength(1);
    expect(decisionsOn(harness, 'build-1')[0], 'the upheld challenge repairs the work').toMatch(/^REPAIR:/u);

    // Replaying the run's idle sweeps moves the record nowhere.
    const steps = log(harness).filter((event) => event.type === 'disagreement.step').length;
    for (let index = 0; index < 3; index += 1) await harness.loop.advanceRun('run-1', 'prj-1');
    expect(log(harness).filter((event) => event.type === 'disagreement.step')).toHaveLength(steps);
  });

  it('a second rebuttal is refused by the record itself', async () => {
    const harness = build({ architect: [PLAN, MAINTAIN], reviewer: [PASS, MATERIAL, PASS, PASS] });
    await drain(harness);
    const [resolved] = disagreements(harness);
    const replayed = foldJuliusDisagreements([
      ...rows(harness),
      { type: 'disagreement.step', facts: { disagreementId: resolved!.disagreementId, step: 'REBUTTAL_SCHEDULED', rebuttalTaskId: 'rebuttal:again:task', at: 't' } },
      { type: 'disagreement.step', facts: { disagreementId: resolved!.disagreementId, step: 'RE_REVIEW', verdict: 'BLOCK', at: 't' } },
    ]);
    expect(replayed).toEqual(disagreements(harness));
  });
});

describe('the other ways a disagreement ends', () => {
  it('MAINTAINS that a mission-owned term must change: ESCALATED, the work halts, the contract is untouched', async () => {
    const harness = build({
      architect: [PLAN, rebut({ position: 'MAINTAINS', argument: 'The permitted paths are wrong for this mission.', evidence: [{ locator: 'mission contract', claim: 'The paths exclude the config root.' }], missionTermsMustChange: true })],
      reviewer: [PASS, MATERIAL, PASS],
    });
    await drain(harness);
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(disagreements(harness)[0]).toMatchObject({ resolution: 'ESCALATED', resolutionBasis: 'MISSION_TERMS_MUST_CHANGE', reReviewTaskId: null });
    expect(decisionsOn(harness, 'build-1')).toEqual(['HALT:DISAGREEMENT_ESCALATED']);
    expect(claimed(harness, 'deploy-1')).toBe(false);
    expect(contract!.state).toBe('LOCKED');
    expect(await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' })).toHaveLength(1);
    expect(await stateOf(harness)).not.toBe('COMPLETED');
  });

  it.each([
    ['maintains with nothing to cite', { position: 'MAINTAINS', argument: 'I am right.' }, 'rebuttal_maintains_without_evidence'],
    ['declares the work verified', { position: 'MAINTAINS', argument: 'x', evidence: [{ locator: 'a', claim: 'b' }], status: 'VERIFIED' }, 'peer_response_mints_julius_only_outcome'],
    ['reaches for the budget', { position: 'CONCEDES', argument: 'x', budget: 5 }, 'peer_response_mutates_protected_term'],
  ])('a rebuttal that %s is unusable: the challenge stands, and the refusal says why', async (_label, value, reasonCode) => {
    const harness = build({ architect: [PLAN, rebut(value)], reviewer: [PASS, MATERIAL, PASS, PASS] });
    await drain(harness);
    expect(disagreements(harness)[0]).toMatchObject({ resolution: 'CHALLENGE_UPHELD', resolutionBasis: 'REBUTTAL_UNUSABLE', architectPosition: null });
    const refusal = log(harness).find((event) => event.type === 'disagreement.step' && event.facts.step === 'REBUTTAL');
    expect(refusal!.facts.rebuttalRefusal).toBe(reasonCode);
    expect(decisionsOn(harness, 'build-1')[0]).toMatch(/^REPAIR:/u);
  });

  it('nobody can write a rebuttal: resolved at once by Julius, no task minted, the work repaired', async () => {
    const harness = build({ architect: [PLAN], reviewer: [PASS, MATERIAL, PASS, PASS] }, { rebuttalRoutable: false });
    await drain(harness);
    expect(disagreements(harness)[0]).toMatchObject({ resolution: 'CHALLENGE_UPHELD', resolutionBasis: 'REBUTTAL_UNROUTABLE', rebuttalTaskId: null });
    expect(harness.store.taskRow(REBUTTAL)).toBeNull();
    expect(decisionsOn(harness, 'build-1')[0]).toMatch(/^REPAIR:/u);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('a re-review that BLOCKS halts the work', async () => {
    const harness = build({
      architect: [PLAN, MAINTAIN],
      reviewer: [PASS, MATERIAL, verdict({ verdict: 'BLOCK', category: 'unsafe_implementation', claim: 'The symlink lets the build overwrite host files.' })],
    });
    await drain(harness);
    expect(disagreements(harness)[0]).toMatchObject({ resolution: 'CHALLENGE_UPHELD', resolutionBasis: 'RE_REVIEW_BLOCKED' });
    expect(decisionsOn(harness, 'build-1')).toEqual(['HALT:REVIEW_BLOCKED']);
    expect(claimed(harness, 'deploy-1')).toBe(false);
  });

  it('a challenge that is not material is argued while the work proceeds, and its resolution reopens nothing', async () => {
    const harness = build({ architect: [PLAN, CONCEDE], reviewer: [PASS, MINOR, PASS] });
    await drain(harness);
    const [disagreement] = disagreements(harness);
    expect(disagreement).toMatchObject({ material: false, resolution: 'CHALLENGE_UPHELD', resolutionBasis: 'ARCHITECT_CONCEDED' });
    expect(decisionsOn(harness, 'build-1')).toEqual(['ACCEPT:TASK_VERIFIED']);
    const accepted = log(harness).findIndex((event) => event.type === 'verification.decided' && event.taskId === 'build-1');
    const resolved = log(harness).findIndex((event) => event.type === 'disagreement.resolved');
    expect(accepted, 'the work was decided before the argument ended').toBeLessThan(resolved);
    expect(requests(harness).find((request) => request.kind === 'REBUTTAL_REQUEST')).toMatchObject({ mandatory: false, pausedTaskIds: [] });
    expect(harness.store.taskRow('repair:build-1:1:task')).toBeNull();
    expect(await stateOf(harness)).toBe('COMPLETED');
  });
});

describe('the peers, while they disagree', () => {
  it('the architect is checking alignment while its rebuttal is owed, and the reviewer is challenging', async () => {
    const harness = build({ architect: [PLAN, MAINTAIN], reviewer: [PASS, MATERIAL, PASS, PASS] });
    const seen = new Set<string>();
    for (let index = 0; index < 60; index += 1) {
      const view = await readJuliusPeerChannel({ timeline: harness.store, tasks: await harness.store.tasksForRun('run-1', 'prj-1'), runId: 'run-1', projectId: 'prj-1' });
      seen.add(`${view!.architect}/${view!.reviewer}`);
      if (!(await step(harness))) break;
    }
    expect(seen).toContain('CHECKING_ALIGNMENT/CHALLENGING');
    expect([...seen].some((state) => state.endsWith('/REVIEWING_REPAIR')), 'the re-review is a review of the argument').toBe(true);
  });
});

describe('P16 — two disagreements cannot share identity across workflow attempts', () => {
  it('the same challenge in two attempts of one run is two records', async () => {
    const first = build({ architect: [PLAN, CONCEDE], reviewer: [PASS, MATERIAL, PASS, PASS] }, { executionScope: 'gh-34995797200.1' });
    const second = build({ architect: [PLAN, CONCEDE], reviewer: [PASS, MATERIAL, PASS, PASS] }, { executionScope: 'gh-34995797200.2' });
    await drain(first);
    await drain(second);
    const a = disagreements(first)[0]!;
    const b = disagreements(second)[0]!;
    expect(a.subjectTaskId).toBe(b.subjectTaskId);
    expect(a.reviewTaskId).toBe(b.reviewTaskId);
    expect(a.disagreementId).toBe('disagreement:gh-34995797200.1:build-1:review');
    expect(b.disagreementId).toBe('disagreement:gh-34995797200.2:build-1:review');
    // Folded together, as an archive holding both attempts would read them, they stay two.
    expect(foldJuliusDisagreements([...rows(first), ...rows(second)])).toHaveLength(2);
  });
});
