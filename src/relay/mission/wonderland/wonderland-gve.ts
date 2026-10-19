/**
 * SUNDAY RELAY — WONDERLAND: THE GUIDED VERIFIED EXPERIENCE.
 *
 * A GVE is play that improves something real. Three classes, and the class says
 * what it improves: PROJECT (the actual software), AGENT (the Compound Agent, its
 * PSP, its skills), HYBRID (both). An experience that improves neither is a
 * minigame, and Wonderland does not ship one.
 *
 * ONE GVE IS BUILT: `runaway_dog_research_chase`. The user chases a runaway Relay
 * Dog through Wonderland while Relay runs a real multi-step research Loop over
 * the project or the Agent. Capturing the Dog reveals evidence-backed
 * recommendations and selectable Missions.
 *
 * THE TWO PLACES THIS COULD HAVE BECOME A LIE, and what stops it:
 *
 *  1. THE REWARD HAS TO LAND. A chase that ends with nothing feels broken, which
 *     is exactly the pressure that produces invented copy. So a recommendation
 *     with no evidence is WITHHELD: `headline` is replaced by the withholding
 *     sentence, and the original text is not carried anywhere the renderer can
 *     reach. The chase can end with "the research found nothing citable" —
 *     that is a real outcome and it is allowed to be disappointing.
 *
 *  2. CAPTURING FEELS LIKE COMPLETING. It is not. `captureUnlocked` requires the
 *     backing Loop to have actually reached `completed` — the Loop Engine's only
 *     successful terminal state. Every exhaustion is terminal and none of them is
 *     completion, so a chase whose research ran out of budget stays locked and
 *     says so.
 *
 * The GVE never starts, stops, or schedules the Loop. It reads the Loop's state
 * and offers Missions as REQUESTS. Relay decides.
 *
 * PURE. No clock, no network.
 */

import { EVIDENCE_FRESHNESS } from '../evidence/evidence-contracts';
import type { EvidenceFreshness } from '../evidence/evidence-contracts';
import { isActiveLoopState } from '../loop/runtime/loop-runtime-state';
import type { RelayLoopRuntimeState } from '../loop/runtime/loop-runtime-types';
import {
  WONDERLAND_REQUEST_AUTHORITY,
  type WonderlandGve,
  type WonderlandGveClass,
  type WonderlandGveId,
  type WonderlandGvePhase,
  type WonderlandMissionRequest,
  type WonderlandRecommendation,
} from './wonderland-contracts';

/** The one built GVE. */
export const RUNAWAY_DOG_GVE_ID: WonderlandGveId = 'runaway_dog_research_chase';

/**
 * HYBRID: the chase researches the project AND what the Agent should learn from
 * it, and the recommendations it reveals can target either. Declared here rather
 * than passed in, because the class is a property of the experience.
 */
export const RUNAWAY_DOG_GVE_CLASS: WonderlandGveClass = 'hybrid';

/* ------------------------------------------------------- recommendations */

/**
 * A candidate recommendation the research produced.
 *
 * `headline` is what the research said. Whether a player ever reads it is
 * decided by `projectWonderlandRecommendation`, not by the producer.
 */
export interface WonderlandRecommendationCandidate {
  readonly recommendationId: string;
  readonly headline: string;
  readonly evidenceIds: readonly string[];
  /** Relay's freshness verdict for the newest cited evidence. */
  readonly evidenceFreshness?: EvidenceFreshness | null;
}

/**
 * The withholding sentence. Exported so a test asserts the exact words and a
 * surface cannot soften them into something that reads like a recommendation.
 */
export const WONDERLAND_WITHHELD_HEADLINE =
  'Withheld — this recommendation cited no evidence Relay can show you.';

/**
 * Project one candidate.
 *
 * Two ways to be withheld, and both replace the headline:
 *   - no evidence ids at all;
 *   - an unrecognised freshness value, which means something upstream produced a
 *     verdict this build does not know how to read. An unreadable provenance is
 *     not a fresh one.
 *
 * A withheld recommendation keeps its id and its (empty or unreadable) evidence
 * list so the absence is inspectable, and loses its text so the absence cannot be
 * read past.
 */
export function projectWonderlandRecommendation(
  candidate: WonderlandRecommendationCandidate,
): WonderlandRecommendation {
  const freshness = candidate.evidenceFreshness ?? null;
  const freshnessKnown =
    freshness === null || (EVIDENCE_FRESHNESS as readonly string[]).includes(freshness);

  if (candidate.evidenceIds.length === 0) {
    return {
      recommendationId: candidate.recommendationId,
      headline: WONDERLAND_WITHHELD_HEADLINE,
      evidenceIds: [],
      evidenceFreshness: null,
      withheld: true,
      withheldReason:
        'The research produced this recommendation without citing any evidence record. Relay shows evidence-backed findings only.',
    };
  }
  if (!freshnessKnown) {
    return {
      recommendationId: candidate.recommendationId,
      headline: WONDERLAND_WITHHELD_HEADLINE,
      evidenceIds: candidate.evidenceIds,
      evidenceFreshness: null,
      withheld: true,
      withheldReason:
        'The cited evidence carries a freshness verdict this build cannot read, so its age is unknown.',
    };
  }
  return {
    recommendationId: candidate.recommendationId,
    headline: candidate.headline,
    evidenceIds: candidate.evidenceIds,
    evidenceFreshness: freshness,
    withheld: false,
    withheldReason: null,
  };
}

