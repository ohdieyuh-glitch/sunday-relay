import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AQUALA_PRESENCE, CAMERA_FOV, CAMERA_POSITION, CAMERA_TARGET, DOG_PRESENCE,
  SCENE_COUNT, clamp01, dogBeatAt, sampleTrack, sampleVec3, sceneAt,
  type ScenePosition,
} from './choreography';
import { DogAnimator } from './three/dog-rig';
import { chooseDpr, chooseTier, createLandingEngine, type LandingEngine } from './three/engine';

/**
 * THE LANDING RUNTIME — scroll, pointer, animation loop and lifecycle.
 *
 * React owns the loop rather than the engine, so an unmount can never leave a
 * `requestAnimationFrame` chain alive. Three things it guarantees:
 *
 *   - THE LOOP STOPS WHEN NOTHING IS WATCHING. A hidden tab or a scrolled-past
 *     canvas cancels the frame request outright; it does not render into the
 *     void at 60fps.
 *   - WEBGL FAILURE IS NOT PAGE FAILURE. If a context cannot be created — an
 *     old device, a blocked GPU, a jsdom test — the hook reports it and the
 *     page renders its full copy and layout with no canvas.
 *   - REDUCED MOTION IS A DIFFERENT CHOREOGRAPHY, NOT A DISABLED ONE. The scene
 *     still renders in 3D and still changes per beat; what it loses is the
 *     continuous traversal between beats.
 */

export type LandingTelemetry = {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly tier: string;
  /** Measured, not assumed. Zero until the first second has elapsed. */
  readonly fps: number;
  readonly webgl: boolean;
  readonly reducedMotion: boolean;
};

const EMPTY_TELEMETRY: LandingTelemetry = {
  width: 0, height: 0, dpr: 1, tier: 'unknown', fps: 0, webgl: false, reducedMotion: false,
};

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

export type LandingRuntime = {
  readonly canvasRef: (node: HTMLCanvasElement | null) => void;
  readonly scrollRef: (node: HTMLDivElement | null) => void;
  readonly position: ScenePosition;
  readonly telemetry: LandingTelemetry;
  /** Screen-space anchors for the floating glass chips, recomputed per frame. */
  readonly anchors: readonly { x: number; y: number; depth: number; visible: boolean }[];
};

/** Where each beat's floating node chips hang in world space. */
const NODE_ANCHORS: readonly (readonly [number, number, number])[] = [
  [-13, 20, -6], [13, 22, -8], [-16, 12, 4], [16, 14, 2], [-9, 26, -12], [10, 27, -10], [0, 8, 10],
];

