import { describe, expect, it } from 'vitest';

import { RELAY_LOOP_RUNTIME_STATES } from '../loop/runtime/loop-runtime-types';
import { WONDERLAND_REQUEST_AUTHORITY } from './wonderland-contracts';
import {
  RUNAWAY_DOG_GVE_CLASS,
  RUNAWAY_DOG_GVE_ID,
  WONDERLAND_WITHHELD_HEADLINE,
  chaseCaptureBlockedReason,
  projectWonderlandChase,
  projectWonderlandMissionRequest,
  projectWonderlandRecommendation,
} from './wonderland-gve';

const SECRET_HEADLINE = 'Rewrite the auth middleware before the beta.';

const cited = {
  recommendationId: 'rec_1',
  headline: SECRET_HEADLINE,
  evidenceIds: ['ev_1', 'ev_2'],
  evidenceFreshness: 'recent' as const,
};

/* ------------------------------------------------------- recommendations */

describe('a recommendation without evidence is withheld, not softened', () => {
  it('replaces the headline and states why', () => {
    const withheld = projectWonderlandRecommendation({ ...cited, evidenceIds: [] });
    expect(withheld.withheld).toBe(true);
    expect(withheld.headline).toBe(WONDERLAND_WITHHELD_HEADLINE);
    expect(withheld.withheldReason).toContain('without citing any evidence record');
    expect(withheld.evidenceFreshness).toBeNull();
  });

  it('carries the original text nowhere a renderer could reach it', () => {
    // The pressure this resists: a chase that ends with nothing feels broken, and
    // that is exactly when invented copy appears. The uncited text must not
    // survive anywhere in the projected value.
    const withheld = projectWonderlandRecommendation({ ...cited, evidenceIds: [] });
    expect(JSON.stringify(withheld)).not.toContain(SECRET_HEADLINE);
  });

  it('withholds when the cited evidence carries an unreadable freshness verdict', () => {
    const withheld = projectWonderlandRecommendation({
      ...cited,
      evidenceFreshness: 'brand_new' as never,
    });
    expect(withheld.withheld).toBe(true);
    expect(withheld.withheldReason).toContain('cannot read');
    // The citations stay inspectable even though the text does not.
    expect(withheld.evidenceIds).toEqual(['ev_1', 'ev_2']);
    expect(JSON.stringify(withheld)).not.toContain(SECRET_HEADLINE);
  });

  it('shows a properly cited recommendation verbatim', () => {
    const shown = projectWonderlandRecommendation(cited);
    expect(shown.withheld).toBe(false);
    expect(shown.withheldReason).toBeNull();
    expect(shown.headline).toBe(SECRET_HEADLINE);
    expect(shown.evidenceFreshness).toBe('recent');
  });

  it('accepts an absent freshness verdict without withholding', () => {
    // Relay may cite evidence whose publication time is unknown. That is a known
    // unknown, not an unreadable value.
    const shown = projectWonderlandRecommendation({ ...cited, evidenceFreshness: null });
    expect(shown.withheld).toBe(false);
    expect(shown.evidenceFreshness).toBeNull();
  });
});

/* --------------------------------------------------------------- capture */

describe('capturing the Dog is not completing the research', () => {
  it('opens only on the Loop Engine\'s one successful terminal state', () => {
    expect(chaseCaptureBlockedReason('completed')).toBeNull();
    const stillLocked = RELAY_LOOP_RUNTIME_STATES.filter(
      (state) => state !== 'completed' && chaseCaptureBlockedReason(state) === null,
    );
    expect(stillLocked, 'these states unlocked capture and should not have').toEqual([]);
  });

  it('every exhaustion is terminal and none of them is completion', () => {
    for (const state of [
      'iteration_exhausted', 'duration_exhausted', 'budget_exhausted',
      'token_exhausted', 'provider_call_exhausted', 'timed_out', 'stopped', 'failed',
    ] as const) {
      const reason = chaseCaptureBlockedReason(state);
      expect(reason, state).not.toBeNull();
      // The reason names the actual state, so the player can fix the right thing.
      expect(reason, state).toContain(state);
    }
  });

  it('an unconfirmable Loop stays locked and asks for a human', () => {
    expect(chaseCaptureBlockedReason('recovery_required')).toContain('human');
  });

  it('no backing Loop means nothing to reveal', () => {
    expect(chaseCaptureBlockedReason(null)).toContain('nothing for capturing the Dog to reveal');
  });
});