/* ------------------------------------------------------ mission requests */

export interface WonderlandMissionRequestCandidate {
  readonly requestId: string;
  readonly objective: string;
  readonly evidenceIds: readonly string[];
}

/**
 * A Mission the world offers.
 *
 * `authority` is stamped, never accepted from the caller, so no producer can
 * construct a request that claims Wonderland already approved it.
 */
export function projectWonderlandMissionRequest(
  candidate: WonderlandMissionRequestCandidate,
): WonderlandMissionRequest {
  return {
    requestId: candidate.requestId,
    objective: candidate.objective,
    sourceGveId: RUNAWAY_DOG_GVE_ID,
    authority: WONDERLAND_REQUEST_AUTHORITY,
    evidenceIds: candidate.evidenceIds,
  };
}

/* ------------------------------------------------------------- the chase */

export interface WonderlandChaseInput {
  /** The Loop actually doing the research. Null when Relay has none. */
  readonly backingLoopId?: string | null;
  readonly backingLoopState?: RelayLoopRuntimeState | null;
  /** True once the player has physically caught the Dog in the world. */
  readonly dogCaught?: boolean;
  /** The player abandoned the chase. Terminal and honest — not a failure. */
  readonly abandoned?: boolean;
  readonly recommendations?: readonly WonderlandRecommendationCandidate[];
  readonly missionRequests?: readonly WonderlandMissionRequestCandidate[];
}

/**
 * Why capture is locked, or null when it is not.
 *
 * Exported because the sentences ARE the feature: a locked reward with no reason
 * is the thing players work around, and the reason is always a real Relay fact.
 */
export function chaseCaptureBlockedReason(
  state: RelayLoopRuntimeState | null,
): string | null {
  if (state === null) {
    return 'No Relay research Loop is attached to this chase, so there is nothing for capturing the Dog to reveal.';
  }
  if (state === 'completed') return null;
  if (state === 'recovery_required') {
    return 'The research Loop cannot confirm its own outcome. A human has to look before anything is revealed.';
  }
  return `The research Loop is ${state}. Capturing the Dog reveals findings only after the research actually completes — an exhausted or stopped Loop is finished, not complete.`;
}

/**
 * The chase, projected.
 *
 * Phase precedence, and why:
 *   abandoned          the player's own decision outranks machine state.
 *   unavailable        no backing Loop means no experience to be in.
 *   captured/resolved  a caught Dog with the research complete resolves; a caught
 *                      Dog with incomplete research is `captured` and reveals
 *                      nothing, which is the honest outcome rather than the
 *                      satisfying one.
 *   capture_ready      research complete, Dog still loose.
 *   backend_running    the Loop is doing work right now.
 *   chase_active       a Loop exists and is not currently working.
 *
 * `recommendations` and `missionRequests` are emitted ONLY when the phase is
 * `resolved`. Before that the arrays are empty — not withheld placeholders,
 * because a placeholder is a thing to read.
 */
export function projectWonderlandChase(input: WonderlandChaseInput): WonderlandGve {
  const backingLoopId = input.backingLoopId ?? null;
  const backingLoopState = input.backingLoopState ?? null;
  const captureBlockedReason = chaseCaptureBlockedReason(backingLoopState);
  const captureUnlocked = captureBlockedReason === null;
  const caught = input.dogCaught === true;

  const phase: WonderlandGvePhase = input.abandoned === true
    ? 'abandoned'
    : backingLoopId === null
      ? 'unavailable'
      : caught
        ? captureUnlocked ? 'resolved' : 'captured'
        : captureUnlocked
          ? 'capture_ready'
          // `isActiveLoopState` rather than a list of state names: the Loop
          // Engine already decided what counts as doing work, and it
          // deliberately excludes every wait state. A second list here would
          // eventually animate a run that is blocked on approval.
          : backingLoopState !== null && isActiveLoopState(backingLoopState)
            ? 'backend_running'
            : 'chase_active';

  const revealed = phase === 'resolved';

  return {
    gveId: RUNAWAY_DOG_GVE_ID,
    gveClass: RUNAWAY_DOG_GVE_CLASS,
    phase,
    backingLoopId,
    backingLoopState,
    captureUnlocked,
    captureBlockedReason,
    recommendations: revealed
      ? (input.recommendations ?? []).map(projectWonderlandRecommendation)
      : [],
    missionRequests: revealed
      ? (input.missionRequests ?? []).map(projectWonderlandMissionRequest)
      : [],
  };
}
