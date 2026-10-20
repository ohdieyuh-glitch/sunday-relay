import { clamp01, sampleTrack, type Keyframe } from '../../../src/relay/ui/landing/choreography';

/**
 * SECTION-KEYED SCROLL: ARRIVE, HOLD, DEPART.
 *
 * The landing flies its camera through eight equal beats of an 800vh track.
 * These sites are documents with sections of very different heights, so the
 * camera is keyed to SECTIONS instead, and each section gets a HOLD:
 *
 *   arrive  section i's top reaches 20% of the viewport   → value is exactly i
 *   hold    while section i is being read                  → value stays i
 *   depart  section i+1's top enters the bottom edge       → value moves toward i+1
 *
 * A plain linear mapping between section tops has no hold, and it was wrong
 * in a way screenshots made obvious: by the time a reader reached a section's
 * copy, the camera was already halfway to the NEXT section's shot. Poses are
 * sampled with the landing's own `sampleTrack`, so the easing inside each
 * transition is the landing's easing.
 */

export type ScrollRig = {
  /** Fractional section index for the current scroll position. */
  read(): number;
  /** Recompute section offsets (layout changed). */
  measure(): void;
  readonly count: number;
};

export function createScrollRig(sections: readonly HTMLElement[], arriveLine = 0.2): ScrollRig {
  let arrive: number[] = [];
  let depart: number[] = [];

  const measure = () => {
    const viewport = window.innerHeight;
    const tops = sections.map((section) => section.getBoundingClientRect().top + window.scrollY);
    arrive = tops.map((top, i) => (i === 0 ? 0 : Math.max(0, top - viewport * arriveLine)));
    depart = tops.map((_, i) => {
      const nextTop = tops[i + 1];
      if (nextTop === undefined) return Number.POSITIVE_INFINITY;
      // Never depart before arriving, and never so late the move has no room.
      return Math.min(Math.max(arrive[i], nextTop - viewport), arrive[i + 1] - viewport * 0.25);
    });
  };

  const read = () => mapScroll(window.scrollY, arrive, depart);

  measure();
  return { read, measure, count: sections.length };
}

/** Pure mapping from a scroll offset to a fractional section index. */
export function mapScroll(y: number, arrive: readonly number[], depart: readonly number[]): number {
  if (arrive.length === 0) return 0;
  for (let i = arrive.length - 1; i >= 0; i -= 1) {
    if (y < arrive[i]) continue;
    if (i === arrive.length - 1) return i;
    const leave = Math.max(arrive[i], depart[i]);
    if (y <= leave) return i;
    const span = arrive[i + 1] - leave;
    return i + (span <= 0 ? 1 : clamp01((y - leave) / span));
  }
  return 0;
}

export type Pose = {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
  /** Canvas opacity for this section, so copy always wins over the render. */
  readonly stage: number;
};

type Tracks = {
  px: Keyframe<number>[]; py: Keyframe<number>[]; pz: Keyframe<number>[];
  tx: Keyframe<number>[]; ty: Keyframe<number>[]; tz: Keyframe<number>[];
  fov: Keyframe<number>[]; stage: Keyframe<number>[];
};

/** Build per-channel tracks from one pose per section. */
export function poseTracks(poses: readonly Pose[]): Tracks {
  const tracks: Tracks = { px: [], py: [], pz: [], tx: [], ty: [], tz: [], fov: [], stage: [] };
  poses.forEach((pose, at) => {
    tracks.px.push({ at, value: pose.position[0] });
    tracks.py.push({ at, value: pose.position[1] });
    tracks.pz.push({ at, value: pose.position[2] });
    tracks.tx.push({ at, value: pose.target[0] });
    tracks.ty.push({ at, value: pose.target[1] });
    tracks.tz.push({ at, value: pose.target[2] });
    tracks.fov.push({ at, value: pose.fov });
    tracks.stage.push({ at, value: pose.stage });
  });
  return tracks;
}

export function samplePose(tracks: Tracks, t: number): Pose {
  return {
    position: [sampleTrack(tracks.px, t), sampleTrack(tracks.py, t), sampleTrack(tracks.pz, t)],
    target: [sampleTrack(tracks.tx, t), sampleTrack(tracks.ty, t), sampleTrack(tracks.tz, t)],
    fov: sampleTrack(tracks.fov, t),
    stage: sampleTrack(tracks.stage, t),
  };
}

/** Sample a single scalar keyed by section index. */
export function sampleBySection(values: readonly number[], t: number): number {
  return sampleTrack(values.map((value, at) => ({ at, value })), t);
}
