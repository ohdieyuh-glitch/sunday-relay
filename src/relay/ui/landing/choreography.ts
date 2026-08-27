/**
 * THE LANDING'S SCROLL CHOREOGRAPHY — one continuous scene, eight beats.
 *
 * Reference A's page is a single viewport of rendered space, not a scrolling
 * document; Reference B distributes content to viewport corners around one
 * central artifact. Relay takes both: ONE persistent WebGL scene that the
 * scroll flies a camera through, with corner-anchored chrome that changes per
 * beat. No beat owns a background, and there are no section dividers — the
 * camera and the light announce a change, never a rule across the page.
 *
 * Everything here is PURE. Scroll progress in, camera and intent out. That is
 * deliberate: the choreography is the part most likely to be wrong, and it is
 * the part that can be tested with no GPU and no browser.
 */

import type { DogState } from './three/dog-rig';

export type Vec3 = readonly [number, number, number];

/** A beat of the story. `id` is stable and used by tests and the scene index. */
export type LandingScene = {
  readonly id: string;
  readonly index: number;
  /** Small mono label, Reference B's telemetry register. */
  readonly eyebrow: string;
  readonly headline: string;
  /** One short supporting line. Never a paragraph. */
  readonly body: string;
  /** Floating system labels rendered as depth-sorted glass chips, if any. */
  readonly nodes?: readonly string[];
  readonly cta?: { readonly label: string; readonly href: string };
};

/**
 * The eight beats. Copy is deliberately sparse — the founder's rule is that the
 * visuals explain Relay as much as the text does.
 *
 * Naming is governed: the configuration surface is C.A.R.D., never PSP, and the
 * role stack is described as SYSTEM COMPONENTS, never as a software team.
 */
export const LANDING_SCENES: readonly LandingScene[] = Object.freeze([
  {
    id: 'signal',
    index: 0,
    eyebrow: 'AQUALA TECHNOLOGIES',
    headline: 'Signal, before software.',
    body: 'Something is moving through the system.',
  },
  {
    id: 'relay',
    index: 1,
    eyebrow: 'SUNDAY RELAY',
    headline: 'The runtime for Compound AI Agents.',
    body: 'Not a coding assistant. The control plane that decides when work is actually done.',
  },
  {
    id: 'compound',
    index: 2,
    eyebrow: 'COMPOUND AGENT',
    headline: 'One agent, many faculties.',
    body: 'Components, not colleagues. Each one is a part of the runtime, not a person at a desk.',
    nodes: ['Prompt Architect', 'Coding Agent', 'Independent Reviewer', 'Project Brain', 'Verification', 'Mission'],
  },
  {
    id: 'mission',
    index: 3,
    eyebrow: 'MISSION RUNTIME',
    headline: 'Completion is earned, not claimed.',
    body: 'Every mission walks the whole loop. An agent saying it finished is not the end of one.',
    nodes: ['Objective', 'Plan', 'Execute', 'Evaluate', 'Repair', 'Prove', 'Persist'],
  },
  {
    id: 'brain',
    index: 4,
    eyebrow: 'PROJECT BRAIN',
    headline: 'Memory that survives the session.',
    body: 'Decisions, constraints, findings, repairs and evidence — durable, not chat history.',
    nodes: ['Objective', 'Architecture', 'Constraints', 'Decisions', 'Findings', 'Repairs', 'Evidence'],
  },
  {
    id: 'card',
    index: 5,
    eyebrow: 'C.A.R.D.',
    headline: 'Configure the agent, then build.',
    body: 'Models, tools, permissions, budgets and verification policy — one legible configuration.',
    nodes: ['Models', 'Tools', 'Permissions', 'Budgets', 'Verification', 'Identity'],
  },
  {
    id: 'wonderland',
    index: 6,
    eyebrow: 'WONDERLAND',
    headline: 'And a world to work in.',
    body: 'The spatial layer where your agents live. Beyond Relay, not instead of it.',
  },
  {
    id: 'enter',
    index: 7,
    eyebrow: 'BEGIN',
    headline: 'Build your Relay Dog.',
    body: 'Configure a Compound AI Agent, then give it something worth finishing.',
    cta: { label: 'ENTER RELAY', href: '#/relay' },
  },
]);

