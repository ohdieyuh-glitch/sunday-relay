/**
 * OFFICIAL RELAY DOG — canonical state semantics, shared verbatim by every
 * surface. Byte-identical in the website/application and the CLI/terminal.
 *
 * The website's Milestone 4.5 motion system is AUTHORITATIVE:
 *   src/relay/ui/relay-dog-motion/dog-behavior.ts   (behavior + priority)
 *   src/relay/ui/project-workspace/projections.ts   (pose/marker/label)
 *
 * This module mirrors those meanings so a terminal surface can express the
 * SAME dog states without importing React — and a parity test on the website
 * asserts the mirror still matches the authoritative modules field for field.
 * If Milestone 4.5 changes a meaning, that test fails loudly rather than
 * letting the two surfaces drift.
 *
 * Mission state drives the dog. The dog NEVER drives mission state: nothing
 * here mutates its input, appends a trace event, touches a capsule, or claims
 * mission progress. Autonomous walking is a property of the IDLE behavior
 * only — it is not a mission state, an execution fact, or evidence.
 *
 * PURE — no imports, no clock, no framework, no environment.
 */

import type { OfficialRelayDogPose } from './official-relay-dog-sprite';

/* ------------------------------ activities ----------------------------- */

export const OFFICIAL_RELAY_DOG_ACTIVITIES = [
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
export type OfficialRelayDogActivity = (typeof OFFICIAL_RELAY_DOG_ACTIVITIES)[number];

/**
 * Deterministic animation priority — LOWER number wins, so two signals can
 * never animate at once. Mirrors DOG_ACTIVITY_PRIORITY: a failure outranks
 * everything, a blocked human outranks any machine work, review/verification
 * outrank the work they judge, and idle patrol is always last.
 */
export const OFFICIAL_RELAY_DOG_ACTIVITY_PRIORITY: Record<OfficialRelayDogActivity, number> = {
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

/** What a surface shows INSTEAD of a looping animation under reduced motion.
 *  Text, always — never color or glyph alone. */
export const OFFICIAL_RELAY_DOG_REDUCED_MOTION_FALLBACK: Record<OfficialRelayDogActivity, string> = {
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

export interface OfficialRelayDogBehavior {
  activity: OfficialRelayDogActivity;
  /** Autonomous left/right patrol is permitted. True for idle only. */
  patrolEnabled: boolean;
  /** The state is asking a human to act — drives the attention animation. */
  attentionRequired: boolean;
  /** What to show instead of a looping animation under reduced motion. */
  reducedMotionFallback: string;
}

export function officialRelayDogBehavior(
  activity: OfficialRelayDogActivity,
): OfficialRelayDogBehavior {
  return {
    activity,
    // Patrol belongs to idle alone — every other activity owns the dog.
    patrolEnabled: activity === 'idle',
    attentionRequired: activity === 'waiting_for_user' || activity === 'error',
    reducedMotionFallback: OFFICIAL_RELAY_DOG_REDUCED_MOTION_FALLBACK[activity],
  };
}

/** The single highest-priority activity among candidates; `idle` when none. */
export function resolveOfficialRelayDogActivity(
  candidates: readonly OfficialRelayDogActivity[],
): OfficialRelayDogActivity {
  return (
    [...candidates].sort(
      (a, b) =>
        OFFICIAL_RELAY_DOG_ACTIVITY_PRIORITY[a] - OFFICIAL_RELAY_DOG_ACTIVITY_PRIORITY[b],
    )[0] ?? 'idle'
  );
}

/* ------------------------------- states -------------------------------- */

/** Workspace visual state names — the shared vocabulary both surfaces use. */
export const OFFICIAL_WORKSPACE_DOG_STATES = [
  'wandering',
  'trotting',
  'running',
  'implementing',
  'sprinting',
  'carrying_handoff',
  'researching',
  'verifying',
  'reviewing',
  'repairing',
  'waiting_for_user',
  'stopped_safely',
  'complete',
] as const;
export type OfficialWorkspaceDogState = (typeof OFFICIAL_WORKSPACE_DOG_STATES)[number];

/** Home (pre-mission) visual state names. */
export const OFFICIAL_HOME_DOG_STATES = ['ready', 'waiting', 'wandering'] as const;
export type OfficialHomeDogState = (typeof OFFICIAL_HOME_DOG_STATES)[number];

/** Workspace state -> activity. Mirrors WORKSPACE_ACTIVITY exactly. */
export const OFFICIAL_WORKSPACE_STATE_ACTIVITY: Record<
  OfficialWorkspaceDogState,
  OfficialRelayDogActivity
> = {
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

/** Home state -> activity. Mirrors HOME_ACTIVITY exactly. */
export const OFFICIAL_HOME_STATE_ACTIVITY: Record<
  OfficialHomeDogState,
  OfficialRelayDogActivity
> = {
  ready: 'idle',
  wandering: 'idle',
  waiting: 'waiting_for_user',
};

/** Accepts either visual vocabulary; unknown states fall back to `idle` so a
 *  surface can never be left without a safe behavior. */
export function projectOfficialRelayDogActivity(state: string): OfficialRelayDogActivity {
  return (
    (OFFICIAL_WORKSPACE_STATE_ACTIVITY as Record<string, OfficialRelayDogActivity | undefined>)[
      state
    ] ??
    (OFFICIAL_HOME_STATE_ACTIVITY as Record<string, OfficialRelayDogActivity | undefined>)[state] ??
    'idle'
  );
}

export function projectOfficialRelayDogBehavior(state: string): OfficialRelayDogBehavior {
  return officialRelayDogBehavior(projectOfficialRelayDogActivity(state));
}

/* ---------------------------- presentation ----------------------------- */

/** Attention/among-the-art markers. Mirrors PixelDogMarker. */
export type OfficialRelayDogMarker = 'none' | 'alert' | 'check' | 'question' | 'scan';

export interface OfficialRelayDogPresentation {
  pose: OfficialRelayDogPose;
  marker: OfficialRelayDogMarker;
  /** The sprite's own leg/step animation (distinct from crossing the track). */
  moving: boolean;
  /** Uppercase system label — the same words on both surfaces. */
  label: string;
}

/** Workspace state -> pose/marker/label. Mirrors DOG_PRESENTATION exactly. */
export const OFFICIAL_RELAY_DOG_STATE_PRESENTATION: Record<
  OfficialWorkspaceDogState,
  OfficialRelayDogPresentation
> = {
  wandering: { pose: 'standing', marker: 'none', moving: true, label: 'WANDERING' },
  trotting: { pose: 'trotting', marker: 'none', moving: true, label: 'TROTTING' },
  running: { pose: 'running', marker: 'none', moving: true, label: 'RUNNING' },
  implementing: { pose: 'reaching', marker: 'none', moving: false, label: 'IMPLEMENTING' },
  sprinting: { pose: 'running', marker: 'none', moving: true, label: 'SPRINTING' },
  carrying_handoff: { pose: 'carrying', marker: 'none', moving: true, label: 'CARRYING HANDOFF' },
  researching: { pose: 'sitting', marker: 'scan', moving: false, label: 'RESEARCHING' },
  verifying: { pose: 'standing', marker: 'question', moving: false, label: 'VERIFYING' },
  reviewing: { pose: 'sitting', marker: 'question', moving: false, label: 'REVIEWING' },
  repairing: { pose: 'trotting', marker: 'alert', moving: false, label: 'REPAIRING' },
  waiting_for_user: { pose: 'sitting', marker: 'alert', moving: false, label: 'WAITING FOR USER' },
  stopped_safely: { pose: 'lying', marker: 'none', moving: false, label: 'STOPPED SAFELY' },
  complete: { pose: 'sitting', marker: 'check', moving: false, label: 'COMPLETE' },
};

/**
 * The pose to draw when only the ACTIVITY is known (a surface that has no
 * workspace state, e.g. the CLI header). Derived from the state presentation
 * above so the two can never disagree about what an activity looks like.
 * `error` has no mapped workspace state today; it rests the dog rather than
 * inventing a new silhouette.
 */
export const OFFICIAL_RELAY_DOG_ACTIVITY_POSE: Record<
  OfficialRelayDogActivity,
  OfficialRelayDogPose
> = {
  idle: 'standing',
  thinking: 'trotting',
  waiting_for_user: 'sitting',
  researching: 'sitting',
  implementing: 'reaching',
  handoff: 'carrying',
  verifying: 'standing',
  reviewing: 'sitting',
  repairing: 'trotting',
  complete: 'sitting',
  error: 'lying',
};

export const OFFICIAL_RELAY_DOG_ACTIVITY_MARKER: Record<
  OfficialRelayDogActivity,
  OfficialRelayDogMarker
> = {
  idle: 'none',
  thinking: 'none',
  waiting_for_user: 'alert',
  researching: 'scan',
  implementing: 'none',
  handoff: 'none',
  verifying: 'question',
  reviewing: 'question',
  repairing: 'alert',
  complete: 'check',
  error: 'alert',
};

/* ------------------------------- motion -------------------------------- */

/**
 * The canonical MEANING of each activity's motion. A graphical surface plays
 * it as animation; a text terminal plays the same meaning with terminal-native
 * frames. Either way the meaning — and the urgency — is identical.
 *
 *   patrol          walks autonomously left and right, pausing, turning at the
 *                   boundaries, preserving position (IDLE only)
 *   still           stands its ground; the sprite may step in place but the
 *                   dog does not cross the track
 *   attention_jump  jumps for the user's attention (WAITING FOR USER)
 *   work_scratch    up on tippy toes, front paws repeatedly pawing at an
 *                   implied vertical work surface (IMPLEMENTING)
 *   scan            sweeps/scans in place (RESEARCHING)
 *   carry           moves while carrying the handoff
 *   halt            stopped, not working (ERROR)
 */
export type OfficialRelayDogMotion =
  | 'patrol'
  | 'still'
  | 'attention_jump'
  | 'work_scratch'
  | 'scan'
  | 'carry'
  | 'halt';

export const OFFICIAL_RELAY_DOG_ACTIVITY_MOTION: Record<
  OfficialRelayDogActivity,
  OfficialRelayDogMotion
> = {
  idle: 'patrol',
  thinking: 'still',
  waiting_for_user: 'attention_jump',
  researching: 'scan',
  implementing: 'work_scratch',
  handoff: 'carry',
  verifying: 'still',
  reviewing: 'still',
  repairing: 'still',
  complete: 'still',
  error: 'halt',
};

/** Motions that move the dog ALONG the track (as opposed to in place). */
export const OFFICIAL_RELAY_DOG_TRAVELLING_MOTIONS: readonly OfficialRelayDogMotion[] = [
  'patrol',
  'carry',
];

/**
 * The full official view of one activity: behavior + how to draw it + what it
 * means in motion. This is the single call a surface needs.
 */
export interface OfficialRelayDogView extends OfficialRelayDogBehavior {
  pose: OfficialRelayDogPose;
  marker: OfficialRelayDogMarker;
  motion: OfficialRelayDogMotion;
  /** True when the motion carries the dog along the track. */
  travelling: boolean;
  label: string;
}

export function officialRelayDogView(activity: OfficialRelayDogActivity): OfficialRelayDogView {
  const motion = OFFICIAL_RELAY_DOG_ACTIVITY_MOTION[activity];
  return {
    ...officialRelayDogBehavior(activity),
    pose: OFFICIAL_RELAY_DOG_ACTIVITY_POSE[activity],
    marker: OFFICIAL_RELAY_DOG_ACTIVITY_MARKER[activity],
    motion,
    travelling: OFFICIAL_RELAY_DOG_TRAVELLING_MOTIONS.includes(motion),
    label: OFFICIAL_RELAY_DOG_REDUCED_MOTION_FALLBACK[activity],
  };
}

/** The official view for a workspace/home STATE — pose, marker and label come
 *  from the state presentation when the state is known, so the CLI shows the
 *  exact words the website shows. */
export function officialRelayDogViewForState(state: string): OfficialRelayDogView {
  const activity = projectOfficialRelayDogActivity(state);
  const view = officialRelayDogView(activity);
  const presentation = (
    OFFICIAL_RELAY_DOG_STATE_PRESENTATION as Record<
      string,
      OfficialRelayDogPresentation | undefined
    >
  )[state];
  if (!presentation) return view;
  return {
    ...view,
    pose: presentation.pose,
    marker: presentation.marker,
    label: presentation.label,
  };
}
