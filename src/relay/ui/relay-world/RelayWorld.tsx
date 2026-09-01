import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RelayLanding } from '../landing/RelayLanding';
import { usePrefersReducedMotion } from '../landing/useLandingRuntime';
import { SCENE_COUNT } from '../landing/choreography';
import { RelayExperience } from '../relay-experience/RelayExperience';
import {
  firstIncompleteStep, isConfigured, loadAgentDraft, saveAgentDraft,
  type CompoundAgentDraft, type OnboardingStepId,
} from '../relay-experience/onboarding';
import { useRelayWorld } from './useRelayWorld';
import type { WorldStage } from './world-stage';

/**
 * THE RELAY WORLD — Aquala, the passage, and Relay, in one mounted scene.
 *
 * This component is what the router returns for BOTH the bare URL and
 * `#/relay`, which is the mechanism that makes entering Relay continuous: React
 * reconciles the same element, so the canvas, the WebGL context, the Dog and
 * the camera all survive the hash change. Nothing is destroyed and nothing is
 * rebuilt; only the stage changes.
 *
 * The old shell is not reachable from any of it.
 */
export function RelayWorld({ initialStage, initialStep, onActivated }: {
  readonly initialStage: WorldStage;
  /** Open the Relay panel on this step instead of resuming where the record
   *  left off — the explicit NEW C.A.R.D. path opens on its C.A.R.D. step. */
  readonly initialStep?: OnboardingStepId;
  /**
   * The participant brought their Compound Agent online during THIS visit.
   *
   * Optional, and fired once. The demo build passes nothing and behaves exactly
   * as before; the live front door uses it to continue the private-beta journey
   * once the Agent exists. It deliberately does NOT fire for someone arriving
   * with an already-activated Agent — a returning visitor is here to look at
   * the world, and bouncing them out of the landing page they just opened
   * would make the front door unreachable for the people most likely to visit.
   */
  readonly onActivated?: () => void;
}): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const [draft, setDraftState] = useState<CompoundAgentDraft>(() => loadAgentDraft());
  const [step, setStep] = useState<OnboardingStepId>(() => {
    if (initialStep !== undefined) return initialStep;
    const stored = loadAgentDraft();
    return isConfigured(stored) ? 'activate' : firstIncompleteStep(stored);
  });
  const returning = useMemo(() => isConfigured(loadAgentDraft()), []);

  const onArrive = useCallback(() => {
    // The URL catches up with the world AFTER the passage lands, so a reload
    // returns the user where they actually are. It is not what performs the
    // navigation — the camera already did that.
    if (typeof window !== 'undefined' && window.location.hash !== '#/relay') {
      window.history.replaceState(null, '', '#/relay');
    }
  }, []);

  const world = useRelayWorld(initialStage, step, reducedMotion, onArrive);

  // REPORT AN ONLINE AGENT, INCLUDING ONE THAT WAS ALREADY ONLINE.
  //
  // Reporting only the transition looked tidier, and it stranded the person it
  // was supposed to protect: someone who activated on a previous visit came
  // back to a world holding an Agent it would never announce, with no control
  // left that advances anything. Whoever holds an activated Agent is past the
  // front door, so say so once per mount and let the caller decide.
  const announcedActivation = useRef(false);
  useEffect(() => {
    if (draft.activatedAt === null || announcedActivation.current) return;
    announcedActivation.current = true;
    onActivated?.();
  }, [draft.activatedAt, onActivated]);

  const setDraft = useCallback((patch: Partial<CompoundAgentDraft>, react = false) => {
    // The STORE's answer is the state: it mints the C.A.R.D.'s identity on the
    // first save and advances the revision on every real change, so what the
    // world shows is exactly what every other surface will read.
    setDraftState((prev) => saveAgentDraft({ ...prev, ...patch }));
    if (react) world.pulse();
  }, [world]);
  // The explicit NEW C.A.R.D. / NEW COMPOUND AGENT paths persist through the
  // store themselves and hand the world the record they created.
  const replaceDraft = useCallback((next: CompoundAgentDraft) => {
    setDraftState(next);
    world.pulse();
  }, [world]);

  // Touch and mouse both enter through the artifact itself; the hit test runs
  // against the mark's real geometry, so it stays correct while the mark tilts.
  const onCanvasPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    (world as unknown as { tryPortalAt: (x: number, y: number) => boolean })
      .tryPortalAt(event.clientX, event.clientY);
  }, [world]);

  const showAquala = world.stage !== 'relay';
  const showRelay = world.stage !== 'aquala';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.dataset.relayStage = world.stage;
  }, [world.stage]);

  return (
    <div className="rw" data-stage={world.stage} data-portal={world.overPortal ? 'hot' : 'idle'}>
      {/* ONE canvas for the entire journey. */}
      <canvas
        className="rw-canvas"
        ref={world.canvasRef}
        onPointerDown={onCanvasPointer}
        aria-hidden="true"
      />

      {/* Aquala's own light becoming transitional light. Baby-blue, never a
          white flash, and never fully opaque — a transition that has to hide
          what it is doing is a cut. */}
      <div className="rw-veil" style={{ opacity: world.veil }} aria-hidden="true" />

      {showAquala && (
        <div className="rw-layer" style={{ opacity: world.aqualaChrome }}
          {...(world.stage === 'transition' ? { 'aria-hidden': true, inert: '' } : {})}>
          <RelayLanding
            position={world.position}
            telemetry={world.telemetry}
            anchors={world.beatAnchors}
            reducedMotion={reducedMotion}
            onEnterRelay={world.enterRelay}
            overPortal={world.overPortal}
          />
        </div>
      )}

      {showRelay && (
        <div className="rw-layer" style={{ opacity: world.relayChrome }}
          {...(world.stage === 'transition' ? { 'aria-hidden': true, inert: '' } : {})}>
          <RelayExperience
            draft={draft}
            setDraft={setDraft}
            replaceDraft={replaceDraft}
            step={step}
            setStep={setStep}
            returning={returning}
            anchors={world.systemAnchors}
            webgl={world.telemetry.webgl}
          />
        </div>
      )}

      {/* The scroll track lives here so it exists only while Aquala does. */}
      {world.stage === 'aquala' && (
        <div className="rw-track" ref={world.scrollRef}
          style={{ height: `${SCENE_COUNT * 100}vh` }} aria-hidden="true" />
      )}
    </div>
  );
}
