/**
 * SUNDAY RELAY — BOUNDED REPAIR LOOPS
 *
 * A repair loop takes ONE blocking finding and tries to close it: dispatch a
 * repair, re-verify, repeat — up to a bound. The bound is the point. An
 * unbounded repair loop is a machine for converting a defect into a bill, and
 * the llmops vocabulary this feeds already states the doctrine: `limit_reached`
 * is NOT a success; a loop that ran out of budget with the finding still open
 * produced an unfixed defect AND a bill.
 *
 * WHAT IT REFUSES.
 *
 * - **To declare victory on the repairer's word.** A cycle counts as repaired
 *   only when the VERIFIER — not the agent that wrote the fix — says the
 *   finding no longer reproduces. The same never-self-approve rule the whole
 *   repository runs on.
 * - **To let a repair grow its own scope.** `repairExpandsFileClaims` already
 *   exists for exactly this: a repair that touches files beyond the finding's
 *   claim is refused, not quietly accepted. Scope creep inside a repair loop is
 *   how a one-line fix becomes an unreviewed rewrite.
 * - **To run one cycle past the bound**, whatever the trend. "It looks close"
 *   is how budgets die.
 * - **To hide the ending.** Every loop ends in exactly one of the llmops
 *   outcomes — `converged`, `limit_reached`, `abandoned` — and the full cycle
 *   list rides along, so the operations record shows the bill as well as the
 *   verdict.
 */

import type {
  RelayRepairCycle, RelayRepairLoop, RelayRepairOutcome,
} from '../../shared/llmops';
import { repairExpandsFileClaims } from '../review-repair';

/** One attempt to fix the finding, as the ports report it. */
export interface RepairAttemptReport {
  /** Files the repair actually touched, for the scope check. */
  readonly touchedFiles: readonly string[];
  /** The repairer's own claim. Recorded, never trusted as the verdict. */
  readonly claimsFixed: boolean;
}

export type RepairVerifyResult =
  | { readonly finding: 'still_open' }
  | { readonly finding: 'closed' }
  /** The verifier could not answer. NOT a pass — an unverifiable repair is an
   *  open finding with extra steps. */
  | { readonly finding: 'unverifiable'; readonly reason: string };

export interface RepairLoopPorts {
  /** Dispatch one bounded repair attempt. Throwing counts as a failed cycle. */
  dispatchRepair(cycle: number): Promise<RepairAttemptReport>;
  /** Independently re-verify the finding. Never the same actor as the repair. */
  verify(cycle: number): Promise<RepairVerifyResult>;
  readonly now: () => string;
}

export interface RepairLoopInput {
  readonly loopId: string;
  readonly findingId: string;
  /** Files the finding claims. A repair may not touch beyond them. */
  readonly claimedFiles: readonly string[];
  /** Cycles allowed. From project settings' repairLimit; never unbounded. */
  readonly maxCycles: number;
  readonly missionId?: string;
}

export interface RepairLoopResult {
  readonly loop: RelayRepairLoop;
  /** Why it ended, in a sentence a surface can print. */
  readonly reason: string;
}

const outcomeOf = (converged: boolean, exhausted: boolean): RelayRepairOutcome =>
  converged ? 'converged' : exhausted ? 'limit_reached' : 'abandoned';

/**
 * Run one bounded repair loop to its end.
 *
 * Total: a throwing port is a failed cycle, not a crashed loop. The loop's
 * job is to report how the money was spent, and a report that dies mid-way
 * reports nothing.
 */
export async function runRepairLoop(
  ports: RepairLoopPorts,
  input: RepairLoopInput,
): Promise<RepairLoopResult> {
  const cycles: RelayRepairCycle[] = [];

  if (!Number.isInteger(input.maxCycles) || input.maxCycles < 1) {
    // A bound that is not a bound. Refused rather than defaulted: silently
    // substituting a limit is how "unbounded" ships wearing a number.
    return {
      loop: {
        loopId: input.loopId,
        cycles: [],
        outcome: 'abandoned',
        ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
      },
      reason: `maxCycles must be a positive integer; got ${String(input.maxCycles)}. Nothing was dispatched.`,
    };
  }

  for (let cycle = 1; cycle <= input.maxCycles; cycle += 1) {
    let attempt: RepairAttemptReport | null = null;
    try {
      attempt = await ports.dispatchRepair(cycle);
    } catch {
      // A repair that crashed did not repair. The cycle is recorded — it was
      // paid for — and the loop continues to its bound.
      cycles.push({ cycle, findingId: input.findingId, repaired: false, at: ports.now() });
      continue;
    }

    // Scope check BEFORE verification, through the ONE existing rule rather
    // than an inline copy of it — two implementations of the same rule is the
    // divergence bug the shared options type exists to prevent, and a repair
    // that touched files beyond the finding's claim is refused however good it
    // looks. Scope creep inside a repair loop is how a one-line fix becomes an
    // unreviewed rewrite.
    const expanded = repairExpandsFileClaims(
      { affectedFiles: [...attempt.touchedFiles] },
      [...input.claimedFiles],
    );
    if (expanded) {
      cycles.push({ cycle, findingId: input.findingId, repaired: false, at: ports.now() });
      continue;
    }

    let verdict: RepairVerifyResult;
    try {
      verdict = await ports.verify(cycle);
    } catch (error) {
      verdict = {
        finding: 'unverifiable',
        reason: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      };
    }

    // Only the VERIFIER closes a finding. The repairer's claimsFixed is
    // recorded upstream but never decides — an unverifiable repair is an open
    // finding with extra steps.
    const repaired = verdict.finding === 'closed';
    cycles.push({ cycle, findingId: input.findingId, repaired, at: ports.now() });

    if (repaired) {
      return {
        loop: {
          loopId: input.loopId,
          cycles,
          outcome: 'converged',
          ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
        },
        reason: `The verifier confirmed the finding closed on cycle ${cycle} of ${input.maxCycles}.`,
      };
    }
  }

  return {
    loop: {
      loopId: input.loopId,
      cycles,
      outcome: outcomeOf(false, true),
      ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
    },
    reason: `${input.maxCycles} cycle(s) spent and the finding is still open. `
      + 'This is an unfixed defect and a bill, not a completion.',
  };
}
