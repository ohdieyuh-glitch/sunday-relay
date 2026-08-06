import { describe, expect, it } from 'vitest';

import {
  planRechaining, type RechainingSnapshot, type TemporaryBranch,
} from './rechaining';
import { UNCHAIN_TEMPORARY_SLOTS } from '../loop-availability';

/**
 * RECHAINING. What is tested is the three absolutes UNCHAIN.md fixes, because
 * they are what a plausible implementation quietly breaks: a collapse
 * preserves rather than discards, interrupted work is never reported as
 * complete, and no temporary slot continues invisibly.
 */

const branch = (over: Partial<TemporaryBranch> = {}): TemporaryBranch => ({
  branchId: 'br_1',
  slotId: 'slot_0',
  state: 'in_progress',
  persisted: true,
  handoffWritten: true,
  convergeable: false,
  ...over,
});

const snapshot = (over: Partial<RechainingSnapshot> = {}): RechainingSnapshot => ({
  meterState: 'expired',
  baseSlots: 1,
  temporaryBranches: [branch()],
  unstartedTasks: [],
  ...over,
});

const planOf = (input: RechainingSnapshot) => {
  const decision = planRechaining(input);
  if (!decision.ok) throw new Error(`${decision.refusal}: ${decision.problem}`);
  return decision.plan;
};

describe('a collapse preserves; it does not discard', () => {
  it('refuses to collapse a branch whose work is not durably written', () => {
    // Mutation check: letting an unpersisted branch be cancelled or stopped
    // is the discard this rule exists to prevent.
    const plan = planOf(snapshot({
      temporaryBranches: [branch({ persisted: false })],
    }));
    expect(plan.branches[0]?.disposition).toBe('blocked_unpersisted');
    expect(plan.branches[0]?.reportedAs).toBe('unchanged');
    expect(plan.blocked).toBe(true);
  });

  it('refuses even SPECULATIVE work while it is unpersisted', () => {
    // "Speculative" says why the work started, not whether a user would miss
    // it. Mutation check: exempting speculative branches from the preserve
    // rule fails this.
    const plan = planOf(snapshot({
      temporaryBranches: [branch({ state: 'speculative', persisted: false })],
    }));
    expect(plan.branches[0]?.disposition).toBe('blocked_unpersisted');
    expect(plan.blocked).toBe(true);
  });

  it('cancels speculative work only ONCE it is persisted, and calls it discarded', () => {
    const plan = planOf(snapshot({
      temporaryBranches: [branch({ state: 'speculative', persisted: true })],
    }));
    expect(plan.branches[0]?.disposition).toBe('cancel_speculative');
    expect(plan.branches[0]?.reportedAs).toBe('discarded');
    expect(plan.blocked).toBe(false);
  });

  it('does not start NEW work on base slots while a branch is still unpreserved', () => {
    // Re-planning during a blocked collapse would spend the capacity that is
    // meant to be rescuing the old work.
    const plan = planOf(snapshot({
      baseSlots: 2,
      temporaryBranches: [branch({ persisted: false })],
      unstartedTasks: ['task_a', 'task_b', 'task_c'],
    }));
    expect(plan.replanned).toEqual([]);
    expect(plan.queued).toEqual(['task_a', 'task_b', 'task_c']);
  });
});

describe('interrupted work is never reported as complete', () => {
  it('reports a branch stopped mid-flight as interrupted, not converged', () => {
    // Mutation check: mapping preserve_and_stop to 'converged' fails here.
    const plan = planOf(snapshot({
      temporaryBranches: [branch({ state: 'in_progress' })],
    }));
    expect(plan.branches[0]?.disposition).toBe('preserve_and_stop');
    expect(plan.branches[0]?.reportedAs).toBe('interrupted');
  });

  it('a COMPLETE branch that cannot converge is still interrupted, not converged', () => {
    const plan = planOf(snapshot({
      temporaryBranches: [branch({ state: 'complete', convergeable: false })],
    }));
    expect(plan.branches[0]?.reportedAs).toBe('interrupted');
  });

  it('converges only work that is both complete and convergeable', () => {
    const plan = planOf(snapshot({
      temporaryBranches: [branch({ state: 'complete', convergeable: true })],
    }));
    expect(plan.branches[0]?.disposition).toBe('converge');
    expect(plan.branches[0]?.reportedAs).toBe('converged');
  });

  it('names the missing handoff without downgrading what the work was', () => {
    const withHandoff = planOf(snapshot({
      temporaryBranches: [branch({ handoffWritten: true })],
    }));
    const without = planOf(snapshot({
      temporaryBranches: [branch({ handoffWritten: false })],
    }));
    expect(withHandoff.branches[0]?.reportedAs).toBe('interrupted');
    expect(without.branches[0]?.reportedAs).toBe('interrupted');
    expect(without.branches[0]?.reason).toContain('handoff is still owed');
  });
});

