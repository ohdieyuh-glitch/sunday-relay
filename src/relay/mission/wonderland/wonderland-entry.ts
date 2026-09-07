/**
 * ENTERING WONDERLAND — two questions that a single flag would confuse.
 *
 * The landing already knows how to move a person INTO a place: `world-stage.ts`
 * flies one WebGL camera from the Aquala mark into the Relay experience, and it
 * works because both ends of that passage are the same scene. Wonderland is not
 * that. It is a different renderer entirely, and nothing in the web build can
 * draw it — so the second portal cannot be modelled on the first.
 *
 * WHAT WOULD GO WRONG WITH ONE `entered` BOOLEAN. The Relay Bridge really does
 * expose `POST /wonderland/presence/join`, and it really can succeed. A single
 * flag set from that response would be TRUE while the founder is still looking
 * at the landing page — the request worked, the world admitted them, and
 * nothing is on screen. That is the exact shape of the failure this repository
 * exists to refuse: a fact about a request reported as a fact about the world.
 *
 * So there are two axes and neither may be inferred from the other:
 *
 *   ADMISSION     did the world let this person in? The bridge answers.
 *   PRESENTATION  is something actually SHOWING it to them? A renderer answers,
 *                 and only by confirming — never by being asked.
 *
 * Being in Wonderland is `presentation === 'presenting'` and nothing else. An
 * admitted person with no renderer is admitted, which is a real and useful
 * state, and is not the same as being there.
 *
 * WHAT THIS MODULE DOES NOT DO: it opens no socket, joins no presence, and
 * knows no URL. It is the shape of an entry attempt, folded by pure functions
 * with the clock passed in, so the browser and a test reach the same verdict.
 */

import { exactKeys } from './wonderland-contracts';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_ENTRY_SCHEMA_V1 = 'relay-wonderland-entry.v1' as const;
export type WonderlandEntrySchemaVersion = typeof WONDERLAND_ENTRY_SCHEMA_V1;

/* ------------------------------------------------------------- admission */

/**
 * DID THE WORLD LET THIS PERSON IN? Only the bridge can answer.
 *
 *   not_requested  nobody has asked. Ordinal 0, and the honest default: a
 *                  zero-filled struct has not been admitted anywhere
 *   requesting     asked, no answer yet. Announces NOTHING — this is the state
 *                  a button spends its time in, and it is not a soft yes
 *   admitted       the bridge accepted and named a session
 *   refused        the bridge declined, or could not be reached, with a reason
 */
export const WONDERLAND_ADMISSIONS = [
  'not_requested',
  'requesting',
  'admitted',
  'refused',
] as const;
export type WonderlandAdmission = (typeof WONDERLAND_ADMISSIONS)[number];

/* ---------------------------------------------------------- presentation */

/**
 * IS ANYTHING ACTUALLY SHOWING THE WORLD?
 *
 *   no_renderer  nothing here can draw Wonderland. Ordinal 0 because it is both
 *                the honest default AND the true answer for today's web build:
 *                no world client is delivered by it
 *   offered      a renderer has been handed the session and has not confirmed.
 *                A request, not an arrival
 *   presenting   a renderer CONFIRMED it is showing the world. The only state
 *                that means the founder can see Wonderland
 *   failed       a renderer was handed the session and could not show it
 */
export const WONDERLAND_PRESENTATIONS = [
  'no_renderer',
  'offered',
  'presenting',
  'failed',
] as const;
export type WonderlandPresentation = (typeof WONDERLAND_PRESENTATIONS)[number];

/**
 * HOW a renderer would show the world, if one existed.
 *
 * Named as a vocabulary rather than left open because the two differ in a way
 * the product cares about: a pixel stream is the real Unreal world running
 * somewhere else, and an embedded scene is this build drawing an approximation
 * of it. A founder must never be shown the second while being told the first,
 * so the kind travels with the offer and a surface can label it.
 *
 * NEITHER IS IMPLEMENTED. This vocabulary describes what an offer would say;
 * `wonderland-entry-availability.ts` in the UI is where the (currently empty)
 * answer to "what does this build have" lives.
 */
export const WONDERLAND_RENDERER_KINDS = ['unreal_pixel_stream', 'embedded_scene'] as const;
export type WonderlandRendererKind = (typeof WONDERLAND_RENDERER_KINDS)[number];

/** A renderer claiming it could show the world. A claim, not a capability. */
export interface WonderlandRendererOffer {
  readonly rendererId: string;
  readonly kind: WonderlandRendererKind;
  /** Shown to a person. Says what they would be looking at. */
  readonly description: string;
}

export const WONDERLAND_RENDERER_OFFER_FIELDS = exactKeys<WonderlandRendererOffer>()([
  'rendererId',
  'kind',
  'description',
] as const);

/* ----------------------------------------------------------- the attempt */

