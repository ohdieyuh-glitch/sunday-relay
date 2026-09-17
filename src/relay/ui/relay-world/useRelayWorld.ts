import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AQUALA_PRESENCE, CAMERA_FOV, CAMERA_POSITION, CAMERA_TARGET, clamp01,
  dogBeatAt, sampleTrack, sampleVec3, sceneAt, type ScenePosition, type Vec3,
} from '../landing/choreography';
import { SteppedDogAnimator, type DogState } from '../landing/three/dog-rig';
import { chooseDpr, chooseTier, createLandingEngine, type LandingEngine } from '../landing/three/engine';
import { snapToBeat } from '../landing/useLandingRuntime';
import type { OnboardingStepId } from '../relay-experience/onboarding';
import {
  CREATE_AGENT_POSE, transitionDuration, transitionFrame,
  type CameraPose, type TransitionFrame, type WorldStage,
} from './world-stage';

/**
 * THE RELAY WORLD — one WebGL scene for the entire journey.
 *
 * Before this, the landing and the Relay experience each created their own
 * renderer, their own canvas and their own frame loop, and the router swapped
 * one for the other. That is a page navigation wearing a 3D costume: the
 * context is destroyed, the Dog is rebuilt, and whatever the camera was doing
 * is discarded. No amount of easing makes that continuous.
 *
 * So there is now exactly ONE owner. The stage changes what is driven; nothing
 * is torn down. The Relay Dog in front of the user on the creation screen is
 * the same object that was standing under the Aquala mark a moment earlier —
 * not a second instance that resembles it.
 *
 * This also collapses the two frame loops into one, which is why the repository
 * guard on dog loops now names a single owner instead of two.
 */

export type WorldTelemetry = {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly tier: string;
  readonly fps: number;
  readonly webgl: boolean;
  readonly reducedMotion: boolean;
};

const EMPTY_TELEMETRY: WorldTelemetry = {
  width: 0, height: 0, dpr: 1, tier: 'unknown', fps: 0, webgl: false, reducedMotion: false,
};

/** Where the system nodes hang around the Dog on the Relay screens. */
export const SYSTEM_ANCHORS: Readonly<Record<string, Vec3>> = Object.freeze({
  architect: [-13, 24, -4],
  coding: [19, 24, -4],
  reviewer: [3, 29, -14],
  brain: [3, 2.5, -13],
  card: [17, 8, 8],
});

/** Landing chip anchors, kept from the Aquala beats. */
const BEAT_ANCHORS: readonly Vec3[] = [
  [-13, 20, -6], [13, 22, -8], [-16, 12, 4], [16, 14, 2], [-9, 26, -12], [10, 27, -10], [0, 8, 10],
];

/** The Dog's behaviour per creation step. It looks and turns; it never walks. */
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

const DOG_ANCHOR = { x: 3.5, z: 1 };

export type ScreenAnchor = { x: number; y: number; depth: number; visible: boolean };

export type RelayWorld = {
  readonly canvasRef: (node: HTMLCanvasElement | null) => void;
  readonly scrollRef: (node: HTMLDivElement | null) => void;
  readonly stage: WorldStage;
  /** Aquala beat position — only meaningful while the stage is `aquala`. */
  readonly position: ScenePosition;
  readonly telemetry: WorldTelemetry;
  readonly beatAnchors: readonly ScreenAnchor[];
  readonly systemAnchors: Readonly<Record<string, ScreenAnchor>>;
  /** Chrome opacities and the veil, driven by the passage. */
  readonly veil: number;
  readonly aqualaChrome: number;
  readonly relayChrome: number;
  /** Is the pointer currently over the Aquala artifact? Drives the cursor. */
  readonly overPortal: boolean;
  /** Commit to entering Relay. Idempotent while the passage is running. */
  readonly enterRelay: () => void;
  /** One-shot acknowledgement from the Dog. */
  readonly pulse: () => void;
};

