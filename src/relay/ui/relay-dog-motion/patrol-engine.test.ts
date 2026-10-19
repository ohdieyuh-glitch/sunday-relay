import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PATROL_CONFIG,
  MIN_PATROL_TRACK_PX,
  clampToBounds,
  createPatrolState,
  measurePatrolBounds,
  refitToBounds,
  stepPatrol,
  type PatrolBounds,
  type PatrolConfig,
} from './patrol-engine';

/** A simple, exactly-computable configuration: 100px per second. */
const CONFIG: PatrolConfig = { speedPxPerSec: 100, walkMs: 10_000, pauseMs: 1_000, maxStepMs: 10_000 };
const BOUNDS: PatrolBounds = { minX: 0, maxX: 200 };

describe('bounds measurement', () => {
  it('measures the usable track from container and dog width', () => {
    expect(measurePatrolBounds(400, 120)).toEqual({ minX: 0, maxX: 280 });
  });

  it('refuses a track too narrow to walk', () => {
    expect(measurePatrolBounds(130, 120)).toBeNull();
    expect(measurePatrolBounds(120, 120)).toBeNull();
    expect(measurePatrolBounds(100, 120)).toBeNull();
  });

  it('accepts exactly the minimum track', () => {
    expect(measurePatrolBounds(120 + MIN_PATROL_TRACK_PX, 120)).toEqual({
      minX: 0,
      maxX: MIN_PATROL_TRACK_PX,
    });
  });

  it('ignores non-finite measurements rather than producing NaN bounds', () => {
    expect(measurePatrolBounds(Number.NaN, 120)).toBeNull();
  });

  it('clamps any position into the track', () => {
    expect(clampToBounds(-50, BOUNDS)).toBe(0);
    expect(clampToBounds(500, BOUNDS)).toBe(200);
    expect(clampToBounds(120, BOUNDS)).toBe(120);
  });
});

describe('walking', () => {
  it('moves in the current direction at the configured pace', () => {
    const next = stepPatrol(createPatrolState(0, 'right'), BOUNDS, 1000, CONFIG);
    expect(next.x).toBe(100);
    expect(next.direction).toBe('right');
    expect(next.phase).toBe('walking');
  });

  it('moves left when facing left', () => {
    const next = stepPatrol(createPatrolState(150, 'left'), BOUNDS, 500, CONFIG);
    expect(next.x).toBe(100);
    expect(next.direction).toBe('left');
  });

  it('reverses AT the right boundary and continues with the remainder', () => {
    // 1.5s at 100px/s = 150px from x=100: 100 → 200 (edge) → turn → 150.
    const next = stepPatrol(createPatrolState(100, 'right'), BOUNDS, 1500, CONFIG);
    expect(next.direction).toBe('left');
    expect(next.x).toBe(150);
  });

  it('reverses AT the left boundary and continues with the remainder', () => {
    const next = stepPatrol(createPatrolState(100, 'left'), BOUNDS, 1500, CONFIG);
    expect(next.direction).toBe('right');
    expect(next.x).toBe(50);
  });

  it('never leaves the track, however long the step', () => {
    let state = createPatrolState(0, 'right');
    for (let i = 0; i < 200; i += 1) {
      state = stepPatrol(state, BOUNDS, 137, CONFIG);
      expect(state.x).toBeGreaterThanOrEqual(BOUNDS.minX);
      expect(state.x).toBeLessThanOrEqual(BOUNDS.maxX);
    }
  });

  it('turns rather than teleporting across multiple boundaries', () => {
    // 5s at 100px/s = 500px on a 200px track: right→edge, back, and again.
    const next = stepPatrol(createPatrolState(0, 'right'), BOUNDS, 5000, CONFIG);
    expect(next.x).toBeGreaterThanOrEqual(0);
    expect(next.x).toBeLessThanOrEqual(200);
  });

  it('holds position on a zero-width track', () => {
    const next = stepPatrol(createPatrolState(0, 'right'), { minX: 0, maxX: 0 }, 1000, CONFIG);
    expect(next.x).toBe(0);
  });

  it('a huge delta (backgrounded tab) cannot become a teleport', () => {
    const capped: PatrolConfig = { ...CONFIG, maxStepMs: 250 };
    const next = stepPatrol(createPatrolState(0, 'right'), BOUNDS, 60_000, capped);
    // Capped at 250ms → 25px, not 6000px.
    expect(next.x).toBe(25);
  });

  it('ignores a zero or negative delta but still clamps', () => {
    expect(stepPatrol(createPatrolState(50, 'right'), BOUNDS, 0, CONFIG).x).toBe(50);
    expect(stepPatrol(createPatrolState(500, 'right'), BOUNDS, -10, CONFIG).x).toBe(200);
  });

  it('never mutates the input state', () => {
    const state = createPatrolState(40, 'right');
    const snapshot = JSON.stringify(state);
    stepPatrol(state, BOUNDS, 900, CONFIG);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('natural pauses', () => {
  const PAUSING: PatrolConfig = { speedPxPerSec: 100, walkMs: 1000, pauseMs: 500, maxStepMs: 10_000 };

  it('pauses after the walk leg without losing position', () => {
    const walked = stepPatrol(createPatrolState(0, 'right'), BOUNDS, 1000, PAUSING);
    expect(walked.phase).toBe('paused');
    expect(walked.x).toBe(100);
  });

  it('does not move while paused', () => {
    let state = stepPatrol(createPatrolState(0, 'right'), BOUNDS, 1000, PAUSING);
    const pausedAt = state.x;
    state = stepPatrol(state, BOUNDS, 200, PAUSING);
    expect(state.phase).toBe('paused');
    expect(state.x).toBe(pausedAt);
  });

  it('resumes walking after the pause and keeps going from there', () => {
    let state = stepPatrol(createPatrolState(0, 'right'), BOUNDS, 1000, PAUSING);
    state = stepPatrol(state, BOUNDS, 500, PAUSING); // pause elapses exactly
    expect(state.phase).toBe('walking');
    expect(state.x).toBe(100);
    state = stepPatrol(state, BOUNDS, 100, PAUSING);
    expect(state.x).toBe(110);
  });

  it('the default configuration is calm, not frantic', () => {
    expect(DEFAULT_PATROL_CONFIG.speedPxPerSec).toBeLessThanOrEqual(40);
    expect(DEFAULT_PATROL_CONFIG.pauseMs).toBeGreaterThan(0);
    expect(DEFAULT_PATROL_CONFIG.walkMs).toBeGreaterThan(DEFAULT_PATROL_CONFIG.pauseMs);
    expect(DEFAULT_PATROL_CONFIG.maxStepMs).toBeGreaterThan(0);
  });
});

describe('resize refit', () => {
  it('keeps the preserved position, only clamping it into the new track', () => {
    const state = { ...createPatrolState(180, 'right'), phaseElapsedMs: 900 };
    const refit = refitToBounds(state, { minX: 0, maxX: 100 });
    expect(refit.x).toBe(100);
    expect(refit.direction).toBe('right');
    expect(refit.phaseElapsedMs).toBe(900);
  });

  it('never recentres a dog that still fits', () => {
    const state = createPatrolState(60, 'left');
    expect(refitToBounds(state, { minX: 0, maxX: 200 }).x).toBe(60);
  });
});
