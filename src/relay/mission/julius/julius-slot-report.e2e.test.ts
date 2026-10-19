import { describe, expect, it } from 'vitest';

import { buildJuliusSlotMissionReport, type JuliusReportRow } from './julius-slot-report';
import { juliusSlotEnvelopePolicy } from './julius-slot-envelope';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
} from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * "WHAT DID EACH OF THE THREE PERSISTENT WORKERS ACTUALLY DO?"
 *
 * Built from a REAL drive through the real pipeline, then read back out of the
 * run's own durable timeline — not from a fixture of rows somebody typed. If
 * the pipeline stops writing a dimension, this fails; if the reader looks for a
 * field under a different name, this fails. That pairing is the whole point:
 * the writer and the reader share one mapping and this proves they still do.
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

const scope = { projectId: 'prj-1' };
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const CEILING = 30_000_000;
const POLICY = () => juliusSlotEnvelopePolicy({
  ceilingUsdMicros: CEILING, authorizedRepairRounds: 3, maxCoderSegments: 4,
});

const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const REVIEW_OK = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] };
/** The coder reports cost; the two peers report none, exactly as in Mission 5. */
const BUILD_OK = { kind: 'succeed' as const, usdMicros: 5_177_120, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] };
const PLAN_NO_COST = { ...PLAN_OK, usdMicros: null };
const REVIEW_NO_COST = { ...REVIEW_OK, usdMicros: null };

