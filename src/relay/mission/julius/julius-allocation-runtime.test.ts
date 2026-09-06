import { describe, expect, it } from 'vitest';

import {
  JULIUS_ALLOCATION_POLICY_VERSION, JULIUS_ALLOCATION_RULE,
  coderShareUsdMicros, evaluateJuliusAllocation, juliusAllocationPolicy,
} from './julius-allocation-runtime';
import { createMemoryBudget } from './julius-runtime-fixtures';

const USD = 1_000_000;
/** julius-live-mission-2: $20, three repair rounds. */
const MISSION_2 = juliusAllocationPolicy({ ceilingUsdMicros: 20 * USD, authorizedRepairRounds: 3 });
/** The default contract: $5, one repair round. */
const MISSION_1 = juliusAllocationPolicy({ ceilingUsdMicros: 5 * USD, authorizedRepairRounds: 1 });
const ESTIMATE = 300_000;

describe('DEFECT 1 — the allocation policy is derived from the contract alone', () => {
  it('is versioned, named and frozen', () => {
    expect(MISSION_2.version).toBe(JULIUS_ALLOCATION_POLICY_VERSION);
    expect(MISSION_2.rule).toBe(JULIUS_ALLOCATION_RULE);
    expect(Object.isFrozen(MISSION_2)).toBe(true);
  });

  it('refuses a ceiling or round count that is not a non-negative integer', () => {
    expect(() => juliusAllocationPolicy({ ceilingUsdMicros: -1, authorizedRepairRounds: 1 })).toThrow('allocation_ceiling_invalid');
    expect(() => juliusAllocationPolicy({ ceilingUsdMicros: 1.5, authorizedRepairRounds: 1 })).toThrow('allocation_ceiling_invalid');
    expect(() => juliusAllocationPolicy({ ceilingUsdMicros: 1, authorizedRepairRounds: Number.NaN })).toThrow('allocation_repair_rounds_invalid');
  });

  it('shares the ceiling equally over the build and every authorised repair round', () => {
    expect(coderShareUsdMicros(MISSION_2)).toBe(5 * USD);
    expect(coderShareUsdMicros(MISSION_1)).toBe(2_500_000);
    expect(coderShareUsdMicros(juliusAllocationPolicy({ ceilingUsdMicros: 10, authorizedRepairRounds: 2 }))).toBe(3);
  });

  it('Mission 2\'s grant does not leak to Mission 1 or to an invented namespace', () => {
    const two = evaluateJuliusAllocation({ policy: MISSION_2, role: 'CODING_AGENT', remainingUsdMicros: 20 * USD, estimateUsdMicros: ESTIMATE });
    const one = evaluateJuliusAllocation({ policy: MISSION_1, role: 'CODING_AGENT', remainingUsdMicros: 5 * USD, estimateUsdMicros: ESTIMATE });
    expect(two.usdMicros).toBe(5 * USD);
    expect(one.usdMicros).toBe(2_500_000);
    const invented = juliusAllocationPolicy({ ceilingUsdMicros: 0, authorizedRepairRounds: 0 });
    expect(evaluateJuliusAllocation({ policy: invented, role: 'CODING_AGENT', remainingUsdMicros: 0, estimateUsdMicros: ESTIMATE }))
      .toMatchObject({ usdMicros: 0, basis: 'EXHAUSTED' });
  });
});

describe('the allocation for one dispatch', () => {
  it('the Coding Agent gets its share while the remaining budget covers it', () => {
    expect(evaluateJuliusAllocation({ policy: MISSION_2, role: 'CODING_AGENT', remainingUsdMicros: 19_700_000, estimateUsdMicros: ESTIMATE }))
      .toEqual({ usdMicros: 5 * USD, basis: 'CODER_SHARE', shareUsdMicros: 5 * USD, remainingUsdMicros: 19_700_000, policyVersion: JULIUS_ALLOCATION_POLICY_VERSION });
  });

  it('never exceeds the remaining mission budget', () => {
    expect(evaluateJuliusAllocation({ policy: MISSION_2, role: 'CODING_AGENT', remainingUsdMicros: 1_234_567, estimateUsdMicros: ESTIMATE }))
      .toMatchObject({ usdMicros: 1_234_567, basis: 'CODER_REMAINDER' });
    expect(evaluateJuliusAllocation({ policy: MISSION_2, role: 'CODING_AGENT', remainingUsdMicros: 0, estimateUsdMicros: ESTIMATE }))
      .toMatchObject({ usdMicros: 0, basis: 'EXHAUSTED' });
    expect(evaluateJuliusAllocation({ policy: MISSION_2, role: 'CODING_AGENT', remainingUsdMicros: -5, estimateUsdMicros: ESTIMATE }))
      .toMatchObject({ usdMicros: 0, basis: 'EXHAUSTED' });
  });

  it('Unknown remaining budget is not zero and not the share: the smaller of share and estimate', () => {
    expect(evaluateJuliusAllocation({ policy: MISSION_2, role: 'CODING_AGENT', remainingUsdMicros: null, estimateUsdMicros: ESTIMATE }))
      .toMatchObject({ usdMicros: ESTIMATE, basis: 'BUDGET_UNKNOWN', remainingUsdMicros: null });
    const tiny = juliusAllocationPolicy({ ceilingUsdMicros: 100_000, authorizedRepairRounds: 0 });
    expect(evaluateJuliusAllocation({ policy: tiny, role: 'CODING_AGENT', remainingUsdMicros: null, estimateUsdMicros: ESTIMATE }))
      .toMatchObject({ usdMicros: 100_000, basis: 'BUDGET_UNKNOWN' });
  });

  it('the Prompt Architect and the reviewer keep their fixed estimate', () => {
    for (const role of ['PROMPT_ARCHITECT', 'INDEPENDENT_REVIEWER'] as const) {
      expect(evaluateJuliusAllocation({ policy: MISSION_2, role, remainingUsdMicros: 20 * USD, estimateUsdMicros: ESTIMATE }))
        .toMatchObject({ usdMicros: ESTIMATE, basis: 'ESTIMATE', shareUsdMicros: null });
    }
  });
});

