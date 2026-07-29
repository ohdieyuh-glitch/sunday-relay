/**
 * SUNDAY RELAY — MILESTONE 4.5
 * Relay Dog visual behavior projection (PURE).
 *
 * Mission state drives the dog. The dog NEVER drives mission state: nothing
 * here mutates its input, appends a trace event, touches a capsule, or knows
 * that a mission exists beyond the small visual state it is handed.
 *
 * This is a visual ADAPTER over the existing state models — it does not
 * replace `WorkspaceDogState` or `HomeDogState` and does not introduce a
 * competing mission-state system. Autonomous walking is a property of the
 * IDLE behavior only; it is not a mission state, an execution state, an
 * execution capsule fact, evidence, or mission progress.
 *
 * No React, no clock, no browser APIs — deterministic and table-testable.
 */

import type { HomeDogState } from '../entry-home/contracts';
import type { WorkspaceDogState } from '../project-workspace/contracts';

export const RELAY_DOG_ACTIVITIES = [
  'idle',
  'thinking',
  'waiting_for_user',
  'researching',
  'implementing',
  'handoff',
  'verifying',
  'reviewing',
  'repairing',
  'complete',
  'error',
] as const;
export type RelayDogActivityKind = (typeof RELAY_DOG_ACTIVITIES)[number];

export interface RelayDogBehavior {
  activity: RelayDogActivityKind;
  /** Autonomous left/right patrol is permitted. True for idle only. */
  patrolEnabled: boolean;
  /** The state is asking a human to act — drives the attention animation. */
  attentionRequired: boolean;
  /** What to show instead of a looping animation under reduced motion. */
  reducedMotionFallback: string;
}

/**
 * Deterministic animation priority — LOWER number wins, so two signals can
 * never animate at once. Reduced motion is handled ahead of all of these by
 * the controller (it replaces the loop, it does not pick a different
 * activity).
 *
 * The order follows Relay's product semantics: a failure outranks everything,
 * a human being blocked outranks any machine work, and review/verification
 * outrank the work they are judging, because that is the state the operator
 * most needs to see. Idle patrol is always last — it may only run when
 * nothing else is happening.
 */
export const DOG_ACTIVITY_PRIORITY: Record<RelayDogActivityKind, number> = {
  error: 1,
  waiting_for_user: 2,
  reviewing: 3,
  verifying: 4,
  repairing: 5,
  implementing: 6,
  researching: 7,
  thinking: 8,
  handoff: 9,
  complete: 10,
  idle: 11,
};

/** The single highest-priority activity among candidates; `idle` when none. */
export function resolveDogActivity(
  candidates: readonly RelayDogActivityKind[],
): RelayDogActivityKind {
  return [...candidates].sort(
    (a, b) => DOG_ACTIVITY_PRIORITY[a] - DOG_ACTIVITY_PRIORITY[b],
  )[0] ?? 'idle';
}

const REDUCED_MOTION_FALLBACK: Record<RelayDogActivityKind, string> = {
  idle: 'RELAY IDLE',
  thinking: 'THINKING',
  waiting_for_user: 'WAITING FOR YOU',
  researching: 'RESEARCHING',
  implementing: 'IMPLEMENTING',
  handoff: 'CARRYING HANDOFF',
  verifying: 'VERIFYING',
  reviewing: 'REVIEWING',
  repairing: 'REPAIRING',
  complete: 'COMPLETE',
  error: 'STOPPED',
};

function behavior(activity: RelayDogActivityKind): RelayDogBehavior {
  return {
    activity,
    // Patrol belongs to idle alone — every other activity owns the dog.
    patrolEnabled: activity === 'idle',
    attentionRequired: activity === 'waiting_for_user' || activity === 'error',
    reducedMotionFallback: REDUCED_MOTION_FALLBACK[activity],
  };
}

/** Workspace visual state → dog behavior. Existing state names preserved. */
const WORKSPACE_ACTIVITY: Record<WorkspaceDogState, RelayDogActivityKind> = {
  wandering: 'idle',
  trotting: 'thinking',
  // The coding agent is doing the work: `implementing` is the explicit state,
  // and the legacy running/sprinting values mean the same thing.
  implementing: 'implementing',
  running: 'implementing',
  sprinting: 'implementing',
  carrying_handoff: 'handoff',
  researching: 'researching',
  verifying: 'verifying',
  reviewing: 'reviewing',
  repairing: 'repairing',
  waiting_for_user: 'waiting_for_user',
  // A safe stop is a finished, non-error resting state — never an error pose.
  stopped_safely: 'complete',
  complete: 'complete',
};

/** Home visual state → dog behavior. Pre-mission states are all idle-ish. */
const HOME_ACTIVITY: Record<HomeDogState, RelayDogActivityKind> = {
  ready: 'idle',
  wandering: 'idle',
  waiting: 'waiting_for_user',
};

export function projectWorkspaceDogBehavior(state: WorkspaceDogState): RelayDogBehavior {
  return behavior(WORKSPACE_ACTIVITY[state] ?? 'idle');
}

export function projectHomeDogBehavior(state: HomeDogState): RelayDogBehavior {
  return behavior(HOME_ACTIVITY[state] ?? 'idle');
}

/**
 * The general entry point named in the milestone. Accepts either visual state
 * vocabulary (they do not overlap ambiguously) and falls back to `idle` for
 * anything unrecognized, so an unknown state can never leave the dog without
 * a safe behavior.
 */
export function projectRelayStateToDogBehavior(
  state: WorkspaceDogState | HomeDogState | string,
): RelayDogBehavior {
  const activity =
    (WORKSPACE_ACTIVITY as Record<string, RelayDogActivityKind | undefined>)[state] ??
    (HOME_ACTIVITY as Record<string, RelayDogActivityKind | undefined>)[state] ??
    'idle';
  return behavior(activity);
}
