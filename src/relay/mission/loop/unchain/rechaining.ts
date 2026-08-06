/**
 * SUNDAY RELAY — RECHAINING: THE CONTROLLED COLLAPSE.
 *
 * When an Unchain session goes low, critical or expired, Relay does not cut
 * the temporary capacity off. It COLLAPSES back to base capacity in a fixed
 * order, and the order exists because the alternative — dropping two agents
 * mid-branch — loses work that a user believes is being done.
 *
 * UNCHAIN.md fixes thirteen steps and three absolutes. The absolutes are what
 * this module enforces, because they are the ones a plausible-looking
 * implementation quietly breaks:
 *
 * - **A collapse PRESERVES; it does not discard.** User work, evidence,
 *   branches and handoffs never disappear because a session expired. Every
 *   branch this plan touches is either kept, converged or explicitly
 *   preserved-then-cancelled — and a cancellation that would drop unpreserved
 *   work is refused, not performed.
 * - **Interrupted work is never reported as complete.** A branch that was
 *   mid-iteration collapses to `interrupted`, which is a different fact from
 *   `converged`, and no path turns one into the other.
 * - **Temporary agents never continue invisibly.** Every temporary slot is
 *   accounted for in the plan, so a slot that keeps working is a slot the
 *   plan names.
 *
 * MONOTONICALLY DOWNWARD. Rechaining can never raise capacity. The plan's
 * target slot count is the BASE, never the expanded one, and a snapshot
 * claiming more base capacity than it had expanded capacity is refused rather
 * than treated as a promotion.
 *
 * WHAT THIS MODULE REFUSES TO GUESS. UNCHAIN.md lists seven open founder
 * decisions, and this touches none of them: it takes the base slot count as
 * an argument rather than inventing a per-tier number (#3), it plans the same
 * way whichever meter state triggered it rather than deciding whether expiry
 * pauses a running Loop (#4), and it says nothing about cubs (#5). A module
 * that guessed one of those would be a decision nobody made, written where
 * nobody would look for it.
 */

import { UNCHAIN_TEMPORARY_SLOTS, type UnchainMeterState } from '../loop-availability';

/** What a temporary slot was doing when the collapse began. */
export interface TemporaryBranch {
  readonly branchId: string;
  /** The slot carrying it. Two slots exist, so this is 0 or 1 — but the plan
   *  never assumes that, because a snapshot is evidence, not arithmetic. */
  readonly slotId: string;
  readonly state: 'speculative' | 'in_progress' | 'complete';
  /** True once files, branches and evidence are durably written. A branch
   *  that is not persisted may not be cancelled — that is the preserve rule
   *  in its load-bearing form. */
  readonly persisted: boolean;
  /** True when a structured Project Brain handoff exists for it. */
  readonly handoffWritten: boolean;
  /** True when this branch can be folded into the parent Loop's result. */
  readonly convergeable: boolean;
}

export interface RechainingSnapshot {
  readonly meterState: UnchainMeterState;
  /** Slots the base plan supports once temporary capacity is gone. */
  readonly baseSlots: number;
  /** Branches running on TEMPORARY capacity. Base-slot work is not the
   *  collapse's business and is deliberately absent. */
  readonly temporaryBranches: readonly TemporaryBranch[];
  /** Work not yet started, which the collapse must re-plan or queue. */
  readonly unstartedTasks: readonly string[];
}

/** What happens to one branch. Every branch gets exactly one. */
export type BranchDisposition =
  /** Folded into the parent Loop's result. Complete work, kept. */
  | 'converge'
  /** Persisted and handed off, then stopped. Work preserved, not finished. */
  | 'preserve_and_stop'
  /** Speculative and safely discardable — but ONLY once persisted. */
  | 'cancel_speculative'
  /** Cannot be collapsed safely yet: it must be persisted or handed off
   *  first. The collapse REFUSES rather than dropping it. */
  | 'blocked_unpersisted';

export interface BranchPlan {
  readonly branchId: string;
  readonly slotId: string;
  readonly disposition: BranchDisposition;
  /** The state this branch's work is reported as. `interrupted` is never
   *  `converged`: work that stopped mid-flight did not finish. */
  readonly reportedAs: 'converged' | 'interrupted' | 'discarded' | 'unchanged';
  readonly reason: string;
}

export interface RechainingPlan {
  /** Capacity after the collapse. Never above the base. */
  readonly targetSlots: number;
  /** One entry per temporary branch, in snapshot order. */
  readonly branches: readonly BranchPlan[];
  /** Tasks that must wait for a base slot. */
  readonly queued: readonly string[];
  /** Tasks the base capacity can take immediately. */
  readonly replanned: readonly string[];
  /**
   * True when at least one branch could not be collapsed safely. The caller
   * must persist or hand off those branches and plan again — it must NOT
   * proceed, because proceeding is how a collapse discards.
   */
  readonly blocked: boolean;
  /** Steps a caller still owes, named. Revoking temporary MCP and plugin
   *  access is not something a pure planner can perform. */
  readonly revokeTemporaryAccessFor: readonly string[];
}

