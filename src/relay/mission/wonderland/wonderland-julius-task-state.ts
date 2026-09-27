/**
 * JULIUS RUN STATE -> THE MISSION CONTRACT'S TASK LIFECYCLE.
 *
 * Two vocabularies describe one mission and nothing connected them. Julius's
 * kernel reports thirteen guarded states (`JULIUS_MISSION_STATES`). The Mission
 * Contract in Unreal renders eleven (`EWonderlandTaskState`, which its header
 * calls "the founder's own list, unchanged"). The seam already maps Julius's
 * states TOTALLY onto the Relay Dog's animation (`wonderland-julius-state.ts`);
 * it never mapped them onto the task a user is actually watching, so a real
 * Julius mission had no truthful way to reach the Mission Contract at all.
 *
 * THE MAP IS TOTAL, AND THREE OF ITS ANSWERS ARE REFUSALS.
 *
 * `Record<JuliusMissionState, ...>` makes tsc reject a Julius state added
 * upstream until somebody decides what it means here, so a new state cannot
 * fall through to ordinal 0. And three Julius states have no honest member in
 * the founder's list:
 *
 *   BLOCKED    a reviewer or a policy stopped the run. Paused would say someone
 *              chose to stop it and Failed would say it broke. Both are false.
 *   WAITING    the run is waiting on a person -- an approval or a checkpoint.
 *              Paused is a choice, not a wait; Queued means Julius has not
 *              reached the work at all.
 *   CANCELLED  someone stopped it on purpose. Failed says it broke.
 *
 * Those return `unrepresentable` and carry Julius's own word, so a caller has to
 * render the truth ("JULIUS: BLOCKED") rather than the nearest wrong member.
 * The fix is to add Blocked, Waiting and Cancelled to EWonderlandTaskState, and
 * that is the founder's decision because the list is theirs. Until then the gap
 * is visible instead of papered over -- which is the whole point of the seam.
 *
 * READY IS QUEUED, NEVER RUNNING. Julius's fifth client rule: a mission created
 * over the bridge answers `dispatched: false` in READY, and that means nobody is
 * working on it yet. Queued is documented in C++ as "a real contract, waiting
 * for Julius to reach it", which is exactly that and nothing more.
 *
 * TWO TASK STATES JULIUS CAN NEVER PRODUCE. Draft is local -- the only state a
 * task is created in, and "known to no backend". Research has no Julius state at
 * all: Julius carries a research CLAUSE, not a RESEARCH phase. A task whose
 * source is Julius and whose state is either of these is a contradiction, and
 * `JULIUS_REACHABLE_TASK_STATES` makes that mechanically checkable.
 *
 * COMPLETION HAS EXACTLY ONE ROUTE IN. Only Julius's own COMPLETED reaches the
 * task's Completed. The kernel reaches COMPLETED only through verification, so
 * the Mission Contract can never announce a completion Julius did not reach.
 */

import { JULIUS_MISSION_STATES } from '../julius/julius-runtime';
import type { JuliusMissionState } from '../julius/julius-runtime';

/** EWonderlandTaskState, member for member, in ordinal order. */
export const WONDERLAND_TASK_STATES = [
  'Draft',
  'Queued',
  'Preparation',
  'Research',
  'Implementation',
  'Verification',
  'Review',
  'Repair',
  'Completed',
  'Failed',
  'Paused',
] as const;

export type WonderlandTaskState = (typeof WONDERLAND_TASK_STATES)[number];

/**
 * EWonderlandTaskSource -- who said so. Ordinal 0 is Local, so a
 * default-constructed task can never claim that Julius reported it.
 */
export const WONDERLAND_TASK_SOURCES = ['Local', 'Julius'] as const;

export type WonderlandTaskSource = (typeof WONDERLAND_TASK_SOURCES)[number];

export type WonderlandTaskStateProjection =
  | { readonly kind: 'state'; readonly state: WonderlandTaskState }
  | {
      readonly kind: 'unrepresentable';
      readonly juliusState: JuliusMissionState;
      readonly reason: string;
    };

const state = (value: WonderlandTaskState): WonderlandTaskStateProjection =>
  Object.freeze({ kind: 'state', state: value });

const refuse = (juliusState: JuliusMissionState, reason: string): WonderlandTaskStateProjection =>
  Object.freeze({ kind: 'unrepresentable', juliusState, reason });

/** TOTAL over Julius's thirteen states. A state added upstream fails tsc here. */
export const JULIUS_TO_WONDERLAND_TASK_STATE: Readonly<
  Record<JuliusMissionState, WonderlandTaskStateProjection>
> = Object.freeze({
  CREATED: state('Queued'),
  READY: state('Queued'),
  PLANNING: state('Preparation'),
  EXECUTING: state('Implementation'),
  REVIEWING: state('Review'),
  REPAIRING: state('Repair'),
  VERIFYING: state('Verification'),
  PAUSED: state('Paused'),
  FAILED: state('Failed'),
  COMPLETED: state('Completed'),
  BLOCKED: refuse(
    'BLOCKED',
    'EWonderlandTaskState has no Blocked member. Paused would say someone chose to stop the run and Failed would say it broke; a blocked run did neither.',
  ),
  WAITING: refuse(
    'WAITING',
    'EWonderlandTaskState has no Waiting member. The run is waiting on a person; Paused is a choice and Queued means Julius has not reached the work.',
  ),
  CANCELLED: refuse(
    'CANCELLED',
    'EWonderlandTaskState has no Cancelled member. A cancelled run was stopped on purpose; Failed would say it broke.',
  ),
});

const JULIUS_STATE_SET: ReadonlySet<string> = new Set<string>(JULIUS_MISSION_STATES);

/**
 * Project what Julius reported onto the Mission Contract.
 *
 * `null` in, `null` out: no report is Unknown, and it renders as Unknown. A
 * string this build does not know is ALSO `null` -- a newer Julius can send a
 * state this client was never taught, and guessing at it would be deriving a
 * conclusion Julius did not reach.
 */
export function projectJuliusTaskState(
  juliusState: string | null,
): WonderlandTaskStateProjection | null {
  if (juliusState === null || !JULIUS_STATE_SET.has(juliusState)) return null;
  return JULIUS_TO_WONDERLAND_TASK_STATE[juliusState as JuliusMissionState];
}

/** Every task state a Julius report can produce. Draft and Research are never in it. */
export const JULIUS_REACHABLE_TASK_STATES: ReadonlySet<WonderlandTaskState> = new Set(
  Object.values(JULIUS_TO_WONDERLAND_TASK_STATE).flatMap((projection) =>
    projection.kind === 'state' ? [projection.state] : [],
  ),
);

/** The Julius states the founder's task list cannot yet show. */
export const JULIUS_STATES_WITHOUT_A_TASK_STATE: readonly JuliusMissionState[] = Object.freeze(
  JULIUS_MISSION_STATES.filter(
    (juliusState) => JULIUS_TO_WONDERLAND_TASK_STATE[juliusState].kind === 'unrepresentable',
  ),
);
