import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { foldJuliusFindings } from './julius-finding-lifecycle';
import { juliusRepairRoundEntryId } from './julius-repair-round';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * A FINDING'S LIFE, THROUGH THE REAL PIPELINE.
 *
 * The problem this closes: findings were recorded OPEN and stayed OPEN forever,
 * so a completed mission's record still said the problem was there. The
 * opposite mistake would be worse, and is refused here — a repair that ran is
 * not a problem that is gone, and only the reviewer that raised the finding can
 * end it.
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
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'NULL renders as the literal word, so AC-1 fails.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PLAN: Step = { kind: 'succeed', evidence: PLAN_EVIDENCE };
const PASS: Step = { kind: 'succeed', evidence: PASSED_REVIEW };
const REJECT: Step = { kind: 'succeed', evidence: FAILED_REVIEW };
const verdict = (value: Record<string, unknown>, evidence = PASSED_REVIEW): Step => ({ kind: 'succeed', evidence, reviewVerdict: value });

const build = (scripts: { coder?: readonly Step[]; reviewer: readonly Step[] }): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      {
        worker: worker({ workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'] }),
        script: [PLAN, PLAN],
      },
      {
        worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }),
        script: scripts.coder ?? [
          { kind: 'succeed', evidence: BUILD_EVIDENCE },
          { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green, including the NULL case.' }] },
          { kind: 'succeed', evidence: BUILD_EVIDENCE },
        ],
      },
      {
        worker: worker({
          workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'],
          taskTypes: ['review:plan', 'review:build', 'review:repair:build', 'review:repair:plan'],
        }),
        script: scripts.reviewer,
      },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
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

const rows = (harness: JuliusHarness) => harness.store.events().map((event) => ({ type: event.type, facts: event.facts, taskId: event.taskId }));
const lives = async (harness: JuliusHarness) => foldJuliusFindings(await harness.store.findingsForRun('run-1', 'prj-1'), rows(harness));
const REPAIR = 'repair:build-1:1:task';
const REPAIR_REVIEW = `${REPAIR}:review`;

/** The finding the build review raises, whatever evidence id it was given. */
const theFinding = async (harness: JuliusHarness) => (await lives(harness)).find((life) => life.taskId === 'build-1')!;

describe('P7/P8 — a finding stays open until a re-review says otherwise, and a repair alone never resolves it', () => {
  it('a repair moves it to ADDRESSED and no further', async () => {
    // The re-review passes but says nothing about the finding: silence resolves
    // nothing, and the record keeps saying someone acted rather than that it worked.
    const harness = build({ reviewer: [PASS, REJECT, PASS] });
    await drain(harness);

    const finding = await theFinding(harness);
    expect(finding.state).toBe('ADDRESSED');
    expect(finding.repairTaskIds).toEqual([REPAIR]);
    expect(finding.resolutionReviewTaskId, 'nothing resolved it').toBeNull();
    expect(finding.originReviewTaskId, 'and it remembers which review raised it').toBe('build-1:review');
    const moves = rows(harness).filter((row) => row.type === 'finding.transitioned').map((row) => row.facts.move);
    expect(moves).toEqual(['REPAIR_SUCCEEDED']);
  });

  it('nothing moves the finding until the repair has actually run', async () => {
    const harness = build({ reviewer: [PASS, REJECT, PASS] });
    await drain(harness);
    const log = harness.store.events();
    const recorded = log.findIndex((event) => event.type === 'finding.recorded');
    const repairRan = log.findIndex((event) => event.type === 'task.claimed' && event.taskId === REPAIR);
    const addressed = log.findIndex((event) => event.type === 'finding.transitioned');
    expect(recorded).toBeGreaterThan(-1);
    expect(repairRan, 'the repair ran after the finding was raised').toBeGreaterThan(recorded);
    expect(addressed, 'and nothing touched the finding until it had').toBeGreaterThan(repairRan);
    // Between the two there is no transition at all: the finding was simply OPEN.
    expect(log.slice(recorded, repairRan).some((event) => event.type === 'finding.transitioned')).toBe(false);
  });
});

describe('P9/P10 — a re-review resolves the finding it was asked about, by identity', () => {
  it('RESOLVED names the same finding the first review raised, and the review that ended it', async () => {
    const harness = build({ reviewer: [PASS, REJECT, PASS] });
    // Drive far enough to learn the finding id, then answer about it.
    await drain(harness, 6);
    const raised = await theFinding(harness);
    const resolving = build({
      reviewer: [
        PASS, REJECT,
        verdict({
          verdict: 'CONTINUE', claim: 'The NULL case is covered now.',
          resolutions: [{ findingId: raised.findingId, status: 'RESOLVED', claim: 'The new test asserts the empty rendering.' }],
        }),
      ],
    });
    await drain(resolving);

    const finding = await theFinding(resolving);
    expect(finding).toMatchObject({
      findingId: raised.findingId, state: 'RESOLVED', taskId: 'build-1',
      resolutionReviewTaskId: REPAIR_REVIEW, lastMove: 'REVIEWER_RESOLVED',
    });
    expect(finding.repairTaskIds, 'the whole chain is on one row').toEqual([REPAIR]);
    const applied = rows(resolving).find((row) => row.type === 'review.verdict.applied' && row.facts.reviewTaskId === REPAIR_REVIEW);
    expect(applied!.facts.findingsResolved).toBe(1);
    expect((await resolving.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });

  it('a re-review that says the problem is still there returns it to OPEN, and a later round can resolve it', async () => {
    const harness = build({ reviewer: [PASS, REJECT, PASS] });
    await drain(harness, 6);
    const raised = await theFinding(harness);
    const maintained = build({
      coder: [
        { kind: 'succeed', evidence: BUILD_EVIDENCE }, { kind: 'succeed', evidence: BUILD_EVIDENCE }, { kind: 'succeed', evidence: BUILD_EVIDENCE },
      ],
      reviewer: [
        PASS, REJECT,
        verdict({
          verdict: 'REPAIR_REQUIRED', claim: 'Still rendering the literal word.',
          resolutions: [{ findingId: raised.findingId, status: 'OPEN', claim: 'The new test does not cover the NULL path.' }],
        }, FAILED_REVIEW),
        verdict({
          verdict: 'CONTINUE', claim: 'Now it is covered.',
          resolutions: [{ findingId: raised.findingId, status: 'RESOLVED', claim: 'The second round asserts the rendering.' }],
        }),
      ],
    });
    await drain(maintained);
    const finding = (await lives(maintained)).find((life) => life.findingId === raised.findingId)!;
    expect(finding.state).toBe('RESOLVED');
    expect(finding.repairTaskIds.length, 'two rounds, one finding').toBeGreaterThan(1);
    const moves = rows(maintained).filter((row) => row.type === 'finding.transitioned' && row.facts.findingId === raised.findingId)
      .map((row) => row.facts.move);
    expect(moves).toEqual(['REPAIR_SUCCEEDED', 'REVIEWER_MAINTAINED', 'REPAIR_SUCCEEDED', 'REVIEWER_RESOLVED']);
  });

  it('SUPERSEDED links the replacement the same review raised', async () => {
    const harness = build({ reviewer: [PASS, REJECT, PASS] });
    await drain(harness, 6);
    const raised = await theFinding(harness);
    const superseding = build({
      coder: [{ kind: 'succeed', evidence: BUILD_EVIDENCE }, { kind: 'succeed', evidence: BUILD_EVIDENCE }, { kind: 'succeed', evidence: BUILD_EVIDENCE }],
      reviewer: [
        PASS, REJECT,
        verdict({
          verdict: 'REPAIR_REQUIRED', claim: 'The rendering is fixed but the column order changed.',
          resolutions: [{ findingId: raised.findingId, status: 'SUPERSEDED', claim: 'The NULL rendering is fixed; the problem is now the column order.' }],
        }, [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The column order no longer matches the contract.' }]),
        PASS,
      ],
    });
    await drain(superseding);
    const all = await lives(superseding);
    const original = all.find((life) => life.findingId === raised.findingId)!;
    expect(original.state).toBe('SUPERSEDED');
    expect(original.supersededByFindingId, 'the replacement is named').not.toBeNull();
    const replacement = all.find((life) => life.findingId === original.supersededByFindingId);
    expect(replacement, 'and it exists').not.toBeUndefined();
    expect(replacement!.claim).toContain('column order');
  });

  it('a reviewer cannot resolve a finding about work it was not asked to judge', async () => {
    const harness = build({ reviewer: [PASS, REJECT, PASS] });
    await drain(harness, 6);
    const foreign = build({
      reviewer: [
        PASS, REJECT,
        verdict({
          verdict: 'CONTINUE', claim: 'Fine.',
          resolutions: [{ findingId: 'finding:somebody-elses', status: 'RESOLVED', claim: 'Not mine to end.' }],
        }),
      ],
    });
    await drain(foreign);
    const refusals = rows(foreign).filter((row) => row.type === 'review.verdict.refused');
    expect(refusals.map((row) => row.facts.reasonCode)).toContain('review_resolution_names_a_foreign_finding');
    expect((await theFinding(foreign)).state, 'the real finding was untouched by the false claim').toBe('ADDRESSED');
  });
});

describe('P11 — the re-review is shown a bounded diff of what changed', () => {
  it('the repair round entry names the findings, both rounds of evidence and what moved', async () => {
    const harness = build({ reviewer: [PASS, REJECT, PASS] });
    await drain(harness);
    const entry = (await harness.store.brainEntriesForRun('run-1', 'prj-1'))
      .find((row) => row.entryId === juliusRepairRoundEntryId(REPAIR_REVIEW));
    expect(entry, 'the re-review was shown the comparison').not.toBeUndefined();
    expect(entry!.taskIds, 'scoped to the review that must judge it').toEqual([REPAIR_REVIEW]);
    const finding = await theFinding(harness);
    expect(entry!.text).toContain(finding.findingId);
    expect(entry!.text).toContain('NULL renders as the literal word');
    expect(entry!.text).toContain('EVIDENCE BEFORE');
    expect(entry!.text).toContain('EVIDENCE AFTER');
    expect(entry!.text).toContain('Suite green, including the NULL case.');
    expect(entry!.text).toContain('A finding you do not answer stays exactly as it is.');
    // Bounded: a comparison, not a transcript.
    expect(entry!.text.length).toBeLessThan(6_000);
    const started = rows(harness).find((row) => row.type === 'review.started' && row.facts.repairRoundDiff === true);
    expect(started!.facts).toMatchObject({ round: 1, findingsToAnswer: 1, reviewsTaskId: REPAIR });
  });

  it('an ordinary review gets no repair-round entry', async () => {
    const harness = build({ reviewer: [PASS, PASS] });
    await drain(harness);
    const entries = (await harness.store.brainEntriesForRun('run-1', 'prj-1')).filter((row) => row.entryId.startsWith('brain:repair-round:'));
    expect(entries).toEqual([]);
  });
});
