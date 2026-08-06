import { describe, expect, it } from 'vitest';

import {
  runRepairLoop, type RepairAttemptReport, type RepairLoopPorts, type RepairVerifyResult,
} from './repair-loop-engine';

/**
 * BOUNDED REPAIR LOOPS.
 *
 * The bound is the point: an unbounded repair loop is a machine for converting
 * a defect into a bill. What is tested here is the doctrine, not the plumbing —
 * that only the VERIFIER closes a finding, that scope creep fails a cycle
 * however good the repair looks, that the loop never runs a cycle past its
 * bound, and that `limit_reached` reads as an unfixed defect and a bill rather
 * than any kind of completion.
 */

const AT = (s: number) => new Date(Date.parse('2026-08-06T12:00:00.000Z') + s * 1000).toISOString();

function harness(script: {
  attempts?: (cycle: number) => RepairAttemptReport | 'throws';
  verdicts?: (cycle: number) => RepairVerifyResult | 'throws';
}) {
  let clock = 0;
  const calls = { dispatched: [] as number[], verified: [] as number[] };
  const ports: RepairLoopPorts = {
    async dispatchRepair(cycle) {
      calls.dispatched.push(cycle);
      const a = script.attempts?.(cycle) ?? { touchedFiles: ['src/a.ts'], claimsFixed: true };
      if (a === 'throws') throw new Error(`repair crashed on cycle ${cycle}`);
      return a;
    },
    async verify(cycle) {
      calls.verified.push(cycle);
      const v = script.verdicts?.(cycle) ?? { finding: 'still_open' };
      if (v === 'throws') throw new Error(`verifier crashed on cycle ${cycle}`);
      return v;
    },
    now: () => AT(clock += 1),
  };
  return { ports, calls };
}

const input = (over: Partial<Parameters<typeof runRepairLoop>[1]> = {}) => ({
  loopId: 'lp_1',
  findingId: 'f_1',
  claimedFiles: ['src/a.ts'],
  maxCycles: 3,
  ...over,
});

describe('only the verifier closes a finding', () => {
  it('a repair that CLAIMS fixed but verifies still_open is not converged', async () => {
    const { ports } = harness({
      attempts: () => ({ touchedFiles: ['src/a.ts'], claimsFixed: true }),
      verdicts: () => ({ finding: 'still_open' }),
    });
    const { loop, reason } = await runRepairLoop(ports, input());
    // Three confident claims, zero verified closures: the same never-self-
    // approve rule the whole repository runs on.
    expect(loop.outcome).toBe('limit_reached');
    expect(loop.cycles.every((c) => !c.repaired)).toBe(true);
    expect(reason).toContain('unfixed defect and a bill');
  });

  it('converges the moment the VERIFIER says closed, and stops spending', async () => {
    const { ports, calls } = harness({
      verdicts: (cycle) => (cycle === 2 ? { finding: 'closed' } : { finding: 'still_open' }),
    });
    const { loop, reason } = await runRepairLoop(ports, input());
    expect(loop.outcome).toBe('converged');
    expect(loop.cycles).toHaveLength(2);
    // No third dispatch: a converged loop spends nothing more.
    expect(calls.dispatched).toEqual([1, 2]);
    expect(reason).toContain('cycle 2 of 3');
  });

  it('a closure the repairer itself DISCLAIMED converges, and the reason says so', async () => {
    // The disagreement is a fact the record must carry: a verifier closing a
    // fix the repairer disclaimed may mean the finding was stale or the
    // verifier checked the wrong thing. Mutation check: dropping the
    // disclaimer sentence from the converged reason fails this — the first
    // version claimed `claimsFixed` was "recorded" while recording it nowhere.
    const { ports } = harness({
      attempts: () => ({ touchedFiles: ['src/a.ts'], claimsFixed: false }),
      verdicts: () => ({ finding: 'closed' }),
    });
    const { loop, reason } = await runRepairLoop(ports, input());
    expect(loop.outcome).toBe('converged');
    expect(reason).toContain('cycle 1 of 3');
    expect(reason).toContain('did not claim a fix');
    expect(reason).toContain("verifier's evidence alone");

    // And a closure the repairer DID claim carries no disclaimer — flagging
    // agreement as disagreement would be the same lie mirrored.
    const agreed = harness({
      attempts: () => ({ touchedFiles: ['src/a.ts'], claimsFixed: true }),
      verdicts: () => ({ finding: 'closed' }),
    });
    const agreedResult = await runRepairLoop(agreed.ports, input());
    expect(agreedResult.loop.outcome).toBe('converged');
    expect(agreedResult.reason).not.toContain('did not claim');
  });

  it('an UNVERIFIABLE repair is an open finding with extra steps', async () => {
    const { ports } = harness({
      attempts: () => ({ touchedFiles: ['src/a.ts'], claimsFixed: true }),
      verdicts: () => ({ finding: 'unverifiable', reason: 'no reviewer configured' }),
    });
    const { loop } = await runRepairLoop(ports, input());
    expect(loop.outcome).toBe('limit_reached');
    expect(loop.cycles.every((c) => !c.repaired)).toBe(true);
  });

  it('a crashed verifier is unverifiable, not a pass and not a crashed loop', async () => {
    const { ports } = harness({ verdicts: () => 'throws' });
    const { loop } = await runRepairLoop(ports, input());
    expect(loop.outcome).toBe('limit_reached');
    expect(loop.cycles).toHaveLength(3);
  });
});

