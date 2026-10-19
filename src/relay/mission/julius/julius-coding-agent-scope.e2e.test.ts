import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { lockJuliusTaskContract, seedJuliusTaskContract } from './julius-task-contract';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE AGREEMENT'S SCOPE, ENFORCED FROM WHAT THE EXECUTOR SAW.
 *
 * `permittedPaths` and the out-of-scope paths of a locked contract were stated
 * to the coder, stated to the reviewer, and read by no code at all. Julius now
 * holds the work to them from the change set the independent executor observed,
 * whatever the coder believed it was allowed and whatever it said it did.
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
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const TEST_PASSED = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];

const lockedContract = () => {
  const seeded = seedJuliusTaskContract({
    runId: 'run-1', taskId: 'build-1', missionContractRevision: 1,
    objective: 'Normalize the mission label.', requirements: ['slug'], constraints: ['no new dependency'],
    acceptanceCriteria: [{ id: 'criterion-1', text: 'the slug test passes', blocking: true }],
    filesInScope: ['src/slug.ts', 'src/slug.test.ts'], filesOutOfScope: ['src/persistence/'],
    spendUsd: 20, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(seeded.reasonCode);
  const locked = lockJuliusTaskContract({ contract: seeded.contract, verdict: { verdict: 'ACCEPT', evaluatorId: 'fixture' }, lockedAt: '2026-09-16T00:00:00.000Z' });
  if (locked.outcome !== 'LOCKED') throw new Error('not lockable');
  return locked.contract;
};

const implementation = (paths: readonly (readonly [string, string])[], report?: unknown) => ({
  providerKind: 'generic-scripted',
  workspace: { captured: true, truncated: false, changes: paths.map(([path, change]) => ({ path, change })) },
  ...(report === undefined ? {} : { report }),
});
const BUILD = (value: unknown): Step => ({ kind: 'succeed', evidence: TEST_PASSED, implementation: value });

const build = (coder: readonly Step[]): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      { worker: worker({ workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan'] }), script: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }] },
      { worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }), script: coder },
      { worker: worker({ workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:build'] }), script: [{ kind: 'succeed', evidence: PASSED_REVIEW }] },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  void harness.store.putTaskContract({ projectId: 'prj-1', contract: lockedContract(), occurredAt: '2026-09-16T00:00:00.000Z' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The slug test passes.', requiredEvidenceTypes: ['TEST'] }]);
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

const factsOf = (harness: JuliusHarness, type: string): Record<string, unknown>[] =>
  harness.store.events().filter((event) => event.type === type).map((event) => ({ taskId: event.taskId, ...event.facts }));
const decisionsOf = async (harness: JuliusHarness, taskId: string) =>
  (await harness.store.decisionsForRun('run-1', 'prj-1')).filter((row) => row.taskId === taskId).map((row) => `${row.action}:${row.reasonCode}`);

describe('S4 — work inside the agreement is recorded and passes', () => {
  it('in-scope changes are on the record, with the coder\'s claims beside what was observed', async () => {
    const harness = build([BUILD(implementation(
      [['src/slug.ts', 'MODIFIED'], ['src/slug.test.ts', 'UNTRACKED']],
      { outcome: 'IMPLEMENTED', summary: 'Normalized the slug.', filesTouched: ['src/slug.ts', 'src/README.md'], testsRun: ['npm test'], remainingUncertainty: [], blockedReason: null },
    ))]);
    await drain(harness);

    expect(factsOf(harness, 'coder.implementation.recorded')).toEqual([expect.objectContaining({
      taskId: 'build-1', providerKind: 'generic-scripted', workspaceCaptured: true,
      changedPaths: 2, untrackedPaths: 1, paths: 'src/slug.ts src/slug.test.ts',
      scopeChecked: true, scopeViolations: 0, reportOutcome: 'IMPLEMENTED',
      // It claimed a README nobody saw change, and did not mention the new test.
      claimedNotObserved: 1, observedNotClaimed: 1,
    })]);
    expect(factsOf(harness, 'coder.scope.violated')).toEqual([]);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });
});

describe('S5 — work outside the agreement is not accepted, whatever the coder said about it', () => {
  it('an edit to an out-of-scope path — here a brand-new untracked file — fails the work and sends it to repair', async () => {
    const harness = build([
      BUILD(implementation([['src/slug.ts', 'MODIFIED'], ['src/persistence/cache.ts', 'UNTRACKED']],
        { outcome: 'IMPLEMENTED', summary: 'Done, all in scope.', filesTouched: ['src/slug.ts'], testsRun: [], remainingUncertainty: [], blockedReason: null })),
      BUILD(implementation([['src/slug.ts', 'MODIFIED']])),
    ]);
    await drain(harness);

    expect(factsOf(harness, 'coder.scope.violated')).toEqual([
      expect.objectContaining({ taskId: 'build-1', path: 'src/persistence/cache.ts', rule: 'OUT_OF_SCOPE', resolvedBy: 'CONTRACT' }),
    ]);
    const scopeEvidence = (await harness.store.evidenceForRun('run-1', 'prj-1')).filter((item) => item.evidenceId.endsWith(':scope'));
    expect(scopeEvidence).toHaveLength(1);
    expect(scopeEvidence[0]).toMatchObject({ taskId: 'build-1', type: 'DIFF', status: 'FAILED' });
    expect(scopeEvidence[0]!.safeSummary).toContain('src/persistence/cache.ts [OUT_OF_SCOPE]');
    // The independent review still happened first; the decision then repaired the work.
    expect(await decisionsOf(harness, 'build-1')).toEqual(['REPAIR:EVIDENCE_FAILED']);
    expect(factsOf(harness, 'coder.implementation.recorded').map((facts) => facts.scopeViolations)).toEqual([1, 0]);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });

  it('a change outside the permitted paths is caught the same way', async () => {
    const harness = build([BUILD(implementation([['src/other.ts', 'MODIFIED']])), BUILD(implementation([['src/slug.ts', 'MODIFIED']]))]);
    await drain(harness);
    expect(factsOf(harness, 'coder.scope.violated')[0]).toMatchObject({ path: 'src/other.ts', rule: 'OUTSIDE_PERMITTED_PATHS' });
    expect(await decisionsOf(harness, 'build-1')).toEqual(['REPAIR:EVIDENCE_FAILED']);
  });

  it('a report that claims completion is refused by name, and the work still stands on its evidence', async () => {
    const harness = build([BUILD(implementation([['src/slug.ts', 'MODIFIED']],
      { outcome: 'COMPLETED', summary: 'Mission complete.', filesTouched: [], testsRun: [], remainingUncertainty: [], blockedReason: null }))]);
    await drain(harness);
    expect(factsOf(harness, 'coder.report.refused')).toEqual([expect.objectContaining({ reasonCode: 'peer_response_mints_julius_only_outcome' })]);
    expect(factsOf(harness, 'coder.implementation.recorded')[0]).toMatchObject({ reportOutcome: null, scopeViolations: 0 });
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });

  it('only a Coding Agent may carry an implementation record', async () => {
    const harness = createJuliusHarness({
      workers: [
        { worker: worker({ workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan'] }), script: [{ kind: 'succeed', evidence: PLAN_EVIDENCE, implementation: implementation([['src/persistence/x.ts', 'MODIFIED']]) }] },
      ],
      card: cardPolicy({ allowedProviders: ['openai'], capabilities: ['plan'] }),
      verification: verificationPolicy({ reviewerRequired: false }),
      capabilityFor,
    });
    harness.store.seedRun(RUN);
    harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
    await drain(harness);
    expect(factsOf(harness, 'worker.channel.refused')).toEqual([expect.objectContaining({ channel: 'implementation', role: 'PROMPT_ARCHITECT' })]);
    expect(factsOf(harness, 'coder.implementation.recorded')).toEqual([]);
  });
});
