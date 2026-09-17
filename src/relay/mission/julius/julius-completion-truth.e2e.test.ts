import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { foldJuliusFindings } from './julius-finding-lifecycle';
import { juliusArchitectureCheckTaskId, juliusArchitectureTriggerId } from './julius-architecture-drift';
import { juliusArchitectureEntryId } from './julius-architecture-state';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * COMPLETION TRUTH.
 *
 * Three ways a Julius run could claim something the record does not support,
 * each reproduced on main 5c53cb93 before it was fixed:
 *   1. a repair ran, its re-review said nothing about the finding, and the run
 *      COMPLETED with the finding still ADDRESSED;
 *   2. a second run in the same store could not create its own final
 *      architecture check, recorded it as unserved, and completed unchecked;
 *   3. a reviewer paused for research, the research failed, and its paused
 *      dispatch counted as a review — the plan was accepted and the Coding Agent
 *      dispatched and paid before the run failed anyway.
 *
 * Provider-free: every worker answers from a script, and a reviewer answers
 * findings only by the ids its own compiled packet shows it.
 */

type Step = Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number];

const run = (runId: string): JuliusRunRow => ({
  runId, missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
});
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'NULL renders as the literal word, so AC-1 fails.' }];
const NEW_PROBLEM = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The NULL case is fixed; the column order is now wrong.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
/** First-round approval: there is nothing to answer yet. */
const PASS: Step = { kind: 'succeed', evidence: PASSED_REVIEW };
/** A re-review that passes and says NOTHING about the finding it was charged with. */
const SILENT: Step = { kind: 'succeed', evidence: PASSED_REVIEW };
const REJECT: Step = { kind: 'succeed', evidence: FAILED_REVIEW };
const RESOLVES: Step = { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' };
const MAINTAINS: Step = { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'OPEN' };

const ARCHITECTURE = {
  components: [{ name: 'normalizer', responsibility: 'Turns a journal page into rows.' }],
  boundaries: [], dependencies: [], decisions: [],
  assumptions: [], openQuestions: [], risks: [],
};
const ALIGNED = { assessment: 'ALIGNED', claim: 'What was built matches the design.', drift: [], driftingTaskIds: [], evidenceRefs: [] };

const FINDING_1 = 'finding:build-1:review:1:0';

function harnessWith(scripts: {
  readonly architect?: readonly Step[];
  readonly coder?: readonly Step[];
  readonly reviewer: readonly Step[];
  readonly research?: boolean;
  readonly maxRepairRounds?: number;
}): JuliusHarness {
  return createJuliusHarness({
    workers: [
      {
        worker: worker({ workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan', 'repair:plan', 'architecture'] }),
        script: scripts.architect ?? [{ kind: 'succeed', evidence: PLAN_EVIDENCE }],
      },
      {
        worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }),
        script: scripts.coder ?? [{ kind: 'succeed', evidence: BUILD_EVIDENCE }],
      },
      {
        worker: worker({
          workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'],
          taskTypes: ['review:plan', 'review:build', 'review:architecture', 'review:repair:plan', 'review:repair:build'],
        }),
        script: scripts.reviewer,
      },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: scripts.maxRepairRounds ?? 3 }),
    capabilityFor,
    ...(scripts.research === true ? {
      research: {
        async serve(request: { asks: readonly { reference: string; purpose: string }[] }) {
          return request.asks.map((ask) => ({
            outcome: 'observed' as const, reference: ask.reference, purpose: ask.purpose,
            rendered: '<<<RELAY-EVIDENCE\nNULL renders as an empty field.\nRELAY-EVIDENCE>>>',
            detail: 'The source answered.', evidenceId: 'ev-research', injectionSignals: [], mayCorroborate: true,
          }));
        },
      } as never,
    } : {}),
  });
}

