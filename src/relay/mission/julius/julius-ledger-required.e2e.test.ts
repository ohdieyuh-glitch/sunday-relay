import { describe, expect, it } from 'vitest';

import { JuliusRunLoop } from './julius-run-loop';
import type { JuliusTimelineReader } from './julius-runtime-api';
import { JULIUS_WITHOUT_LEDGER_RULES, juliusSharedCeilingPolicy } from './julius-shared-ceiling';
import {
  cardPolicy, createJuliusHarness, seedRun, seedTaskContractInto, task, verificationPolicy, worker,
} from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * A PAID MISSION DOES NOT SPEND AT A FIGURE NOBODY CHOSE.
 *
 * Allocation v3 decides against what every slot currently holds, which only the
 * spend ledger can say. When no ledger could be read it used to hand every
 * dispatch the composition's fixed estimate under the basis
 * `ESTIMATE_NO_LEDGER`. In the live composition that estimate is 300,000
 * micro-dollars, and Lab run 34739303313 is what it costs: a twenty-dollar
 * mission whose coder the runtime stopped after two turns at thirty cents.
 *
 * The rule is now policy data. `ESTIMATE` keeps the old behaviour for every
 * composition that binds no timeline and says nothing; `DENY` funds nothing, so
 * the dispatch is refused before any provider is reached and the refusal says
 * why. The paid entrypoint says `DENY`.
 *
 * End to end through the real pipeline: the real claim, allocation, budget
 * port and the adapter a dispatch would actually reach.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'],
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
});

const CEILING = 20_000_000;
const REPAIR_ROUNDS = 2;
const scope = { projectId: 'prj-1' };
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};
const capabilityFor = (item: { role: string }) => (item.role === 'PROMPT_ARCHITECT' ? 'plan' : 'implement');

const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const BUILD_OK = { kind: 'succeed' as const, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] };

type WithoutLedger = (typeof JULIUS_WITHOUT_LEDGER_RULES)[number] | undefined;

/**
 * A plan then a build, allocated under v3, with the timeline reader either
 * bound to the store (the ledger is readable) or absent (it is not).
 */
function composed(input: { withoutLedger: WithoutLedger; timeline: 'BOUND' | 'ABSENT' | JuliusTimelineReader }) {
  const harness = createJuliusHarness({
    workers: [{ worker: ARCHITECT, script: [PLAN_OK] }, { worker: CODER, script: [BUILD_OK] }],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic'], capabilities: ['plan', 'implement'], concurrency: 1 }),
    verification: verificationPolicy({ reviewerRequired: false, maxRepairRounds: REPAIR_ROUNDS }),
    capabilityFor,
    budgetUsdMicros: CEILING,
  });
  const policy = juliusSharedCeilingPolicy({
    ceilingUsdMicros: CEILING, authorizedRepairRounds: REPAIR_ROUNDS,
    ...(input.withoutLedger === undefined ? {} : { withoutLedger: input.withoutLedger }),
  });
  const { timeline: bound, ...rest } = harness.deps;
  const deps = input.timeline === 'ABSENT'
    ? { ...rest, allocation: policy }
    : { ...rest, allocation: policy, timeline: input.timeline === 'BOUND' ? bound! : input.timeline };
  const loop = new JuliusRunLoop(deps, harness.policies, { claimLimit: 10, leaseMs: 60_000 });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  return { harness, loop };
}

