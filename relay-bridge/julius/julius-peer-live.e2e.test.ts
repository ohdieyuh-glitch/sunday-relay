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

async function drive(buildReview: (round: number) => ScriptedOutcome) {
  const memory = createJuliusMemoryStore();
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  seed(memory);
  let buildReviews = 0;
  const architect = byTask(architectWorker({}), () => ({ kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null }));
  const coder = byTask(CODER_WORKER, () => ({ kind: 'succeed', evidence: BUILD_EVIDENCE, usdMicros: 100_000 }));
  const reviewer = byTask(REVIEWER_WORKER, (_taskId, taskType) => {
    if (taskType === 'review:plan') return { kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null };
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
  return { outcome, rows, memory, architect };
}

describe('the live composition and the peer protocol', () => {
  it('a material challenge nobody can rebut yet is resolved by Julius, repaired, and the mission completes', async () => {
    const { outcome, rows, memory, architect } = await drive((round) => (round === 1
      ? { kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null, reviewVerdict: { verdict: 'CHALLENGE', category: 'missed_acceptance_criterion', target: 'work', claim: 'AC-1 is not exercised by any test.' } }
      : { kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null }));

    expect(outcome.state).toBe('COMPLETED');
    const [disagreement] = foldJuliusDisagreements(rows);
    expect(disagreement).toMatchObject({
      disagreementId: 'disagreement:gh-35000000001.2:build-1:review', material: true,
      resolution: 'CHALLENGE_UPHELD', resolutionBasis: 'REBUTTAL_UNROUTABLE', rebuttalTaskId: null,
    });
    expect(architect.dispatches.some((taskId) => taskId.startsWith('rebuttal:')), 'no rebuttal was dispatched to an architect with no charter for one').toBe(false);
    const requests = foldJuliusPeerRequests(rows);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.requestId.includes(':gh-35000000001.2:')), 'every peer id carries the attempt').toBe(true);
    expect(requests.find((request) => request.kind === 'CHALLENGE')).toMatchObject({ status: 'RESOLVED', transitionCode: 'CHALLENGE_UPHELD', mandatory: true });
    const decisions = await memory.decisionsForRun(RUN, PROJECT);
    expect(decisions.filter((row) => row.taskId === 'build-1').map((row) => row.action)).toEqual(['REPAIR']);
    expect(decisions.find((row) => row.taskId === 'repair:build-1:1:task')?.action).toBe('ACCEPT');
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
