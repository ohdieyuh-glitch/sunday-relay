/**
 * SUNDAY RELAY — MILESTONE 4.5
 * The ONE authoritative Relay Dog motion controller.
 *
 * Exactly one animation-frame loop exists for the dog, and it lives here. It
 * owns horizontal position, direction, patrol on/off, measured bounds, pause
 * state, loop identity, cleanup, and reduced-motion. There is deliberately no
 * second loop for Demo Simulation, for mobile, or inside any dog component —
 * changing mission state must never spawn a duplicate timer, and a rerender
 * must never restart the walk from the centre.
 *
 * Position lives in a ref for the lifetime of the mounted component only. It
 * is never written to storage, mission state, the Project Brain, the trace
 * ledger, a capsule, or the URL.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_PATROL_CONFIG,
  clampToBounds,
  createPatrolState,
  measurePatrolBounds,
  refitToBounds,
  stepPatrol,
  type PatrolBounds,
  type PatrolConfig,
  type PatrolDirection,
  type PatrolState,
} from './patrol-engine';

export interface RelayDogPatrolOptions {
  /** Whether the current activity permits autonomous walking. */
  patrolEnabled: boolean;
  /** Caller-supplied reduced-motion override (props win over the media query). */
  reducedMotion?: boolean;
  config?: Partial<PatrolConfig>;
}

export interface RelayDogPatrolResult {
  /** Attach to the element that defines the travel track. */
  boundaryRef: (node: HTMLDivElement | null) => void;
  /** Attach to the moving element, so its width is measured. */
  dogRef: (node: HTMLDivElement | null) => void;
  /** Current horizontal offset in px. */
  x: number;
  direction: PatrolDirection;
  /** True only while the dog is actually walking (not paused, not blocked). */
  walking: boolean;
  /** Reduced motion, from props OR the user's system preference. */
  reducedMotion: boolean;
  /** False when the track is too narrow to patrol safely. */
  patrolPossible: boolean;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Guarded read — jsdom and SSR have no matchMedia, and neither has a user. */
function readSystemReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}

export function useRelayDogPatrol(options: RelayDogPatrolOptions): RelayDogPatrolResult {
  const { patrolEnabled, reducedMotion: reducedMotionProp = false } = options;

  const [systemReducedMotion, setSystemReducedMotion] = useState(readSystemReducedMotion);
  const reducedMotion = reducedMotionProp || systemReducedMotion;

  /* Position survives every state change and rerender for the component's
     lifetime — returning to idle resumes exactly where the dog stopped. */
  const patrolRef = useRef<PatrolState>(createPatrolState());
  const boundsRef = useRef<PatrolBounds | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dogElementRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  /* A frame can already be in flight when patrol stops; cancelling cannot
     un-dispatch it, so the tick checks this before moving anything. */
  const activeRef = useRef(false);

  const configRef = useRef<Partial<PatrolConfig> | undefined>(options.config);
  configRef.current = options.config;

  const [view, setView] = useState<{ x: number; direction: PatrolDirection; walking: boolean }>({
    x: 0,
    direction: 'right',
    walking: false,
  });
  const [patrolPossible, setPatrolPossible] = useState(false);

  /* ------------------------------------------------- reduced-motion watch */
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let query: MediaQueryList;
    try {
      query = window.matchMedia(REDUCED_MOTION_QUERY);
    } catch {
      return;
    }
    const onChange = (event: MediaQueryListEvent) => setSystemReducedMotion(event.matches);
    // Older Safari exposes only the deprecated listener API.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    if (typeof query.addListener === 'function') {
      query.addListener(onChange);
      return () => query.removeListener(onChange);
    }
    return undefined;
  }, []);

  /* ------------------------------------------------------- measurement */
  const measure = useCallback(() => {
    const container = containerRef.current;
    const dog = dogElementRef.current;
    if (!container || !dog) return;

    const containerWidth = container.clientWidth;
    const dogWidth = dog.offsetWidth;
    const bounds = measurePatrolBounds(containerWidth, dogWidth);
    boundsRef.current = bounds;

    if (!bounds) {
      // Too narrow to walk: anchor at the left edge and stay inside.
      patrolRef.current = { ...patrolRef.current, x: 0 };
      if (mountedRef.current) {
        setPatrolPossible(false);
        setView((prev) => (prev.x === 0 && !prev.walking ? prev : { ...prev, x: 0, walking: false }));
      }
      return;
    }

    // A resize re-fits the preserved position; it never recentres the dog.
    patrolRef.current = refitToBounds(patrolRef.current, bounds);
    if (mountedRef.current) {
      setPatrolPossible(true);
      const next = patrolRef.current;
      setView((prev) =>
        prev.x === next.x && prev.direction === next.direction
          ? prev
          : { ...prev, x: next.x, direction: next.direction },
      );
    }
  }, []);

  const boundaryRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      measure();
    },
    [measure],
  );

  const dogRef = useCallback(
    (node: HTMLDivElement | null) => {
      dogElementRef.current = node;
      measure();
    },
    [measure],
  );

  /* --------------------------------------------------- resize handling */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    measure();

    const container = containerRef.current;
    if (typeof ResizeObserver === 'function' && container) {
      const observer = new ResizeObserver(() => measure());
      observer.observe(container);
      return () => observer.disconnect();
    }
    // Fallback for environments without ResizeObserver — no dependency added.
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  /* --------------------------------------------------- the single loop */
  /* No frames are scheduled unless the dog could actually walk: patrol must
     be permitted, motion must not be reduced, AND the measured track must be
     wide enough. A container with no usable width (or no layout at all) burns
     no animation frames. */
  const active = patrolEnabled && !reducedMotion && patrolPossible;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      // Stop immediately, preserving position — no drift, no reset.
      if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      lastTimeRef.current = null;
      setView((prev) => (prev.walking ? { ...prev, walking: false } : prev));
      return;
    }
    if (typeof requestAnimationFrame !== 'function') return;

    const tick = (time: number) => {
      if (!mountedRef.current || !activeRef.current) return;
      const last = lastTimeRef.current;
      lastTimeRef.current = time;

      const bounds = boundsRef.current;
      if (bounds && last !== null) {
        const config = { ...configRef.current } as Partial<PatrolConfig>;
        const next = stepPatrol(
          patrolRef.current,
          bounds,
          time - last,
          { ...DEFAULT_PATROL_CONFIG, ...config },
        );
        patrolRef.current = next;
        setView((prev) =>
          prev.x === next.x && prev.direction === next.direction && prev.walking === (next.phase === 'walking')
            ? prev
            : { x: next.x, direction: next.direction, walking: next.phase === 'walking' },
        );
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      activeRef.current = false;
      if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      lastTimeRef.current = null;
    };
  }, [active]);

  const bounds = boundsRef.current;
  return {
    boundaryRef,
    dogRef,
    x: bounds ? clampToBounds(view.x, bounds) : 0,
    direction: view.direction,
    walking: active && patrolPossible && view.walking,
    reducedMotion,
    patrolPossible,
  };
}