async function drive() {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [PLAN_NO_COST] },
      { worker: CODER, script: [BUILD_OK] },
      { worker: REVIEWER, script: [REVIEW_NO_COST] },
    ],
    card: cardPolicy({
      allowedProviders: ['openai', 'anthropic', 'hermes'],
      capabilities: ['plan', 'implement', 'review'], concurrency: 1,
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 3 }),
    capabilityFor: (item: { role: string }) =>
      (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement'),
    allocation: POLICY(),
    budgetUsdMicros: CEILING,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  for (let index = 0; index < 24; index += 1) {
    const report = await harness.loop.tick(scope);
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
  const rows: JuliusReportRow[] = harness.store.events()
    .map((event) => ({ type: event.type, taskId: event.taskId, facts: event.facts }));
  return buildJuliusSlotMissionReport({
    runId: 'run-1', policy: POLICY(), policyVersion: 'julius-allocation.v2',
    ceilingUsdMicros: CEILING, rows,
  });
}

describe('the bundle answers what each persistent worker did', () => {
  it('carries a per-slot entry for all three peers, and the rows behind it', async () => {
    const report = await drive();
    for (const slot of ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const) {
      const entry = report.bySlot[slot];
      expect(entry, slot).toBeDefined();
      expect(entry!.dispatches.length, `${slot} dispatched`).toBeGreaterThan(0);
      expect(entry!.ledger, `${slot} has a money position`).not.toBeNull();
      expect(entry!.effort, `${slot} has a work position`).not.toBeNull();
    }
    // NOTHING IS COLLAPSED. The underlying rows are present, so no reader has
    // to take a total on trust.
    const coder = report.bySlot.CODING_AGENT!;
    expect(coder.dispatches[0]!.facts.effortVersion).toBe('julius-slot-report.v1'.replace('report', 'effort'));
    expect(coder.dispatches[0]!.taskId).toBe('build-1');
  });

  it('reconstructs dispatch counts, tokens, runtime and participation by slot', async () => {
    const report = await drive();
    const reviewer = report.bySlot.INDEPENDENT_REVIEWER!.effort!;
    expect(reviewer.dispatches).toBeGreaterThan(0);
    expect(reviewer.inputTokens.measured).toBe(reviewer.dispatches);
    expect(reviewer.activeMs.measured).toBe(reviewer.dispatches);
    // The reviewer produced REVIEW_FINDING evidence, and the row counted it as
    // a verdict — participation the token stream does not carry.
    expect(reviewer.reviewerVerdicts.total).toBeGreaterThan(0);
    expect(report.bySlot.PROMPT_ARCHITECT!.effort!.reviewerVerdicts.total).toBe(0);
    expect(report.bySlot.CODING_AGENT!.effort!.evidenceGenerated.total).toBeGreaterThan(0);
  });

  it('reports money allocated and money settled, with the confidence of each', async () => {
    const report = await drive();
    const coder = report.bySlot.CODING_AGENT!;
    expect(coder.effort!.allocatedUsdMicros.measured).toBeGreaterThan(0);
    expect(coder.effort!.settledUsdMicros.total).toBe(5_177_120);
    expect(coder.effort!.settlementBases.PROVIDER_REPORTED).toBeGreaterThan(0);

    // THE MISSION 5 SHAPE, and the bundle now states it rather than implying a
    // free architect: the two peers settled with no amount, which is UNKNOWN,
    // and their ledger position charges what they HELD.
    const architect = report.bySlot.PROMPT_ARCHITECT!;
    expect(architect.effort!.settlementBases.UNKNOWN).toBeGreaterThan(0);
    expect(architect.effort!.costUsdMicros.measured).toBe(0);
    expect(architect.ledger!.settledUnknownUsdMicros).toBeGreaterThan(0);
    expect(architect.ledger!.settledKnownUsdMicros).toBe(0);
  });

  it('states the governing policy and the mission capacity left', async () => {
    const report = await drive();
    expect(report.allocation.policyVersion).toBe('julius-allocation.v2');
    expect(report.allocation.recordedPolicyVersions).toEqual(['julius-allocation.v2']);
    expect(report.allocation.historicalPolicyConflict).toBe(false);
    expect(report.allocation.ceilingUsdMicros).toBe(CEILING);
    expect(report.allocation.unallocatedUsdMicros).toBeLessThan(CEILING);
    expect(report.allocation.unallocatedUsdMicros).toBeGreaterThanOrEqual(0);
  });

  it('keeps the derived parity reading beside the raw dimensions, not instead of them', async () => {
    const report = await drive();
    expect(report.parity.observed.CODING_AGENT).toBe('PEER');
    for (const slot of ['PROMPT_ARCHITECT', 'INDEPENDENT_REVIEWER'] as const) {
      expect(['PEER', 'ABOVE_OBSERVED_RANGE', 'BELOW_OBSERVED_RANGE', 'INDETERMINATE'])
        .toContain(report.parity.observed[slot]);
      // And the raw dimensions the verdict was derived from are all still here.
      const effort = report.bySlot[slot]!.effort!;
      expect(effort.inputTokens).toBeDefined();
      expect(effort.outputTokens).toBeDefined();
      expect(effort.toolCalls).toBeDefined();
      expect(effort.researchCalls).toBeDefined();
      expect(effort.checkpoints).toBeDefined();
    }
  });

  it('gives a peer slot that never dispatched an entry rather than omitting it', async () => {
    // A mission where the architect never ran is exactly the finding this
    // report exists to surface, and a missing key reads as an oversight.
    const report = buildJuliusSlotMissionReport({
      runId: 'run-1', policy: POLICY(), policyVersion: 'julius-allocation.v2',
      ceilingUsdMicros: CEILING, rows: [],
    });
    for (const slot of ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const) {
      expect(report.bySlot[slot], slot).toBeDefined();
      expect(report.bySlot[slot]!.dispatches).toEqual([]);
      expect(report.bySlot[slot]!.effort).toBeNull();
    }
  });
});

/**
 * FOUR MORE CASES FOUR SURVIVING MUTATIONS EXPOSED.
 *
 * Each names a guard that could be deleted without any assertion noticing.
 */
describe('the bundle distinguishes what was permitted from what was spent', () => {
  it('never reports the allocation as if it were the settlement', () => {
    // A mutation that copied `allocatedUsdMicros` from the settled amount
    // survived: the coder happened to settle a number, so both fields agreed
    // and no assertion could tell them apart. They answer different questions —
    // what Julius PERMITTED and what came BACK — and a bundle that conflated
    // them would report every mission as having spent exactly its allocation.
    const report = buildJuliusSlotMissionReport({
      runId: 'run-1', policy: POLICY(), policyVersion: 'julius-allocation.v2',
      ceilingUsdMicros: CEILING,
      rows: [
        {
          type: 'worker.effort', taskId: 'build-1',
          facts: {
            role: 'CODING_AGENT', taskType: 'build', inputTokens: 10,
            allocatedUsdMicros: 2_499_750, settledUsdMicros: 5_177_120,
            usdMicros: 5_177_120, settlementBasis: 'PROVIDER_REPORTED',
          },
        },
        {
          type: 'worker.effort', taskId: 'plan-1',
          facts: {
            role: 'PROMPT_ARCHITECT', taskType: 'plan', inputTokens: 10,
            allocatedUsdMicros: 1_250_250, settledUsdMicros: null,
            usdMicros: null, settlementBasis: 'UNKNOWN',
          },
        },
      ],
    });
    const coder = report.bySlot.CODING_AGENT!.effort!;
    expect(coder.allocatedUsdMicros.total).toBe(2_499_750);
    expect(coder.settledUsdMicros.total).toBe(5_177_120);
    expect(coder.allocatedUsdMicros.total).not.toBe(coder.settledUsdMicros.total);

    // The architect was PERMITTED a real amount and SETTLED nothing anybody
    // could name. Both facts survive, and neither becomes the other.
    const architect = report.bySlot.PROMPT_ARCHITECT!.effort!;
    expect(architect.allocatedUsdMicros).toEqual({ total: 1_250_250, measured: 1, unknown: 0 });
    expect(architect.settledUsdMicros).toEqual({ total: 0, measured: 0, unknown: 1 });
  });

  it('counts a dispatch whose settlement basis nobody recorded as UNKNOWN', () => {
    // Skipping it would report a mission whose costs were better understood
    // than they were.
    const report = buildJuliusSlotMissionReport({
      runId: 'run-1', policy: POLICY(), policyVersion: 'julius-allocation.v2',
      ceilingUsdMicros: CEILING,
      rows: [{
        type: 'worker.effort', taskId: 'build-1',
        facts: { role: 'CODING_AGENT', taskType: 'build', inputTokens: 10 },
      }],
    });
    expect(report.bySlot.CODING_AGENT!.effort!.settlementBases).toEqual({ UNKNOWN: 1 });
  });

  it('reports a v1 run under v1 and says the accounts are descriptive', () => {
    const report = buildJuliusSlotMissionReport({
      runId: 'run-1', policy: POLICY(), policyVersion: 'julius-allocation.v2',
      ceilingUsdMicros: CEILING,
      rows: [
        { type: 'budget.allocated', taskId: 'build-1', facts: { role: 'CODING_AGENT', allocationPolicy: 'julius-allocation.v1' } },
        { type: 'budget.reserved', taskId: 'build-1', facts: { reservationId: 'r1', role: 'CODING_AGENT', usdMicros: 7_500_000 } },
        { type: 'budget.settled', taskId: 'build-1', facts: { reservationId: 'r1', role: 'CODING_AGENT', usdMicros: 5_177_120, costBasis: 'PROVIDER_REPORTED', released: false } },
      ],
    });
    expect(report.allocation.recordedPolicyVersions).toEqual(['julius-allocation.v1']);
    expect(report.allocation.historicalPolicyConflict).toBe(true);
    // The money is still reported — a historical run's spend is real.
    expect(report.bySlot.CODING_AGENT!.ledger!.settledKnownUsdMicros).toBe(5_177_120);
  });
});

/**
 * PARTICIPATION — the half of "what did this slot do" that is not a token count.
 *
 * Questions D and E of the paid-proof design ("did the reviewer independently
 * challenge rather than trust the architect", "did causal checkpoint barriers
 * actually affect coder progression") are answerable ONLY from rows the report
 * used to discard. `checkpoint.recorded`, `checkpoint.verdict` and
 * `contract.disposition` have been written durably for some time; nothing read
 * them back per slot, so the bundle could say precisely what a slot spent and
 * not whether it had ever stopped, asked, or been made to wait.
 */
describe('a checkpoint is attributed to the slot that raised it', () => {
  async function driveWithCheckpoint() {
    const harness = createJuliusHarness({
      workers: [
        { worker: ARCHITECT, script: [PLAN_NO_COST, { ...PLAN_NO_COST, guidance: {
          subObjective: 'Reuse the existing reader.', relevantRequirements: ['R1'],
          constraints: ['no second buffer'], doNot: ['add a dependency'],
        } }] },
        // THE CODER ASKS, and then finishes on the continuation.
        { worker: CODER, script: [{ ...BUILD_OK, guidanceRequest: {
          question: 'Should the normalizer reuse the journal reader?',
          blockedOn: ['the 8KiB boundary case'],
          attempted: ['a second buffer, which double-buffers'],
          relevantPaths: ['src/relay/persistence/journal.ts'],
        } }, BUILD_OK] },
        { worker: REVIEWER, script: [REVIEW_NO_COST] },
      ],
      card: cardPolicy({
        allowedProviders: ['openai', 'anthropic', 'hermes'],
        capabilities: ['plan', 'implement', 'review'], concurrency: 1,
      }),
      verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 3 }),
      capabilityFor: (item: { role: string }) =>
        (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement'),
      allocation: POLICY(),
      budgetUsdMicros: CEILING,
    });
    harness.store.seedRun(RUN);
    seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
    harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
    harness.store.seedTask('run-1', task({
      taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
      state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
    }));
    harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
    for (let index = 0; index < 24; index += 1) {
      const report = await harness.loop.tick(scope);
      if (report.claimed === 0) {
        const advance = await harness.loop.advanceRun('run-1', 'prj-1');
        if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
      }
    }
    const rows: JuliusReportRow[] = harness.store.events()
      .map((event) => ({ type: event.type, taskId: event.taskId, facts: event.facts }));
    return {
      harness,
      report: buildJuliusSlotMissionReport({
        runId: 'run-1', policy: POLICY(), policyVersion: 'julius-allocation.v2',
        ceilingUsdMicros: CEILING, rows,
      }),
    };
  }

  it('reads the coder asking, and the route Julius chose, off the run itself', async () => {
    const { harness, report } = await driveWithCheckpoint();
    // The run really did record one — otherwise this proves nothing about the
    // reader, only that zero equals zero.
    const recorded = harness.store.events().filter((event) => event.type === 'checkpoint.recorded');
    expect(recorded.length, 'the drive raised a checkpoint').toBeGreaterThan(0);

    const coder = report.bySlot.CODING_AGENT!.participation;
    expect(coder.checkpointsRaised, 'attributed to the slot that asked').toBe(recorded.length);
    expect(Object.keys(coder.routes).length, 'and Julius ruled on it').toBeGreaterThan(0);
    expect(coder.rows.length).toBeGreaterThan(0);

    // NOT TO THE PEERS. The subject task is the asker's; a reader that
    // attributed by "whoever was dispatched nearby" would land here.
    expect(report.bySlot.PROMPT_ARCHITECT!.participation.checkpointsRaised).toBe(0);
    expect(report.bySlot.INDEPENDENT_REVIEWER!.participation.checkpointsRaised).toBe(0);
    expect(report.unattributedCheckpoints, 'every checkpoint found its slot').toEqual([]);
  });

  it('counts a barrier and the continuation it minted, from the row that says so', async () => {
    const { harness, report } = await driveWithCheckpoint();
    const verdicts = harness.store.events().filter((event) => event.type === 'checkpoint.verdict');
    const barriers = verdicts.filter((event) => event.facts.barrier === true);
    const minted = verdicts.filter((event) => typeof event.facts.continuationTaskId === 'string'
      && String(event.facts.continuationTaskId).length > 0);

    const coder = report.bySlot.CODING_AGENT!.participation;
    expect(coder.barriers).toBe(barriers.length);
    expect(coder.continuations).toBe(minted.length);
    // E, ANSWERED FROM THE BUNDLE: the barrier stopped the coder AND gave it
    // somewhere to resume. A barrier that minted nothing is a stall, and these
    // are two counts rather than one so the difference is visible.
    expect(coder.barriers, 'the coder was actually made to wait').toBeGreaterThan(0);
    expect(coder.continuations, 'and the wait produced work to come back to').toBeGreaterThan(0);
  });
});

