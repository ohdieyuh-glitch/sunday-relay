import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { foldJuliusFindings } from './julius-finding-lifecycle';
import { JuliusRunLoop } from './julius-run-loop';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * ACCEPTED GUIDANCE, FROM THE CODING AGENT'S SIDE.
 *
 * PR #271 proved rejected guidance never instructs the coder. These prove the
 * other half: that the coder actually GETS what Julius accepted — after a crash,
 * across a repair, and exactly once — that a question nobody will wait for buys
 * no architect work, and that a paused repair still answers for the findings it
 * was opened for.
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
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'NULL renders as the literal word.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const PASS: Step = { kind: 'succeed', evidence: PASSED_REVIEW };
const REJECT: Step = { kind: 'succeed', evidence: FAILED_REVIEW };
const REQUEST = Object.freeze({
  question: 'Should the normalizer reuse the journal reader?',
  blockedOn: ['the 8KiB boundary case'], attempted: ['a second buffer'], relevantPaths: ['src/relay/persistence/journal.ts'],
});
const ADVICE = 'call the existing reader';
const GUIDANCE = Object.freeze({
  subObjective: 'Settle the buffering question.',
  relevantRequirements: ['R1'], relevantConstraints: ['no new dependency'],
  repositoryFindings: ['journal.ts already buffers at the same boundary'], runtimeFindings: [],
  references: [{ kind: 'REPOSITORY', locator: 'src/relay/persistence/journal.ts:120', retrievedAt: '2026-09-10T20:59:00.000Z', trust: 'CORROBORATED' }],
  recommendedActions: [ADVICE], additionalProhibitions: [], affectedCriterionIds: [], unresolvedQuestions: [],
});

const build = (input: {
  architect?: readonly Step[];
  coder: readonly Step[];
  reviewer: readonly Step[];
  maxCoderSegments?: number;
}): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      {
        worker: worker({
          workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
          capabilities: ['plan'], taskTypes: ['plan', 'repair:plan', 'guidance', 'repair:guidance'],
        }),
        script: input.architect ?? [{ kind: 'succeed', evidence: PLAN_EVIDENCE }, { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE }],
      },
      {
        worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }),
        script: input.coder,
      },
      {
        worker: worker({
          workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'],
          taskTypes: ['review:plan', 'review:build', 'review:guidance', 'review:repair:guidance', 'review:repair:build'],
        }),
        script: input.reviewer,
      },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({
      reviewerRequired: true, maxRepairRounds: 2,
      ...(input.maxCoderSegments === undefined ? {} : { maxCoderSegments: input.maxCoderSegments }),
    }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  return harness;
};

async function drain(harness: JuliusHarness, ticks = 64): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    let report;
    try {
      report = await harness.loop.tick({ projectId: 'prj-1' });
    } catch {
      // A crash mid-tick is a process dying; the next tick is the restart.
      continue;
    }
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

const factsOf = (harness: JuliusHarness, type: string): Record<string, unknown>[] =>
  harness.store.events().filter((event) => event.type === type).map((event) => ({ taskId: event.taskId, ...event.facts }));
const packetsFor = (harness: JuliusHarness, taskId: string): string =>
  harness.store.contexts().filter((snapshot) => snapshot.taskId === taskId)
    .map((snapshot) => snapshot.packet.blocks.map((block) => block.text).join('\n')).join('\n');
const tasksOf = async (harness: JuliusHarness) => harness.store.tasksForRun('run-1', 'prj-1');

describe('G1 — a coder never resumes without the answer Julius accepted, even across a crash', () => {
  it('a crash after the release and before the delivery still delivers before the continuation runs', async () => {
    const harness = build({ coder: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }], reviewer: [PASS, PASS, PASS] });
    // The process dies exactly between the decision that releases the waiting
    // continuation and the write that hands it the accepted packet.
    const original = harness.store.appendBrainEntry.bind(harness.store);
    let crashed = false;
    (harness.store as { appendBrainEntry: typeof original }).appendBrainEntry = async (entry) => {
      if (!crashed && entry.entryId.startsWith('brain:guidance-answer:')) {
        crashed = true;
        throw new Error('process died before delivery');
      }
      return original(entry);
    };
    await drain(harness);

    expect(crashed, 'the crash window was actually reached').toBe(true);
    const shown = packetsFor(harness, 'segment:build-1:2:task');
    expect(shown, 'the continuation ran').not.toBe('');
    expect(shown, 'and it was shown the accepted answer').toContain(ADVICE);
    expect(factsOf(harness, 'guidance.delivered').map((facts) => facts.deliveredTo), 'delivered exactly once').toEqual(['segment:build-1:2:task']);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });
});

