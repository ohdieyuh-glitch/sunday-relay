import { describe, expect, it } from 'vitest';

import { juliusAllocationPolicy } from './julius-allocation-runtime';
import { juliusSlotEnvelopePolicy, slotEnvelopeUsdMicros, slotRoundShareUsdMicros } from './julius-slot-envelope';
import { juliusSlotEffortObservation, summarizeJuliusSlotEffort } from './julius-slot-effort';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
} from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * WHAT PAID MISSION 5 ACTUALLY PAID, AND WHAT IT PAYS NOW.
 *
 * Mission 5 authorised $30. Under `julius-allocation.v1` the Coding Agent was
 * allocated $7.50 per round and settled $5.177120. The Prompt Architect twice
 * and the Independent Reviewer three times were each allocated 300,000
 * micro-dollars — thirty cents against the coder's seven dollars fifty, four
 * cents on the dollar — and every one of them settled UNKNOWN. Three peer
 * intelligence slots on the org chart; a dominant coder with two economical
 * bookends in the ledger.
 *
 * These are end-to-end through the real pipeline: the real claim, the real
 * budget port, the real reservation, and the number the adapter is actually
 * handed. What is proven is not that the evaluator computes a third — its own
 * unit suite does that — but that the third REACHES the dispatch.
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
  taskTypes: [
    'review:plan', 'review:build', 'review:guidance',
    'review:repair:plan', 'review:repair:build', 'review:repair:guidance',
  ],
});

const scope = { projectId: 'prj-1' };
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

/** Mission 5's own ceiling. */
const CEILING = 30_000_000;
const REPAIR_ROUNDS = 3;
const SEGMENTS = 4;

const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const BUILD_OK = { kind: 'succeed' as const, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] };
const REVIEW_OK = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] };

const build = (allocation: Parameters<typeof createJuliusHarness>[0]['allocation']) => {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [PLAN_OK] },
      { worker: CODER, script: [BUILD_OK] },
      { worker: REVIEWER, script: [REVIEW_OK] },
    ],
    card: cardPolicy({
      allowedProviders: ['openai', 'anthropic', 'hermes'],
      capabilities: ['plan', 'implement', 'review'], concurrency: 1,
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: REPAIR_ROUNDS }),
    capabilityFor,
    budgetUsdMicros: CEILING,
    ...(allocation === undefined ? {} : { allocation }),
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  return harness;
};

async function drain(harness: ReturnType<typeof createJuliusHarness>, ticks = 24): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    const report = await harness.loop.tick(scope);
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

/** What each adapter was actually told it could spend, in dispatch order. */
const allocatedTo = (harness: ReturnType<typeof createJuliusHarness>, adapterId: string) =>
  harness.adapters.get(adapterId)!.dispatches.map((dispatch) => dispatch.allocation);

describe('the ledger used to disagree with the org chart', () => {
  it('v1 hands the architect and the reviewer a fixed estimate while the coder draws a quarter of the mission', async () => {
    const harness = build(juliusAllocationPolicy({
      ceilingUsdMicros: CEILING, authorizedRepairRounds: REPAIR_ROUNDS,
    }));
    await drain(harness);

    const coder = allocatedTo(harness, 'coder-adapter')[0];
    const architect = allocatedTo(harness, 'architect-adapter')[0];
    const reviewer = allocatedTo(harness, 'reviewer-adapter')[0];

    expect(coder!.usdMicros).toBe(CEILING / (1 + REPAIR_ROUNDS));
    expect(coder!.basis).toBe('CODER_SHARE');
    // THE SHAPE OF THE COMPLAINT, reproduced: both peers get the fixed estimate
    // and nothing about the mission's authorisation reaches them.
    expect(architect!.basis).toBe('ESTIMATE');
    expect(reviewer!.basis).toBe('ESTIMATE');
    expect(architect!.usdMicros / coder!.usdMicros).toBeLessThan(0.05);
    expect(reviewer!.usdMicros / coder!.usdMicros).toBeLessThan(0.05);
  });
});

