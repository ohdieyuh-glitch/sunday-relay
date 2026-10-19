import { describe, expect, it } from 'vitest';

import { JuliusRunLoop } from './julius-run-loop';
import { cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker } from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE PROJECT BRAIN, WRITTEN BY A RUN RATHER THAN ONLY READ BY ONE.
 *
 * `julius_brain_entries` has been compiled into every worker's context packet
 * since migration 014, and until now the only thing that ever wrote to it was
 * the bootstrap seed. So the brain held the objective and constraints someone
 * typed before the run started, and NOTHING the run itself concluded — five of
 * its eight kinds had no producer at all. A repair reading that context saw the
 * same brief the failed attempt saw, and none of the reasoning that rejected it.
 *
 * These cases drive the real scheduler, pipeline and evaluator — the same ones
 * paid run 34037313976's reproduction uses — and ask what survives in the store
 * afterwards. What is being proven is not that a write happens; it is that the
 * write is bound to the decision's own idempotency, so a replayed tick adds
 * nothing and moves no counter.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'openai', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'anthropic', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'hermes', adapterId: 'reviewer-adapter',
});

const scope = { projectId: 'prj-1' };
/**
 * `projectBrainRevision: 3` with ONE seeded entry is the awkward pair on
 * purpose: it is what a bootstrap that wrote three entries and a store that
 * counts one look like together, and production resolves it with
 * `GREATEST(project_brain_revision, max(revision))`. The first written entry
 * must therefore be revision 4, not 2.
 */
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const BUILD_OK = { kind: 'succeed' as const, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] };
const REVIEW_REJECT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The plan has no verification strategy.' }] };
const REVIEW_ACCEPT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] };

async function drain(loop: JuliusRunLoop, maxTicks = 16): Promise<number> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const report = await loop.tick(scope);
    if (report.claimed === 0) return tick;
  }
  return maxTicks;
}

function build(reviewer: readonly { kind: 'succeed' }[]) {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [PLAN_OK, PLAN_OK] },
      { worker: CODER, script: [BUILD_OK] },
      { worker: REVIEWER, script: reviewer },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'], concurrency: 1 }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 3 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'A run summary is printed.', requiredEvidenceTypes: [] }]);
  harness.store.seedBrain('run-1', [
    { entryId: 'brain-1', kind: 'OBJECTIVE', text: 'Print a run summary.', taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL' },
  ]);
  return harness;
}

const written = async (harness: ReturnType<typeof build>) =>
  (await harness.store.brainEntriesForRun('run-1', 'prj-1')).filter((entry) => entry.entryId.startsWith('brain:decision:'));

describe('the Project Brain accumulates what a run decided', () => {
  it('keeps every verification decision of a completing run, seeded entries untouched', async () => {
    const harness = build([REVIEW_ACCEPT, REVIEW_ACCEPT]);
    await drain(harness.loop);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state, 'this scenario completes').toBe('COMPLETED');

    const all = await harness.store.brainEntriesForRun('run-1', 'prj-1');
    expect(all[0]?.entryId, 'the bootstrap seed is still first and still an OBJECTIVE').toBe('brain-1');
    expect(all[0]?.kind).toBe('OBJECTIVE');

    const decisions = await written(harness);
    expect(decisions.length, 'a run that decided nothing durable is the bug this fixes').toBeGreaterThan(0);
    for (const entry of decisions) {
      expect(entry.kind).toBe('DECISION');
      expect(entry.taskIds, 'a decision is about a task, and says which').not.toEqual([]);
    }
    // The subject of every decision is a real task of this run, never a review.
    const taskIds = new Set((await harness.store.tasksForRun('run-1', 'prj-1')).map((item) => item.taskId));
    for (const entry of decisions) expect(taskIds.has(entry.taskIds[0]!), entry.entryId).toBe(true);

    // The text carries the reason, which is the part a later worker needs.
    expect(decisions.some((entry) => entry.text.includes('TASK_VERIFIED')), 'an accept states why').toBe(true);
  });

  /**
   * THE COUNTER. `UNIQUE(run_id,revision)` is enforced by PostgreSQL and by
   * nothing in memory, so a model that allocated from its own entry count would
   * look correct here and collide in production the moment a seed was involved.
   */
  it('continues the revision sequence past the bootstrap seed rather than restarting at it', async () => {
    const harness = build([REVIEW_ACCEPT, REVIEW_ACCEPT]);
    await drain(harness.loop);
    const run = await harness.store.loadRun('run-1', 'prj-1');
    const decisions = await written(harness);
    expect(run?.projectBrainRevision,
      'the run row began at 3 with one seeded entry, so the counter continues from 3, not from 1')
      .toBe(3 + decisions.length);
  });

  /**
   * THE PROPERTY THAT MATTERS MOST, because it is the one a paid rerun would
   * expose and no amount of reading the code would. A tick that re-decides an
   * already-recorded decision must add no entry AND move no revision: the entry
   * id is derived from exactly what `appendDecision` keys on, so the two agree
   * by construction rather than by two people remembering the same rule.
   */
  it('a replayed decision writes nothing and moves no revision', async () => {
    const harness = build([REVIEW_ACCEPT, REVIEW_ACCEPT]);
    await drain(harness.loop);
    const before = await written(harness);
    const revisionBefore = (await harness.store.loadRun('run-1', 'prj-1'))?.projectBrainRevision;

    // Draining again re-enters the loop over a finished run.
    await drain(harness.loop);
    expect(await written(harness), 'no second copy of any decision').toHaveLength(before.length);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.projectBrainRevision,
      'and the counter did not drift on the replay').toBe(revisionBefore);
  });

  /**
   * A REJECTED PLAN IS THE CASE THE FEATURE EXISTS FOR. Paid run 34037313976
   * produced six blocking findings and then a repair that could see none of the
   * reasoning behind them.
   */
  it('records the rejection that sends work back, not only the acceptances', async () => {
    const harness = build([REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT]);
    await drain(harness.loop);
    const decisions = await written(harness);
    expect(decisions.some((entry) => entry.text.includes('REPAIR') && entry.text.includes('BLOCKING_FINDINGS')),
      'the decision that sent the plan back must be in the brain the repair reads').toBe(true);
  });
});