describe('G2 — a question nobody will wait for buys no architect work', () => {
  it('past the segment ceiling, the question is refused before any guidance task exists', async () => {
    const harness = build({
      // Ceiling 1: the first dispatch is segment 1, so any pause would need a segment 2.
      maxCoderSegments: 1,
      coder: [{ kind: 'succeed', guidanceRequest: REQUEST }],
      reviewer: [PASS, PASS],
    });
    await drain(harness);
    const verdicts = factsOf(harness, 'checkpoint.verdict');
    expect(verdicts.map((facts) => facts.reasonCode)).toContain('SEGMENT_CEILING_REACHED');
    const tasks = await tasksOf(harness);
    expect(tasks.filter((item) => item.taskType === 'guidance'), 'no architect dispatch was bought').toEqual([]);
    expect(tasks.filter((item) => item.taskType === 'review:guidance')).toEqual([]);
  });
});

describe('G3 — accepted guidance survives into the repair of the work it guided', () => {
  it('a repair round of the unit is still shown the accepted answer', async () => {
    const harness = build({
      coder: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }, { kind: 'succeed' }],
      // plan, guidance, the continuation's build review REJECTS, the repair's review passes.
      reviewer: [PASS, PASS, REJECT, PASS],
    });
    await drain(harness);
    const repair = (await tasksOf(harness)).find((item) => item.taskType === 'repair:build');
    expect(repair, 'a repair round ran').not.toBeUndefined();
    expect(packetsFor(harness, repair!.taskId), 'the repair was shown the accepted answer').toContain(ADVICE);
  });
});

describe('G4 — a paused repair still answers for the finding it was opened for', () => {
  it('the re-review of a repair that paused can see and resolve the original finding', async () => {
    const first = build({ coder: [{ kind: 'succeed' }, { kind: 'succeed' }], reviewer: [PASS, REJECT, PASS] });
    await drain(first, 8);
    const raised = foldJuliusFindings(await first.store.findingsForRun('run-1', 'prj-1'), []).find((life) => life.taskId === 'build-1');
    expect(raised, 'the build review raised a finding').not.toBeUndefined();

    const harness = build({
      coder: [
        { kind: 'succeed' },
        // The repair pauses for guidance; its continuation finishes the repair.
        { kind: 'succeed', guidanceRequest: REQUEST },
        { kind: 'succeed' },
      ],
      reviewer: [
        PASS, REJECT, PASS,
        {
          kind: 'succeed', evidence: PASSED_REVIEW,
          reviewVerdict: { verdict: 'CONTINUE', claim: 'Fixed.', resolutions: [{ findingId: raised!.findingId, status: 'RESOLVED', claim: 'The new test covers it.' }] },
        },
      ],
    });
    await drain(harness);

    const repairContinuation = (await tasksOf(harness)).find((item) => item.taskId.startsWith('segment:repair:'));
    expect(repairContinuation, 'the repair paused and continued').not.toBeUndefined();
    expect(packetsFor(harness, repairContinuation!.taskId), 'the continuation still carries the finding it must answer').toContain('NULL renders as the literal word');
    const refused = factsOf(harness, 'review.verdict.refused').map((facts) => facts.reasonCode);
    expect(refused, 'the resolution was not refused as foreign').not.toContain('review_resolution_names_a_foreign_finding');
    const lives = foldJuliusFindings(
      await harness.store.findingsForRun('run-1', 'prj-1'),
      harness.store.events().map((event) => ({ type: event.type, facts: event.facts, taskId: event.taskId })),
    );
    expect(lives.find((life) => life.findingId === raised!.findingId)?.state).toBe('RESOLVED');
  });
});