describe('scope creep fails the cycle however good the repair looks', () => {
  it('a repair touching beyond the claim is refused BEFORE verification', async () => {
    const { ports, calls } = harness({
      attempts: () => ({ touchedFiles: ['src/a.ts', 'src/unrelated.ts'], claimsFixed: true }),
    });
    const { loop } = await runRepairLoop(ports, input());
    expect(loop.outcome).toBe('limit_reached');
    // The verifier was never consulted: scope creep inside a repair loop is
    // how a one-line fix becomes an unreviewed rewrite.
    expect(calls.verified).toEqual([]);
    expect(loop.cycles.every((c) => !c.repaired)).toBe(true);
  });

  it('a repair within the claim proceeds to verification', async () => {
    const { ports, calls } = harness({
      attempts: () => ({ touchedFiles: ['src/a.ts'], claimsFixed: false }),
      verdicts: () => ({ finding: 'closed' }),
    });
    const { loop } = await runRepairLoop(ports, input());
    expect(loop.outcome).toBe('converged');
    expect(calls.verified).toEqual([1]);
  });
});

describe('the bound is the bound', () => {
  it('never dispatches a cycle past maxCycles, whatever the trend', async () => {
    const { ports, calls } = harness({});
    await runRepairLoop(ports, input({ maxCycles: 2 }));
    expect(calls.dispatched).toEqual([1, 2]);
  });

  it('a crashed repair is a PAID failed cycle, and the loop continues to its bound', async () => {
    const { ports, calls } = harness({ attempts: () => 'throws' });
    const { loop } = await runRepairLoop(ports, input());
    expect(loop.cycles).toHaveLength(3);
    expect(calls.dispatched).toEqual([1, 2, 3]);
    // Crashes never reached the verifier.
    expect(calls.verified).toEqual([]);
    expect(loop.outcome).toBe('limit_reached');
  });

  it('a bound that is not a bound is refused, not defaulted', async () => {
    // Silently substituting a limit is how "unbounded" ships wearing a number.
    for (const maxCycles of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { ports, calls } = harness({});
      const { loop, reason } = await runRepairLoop(ports, input({ maxCycles }));
      expect(loop.outcome, String(maxCycles)).toBe('abandoned');
      expect(loop.cycles).toEqual([]);
      expect(calls.dispatched, String(maxCycles)).toEqual([]);
      expect(reason).toContain('Nothing was dispatched');
    }
  });
});

describe('the record carries the bill as well as the verdict', () => {
  it('every cycle rides on the loop, timestamped from the injected clock', async () => {
    const { ports } = harness({
      verdicts: (cycle) => (cycle === 3 ? { finding: 'closed' } : { finding: 'still_open' }),
    });
    const { loop } = await runRepairLoop(ports, input({ missionId: 'm_1' }));
    expect(loop.cycles.map((c) => c.cycle)).toEqual([1, 2, 3]);
    expect(loop.cycles.map((c) => c.repaired)).toEqual([false, false, true]);
    expect(loop.missionId).toBe('m_1');
    expect(new Set(loop.cycles.map((c) => c.at)).size).toBe(3);
  });
});