async function drain(loop: JuliusRunLoop, ticks = 16): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    const report = await loop.tick(scope);
    if (report.claimed === 0) {
      const advance = await loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

const eventsOf = (harness: ReturnType<typeof createJuliusHarness>, type: string) =>
  harness.store.events().filter((event) => event.type === type);

describe('the rule is policy data, and it defaults to what every composition already does', () => {
  it('defaults to ESTIMATE, accepts DENY, and refuses anything else rather than reading it as either', () => {
    expect(juliusSharedCeilingPolicy({ ceilingUsdMicros: CEILING, authorizedRepairRounds: 1 }).withoutLedger).toBe('ESTIMATE');
    expect(juliusSharedCeilingPolicy({ ceilingUsdMicros: CEILING, authorizedRepairRounds: 1, withoutLedger: 'DENY' }).withoutLedger).toBe('DENY');
    expect(() => juliusSharedCeilingPolicy({
      ceilingUsdMicros: CEILING, authorizedRepairRounds: 1, withoutLedger: 'deny' as never,
    })).toThrow('shared_ceiling_without_ledger_invalid');
  });
});

describe('with no readable ledger', () => {
  it('ESTIMATE still funds each dispatch at the estimate and names the absence — the in-memory fallback is unchanged', async () => {
    const { harness, loop } = composed({ withoutLedger: undefined, timeline: 'ABSENT' });
    await drain(loop);

    const architect = harness.adapters.get('architect-adapter')!.dispatches;
    expect(architect.length, 'the architect was reached').toBeGreaterThan(0);
    expect(architect[0]!.allocation?.basis).toBe('ESTIMATE_NO_LEDGER');
    expect(eventsOf(harness, 'budget.denied')).toHaveLength(0);
  });

  it('DENY reaches no provider at all: nothing is dispatched, nothing is reserved, and the row says why', async () => {
    const { harness, loop } = composed({ withoutLedger: 'DENY', timeline: 'ABSENT' });
    await drain(loop);

    for (const adapterId of ['architect-adapter', 'coder-adapter']) {
      expect(harness.adapters.get(adapterId)!.dispatches, `${adapterId} was never reached`).toHaveLength(0);
    }
    expect(eventsOf(harness, 'budget.reserved'), 'nothing was held against a figure nobody chose').toHaveLength(0);

    const allocated = eventsOf(harness, 'budget.allocated');
    expect(allocated.length).toBeGreaterThan(0);
    expect(allocated[0]!.facts.allocationBasis).toBe('NO_LEDGER_DENIED');
    expect(allocated[0]!.facts.allocatedUsdMicros).toBe(0);
    expect(allocated[0]!.facts.slotRefusal).toBe('SPEND_LEDGER_UNAVAILABLE');

    const denied = eventsOf(harness, 'budget.denied');
    expect(denied.length).toBeGreaterThan(0);
    // NOT `BUDGET_EXHAUSTED`: nobody knows what this mission has spent, and
    // writing that down as "ran dry" would be Unknown recorded as zero.
    expect(denied[0]!.facts.reason).toBe('SPEND_LEDGER_REQUIRED');
    expect(harness.store.taskRow('plan-1')!.state).toBe('FAILED');
    expect(eventsOf(harness, 'budget.allocated').some((event) => event.facts.allocationBasis === 'ESTIMATE_NO_LEDGER'),
      'no dispatch was ever funded at the estimate').toBe(false);
  });
});

describe('with a readable ledger, DENY changes nothing', () => {
  it('grants every dispatch exactly what ESTIMATE grants it', async () => {
    const lenient = composed({ withoutLedger: 'ESTIMATE', timeline: 'BOUND' });
    const strict = composed({ withoutLedger: 'DENY', timeline: 'BOUND' });
    await drain(lenient.loop);
    await drain(strict.loop);

    for (const adapterId of ['architect-adapter', 'coder-adapter']) {
      const a = lenient.harness.adapters.get(adapterId)!.dispatches.map((dispatch) => dispatch.allocation);
      const b = strict.harness.adapters.get(adapterId)!.dispatches.map((dispatch) => dispatch.allocation);
      expect(a.length, `${adapterId} was dispatched`).toBeGreaterThan(0);
      expect(b, `${adapterId} got the same grant under DENY`).toEqual(a);
      for (const allocation of b) expect(allocation?.basis).not.toBe('NO_LEDGER_DENIED');
    }
    // And the grant is the mission's, not the estimate: the coder may draw its
    // floor plus the free pool, which is dollars against a twenty-dollar ceiling.
    const coder = strict.harness.adapters.get('coder-adapter')!.dispatches[0]!.allocation!;
    expect(coder.usdMicros).toBeGreaterThan(1_000_000);
  });
});

describe('a ledger written under a different rule is not reinterpreted, and not spent against either', () => {
  it('DENY refuses when the run\'s own rows name another policy', async () => {
    const { harness, loop } = composed({ withoutLedger: 'DENY', timeline: 'BOUND' });
    await harness.store.appendEvent({
      eventId: 'legacy-allocation', runId: 'run-1', projectId: 'prj-1',
      type: 'budget.allocated', taskId: 'plan-1', workerId: null,
      correlationId: 'legacy', causationId: null, occurredAt: '2026-08-01T00:00:00.000Z',
      facts: { role: 'PROMPT_ARCHITECT', allocationPolicy: 'julius-allocation.v1' },
    });
    await drain(loop);

    expect(harness.adapters.get('architect-adapter')!.dispatches).toHaveLength(0);
    const refused = eventsOf(harness, 'budget.allocated').filter((event) => event.eventId !== 'legacy-allocation');
    expect(refused[0]!.facts.allocationBasis).toBe('NO_LEDGER_DENIED');
    expect(refused[0]!.facts.slotRefusal).toBe('SPEND_LEDGER_POLICY_CONFLICT');
  });
});

describe('a repair round is admitted against the ledger too', () => {
  it('halts with the true reason when the ledger stops being readable between the build and its repair', async () => {
    const REPAIRABLE = worker({
      workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter',
      capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
    });
    const harness = createJuliusHarness({
      workers: [{ worker: REPAIRABLE, script: [{ kind: 'succeed' }] }],
      card: cardPolicy({ allowedProviders: ['anthropic'], capabilities: ['implement'], concurrency: 1 }),
      verification: verificationPolicy({ maxRepairRounds: REPAIR_ROUNDS }),
      budgetUsdMicros: CEILING,
    });
    const run = seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    harness.store.seedFinding({
      findingId: 'finding-1', runId: run.runId, taskId: 'task-1', reviewerWorkerId: 'reviewer',
      severity: 'HIGH', category: 'correctness', claim: 'Blocking.', criterionId: null,
      evidenceIds: ['task-1:1:0'], blocking: true, status: 'OPEN', createdAt: '2026-08-27T00:00:00.000Z',
    });
    const coder = harness.adapters.get('coder-adapter')!;
    // THE LEDGER IS READABLE FOR THE BUILD, and from the moment the coder has
    // been dispatched it carries a row written under another rule — so the
    // build is funded normally and the repair admission is the decision that
    // meets the unreadable ledger.
    const reader: JuliusTimelineReader = {
      async timeline(query) {
        const page = await harness.store.timeline(query);
        if (coder.dispatches.length === 0 || query.sinceSequence > 0) return page;
        return {
          ...page,
          entries: [...page.entries, {
            eventId: 'late-legacy', sequence: 1_000_000, type: 'budget.allocated', taskId: 'task-1',
            workerId: null, occurredAt: '2026-08-01T00:00:00.000Z',
            facts: { role: 'CODING_AGENT', allocationPolicy: 'julius-allocation.v1' },
          }],
          hasMore: false,
        };
      },
    };
    const loop = new JuliusRunLoop({
      ...harness.deps, timeline: reader,
      allocation: juliusSharedCeilingPolicy({ ceilingUsdMicros: CEILING, authorizedRepairRounds: REPAIR_ROUNDS, withoutLedger: 'DENY' }),
    }, harness.policies, { claimLimit: 10, leaseMs: 60_000 });

    const report = await loop.tick(scope);
    expect(coder.dispatches, 'the build itself was funded and dispatched').toHaveLength(1);
    expect(report.outcomes[0]!.kind).toBe('HALTED');
    if (report.outcomes[0]!.kind !== 'HALTED') return;
    expect(report.outcomes[0].reasonCode).toBe('REPAIR_BUDGET_DENIED');
    expect(report.outcomes[0].safeSummary).toContain('spend ledger for this mission could not be read');
    expect(report.outcomes[0].safeSummary).not.toContain('exhausted');
    const denied = eventsOf(harness, 'budget.denied');
    expect(denied.at(-1)!.facts.reason).toBe('SPEND_LEDGER_REQUIRED');
    expect(denied.at(-1)!.facts.slotRefusal).toBe('SPEND_LEDGER_POLICY_CONFLICT');
  });
});

describe('the paid entrypoint is the composition that says DENY', () => {
  it('passes DENY to the live runtime, and the live composition hands it to the v3 policy', async () => {
    const { readFileSync } = await import('node:fs');
    const entry = readFileSync(new URL('../../../../relay-bridge/julius-live-mission.ts', import.meta.url), 'utf8');
    const composition = readFileSync(new URL('../../../../relay-bridge/julius/live-composition.ts', import.meta.url), 'utf8');
    expect(entry).toContain("allocationWithoutLedger: 'DENY'");
    expect(composition).toContain('withoutLedger: options.allocationWithoutLedger');
  });
});
