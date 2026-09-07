/**
 * WHICH VISUAL MOVES JULIUS CAN ACTUALLY MAKE — derived, never declared.
 *
 * The world shows eleven states. Which of the 110 ordered pairs between them
 * are real is not a design question; it is a fact about Julius's own guarded
 * state machine, and writing it out by hand here would create a second opinion
 * that drifts the first time the kernel's table changes.
 *
 * So it is derived: a visual move A → B is KERNEL-REACHABLE when some legal
 * kernel transition K1 → K2 has A behind K1 and B behind K2. `transitionMission`
 * owns the table, `julius-state-path.ts` exists so nobody copies it, and this
 * probes through that. If Julius makes FAILED recoverable or adds a state, this
 * follows without an edit.
 *
 * WHAT THE DERIVATION SAYS, and it is worth reading before trusting it:
 *
 *   complete → nothing        a completed run has no legal move at all
 *   error → nothing           nor a failed one
 *   blocked → complete        NOT reachable. A blocked run must be observed
 *                             recovering — through coding, repair or handoff —
 *                             and then verified. Recovery is a fact, not a
 *                             silence that resolves itself
 *   idle → nothing, and nothing → idle
 *                             no kernel state maps to `idle` at all. A Julius
 *                             RUN is never idle; a MISSION is, and `idle`
 *                             therefore arrives only from the Relay phase
 *                             `ready`. That is a real asymmetry rather than a
 *                             gap in the table
 *
 * THE LIMIT, STATED RATHER THAN PAPERED OVER. Only a reading whose source is
 * `julius_run_state` may be held to this table. The other two sources are
 * coarser — a phase or an event's name — and a `verification.failed` event
 * legitimately produces `error` mid-run without the KERNEL being FAILED. Holding
 * those to a kernel table would refuse true information because it arrived by a
 * less precise route, which is a worse failure than admitting the imprecision.
 */

import { JULIUS_MISSION_STATES } from '../julius/julius-runtime';
import { transitionIsLegal } from '../julius/julius-state-path';
import {
  JULIUS_RUN_STATE_VISUAL_STATE,
  JULIUS_VISUAL_STATES,
  isJuliusEndingState,
} from './wonderland-julius-state';
import type { JuliusStateSource, JuliusVisualState } from './wonderland-julius-state';

/* ---------------------------------------------------------- the derivation */

function deriveVisualTransitions(): Readonly<Record<JuliusVisualState, readonly JuliusVisualState[]>> {
  const table = new Map<JuliusVisualState, Set<JuliusVisualState>>(
    JULIUS_VISUAL_STATES.map((state) => [state, new Set<JuliusVisualState>()]),
  );
  for (const from of JULIUS_MISSION_STATES) {
    for (const to of JULIUS_MISSION_STATES) {
      if (!transitionIsLegal(from, to)) continue;
      const a = JULIUS_RUN_STATE_VISUAL_STATE[from];
      const b = JULIUS_RUN_STATE_VISUAL_STATE[to];
      // A kernel move between two states the world draws identically is not a
      // visual move. PAUSED → BLOCKED is a real transition and both are
      // `blocked`, so the world has nothing to do.
      if (a !== b) table.get(a)!.add(b);
    }
  }
  return Object.freeze(
    Object.fromEntries(
      [...table].map(([state, reachable]) => [state, Object.freeze([...reachable].sort())]),
    ) as Record<JuliusVisualState, readonly JuliusVisualState[]>,
  );
}

/** Every visual move the kernel's own guard permits. Derived at load. */
export const JULIUS_VISUAL_TRANSITIONS = deriveVisualTransitions();

/** True when the kernel could produce this move. Same state is not a move. */
export function visualTransitionIsKernelReachable(
  from: JuliusVisualState,
  to: JuliusVisualState,
): boolean {
  return from !== to && JULIUS_VISUAL_TRANSITIONS[from].includes(to);
}

