import { describe, expect, it } from 'vitest';
import {
  AQUALA_PRESENCE, CAMERA_FOV, CAMERA_POSITION, CAMERA_TARGET, DOG_BEATS,
  DOG_PRESENCE, LANDING_SCENES, SCENE_COUNT, dogBeatAt, sampleTrack, sceneAt,
  smoothstep, type Keyframe,
} from './choreography';

/**
 * The choreography is the part of this landing most likely to be silently
 * wrong — a camera key one beat out of place is invisible in a diff and
 * obvious on the page. It is pure by design so it can be pinned here without a
 * GPU, which is the only kind of verification the machine this was built on
 * can perform.
 */

describe('scene resolution', () => {
  it('resolves the first and last beats at the extremes of the scroll', () => {
    expect(sceneAt(0).index).toBe(0);
    // The end of the page must land ON the last beat, not one past it. A naive
    // `floor(p * count)` returns `count` at exactly 1 and indexes off the end.
    expect(sceneAt(1).index).toBe(SCENE_COUNT - 1);
    expect(LANDING_SCENES[sceneAt(1).index]).toBeDefined();
  });

  it('clamps out-of-range scroll rather than indexing past the beats', () => {
    expect(sceneAt(-3).index).toBe(0);
    expect(sceneAt(9).index).toBe(SCENE_COUNT - 1);
  });

  it('gives every beat an equal share of the scroll', () => {
    for (let i = 0; i < SCENE_COUNT; i += 1) {
      const middle = (i + 0.5) / SCENE_COUNT;
      expect(sceneAt(middle).index).toBe(i);
      expect(sceneAt(middle).local).toBeCloseTo(0.5, 5);
    }
  });
});

describe('keyframe tracks', () => {
  const track: readonly Keyframe<number>[] = [{ at: 0.2, value: 10 }, { at: 0.8, value: 20 }];

  it('holds instead of extrapolating outside its keys', () => {
    // Extrapolating a camera path past its last key is how a scene ends up
    // behind the floor at the bottom of the page.
    expect(sampleTrack(track, 0)).toBe(10);
    expect(sampleTrack(track, 1)).toBe(20);
    expect(sampleTrack(track, -5)).toBe(10);
    expect(sampleTrack(track, 5)).toBe(20);
  });

  it('eases between keys rather than moving linearly', () => {
    const midpoint = sampleTrack(track, 0.5);
    expect(midpoint).toBeCloseTo(15, 5);
    // A quarter of the way through the span, smoothstep is well below linear.
    const quarter = sampleTrack(track, 0.35);
    expect(quarter).toBeLessThan(12.5);
  });

  it('smoothstep is clamped and symmetric', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 6);
    expect(smoothstep(0.25) + smoothstep(0.75)).toBeCloseTo(1, 6);
  });
});

describe('the camera never loses the subject', () => {
  const samples = Array.from({ length: 101 }, (_, i) => i / 100);

  it('stays above the ground for the whole page', () => {
    for (const p of samples) {
      expect(sampleTrack(CAMERA_POSITION[1], p), `height at ${p}`).toBeGreaterThan(2);
    }
  });

  it('keeps its target within the Dog and mark, never at the floor', () => {
    // The Dog is ~20 units tall. A target at y=0 points the camera at the
    // ground and puts the character above the frame — a failure this product
    // has already shipped once, on a hero camera that rendered only sky.
    for (const p of samples) {
      const y = sampleTrack(CAMERA_TARGET[1], p);
      expect(y, `target height at ${p}`).toBeGreaterThan(8);
      expect(y, `target height at ${p}`).toBeLessThan(24);
    }
  });

  it('never puts the camera inside the subject', () => {
    for (const p of samples) {
      const x = sampleTrack(CAMERA_POSITION[0], p);
      const z = sampleTrack(CAMERA_POSITION[2], p);
      expect(Math.hypot(x, z), `distance at ${p}`).toBeGreaterThan(18);
    }
  });

  it('holds the field of view in a cinematic range', () => {
    for (const p of samples) {
      const fov = sampleTrack(CAMERA_FOV, p);
      expect(fov).toBeGreaterThanOrEqual(28);
      expect(fov).toBeLessThanOrEqual(40);
    }
  });
});

describe('presence tracks', () => {
  it('opens on Aquala and brings the Dog in afterwards', () => {
    expect(sampleTrack(AQUALA_PRESENCE, 0)).toBe(1);
    expect(sampleTrack(DOG_PRESENCE, 0)).toBe(0);
    expect(sampleTrack(DOG_PRESENCE, 0.3)).toBe(1);
  });

  it('never fully extinguishes the Aquala mark — it is the anchor', () => {
    for (let i = 0; i <= 100; i += 1) {
      expect(sampleTrack(AQUALA_PRESENCE, i / 100)).toBeGreaterThan(0.05);
    }
  });
});

describe('the Dog’s beats', () => {
  it('declares one beat per scene', () => {
    expect(DOG_BEATS).toHaveLength(SCENE_COUNT);
  });

  it('walks between marks rather than teleporting', () => {
    // Mid-beat the Dog holds its mark; late in a beat it is already moving to
    // the next one, so motion leads the copy instead of trailing it.
    expect(dogBeatAt({ index: 2, local: 0.3, progress: 0 }).state).toBe(DOG_BEATS[2].state);
    expect(dogBeatAt({ index: 2, local: 0.85, progress: 0 }).state).toBe('WALK');
  });

  it('interpolates position toward the next mark, never past it', () => {
    const late = dogBeatAt({ index: 3, local: 0.9, progress: 0 });
    const from = DOG_BEATS[3];
    const to = DOG_BEATS[4];
    expect(late.x).toBeGreaterThanOrEqual(Math.min(from.x, to.x) - 1e-9);
    expect(late.x).toBeLessThanOrEqual(Math.max(from.x, to.x) + 1e-9);
  });

  it('turns the short way when the next mark faces the other direction', () => {
    // Beat 6 faces PI (away, into Wonderland); beat 7 faces 0 (back at the
    // viewer). Blending the raw values would swing the Dog through a full
    // half-turn the long way round.
    const blended = dogBeatAt({ index: 6, local: 0.83, progress: 0 });
    expect(Math.abs(blended.yaw)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });

  it('holds the last beat at the end of the page', () => {
    const last = dogBeatAt({ index: SCENE_COUNT - 1, local: 1, progress: 1 });
    expect(last.x).toBeCloseTo(DOG_BEATS[SCENE_COUNT - 1].x, 6);
  });
});

describe('product naming is governed', () => {
  const text = LANDING_SCENES.map((s) => `${s.eyebrow} ${s.headline} ${s.body} ${(s.nodes ?? []).join(' ')}`).join(' ');

  it('calls the configuration surface C.A.R.D. and never PSP', () => {
    expect(text).toContain('C.A.R.D.');
    expect(text).not.toMatch(/\bPSP\b/);
  });

  it('does not describe the Compound Agent as a software team', () => {
    // Relay is a runtime, not three chatbots passing messages. The landing is
    // the most likely place for that framing to slip back in.
    expect(text.toLowerCase()).not.toMatch(/software team|team of agents|ai team/);
  });

  it('states the completion principle somewhere on the page', () => {
    expect(text.toLowerCase()).toContain('earned, not claimed');
  });
});
