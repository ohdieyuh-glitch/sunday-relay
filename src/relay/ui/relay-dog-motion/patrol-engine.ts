/**
 * SUNDAY RELAY — MILESTONE 4.5
 * Idle patrol engine (PURE, deterministic, no clock, no browser).
 *
 * All the movement maths lives here as a plain step function so the walk can
 * be tested exactly — position, turning, pausing, and clamping — without a
 * real animation frame or a real timer. The React controller only feeds it
 * elapsed milliseconds.
 *
 * Patrol is visual behavior with no product meaning: it is never persisted,
 * never mission state, and never a trace event.
 */

export type PatrolPhase = 'walking' | 'paused';
export type PatrolDirection = 'left' | 'right';

export interface PatrolState {
  /** Horizontal offset in px from the left edge of the travel track. */
  x: number;
  direction: PatrolDirection;
  phase: PatrolPhase;
  /** Time spent in the current phase, in ms. */
  phaseElapsedMs: number;
}

export interface PatrolBounds {
  minX: number;
  maxX: number;
}

export interface PatrolConfig {
  /** A calm, friendly pace — never fast or frantic. */
  speedPxPerSec: number;
  /** How long the dog walks before taking a natural pause. */
  walkMs: number;
  /** How long a pause lasts before the walk resumes. */
  pauseMs: number;
  /**
   * Largest step the engine will honour in one call. A backgrounded tab
   * delivers one huge delta when it wakes; capping it makes the dog resume
   * calmly instead of flying across the track.
   */
  maxStepMs: number;
}

export const DEFAULT_PATROL_CONFIG: PatrolConfig = {
  speedPxPerSec: 26,
  walkMs: 4200,
  pauseMs: 1400,
  maxStepMs: 250,
};

/** The dog needs at least this much slack beyond its own width to patrol. */
export const MIN_PATROL_TRACK_PX = 24;

export function createPatrolState(x = 0, direction: PatrolDirection = 'right'): PatrolState {
  return { x, direction, phase: 'walking', phaseElapsedMs: 0 };
}

/**
 * Usable travel for a dog of `dogWidth` inside `containerWidth`. Returns null
 * when the container cannot fit the dog plus a meaningful walk — the caller
 * then anchors the dog and disables patrol instead of overflowing.
 */
export function measurePatrolBounds(
  containerWidth: number,
  dogWidth: number,
): PatrolBounds | null {
  const travel = containerWidth - dogWidth;
  if (!Number.isFinite(travel) || travel < MIN_PATROL_TRACK_PX) return null;
  return { minX: 0, maxX: travel };
}

export function clampToBounds(x: number, bounds: PatrolBounds): number {
  if (x < bounds.minX) return bounds.minX;
  if (x > bounds.maxX) return bounds.maxX;
  return x;
}

/**
 * Advances the patrol by `deltaMs`. Turning happens AT a boundary — the dog
 * walks up to the edge, reverses, and continues with the remaining distance,
 * so it never teleports and never leaves the track.
 *
 * The input state is never mutated.
 */
export function stepPatrol(
  state: PatrolState,
  bounds: PatrolBounds,
  deltaMs: number,
  config: PatrolConfig = DEFAULT_PATROL_CONFIG,
): PatrolState {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return { ...state, x: clampToBounds(state.x, bounds) };
  }

  // Guard against a huge delta (a backgrounded tab) becoming a teleport.
  const delta = Math.min(deltaMs, config.maxStepMs);
  const phaseElapsed = state.phaseElapsedMs + delta;

  if (state.phase === 'paused') {
    if (phaseElapsed < config.pauseMs) {
      return { ...state, x: clampToBounds(state.x, bounds), phaseElapsedMs: phaseElapsed };
    }
    // The pause ended; start walking with whatever time is left over.
    return stepPatrol(
      { ...state, phase: 'walking', phaseElapsedMs: 0 },
      bounds,
      phaseElapsed - config.pauseMs,
      config,
    );
  }

  if (phaseElapsed >= config.walkMs) {
    // Walk out the remainder of this leg, then pause in place.
    const walkedRemainder = config.walkMs - state.phaseElapsedMs;
    const moved = travel(state, bounds, walkedRemainder, config);
    return { ...moved, phase: 'paused', phaseElapsedMs: phaseElapsed - config.walkMs };
  }

  return { ...travel(state, bounds, delta, config), phaseElapsedMs: phaseElapsed };
}

/** Moves the dog, reversing at each boundary until the distance is spent. */
function travel(
  state: PatrolState,
  bounds: PatrolBounds,
  ms: number,
  config: PatrolConfig,
): PatrolState {
  const track = bounds.maxX - bounds.minX;
  let remaining = (Math.max(ms, 0) / 1000) * config.speedPxPerSec;
  let x = clampToBounds(state.x, bounds);
  let direction = state.direction;

  // A zero-width track has nowhere to walk; hold position.
  if (track <= 0) return { ...state, x: bounds.minX, direction };

  let guard = 0;
  while (remaining > 0 && guard < 64) {
    guard += 1;
    const toEdge = direction === 'right' ? bounds.maxX - x : x - bounds.minX;
    if (remaining < toEdge) {
      x += direction === 'right' ? remaining : -remaining;
      remaining = 0;
      break;
    }
    // Reach the edge exactly, then turn around.
    x = direction === 'right' ? bounds.maxX : bounds.minX;
    remaining -= toEdge;
    direction = direction === 'right' ? 'left' : 'right';
  }

  return { ...state, x: clampToBounds(x, bounds), direction };
}

/**
 * Re-fits a preserved position into new bounds after a resize. The dog keeps
 * its place rather than snapping to the centre.
 */
export function refitToBounds(state: PatrolState, bounds: PatrolBounds): PatrolState {
  return { ...state, x: clampToBounds(state.x, bounds) };
}
