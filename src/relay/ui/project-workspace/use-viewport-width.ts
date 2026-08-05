import { useSyncExternalStore } from 'react';

/**
 * THE HOST'S MEASUREMENT, not the stage's.
 *
 * `layoutStage` deliberately refuses to measure anything — it is given a width
 * and returns a shape, which is what makes a stage with a Leopard, three cubs
 * and a vehicle testable without rendering one. Something still has to do the
 * measuring, and that job belongs here, to the surface that owns the page.
 *
 * Without this the workspace passed a hardcoded desktop width, so the projection
 * knew perfectly well that a narrow viewport should get a taller stage and the
 * website never told it a narrow viewport existed.
 *
 * Returns `fallback` when there is no window (server rendering, jsdom without a
 * layout, a non-browser host) — an unmeasured viewport is reported as the
 * default rather than as zero, because 0 is a real width that means "narrow"
 * and "we did not look" is not that.
 */
export function useViewportWidth(fallback: number): number {
  return useSyncExternalStore(
    subscribe,
    () => (typeof window === 'undefined' ? fallback : window.innerWidth),
    () => fallback,
  );
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}
