import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * GUIDANCE THAT WAS REPAIRED, OR RESEARCHED, STILL ANSWERS THE QUESTION IT WAS FOR.
 *
 * Guidance is issued from the result of the task that wrote it, and that task
 * used to be recognised by its id alone: `guidance:<subject>:<n>:task`. Two
 * tasks write guidance and do not have that id —
 *
 *   - the REPAIR of a rejected guidance packet, `repair:guidance:…:1:task`,
 *     which exists precisely because the first answer was not good enough;
 *   - the CONTINUATION of an architect that paused its guidance to have Julius
 *     read something, `segment:guidance:…:2:task`.
 *
 * Both were refused `guidance_from_a_non_guidance_task`, so an architect that
 * was told its advice was wrong could never deliver the corrected advice, and
 * an architect that looked something up before answering could never answer.
 * The coder's continuation was then released onto whatever it had already been
 * handed. Provider-free: every worker answers from a script.
 */

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
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The advice contradicts the plan.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const REQUEST = Object.freeze({
  question: 'The journal reader already buffers — should the normalizer reuse it?',
  blockedOn: ['the 8KiB boundary case'], attempted: ['a second buffer'], relevantPaths: ['src/relay/persistence/journal.ts'],
});
const guidance = (action: string) => Object.freeze({
  subObjective: 'Reuse the existing reader rather than adding a second buffer.',
  relevantRequirements: ['R1'], relevantConstraints: ['no new dependency'],
  repositoryFindings: ['journal.ts already buffers at the same boundary'], runtimeFindings: [],
  references: [{ kind: 'REPOSITORY', locator: 'src/relay/persistence/journal.ts:120', retrievedAt: '2026-09-10T20:59:00.000Z', trust: 'CORROBORATED' }],
  recommendedActions: [action], additionalProhibitions: [], affectedCriterionIds: [], unresolvedQuestions: [],
});
const ASKS = Object.freeze([{
  source: 'web', capability: 'read_item', reference: 'https://docs.python.org/3/library/io.html',
  purpose: 'Whether BufferedReader.peek may return fewer bytes than asked.',
}]);
const RESUME = Object.freeze({ completedSoFar: ['read the question'], nextIntent: 'answer once the buffer semantics are known' });

type Step = Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number];

const build = (input: { architect: readonly Step[]; coder: readonly Step[]; reviewer: readonly Step[]; research?: boolean }): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: input.architect },
      { worker: CODER, script: input.coder },
      { worker: REVIEWER, script: input.reviewer },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
    ...(input.research === true ? {
      research: {
        async serve(request) {
          return request.asks.map((ask) => ({
            outcome: 'observed' as const, reference: ask.reference, purpose: ask.purpose,
            rendered: '<<<RELAY-EVIDENCE\npeek may return fewer bytes.\nRELAY-EVIDENCE>>>',
            detail: 'The source answered.', evidenceId: 'ev-research-1', injectionSignals: [], mayCorroborate: true,
          }));
        },
      },
    } : {}),
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

async function drain(harness: JuliusHarness, ticks = 48): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    const report = await harness.loop.tick({ projectId: 'prj-1' });
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

const factsOf = (harness: JuliusHarness, type: string) =>
  harness.store.events().filter((event) => event.type === type)
    .map((event): Record<string, string | number | boolean | null> => ({ taskId: event.taskId, ...event.facts }));

/**
 * THE SAME ID-SHAPE BUG, ONE LAYER DOWN. The task contract a dispatch is bound
 * by was found the same way, so a repair or a continuation of guidance was an
 * architect task bound by nothing — dispatched with no revision and no digest,
 * past the gate that refuses guidance written under unlocked terms.
 */
async function expectBoundDispatch(harness: JuliusHarness, taskId: string): Promise<void> {
  const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
  const claimed = harness.store.events().find((event) => event.type === 'task.claimed' && event.taskId === taskId);
  expect(claimed, `${taskId} was dispatched`).not.toBeUndefined();
  expect(claimed!.facts.contractRevision, `${taskId} ran under the locked terms`).toBe(contract!.contractRevision);
  expect(claimed!.facts.bindingDigest).toBe(contract!.bindingDigest);
}

describe('repaired guidance is issued against the question it answers', () => {
  it('a repair of rejected guidance issues its packet and delivers it to the waiting continuation', async () => {
    const harness = build({
      architect: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: guidance('add a second buffer') },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: guidance('call the existing reader') },
      ],
      coder: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      reviewer: [
        { kind: 'succeed', evidence: PASSED_REVIEW }, // plan
        { kind: 'succeed', evidence: FAILED_REVIEW }, // guidance → repair
        { kind: 'succeed', evidence: PASSED_REVIEW }, // repaired guidance
        { kind: 'succeed', evidence: PASSED_REVIEW }, // build continuation
      ],
    });
    await drain(harness);

    const refused = factsOf(harness, 'guidance.refused');
    expect(refused, 'no guidance was refused for being written by a repair').toEqual([]);
    const issued = factsOf(harness, 'guidance.issued');
    expect(issued.map((row) => row.taskId)).toEqual(['build-1', 'build-1']);
    // Issued is a PROPOSAL; delivery is Julius accepting it after review. The
    // rejected packet was issued and never delivered, so the coder's
    // continuation holds the correction and nothing else.
    expect(issued[1]!.proposedTo).toBe('segment:build-1:2:task');
    const delivered = factsOf(harness, 'guidance.delivered');
    expect(delivered.map((row) => row.deliveredTo)).toEqual(['segment:build-1:2:task']);
    const continuation = (await harness.store.brainEntriesForRun('run-1', 'prj-1'))
      .filter((row) => row.taskIds.includes('segment:build-1:2:task'));
    const text = continuation.map((row) => row.text).join('\n');
    expect(text, 'the corrected advice reached the continuation').toContain('call the existing reader');
    expect(text, 'the rejected advice never did').not.toContain('add a second buffer');
    expect(issued.map((row) => row.guidanceRevision), 'two packets for one question are ordered').toEqual([1, 2]);
    await expectBoundDispatch(harness, 'repair:guidance:build-1:1:task:1:task');
  });
});

describe('researched guidance is issued against the question it answers', () => {
  it('an architect that pauses its guidance to research still delivers the answer', async () => {
    const harness = build({
      research: true,
      architect: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, researchAsks: ASKS, segmentResume: RESUME },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: guidance('peek, then read the remainder') },
      ],
      coder: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      reviewer: [
        { kind: 'succeed', evidence: PASSED_REVIEW },
        { kind: 'succeed', evidence: PASSED_REVIEW },
        { kind: 'succeed', evidence: PASSED_REVIEW },
        { kind: 'succeed', evidence: PASSED_REVIEW },
      ],
    });
    await drain(harness);

    expect(factsOf(harness, 'guidance.refused'), 'the researched answer was not refused').toEqual([]);
    const issued = factsOf(harness, 'guidance.issued');
    expect(issued).toHaveLength(1);
    expect(issued[0]!.taskId).toBe('build-1');
    expect(issued[0]!.proposedTo).toBe('segment:build-1:2:task');
    expect(factsOf(harness, 'guidance.delivered').map((row) => row.deliveredTo)).toEqual(['segment:build-1:2:task']);
    await expectBoundDispatch(harness, 'segment:guidance:build-1:1:task:2:task');
  });
});
