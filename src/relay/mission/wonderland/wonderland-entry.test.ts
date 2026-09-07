import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_ADMISSIONS,
  WONDERLAND_ENTRY_FIELDS,
  WONDERLAND_ENTRY_SCHEMA_V1,
  WONDERLAND_NOT_REQUESTED_REASON,
  WONDERLAND_NO_RENDERER_REASON,
  WONDERLAND_PRESENTATIONS,
  WONDERLAND_RENDERER_KINDS,
  WONDERLAND_RENDERER_OFFER_FIELDS,
  admitToWonderland,
  beginWonderlandEntry,
  canRequestWonderland,
  claimWonderlandPresenting,
  failWonderlandPresentation,
  isInsideWonderland,
  leaveWonderland,
  offerWonderlandRenderer,
  refuseWonderlandAdmission,
  requestWonderlandAdmission,
  wonderlandEntryDetail,
  wonderlandEntryHeadline,
} from './wonderland-entry';
import type { WonderlandEntry, WonderlandRendererOffer } from './wonderland-entry';

/**
 * THE ENTRY CONTRACT'S OWN TESTS.
 *
 * The thing being proven throughout is a NEGATIVE: that a successful join
 * cannot become a claim that someone is looking at Wonderland. Every test that
 * follows an admission with an assertion about `isInsideWonderland` is there
 * for that reason, and it is the one property that would still matter if
 * everything else in this module were rewritten.
 */

const PROJECT = 'project-1';
const PLAYER = 'player-1';
const NOW = '2026-09-07T10:00:00.000Z';
const LATER = '2026-09-07T10:00:04.000Z';

const fresh = (): WonderlandEntry =>
  beginWonderlandEntry({ projectId: PROJECT, playerId: PLAYER });

const OFFER: WonderlandRendererOffer = Object.freeze({
  rendererId: 'renderer-1',
  kind: 'unreal_pixel_stream',
  description: 'The Unreal world, streamed',
});

/** Admitted by the bridge, with a session it named. */
const admitted = (): WonderlandEntry =>
  admitToWonderland(requestWonderlandAdmission(fresh()), {
    sessionId: 'session-1',
    atIso: NOW,
  });

/** All the way in: admitted, offered, and confirmed by the renderer. */
const inside = (): WonderlandEntry =>
  claimWonderlandPresenting(offerWonderlandRenderer(admitted(), OFFER), {
    rendererId: OFFER.rendererId,
    atIso: LATER,
  });

/* --------------------------------------------------------- the vocabulary */

describe('the entry vocabulary', () => {
  it('separates being let in from being shown, with no shared member', () => {
    for (const admission of WONDERLAND_ADMISSIONS) {
      expect(WONDERLAND_PRESENTATIONS).not.toContain(admission as never);
    }
  });

  it('defaults both axes to the answer that claims least', () => {
    // Ordinal 0 is load-bearing: a zero-filled struct must say "nobody asked"
    // and "nothing can draw it", never "admitted" and never "presenting".
    expect(WONDERLAND_ADMISSIONS[0]).toBe('not_requested');
    expect(WONDERLAND_PRESENTATIONS[0]).toBe('no_renderer');
  });

  it('names the two ways a world could be shown and marks which is which', () => {
    expect([...WONDERLAND_RENDERER_KINDS].sort()).toEqual(
      ['embedded_scene', 'unreal_pixel_stream'].sort(),
    );
  });

  it('lists each field exactly once', () => {
    expect(new Set(WONDERLAND_ENTRY_FIELDS).size).toBe(WONDERLAND_ENTRY_FIELDS.length);
    expect(new Set(WONDERLAND_RENDERER_OFFER_FIELDS).size).toBe(
      WONDERLAND_RENDERER_OFFER_FIELDS.length,
    );
  });
});

/* ------------------------------------------------------------ the start */

