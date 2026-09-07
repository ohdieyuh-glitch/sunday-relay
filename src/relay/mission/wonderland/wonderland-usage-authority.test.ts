import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_USAGE_DEFAULT_STALE_AFTER_SECONDS,
  WONDERLAND_USAGE_NOT_REPORTED_REASON,
  WONDERLAND_USAGE_READINGS,
  WONDERLAND_USAGE_READING_ZERO,
  WONDERLAND_USAGE_REPORT_SCHEMA_V1,
  WONDERLAND_USAGE_STALE_REASON,
  applyWonderlandUsageReport,
  emptyWonderlandUsageAuthority,
  projectWonderlandUsageFromAuthority,
  readWonderlandUsageAuthority,
  wonderlandUsageReadingHasFigures,
} from './wonderland-usage-authority';
import type {
  WonderlandUsageChannelReport,
  WonderlandUsageReport,
} from './wonderland-usage-authority';

/**
 * THE USAGE AUTHORITY.
 *
 * These prove the REFUSALS and the FRESHNESS. Every report below is built in
 * this file — no authority exists yet, and a passing suite here says the seam
 * is ready for one, not that one has ever spoken.
 */

const PROJECT = 'project-a';
const AT = '2026-09-07T10:00:00.000Z';

const channel = (
  overrides: Partial<WonderlandUsageChannelReport> = {},
): WonderlandUsageChannelReport => ({
  current: 300,
  maximum: 480,
  reference: 480,
  tierId: 'tier-3',
  tierLabel: 'TIER III',
  unitLabel: 'WONDER',
  ...overrides,
});

const report = (overrides: Partial<WonderlandUsageReport> = {}): WonderlandUsageReport => ({
  schemaVersion: WONDERLAND_USAGE_REPORT_SCHEMA_V1,
  projectId: PROJECT,
  revision: 1,
  reportedAtIso: AT,
  authorityId: 'authority-1',
  unavailableReason: null,
  compoundAgent: channel(),
  singleAgent: channel({ current: 40, maximum: 120, reference: 120, tierId: 'tier-1' }),
  ...overrides,
});

const held = (overrides: Partial<WonderlandUsageReport> = {}) =>
  applyWonderlandUsageReport(
    emptyWonderlandUsageAuthority({ projectId: PROJECT }),
    report(overrides),
  );

/* -------------------------------------------------------------- vocabulary */

describe('the reading vocabulary', () => {
  it('separates silence from refusal from staleness', () => {
    expect([...WONDERLAND_USAGE_READINGS]).toEqual([
      'not_reported',
      'known',
      'stale',
      'unavailable',
    ]);
  });

  it('defaults to not_reported, because a zero-filled reading must not claim known', () => {
    expect(WONDERLAND_USAGE_READING_ZERO).toBe('not_reported');
    expect(WONDERLAND_USAGE_READINGS[0]).toBe(WONDERLAND_USAGE_READING_ZERO);
  });

  it('carries figures for known and stale, and for neither of the others', () => {
    expect(wonderlandUsageReadingHasFigures('known')).toBe(true);
    expect(wonderlandUsageReadingHasFigures('stale')).toBe(true);
    expect(wonderlandUsageReadingHasFigures('not_reported')).toBe(false);
    expect(wonderlandUsageReadingHasFigures('unavailable')).toBe(false);
  });
});

/* --------------------------------------------------------------- refusals */