export const SCENE_COUNT = LANDING_SCENES.length;

/** Where the scroll currently is, resolved into a beat and a local position. */
export type ScenePosition = {
  readonly index: number;
  /** 0..1 within the current beat. */
  readonly local: number;
  /** Global 0..1 across the whole page. */
  readonly progress: number;
};

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Hermite smoothstep. The landing's only easing for scroll-linked values. */
export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function sceneAt(progress: number, count = SCENE_COUNT): ScenePosition {
  const p = clamp01(progress);
  const scaled = p * count;
  // The final beat must resolve to `count - 1`, not `count`, at progress 1.
  const index = Math.min(count - 1, Math.floor(scaled));
  return { index, local: clamp01(scaled - index), progress: p };
}

/** A value that changes across the page, sampled by global progress. */
export type Keyframe<T> = { readonly at: number; readonly value: T };

/**
 * Sample a keyframe track. Before the first and after the last key the track
 * HOLDS rather than extrapolating — extrapolating a camera path past its last
 * key is how a scene ends up behind the floor at the bottom of the page.
 */
export function sampleTrack(track: readonly Keyframe<number>[], progress: number): number {
  if (track.length === 0) throw new Error('sampleTrack needs at least one keyframe');
  if (progress <= track[0].at) return track[0].value;
  const last = track[track.length - 1];
  if (progress >= last.at) return last.value;
  for (let i = 1; i < track.length; i += 1) {
    if (progress <= track[i].at) {
      const a = track[i - 1];
      const b = track[i];
      const span = b.at - a.at;
      const t = span === 0 ? 1 : smoothstep((progress - a.at) / span);
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

export function sampleVec3(
  tracks: readonly [readonly Keyframe<number>[], readonly Keyframe<number>[], readonly Keyframe<number>[]],
  progress: number,
): Vec3 {
  return [sampleTrack(tracks[0], progress), sampleTrack(tracks[1], progress), sampleTrack(tracks[2], progress)];
}

const k = (at: number, value: number): Keyframe<number> => ({ at, value });

/**
 * THE CAMERA PATH. Keys are at global progress, one per beat boundary, so the
 * camera is always moving somewhere — Reference A's "gravitational and
 * unhurried" cadence rather than a cut.
 *
 * The Dog stands ~20 units tall, so a camera height of 11 is eye level with its
 * chest and a height of 26 looks down on it. Anything below ~4 puts the whole
 * character above the frame — the exact failure that made an earlier Wonderland
 * hero camera render nothing but sky.
 */
export const CAMERA_POSITION: readonly [readonly Keyframe<number>[], readonly Keyframe<number>[], readonly Keyframe<number>[]] = [
  [k(0, 0), k(0.125, -3), k(0.25, -7), k(0.375, -4), k(0.5, 1), k(0.625, -2), k(0.75, -6), k(1, -3)],
  [k(0, 20), k(0.125, 15), k(0.25, 13), k(0.375, 14), k(0.5, 16), k(0.625, 13), k(0.75, 12), k(1, 13.5)],
  [k(0, 62), k(0.125, 50), k(0.25, 46), k(0.375, 48), k(0.5, 52), k(0.625, 47), k(0.75, 45), k(1, 48)],
];

export const CAMERA_TARGET: readonly [readonly Keyframe<number>[], readonly Keyframe<number>[], readonly Keyframe<number>[]] = [
  [k(0, 2), k(0.125, 4), k(0.5, 5), k(0.75, 4), k(1, 4)],
  [k(0, 17), k(0.125, 12.5), k(0.25, 12), k(0.5, 13), k(0.75, 12), k(1, 12.5)],
  [k(0, 0), k(0.25, 0), k(0.5, -2), k(0.75, -3), k(1, 0)],
];

/** Field of view. Held in a narrow cinematic band so the Dog's scale is stable. */
export const CAMERA_FOV: readonly Keyframe<number>[] = [
  k(0, 36), k(0.125, 32), k(0.375, 34), k(0.625, 32), k(1, 31),
];

/** How present the Aquala mark is, 0..1. It anchors the first beat and the last. */
export const AQUALA_PRESENCE: readonly Keyframe<number>[] = [
  k(0, 1), k(0.14, 1), k(0.26, 0.22), k(0.7, 0.2), k(0.86, 0.4), k(1, 0.7),
];

/**
 * HOW PRESENT THE DOG IS — AND IT IS ALWAYS PRESENT.
 *
 * This is a hard UI invariant, not a curve with a taste value in it: once the
 * experience begins the Relay Dog is a realtime 3D object on screen, at hero
 * scale, for every beat. It previously faded in at beat two and the founder
 * rejected that. The track is kept (rather than deleted) so the Dog can still
 * settle in over the first fraction of a second rather than popping in on load,
 * but it never returns to zero and never drops below hero presence.
 *
 * `dog-persistence.test.ts` samples this across the whole page and fails if any
 * point falls below 1.
 */
export const DOG_PRESENCE: readonly Keyframe<number>[] = [
  k(0, 1), k(1, 1),
];

/**
 * What the Dog is doing, per beat. The founder's rule is that it inhabits the
 * interface rather than performing in it, so most beats are IDLE with intent
 * expressed by where it stands and what it watches.
 */
export type DogBeat = {
  readonly state: DogState;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** Does it track the pointer during this beat? */
  readonly tracksPointer: boolean;
};

/**
 * THE DOG IS THE CONSTANT. THE INFORMATION AROUND IT CHANGES.
 *
 * Every mark below is within a couple of units of the same spot, right of the
 * centre line so the bottom-left copy stays clear. The Dog no longer tours the
 * page — the founder's direction is that the user should feel they are standing
 * in front of their Compound Agent while it is configured, so the beats express
 * intent through FACING, STATE and attention rather than through travel.
 *
 * Exactly one beat contains locomotion, and it is a single step.
 */
export const DOG_BEATS: readonly DogBeat[] = Object.freeze([
  // Beat 1 — standing beneath the Aquala mark while the signal converges.
  { state: 'IDLE', x: 5, z: 0, yaw: 0.08, tracksPointer: true },
  // Beat 2 — Relay names itself; the Dog turns to the viewer.
  { state: 'LOOK', x: 5, z: 1, yaw: 0.16, tracksPointer: true },
  // Beat 3 — the compound faculties assemble around it.
  { state: 'LOOK', x: 5, z: 1, yaw: 0, tracksPointer: true },
  // Beat 4 — the mission loop. ONE step across, not a lap of the page.
  { state: 'WALK', x: 6.5, z: 0, yaw: 0.2, tracksPointer: false },
  // Beat 5 — Project Brain. It settles and holds.
  { state: 'PAUSE', x: 6.5, z: 0, yaw: -0.12, tracksPointer: true },
  // Beat 6 — C.A.R.D. It turns toward the configuration.
  { state: 'TURN', x: 6, z: 1, yaw: -0.3, tracksPointer: true },
  // Beat 7 — Wonderland. A quarter turn toward the opening, no departure.
  { state: 'TURN', x: 5.5, z: 0, yaw: -0.65, tracksPointer: false },
  // Beat 8 — back to the viewer for CREATE YOUR RELAY.
  { state: 'IDLE', x: 5, z: 2, yaw: 0, tracksPointer: true },
]);

/** Resolve the Dog's intent by blending the current beat toward the next. */
export function dogBeatAt(position: ScenePosition): DogBeat {
  const current = DOG_BEATS[position.index];
  const next = DOG_BEATS[Math.min(DOG_BEATS.length - 1, position.index + 1)];
  // Movement leads the copy: the Dog starts toward the next mark in the last
  // third of a beat, so it is already travelling when the headline changes.
  const lead = smoothstep((position.local - 0.72) / 0.28);
  if (lead <= 0) return current;
  const moving = lead > 0.02 && lead < 0.98;
  return {
    state: moving && current.state !== 'REACT' ? 'WALK' : next.state,
    x: current.x + (next.x - current.x) * lead,
    z: current.z + (next.z - current.z) * lead,
    yaw: current.yaw + shortestLerp(current.yaw, next.yaw) * lead,
    tracksPointer: lead > 0.5 ? next.tracksPointer : current.tracksPointer,
  };
}

function shortestLerp(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