describe('an entry nobody has attempted', () => {
  it('claims nothing about either axis', () => {
    const entry = fresh();
    expect(entry.admission).toBe('not_requested');
    expect(entry.presentation).toBe('no_renderer');
    expect(entry.sessionId).toBeNull();
    expect(entry.admittedAtIso).toBeNull();
    expect(entry.presentingSinceIso).toBeNull();
    expect(isInsideWonderland(entry)).toBe(false);
  });

  it('says why there is nothing on screen, rather than leaving it blank', () => {
    expect(fresh().presentationReason).toBe(WONDERLAND_NO_RENDERER_REASON);
    expect(wonderlandEntryDetail(fresh())).toBe(WONDERLAND_NOT_REQUESTED_REASON);
  });

  it('is frozen, versioned and shaped exactly as declared', () => {
    const entry = fresh();
    expect(entry.schemaVersion).toBe(WONDERLAND_ENTRY_SCHEMA_V1);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.keys(entry).sort()).toEqual([...WONDERLAND_ENTRY_FIELDS].sort());
  });
});

/* --------------------------------------------------------- being let in */

describe('asking the world for admission', () => {
  it('announces nothing while the request is in flight', () => {
    const asking = requestWonderlandAdmission(fresh());
    expect(asking.admission).toBe('requesting');
    expect(asking.sessionId).toBeNull();
    expect(isInsideWonderland(asking)).toBe(false);
    expect(wonderlandEntryHeadline(asking)).toBe('ENTERING');
  });

  it('does not ask twice while one request is outstanding', () => {
    expect(canRequestWonderland(fresh())).toBe(true);
    expect(canRequestWonderland(requestWonderlandAdmission(fresh()))).toBe(false);
    // Nor once admitted: what is left to do is render, not ask again.
    expect(canRequestWonderland(admitted())).toBe(false);
  });

  it('lets a refused attempt be retried', () => {
    const refused = refuseWonderlandAdmission(fresh(), { reason: 'The bridge is unreachable.' });
    expect(canRequestWonderland(refused)).toBe(true);
  });

  it('keeps the previous reason on screen while a retry runs', () => {
    // The button is showing that sentence to a person; blanking it the instant
    // they retry replaces an explanation with nothing.
    const refused = refuseWonderlandAdmission(fresh(), { reason: 'Sign in to Relay.' });
    expect(requestWonderlandAdmission(refused).admissionReason).toBe('Sign in to Relay.');
  });

  it('records the session the bridge named, and the moment', () => {
    const entry = admitted();
    expect(entry.admission).toBe('admitted');
    expect(entry.sessionId).toBe('session-1');
    expect(entry.admittedAtIso).toBe(NOW);
    expect(entry.admissionReason).toBeNull();
  });

  it('refuses an admission the bridge did not name a session for', () => {
    // A caller with no id to pass would otherwise reach for a generated one,
    // which is the invented identity the domain exists to refuse.
    for (const sessionId of ['', '   ']) {
      const entry = admitToWonderland(requestWonderlandAdmission(fresh()), {
        sessionId,
        atIso: NOW,
      });
      expect(entry.admission).toBe('refused');
      expect(entry.sessionId).toBeNull();
      expect(entry.admissionReason).toContain('without naming it');
    }
  });

  it('always gives a sentence with a refusal', () => {
    const refused = refuseWonderlandAdmission(fresh(), { reason: 'No bridge is configured.' });
    expect(refused.admissionReason).toBe('No bridge is configured.');
    expect(wonderlandEntryDetail(refused)).toBe('No bridge is configured.');
    expect(wonderlandEntryHeadline(refused)).toBe('ENTRY REFUSED');
  });
});

/* ------------------------------------------- the rule the module exists for */