describe('what the authority refuses', () => {
  it('refuses another project entirely, and counts it', () => {
    // One player's capacity under another player's name is worse than none.
    const state = applyWonderlandUsageReport(
      held(),
      report({ projectId: 'project-b', revision: 99, compoundAgent: channel({ current: 1 }) }),
    );
    expect(state.foreignProjectReportsRejected).toBe(1);
    expect(state.revision).toBe(1);
    expect(state.report?.compoundAgent.current).toBe(300);
  });

  it('refuses a revision it has already passed, so a replay cannot walk it backwards', () => {
    const state = applyWonderlandUsageReport(held({ revision: 5 }), report({ revision: 5 }));
    expect(state.staleRevisionsRejected).toBe(1);
    const older = applyWonderlandUsageReport(state, report({ revision: 2 }));
    expect(older.staleRevisionsRejected).toBe(2);
    expect(older.revision).toBe(5);
  });

  it('refuses a report whose own shape disqualifies it', () => {
    const base = emptyWonderlandUsageAuthority({ projectId: PROJECT });
    for (const broken of [
      report({ schemaVersion: 'something-else' as never }),
      report({ revision: 0 }),
      report({ revision: 1.5 }),
      report({ reportedAtIso: '   ' }),
    ]) {
      const state = applyWonderlandUsageReport(base, broken);
      expect(state.malformedReportsRejected).toBe(1);
      expect(state.report).toBeNull();
    }
  });

  it('counts the three refusals separately, because they are three problems', () => {
    // A mis-routed fan-out, a schema drift and ordinary replay traffic are very
    // different things, and one counter would present them as one.
    let state = emptyWonderlandUsageAuthority({ projectId: PROJECT });
    state = applyWonderlandUsageReport(state, report({ revision: 3 }));
    state = applyWonderlandUsageReport(state, report({ projectId: 'other' }));
    state = applyWonderlandUsageReport(state, report({ revision: 0 }));
    state = applyWonderlandUsageReport(state, report({ revision: 2 }));
    expect(state.foreignProjectReportsRejected).toBe(1);
    expect(state.malformedReportsRejected).toBe(1);
    expect(state.staleRevisionsRejected).toBe(1);
    expect(state.revision).toBe(3);
  });

  it('mutates nothing — the state it was given still answers for itself', () => {
    const before = held();
    applyWonderlandUsageReport(before, report({ revision: 9, compoundAgent: channel({ current: 7 }) }));
    expect(before.revision).toBe(1);
    expect(before.report?.compoundAgent.current).toBe(300);
  });
});

/* -------------------------------------------------------------- freshness */

describe('how old a figure is allowed to be', () => {
  const at = (seconds: number): string =>
    new Date(Date.parse(AT) + seconds * 1000).toISOString();

  it('is known while it is inside the budget', () => {
    const resolved = readWonderlandUsageAuthority(held(), at(30));
    expect(resolved.reading).toBe('known');
    expect(resolved.reason).toBeNull();
    expect(resolved.ageSeconds).toBe(30);
  });

  it('goes stale past the budget, and KEEPS its numbers', () => {
    // A stale figure is information. Hiding it leaves a founder with nothing,
    // and showing it as current is the more expensive lie — so it is shown, and
    // labelled.
    const projection = projectWonderlandUsageFromAuthority(held(), at(600));
    expect(projection.status.reading).toBe('stale');
    expect(projection.status.reason).toBe(WONDERLAND_USAGE_STALE_REASON);
    expect(projection.hud.compoundAgent.remainingUnits.value).toBe(300);
    expect(projection.hud.compoundAgent.remainingFraction.known).toBe(true);
  });

  it('never lets a stale figure claim to be live', () => {
    expect(projectWonderlandUsageFromAuthority(held(), at(10)).hud.compoundAgent.provenance).toBe(
      'live',
    );
    const stale = projectWonderlandUsageFromAuthority(held(), at(600)).hud.compoundAgent;
    expect(stale.provenance).not.toBe('live');
    expect(stale.simulated).toBe(true);
  });

  it('treats an unreadable timestamp as stale, never as current', () => {
    // "I cannot tell how old this is" does not resolve to "it is current".
    const resolved = readWonderlandUsageAuthority(held({ reportedAtIso: 'not-a-time' }), AT);
    expect(resolved.reading).toBe('stale');
    expect(resolved.ageSeconds).toBeNull();
  });

  it('does not age a report from the future — clock skew is not expiry', () => {
    const resolved = readWonderlandUsageAuthority(held(), at(-5));
    expect(resolved.reading).toBe('known');
  });

  it('honours a deployment that knows its own cadence', () => {
    const tight = applyWonderlandUsageReport(
      emptyWonderlandUsageAuthority({ projectId: PROJECT, staleAfterSeconds: 5 }),
      report(),
    );
    expect(readWonderlandUsageAuthority(tight, at(3)).reading).toBe('known');
    expect(readWonderlandUsageAuthority(tight, at(9)).reading).toBe('stale');
    expect(emptyWonderlandUsageAuthority({ projectId: PROJECT }).staleAfterSeconds).toBe(
      WONDERLAND_USAGE_DEFAULT_STALE_AFTER_SECONDS,
    );
  });
});