export function useRelayWorld(
  initialStage: WorldStage,
  step: OnboardingStepId,
  reducedMotion: boolean,
  onArrive: () => void,
): RelayWorld {
  const [stage, setStage] = useState<WorldStage>(initialStage);
  const [position, setPosition] = useState<ScenePosition>(() => sceneAt(0));
  const [telemetry, setTelemetry] = useState<WorldTelemetry>(EMPTY_TELEMETRY);
  const [beatAnchors, setBeatAnchors] = useState<readonly ScreenAnchor[]>([]);
  const [systemAnchors, setSystemAnchors] = useState<Readonly<Record<string, ScreenAnchor>>>({});
  const [chrome, setChrome] = useState({ veil: 0, aqualaChrome: initialStage === 'aquala' ? 1 : 0, relayChrome: initialStage === 'relay' ? 1 : 0 });
  const [overPortal, setOverPortal] = useState(false);

  const canvasNode = useRef<HTMLCanvasElement | null>(null);
  const scrollNode = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<LandingEngine | null>(null);
  const animator = useMemo(() => new SteppedDogAnimator(), []);
  const arrived = useRef(onArrive);
  arrived.current = onArrive;

  const live = useRef({
    stage: initialStage as WorldStage,
    step,
    reducedMotion,
    pointer: null as { x: number; y: number } | null,
    smoothProgress: 0,
    flow: 0,
    elapsed: 0,
    react: 0,
    /** Transition clock and the pose it departed from. */
    tProgress: 0,
    tStart: 0,
    from: null as CameraPose | null,
    /** Last camera actually rendered — the passage departs from exactly this. */
    lastPose: CREATE_AGENT_POSE as CameraPose,
  });
  live.current.step = step;
  live.current.reducedMotion = reducedMotion;

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => { canvasNode.current = node; }, []);
  const scrollRef = useCallback((node: HTMLDivElement | null) => { scrollNode.current = node; }, []);
  const pulse = useCallback(() => { live.current.react = 1; }, []);

  const enterRelay = useCallback(() => {
    if (live.current.stage !== 'aquala') return;
    // WITHOUT A CONTEXT THERE IS NO LOOP, and the loop is what advances the
    // passage — so a device that cannot render would enter `transition` and
    // stay there forever, with the veil frozen over a page it never left.
    // Static mode arrives immediately instead: no flight, but a real arrival.
    if (engineRef.current === null) {
      live.current.stage = 'relay';
      setStage('relay');
      setChrome({ veil: 0, aqualaChrome: 0, relayChrome: 1 });
      arrived.current();
      return;
    }
    live.current.from = live.current.lastPose;
    live.current.tProgress = 0;
    live.current.tStart = 0;
    live.current.stage = 'transition';
    setStage('transition');
  }, []);

  useEffect(() => { live.current.stage = stage; }, [stage]);

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
      setTelemetry({ ...EMPTY_TELEMETRY, width: window.innerWidth, height: window.innerHeight, dpr, tier, reducedMotion });
      return undefined;
    }
    engineRef.current = engine;
    setTelemetry({ width: window.innerWidth, height: window.innerHeight, dpr, tier, fps: 0, webgl: true, reducedMotion });

    let frame = 0;
    let last = 0;
    let frames = 0;
    let fpsWindow = 0;

    const onResize = () => {
      engineRef.current?.resize(window.innerWidth, window.innerHeight);
      setTelemetry((t) => ({ ...t, width: window.innerWidth, height: window.innerHeight }));
    };
    const onPointer = (event: PointerEvent) => {
      live.current.pointer = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: (event.clientY / window.innerHeight) * 2 - 1,
      };
    };
    const onLeave = () => { live.current.pointer = null; };
    const onVisibility = () => {
      if (!document.hidden && frame === 0) { last = 0; frame = window.requestAnimationFrame(tick); }
    };

    function readScroll(): number {
      const node = scrollNode.current;
      if (!node) return 0;
      const range = node.scrollHeight - window.innerHeight;
      if (range <= 0) return 0;
      return clamp01((window.scrollY - node.offsetTop) / range);
    }

    function tick(now: number): void {
      const s = live.current;
      if (!engineRef.current || document.hidden) { frame = 0; return; }
      const dt = last === 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
      last = now;
      s.elapsed += dt;

      let pose: CameraPose;
      let aqualaPresence: number;
      let aqualaScale = 1;
      let dogState: DogState;
      let dogYaw: number;
      let dogX = DOG_ANCHOR.x;
      let dogZ = DOG_ANCHOR.z;
      let tracks: { x: boolean } = { x: true };

      if (s.stage === 'aquala') {
        const raw = readScroll();
        const follow = s.reducedMotion ? 1 : 1 - Math.exp(-dt * 6.5);
        const previous = s.smoothProgress;
        s.smoothProgress += (raw - s.smoothProgress) * follow;
        const velocity = Math.abs(s.smoothProgress - previous) / Math.max(dt, 1e-4);
        s.flow = s.reducedMotion ? 0 : Math.min(1, s.flow * 0.9 + velocity * 0.6);
        const p = s.reducedMotion ? snapToBeat(raw) : s.smoothProgress;
        const scenePosition = sceneAt(p);
        const beat = dogBeatAt(scenePosition);
        pose = {
          position: sampleVec3(CAMERA_POSITION, p),
          target: sampleVec3(CAMERA_TARGET, p),
          fov: sampleTrack(CAMERA_FOV, p),
        };
        aqualaPresence = sampleTrack(AQUALA_PRESENCE, p);
        dogState = beat.state;
        dogYaw = beat.yaw;
        dogX = beat.x;
        dogZ = beat.z;
        tracks = { x: beat.tracksPointer };
        setPosition((prev) =>
          prev.index === scenePosition.index && Math.abs(prev.local - scenePosition.local) < 0.004
            ? prev : scenePosition);
      } else if (s.stage === 'transition') {
        // WALL-CLOCK, not accumulated dt.
        //
        // Per-frame dt is clamped to 50ms so a backgrounded tab cannot teleport
        // the Dog — correct for animation, wrong for an authored duration: on a
        // renderer managing 5fps the clamp stretched a 2.4s passage past 10s,
        // and the slower the device, the longer the user waits to arrive. An
        // authored transition takes the time it was authored to take.
        if (s.tStart === 0) s.tStart = now;
        s.tProgress = Math.min(1, (now - s.tStart) / (transitionDuration(s.reducedMotion) * 1000));
        const t: TransitionFrame = transitionFrame(
          s.tProgress, s.from ?? s.lastPose, engineRef.current.aqualaOrigin, s.reducedMotion);
        pose = t.camera;
        aqualaPresence = t.aqualaPresence;
        aqualaScale = t.aqualaScale;
        dogState = 'IDLE';
        dogYaw = 0;
        setChrome({ veil: t.veil, aqualaChrome: t.aqualaChrome, relayChrome: t.relayChrome });
        if (s.tProgress >= 1) {
          s.stage = 'relay';
          setStage('relay');
          setChrome({ veil: 0, aqualaChrome: 0, relayChrome: 1 });
          // The Dog acknowledges the arrival once, then settles.
          s.react = 1;
          arrived.current();
        }
      } else {
        const intent = STEP_INTENT[s.step] ?? STEP_INTENT.name;
        pose = CREATE_AGENT_POSE;
        aqualaPresence = 0.22;
        dogState = intent.state;
        dogYaw = intent.yaw;
      }

      s.lastPose = pose;
      if (s.react > 0) {
        dogState = 'REACT';
        s.react = Math.max(0, s.react - dt * 2.2);
      }

      const dogPose = animator.update(dt, {
        state: dogState,
        x: dogX, z: dogZ, yaw: dogYaw,
        look: s.reducedMotion || !tracks.x ? null : s.pointer,
      });

      engineRef.current.render({
        cameraPosition: pose.position,
        cameraTarget: pose.target,
        fov: pose.fov,
        dogPose,
        // The Dog is ALWAYS fully present. Nothing in this loop reduces it.
        dogPresence: 1,
        aqualaPresence: aqualaPresence * aqualaScale,
        flow: s.flow,
        pointer: s.reducedMotion ? null : s.pointer,
        elapsed: s.elapsed,
      });

      // Portal affordance: only meaningful while Aquala is the subject.
      if (s.stage === 'aquala' && s.pointer) {
        const hit = engineRef.current.pickAquala(s.pointer.x, -s.pointer.y);
        setOverPortal((prev) => (prev === hit ? prev : hit));
      } else {
        setOverPortal((prev) => (prev ? false : prev));
      }

      if (s.stage === 'aquala') {
        setBeatAnchors(BEAT_ANCHORS.map((a) => engineRef.current!.project(a)));
      } else if (s.stage === 'relay') {
        const next: Record<string, ScreenAnchor> = {};
        for (const [key, anchor] of Object.entries(SYSTEM_ANCHORS)) next[key] = engineRef.current.project(anchor);
        setSystemAnchors(next);
      }

      frames += 1;
      fpsWindow += dt;
      if (fpsWindow >= 1) {
        const fps = Math.round(frames / fpsWindow);
        setTelemetry((t) => (t.fps === fps ? t : { ...t, fps }));
        frames = 0;
        fpsWindow = 0;
      }
      frame = window.requestAnimationFrame(tick);
    }

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerleave', onLeave, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    frame = window.requestAnimationFrame(tick);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // The scene is built ONCE. Stage and step are read through a ref inside the
    // loop precisely so changing them cannot re-run this effect and destroy the
    // context — which is the whole point of the persistent world.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animator, reducedMotion]);

  /** A tap anywhere on the canvas that lands on the mark enters Relay. */
  const tryPortalAt = useCallback((clientX: number, clientY: number): boolean => {
    const engine = engineRef.current;
    if (!engine || live.current.stage !== 'aquala' || typeof window === 'undefined') return false;
    const ndcX = (clientX / window.innerWidth) * 2 - 1;
    const ndcY = -((clientY / window.innerHeight) * 2 - 1);
    if (!engine.pickAquala(ndcX, ndcY)) return false;
    enterRelay();
    return true;
  }, [enterRelay]);

  return useMemo(() => ({
    canvasRef, scrollRef, stage, position, telemetry, beatAnchors, systemAnchors,
    veil: chrome.veil, aqualaChrome: chrome.aqualaChrome, relayChrome: chrome.relayChrome,
    overPortal, enterRelay, pulse,
    tryPortalAt,
  }), [canvasRef, scrollRef, stage, position, telemetry, beatAnchors, systemAnchors, chrome, overPortal, enterRelay, pulse, tryPortalAt]) as RelayWorld & { tryPortalAt: (x: number, y: number) => boolean };
}
