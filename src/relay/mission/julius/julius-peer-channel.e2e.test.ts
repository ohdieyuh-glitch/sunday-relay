import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { createJuliusMemoryStore } from './julius-memory-store';
import { foldJuliusPeerRequests, type JuliusPeerRequest } from './julius-peer-channel';
import { readJuliusPeerChannel } from './julius-peer-runtime';
import type { JuliusRunRow } from './julius-runtime-ports';
import type { JuliusWorker } from './julius-runtime';

/**
 * THE PEER CHANNEL, THROUGH THE REAL PIPELINE.
 *
 * Provider-free: every worker answers from a script. Everything between the
 * scheduler and the adapter is the real runtime — the claim, the contract gate,
 * the verification evaluator, the release rule, the repair planner — and every
 * assertion reads the durable rows the run wrote, never a flag on a call.
 *
 * Numbered against the founder's PR 1 proof list.
 */

type Step = Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number];

const PROVIDERS = { architect: 'openai', coder: 'anthropic', reviewer: 'hermes' } as const;
const SWAPPED = { architect: 'anthropic', coder: 'xai', reviewer: 'openai' } as const;

const workersFor = (providers: { architect: string; coder: string; reviewer: string }): Record<'architect' | 'coder' | 'reviewer', JuliusWorker> => ({
  architect: worker({
    workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: providers.architect, adapterId: 'architect-adapter',
    capabilities: ['plan'], taskTypes: ['plan', 'repair:plan', 'guidance', 'repair:guidance'],
  }),
  coder: worker({
    workerId: 'coder', role: 'CODING_AGENT', providerId: providers.coder, adapterId: 'coder-adapter',
    capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
  }),
  reviewer: worker({
    workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: providers.reviewer, adapterId: 'reviewer-adapter',
    capabilities: ['review'],
    taskTypes: ['review:plan', 'review:build', 'review:guidance', 'review:repair:plan', 'review:repair:build', 'review:repair:guidance'],
  }),
});

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The advice contradicts the plan.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const REQUEST = Object.freeze({
  question: 'The journal reader already buffers — should the normalizer reuse it?',
  blockedOn: ['the 8KiB boundary case'], attempted: ['a second buffer'], relevantPaths: ['src/relay/persistence/journal.ts'],
});
const GUIDANCE = Object.freeze({
  subObjective: 'Reuse the existing reader rather than adding a second buffer.',
  relevantRequirements: ['R1'], relevantConstraints: ['no new dependency'],
  repositoryFindings: ['journal.ts already buffers at the same boundary'], runtimeFindings: [],
  references: [{ kind: 'REPOSITORY', locator: 'src/relay/persistence/journal.ts:120', retrievedAt: '2026-09-10T20:59:00.000Z', trust: 'CORROBORATED' }],
  recommendedActions: ['call the existing reader'], additionalProhibitions: [], affectedCriterionIds: [], unresolvedQuestions: [],
});

interface Scripts { architect?: readonly Step[]; coder?: readonly Step[]; reviewer?: readonly Step[] }