export interface WonderlandEntry {
  readonly schemaVersion: WonderlandEntrySchemaVersion;
  /** The world being entered. An entry belongs to exactly one project. */
  readonly projectId: string;
  readonly playerId: string;
  readonly admission: WonderlandAdmission;
  /** A sentence whenever admission is `refused`. Never a bare flag. */
  readonly admissionReason: string | null;
  /** Named BY THE BRIDGE on admission. Never invented, never derived. */
  readonly sessionId: string | null;
  readonly admittedAtIso: string | null;
  readonly presentation: WonderlandPresentation;
  /** A sentence whenever nothing is presenting. Says which of the reasons. */
  readonly presentationReason: string | null;
  /** The renderer that was offered, and later the one confirming. */
  readonly rendererId: string | null;
  readonly rendererKind: WonderlandRendererKind | null;
  /** Set only when a renderer's claim held. The timestamp of the arrival. */
  readonly presentingSinceIso: string | null;
  /** Attempts refused because nothing had admitted this person. */
  readonly unadmittedPresentationsRefused: number;
  /** Claims from a renderer that was never offered the session. */
  readonly unofferedRendererClaimsRefused: number;
}

export const WONDERLAND_ENTRY_FIELDS = exactKeys<WonderlandEntry>()([
  'schemaVersion',
  'projectId',
  'playerId',
  'admission',
  'admissionReason',
  'sessionId',
  'admittedAtIso',
  'presentation',
  'presentationReason',
  'rendererId',
  'rendererKind',
  'presentingSinceIso',
  'unadmittedPresentationsRefused',
  'unofferedRendererClaimsRefused',
] as const);

/** The sentence an entry carries before anyone has tried. One wording. */
export const WONDERLAND_NOT_REQUESTED_REASON =
  'Nothing has asked to enter this world yet.';

/** The sentence a build with no world client carries. */
export const WONDERLAND_NO_RENDERER_REASON =
  'No renderer in this build can display Wonderland.';

/** An entry nobody has attempted. */
export function beginWonderlandEntry(input: {
  readonly projectId: string;
  readonly playerId: string;
}): WonderlandEntry {
  return Object.freeze({
    schemaVersion: WONDERLAND_ENTRY_SCHEMA_V1,
    projectId: input.projectId,
    playerId: input.playerId,
    admission: 'not_requested' as const,
    admissionReason: null,
    sessionId: null,
    admittedAtIso: null,
    presentation: 'no_renderer' as const,
    presentationReason: WONDERLAND_NO_RENDERER_REASON,
    rendererId: null,
    rendererKind: null,
    presentingSinceIso: null,
    unadmittedPresentationsRefused: 0,
    unofferedRendererClaimsRefused: 0,
  });
}

/* -------------------------------------------------------- admission moves */

/**
 * The request is in flight.
 *
 * Deliberately clears nothing but the admission: a retry after a refusal
 * should not silently drop the reason the previous attempt failed until a new
 * answer replaces it, because the button is showing that sentence to a person
 * while the retry runs.
 */
export function requestWonderlandAdmission(entry: WonderlandEntry): WonderlandEntry {
  return Object.freeze({ ...entry, admission: 'requesting' as const });
}

/**
 * The bridge accepted, and NAMED A SESSION.
 *
 * The session id is required and must be non-empty, because an admission
 * without one cannot be left, cannot be resumed and cannot be proven — and a
 * caller that had no id to pass would otherwise reach for a generated one,
 * which is exactly the invented identity the domain refuses.
 */
export function admitToWonderland(
  entry: WonderlandEntry,
  input: { readonly sessionId: string; readonly atIso: string },
): WonderlandEntry {
  if (input.sessionId.trim().length === 0) {
    return refuseWonderlandAdmission(entry, {
      reason: 'The bridge admitted this session without naming it, so it cannot be entered.',
    });
  }
  return Object.freeze({
    ...entry,
    admission: 'admitted' as const,
    admissionReason: null,
    sessionId: input.sessionId,
    admittedAtIso: input.atIso,
  });
}

/** The bridge declined, or could not be reached. Always with a sentence. */
export function refuseWonderlandAdmission(
  entry: WonderlandEntry,
  input: { readonly reason: string },
): WonderlandEntry {
  return Object.freeze({
    ...entry,
    admission: 'refused' as const,
    admissionReason: input.reason,
    sessionId: null,
    admittedAtIso: null,
    // A refusal ends any presentation: there is nothing left to show.
    presentation: 'no_renderer' as const,
    presentationReason: input.reason,
    rendererId: null,
    rendererKind: null,
    presentingSinceIso: null,
  });
}

/* ----------------------------------------------------- presentation moves */

/**
 * Hand the session to a renderer. NOT an arrival.
 *
 * Refused when nothing has admitted this person, and the refusal is counted:
 * a surface that tried to show a world it was never let into has a bug worth
 * seeing rather than a blank frame worth guessing about.
 */