describe('allocations against a real reservation ledger', () => {
  const now = '2026-09-06T00:00:00.000Z';
  const reserveCoder = async (budget: ReturnType<typeof createMemoryBudget>, id: string) => {
    const allocation = evaluateJuliusAllocation({
      policy: MISSION_2, role: 'CODING_AGENT', remainingUsdMicros: budget.remainingUsdMicros(), estimateUsdMicros: ESTIMATE,
    });
    const reservation = await budget.reserve({
      reservationId: id, runId: 'run', projectId: 'prj', taskId: id, usdMicros: allocation.usdMicros,
      inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, now,
    });
    return { allocation, reservation };
  };

  it('the build and three repair rounds can each spend a full share and sum to exactly the ceiling', async () => {
    const budget = createMemoryBudget(20 * USD);
    let total = 0;
    for (const round of ['build', 'r1', 'r2', 'r3']) {
      const { allocation, reservation } = await reserveCoder(budget, round);
      expect(reservation.state).toBe('RESERVED');
      expect(allocation.basis).toBe('CODER_SHARE');
      await budget.commit({ reservationId: round, usdMicros: allocation.usdMicros, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, receiptId: null, now });
      total += allocation.usdMicros;
    }
    expect(total).toBe(20 * USD);
    expect(budget.remainingUsdMicros()).toBe(0);
    // A fifth round is denied before any provider is reached.
    const fifth = await reserveCoder(budget, 'r4');
    expect(fifth.allocation.basis).toBe('EXHAUSTED');
  });

  it('when a round over-spends its share, later rounds shrink to the remainder and never past the ceiling', async () => {
    const budget = createMemoryBudget(20 * USD);
    // The build reserved $5 and the runtime reported $5 (the SDK stops there);
    // then repair one is committed at its full share, repair two at $8 of
    // unbounded spend that a legacy adapter might report.
    const build = await reserveCoder(budget, 'build');
    await budget.commit({ reservationId: 'build', usdMicros: build.allocation.usdMicros, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, receiptId: null, now });
    const r1 = await reserveCoder(budget, 'r1');
    await budget.commit({ reservationId: 'r1', usdMicros: 8 * USD, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, receiptId: null, now });
    expect(r1.allocation.usdMicros).toBe(5 * USD);
    const r2 = await reserveCoder(budget, 'r2');
    expect(r2.allocation).toMatchObject({ usdMicros: 5 * USD, basis: 'CODER_SHARE' });
    await budget.commit({ reservationId: 'r2', usdMicros: 5 * USD, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, receiptId: null, now });
    const r3 = await reserveCoder(budget, 'r3');
    expect(r3.allocation).toMatchObject({ usdMicros: 2 * USD, basis: 'CODER_REMAINDER' });
    expect(r3.reservation.state).toBe('RESERVED');
    expect(budget.remainingUsdMicros()).toBe(0);
  });

  it('the ledger, not the allocator, is the last word: an allocation past the ceiling is DENIED', async () => {
    const budget = createMemoryBudget(1 * USD);
    const reservation = await budget.reserve({
      reservationId: 'x', runId: 'run', projectId: 'prj', taskId: 'x', usdMicros: 5 * USD,
      inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, now,
    });
    expect(reservation.state).toBe('DENIED');
  });
});