export type RechainingDecision =
  | { readonly ok: true; readonly plan: RechainingPlan }
  | { readonly ok: false; readonly refusal: string; readonly problem: string };

/**
 * Plan one controlled collapse.
 *
 * Pure and total: a snapshot that cannot be collapsed safely produces a plan
 * that SAYS so, and an incoherent snapshot is refused by name rather than
 * collapsed on a guess.
 */
export function planRechaining(snapshot: RechainingSnapshot): RechainingDecision {
  if (!Number.isInteger(snapshot.baseSlots) || snapshot.baseSlots < 0) {
    return {
      ok: false,
      refusal: 'invalid_base_capacity',
      problem: `baseSlots must be a non-negative integer; got ${String(snapshot.baseSlots)}. `
        + 'Nothing was collapsed.',
    };
  }

  // MONOTONICALLY DOWNWARD. A snapshot whose base already exceeds what the
  // expanded session could hold is not a collapse — it is a promotion wearing
  // a collapse's name, and this module has no authority to grant one.
  const expandedSlots = snapshot.baseSlots + UNCHAIN_TEMPORARY_SLOTS;
  if (snapshot.temporaryBranches.length > UNCHAIN_TEMPORARY_SLOTS) {
    return {
      ok: false,
      refusal: 'more_branches_than_slots',
      problem: `${snapshot.temporaryBranches.length} temporary branches were reported for `
        + `${UNCHAIN_TEMPORARY_SLOTS} temporary slots. A slot cannot carry two branches, so this `
        + 'snapshot cannot be trusted to say what a collapse would preserve.',
    };
  }

  const branches: BranchPlan[] = [];
  let blocked = false;

  for (const branch of snapshot.temporaryBranches) {
    const plan = disposeOf(branch);
    if (plan.disposition === 'blocked_unpersisted') blocked = true;
    branches.push(plan);
  }

  // Only a collapse that preserved everything may re-plan work onto base
  // slots. Re-planning while a branch is still unpersisted would start new
  // work on the capacity that is meant to be rescuing the old.
  const replanned = blocked ? [] : snapshot.unstartedTasks.slice(0, snapshot.baseSlots);
  const queued = blocked
    ? [...snapshot.unstartedTasks]
    : snapshot.unstartedTasks.slice(snapshot.baseSlots);

  return {
    ok: true,
    plan: {
      // The BASE, never the expanded count, and never more than was expanded.
      targetSlots: Math.min(snapshot.baseSlots, expandedSlots),
      branches,
      queued,
      replanned,
      blocked,
      // Named rather than performed: a pure planner cannot revoke anything,
      // and pretending otherwise would leave temporary access live while a
      // report said it was gone.
      revokeTemporaryAccessFor: snapshot.temporaryBranches.map((b) => b.slotId),
    },
  };
}

/** One branch's disposition, and the honest name for what its work became. */
function disposeOf(branch: TemporaryBranch): BranchPlan {
  // THE PRESERVE RULE, first and unconditionally. Nothing is cancelled,
  // converged or stopped while its work is not durably written — including
  // speculative work, because "speculative" describes why it was started, not
  // whether a user would miss it.
  if (!branch.persisted) {
    return {
      branchId: branch.branchId,
      slotId: branch.slotId,
      disposition: 'blocked_unpersisted',
      reportedAs: 'unchanged',
      reason: 'Its files, branches and evidence are not durably written yet. A collapse preserves; '
        + 'it does not discard, so this branch is not collapsed until they are.',
    };
  }

  if (branch.state === 'complete' && branch.convergeable) {
    return {
      branchId: branch.branchId,
      slotId: branch.slotId,
      disposition: 'converge',
      reportedAs: 'converged',
      reason: 'Complete and convergeable, so its work folds into the parent Loop rather than '
        + 'ending with the session that happened to be carrying it.',
    };
  }

  if (branch.state === 'speculative') {
    return {
      branchId: branch.branchId,
      slotId: branch.slotId,
      disposition: 'cancel_speculative',
      reportedAs: 'discarded',
      reason: 'Speculative and already persisted, so cancelling it costs nothing that was not '
        + 'kept — and the record says discarded, never converged.',
    };
  }

  // In progress, or complete but not convergeable. Either way the work
  // stopped before it finished, and INTERRUPTED IS NOT COMPLETE.
  return {
    branchId: branch.branchId,
    slotId: branch.slotId,
    disposition: 'preserve_and_stop',
    reportedAs: 'interrupted',
    reason: branch.handoffWritten
      ? 'Stopped mid-flight with its handoff written. Interrupted work is reported as '
        + 'interrupted — a collapse never reports it as complete.'
      : 'Stopped mid-flight. Its work is persisted and a Project Brain handoff is still owed; '
        + 'interrupted work is reported as interrupted, never as complete.',
  };
}