describe('G5 — which accepted guidance a dispatch was given is on the record, by name', () => {
  it('each consuming dispatch names exactly the entries its packet held — never a proposal, never a rejected packet', async () => {
    const harness = build({
      coder: [
        { kind: 'succeed', guidanceRequest: REQUEST },
        // The continuation pauses once more, so the accepted packet is CARRIED into a later segment.
        { kind: 'succeed', guidanceRequest: { ...REQUEST, question: 'And the 16KiB case?' } },
        { kind: 'succeed' },
      ],
      architect: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: { ...GUIDANCE, recommendedActions: ['also call it at 16KiB'] } },
      ],
      reviewer: [PASS, PASS, PASS, PASS],
    });
    await drain(harness);

    const consumed = factsOf(harness, 'guidance.consumed');
    expect(consumed.map((facts) => facts.taskId)).toEqual(['segment:build-1:2:task', 'segment:build-1:3:task']);
    // Every id named was really in that dispatch's compiled packet, and is an accepted answer.
    for (const facts of consumed) {
      const ids = String(facts.entryIds).split(' ');
      const snapshot = harness.store.contexts().find((item) => item.contextId === facts.contextId)!;
      for (const id of ids) {
        expect(snapshot.sourceEntryIds, `${id} was in the packet`).toContain(id);
        expect(id.startsWith('brain:guidance-answer:'), `${id} is an accepted answer`).toBe(true);
      }
      expect(facts.count).toBe(ids.length);
    }
    // The later segment carries the first answer forward and receives the second: two packets, each once.
    expect(consumed[1]!.count).toBe(2);
    expect(new Set(String(consumed[1]!.entryIds).split(' ')).size).toBe(2);
  });

  it('a dispatch with no accepted guidance records no consumption at all', async () => {
    const harness = build({ architect: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }], coder: [{ kind: 'succeed' }], reviewer: [PASS, PASS] });
    await drain(harness);
    expect(factsOf(harness, 'guidance.consumed')).toEqual([]);
  });
});

describe('G6 — a continuation whose accepted answer did not fit is refused, not dispatched on a guess', () => {
  it('when the character budget would drop the delivered packet, the dispatch fails by name', async () => {
    const harness = build({ coder: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }], reviewer: [PASS, PASS, PASS] });
    // Drive until the answer is delivered, then resume under a budget too small to hold it.
    for (let index = 0; index < 32 && factsOf(harness, 'guidance.delivered').length === 0; index += 1) {
      const report = await harness.loop.tick({ projectId: 'prj-1' });
      if (report.claimed === 0) await harness.loop.advanceRun('run-1', 'prj-1');
    }
    expect(factsOf(harness, 'guidance.delivered'), 'the answer was delivered').toHaveLength(1);
    const cramped = new JuliusRunLoop({ ...harness.deps, contextCharacterBudget: 120 }, harness.policies, { claimLimit: 10, leaseMs: 60_000 });
    await cramped.tick({ projectId: 'prj-1' });

    const failed = factsOf(harness, 'task.failed').filter((facts) => facts.taskId === 'segment:build-1:2:task');
    expect(failed.map((facts) => facts.failureClass)).toContain('accepted_guidance_dropped');
    expect(factsOf(harness, 'guidance.consumed'), 'nothing claims it was consumed').toEqual([]);
  });
});

describe('G7 — an unreadable question is named on the record', () => {
  it('the checkpoint says the request could not be read, and why, while a readable one says it could', async () => {
    const unreadable = build({ coder: [{ kind: 'succeed', guidanceRequest: { question: 42 } }, { kind: 'succeed' }], reviewer: [PASS, PASS, PASS] });
    await drain(unreadable);
    expect(factsOf(unreadable, 'checkpoint.recorded').find((facts) => facts.trigger === 'GUIDANCE_REQUESTED'))
      .toMatchObject({ requestReadable: false, requestReasonCode: 'guidance_request_unreadable' });

    const readable = build({ coder: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }], reviewer: [PASS, PASS, PASS] });
    await drain(readable);
    expect(factsOf(readable, 'checkpoint.recorded').find((facts) => facts.trigger === 'GUIDANCE_REQUESTED'))
      .toMatchObject({ requestReadable: true, requestReasonCode: null });
  });
});