describe('the ledger charges what was spent and never frees what it cannot account for', () => {
  const now = '2026-09-06T00:00:00.000Z';
  const reserve = (budget: ReturnType<typeof createMemoryBudget>, id: string, usdMicros: number) =>
    budget.reserve({ reservationId: id, runId: 'run', projectId: 'prj', taskId: id, usdMicros, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, now });

  it('UNKNOWN cost settles at what was reserved, so the rest of the mission is not handed money already spent', async () => {
    const budget = createMemoryBudget(20 * USD);
    await reserve(budget, 'build', 5 * USD);
    // The runtime answered without a cost. Unknown is not zero.
    await budget.commit({ reservationId: 'build', usdMicros: null, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, receiptId: null, now });
    expect(budget.remainingUsdMicros(), 'the hold stands').toBe(15 * USD);
    expect(budget.reservations()).toContainEqual({ reservationId: 'build', state: 'COMMITTED', usdMicros: 5 * USD });
  });

  it('a KNOWN cost settles at what it actually cost, freeing the difference', async () => {
    const budget = createMemoryBudget(20 * USD);
    await reserve(budget, 'build', 5 * USD);
    await budget.commit({ reservationId: 'build', usdMicros: 250_000, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, receiptId: null, now });
    expect(budget.remainingUsdMicros()).toBe(20 * USD - 250_000);
  });

  it('a failed attempt that BILLED before it failed is charged, not released, so a retry cannot be granted that money twice', async () => {
    const budget = createMemoryBudget(20 * USD);
    await reserve(budget, 'build:1', 5 * USD);
    await budget.release({ reservationId: 'build:1', reason: 'TIMEOUT', now, usdMicros: 4_900_000 });
    expect(budget.reservations()).toContainEqual({ reservationId: 'build:1', state: 'COMMITTED', usdMicros: 4_900_000 });
    expect(budget.remainingUsdMicros()).toBe(20 * USD - 4_900_000);
    // And the retry is allocated against what is actually left.
    expect(evaluateJuliusAllocation({ policy: MISSION_2, role: 'CODING_AGENT', remainingUsdMicros: budget.remainingUsdMicros(), estimateUsdMicros: ESTIMATE }))
      .toMatchObject({ usdMicros: 5 * USD, basis: 'CODER_SHARE' });
  });

  it('a failed attempt that billed NOTHING hands its whole hold back', async () => {
    const budget = createMemoryBudget(20 * USD);
    await reserve(budget, 'build:1', 5 * USD);
    await budget.release({ reservationId: 'build:1', reason: 'AUTH_CONFIGURATION', now, usdMicros: null });
    expect(budget.remainingUsdMicros()).toBe(20 * USD);
    expect(budget.reservations()).toContainEqual({ reservationId: 'build:1', state: 'RELEASED', usdMicros: 0 });
  });

  it('a cost above what was authorized is recorded in full, and the overspend denies the next dispatch', async () => {
    // Clamping to the hold would hide real overspend and let the mission be
    // granted money it has already spent.
    const budget = createMemoryBudget(6 * USD);
    await reserve(budget, 'build:1', 5 * USD);
    await budget.release({ reservationId: 'build:1', reason: 'TIMEOUT', now, usdMicros: 9 * USD });
    expect(budget.reservations()).toContainEqual({ reservationId: 'build:1', state: 'COMMITTED', usdMicros: 9 * USD });
    expect(budget.remainingUsdMicros(), 'the ceiling has been exceeded and the ledger says so').toBe(-3 * USD);
    expect(evaluateJuliusAllocation({ policy: MISSION_2, role: 'CODING_AGENT', remainingUsdMicros: budget.remainingUsdMicros(), estimateUsdMicros: ESTIMATE }))
      .toMatchObject({ usdMicros: 0, basis: 'EXHAUSTED' });
  });
});

describe('a failure that reports no cost: spending nothing is not the same as spending an unknown amount', () => {
  const now = '2026-09-06T00:00:00.000Z';
  const reserve = (budget: ReturnType<typeof createMemoryBudget>, id: string, usdMicros: number) =>
    budget.reserve({ reservationId: id, runId: 'run', projectId: 'prj', taskId: id, usdMicros, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, now });

  it('a runtime that STARTED and reported nothing keeps its hold — the timeout case a cost is never reported for', async () => {
    // The SDK reports cost only in its final result message, which a timeout
    // never delivers: the attempt most likely to have billed is the one least
    // likely to say so. Freeing the hold would hand the retry the same money.
    const budget = createMemoryBudget(20 * USD);
    await reserve(budget, 'build:1', 5 * USD);
    await budget.release({ reservationId: 'build:1', reason: 'TIMEOUT', now, usdMicros: null, spendUnknown: true });
    expect(budget.reservations()).toContainEqual({ reservationId: 'build:1', state: 'COMMITTED', usdMicros: 5 * USD });
    expect(budget.remainingUsdMicros()).toBe(15 * USD);
  });

  it('a runtime that never STARTED hands its whole hold back', async () => {
    const budget = createMemoryBudget(20 * USD);
    await reserve(budget, 'build:1', 5 * USD);
    await budget.release({ reservationId: 'build:1', reason: 'AUTH_CONFIGURATION', now, usdMicros: null, spendUnknown: false });
    expect(budget.remainingUsdMicros()).toBe(20 * USD);
  });

  it('a reported cost always wins over the hold, whether or not the runtime started', async () => {
    const budget = createMemoryBudget(20 * USD);
    await reserve(budget, 'build:1', 5 * USD);
    await budget.release({ reservationId: 'build:1', reason: 'WORKER_EXECUTION_FAILURE', now, usdMicros: 1_500_000, spendUnknown: true });
    expect(budget.reservations()).toContainEqual({ reservationId: 'build:1', state: 'COMMITTED', usdMicros: 1_500_000 });
  });
});