export function useLandingRuntime(reducedMotion: boolean): LandingRuntime {
  const [position, setPosition] = useState<ScenePosition>(() => sceneAt(0));
  const [telemetry, setTelemetry] = useState<LandingTelemetry>(EMPTY_TELEMETRY);
  const [anchors, setAnchors] = useState<LandingRuntime['anchors']>([]);

  const canvasNode = useRef<HTMLCanvasElement | null>(null);
  const scrollNode = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<LandingEngine | null>(null);
  const animator = useMemo(() => new DogAnimator(), []);
  const state = useRef({
    progress: 0, smoothProgress: 0, flow: 0, pointer: null as { x: number; y: number } | null,
    elapsed: 0, lastTime: 0, visible: true, frames: 0, fpsWindow: 0,
  });

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasNode.current = node;
  }, []);
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollNode.current = node;
  }, []);

  useEffect(() => {
    const canvas = canvasNode.current;
    if (!canvas || typeof window === 'undefined') return undefined;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const nav = window.navigator as Navigator & { deviceMemory?: number };
    const tier = chooseTier(width, nav.deviceMemory, nav.hardwareConcurrency);
    const dpr = chooseDpr(window.devicePixelRatio || 1, tier);

    let engine: LandingEngine | null = null;
    try {
      engine = createLandingEngine(canvas, tier, dpr);
      engine.resize(width, height);
    } catch {
      // No WebGL: report it and let the page render as copy. Rethrowing here
      // would blank the entire landing on a device that could still read it.
      setTelemetry({ ...EMPTY_TELEMETRY, width, height, dpr, tier, webgl: false, reducedMotion });
      return undefined;
    }
    engineRef.current = engine;
    setTelemetry({ width, height, dpr, tier, fps: 0, webgl: true, reducedMotion });

    let frame = 0;
    const onResize = () => {
      engine?.resize(window.innerWidth, window.innerHeight);
      setTelemetry((t) => ({ ...t, width: window.innerWidth, height: window.innerHeight }));
    };
    const onPointer = (event: PointerEvent) => {
      state.current.pointer = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: (event.clientY / window.innerHeight) * 2 - 1,
      };
    };
    const onPointerLeave = () => {
      state.current.pointer = null;
    };
    const onVisibility = () => {
      state.current.visible = !document.hidden;
      if (state.current.visible && frame === 0) {
        state.current.lastTime = 0;
        frame = window.requestAnimationFrame(tick);
      }
    };

    function readScroll(): number {
      const node = scrollNode.current;
      if (!node) return 0;
      const range = node.scrollHeight - window.innerHeight;
      if (range <= 0) return 0;
      const top = window.scrollY - node.offsetTop;
      return clamp01(top / range);
    }

    function tick(now: number): void {
      const s = state.current;
      if (!s.visible || !engineRef.current) {
        frame = 0;
        return;
      }
      const dt = s.lastTime === 0 ? 1 / 60 : Math.min(0.05, (now - s.lastTime) / 1000);
      s.lastTime = now;
      s.elapsed += dt;

      const raw = readScroll();
      // Scroll inertia. The browser's own scroll is already smoothed on most
      // platforms, but the CAMERA must lag it slightly or every wheel notch
      // reads as a shove. Reduced motion drops the lag and the flow entirely.
      const followSpeed = reducedMotion ? 1 : 1 - Math.exp(-dt * 6.5);
      const previous = s.smoothProgress;
      s.smoothProgress += (raw - s.smoothProgress) * followSpeed;
      s.progress = raw;
      const velocity = Math.abs(s.smoothProgress - previous) / Math.max(dt, 1e-4);
      s.flow = reducedMotion ? 0 : Math.min(1, s.flow * 0.9 + velocity * 0.6);

      const p = reducedMotion ? snapToBeat(raw) : s.smoothProgress;
      const scenePosition = sceneAt(p);
      const beat = dogBeatAt(scenePosition);
      const pose = animator.update(reducedMotion ? Math.min(dt, 1 / 30) : dt, {
        state: beat.state,
        x: beat.x,
        z: beat.z,
        yaw: beat.yaw,
        look: beat.tracksPointer ? s.pointer : null,
      });

      engineRef.current.render({
        cameraPosition: sampleVec3(CAMERA_POSITION, p),
        cameraTarget: sampleVec3(CAMERA_TARGET, p),
        fov: sampleTrack(CAMERA_FOV, p),
        dogPose: pose,
        dogPresence: sampleTrack(DOG_PRESENCE, p),
        aqualaPresence: sampleTrack(AQUALA_PRESENCE, p),
        flow: s.flow,
        pointer: reducedMotion ? null : s.pointer,
        elapsed: s.elapsed,
      });

      setPosition((prev) =>
        prev.index === scenePosition.index && Math.abs(prev.local - scenePosition.local) < 0.004
          ? prev
          : scenePosition,
      );
      setAnchors(NODE_ANCHORS.map((a) => engineRef.current!.project(a)));

      // Measured FPS, published once a second. This is the honest number the
      // telemetry strip shows; nothing here estimates or rounds up.
      s.frames += 1;
      s.fpsWindow += dt;
      if (s.fpsWindow >= 1) {
        const fps = Math.round(s.frames / s.fpsWindow);
        setTelemetry((t) => (t.fps === fps ? t : { ...t, fps }));
        s.frames = 0;
        s.fpsWindow = 0;
      }
      frame = window.requestAnimationFrame(tick);
    }

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    frame = window.requestAnimationFrame(tick);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [animator, reducedMotion]);

  return { canvasRef, scrollRef, position, telemetry, anchors };
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
