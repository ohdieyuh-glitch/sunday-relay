/**
 * THE FRAME LOOP — the only place either site calls requestAnimationFrame.
 *
 * Three rules, each paid for somewhere before:
 *   - a hidden tab renders nothing and resumes without a giant dt;
 *   - reduced motion renders ON DEMAND (scroll, resize, pointer) instead of
 *     continuously — the composition is the same, only autonomous motion stops;
 *   - FPS is MEASURED over a rolling second and reported only once measured.
 */

export type FrameLoop = {
  start(): void;
  /** Request one frame. In continuous mode this is a no-op. */
  invalidate(): void;
  /** Measured frames per second, or 0 before the first full second. */
  readonly fps: number;
  dispose(): void;
};

export function createFrameLoop(
  frame: (dt: number, elapsed: number) => void,
  continuous: boolean,
): FrameLoop {
  let handle = 0;
  let last = 0;
  let elapsed = 0;
  let running = false;
  let fps = 0;
  let windowStart = 0;
  let windowFrames = 0;

  const tick = (now: number) => {
    handle = 0;
    // Capped at a quarter second, not at one frame: a slow device must still
    // converge in real time. Consumers that need a per-frame ceiling (the Dog
    // rig clamps to 50ms itself) apply their own.
    const dt = last === 0 ? 1 / 60 : Math.min(0.25, (now - last) / 1000);
    last = now;
    elapsed += dt;

    windowFrames += 1;
    if (windowStart === 0) windowStart = now;
    if (now - windowStart >= 1000) {
      fps = Math.round((windowFrames * 1000) / (now - windowStart));
      windowStart = now;
      windowFrames = 0;
    }

    frame(dt, elapsed);
    if (running && continuous && !document.hidden) handle = requestAnimationFrame(tick);
  };

  const schedule = () => {
    if (handle === 0 && !document.hidden) handle = requestAnimationFrame(tick);
  };

  const onVisibility = () => {
    if (document.hidden) {
      if (handle !== 0) cancelAnimationFrame(handle);
      handle = 0;
    } else if (running) {
      // Restart the clock: a tab restored after a minute must not deliver
      // a minute of dt in one frame.
      last = 0;
      windowStart = 0;
      windowFrames = 0;
      schedule();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    start() {
      running = true;
      schedule();
    },
    invalidate() {
      if (!continuous) {
        last = 0;
        schedule();
      }
    },
    get fps() {
      return fps;
    },
    dispose() {
      running = false;
      if (handle !== 0) cancelAnimationFrame(handle);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
