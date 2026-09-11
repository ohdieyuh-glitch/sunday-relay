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
