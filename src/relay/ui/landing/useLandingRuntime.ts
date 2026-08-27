import { useEffect, useState } from 'react';
import { SCENE_COUNT, clamp01 } from './choreography';

/**
 * Shared landing helpers.
 *
 * THIS FILE USED TO OWN A RENDERER. It created its own WebGL context, its own
 * canvas and its own frame loop for the landing, while the Relay experience did
 * the same for itself — two scenes, two Dogs, swapped by the router. That is
 * what made entering Relay a page navigation, and it is now replaced by the one
 * persistent scene in `relay-world/useRelayWorld.ts`.
 *
 * The engine code is deleted rather than left behind: a second, unreferenced
 * Dog implementation is exactly the thing that drifts out of sync with the
 * canonical one and gets revived by accident later.
 */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Reduced motion still visits every beat — it just stops BETWEEN them. Snapping
 * to the nearest beat centre keeps each composition intact and removes only the
 * continuous traversal, which is the part that causes discomfort.
 */
export function snapToBeat(progress: number): number {
  const scaled = clamp01(progress) * SCENE_COUNT;
  const index = Math.min(SCENE_COUNT - 1, Math.floor(scaled));
  return (index + 0.5) / SCENE_COUNT;
}