/** Plan → build → deploy, one run; `deploy-1` exists so "nothing downstream was released" is observable. */
function seedMission(harness: JuliusHarness, runId: string, suffix = '1', deploy = true): void {
  harness.store.seedRun(run(runId));
  seedTaskContractInto(harness.store, { runId, projectId: 'prj-1', taskId: `build-${suffix}` });
  harness.store.seedTask(runId, task({ taskId: `plan-${suffix}`, ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask(runId, task({ taskId: `build-${suffix}`, ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: [`plan-${suffix}`], requiredEvidenceTypes: ['TEST'] }));
  if (deploy) {
    seedTaskContractInto(harness.store, { runId, projectId: 'prj-1', taskId: `deploy-${suffix}` });
    harness.store.seedTask(runId, task({ taskId: `deploy-${suffix}`, ordinal: 2, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: [`build-${suffix}`], requiredEvidenceTypes: ['TEST'] }));
  }
  harness.store.seedCriteria(runId, [{ criterionId: `ac-${suffix}`, description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
}

async function drain(harness: JuliusHarness, runId: string, ticks = 64): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    let report;
    try {
      report = await harness.loop.tick({ projectId: 'prj-1' });
    } catch {
      continue; // a crash mid-tick is a process dying; the next tick is the restart
    }
    if (report.claimed === 0) {
      let advance;
      try {
        advance = await harness.loop.advanceRun(runId, 'prj-1');
      } catch {
        continue;
      }
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

const rows = (harness: JuliusHarness, runId = 'run-1') => harness.store.events()
  .filter((event) => event.runId === runId).map((event) => ({ type: event.type, facts: event.facts, taskId: event.taskId }));
const factsOf = (harness: JuliusHarness, type: string, runId = 'run-1') => rows(harness, runId).filter((row) => row.type === type).map((row) => row.facts);
const stateOf = async (harness: JuliusHarness, runId = 'run-1') => (await harness.store.loadRun(runId, 'prj-1'))!.state;
const lives = async (harness: JuliusHarness, runId = 'run-1') =>
  foldJuliusFindings(await harness.store.findingsForRun(runId, 'prj-1'), rows(harness, runId));
const decisionsOf = async (harness: JuliusHarness, runId = 'run-1') =>
  (await harness.store.decisionsForRun(runId, 'prj-1')).map((row) => `${row.taskId}:${row.action}:${row.reasonCode}`);
const claimed = (harness: JuliusHarness, taskId: string) =>
  harness.store.events().some((event) => event.type === 'task.claimed' && event.taskId === taskId);

/* ================================================================ 1. findings */

describe('C1 — a finding the lifecycle says is unresolved never lets a run complete', () => {
  it('A/D. a repair whose re-review is silent: the finding stays ADDRESSED, the silence is refused by name, nothing downstream is released, and the run is held FINDINGS_UNRESOLVED', async () => {
    const harness = harnessWith({ reviewer: [PASS, REJECT, SILENT] });
    seedMission(harness, 'run-1');
    await drain(harness, 'run-1');

    expect((await lives(harness)).map((life) => [life.findingId, life.state])).toEqual([[FINDING_1, 'ADDRESSED']]);
    expect(factsOf(harness, 'review.verdict.refused')).toEqual([
      expect.objectContaining({ reasonCode: 'review_resolution_missing', findingId: FINDING_1, reviewTaskId: 'repair:build-1:1:task:review' }),
    ]);
    expect(await decisionsOf(harness)).toEqual([
      'plan-1:ACCEPT:TASK_VERIFIED', 'build-1:REPAIR:BLOCKING_FINDINGS', 'repair:build-1:1:task:HALT:FINDINGS_UNRESOLVED',
    ]);
    expect(claimed(harness, 'deploy-1'), 'work that depends on an unresolved build is not released').toBe(false);
    // Held, and the record says why: the dependent deploy cannot progress, and the reason is the finding.
    expect(await stateOf(harness)).toBe('BLOCKED');
    expect((await harness.loop.advanceRun('run-1', 'prj-1'))!.reasonCode).toBe('FINDINGS_UNRESOLVED');
    expect(harness.store.events().filter((event) => event.type === 'run.completed')).toEqual([]);
  });

  it('B. the re-review RESOLVES the finding by id: it is RESOLVED by that review, and the run completes', async () => {
    const harness = harnessWith({ reviewer: [PASS, REJECT, RESOLVES, PASS] });
    seedMission(harness, 'run-1');
    await drain(harness, 'run-1');

    expect((await lives(harness))[0]).toMatchObject({
      findingId: FINDING_1, state: 'RESOLVED', resolutionReviewTaskId: 'repair:build-1:1:task:review', repairTaskIds: ['repair:build-1:1:task'],
    });
    expect(factsOf(harness, 'review.verdict.refused')).toEqual([]);
    expect(claimed(harness, 'deploy-1')).toBe(true);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('D. the re-review says it is still OPEN: another round answers it — the maintained finding is shown again and must be resolved', async () => {
    const harness = harnessWith({ reviewer: [PASS, REJECT, MAINTAINS, RESOLVES, PASS] });
    seedMission(harness, 'run-1');
    await drain(harness, 'run-1');

    const life = (await lives(harness))[0]!;
    expect(life).toMatchObject({ findingId: FINDING_1, state: 'RESOLVED', resolutionReviewTaskId: 'repair:repair:build-1:1:task:2:task:review' });
    expect(life.repairTaskIds).toEqual(['repair:build-1:1:task', 'repair:repair:build-1:1:task:2:task']);
    expect(await decisionsOf(harness)).toContain('repair:build-1:1:task:REPAIR:BLOCKING_FINDINGS');
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('C. a legitimate supersession names the finding that replaces it, and the replacement must itself be resolved', async () => {
    const harness = harnessWith({
      reviewer: [
        PASS, REJECT,
        // The re-review finds the original problem gone and a new one in its place.
        { kind: 'succeed', evidence: NEW_PROBLEM, reviewVerdict: { verdict: 'REPAIR_REQUIRED', claim: 'A new problem replaced the old one.', resolutions: [{ findingId: FINDING_1, status: 'SUPERSEDED', claim: 'Replaced by the column-order finding.' }] } },
        RESOLVES, PASS,
      ],
    });
    seedMission(harness, 'run-1');
    await drain(harness, 'run-1');

    const byId = new Map((await lives(harness)).map((life) => [life.findingId, life]));
    const replacement = 'finding:repair:build-1:1:task:review:1:0';
    expect(byId.get(FINDING_1)).toMatchObject({ state: 'SUPERSEDED', supersededByFindingId: replacement });
    expect(byId.get(replacement)).toMatchObject({ state: 'RESOLVED' });
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('a finding raised on an earlier round is shown to, and must be answered by, the last round\'s review', async () => {
    const harness = harnessWith({
      coder: [{ kind: 'succeed', evidence: BUILD_EVIDENCE }],
      // Round 1's review raises a second problem and leaves the first ADDRESSED; round 2's review must answer both.
      reviewer: [PASS, REJECT, REJECT, RESOLVES, PASS],
    });
    seedMission(harness, 'run-1');
    await drain(harness, 'run-1');

    const all = await lives(harness);
    expect(all.map((life) => [life.findingId, life.state]).sort()).toEqual([
      [FINDING_1, 'RESOLVED'], ['finding:repair:build-1:1:task:review:1:0', 'RESOLVED'],
    ]);
    const lastReview = harness.store.contexts().filter((snapshot) => snapshot.taskId === 'repair:repair:build-1:1:task:2:task:review').at(-1)!;
    const shown = lastReview.packet.blocks.map((block) => block.text).join('\n');
    expect(shown, 'the first finding, addressed two rounds ago, is still in front of the reviewer').toContain(FINDING_1);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('H. replayed advances and a restart write no second refusal and move nothing', async () => {
    const harness = harnessWith({ reviewer: [PASS, REJECT, SILENT] });
    seedMission(harness, 'run-1');
    await drain(harness, 'run-1');
    const before = { refusals: factsOf(harness, 'review.verdict.refused').length, moves: factsOf(harness, 'finding.transitioned').length, decisions: await decisionsOf(harness) };
    harness.store.restart();
    for (let index = 0; index < 4; index += 1) await harness.loop.advanceRun('run-1', 'prj-1');
    expect({ refusals: factsOf(harness, 'review.verdict.refused').length, moves: factsOf(harness, 'finding.transitioned').length, decisions: await decisionsOf(harness) }).toEqual(before);
    expect(await stateOf(harness)).toBe('BLOCKED');
  });

  it('A. with nothing depending on the build, the run stops VERIFYING — and still names the finding, never COMPLETED', async () => {
    const harness = harnessWith({ reviewer: [PASS, REJECT, SILENT] });
    seedMission(harness, 'run-1', '1', false);
    await drain(harness, 'run-1');
    expect(await stateOf(harness)).toBe('VERIFYING');
    expect((await harness.loop.advanceRun('run-1', 'prj-1'))!.reasonCode).toBe('FINDINGS_UNRESOLVED');
  });
});

/* ================================================================ 2. run-scoped identity */

describe('C2 — two runs in one store each get their own architecture state and their own final check', () => {
  const plan: Step = { kind: 'succeed', evidence: PLAN_EVIDENCE, architecture: ARCHITECTURE };
  const consult: Step = { kind: 'succeed', evidence: PLAN_EVIDENCE, architecture: ARCHITECTURE, consistency: ALIGNED };

  it('E. RUN A and RUN B: distinct check tasks, both served, both assessed, both architecture entries written and shown to their own coder', async () => {
    const harness = harnessWith({ architect: [plan, consult, plan, consult], reviewer: [PASS] });
    seedMission(harness, 'run-a', 'a', false);
    await drain(harness, 'run-a');
    seedMission(harness, 'run-b', 'b', false);
    await drain(harness, 'run-b');

    const triggerId = juliusArchitectureTriggerId('PRE_COMPLETION_CHECK', 1, null);
    for (const runId of ['run-a', 'run-b']) {
      expect(factsOf(harness, 'architecture.trigger.raised', runId)).toEqual([
        expect.objectContaining({ trigger: 'PRE_COMPLETION_CHECK', served: true, created: true, unroutable: false, servedByTaskId: juliusArchitectureCheckTaskId(runId, triggerId) }),
      ]);
      expect(factsOf(harness, 'architecture.assessed', runId)).toHaveLength(1);
      expect(harness.store.taskRow(juliusArchitectureCheckTaskId(runId, triggerId))).not.toBeNull();
      const entries = await harness.store.brainEntriesForRun(runId, 'prj-1');
      expect(entries.map((entry) => entry.entryId)).toContain(juliusArchitectureEntryId(runId, 1));
      expect(await stateOf(harness, runId)).toBe('COMPLETED');
    }
    const coderB = harness.store.contexts().filter((snapshot) => snapshot.taskId === 'build-b').at(-1)!;
    expect(coderB.sourceEntryIds, 'run B\'s coder is shown run B\'s design').toContain(juliusArchitectureEntryId('run-b', 1));
  });

  it('H. a crash between minting the check and recording it: the replay finds its own task, says served, and creates nothing twice', async () => {
    const harness = harnessWith({ architect: [plan, consult], reviewer: [PASS] });
    seedMission(harness, 'run-1', '1', false);
    const append = harness.store.appendEvent.bind(harness.store);
    let crashed = false;
    harness.store.appendEvent = async (event) => {
      if (!crashed && event.type === 'architecture.trigger.raised') {
        crashed = true;
        throw new Error('process died after the check task was inserted');
      }
      return append(event);
    };
    await drain(harness, 'run-1');

    expect(crashed).toBe(true);
    const checkId = juliusArchitectureCheckTaskId('run-1', juliusArchitectureTriggerId('PRE_COMPLETION_CHECK', 1, null));
    expect((await harness.store.tasksForRun('run-1', 'prj-1')).filter((item) => item.taskId === checkId)).toHaveLength(1);
    expect(factsOf(harness, 'architecture.trigger.raised')).toEqual([
      expect.objectContaining({ served: true, created: false, unroutable: false, servedByTaskId: checkId }),
    ]);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });
});

/* ================================================================ 3. reviewer research */

describe('C3 — a review whose research failed is not a review', () => {
  const ASKS = [{ source: 'web', capability: 'read_item', reference: 'https://www.postgresql.org/docs/current/app-psql.html', purpose: 'Whether NULL renders as empty.' }];

  it('G. no acceptance, no Coding Agent dispatch, no fabricated verdict — and the reason is on the record, once', async () => {
    const harness = harnessWith({
      research: true,
      reviewer: [
        // Sounds like an approval, and asks to check first.
        { kind: 'succeed', evidence: PASSED_REVIEW, researchAsks: ASKS, segmentResume: { completedSoFar: ['read the plan'], nextIntent: 'judge against the manual' } },
        // The continuation that would have judged with the answer fails.
        { kind: 'fail', code: 'WORKER_EXECUTION_FAILURE', runtimeStarted: true },
        PASS,
      ],
    });
    seedMission(harness, 'run-1');
    await drain(harness, 'run-1');
    for (let index = 0; index < 3; index += 1) await harness.loop.advanceRun('run-1', 'prj-1');

    expect(harness.store.taskRow('segment:plan-1:review:2:task')!.state).toBe('FAILED');
    expect(await decisionsOf(harness), 'nothing was decided on a review that never concluded').toEqual([]);
    expect(factsOf(harness, 'review.verdict.applied'), 'what it said before it looked was never applied').toEqual([]);
    expect(claimed(harness, 'build-1'), 'the Coding Agent was never dispatched').toBe(false);
    expect(harness.adapters.get('coder-adapter')!.dispatches).toEqual([]);
    expect(factsOf(harness, 'review.verdict.refused')).toEqual([
      expect.objectContaining({ reasonCode: 'review_research_continuation_failed', reviewTaskId: 'plan-1:review', failedSegmentTaskId: 'segment:plan-1:review:2:task' }),
    ]);
    expect(await stateOf(harness), 'failed, not waiting on a review that can never come').toBe('FAILED');
  });

  it('a review whose research SUCCEEDED concludes as before, and its researched verdict decides the work', async () => {
    const harness = harnessWith({
      research: true,
      reviewer: [
        { kind: 'succeed', evidence: PASSED_REVIEW, researchAsks: ASKS, segmentResume: { completedSoFar: ['read the plan'], nextIntent: 'judge against the manual' } },
        PASS, PASS,
      ],
    });
    seedMission(harness, 'run-1', '1', false);
    await drain(harness, 'run-1');
    expect(await decisionsOf(harness)).toContain('plan-1:ACCEPT:TASK_VERIFIED');
    expect(claimed(harness, 'build-1')).toBe(true);
    expect(factsOf(harness, 'review.verdict.refused')).toEqual([]);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });
});