describe('the report will not guess whose act a row was', () => {
  const effortRow = (taskId: string, role: string): JuliusReportRow => ({
    type: 'worker.effort', taskId, facts: { role, taskType: 'build', effortVersion: 'julius-slot-effort.v1' },
  });
  const build = (rows: readonly JuliusReportRow[]) => buildJuliusSlotMissionReport({
    runId: 'run-1', policy: POLICY(), policyVersion: 'julius-allocation.v2',
    ceilingUsdMicros: CEILING, rows,
  });

  it('reports a checkpoint whose subject never recorded a dispatch, rather than placing it', () => {
    const report = build([
      effortRow('build-1', 'CODING_AGENT'),
      // A task that died before emitting an effort row. Its checkpoint is real.
      { type: 'checkpoint.recorded', taskId: 'build-9', facts: { checkpointId: 'cp-9' } },
    ]);
    expect(report.unattributedCheckpoints.length, 'surfaced, not dropped').toBe(1);
    for (const slot of Object.values(report.bySlot)) {
      expect(slot.participation.checkpointsRaised, `${slot.slot} was not handed it`).toBe(0);
    }
  });

  it('does not credit the subject slot with the evaluator\'s disposition', () => {
    const report = build([
      effortRow('build-1', 'CODING_AGENT'),
      effortRow('review-1', 'INDEPENDENT_REVIEWER'),
      // WRITTEN AGAINST THE SUBJECT TASK, which is the coder's. Attributing by
      // task id would report the coder as having challenged its own contract.
      { type: 'contract.disposition', taskId: 'build-1', facts: { disposition: 'CHALLENGE', evaluatorId: 'reviewer' } },
      { type: 'contract.disposition', taskId: 'build-1', facts: { disposition: 'NO_CHALLENGE', evaluatorId: 'reviewer' } },
    ]);
    expect(report.dispositions.byVerdict).toEqual({ CHALLENGE: 1, NO_CHALLENGE: 1 });
    expect(report.dispositions.byEvaluator.reviewer).toEqual({ CHALLENGE: 1, NO_CHALLENGE: 1 });
    expect(report.dispositions.rows.length).toBe(2);
    // The evaluator is reported by ID, never as a role: nothing in these rows
    // says what role `reviewer` holds, and the report does not invent one.
    expect(Object.keys(report.dispositions.byEvaluator)).toEqual(['reviewer']);
  });

  it('counts each checkpoint once however often its row is replayed', () => {
    const report = build([
      effortRow('build-1', 'CODING_AGENT'),
      { type: 'checkpoint.recorded', taskId: 'build-1', facts: { checkpointId: 'cp-1' } },
      { type: 'checkpoint.recorded', taskId: 'build-1', facts: { checkpointId: 'cp-1' } },
      { type: 'checkpoint.recorded', taskId: 'build-1', facts: { checkpointId: 'cp-2' } },
    ]);
    expect(report.bySlot.CODING_AGENT!.participation.checkpointsRaised).toBe(2);
  });

  it('records a routing decision that stated no barrier without calling it one', () => {
    const report = build([
      effortRow('build-1', 'CODING_AGENT'),
      { type: 'checkpoint.recorded', taskId: 'build-1', facts: { checkpointId: 'cp-1' } },
      // The early-return verdict path writes route and reason and no `barrier`.
      { type: 'checkpoint.verdict', taskId: 'build-1', facts: { checkpointId: 'cp-1', route: 'CONTINUE', reasonCode: 'no_question' } },
    ]);
    const coder = report.bySlot.CODING_AGENT!.participation;
    expect(coder.routes, 'the decision is on the record').toEqual({ CONTINUE: 1 });
    expect(coder.barriers, 'an absent flag is not a barrier').toBe(0);
    expect(coder.continuations, 'and minted nothing').toBe(0);
  });
});
