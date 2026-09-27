import { describe, expect, it } from 'vitest';
import {
  CREATE_AGENT_POSE, HANDOVER, REDUCED_TRANSITION_SECONDS, TRANSITION_SECONDS,
  lerpPose, nextStage, portalPose, relayStageFromHash, transitionDuration, transitionFrame,
  type CameraPose,
} from './world-stage';
import type { Vec3 } from '../landing/choreography';

const ORIGIN: Vec3 = [0, 16, 0];
const FROM: CameraPose = { position: [0, 20, 62], target: [2, 17, 0], fov: 36 };
const sample = (p: number, reduced = false) => transitionFrame(p, FROM, ORIGIN, reduced);

/**
 * The passage from Aquala into Relay. It is pure, so the whole choreography can
 * be checked here — which matters, because the thing it must not be is a wait
 * followed by a route change, and that failure looks identical in a screenshot.
 */

/**
 * THE ADDRESS BAR IS A SOURCE OF TRUTH, and for a while only one of two code
 * paths agreed. The preview router read the hash; the live beta gate read the
 * persisted C.A.R.D. instead, so on the live deployment the public URL stopped
 * answering with the public landing the moment a visitor had built anything.
 * One function now answers for both.
 */
describe('which stage a URL asks for', () => {
  it('sends `#/relay` to Relay and everything else to the landing', () => {
    expect(relayStageFromHash('#/relay')).toBe('relay');
    expect(relayStageFromHash('')).toBe('aquala');
    expect(relayStageFromHash('#')).toBe('aquala');
    expect(relayStageFromHash('#/')).toBe('aquala');
  });

  it('keeps the deeper in-product routes inside Relay', () => {
    expect(relayStageFromHash('#/relay/console')).toBe('relay');
    expect(relayStageFromHash('#/relay/project/rly-001')).toBe('relay');
  });

  it('reads a sign-in return as the landing, not as a route', () => {
    // The bridge sends the browser back with a one-time claim in the fragment.
    // It is not an address inside the product, and answering it with Relay would
    // put a half-finished sign-in on top of the Compound Agent screen.
    expect(relayStageFromHash('#relay_claim=abc123')).toBe('aquala');
  });

  it('never answers with `transition`', () => {
    // A stage a journey passes THROUGH is not a place anyone can be sent to: a
    // deep link into it would strand the camera between two stages with no
    // passage running to finish it.
    for (const hash of ['#/transition', '#/relay', '', '#/anything']) {
      expect(relayStageFromHash(hash)).not.toBe('transition');
    }
  });
});

describe('the stage machine', () => {
  it('runs aquala → transition → relay, one way only', () => {
    expect(nextStage('aquala', 'commit')).toBe('transition');
    expect(nextStage('transition', 'arrive')).toBe('relay');
  });

  it('cannot be restarted by a second commit mid-flight', () => {
    // A second click while the camera is moving must not rewind the passage.
    expect(nextStage('transition', 'commit')).toBe('transition');
    expect(nextStage('relay', 'commit')).toBe('relay');
  });

  it('never returns to Aquala once inside Relay', () => {
    expect(nextStage('relay', 'arrive')).toBe('relay');
  });
});

describe('the camera actually travels', () => {
  it('departs from the live Aquala pose, not a canonical one', () => {
    // Snapping to a fixed start is a cut. The move begins exactly where the
    // user's camera already was.
    const start = sample(0).camera;
    expect(start.position[2]).toBeCloseTo(FROM.position[2], 3);
    expect(start.fov).toBeCloseTo(FROM.fov, 3);
  });

  it('arrives exactly on the Create Compound Agent pose', () => {
    const end = sample(1).camera;
    expect(end.position).toEqual(CREATE_AGENT_POSE.position);
    expect(end.target).toEqual(CREATE_AGENT_POSE.target);
    expect(end.fov).toBeCloseTo(CREATE_AGENT_POSE.fov, 5);
  });

  it('passes through the portal — closest approach is at the mark, not the ends', () => {
    const distance = (p: number) => {
      const c = sample(p).camera;
      return Math.hypot(c.position[0] - ORIGIN[0], c.position[1] - ORIGIN[1], c.position[2] - ORIGIN[2]);
    };
    const atPortal = distance(HANDOVER);
    expect(atPortal).toBeLessThan(distance(0) * 0.25);
    expect(atPortal).toBeLessThan(distance(1) * 0.25);
  });

  it('opens the field of view into the portal so the ring leaves the frame', () => {
    // A narrowing lens would make the mark shrink away — the opposite of
    // travelling through it.
    expect(sample(HANDOVER).camera.fov).toBeGreaterThan(FROM.fov + 15);
    expect(portalPose(ORIGIN).position[1]).toBeCloseTo(ORIGIN[1], 6);
  });

  it('moves continuously — no teleport between frames', () => {
    let previous = sample(0).camera.position;
    for (let i = 1; i <= 120; i += 1) {
      const next = sample(i / 120).camera.position;
      const jump = Math.hypot(next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]);
      expect(jump, `frame ${i} jumped ${jump.toFixed(2)} units`).toBeLessThan(4);
      previous = next;
    }
  });
});