/* ----------------------------------------------------------- the readings */

describe('what each reading renders', () => {
  it('says nothing has been reported, and shows no figures at all', () => {
    const projection = projectWonderlandUsageFromAuthority(
      emptyWonderlandUsageAuthority({ projectId: PROJECT }),
      AT,
    );
    expect(projection.status.reading).toBe('not_reported');
    expect(projection.status.reason).toBe(WONDERLAND_USAGE_NOT_REPORTED_REASON);
    expect(projection.status.revision).toBe(0);
    expect(projection.status.authorityId).toBeNull();
    for (const meter of [projection.hud.compoundAgent, projection.hud.singleAgent]) {
      expect(meter.remainingFraction.known).toBe(false);
      expect(meter.capacityUnits.known).toBe(false);
      expect(meter.status).toBe('unavailable');
    }
  });

  it('tells an authority that refuses apart from one that is silent', () => {
    // The system being there and unable to answer is a different fact from
    // nothing being there, and collapsing them hides a deployment mistake.
    const projection = projectWonderlandUsageFromAuthority(
      held({ unavailableReason: 'The metering service is not reachable from this region.' }),
      AT,
    );
    expect(projection.status.reading).toBe('unavailable');
    expect(projection.status.reason).toContain('not reachable');
    expect(projection.status.reason).not.toBe(WONDERLAND_USAGE_NOT_REPORTED_REASON);
    expect(projection.hud.compoundAgent.remainingFraction.known).toBe(false);
  });

  it('carries the identity of whoever said so', () => {
    const projection = projectWonderlandUsageFromAuthority(held({ revision: 7 }), AT);
    expect(projection.status.authorityId).toBe('authority-1');
    expect(projection.status.revision).toBe(7);
  });

  it('shows one channel when the authority only knows one', () => {
    // Forcing a zero for the channel it cannot see would be forcing it to lie.
    const projection = projectWonderlandUsageFromAuthority(
      held({ singleAgent: channel({ current: null, maximum: null, reference: null }) }),
      AT,
    );
    expect(projection.hud.compoundAgent.remainingUnits.value).toBe(300);
    expect(projection.hud.singleAgent.remainingUnits.known).toBe(false);
    expect(projection.hud.singleAgent.status).toBe('unavailable');
  });
});

/* --------------------------------------------------- current vs remaining */

describe('current is the REMAINDER, and the conversion happens once', () => {
  it('draws what is left, and the readout agrees with it', () => {
    // The bug this pins: `current` read as spend produced "480 / 480" beside an
    // empty bar. The conversion lives in one place so the two cannot disagree.
    const projection = projectWonderlandUsageFromAuthority(held(), AT);
    const meter = projection.hud.compoundAgent;
    expect(meter.remainingUnits.value).toBe(300);
    expect(meter.usedUnits.value).toBe(180);
    expect(meter.capacityUnits.value).toBe(480);
    expect(meter.remainingFraction.value).toBeCloseTo(300 / 480, 10);
  });

  it('draws a full meter for an untouched capacity', () => {
    const projection = projectWonderlandUsageFromAuthority(
      held({ compoundAgent: channel({ current: 480, maximum: 480 }) }),
      AT,
    );
    expect(projection.hud.compoundAgent.remainingFraction.value).toBe(1);
    expect(projection.hud.compoundAgent.usedUnits.value).toBe(0);
  });

  it('draws an empty meter for a spent one, and still never reads as unknown', () => {
    const projection = projectWonderlandUsageFromAuthority(
      held({ compoundAgent: channel({ current: 0, maximum: 480 }) }),
      AT,
    );
    expect(projection.hud.compoundAgent.remainingFraction.value).toBe(0);
    expect(projection.hud.compoundAgent.remainingFraction.known).toBe(true);
  });

  it('refuses to invent a remainder from half a report', () => {
    const projection = projectWonderlandUsageFromAuthority(
      held({ compoundAgent: channel({ current: 300, maximum: null }) }),
      AT,
    );
    expect(projection.hud.compoundAgent.remainingFraction.known).toBe(false);
  });
});