describe('being admitted is not being there', () => {
  it('is not inside, at any point up to a renderer confirming', () => {
    expect(isInsideWonderland(fresh())).toBe(false);
    expect(isInsideWonderland(requestWonderlandAdmission(fresh()))).toBe(false);
    expect(isInsideWonderland(admitted())).toBe(false);
    expect(isInsideWonderland(offerWonderlandRenderer(admitted(), OFFER))).toBe(false);
    expect(isInsideWonderland(inside())).toBe(true);
  });

  it('says both halves of the truth when the world let them in and nothing draws it', () => {
    const entry = admitted();
    expect(entry.admission).toBe('admitted');
    expect(entry.presentation).toBe('no_renderer');
    expect(wonderlandEntryHeadline(entry)).toBe('ADMITTED · NOTHING CAN SHOW IT');
    expect(wonderlandEntryDetail(entry)).toBe(WONDERLAND_NO_RENDERER_REASON);
  });

  it('never reports being inside for any admission on its own', () => {
    for (const admission of WONDERLAND_ADMISSIONS) {
      const entry: WonderlandEntry = Object.freeze({ ...fresh(), admission });
      expect(isInsideWonderland(entry)).toBe(false);
      expect(wonderlandEntryHeadline(entry)).not.toBe('IN WONDERLAND');
    }
  });

  it('reports being inside for presenting and for no other presentation', () => {
    for (const presentation of WONDERLAND_PRESENTATIONS) {
      const entry: WonderlandEntry = Object.freeze({ ...admitted(), presentation });
      expect(isInsideWonderland(entry)).toBe(presentation === 'presenting');
    }
  });
});

/* ------------------------------------------------------ being shown it */

describe('handing the world to a renderer', () => {
  it('is a request and not an arrival', () => {
    const offered = offerWonderlandRenderer(admitted(), OFFER);
    expect(offered.presentation).toBe('offered');
    expect(offered.rendererId).toBe(OFFER.rendererId);
    expect(offered.rendererKind).toBe(OFFER.kind);
    expect(offered.presentingSinceIso).toBeNull();
    expect(wonderlandEntryHeadline(offered)).toBe('ADMITTED · RENDERER STARTING');
  });

  it('refuses to show a world nobody was let into, and counts it', () => {
    for (const entry of [fresh(), requestWonderlandAdmission(fresh())]) {
      const offered = offerWonderlandRenderer(entry, OFFER);
      expect(offered.presentation).toBe('no_renderer');
      expect(offered.rendererId).toBeNull();
      expect(offered.unadmittedPresentationsRefused).toBe(1);
    }
  });

  it('arrives only on a renderer CONFIRMING, never on being asked', () => {
    const entry = inside();
    expect(entry.presentation).toBe('presenting');
    expect(entry.presentingSinceIso).toBe(LATER);
    expect(entry.presentationReason).toBeNull();
    expect(wonderlandEntryHeadline(entry)).toBe('IN WONDERLAND');
    expect(wonderlandEntryDetail(entry)).toBeNull();
  });

  it('refuses a confirmation from a renderer that was never offered the session', () => {
    // Either a stale message from a previous attempt, or a different renderer
    // answering for one that failed. Both are the same mistake.
    const offered = offerWonderlandRenderer(admitted(), OFFER);
    const impostor = claimWonderlandPresenting(offered, {
      rendererId: 'renderer-2',
      atIso: LATER,
    });
    expect(impostor.presentation).toBe('offered');
    expect(impostor.unofferedRendererClaimsRefused).toBe(1);
    expect(isInsideWonderland(impostor)).toBe(false);
  });

  it('refuses a confirmation when no renderer was offered at all', () => {
    const confirmed = claimWonderlandPresenting(admitted(), {
      rendererId: OFFER.rendererId,
      atIso: LATER,
    });
    expect(confirmed.presentation).toBe('no_renderer');
    expect(confirmed.unofferedRendererClaimsRefused).toBe(1);
  });

  it('refuses a confirmation for an entry that was never admitted', () => {
    const confirmed = claimWonderlandPresenting(fresh(), {
      rendererId: OFFER.rendererId,
      atIso: LATER,
    });
    expect(isInsideWonderland(confirmed)).toBe(false);
    expect(confirmed.unadmittedPresentationsRefused).toBe(1);
    // The admission failure is the one reported: it is the earlier problem.
    expect(confirmed.unofferedRendererClaimsRefused).toBe(0);
  });

  it('keeps the admission when a renderer fails, because the world still let them in', () => {
    const failed = failWonderlandPresentation(inside(), { reason: 'The stream did not start.' });
    expect(failed.presentation).toBe('failed');
    expect(failed.presentingSinceIso).toBeNull();
    expect(failed.admission).toBe('admitted');
    expect(failed.sessionId).toBe('session-1');
    expect(wonderlandEntryHeadline(failed)).toBe('ADMITTED · RENDERER FAILED');
    expect(wonderlandEntryDetail(failed)).toBe('The stream did not start.');
  });
});

