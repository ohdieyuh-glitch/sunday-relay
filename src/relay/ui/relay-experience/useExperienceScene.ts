import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DogAnimator, type DogState } from '../landing/three/dog-rig';
import { chooseDpr, chooseTier, createLandingEngine, type LandingEngine } from '../landing/three/engine';
import type { Vec3 } from '../landing/choreography';
import type { OnboardingStepId } from './onboarding';

/**
 * THE PERSISTENT RELAY SCENE.
 *
 * ONE WebGL context, created once when the experience mounts and kept alive for
 * the whole of Compound Agent creation. Steps change what is drawn AROUND the
 * Dog — they never tear the scene down. That is the founder's requirement
 * stated mechanically: "Do not destroy/recreate the Dog every time a
 * configuration step changes."
 *
 * It also means the Dog cannot flicker between steps, the GPU never re-uploads
 * its geometry, and a step change costs a camera spring rather than a context
 * loss. React state drives the intent; the engine just draws.
 */

/**
 * The Dog stands RIGHT OF CENTRE. The configuration rail is anchored left, so a
 * Dog on the centre line stands behind the controls.
 */
const DOG_ANCHOR = { x: 3.5, z: 1 };

/** Where the system nodes hang around the Dog, in world units. */
export const SYSTEM_ANCHORS: Readonly<Record<string, Vec3>> = Object.freeze({
  architect: [-13, 24, -4],
  coding: [19, 24, -4],
  reviewer: [3, 29, -14],
  brain: [3, 2.5, -13],
  card: [17, 8, 8],
});

/**
 * The Dog's behaviour per step. Deliberately small: it looks, turns and reacts.
 * There is no locomotion in the creation flow at all — the user is standing in
 * front of their agent, not following it around.
 */
const STEP_INTENT: Readonly<Record<OnboardingStepId, { state: DogState; yaw: number }>> = Object.freeze({
  name: { state: 'LOOK', yaw: 0 },
  architect: { state: 'TURN', yaw: 0.34 },
  coding: { state: 'TURN', yaw: -0.34 },
  reviewer: { state: 'TURN', yaw: 0.12 },
  card: { state: 'LOOK', yaw: -0.16 },
  settings: { state: 'LOOK', yaw: 0.1 },
  review: { state: 'IDLE', yaw: 0 },
  activate: { state: 'IDLE', yaw: 0 },
});

/**
 * Subtle camera variation per step. The Dog's scale never changes materially,
 * and every mark keeps the WHOLE character in frame.
 *
 * The Dog is ~21 units tall. At a 32° vertical field of view, a distance under
 * about 46 units crops its feet — the first pass sat at 41–46 and cut them off
 * at every step. These marks sit at 54–60, which frames it at roughly two
 * thirds of the viewport height: hero scale, with headroom.
 */
const STEP_CAMERA: Readonly<Record<OnboardingStepId, { pos: Vec3; target: Vec3; fov: number }>> = Object.freeze({
  name: { pos: [-2, 12, 56], target: [3, 10.5, 0], fov: 31 },
  architect: { pos: [-7, 13, 57], target: [2, 11, 0], fov: 32 },
  coding: { pos: [5, 13, 57], target: [4, 11, 0], fov: 32 },
  reviewer: { pos: [-3, 15, 58], target: [3, 11.5, -2], fov: 32 },
  card: { pos: [4, 12, 55], target: [3, 10.5, 0], fov: 31 },
  settings: { pos: [-4, 12, 55], target: [3, 10.5, 0], fov: 31 },
  review: { pos: [0, 13, 60], target: [3, 11, 0], fov: 30 },
  activate: { pos: [0, 12, 54], target: [3, 10.5, 0], fov: 30 },
});

export type ExperienceTelemetry = {
  readonly webgl: boolean;
  readonly tier: string;
  readonly fps: number;
};

export type ExperienceScene = {
  readonly canvasRef: (node: HTMLCanvasElement | null) => void;
  readonly telemetry: ExperienceTelemetry;
  readonly anchors: Readonly<Record<string, { x: number; y: number; visible: boolean }>>;
  /** Fire a one-shot REACT — used on activation and on each slot selection. */
  readonly pulse: () => void;
};