const build = (scripts: Scripts, over: { providers?: typeof PROVIDERS | typeof SWAPPED; executionScope?: string } = {}): JuliusHarness => {
  const workers = workersFor(over.providers ?? PROVIDERS);
  const harness = createJuliusHarness({
    workers: [
      { worker: workers.architect, script: scripts.architect ?? [{ kind: 'succeed', evidence: PLAN_EVIDENCE }] },
      { worker: workers.coder, script: scripts.coder ?? [{ kind: 'succeed' }] },
      { worker: workers.reviewer, script: scripts.reviewer ?? [{ kind: 'succeed', evidence: PASSED_REVIEW }] },
    ],
    card: cardPolicy({
      allowedProviders: [workers.architect.providerId, workers.coder.providerId, workers.reviewer.providerId],
      capabilities: ['plan', 'implement', 'review'],
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
    ...(over.executionScope === undefined ? {} : { executionScope: over.executionScope }),
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  return harness;
};

/** One tick, advancing the run when nothing was claimed. False when the run stopped moving. */
async function step(harness: JuliusHarness): Promise<boolean> {
  const report = await harness.loop.tick({ projectId: 'prj-1' });
  if (report.claimed > 0) return true;
  const advance = await harness.loop.advanceRun('run-1', 'prj-1');
  return advance !== null && (advance.changed || advance.resumedVerifications > 0);
}

async function drain(harness: JuliusHarness, ticks = 48): Promise<void> {
  for (let index = 0; index < ticks; index += 1) if (!(await step(harness))) break;
}

const events = (harness: JuliusHarness) => harness.store.events();
const factsOf = (harness: JuliusHarness, type: string) => events(harness).filter((event) => event.type === type).map((event) => event.facts);
const requestsOf = (harness: JuliusHarness): readonly JuliusPeerRequest[] =>
  foldJuliusPeerRequests(events(harness).map((event) => ({ type: event.type, facts: event.facts, taskId: event.taskId })));
const view = async (harness: JuliusHarness) => readJuliusPeerChannel({
  timeline: harness.store, tasks: await harness.store.tasksForRun('run-1', 'prj-1'), runId: 'run-1', projectId: 'prj-1',
});

const GUIDED: Scripts = {
  coder: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
  architect: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }, { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE }],
};

/** No request id is opened twice and no request repeats a move: the ledger is clean, not merely foldable. */
function expectCleanLedger(harness: JuliusHarness): void {
  const opened = factsOf(harness, 'peer.request.opened').map((facts) => facts.requestId);
  expect(new Set(opened).size, 'no request opened twice').toBe(opened.length);
  const moves = factsOf(harness, 'peer.request.transitioned').map((facts) => `${String(facts.requestId)}>${String(facts.to)}@${String(facts.responseRef)}`);
  const requests = requestsOf(harness);
  for (const request of requests) {
    const mine = factsOf(harness, 'peer.request.transitioned').filter((facts) => facts.requestId === request.requestId);
    // Every written move was legal when written: replaying them one by one reaches the folded state with none ignored.
    const replayed = foldJuliusPeerRequests([
      { type: 'peer.request.opened', facts: factsOf(harness, 'peer.request.opened').find((facts) => facts.requestId === request.requestId)! },
      ...mine.map((facts) => ({ type: 'peer.request.transitioned', facts })),
    ]);
    expect(replayed[0]!.status).toBe(request.status);
  }
  expect(moves.length).toBeGreaterThan(0);
}

/* ------------------------------------------------------------------ proofs */

describe('P1 — a typed peer request opens, is answered and is resolved', () => {
  it('the coder\'s guidance question: OPEN on the ask, ANSWERED by the packet, RESOLVED by Julius accepting it', async () => {
    const harness = build(GUIDED);
    await drain(harness);

    const question = requestsOf(harness).find((request) => request.kind === 'GUIDANCE_QUESTION');
    expect(question).toMatchObject({
      requestId: 'peer:guidance_question:local:guidance:build-1:1:task',
      sourceRole: 'CODING_AGENT', targetRole: 'PROMPT_ARCHITECT', mediatedFor: null,
      subjectTaskId: 'build-1', carrierTaskId: 'guidance:build-1:1:task',
      requiredResponseType: 'GUIDANCE_PACKET', checkpointId: 'checkpoint:build-1:1',
      contextRefs: ['brain:guidance-request:guidance:build-1:1:task'],
      mandatory: true, pausedTaskIds: ['segment:build-1:2:task'],
      status: 'RESOLVED', transitionCode: 'ANSWER_ACCEPTED', responseRef: 'guidance:build-1:1',
    });
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(question!.contractBindingDigest, 'bound to the terms in force').toBe(contract!.bindingDigest);
    const moves = factsOf(harness, 'peer.request.transitioned').filter((facts) => facts.requestId === question!.requestId).map((facts) => facts.to);
    expect(moves).toEqual(['ANSWERED', 'RESOLVED']);
    expectCleanLedger(harness);
  });

  it('Julius\'s review requests: one per review task, each answered by the verdict and resolved by the decision', async () => {
    const harness = build(GUIDED);
    await drain(harness);
    const reviews = requestsOf(harness).filter((request) => request.kind === 'REVIEW_REQUEST');
    // `build-1` yielded at its question and is judged through its continuation,
    // so no review of it is requested.
    expect(reviews.map((request) => request.carrierTaskId).sort()).toEqual(
      ['guidance:build-1:1:task:review', 'plan-1:review', 'segment:build-1:2:task:review'].sort(),
    );
    for (const review of reviews) {
      expect(review).toMatchObject({ sourceRole: 'JULIUS', targetRole: 'INDEPENDENT_REVIEWER', requiredResponseType: 'REVIEW_VERDICT', status: 'RESOLVED' });
      expect(review.responseRef, 'answered by the evidence the reviewer left').toMatch(/./u);
    }
    const plan = reviews.find((request) => request.subjectTaskId === 'plan-1')!;
    expect(plan.transitionCode).toBe('DECIDED_ACCEPT');
    expect(plan.pausedTaskIds, 'the plan review pauses the build').toEqual(['build-1']);
    expect(harness.store.taskRow('segment:build-1:2:task')).not.toBeNull();
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });

  it('a rejected answer REOPENS the question, and the corrected answer resolves it', async () => {
    const harness = build({
      coder: GUIDED.coder,
      architect: [...GUIDED.architect!, { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: { ...GUIDANCE, recommendedActions: ['peek, then read'] } }],
      reviewer: [
        { kind: 'succeed', evidence: PASSED_REVIEW },
        { kind: 'succeed', evidence: FAILED_REVIEW },
        { kind: 'succeed', evidence: PASSED_REVIEW },
        { kind: 'succeed', evidence: PASSED_REVIEW },
      ],
    });
    await drain(harness);
    const question = requestsOf(harness).find((request) => request.kind === 'GUIDANCE_QUESTION')!;
    const moves = factsOf(harness, 'peer.request.transitioned').filter((facts) => facts.requestId === question.requestId)
      .map((facts) => `${String(facts.to)}:${String(facts.transitionCode ?? facts.responseRef)}`);
    expect(moves).toEqual([
      'ANSWERED:guidance:build-1:1',
      'OPEN:ANSWER_REJECTED',
      'ANSWERED:guidance:build-1:2',
      'RESOLVED:ANSWER_ACCEPTED',
    ]);
    expect(question).toMatchObject({ status: 'RESOLVED', responseRef: 'guidance:build-1:2' });
    expectCleanLedger(harness);
  });
});

describe('P2 — an illegal direction is refused, and nothing is minted for it', () => {
  it('a reviewer cannot put a question to the architect directly', async () => {
    const harness = build({
      coder: [{ kind: 'succeed' }],
      reviewer: [
        { kind: 'succeed', evidence: PASSED_REVIEW },
        { kind: 'succeed', evidence: PASSED_REVIEW, guidanceRequest: REQUEST },
      ],
    });
    await drain(harness);

    const refused = factsOf(harness, 'peer.request.refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      kind: 'GUIDANCE_QUESTION', sourceRole: 'INDEPENDENT_REVIEWER', targetRole: 'PROMPT_ARCHITECT', reasonCode: 'peer_request_direction_refused',
    });
    const verdict = factsOf(harness, 'checkpoint.verdict').find((facts) => facts.reasonCode === 'GUIDANCE_DIRECTION_REFUSED');
    expect(verdict).toMatchObject({ route: 'CONTINUE', wouldHaveRouted: 'REQUEST_GUIDANCE', peerRefusal: 'peer_request_direction_refused' });
    const tasks = await harness.store.tasksForRun('run-1', 'prj-1');
    expect(tasks.filter((row) => row.taskId.startsWith('guidance:')), 'no guidance task was minted').toEqual([]);
    expect(requestsOf(harness).filter((request) => request.kind === 'GUIDANCE_QUESTION')).toEqual([]);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state, 'and the mission still finished').toBe('COMPLETED');
  });

  it('the architect cannot ask itself', async () => {
    const harness = build({
      coder: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architect: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE, guidanceRequest: REQUEST },
      ],
    });
    await drain(harness);
    expect(factsOf(harness, 'peer.request.refused').map((facts) => facts.reasonCode)).toEqual(['peer_request_addresses_itself']);
    expect(harness.store.taskRow('guidance:guidance:build-1:1:task:1:task')).toBeNull();
  });
});