/* ----------------------------------------------------------------- phases */

describe('the chase phase follows real Relay state', () => {
  it('is unavailable with no backing Loop', () => {
    const gve = projectWonderlandChase({});
    expect(gve.phase).toBe('unavailable');
    expect(gve.gveId).toBe(RUNAWAY_DOG_GVE_ID);
    expect(gve.gveClass).toBe(RUNAWAY_DOG_GVE_CLASS);
    expect(gve.captureUnlocked).toBe(false);
  });

  it('is backend_running only while the Loop is actually working', () => {
    expect(
      projectWonderlandChase({ backingLoopId: 'l', backingLoopState: 'running' }).phase,
    ).toBe('backend_running');
    // Blocked on approval is not work.
    expect(
      projectWonderlandChase({ backingLoopId: 'l', backingLoopState: 'waiting_approval' }).phase,
    ).toBe('chase_active');
  });

  it('is capture_ready once the research completes and the Dog is still loose', () => {
    const gve = projectWonderlandChase({ backingLoopId: 'l', backingLoopState: 'completed' });
    expect(gve.phase).toBe('capture_ready');
    expect(gve.captureUnlocked).toBe(true);
  });

  it('a caught Dog with incomplete research reveals nothing', () => {
    const gve = projectWonderlandChase({
      backingLoopId: 'l',
      backingLoopState: 'budget_exhausted',
      dogCaught: true,
      recommendations: [cited],
      missionRequests: [{ requestId: 'req_1', objective: 'do the thing', evidenceIds: ['ev_1'] }],
    });
    expect(gve.phase).toBe('captured');
    // The honest outcome rather than the satisfying one.
    expect(gve.recommendations).toEqual([]);
    expect(gve.missionRequests).toEqual([]);
    expect(gve.captureBlockedReason).toContain('budget_exhausted');
    expect(JSON.stringify(gve)).not.toContain(SECRET_HEADLINE);
  });

  it('resolves and reveals when the Dog is caught and the research completed', () => {
    const gve = projectWonderlandChase({
      backingLoopId: 'loop_9',
      backingLoopState: 'completed',
      dogCaught: true,
      recommendations: [cited, { ...cited, recommendationId: 'rec_2', evidenceIds: [] }],
      missionRequests: [{ requestId: 'req_1', objective: 'do the thing', evidenceIds: ['ev_1'] }],
    });
    expect(gve.phase).toBe('resolved');
    expect(gve.backingLoopId).toBe('loop_9');
    expect(gve.recommendations).toHaveLength(2);
    expect(gve.recommendations[0].withheld).toBe(false);
    // Withholding still applies inside a resolved chase.
    expect(gve.recommendations[1].withheld).toBe(true);
    expect(gve.missionRequests).toHaveLength(1);
  });

  it('an abandoned chase outranks every machine state', () => {
    const gve = projectWonderlandChase({
      backingLoopId: 'l', backingLoopState: 'completed', dogCaught: true, abandoned: true,
      recommendations: [cited],
    });
    expect(gve.phase).toBe('abandoned');
    expect(gve.recommendations).toEqual([]);
  });
});

/* -------------------------------------------------------------- authority */

describe('Wonderland requests missions and never decides them', () => {
  it('stamps relay_decides, whatever the caller supplied', () => {
    const request = projectWonderlandMissionRequest({
      requestId: 'req_1',
      objective: 'Split the auth middleware',
      evidenceIds: ['ev_1'],
    });
    expect(request.authority).toBe(WONDERLAND_REQUEST_AUTHORITY);
    expect(request.authority).toBe('relay_decides');
    expect(request.sourceGveId).toBe(RUNAWAY_DOG_GVE_ID);
  });

  it('has no field that could express an approval', () => {
    // The authority boundary is the ABSENCE of a shape. If an `approved`,
    // `authorized` or `decision` key ever appears here, Wonderland has started
    // deciding.
    const request = projectWonderlandMissionRequest({
      requestId: 'r', objective: 'o', evidenceIds: [],
    });
    for (const key of Object.keys(request)) {
      expect(key).not.toMatch(/approv|authoriz|decision|granted/i);
    }
  });
});