describe('one ledger, every role: a share is an upper bound on a round, not a reservation of one', () => {
  const now = '2026-09-06T00:00:00.000Z';
  const DEFAULT_CONTRACT = juliusAllocationPolicy({ ceilingUsdMicros: 5 * USD, authorizedRepairRounds: 1 });

  it('the architect and reviewer hold what they reserved, so the repair round runs on the remainder', async () => {
    // Neither non-coder role reports a cost, and Unknown is not zero: each
    // settles at the estimate the mission already agreed to risk for it.
    const budget = createMemoryBudget(5 * USD);
    const allocateAndSettle = async (id: string, role: 'PROMPT_ARCHITECT' | 'CODING_AGENT' | 'INDEPENDENT_REVIEWER', reported: number | null) => {
      const allocation = evaluateJuliusAllocation({
        policy: DEFAULT_CONTRACT, role, remainingUsdMicros: budget.remainingUsdMicros(), estimateUsdMicros: ESTIMATE,
      });
      await budget.reserve({ reservationId: id, runId: 'run', projectId: 'prj', taskId: id, usdMicros: allocation.usdMicros, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, now });
      await budget.commit({ reservationId: id, usdMicros: reported, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, receiptId: null, now });
      return allocation;
    };

    expect((await allocateAndSettle('plan', 'PROMPT_ARCHITECT', null)).basis).toBe('ESTIMATE');
    expect((await allocateAndSettle('plan:review', 'INDEPENDENT_REVIEWER', null)).basis).toBe('ESTIMATE');
    const build = await allocateAndSettle('build', 'CODING_AGENT', 2_500_000);
    expect(build, 'the first round gets its whole share').toMatchObject({ usdMicros: 2_500_000, basis: 'CODER_SHARE' });
    expect((await allocateAndSettle('build:review', 'INDEPENDENT_REVIEWER', null)).basis).toBe('ESTIMATE');

    // 5.00 - 0.30 (plan) - 0.30 (plan review) - 2.50 (build) - 0.30 (build review).
    expect(budget.remainingUsdMicros()).toBe(1_600_000);
    const repair = evaluateJuliusAllocation({
      policy: DEFAULT_CONTRACT, role: 'CODING_AGENT', remainingUsdMicros: budget.remainingUsdMicros(), estimateUsdMicros: ESTIMATE,
    });
    expect(repair, 'the repair round runs on what is left, not on a second full share')
      .toMatchObject({ usdMicros: 1_600_000, basis: 'CODER_REMAINDER', shareUsdMicros: 2_500_000 });
    expect(repair.usdMicros).toBeLessThan(coderShareUsdMicros(DEFAULT_CONTRACT));
  });

  it('and the mission never spends past its ceiling doing it', async () => {
    const budget = createMemoryBudget(5 * USD);
    let spent = 0;
    for (const [id, role] of [['plan', 'PROMPT_ARCHITECT'], ['build', 'CODING_AGENT'], ['repair', 'CODING_AGENT']] as const) {
      const allocation = evaluateJuliusAllocation({
        policy: DEFAULT_CONTRACT, role, remainingUsdMicros: budget.remainingUsdMicros(), estimateUsdMicros: ESTIMATE,
      });
      const reservation = await budget.reserve({ reservationId: id, runId: 'run', projectId: 'prj', taskId: id, usdMicros: allocation.usdMicros, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, now });
      expect(reservation.state).toBe('RESERVED');
      await budget.commit({ reservationId: id, usdMicros: allocation.usdMicros, inputTokens: 0, outputTokens: 0, toolCalls: 0, runtimeMs: 0, receiptId: null, now });
      spent += allocation.usdMicros;
    }
    expect(spent).toBeLessThanOrEqual(5 * USD);
    expect(budget.remainingUsdMicros()).toBeGreaterThanOrEqual(0);
  });
});
