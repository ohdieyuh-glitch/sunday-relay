import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { JULIUS_GUIDANCE_AUTHORITATIVE_HEADING, JULIUS_GUIDANCE_PROPOSED_HEADING } from './julius-continuous-lifecycle';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * ONLY ACCEPTED GUIDANCE IS INSTRUCTION.
 *
 * A packet used to reach the waiting coder the moment the architect wrote it.
 * The reviewer then judged it, and where it was sent back the coder's context
 * already held it: the correction arrived later, beside advice Julius had
 * rejected, and both read as instructions. A reader that cannot tell them apart
 * follows the first.
 *
 * So a packet is a PROPOSAL until Julius accepts its review, and acceptance is
 * the only thing that delivers it. Nothing is erased — the proposal, the
 * issuance and the rejecting decision stay on the record — but a rejected
 * packet is never in the coder's authoritative context.
 *
 * Provider-free: every worker answers from a script.
 */

type Step = Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number];

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
  question: 'Should the normalizer reuse the journal reader?',
  blockedOn: ['the 8KiB boundary case'], attempted: ['a second buffer'], relevantPaths: ['src/relay/persistence/journal.ts'],
});
const guidance = (action: string) => Object.freeze({
  subObjective: 'Settle the buffering question.',
  relevantRequirements: ['R1'], relevantConstraints: ['no new dependency'],
  repositoryFindings: ['journal.ts already buffers at the same boundary'], runtimeFindings: [],
  references: [{ kind: 'REPOSITORY', locator: 'src/relay/persistence/journal.ts:120', retrievedAt: '2026-09-10T20:59:00.000Z', trust: 'CORROBORATED' }],
  recommendedActions: [action], additionalProhibitions: [], affectedCriterionIds: [], unresolvedQuestions: [],
});
const REJECTED_ADVICE = 'add a second buffer and copy between them';
const ACCEPTED_ADVICE = 'call the existing reader';

const build = (scripts: { architect: readonly Step[]; coder?: readonly Step[]; reviewer: readonly Step[]; research?: boolean }): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      {
        worker: worker({
          workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
          capabilities: ['plan'], taskTypes: ['plan', 'repair:plan', 'guidance', 'repair:guidance'],
        }),
        script: scripts.architect,
      },
      {
        worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }),
        script: scripts.coder ?? [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      },
      {
        worker: worker({
          workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'],
          taskTypes: ['review:plan', 'review:build', 'review:guidance', 'review:repair:guidance', 'review:repair:build'],
        }),
        script: scripts.reviewer,
      },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
    ...(scripts.research === true ? {
      research: {
        async serve(request) {
          return request.asks.map((ask) => ({
            outcome: 'observed' as const, reference: ask.reference, purpose: ask.purpose,
            rendered: '<<<RELAY-EVIDENCE\nthe page answered.\nRELAY-EVIDENCE>>>',
            detail: 'The source answered.', evidenceId: 'ev-research-1', injectionSignals: [], mayCorroborate: true,
          }));
        },
      },
    } : {}),
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
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

/** Exactly what a worker was SHOWN: the compiled packet it was dispatched with. */
const packetsFor = (harness: JuliusHarness, taskId: string): string[] =>
  harness.store.contexts().filter((snapshot) => snapshot.taskId === taskId)
    .map((snapshot) => snapshot.packet.blocks.map((block) => block.text).join('\n'));

const factsOf = (harness: JuliusHarness, type: string) =>
  harness.store.events().filter((event) => event.type === type).map((event) => event.facts);

const REJECTED_THEN_CORRECTED = {
  architect: [
    { kind: 'succeed', evidence: PLAN_EVIDENCE },
    { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: guidance(REJECTED_ADVICE) },
    { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: guidance(ACCEPTED_ADVICE) },
  ] as Step[],
  reviewer: [
    { kind: 'succeed', evidence: PASSED_REVIEW },   // the plan
    { kind: 'succeed', evidence: FAILED_REVIEW },   // the first packet: rejected
    { kind: 'succeed', evidence: PASSED_REVIEW },   // the corrected packet
    { kind: 'succeed', evidence: PASSED_REVIEW },   // the coder's continuation
  ] as Step[],
};