/**
 * The visual states no kernel state maps to.
 *
 * Data rather than a comment, because "the kernel cannot produce this" is
 * exactly the kind of claim that rots. Today it is `idle` alone.
 */
export const VISUAL_STATES_WITHOUT_KERNEL_ORIGIN: readonly JuliusVisualState[] = Object.freeze(
  JULIUS_VISUAL_STATES.filter(
    (visual) => !JULIUS_MISSION_STATES.some((state) => JULIUS_RUN_STATE_VISUAL_STATE[state] === visual),
  ),
);

/* ------------------------------------------------------------- the verdict */

export const WONDERLAND_VISUAL_VERDICTS = [
  'applied',
  /** The kernel has no legal path for this move, and the kernel said so. */
  'refused_unreachable',
  /** A completed run may not be taken back to work. */
  'refused_would_uncomplete',
  /** A mission cannot end twice, differently. */
  'refused_second_ending',
] as const;
export type WonderlandVisualVerdict = (typeof WONDERLAND_VISUAL_VERDICTS)[number];

export interface WonderlandVisualDecision {
  readonly verdict: WonderlandVisualVerdict;
  /** Always a sentence when refused. A refusal with no reason is unarguable. */
  readonly reason: string | null;
}

const APPLIED: WonderlandVisualDecision = Object.freeze({ verdict: 'applied', reason: null });

/**
 * May this reading replace the state held?
 *
 * THREE GUARDS, in the order their consequences matter.
 *
 * 1. Nothing un-completes a completed mission. A completion a founder has seen
 *    is the single worst thing to retract, and genuinely new work belongs to a
 *    new mission id.
 * 2. A second, different ending does not replace the first. Whichever arrived
 *    last is not the same thing as whichever happened.
 * 3. A kernel-sourced reading must be a move the kernel could make. This is the
 *    only guard that consults the derived table, and it is deliberately the
 *    last: the first two are about truthfulness and hold regardless of source,
 *    while this one is about precision and applies only where precision exists.
 */
export function wonderlandVisualDecision(input: {
  readonly from: JuliusVisualState | null;
  readonly to: JuliusVisualState;
  readonly source: JuliusStateSource;
  /** Whether a real ending has already latched. The gate, not the state. */
  readonly terminal: boolean;
}): WonderlandVisualDecision {
  if (input.terminal) {
    if (!isJuliusEndingState(input.to)) {
      return Object.freeze({
        verdict: 'refused_would_uncomplete',
        reason: 'This mission has ended; a later working state would retract a finish already shown.',
      });
    }
    if (input.from !== null && input.to !== input.from) {
      return Object.freeze({
        verdict: 'refused_second_ending',
        reason: 'This mission already ended differently, and the first authoritative ending is the one that happened.',
      });
    }
    return APPLIED;
  }

  if (input.from === null || input.from === input.to) return APPLIED;

  // Only the kernel's own word is held to the kernel's own table.
  if (input.source !== 'julius_run_state') return APPLIED;

  if (!visualTransitionIsKernelReachable(input.from, input.to)) {
    return Object.freeze({
      verdict: 'refused_unreachable',
      reason: `Julius has no legal move from ${input.from} to ${input.to}, so this reading cannot be what the run did.`,
    });
  }
  return APPLIED;
}

/**
 * THE MOVES THAT MUST NEVER BE REACHABLE, named so the derivation is checked
 * rather than trusted.
 *
 * Deriving a table is only safe if something asserts the derivation produced
 * the rules that matter. These are the product's own commitments, and a change
 * to Julius's table that made any of them reachable is a change this repository
 * has to notice rather than silently adopt.
 */
export const WONDERLAND_FORBIDDEN_VISUAL_MOVES: readonly (readonly [
  JuliusVisualState,
  JuliusVisualState,
])[] = Object.freeze([
  ['blocked', 'complete'],
  ['error', 'complete'],
  ['complete', 'coding'],
  ['complete', 'verifying'],
  ['complete', 'error'],
  ['error', 'coding'],
]);
