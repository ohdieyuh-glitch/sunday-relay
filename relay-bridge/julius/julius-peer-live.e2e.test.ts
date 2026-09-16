/**
 * THE PEER CHANNEL, VERDICTS AND DISAGREEMENT ON THE LIVE COMPOSITION, WITH NO SPEND.
 *
 * `assembleLiveJuliusRuntime` with the production worker registrations; only the
 * provider adapters are scripted. What this holds is the part a kernel harness
 * cannot: that the live composition — which registers no rebuttal charter for
 * the Prompt Architect yet — resolves a material challenge by Julius's rule
 * instead of holding the mission forever, that the execution scope the
 * entrypoint passes reaches every peer id, and that a reviewer's WARNING is
 * retained on the durable record.
 */

import { describe, expect, it } from 'vitest';

import {
  createJuliusMemoryStore,
  foldJuliusDisagreements,
  foldJuliusPeerRequests,
  scriptedAdapter,
  seedJuliusTaskContract,
  type JuliusProviderAdapter,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
  type ScriptedOutcome,
} from '../../src/relay/mission/julius';
import {
  architectWorker,
  CODER_WORKER,
  assembleLiveJuliusRuntime,
  createContextAndClaimHandoffs,
  driveJuliusRunToTerminal,
  reviewerWorker,
} from './live-composition';

const RUN = 'run-peers';
const PROJECT = 'prj-peers';
const MISSION = 'mission-peers';
const REVIEWER_WORKER = reviewerWorker('hermes');

const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];