describe('the light', () => {
  it('peaks at the pass-through and is gone at both ends', () => {
    expect(sample(0).veil).toBeCloseTo(0, 2);
    expect(sample(1).veil).toBeCloseTo(0, 2);
    expect(sample(HANDOVER).veil).toBeGreaterThan(0.6);
  });

  it('never goes fully opaque', () => {
    // A hard flash is how a cut is concealed. There is no cut to conceal, so
    // the scene stays visible through the light for the whole passage.
    for (let i = 0; i <= 100; i += 1) {
      expect(sample(i / 100).veil).toBeLessThan(0.9);
      expect(sample(i / 100, true).veil).toBeLessThan(0.9);
    }
  });

  it('keeps the Aquala mark present the whole way, and beyond', () => {
    // It swells on approach and settles behind the user — it is still the
    // anchor of the product once inside Relay.
    expect(sample(0).aqualaPresence).toBeCloseTo(1, 3);
    expect(sample(HANDOVER).aqualaScale).toBeGreaterThan(1.2);
    expect(sample(1).aqualaPresence).toBeGreaterThan(0.1);
  });
});

describe('the chrome hands over', () => {
  it('fades Aquala out before Relay fades in, with no moment of neither', () => {
    const anyVisible = (p: number) => {
      const f = sample(p);
      return f.aqualaChrome > 0.02 || f.relayChrome > 0.02 || f.veil > 0.2;
    };
    for (let i = 0; i <= 100; i += 1) {
      expect(anyVisible(i / 100), `nothing on screen at ${i / 100}`).toBe(true);
    }
  });

  it('ends with Relay chrome fully resolved and Aquala gone', () => {
    expect(sample(1).relayChrome).toBeCloseTo(1, 2);
    expect(sample(1).aqualaChrome).toBeCloseTo(0, 2);
  });
});

describe('reduced motion', () => {
  it('is a different choreography, not a disabled one', () => {
    // The event survives: the light still carries the user across and Relay
    // still resolves. Only the flight is removed.
    expect(sample(HANDOVER, true).veil).toBeGreaterThan(0.5);
    expect(sample(1, true).relayChrome).toBeCloseTo(1, 2);
    expect(sample(1, true).camera.position).toEqual(CREATE_AGENT_POSE.position);
  });

  it('performs no camera traversal', () => {
    const before = sample(HANDOVER - 0.01, true).camera.position;
    expect(before).toEqual(FROM.position);
  });

  it('is much shorter', () => {
    expect(transitionDuration(true)).toBe(REDUCED_TRANSITION_SECONDS);
    expect(transitionDuration(false)).toBe(TRANSITION_SECONDS);
    expect(REDUCED_TRANSITION_SECONDS).toBeLessThan(TRANSITION_SECONDS / 3);
  });
});

describe('pose interpolation', () => {
  it('eases rather than moving linearly', () => {
    const a: CameraPose = { position: [0, 0, 0], target: [0, 0, 0], fov: 10 };
    const b: CameraPose = { position: [10, 0, 0], target: [0, 0, 0], fov: 20 };
    expect(lerpPose(a, b, 0.5).position[0]).toBeCloseTo(5, 5);
    expect(lerpPose(a, b, 0.2).position[0]).toBeLessThan(2);
    expect(lerpPose(a, b, 0).fov).toBe(10);
    expect(lerpPose(a, b, 1).fov).toBe(20);
  });
});