describe('v2 funds three peers out of one ceiling', () => {
  const policy = () => juliusSlotEnvelopePolicy({
    ceilingUsdMicros: CEILING, authorizedRepairRounds: REPAIR_ROUNDS, maxCoderSegments: SEGMENTS,
  });

  it('reaches every dispatch with that slot\'s own share, not a fixed estimate', async () => {
    const harness = build(policy());
    await drain(harness);

    const coder = allocatedTo(harness, 'coder-adapter')[0];
    const architect = allocatedTo(harness, 'architect-adapter')[0];
    const reviewer = allocatedTo(harness, 'reviewer-adapter')[0];

    for (const allocation of [coder, architect, reviewer]) {
      expect(allocation, 'every slot is allocated').toBeDefined();
      expect(allocation!.policyVersion).toBe('julius-allocation.v2');
      expect(allocation!.basis).toBe('SLOT_SHARE');
    }
    expect(coder!.usdMicros).toBe(slotRoundShareUsdMicros(policy(), 'CODING_AGENT'));
    expect(architect!.usdMicros).toBe(slotRoundShareUsdMicros(policy(), 'PROMPT_ARCHITECT'));
    expect(reviewer!.usdMicros).toBe(slotRoundShareUsdMicros(policy(), 'INDEPENDENT_REVIEWER'));
  });

  it('gives the three slots envelopes within a few percent of each other', async () => {
    // PARITY IS PER SLOT, NOT PER DISPATCH, and the difference matters: the
    // reviewer reviews everything the other two produce, so it has the most
    // dispatches and therefore the smallest share of its own envelope. Funding
    // it per dispatch like the coder is what made it a bookend.
    const envelopes = (['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const)
      .map((slot) => slotEnvelopeUsdMicros(policy(), slot));
    const smallest = Math.min(...envelopes);
    const largest = Math.max(...envelopes);
    expect(largest / smallest).toBeLessThan(1.01);
    expect(envelopes.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(CEILING);
  });

  it('is nowhere near the four-cents-on-the-dollar v1 produced', async () => {
    const harness = build(policy());
    await drain(harness);
    const coder = allocatedTo(harness, 'coder-adapter')[0]!;
    const architect = allocatedTo(harness, 'architect-adapter')[0]!;
    const reviewer = allocatedTo(harness, 'reviewer-adapter')[0]!;
    // Per dispatch the architect now draws half the coder's, and the reviewer a
    // third, because they take more turns out of an equal envelope. Both are
    // real money rather than a rounding error.
    expect(architect.usdMicros / coder.usdMicros).toBeGreaterThan(0.4);
    expect(reviewer.usdMicros / coder.usdMicros).toBeGreaterThan(0.3);
  });

  it('writes the slot, its envelope and the rounds it has used into the ledger', async () => {
    const harness = build(policy());
    await drain(harness);
    const allocated = harness.store.events().filter((event) => event.type === 'budget.allocated');
    expect(allocated.length).toBeGreaterThan(0);
    for (const event of allocated) {
      expect(event.facts.allocationPolicy).toBe('julius-allocation.v2');
      expect(event.facts.slot, 'a reader can see which peer this drew against').toBe(event.facts.role);
      expect(typeof event.facts.slotEnvelopeUsdMicros).toBe('number');
      expect(typeof event.facts.slotRoundsUsed).toBe('number');
    }
    // The FIRST dispatch of a slot has used no rounds; a later one has.
    const architectRounds = allocated
      .filter((event) => event.facts.role === 'PROMPT_ARCHITECT')
      .map((event) => event.facts.slotRoundsUsed);
    expect(architectRounds[0]).toBe(0);
  });

  it('reports null for the slot fields under v1, rather than leaving them out', async () => {
    // A reader comparing two missions should be able to see that one had no
    // slot envelope at all, which an absent field cannot say.
    const harness = build(juliusAllocationPolicy({
      ceilingUsdMicros: CEILING, authorizedRepairRounds: REPAIR_ROUNDS,
    }));
    await drain(harness);
    const allocated = harness.store.events().filter((event) => event.type === 'budget.allocated');
    expect(allocated.length).toBeGreaterThan(0);
    for (const event of allocated) {
      expect(event.facts.allocationPolicy).toBe('julius-allocation.v1');
      expect(event.facts.slot).toBeNull();
      expect(event.facts.slotEnvelopeUsdMicros).toBeNull();
    }
  });
});

/**
 * EFFORT PARITY, MEASURED RATHER THAN ASSUMED.
 *
 * The founder's diagnostic target is that the Architect and the Reviewer sit
 * around 0.8x-1.2x the Coding Agent's effective effort on complex missions —
 * explicitly NOT a quota, and explicitly not a reason to manufacture work. So
 * what is wired is the MEASUREMENT: one row per dispatch, carrying what the
 * provider reported and nothing inferred, which a reader can summarise into a
 * verdict. A number nobody records cannot be a target anybody meets.
 */
describe('every dispatch says what it actually spent, and what it could not measure', () => {
  it('writes one effort row per dispatch, keeping an unreported count as Unknown', async () => {
    const harness = build(juliusSlotEnvelopePolicy({
      ceilingUsdMicros: CEILING, authorizedRepairRounds: REPAIR_ROUNDS, maxCoderSegments: SEGMENTS,
    }));
    await drain(harness);

    const rows = harness.store.events().filter((event) => event.type === 'worker.effort');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(new Set(rows.map((row) => row.facts.role)))
      .toEqual(new Set(['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']));

    for (const row of rows) {
      expect(row.facts.effortVersion).toBe('julius-slot-effort.v1');
      // The scripted adapter reports input and output tokens and nothing else.
      expect(typeof row.facts.inputTokens).toBe('number');
      // UNREPORTED IS NULL. `budget.settled` reads the same usage through a
      // helper that substitutes zero — correct for a ledger that must not
      // over-hold, and fatal here: a parity diagnostic built on substituted
      // zeros calls every silent provider shallow rather than unmeasured.
      expect(row.facts.reasoningTokens).toBeNull();
      expect(row.facts.researchCalls).toBeNull();
    }
  });

  it('summarises those rows through the one mapping that wrote them', async () => {
    const harness = build(juliusSlotEnvelopePolicy({
      ceilingUsdMicros: CEILING, authorizedRepairRounds: REPAIR_ROUNDS, maxCoderSegments: SEGMENTS,
    }));
    await drain(harness);

    const observations = harness.store.events()
      .filter((event) => event.type === 'worker.effort')
      .map((event) => juliusSlotEffortObservation(event.facts))
      .filter((observation): observation is NonNullable<typeof observation> => observation !== null);
    const report = summarizeJuliusSlotEffort(observations);

    expect(report.version).toBe('julius-slot-effort.v1');
    for (const slot of ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const) {
      expect(report.bySlot[slot], slot).toBeDefined();
      // Measured on what was reported, unknown on what was not — the two kept
      // apart, which is the whole reason this is a module and not a counter.
      expect(report.bySlot[slot]!.inputTokens.measured).toBeGreaterThan(0);
      expect(report.bySlot[slot]!.reasoningTokens.unknown).toBeGreaterThan(0);
      expect(report.bySlot[slot]!.reasoningTokens.measured).toBe(0);
    }
    // Under a script where every worker reports the same tokens, the two peers
    // measure as peers. That is not a claim about real missions; it is proof
    // that the ratio is computed from the rows rather than from the role.
    expect(report.ratioToCoder.PROMPT_ARCHITECT).not.toBeNull();
    expect(report.verdict.INDEPENDENT_REVIEWER).toBe('PEER');
  });
});

/**
 * WHY v2 IS BUILT, PROVEN AND NOT YET THE LIVE DEFAULT.
 *
 * A finding, pinned so it is reproducible rather than a claim. Under v1 the
 * Coding Agent's share is the WHOLE ceiling divided by its rounds; under v2 it
 * is a THIRD of the ceiling divided by its rounds. So a slot envelope that
 * funds three peers necessarily cuts the one worker that currently spends real
 * money, and the hosted adapter is handed its allocation as a hard limit.
 *
 * Mission 5's coder settled $5.177120 against a v1 share of $7.50. Under v2's
 * default equal-third split and this round derivation its first dispatch is
 * capped at $2.50 — below what that mission actually cost — and the money the
 * architect and reviewer will not spend is unreachable to it, because
 * reallocation only opens once a slot's OWN envelope is exhausted, which takes
 * four rounds.
 *
 * The founder's directive says Julius optimises cost per VERIFIED SUCCESSFUL
 * mission and that the envelope must never cause synthetic work. An envelope
 * that starves a first build round serves neither, so the rule wants a change
 * — a dispatch drawing from its slot's REMAINING envelope rather than from one
 * round's share — and that trades against having anything left for repairs.
 * That is a decision with evidence behind it, not one to make silently inside
 * a test, so the live composition keeps v1 until it is made.
 */
describe('the envelope has a cost, and here is exactly what it is', () => {
  it('funds the peers by cutting the coder\'s per-round share below what Mission 5 spent', () => {
    const MISSION_5_COST = 5_177_120;
    const v1Share = CEILING / (1 + REPAIR_ROUNDS);
    const v2Share = slotRoundShareUsdMicros(juliusSlotEnvelopePolicy({
      ceilingUsdMicros: CEILING, authorizedRepairRounds: REPAIR_ROUNDS, maxCoderSegments: SEGMENTS,
    }), 'CODING_AGENT');

    expect(v1Share).toBeGreaterThan(MISSION_5_COST);
    expect(v2Share, 'the finding: v2 would have capped that build below its real cost')
      .toBeLessThan(MISSION_5_COST);
    // And the unused peer money is out of reach on that first round, because
    // reallocation opens only after a slot's own envelope is spent.
    expect(v2Share * (1 + REPAIR_ROUNDS)).toBeLessThan(CEILING);
  });

  it('keeps the live composition on v1 until that decision is made', async () => {
    const { assembleLiveJuliusRuntime } = await import('../../../../relay-bridge/julius/live-composition');
    expect(typeof assembleLiveJuliusRuntime, 'the live composition root exists').toBe('function');
    // Read as source rather than by running the assembler, which needs a store,
    // a router and a budget: what is pinned is which rule the live path names.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../../../relay-bridge/julius/live-composition.ts', import.meta.url), 'utf8',
    );
    expect(source, 'the live path still allocates under v1').toContain('juliusAllocationPolicy({');
    expect(source, 'and has not silently switched to v2').not.toContain('juliusSlotEnvelopePolicy({');
  });
});