/* ----------------------------------------------------------- tier ladders */

describe('a tier changes the meter length, per channel', () => {
  it('gives each channel its own ceiling', () => {
    const projection = projectWonderlandUsageFromAuthority(held(), AT);
    // 480 of 480 for the frame, 120 of 120 for the stroke: each full-length in
    // its OWN ladder, rather than the stroke drawing a quarter bar because a
    // Compound Agent can buy more.
    expect(projection.hud.compoundAgent.capacitySpan.value).toBe(1);
    expect(projection.hud.singleAgent.capacitySpan.value).toBe(1);
  });

  it('draws a shorter meter for a smaller tier in the same ladder', () => {
    const small = projectWonderlandUsageFromAuthority(
      held({ compoundAgent: channel({ current: 120, maximum: 240, reference: 480 }) }),
      AT,
    );
    expect(small.hud.compoundAgent.capacitySpan.value).toBeCloseTo(0.5, 10);
    // Same spend, same absolute drained length, different percentage.
    expect(small.hud.compoundAgent.fillFraction.value).toBeCloseTo(0.5, 10);
  });

  it('holds no tier catalogue — the ceiling is whatever the authority said', () => {
    const projection = projectWonderlandUsageFromAuthority(
      held({ compoundAgent: channel({ tierId: 'a-plan-nobody-declared', maximum: 7, current: 3 }) }),
      AT,
    );
    expect(projection.hud.compoundAgent.tierId).toBe('a-plan-nobody-declared');
    expect(projection.hud.compoundAgent.capacityUnits.value).toBe(7);
  });
});

/* ----------------------------------------------------- identity isolation */

describe('project isolation', () => {
  it('never lets project B move project A HUD', () => {
    const a = held({ compoundAgent: channel({ current: 300 }) });
    const attacked = applyWonderlandUsageReport(
      a,
      report({ projectId: 'project-b', revision: 1000, compoundAgent: channel({ current: 0 }) }),
    );
    const projection = projectWonderlandUsageFromAuthority(attacked, AT);
    expect(projection.hud.compoundAgent.remainingUnits.value).toBe(300);
    expect(projection.status.revision).toBe(1);
  });

  it('keeps two projects entirely apart when the same stream feeds both', () => {
    const stream = [
      report({ projectId: 'project-a', revision: 1, compoundAgent: channel({ current: 400 }) }),
      report({ projectId: 'project-b', revision: 1, compoundAgent: channel({ current: 10 }) }),
      report({ projectId: 'project-a', revision: 2, compoundAgent: channel({ current: 380 }) }),
    ];
    const a = stream.reduce(
      applyWonderlandUsageReport,
      emptyWonderlandUsageAuthority({ projectId: 'project-a' }),
    );
    const b = stream.reduce(
      applyWonderlandUsageReport,
      emptyWonderlandUsageAuthority({ projectId: 'project-b' }),
    );
    expect(a.report?.compoundAgent.current).toBe(380);
    expect(b.report?.compoundAgent.current).toBe(10);
    expect(a.foreignProjectReportsRejected).toBe(1);
    expect(b.foreignProjectReportsRejected).toBe(2);
  });
});
