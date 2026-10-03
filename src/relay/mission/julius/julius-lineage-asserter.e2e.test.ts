import { describe, expect, it } from 'vitest';

import { JULIUS_RUN_HALTING_FAILURE_CLASSES } from './julius-coding-agent';
import { JULIUS_ACCEPTANCE_INCOMPATIBLE_ROW } from './julius-lineage-asserter';
import { cardPolicy, createJuliusHarness, task, verificationPolicy, worker, type JuliusHarness } from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';
import { seedJuliusTaskContract } from './julius-task-contract';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/**
 * DECISION B'S LIVE CONTRADICTION PATH, THROUGH THE REAL PIPELINE AND RUN LOOP (founder ruling, 2026-10-03).
 *
 * "ACCEPT + OPEN-BLOCKING-VERIFIED = CONTRADICTS = FAIL CLOSED; ACCEPT + RESOLVED = COMPATIBLE. If a live paid run
 * ever reaches the inconsistent state where a task is ACCEPTED while a verified blocking finding remains OPEN: do not
 * silently choose one; do not continue execution as if valid; record the contradiction; halt / fail closed; preserve
 * evidence for review." The normal path never reaches that state (the reviewer cannot accept over an open blocking
 * finding), so each case puts the run there the only way it could happen — a blocking finding recorded about a task
 * AFTER it was accepted — and watches what Julius does next: at the next dispatch, and at completion.
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
const PASS: Step = { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }], answerFindings: 'RESOLVED' };
const REJECT: Step = { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The plan does not name the boundary case.' }] };
const PLAN: Step = { kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const BUILD: Step = { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] };

const build = (input: { architect?: readonly Step[]; reviewer?: readonly Step[] } = {}): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      { worker: worker({ workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'] }), script: input.architect ?? [PLAN] },
      { worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build'] }), script: [BUILD] },
      {
        worker: worker({ workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan'] }),
        script: input.reviewer ?? [PASS, PASS],
      },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  // The coder works only under a locked task contract, as in every live run.
  const seeded = seedJuliusTaskContract({
    runId: 'run-1', taskId: 'build-1', missionContractRevision: 1,
    objective: 'The seeded mission objective.', requirements: ['the seeded requirement'], constraints: ['the seeded constraint'],
    acceptanceCriteria: [{ id: 'criterion-1', text: 'the seeded blocking criterion', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 20, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void harness.store.putTaskContract({ projectId: 'prj-1', contract: seeded.contract, occurredAt: '2026-08-27T00:00:00.000Z' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  return harness;
};

/** A blocking finding about `taskId`, recorded after its acceptance. `evidenceIds` decides whether it stands VERIFIED. */
const lateFinding = (taskId: string, status: JuliusReviewerFinding['status'], evidenceIds: readonly string[] = ['ev-late']): JuliusReviewerFinding => ({
  findingId: `late-${taskId}`, runId: 'run-1', taskId, reviewerWorkerId: 'reviewer', severity: 'HIGH', category: 'correctness',
  claim: 'The work skips the boundary case.', criterionId: null, evidenceIds, blocking: true, status, createdAt: '2026-10-03T12:00:00.000Z',
});
const accepted = async (harness: JuliusHarness, taskId: string): Promise<boolean> =>
  (await harness.store.decisionsForRun('run-1', 'prj-1')).some((decision) => decision.taskId === taskId && decision.action === 'ACCEPT');