function seed(store: ReturnType<typeof createJuliusMemoryStore>): void {
  store.seedRun({
    runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'READY',
    cardRevision: 'card-peers', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  store.seedTask(RUN, {
    taskId: 'plan-1', missionId: MISSION, parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE',
  });
  store.seedTask(RUN, {
    taskId: 'build-1', missionId: MISSION, parentTaskId: null, dependencyIds: ['plan-1'],
    requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
  });
  const seeded = seedJuliusTaskContract({
    runId: RUN, taskId: 'build-1', missionContractRevision: 1,
    objective: 'Build the module the plan describes.',
    requirements: ['Do the work.'], constraints: ['Touch only the module.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The suite passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 20, repairCycles: 2, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-09-15T00:00:00.000Z' });
  store.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: [] }]);
  store.seedBrain(RUN, [{
    entryId: 'brain-objective', kind: 'OBJECTIVE', text: 'OBJECTIVE: build the module.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

function byTask(worker: Parameters<typeof scriptedAdapter>[0], pick: (taskId: string, taskType: string | undefined) => ScriptedOutcome) {
  const dispatches: string[] = [];
  const adapter: JuliusProviderAdapter = {
    adapterId: worker.adapterId,
    async dispatch(input) {
      dispatches.push(input.taskId);
      return scriptedAdapter(worker, [pick(input.taskId, input.taskType)]).dispatch(input);
    },
  };
  return { adapter, dispatches };
}

async function drive(
  buildReview: (round: number) => ScriptedOutcome,
  answers: { readonly rebuttal?: unknown; readonly reReview?: ScriptedOutcome } = {},
) {
  const memory = createJuliusMemoryStore();
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  seed(memory);
  let buildReviews = 0;
  const architect = byTask(architectWorker({}), (_taskId, taskType) => (taskType === 'rebuttal'
    ? { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null, ...(answers.rebuttal === undefined ? {} : { rebuttal: answers.rebuttal }) }
    : { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null }));
  const coder = byTask(CODER_WORKER, () => ({ kind: 'succeed', evidence: BUILD_EVIDENCE, usdMicros: 100_000 }));
  const reviewer = byTask(REVIEWER_WORKER, (_taskId, taskType) => {
    if (taskType === 'review:plan') return { kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null };
    if (taskType === 'review:rebuttal') return answers.reReview ?? { kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null };
    buildReviews += 1;
    return buildReview(buildReviews);
  });
  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store,
    entries: [
      { worker: architectWorker({}), adapter: architect.adapter },
      { worker: CODER_WORKER, adapter: coder.adapter },
      { worker: REVIEWER_WORKER, adapter: reviewer.adapter },
    ],
    cardRevision: 'card-peers', spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 2,
    executionScope: 'gh-35000000001.2',
  });
  const outcome = await driveJuliusRunToTerminal({ loop: runtime.loop, store: handoffs.store, runId: RUN, projectId: PROJECT, verification: runtime.verification });
  const rows: { type: string; facts: Record<string, string | number | boolean | null>; taskId: string | null }[] = [];
  let sinceSequence = 0;
  for (;;) {
    const page = await memory.timeline({ runId: RUN, projectId: PROJECT, sinceSequence, limit: 500 });
    rows.push(...page.entries.map((entry) => ({ type: entry.type, facts: { ...entry.facts }, taskId: entry.taskId })));
    if (page.entries.length === 0 || !page.hasMore) break;
    sinceSequence = Math.max(...page.entries.map((entry) => entry.sequence));
  }
  return { outcome, rows, memory, architect, reviewer };
}

describe('the live composition and the peer protocol', () => {
  const CHALLENGE: ScriptedOutcome = {
    kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null,
    reviewVerdict: { verdict: 'CHALLENGE', category: 'missed_acceptance_criterion', target: 'work', claim: 'AC-1 is not exercised by any test.' },
  };
  const challengeThenPass = (round: number): ScriptedOutcome => (round === 1 ? CHALLENGE : { kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null });

  it('the architect answers a live challenge: MAINTAINS with evidence, the reviewer re-reviews once, Julius upholds the architect', async () => {
    const { outcome, rows, memory, architect, reviewer } = await drive(challengeThenPass, {
      rebuttal: {
        position: 'MAINTAINS',
        argument: 'AC-1 is exercised: the suite asserts the rendered output, not only the exit code.',
        evidence: [{ locator: 'tests/render.spec.ts:44', claim: 'The assertion covers the rendered field AC-1 names.' }],
        missionTermsMustChange: false,
      },
    });

    expect(outcome.state).toBe('COMPLETED');
    // The architect was actually asked, through the live composition's own
    // registration: PR #270 could not ask at all.
    expect(architect.dispatches).toContain('rebuttal:build-1:review:task');
    expect(reviewer.dispatches, 'and the challenge was judged once more, independently')
      .toContain('rebuttal:build-1:review:task:review');
    const [disagreement] = foldJuliusDisagreements(rows);
    expect(disagreement).toMatchObject({
      disagreementId: 'disagreement:gh-35000000001.2:build-1:review', material: true,
      architectPosition: 'MAINTAINS', resolution: 'ARCHITECT_UPHELD', resolutionBasis: 'RE_REVIEW_CONTINUED',
      rebuttalTaskId: 'rebuttal:build-1:review:task', reReviewTaskId: 'rebuttal:build-1:review:task:review',
    });
    expect(disagreement!.architectEvidence.map((item) => item.locator)).toEqual(['tests/render.spec.ts:44']);
    const requests = foldJuliusPeerRequests(rows);
    expect(requests.every((request) => request.requestId.includes(':gh-35000000001.2:')), 'every peer id carries the attempt').toBe(true);
    expect(requests.find((request) => request.kind === 'REBUTTAL_REQUEST')).toMatchObject({
      sourceRole: 'JULIUS', targetRole: 'PROMPT_ARCHITECT', status: 'RESOLVED', transitionCode: 'ARCHITECT_UPHELD',
    });
    // THE ARGUMENT IS PAID FOR, AND THE PAYMENT IS VISIBLE. Two dispatches —
    // the one rebuttal and the one re-review — counted beyond the planned path
    // and named as disagreement work in the drive's own account.
    expect(outcome.tickAccount).toMatchObject({ disagreementTicks: 2, exhausted: false });
    expect(outcome.tickAccount!.allowance).toBe(outcome.tickAccount!.plannedTicks + outcome.tickAccount!.beyondMainPath + outcome.tickAccount!.retries);
    expect(outcome.tickAccount!.beyondMainPath).toBeGreaterThanOrEqual(2);

    const decisions = await memory.decisionsForRun(RUN, PROJECT);
    expect(decisions.filter((row) => row.taskId === 'build-1').map((row) => row.action), 'the work was accepted, not repaired').toEqual(['ACCEPT']);
    expect((await memory.tasksForRun(RUN, PROJECT)).some((task) => task.taskId.startsWith('repair:'))).toBe(false);
  });

  it('a live architect that CONCEDES upholds the challenge, and the work is repaired', async () => {
    const { outcome, rows, memory, architect } = await drive(challengeThenPass, {
      rebuttal: { position: 'CONCEDES', argument: 'The reviewer is right: no test covers AC-1.', evidence: [], missionTermsMustChange: false },
    });
    expect(outcome.state).toBe('COMPLETED');
    expect(architect.dispatches).toContain('rebuttal:build-1:review:task');
    const [disagreement] = foldJuliusDisagreements(rows);
    expect(disagreement).toMatchObject({ architectPosition: 'CONCEDES', resolution: 'CHALLENGE_UPHELD', resolutionBasis: 'ARCHITECT_CONCEDED', reReviewTaskId: null });
    const decisions = await memory.decisionsForRun(RUN, PROJECT);
    expect(decisions.filter((row) => row.taskId === 'build-1').map((row) => row.action)).toEqual(['REPAIR']);
    expect(decisions.find((row) => row.taskId === 'repair:build-1:1:task')?.action).toBe('ACCEPT');
  });

  it('a live rebuttal the domain cannot use resolves against the architect, and the mission still finishes', async () => {
    // MAINTAINS with nothing to cite. The adapter corrects once and then refuses
    // the dispatch; Julius resolves the disagreement on the challenge it has.
    const { outcome, rows } = await drive(challengeThenPass, {
      rebuttal: { position: 'MAINTAINS', argument: 'I am right.', evidence: [], missionTermsMustChange: false },
    });
    expect(outcome.state).toBe('COMPLETED');
    const [disagreement] = foldJuliusDisagreements(rows);
    expect(disagreement).toMatchObject({ resolution: 'CHALLENGE_UPHELD', architectPosition: null });
    expect(['REBUTTAL_UNUSABLE', 'REBUTTAL_UNROUTABLE']).toContain(disagreement!.resolutionBasis);
  });

  it('a WARNING is retained on the durable record and the mission completes without a repair', async () => {
    const { outcome, memory } = await drive(() => ({
      kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null,
      reviewVerdict: { verdict: 'WARNING', claim: 'Accepted.', warnings: [{ category: 'superficial_test', claim: 'The test asserts only the exit code.' }] },
    }));
    expect(outcome.state).toBe('COMPLETED');
    const findings = await memory.findingsForRun(RUN, PROJECT);
    expect(findings.map((finding) => [finding.taskId, finding.category, finding.blocking, finding.status]))
      .toEqual([['build-1', 'superficial_test', false, 'OPEN']]);
    expect((await memory.tasksForRun(RUN, PROJECT)).some((task) => task.taskId.startsWith('repair:'))).toBe(false);
  });
});