describe('G8 — a continuation is handed the answer to ITS question, never another unit\'s', () => {
  it('two coders ask two questions; each continuation holds exactly its own accepted answer', async () => {
    const ALPHA = 'use advice ALPHA for the first unit';
    const BETA = 'use advice BETA for the second unit';
    const answer = (advice: string): Step => ({ kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: { ...GUIDANCE, recommendedActions: [advice] } });
    const harness = build({
      architect: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }, answer(ALPHA), answer(BETA)],
      coder: [
        { kind: 'succeed', guidanceRequest: REQUEST },
        { kind: 'succeed', guidanceRequest: { ...REQUEST, question: 'Should the exporter reuse it too?' } },
        { kind: 'succeed' }, { kind: 'succeed' },
      ],
      reviewer: [PASS, PASS, PASS, PASS, PASS, PASS, PASS],
    });
    seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-2' });
    harness.store.seedTask('run-1', task({ taskId: 'build-2', ordinal: 2, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
    await drain(harness);

    const continuations = (await tasksOf(harness)).filter((item) => /^segment:build-[12]:2:task$/u.test(item.taskId));
    expect(continuations.map((item) => item.taskId).sort()).toEqual(['segment:build-1:2:task', 'segment:build-2:2:task']);
    // Every delivery names the guidance task of the unit it was delivered to.
    const deliveries = factsOf(harness, 'guidance.delivered');
    expect(deliveries.length).toBeGreaterThan(0);
    for (const delivery of deliveries) {
      const unit = /^segment:(build-[12]):/u.exec(String(delivery.deliveredTo))![1];
      expect(delivery.guidanceTaskId, `${String(delivery.deliveredTo)} was handed ${String(delivery.guidanceTaskId)}`).toBe(`guidance:${unit}:1:task`);
    }
    // And each continuation's packets hold one answer — the one its own question was given.
    const held = continuations.map((item) => {
      const packet = packetsFor(harness, item.taskId);
      return [packet.includes(ALPHA), packet.includes(BETA)];
    });
    for (const [alpha, beta] of held) expect(alpha !== beta, 'exactly one of the two answers').toBe(true);
    expect(held[0]![0], 'and not the same one').not.toBe(held[1]![0]);
  });
});

describe('G9 — a second-round repair that pauses addresses the round it repairs', () => {
  it('the finding raised on the first repair is ADDRESSED by the second repair, whose work finished in a continuation', async () => {
    const harness = build({
      coder: [
        { kind: 'succeed' },
        { kind: 'succeed' },
        // The second repair pauses; its continuation finishes it.
        { kind: 'succeed', guidanceRequest: REQUEST },
        { kind: 'succeed' },
      ],
      // plan, build REJECTED, first repair REJECTED, guidance, the second repair passes.
      reviewer: [PASS, REJECT, REJECT, PASS, PASS],
    });
    await drain(harness);

    const tasks = await tasksOf(harness);
    const repairs = tasks.filter((item) => item.taskType === 'repair:build' && !item.taskId.startsWith('segment:'));
    expect(repairs.length, 'two repair rounds').toBe(2);
    const continuation = tasks.find((item) => item.taskId.startsWith('segment:repair:'));
    expect(continuation, 'the second repair paused and continued').not.toBeUndefined();
    const second = tasks.find((item) => item.taskId === continuation!.parentTaskId)!;
    const findings = await harness.store.findingsForRun('run-1', 'prj-1');
    const onFirstRepair = findings.filter((finding) => finding.taskId === second.parentTaskId);
    expect(onFirstRepair.length, 'the first repair\'s review raised a finding').toBeGreaterThan(0);
    const addressed = factsOf(harness, 'finding.transitioned')
      .filter((facts) => facts.move === 'REPAIR_SUCCEEDED' && onFirstRepair.some((finding) => finding.findingId === facts.findingId));
    // Named by the repair, never by the pause that finished it.
    expect(addressed.map((facts) => facts.repairTaskId), 'addressed by the repair that answered it').toEqual([second.taskId]);
    const lives = foldJuliusFindings(findings, harness.store.events().map((event) => ({ type: event.type, facts: event.facts, taskId: event.taskId })));
    for (const life of lives) {
      expect(life.repairTaskIds.some((id) => id.startsWith('segment:')), `${life.findingId} links repairs, not pauses`).toBe(false);
    }
  });
});
