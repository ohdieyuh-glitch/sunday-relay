import { clamp01, smoothstep, type Vec3 } from '../landing/choreography';

/**
 * AQUALA → RELAY: the transition, authored as pure math.
 *
 * The founder's requirement is that entering Relay feels like clicking a
 * machine and physically stepping into it — one continuous product, not a
 * cinematic site that links to a dashboard. Mechanically that means three
 * things, and this module owns the third:
 *
 *   1. ONE WebGL scene across the whole journey (owned by `useRelayWorld`).
 *   2. The portal is the artifact itself, hit-tested in 3D (owned by the engine).
 *   3. The camera move is AUTHORED, not a wait-then-navigate. That is here.
 *
 * Everything below is pure: a stage, a progress value and a clock in; a camera,
 * a mark and a veil out. That is what lets the choreography be verified on a
 * machine with no GPU, which is where it was built.
 */

export type WorldStage = 'aquala' | 'transition' | 'relay';

/** A camera pose the transition interpolates through. */
export type CameraPose = { readonly position: Vec3; readonly target: Vec3; readonly fov: number };

/**
 * How long the passage takes. Long enough to read as travel, short enough that
 * it never becomes a loading screen — the founder ruled out a spinner as the
 * transition, and a slow camera move is the same sin wearing better clothes.
 */
export const TRANSITION_SECONDS = 2.4;

/**
 * Reduced motion keeps the EVENT and drops the traversal: the veil still
 * carries the user through and the scene still resolves into Relay, but the
 * camera does not fly. It is a different choreography, not a disabled one.
 */
export const REDUCED_TRANSITION_SECONDS = 0.55;

export function transitionDuration(reducedMotion: boolean): number {
  return reducedMotion ? REDUCED_TRANSITION_SECONDS : TRANSITION_SECONDS;
}

/** The camera's resting pose on the first Relay screen. */
export const CREATE_AGENT_POSE: CameraPose = Object.freeze({
  position: [-2, 12, 56] as Vec3,
  target: [3, 10.5, 0] as Vec3,
  fov: 31,
});

/**
 * The pose at the mouth of the portal: hard up against the mark, field of view
 * opened wide so the ring passes outside the frame rather than shrinking away.
 * Built from the mark's own world position so it cannot drift from it.
 */
export function portalPose(aqualaOrigin: Vec3): CameraPose {
  return {
    position: [aqualaOrigin[0], aqualaOrigin[1], aqualaOrigin[2] + 7.5],
    target: [aqualaOrigin[0], aqualaOrigin[1], aqualaOrigin[2] - 6],
    fov: 62,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t),
];

export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const e = smoothstep(t);
  return { position: lerp3(a.position, b.position, e), target: lerp3(a.target, b.target, e), fov: lerp(a.fov, b.fov, e) };
}

/** Everything the renderer needs for one frame of the passage. */
export type TransitionFrame = {
  readonly camera: CameraPose;
  /** How present the Aquala mark is — it swells, then is behind us. */
  readonly aqualaPresence: number;
  /** Scale multiplier on the mark, so it grows as the camera closes. */
  readonly aqualaScale: number;
  /**
   * The baby-blue veil, 0..1. Aquala's own light becoming transitional light.
   * DELIBERATELY NOT WHITE and deliberately capped below opaque: a hard white
   * flash is the cheap way to hide a cut, and hiding a cut is exactly what this
   * transition must not be doing.
   */
  readonly veil: number;
  /** Landing chrome opacity. */
  readonly aqualaChrome: number;
  /** Relay chrome opacity. */
  readonly relayChrome: number;
};

/** The threshold at which the passage hands the screen over to Relay. */
export const HANDOVER = 0.5;

/**
 * Sample the passage.
 *
 * `from` is wherever the Aquala camera happened to be when the user committed —
 * the move begins from the live pose rather than snapping to a canonical one,
 * which is the difference between a transition and a cut.
 */
export function transitionFrame(
  progress: number,
  from: CameraPose,
  aqualaOrigin: Vec3,
  reducedMotion: boolean,
): TransitionFrame {
  const p = clamp01(progress);
  const portal = portalPose(aqualaOrigin);

  if (reducedMotion) {
    // No traversal: hold the departure pose, veil across, arrive. The scene
    // still changes and the mark still flares — only the flight is removed.
    return {
      camera: p < HANDOVER ? from : CREATE_AGENT_POSE,
      aqualaPresence: p < HANDOVER ? 1 : 0.22,
      aqualaScale: 1,
      veil: Math.sin(p * Math.PI) * 0.72,
      aqualaChrome: 1 - smoothstep(p / HANDOVER),
      relayChrome: smoothstep((p - HANDOVER) / (1 - HANDOVER)),
    };
  }

  // Two legs: in through the mark, then out into the Relay framing.
  const camera = p < HANDOVER
    ? lerpPose(from, portal, p / HANDOVER)
    : lerpPose(portal, CREATE_AGENT_POSE, (p - HANDOVER) / (1 - HANDOVER));

  return {
    camera,
    // The mark is ahead of us, then behind us. It never extinguishes: it is
    // still the anchor of the product once inside.
    aqualaPresence: p < HANDOVER ? 1 : lerp(1, 0.22, smoothstep((p - HANDOVER) / 0.35)),
    aqualaScale: p < HANDOVER ? lerp(1, 1.45, smoothstep(p / HANDOVER)) : lerp(1.45, 1, smoothstep((p - HANDOVER) / 0.4)),
    // Peaks exactly at the pass-through and is gone by the time Relay resolves.
    veil: Math.sin(clamp01(p) * Math.PI) ** 1.5 * 0.78,
    aqualaChrome: 1 - smoothstep(p / 0.34),
    relayChrome: smoothstep((p - 0.62) / 0.38),
  };
}

/**
 * The stage machine. Deliberately tiny and total.
 *
 * `commit` and `leave` are the two ways into the passage and both are no-ops from anywhere but their own starting
 * stage, so a second click mid-flight cannot restart or reverse it. `arrive` and `return` are the two ways out, and
 * WHICH ONE FIRES IS THE CALLER'S BUSINESS: the machine does not know which direction a passage was flying, because
 * it does not need to -- the loop that ran the flight does.
 *
 * There is still no path from `transition` to anywhere but by finishing. Interrupting a passage half way would put
 * the camera somewhere neither stage expects, and the founder's requirement is that entering and leaving read as one
 * continuous move rather than as a screen change that can be caught mid-frame.
 */
export function nextStage(current: WorldStage, event: 'commit' | 'arrive' | 'leave' | 'return'): WorldStage {
  if (event === 'commit') return current === 'aquala' ? 'transition' : current;
  if (event === 'leave') return current === 'relay' ? 'transition' : current;
  if (event === 'return') return current === 'transition' ? 'aquala' : current;
  return current === 'transition' ? 'relay' : current;
}