describe('no temporary slot continues invisibly', () => {
  it('accounts for every temporary branch exactly once, in snapshot order', () => {
    const branches = [
      branch({ branchId: 'br_a', slotId: 'slot_0', state: 'complete', convergeable: true }),
      branch({ branchId: 'br_b', slotId: 'slot_1', state: 'speculative' }),
    ];
    const plan = planOf(snapshot({ temporaryBranches: branches }));
    expect(plan.branches.map((b) => b.branchId)).toEqual(['br_a', 'br_b']);
    expect(plan.branches).toHaveLength(2);
  });

  it('names every slot whose temporary access must be revoked', () => {
    const plan = planOf(snapshot({
      temporaryBranches: [
        branch({ branchId: 'br_a', slotId: 'slot_0' }),
        branch({ branchId: 'br_b', slotId: 'slot_1' }),
      ],
    }));
    // Named rather than performed: a pure planner revokes nothing, and
    // claiming otherwise would leave access live while a report said it was
    // gone.
    expect(plan.revokeTemporaryAccessFor).toEqual(['slot_0', 'slot_1']);
  });
});

describe('the collapse is monotonically downward', () => {
  it('targets the BASE slot count, never the expanded one', () => {
    // Mutation check: targeting baseSlots + UNCHAIN_TEMPORARY_SLOTS turns a
    // collapse into the promotion this module has no authority to grant.
    expect(planOf(snapshot({ baseSlots: 3 })).targetSlots).toBe(3);
    expect(planOf(snapshot({ baseSlots: 0, temporaryBranches: [] })).targetSlots).toBe(0);
  });

  it('refuses a snapshot reporting more branches than temporary slots exist', () => {
    const tooMany = Array.from({ length: UNCHAIN_TEMPORARY_SLOTS + 1 }, (_, i) =>
      branch({ branchId: `br_${i}`, slotId: `slot_${i}` }));
    const decision = planRechaining(snapshot({ temporaryBranches: tooMany }));
    expect(decision).toMatchObject({ ok: false, refusal: 'more_branches_than_slots' });
  });

  it('refuses a base capacity that is not a capacity', () => {
    for (const baseSlots of [-1, 1.5, Number.NaN]) {
      const decision = planRechaining(snapshot({ baseSlots }));
      expect(decision, String(baseSlots)).toMatchObject({ ok: false, refusal: 'invalid_base_capacity' });
    }
  });
});

describe('what it refuses to decide', () => {
  it('plans the same way whatever meter state triggered the collapse', () => {
    // Whether expiry pauses a running Loop or only prevents new branches is
    // open founder decision #4. This module does not answer it, so a plan
    // must not vary by meter state.
    const states = ['low', 'critical', 'expired'] as const;
    const plans = states.map((meterState) => planOf(snapshot({
      meterState,
      baseSlots: 2,
      temporaryBranches: [branch({ state: 'in_progress' })],
      unstartedTasks: ['task_a', 'task_b', 'task_c'],
    })));
    for (const plan of plans.slice(1)) expect(plan).toEqual(plans[0]);
  });

  it('takes base capacity as evidence rather than inventing a per-tier number', () => {
    // Open founder decision #3: the +2 is a delta from an unstated base.
    for (const baseSlots of [0, 1, 5, 40]) {
      expect(planOf(snapshot({ baseSlots })).targetSlots).toBe(baseSlots);
    }
  });

  it('queues work beyond base capacity rather than dropping it', () => {
    const plan = planOf(snapshot({
      baseSlots: 2,
      temporaryBranches: [],
      unstartedTasks: ['task_a', 'task_b', 'task_c', 'task_d'],
    }));
    expect(plan.replanned).toEqual(['task_a', 'task_b']);
    expect(plan.queued).toEqual(['task_c', 'task_d']);
    // Every task is accounted for: a collapse that silently drops queued work
    // is the discard rule broken one level up.
    expect([...plan.replanned, ...plan.queued]).toHaveLength(4);
  });
});