export function offerWonderlandRenderer(
  entry: WonderlandEntry,
  offer: WonderlandRendererOffer,
): WonderlandEntry {
  if (entry.admission !== 'admitted') {
    return Object.freeze({
      ...entry,
      unadmittedPresentationsRefused: entry.unadmittedPresentationsRefused + 1,
    });
  }
  return Object.freeze({
    ...entry,
    presentation: 'offered' as const,
    presentationReason: `${offer.description} has been asked to show this world and has not confirmed.`,
    rendererId: offer.rendererId,
    rendererKind: offer.kind,
    presentingSinceIso: null,
  });
}

/**
 * A renderer CLAIMS it is showing the world. The only way in.
 *
 * A claim rather than a confirmation, and the word is chosen: what arrives is
 * evidence this module weighs, not a fact it is obliged to record. Two things
 * must hold, and both are refusals rather than assumptions: admission, because
 * a renderer cannot show a world nobody was let into; and a matching renderer
 * id, because a claim from something that was never handed the session is
 * either a stale message from a previous attempt or a different renderer
 * answering for one that failed.
 */
export function claimWonderlandPresenting(
  entry: WonderlandEntry,
  input: { readonly rendererId: string; readonly atIso: string },
): WonderlandEntry {
  if (entry.admission !== 'admitted') {
    return Object.freeze({
      ...entry,
      unadmittedPresentationsRefused: entry.unadmittedPresentationsRefused + 1,
    });
  }
  if (entry.rendererId === null || entry.rendererId !== input.rendererId) {
    return Object.freeze({
      ...entry,
      unofferedRendererClaimsRefused: entry.unofferedRendererClaimsRefused + 1,
    });
  }
  return Object.freeze({
    ...entry,
    presentation: 'presenting' as const,
    presentationReason: null,
    presentingSinceIso: input.atIso,
  });
}

/** The renderer could not show it. Says why, and keeps the admission. */
export function failWonderlandPresentation(
  entry: WonderlandEntry,
  input: { readonly reason: string },
): WonderlandEntry {
  return Object.freeze({
    ...entry,
    presentation: 'failed' as const,
    presentationReason: input.reason,
    presentingSinceIso: null,
  });
}

/**
 * This browser stopped showing the world.
 *
 * ADMISSION IS DELIBERATELY UNTOUCHED. Whether the world still holds this
 * person's presence is the bridge's answer, and a client that assumed its own
 * departure ended a server-side session would be asserting something it cannot
 * observe. The bridge confirming that is `refuseWonderlandAdmission` with the
 * reason it gave, or a fresh entry.
 */
export function leaveWonderland(
  entry: WonderlandEntry,
  input: { readonly reason: string },
): WonderlandEntry {
  return Object.freeze({
    ...entry,
    presentation: 'no_renderer' as const,
    presentationReason: input.reason,
    rendererId: null,
    rendererKind: null,
    presentingSinceIso: null,
  });
}

/* ------------------------------------------------------------- reading it */

/**
 * IS THIS PERSON IN WONDERLAND? One definition, in one place.
 *
 * `presenting` and nothing else. Every surface asks this question and every
 * surface answering it for itself is how one of them eventually decides that
 * admitted is close enough.
 */
export const isInsideWonderland = (entry: WonderlandEntry): boolean =>
  entry.presentation === 'presenting';

/**
 * Whether asking to enter is worth doing right now.
 *
 * False while a request is in flight — a second join is a second presence — and
 * false once admitted, because the thing left to do then is render, not ask.
 */
export const canRequestWonderland = (entry: WonderlandEntry): boolean =>
  entry.admission === 'not_requested' || entry.admission === 'refused';

/**
 * WHAT A PERSON IS TOLD, derived from both axes so it cannot overstate either.
 *
 * The label for `admitted` is the whole point of this module: the world let
 * them in and there is nothing to look at, and saying so is more useful than
 * either half alone.
 */
export function wonderlandEntryHeadline(entry: WonderlandEntry): string {
  if (isInsideWonderland(entry)) return 'IN WONDERLAND';
  switch (entry.admission) {
    case 'not_requested':
      return 'NOT ENTERED';
    case 'requesting':
      return 'ENTERING';
    case 'refused':
      return 'ENTRY REFUSED';
    case 'admitted':
      switch (entry.presentation) {
        case 'offered':
          return 'ADMITTED · RENDERER STARTING';
        case 'failed':
          return 'ADMITTED · RENDERER FAILED';
        default:
          return 'ADMITTED · NOTHING CAN SHOW IT';
      }
  }
}

/**
 * The sentence under the headline, or null when there is nothing to add.
 *
 * Presentation first: once admitted, the interesting fact is why there is
 * nothing on screen, not that the join worked.
 */
export function wonderlandEntryDetail(entry: WonderlandEntry): string | null {
  if (isInsideWonderland(entry)) return null;
  if (entry.admission === 'refused') return entry.admissionReason;
  if (entry.admission === 'admitted') return entry.presentationReason;
  if (entry.admission === 'not_requested') return WONDERLAND_NOT_REQUESTED_REASON;
  return null;
}