export function useExperienceScene(
  step: OnboardingStepId,
  activated: boolean,
  reducedMotion: boolean,
): ExperienceScene {
  const [telemetry, setTelemetry] = useState<ExperienceTelemetry>({ webgl: false, tier: 'unknown', fps: 0 });
  const [anchors, setAnchors] = useState<ExperienceScene['anchors']>({});
  const canvasNode = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<LandingEngine | null>(null);
  const animator = useMemo(() => new DogAnimator(), []);
  const live = useRef({ step, activated, pointer: null as { x: number; y: number } | null, react: 0 });
  live.current.step = step;
  live.current.activated = activated;

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasNode.current = node;
  }, []);

  const pulse = useCallback(() => {
    live.current.react = 1;
  }, []);

  useEffect(() => {
    const canvas = canvasNode.current;
    if (!canvas || typeof window === 'undefined') return undefined;
    const nav = window.navigator as Navigator & { deviceMemory?: number };
    const tier = chooseTier(window.innerWidth, nav.deviceMemory, nav.hardwareConcurrency);
    const dpr = chooseDpr(window.devicePixelRatio || 1, tier);

    let engine: LandingEngine;
    try {
      engine = createLandingEngine(canvas, tier, dpr);
      engine.resize(window.innerWidth, window.innerHeight);
    } catch {
      setTelemetry({ webgl: false, tier, fps: 0 });
      return undefined;
    }
    engineRef.current = engine;
    setTelemetry({ webgl: true, tier, fps: 0 });

    let frame = 0;
    let last = 0;
    let elapsed = 0;
    let frames = 0;
    let window_ = 0;
    const cam = { pos: [...STEP_CAMERA[step].pos] as number[], target: [...STEP_CAMERA[step].target] as number[], fov: STEP_CAMERA[step].fov };

    const onResize = () => engineRef.current?.resize(window.innerWidth, window.innerHeight);
    const onPointer = (e: PointerEvent) => {
      live.current.pointer = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: (e.clientY / window.innerHeight) * 2 - 1,
      };
    };

    const tick = (now: number) => {
      if (!engineRef.current || document.hidden) { frame = 0; return; }
      const dt = last === 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;

      const want = STEP_CAMERA[live.current.step];
      // Springless critical damping via an exponential follow — the camera
      // eases to each step's mark rather than cutting, which is what makes the
      // step change read as one continuous room.
      const f = reducedMotion ? 1 : 1 - Math.exp(-dt * 3.2);
      for (let i = 0; i < 3; i += 1) {
        cam.pos[i] += (want.pos[i] - cam.pos[i]) * f;
        cam.target[i] += (want.target[i] - cam.target[i]) * f;
      }
      cam.fov += (want.fov - cam.fov) * f;

      const intent = STEP_INTENT[live.current.step];
      let state: DogState = intent.state;
      if (live.current.react > 0) {
        state = 'REACT';
        live.current.react = Math.max(0, live.current.react - dt * 2.2);
      }
      const pose = animator.update(dt, {
        state,
        x: DOG_ANCHOR.x,
        z: DOG_ANCHOR.z,
        yaw: intent.yaw,
        look: reducedMotion ? null : live.current.pointer,
      });

      engineRef.current.render({
        cameraPosition: cam.pos as unknown as Vec3,
        cameraTarget: cam.target as unknown as Vec3,
        fov: cam.fov,
        dogPose: pose,
        // THE DOG IS ALWAYS FULLY PRESENT HERE. There is no step, no state and
        // no failure mode in this flow that reduces it.
        dogPresence: 1,
        // The Aquala mark stays as a faint anchor above the scene once Relay
        // has begun — the signal that brought the user here has not left.
        aqualaPresence: live.current.activated ? 0.34 : 0.2,
        flow: 0,
        pointer: reducedMotion ? null : live.current.pointer,
        elapsed,
      });

      const next: Record<string, { x: number; y: number; visible: boolean }> = {};
      for (const [key, anchor] of Object.entries(SYSTEM_ANCHORS)) {
        const p = engineRef.current.project(anchor);
        next[key] = { x: p.x, y: p.y, visible: p.visible };
      }
      setAnchors(next);

      frames += 1;
      window_ += dt;
      if (window_ >= 1) {
        const fps = Math.round(frames / window_);
        setTelemetry((t) => (t.fps === fps ? t : { ...t, fps }));
        frames = 0;
        window_ = 0;
      }
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    const onVisible = () => {
      if (!document.hidden && frame === 0) { last = 0; frame = requestAnimationFrame(tick); }
    };
    document.addEventListener('visibilitychange', onVisible);
    frame = requestAnimationFrame(tick);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisible);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // The scene is created ONCE. `step` and `activated` are read through a ref
    // inside the loop precisely so that changing them cannot re-run this effect
    // and tear the Dog down — which is the whole point of the persistent scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animator, reducedMotion]);

  return { canvasRef, telemetry, anchors, pulse };
}