describe('P4 — rejected guidance never enters the coder’s authoritative context', () => {
  it('the coder is shown the correction and never the packet Julius rejected', async () => {
    const harness = build(REJECTED_THEN_CORRECTED);
    await drain(harness);

    const shown = packetsFor(harness, 'segment:build-1:2:task').join('\n');
    expect(shown, 'the continuation ran').not.toBe('');
    expect(shown).toContain(ACCEPTED_ADVICE);
    expect(shown, 'the rejected advice was never shown to the coder').not.toContain(REJECTED_ADVICE);
    expect(shown).toContain(JULIUS_GUIDANCE_AUTHORITATIVE_HEADING);
    expect(shown, 'and no proposal is presented as instruction').not.toContain(JULIUS_GUIDANCE_PROPOSED_HEADING);

    // Nothing was erased: the rejected packet is still on the record, held
    // against the architect's own task, and its rejection is a decision.
    const proposals = (await harness.store.brainEntriesForRun('run-1', 'prj-1'))
      .filter((entry) => entry.entryId.startsWith('brain:guidance-proposed:'));
    expect(proposals).toHaveLength(2);
    expect(proposals.some((entry) => entry.text.includes(REJECTED_ADVICE)), 'the rejected packet is kept as provenance').toBe(true);
    expect(proposals.every((entry) => entry.text.startsWith(JULIUS_GUIDANCE_PROPOSED_HEADING))).toBe(true);
    expect(factsOf(harness, 'guidance.issued')).toHaveLength(2);
    expect(factsOf(harness, 'guidance.delivered')).toHaveLength(1);
  });

  it('a proposal is scoped to the architect’s own task, so it cannot reach the coder by existing', async () => {
    const harness = build(REJECTED_THEN_CORRECTED);
    await drain(harness);
    const proposals = (await harness.store.brainEntriesForRun('run-1', 'prj-1'))
      .filter((entry) => entry.entryId.startsWith('brain:guidance-proposed:'));
    for (const entry of proposals) {
      expect(entry.taskIds.every((taskId) => taskId.includes('guidance:build-1:1:task'))).toBe(true);
      expect(entry.taskIds).not.toContain('segment:build-1:2:task');
    }
  });

  it('the coder cannot run before the decision that delivers its guidance', async () => {
    const harness = build(REJECTED_THEN_CORRECTED);
    await drain(harness);
    const log = harness.store.events();
    const delivered = log.findIndex((event) => event.type === 'guidance.delivered');
    const claimed = log.findIndex((event) => event.type === 'task.claimed' && event.taskId === 'segment:build-1:2:task');
    expect(delivered).toBeGreaterThan(-1);
    expect(claimed, 'the continuation was claimed only after delivery').toBeGreaterThan(delivered);
  });
});

describe('P5 — corrected guidance is reviewed and accepted, and P6 — it survives the continuation', () => {
  it('the delivered packet is the reviewed one, and it is still there on a later dispatch', async () => {
    const harness = build({
      ...REJECTED_THEN_CORRECTED,
      // The continuation pauses once more, so the unit runs a SECOND dispatch
      // after delivery: the accepted advice must still be in that packet.
      coder: [
        { kind: 'succeed', guidanceRequest: REQUEST },
        { kind: 'succeed', researchAsks: [{ source: 'web', capability: 'read_item', reference: 'https://example.test/x', purpose: 'check' }], segmentResume: { completedSoFar: ['read the guidance'], nextIntent: 'finish' } },
        { kind: 'succeed' },
      ],
      reviewer: [...REJECTED_THEN_CORRECTED.reviewer, { kind: 'succeed', evidence: PASSED_REVIEW }],
      research: true,
    });
    await drain(harness);

    const delivered = factsOf(harness, 'guidance.delivered');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.deliveredTo).toBe('segment:build-1:2:task');
    // The unit paused again; the later segment still carries the accepted advice
    // and still not the rejected packet.
    const later = packetsFor(harness, 'segment:build-1:3:task').join('\n');
    expect(later, 'the unit continued past the delivery').not.toBe('');
    expect(later).toContain(ACCEPTED_ADVICE);
    expect(later).not.toContain(REJECTED_ADVICE);
  });

  it('accepted guidance is counted as consumed only where it was actually shown', async () => {
    const harness = build(REJECTED_THEN_CORRECTED);
    await drain(harness);
    const consumed = factsOf(harness, 'worker.effort')
      .filter((facts) => typeof facts.guidanceConsumed === 'number' && (facts.guidanceConsumed as number) > 0);
    expect(consumed, 'exactly the dispatch that read the delivered packet').toHaveLength(1);
    expect(consumed[0]!.taskType).toBe('build');
  });
});