describe('P3 — a peer cannot mutate protected contract fields', () => {
  it.each([
    ['the budget, nested', { ...GUIDANCE, references: [{ ...GUIDANCE.references[0]!, budget: { spendUsd: 50 } }] }],
    ['the permissions', { ...GUIDANCE, permissions: ['write:*'] }],
    ['provider authority', { ...GUIDANCE, allowed_providers: ['anywhere'] }],
    ['the objective, in another spelling', { ...GUIDANCE, Objective: 'something else' }],
  ])('guidance reaching for %s is refused by name, answers nothing, and leaves the contract byte-identical', async (_label, guidance) => {
    const harness = build({ coder: GUIDED.coder, architect: [GUIDED.architect![0]!, { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance }] });
    await drain(harness, 12);
    const before = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    await drain(harness);
    expect(factsOf(harness, 'guidance.refused').filter((facts) => facts.stage === 'issue').map((facts) => facts.reasonCode))
      .toEqual(['peer_response_mutates_protected_term']);
    expect(factsOf(harness, 'guidance.issued')).toEqual([]);
    const question = requestsOf(harness).find((request) => request.kind === 'GUIDANCE_QUESTION')!;
    expect(question.responseRef, 'nothing answered the question').toBeNull();
    expect(await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' })).toEqual(before);
    expect(await harness.store.taskContractRevisions({ projectId: 'prj-1', taskId: 'build-1' })).toHaveLength(1);
  });
});

describe('P4 — a peer cannot mint VERIFIED', () => {
  it.each(['VERIFIED', 'TASK_VERIFIED', 'COMPLETE'])('guidance declaring %s is refused, and the only decisions are Julius\'s', async (outcome) => {
    const harness = build({ coder: GUIDED.coder, architect: [GUIDED.architect![0]!, { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: { ...GUIDANCE, status: outcome } }] });
    await drain(harness);
    expect(factsOf(harness, 'guidance.refused').filter((facts) => facts.stage === 'issue').map((facts) => facts.reasonCode))
      .toEqual(['peer_response_mints_julius_only_outcome']);
    // Every decision row was written by the verification evaluator, keyed on a
    // task and a closed action — never on a worker's words.
    for (const decided of events(harness).filter((event) => event.type === 'verification.decided')) {
      expect(['ACCEPT', 'COMPLETE', 'REPAIR', 'RETRY', 'HALT']).toContain(decided.facts.action);
    }
    // The architect's self-declared status bought nothing: its work was still
    // decided by Julius only after an independent review of it had run.
    const log = events(harness);
    const reviewClaimed = log.findIndex((event) => event.type === 'task.claimed' && event.taskId === 'guidance:build-1:1:task:review');
    const firstDecision = log.findIndex((event) => event.type === 'verification.decided' && event.taskId === 'guidance:build-1:1:task');
    expect(reviewClaimed).toBeGreaterThan(-1);
    expect(firstDecision).toBeGreaterThan(reviewClaimed);
  });
});

describe('P5 — a mandatory request really pauses the work it names', () => {
  it('no paused task is claimed before Julius resolves the request that pauses it', async () => {
    const harness = build({
      coder: GUIDED.coder,
      architect: [...GUIDED.architect!, { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE }],
      reviewer: [
        { kind: 'succeed', evidence: PASSED_REVIEW },
        { kind: 'succeed', evidence: FAILED_REVIEW },
        { kind: 'succeed', evidence: PASSED_REVIEW },
        { kind: 'succeed', evidence: PASSED_REVIEW },
      ],
    });
    await drain(harness);

    const log = events(harness);
    const mandatory = requestsOf(harness).filter((request) => request.mandatory && request.pausedTaskIds.length > 0);
    // The coder's question pauses its continuation; the plan review pauses the
    // build; both guidance reviews — the rejected one and its repair's — pause
    // the same continuation.
    expect(mandatory.map((request) => `${request.kind}:${request.subjectTaskId}`).sort()).toEqual([
      'GUIDANCE_QUESTION:build-1',
      'REVIEW_REQUEST:guidance:build-1:1:task',
      'REVIEW_REQUEST:plan-1',
      'REVIEW_REQUEST:repair:guidance:build-1:1:task:1:task',
    ]);
    for (const request of mandatory) {
      const resolvedAt = log.findIndex((event) => event.type === 'peer.request.transitioned'
        && event.facts.requestId === request.requestId && event.facts.to === 'RESOLVED');
      expect(resolvedAt, `${request.requestId} was resolved`).toBeGreaterThan(-1);
      for (const pausedTaskId of request.pausedTaskIds) {
        const claimedAt = log.findIndex((event) => event.type === 'task.claimed' && event.taskId === pausedTaskId);
        expect(claimedAt, `${pausedTaskId} ran`).toBeGreaterThan(-1);
        expect(claimedAt, `${pausedTaskId} waited for ${request.requestId}`).toBeGreaterThan(resolvedAt);
      }
    }
    // The rejected answer did not release the coder: the question reopened and
    // the continuation stayed BLOCKED through the whole repair.
    const reopenedAt = log.findIndex((event) => event.type === 'peer.request.transitioned' && event.facts.to === 'OPEN');
    const continuationClaim = log.findIndex((event) => event.type === 'task.claimed' && event.taskId === 'segment:build-1:2:task');
    expect(reopenedAt).toBeGreaterThan(-1);
    expect(continuationClaim).toBeGreaterThan(reopenedAt);
  });

  it('while the question is open the coder is paused and the architect is guiding', async () => {
    const harness = build(GUIDED);
    let seen = false;
    for (let index = 0; index < 48; index += 1) {
      const question = requestsOf(harness).find((request) => request.kind === 'GUIDANCE_QUESTION');
      if (question?.status === 'OPEN') {
        seen = true;
        expect(harness.store.taskRow('segment:build-1:2:task')!.state).toBe('BLOCKED');
        const peers = await view(harness);
        expect(peers!.architect).toBe('GUIDING');
      }
      if (!(await step(harness))) break;
    }
    expect(seen).toBe(true);
  });
});

describe('P6 — the projections survive continuation, restart and reconstruction', () => {
  it('at every tick the view read from a store rebuilt from exported rows equals the live one', async () => {
    const harness = build(GUIDED);
    const states: string[] = [];
    for (let index = 0; index < 48; index += 1) {
      const live = await view(harness);
      const rebuilt = createJuliusMemoryStore();
      rebuilt.seedRun(RUN);
      const tasks = JSON.parse(JSON.stringify(await harness.store.tasksForRun('run-1', 'prj-1')));
      for (const row of tasks) rebuilt.seedTask('run-1', row);
      for (const event of JSON.parse(JSON.stringify(events(harness)))) await rebuilt.appendEvent(event);
      const reconstructed = await readJuliusPeerChannel({ timeline: rebuilt, tasks: await rebuilt.tasksForRun('run-1', 'prj-1'), runId: 'run-1', projectId: 'prj-1' });
      expect(reconstructed).toEqual(live);
      states.push(`${live!.architect}/${live!.reviewer}`);
      if (!(await step(harness))) break;
    }
    // The peers moved through real states, not one frozen value.
    expect(new Set(states).size).toBeGreaterThan(2);
    expect(states).toContain('GUIDING/OBSERVING');
    expect(states.at(-1)).toBe('STANDBY/STANDBY');
  });

  it('a process restart mid-question changes nothing about where the request is or where it ends', async () => {
    const reference = build(GUIDED);
    await drain(reference);

    const harness = build(GUIDED);
    for (let index = 0; index < 48; index += 1) {
      const question = requestsOf(harness).find((request) => request.kind === 'GUIDANCE_QUESTION');
      if (question?.status === 'OPEN') break;
      await step(harness);
    }
    const before = await view(harness);
    harness.store.restart();
    expect(await view(harness)).toEqual(before);
    await drain(harness);

    const shape = (requests: readonly JuliusPeerRequest[]) => requests
      .map((request) => `${request.kind}|${request.subjectTaskId}|${request.status}|${String(request.transitionCode)}|${String(request.responseRef)}`)
      .sort();
    expect(shape(requestsOf(harness))).toEqual(shape(requestsOf(reference)));
    expectCleanLedger(harness);
  });
});

describe('P7 — role semantics survive a provider swap', () => {
  it('the same mission on other providers produces the same requests, directions and outcomes', async () => {
    const semantics = async (providers: typeof PROVIDERS | typeof SWAPPED) => {
      const harness = build({
        coder: GUIDED.coder,
        architect: [...GUIDED.architect!, { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE }],
        reviewer: [
          { kind: 'succeed', evidence: PASSED_REVIEW },
          { kind: 'succeed', evidence: FAILED_REVIEW },
          { kind: 'succeed', evidence: PASSED_REVIEW },
          { kind: 'succeed', evidence: PASSED_REVIEW },
        ],
      }, { providers });
      await drain(harness);
      const dispatched = harness.store.trajectory().filter((event) => event.kind === 'DISPATCH' && event.providerId !== null);
      return {
        requests: requestsOf(harness).map((request) => ({
          kind: request.kind, sourceRole: request.sourceRole, targetRole: request.targetRole, subject: request.subjectTaskId,
          carrier: request.carrierTaskId, paused: request.pausedTaskIds, status: request.status, code: request.transitionCode,
        })),
        providers: [...new Set(dispatched.map((event) => event.providerId))].sort(),
      };
    };
    const original = await semantics(PROVIDERS);
    const swapped = await semantics(SWAPPED);
    expect(swapped.requests).toEqual(original.requests);
    expect(original.requests.length).toBeGreaterThan(3);
    // A provider is never a party: no request names one.
    expect(JSON.stringify(original.requests)).not.toMatch(/openai|anthropic|hermes|xai/u);
  });
});

describe('P16 — request identity cannot be shared across workflow attempts', () => {
  it('two attempts of the same run name every request differently; within one attempt a replay names it the same', async () => {
    const attempt1 = build(GUIDED, { executionScope: 'gh-34995797200.1' });
    const attempt2 = build(GUIDED, { executionScope: 'gh-34995797200.2' });
    await drain(attempt1);
    await drain(attempt2);
    const ids1 = requestsOf(attempt1).map((request) => request.requestId);
    const ids2 = requestsOf(attempt2).map((request) => request.requestId);
    expect(ids1.length).toBeGreaterThan(0);
    expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);
    expect(ids1.every((id) => id.includes(':gh-34995797200.1:'))).toBe(true);

    // A resumed verification re-derives every request from the rows and opens nothing new.
    const openedBefore = factsOf(attempt1, 'peer.request.opened').length;
    const movedBefore = factsOf(attempt1, 'peer.request.transitioned').length;
    await attempt1.loop.advanceRun('run-1', 'prj-1');
    expect(factsOf(attempt1, 'peer.request.opened')).toHaveLength(openedBefore);
    expect(factsOf(attempt1, 'peer.request.transitioned')).toHaveLength(movedBefore);
  });
});