/* ------------------------------------------------------------- leaving */

describe('leaving', () => {
  it('stops the presentation and says nothing about the world', () => {
    // Whether the world still holds this presence is the bridge's answer. A
    // client asserting its own departure ended a server-side session would be
    // claiming something it cannot observe.
    const left = leaveWonderland(inside(), { reason: 'You closed the world.' });
    expect(left.presentation).toBe('no_renderer');
    expect(left.presentingSinceIso).toBeNull();
    expect(left.rendererId).toBeNull();
    expect(left.admission).toBe('admitted');
    expect(left.sessionId).toBe('session-1');
    expect(isInsideWonderland(left)).toBe(false);
  });

  it('ends the presentation when the bridge itself withdraws admission', () => {
    const withdrawn = refuseWonderlandAdmission(inside(), {
      reason: 'Your Relay session expired.',
    });
    expect(withdrawn.admission).toBe('refused');
    expect(withdrawn.sessionId).toBeNull();
    expect(withdrawn.presentation).toBe('no_renderer');
    expect(isInsideWonderland(withdrawn)).toBe(false);
    expect(withdrawn.presentationReason).toBe('Your Relay session expired.');
  });
});

/* ------------------------------------------------------------- the whole */

describe('across the whole entry', () => {
  it('never invents a session id', () => {
    const steps: readonly WonderlandEntry[] = [
      fresh(),
      requestWonderlandAdmission(fresh()),
      refuseWonderlandAdmission(fresh(), { reason: 'no' }),
      offerWonderlandRenderer(fresh(), OFFER),
      claimWonderlandPresenting(fresh(), { rendererId: OFFER.rendererId, atIso: NOW }),
    ];
    for (const entry of steps) expect(entry.sessionId).toBeNull();
    expect(admitted().sessionId).toBe('session-1');
  });

  it('keeps every step frozen and correctly shaped', () => {
    const steps: readonly WonderlandEntry[] = [
      fresh(),
      requestWonderlandAdmission(fresh()),
      admitted(),
      offerWonderlandRenderer(admitted(), OFFER),
      inside(),
      failWonderlandPresentation(inside(), { reason: 'x' }),
      leaveWonderland(inside(), { reason: 'x' }),
      refuseWonderlandAdmission(inside(), { reason: 'x' }),
    ];
    for (const entry of steps) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.keys(entry).sort()).toEqual([...WONDERLAND_ENTRY_FIELDS].sort());
      expect(entry.projectId).toBe(PROJECT);
      expect(entry.playerId).toBe(PLAYER);
      // Nothing outside `presenting` may carry an arrival timestamp.
      if (entry.presentation !== 'presenting') expect(entry.presentingSinceIso).toBeNull();
    }
  });

  it('always has either a headline reason or a genuine arrival', () => {
    const steps: readonly WonderlandEntry[] = [
      fresh(),
      admitted(),
      offerWonderlandRenderer(admitted(), OFFER),
      failWonderlandPresentation(inside(), { reason: 'The stream did not start.' }),
      refuseWonderlandAdmission(fresh(), { reason: 'The bridge is unreachable.' }),
      inside(),
    ];
    for (const entry of steps) {
      const detail = wonderlandEntryDetail(entry);
      if (isInsideWonderland(entry)) expect(detail).toBeNull();
      else expect((detail ?? '').length).toBeGreaterThan(10);
    }
  });

  it('leaks no URL, credential or provider into anything a person is shown', () => {
    const shown = [
      wonderlandEntryHeadline(inside()),
      wonderlandEntryHeadline(admitted()),
      wonderlandEntryDetail(admitted()) ?? '',
      wonderlandEntryDetail(fresh()) ?? '',
    ].join(' ').toLowerCase();
    for (const leak of ['http', 'bearer', 'token', 'relay-session', 'sk-', '/wonderland/']) {
      expect(shown).not.toContain(leak);
    }
  });
});