/** Ticks the run; the moment `taskId` is accepted, `inject` runs once, before anything else moves. */
async function driveInjecting(harness: JuliusHarness, taskId: string, inject: () => void, ticks = 48): Promise<boolean> {
  let injected = false;
  for (let index = 0; index < ticks; index += 1) {
    const report = await harness.loop.tick({ projectId: 'prj-1' });
    if (!injected && await accepted(harness, taskId)) {
      expect((await harness.store.loadRun('run-1', 'prj-1'))!.state, 'the run is still live when the finding is recorded').not.toBe('COMPLETED');
      inject();
      injected = true;
    }
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
  return injected;
}
const factsOf = (harness: JuliusHarness, type: string) => harness.store.events().filter((event) => event.type === type).map((event) => ({ taskId: event.taskId, facts: event.facts }));

describe('decision B, the live contradiction path (ACCEPT x OPEN-BLOCKING-VERIFIED)', () => {
  it('the halting set is closed and names the clash (pinned: the founder rule decides it, nothing else)', () => {
    expect([...JULIUS_RUN_HALTING_FAILURE_CLASSES]).toEqual(['coder_served_model_mismatch', 'coder_served_model_unattested', 'context_integrity_unresolved_clash']);
  });

  it('AT DISPATCH: an accepted task with a blocking verified finding still open refuses the next packet, records the PAIR and HALTS the run; nothing more is claimed', async () => {
    const harness = build();
    expect(await driveInjecting(harness, 'plan-1', () => harness.store.seedFinding(lateFinding('plan-1', 'OPEN')))).toBe(true);

    const failed = factsOf(harness, 'task.failed').filter((row) => row.facts.failureClass === 'context_integrity_unresolved_clash');
    expect(failed.map((row) => row.taskId), 'the dispatch that met it failed, and only that one').toEqual(['build-1']);
    expect(failed[0]!.facts).toMatchObject({
      code: 'INVALID_REQUEST', errorRetryable: false,
      contradictions: 1, contradictionFamily: 'A', contradictionSubject: 'acceptance:plan-1', contradictionRow: JULIUS_ACCEPTANCE_INCOMPATIBLE_ROW,
      contradictionRight: 'finding:plan-1:late-plan-1|claim:finding:plan-1:late-plan-1|OPEN_BLOCKING_VERIFIED|VERIFIED',
    });
    expect(String(failed[0]!.facts.contradictionLeft)).toMatch(/^brain:decision:plan-1:ACCEPT:[A-Z0-9_]+\|claim:brain:decision:plan-1:ACCEPT:[A-Z0-9_]+\|ACCEPT\|APPROVED$/u);

    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state, 'HALTED, not waiting').toBe('FAILED');
    expect(factsOf(harness, 'run.failed').map((row) => row.facts.reasonCode)).toEqual(['context_integrity_unresolved_clash']);
    expect(factsOf(harness, 'context.compiled').filter((row) => row.taskId === 'build-1'), 'no packet was compiled past it').toEqual([]);
    expect((await harness.loop.tick({ projectId: 'prj-1' })).claimed, 'and the halted run is claimed no further').toBe(0);
  });

  it('THE COMPATIBLE CONTROL: a blocking finding the runtime itself RESOLVED (rejected, repaired, re-reviewed, accepted) disputes nothing, and the run completes', async () => {
    const harness = build({ architect: [PLAN, PLAN], reviewer: [REJECT, PASS, PASS] });
    for (let index = 0; index < 48; index += 1) {
      const report = await harness.loop.tick({ projectId: 'prj-1' });
      if (report.claimed === 0) {
        const advance = await harness.loop.advanceRun('run-1', 'prj-1');
        if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
      }
    }
    expect(factsOf(harness, 'finding.transitioned').some((row) => row.facts.move === 'REVIEWER_RESOLVED' && row.facts.to === 'RESOLVED'), 'the finding was really resolved, by the re-review').toBe(true);
    expect(factsOf(harness, 'task.failed').filter((row) => row.facts.failureClass === 'context_integrity_unresolved_clash')).toEqual([]);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });

  /**
   * NO UNVERIFIED BLOCKING FINDING EXISTS LIVE: the runtime refuses a reviewer finding that cites no evidence
   * (`reviewer_finding_requires_evidence`), so every blocking finding stands VERIFIED from its own record, and the
   * founder's row is the one a live run can reach. The table's NOT_VERIFIED rows (a standing the run demoted) are
   * held by the unit cases.
   */

  it('AT COMPLETION: when the last accepted task is the one disputed, the run ends FAILED — never COMPLETED — with the pair on its terminal event', async () => {
    const harness = build();
    // The finding is recorded the moment build-1's acceptance is: inside the tick that would complete the run.
    const appendDecision = harness.store.appendDecision.bind(harness.store);
    Object.assign(harness.store, {
      appendDecision: async (input: Parameters<typeof appendDecision>[0]) => {
        const appended = await appendDecision(input);
        if (input.taskId === 'build-1' && input.decision.action === 'ACCEPT') harness.store.seedFinding(lateFinding('build-1', 'OPEN'));
        return appended;
      },
    });
    for (let index = 0; index < 48; index += 1) {
      const report = await harness.loop.tick({ projectId: 'prj-1' });
      if (report.claimed === 0) {
        const advance = await harness.loop.advanceRun('run-1', 'prj-1');
        if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
      }
    }
    expect(await accepted(harness, 'build-1'), 'build-1 was accepted').toBe(true);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('FAILED');
    const terminal = factsOf(harness, 'run.failed');
    expect(terminal).toHaveLength(1);
    expect(terminal[0]!.facts).toMatchObject({
      reasonCode: 'context_integrity_unresolved_clash', contradictions: 1, contradictionFamily: 'A', contradictionSubject: 'acceptance:build-1',
      contradictionRow: JULIUS_ACCEPTANCE_INCOMPATIBLE_ROW,
      contradictionRight: 'finding:build-1:late-build-1|claim:finding:build-1:late-build-1|OPEN_BLOCKING_VERIFIED|VERIFIED',
    });
    expect(factsOf(harness, 'run.completed')).toEqual([]);
  });
});
