import { describe, expect, it } from 'vitest';

import { WONDERLAND_EVENT_SCHEMA_VERSION } from './wonderland-backend';
import type { WonderlandEvent } from './wonderland-backend';
import {
  WONDERLAND_LINK_EXPLANATIONS,
  WONDERLAND_LINK_STATES,
  WONDERLAND_RECONNECT_BASE_MS,
  WONDERLAND_RECONNECT_CEILING_MS,
  applyWonderlandBridgeEvent,
  applyWonderlandBridgeUsageReport,
  openWonderlandBridge,
  projectWonderlandBridge,
  rehydrateWonderlandBridge,
  wonderlandBridgeExpired,
  wonderlandBridgeFullResync,
  wonderlandBridgeLive,
  wonderlandBridgeLost,
  wonderlandBridgeNeedsResync,
  wonderlandBridgePairing,
  wonderlandBridgeRefused,
  wonderlandBridgeResume,
  wonderlandLinkIsDimmed,
  wonderlandLinkIsRecoverable,
  wonderlandReconnectDelayMs,
} from './wonderland-bridge';
import { JULIUS_RUN_STATE_PAYLOAD_KEY } from './wonderland-julius-state';
import { WONDERLAND_USAGE_REPORT_SCHEMA_V1 } from './wonderland-usage-authority';
import type { WonderlandUsageReport } from './wonderland-usage-authority';

/**
 * THE BRIDGE SESSION.
 *
 * These prove that losing a connection is a fact about the wire and about
 * nothing else. Every event is constructed here; no socket is opened, and a
 * passing suite says the recovery design holds, not that anything has connected.
 */

const PROJECT = 'project-a';
const AT = '2026-09-07T10:00:00.000Z';

let seq = 0;
const event = (overrides: Partial<WonderlandEvent> = {}): WonderlandEvent => {
  seq += 1;
  return {
    eventId: `e-${seq}`,
    schemaVersion: WONDERLAND_EVENT_SCHEMA_VERSION,
    timestamp: AT,
    projectId: PROJECT,
    sessionId: null,
    playerId: null,
    agentId: null,
    missionId: null,
    battleId: null,
    eventType: 'mission.stage_changed',
    payload: {},
    visibility: 'OWNER',
    correlationId: 'c-1',
    causationId: null,
    sequence: seq,
    ...overrides,
  };
};

const runState = (state: string, overrides: Partial<WonderlandEvent> = {}) =>
  event({ payload: { [JULIUS_RUN_STATE_PAYLOAD_KEY]: state }, ...overrides });

const usageReport = (revision: number, current: number): WonderlandUsageReport => ({
  schemaVersion: WONDERLAND_USAGE_REPORT_SCHEMA_V1,
  projectId: PROJECT,
  revision,
  reportedAtIso: AT,
  authorityId: 'a1',
  unavailableReason: null,
  compoundAgent: {
    current, maximum: 480, reference: 480,
    tierId: 't3', tierLabel: 'III', unitLabel: 'WONDER',
  },
  singleAgent: {
    current: 60, maximum: 120, reference: 120,
    tierId: 't1', tierLabel: 'I', unitLabel: 'WONDER',
  },
});

const open = () => openWonderlandBridge({ projectId: PROJECT, missionId: 'm1' });

/* ------------------------------------------------------------ vocabulary */

describe('the link vocabulary is Unreal’s own', () => {
  it('mirrors EWonderlandLinkState, member for member', () => {
    expect([...WONDERLAND_LINK_STATES]).toEqual([
      'never_connected',
      'pairing',
      'live',
      'stale',
      'session_expired',
      'refused',
    ]);
  });

  it('starts never_connected, because a zero-filled link must not claim live', () => {
    expect(WONDERLAND_LINK_STATES[0]).toBe('never_connected');
    expect(open().link.state).toBe('never_connected');
  });

  it('always carries a sentence, in every state', () => {
    for (const state of WONDERLAND_LINK_STATES) {
      expect(WONDERLAND_LINK_EXPLANATIONS[state].length).toBeGreaterThan(10);
    }
    expect(open().link.explanation).toBe(WONDERLAND_LINK_EXPLANATIONS.never_connected);
  });

  it('separates "wait" from "a person must act"', () => {
    // A client that retried a refused connection would retry forever; one that
    // showed "reconnecting" for an expired grant would never tell the founder
    // the thing they have to do.
    expect(wonderlandLinkIsRecoverable('stale')).toBe(true);
    expect(wonderlandLinkIsRecoverable('session_expired')).toBe(false);
    expect(wonderlandLinkIsRecoverable('refused')).toBe(false);
  });

  it('dims once contact has been had and lost, and not before', () => {
    expect(wonderlandLinkIsDimmed('never_connected')).toBe(false);
    expect(wonderlandLinkIsDimmed('pairing')).toBe(false);
    expect(wonderlandLinkIsDimmed('live')).toBe(false);
    expect(wonderlandLinkIsDimmed('stale')).toBe(true);
  });
});

/* --------------------------------------------------------------- backoff */

describe('the reconnect schedule', () => {
  it('doubles from a second and stops at thirty', () => {
    expect(wonderlandReconnectDelayMs(1)).toBe(WONDERLAND_RECONNECT_BASE_MS);
    expect(wonderlandReconnectDelayMs(2)).toBe(2_000);
    expect(wonderlandReconnectDelayMs(5)).toBe(16_000);
    // Uncapped doubling reaches hours, and a world that gave up for an hour
    // after a blip would look identical to one that had crashed.
    expect(wonderlandReconnectDelayMs(20)).toBe(WONDERLAND_RECONNECT_CEILING_MS);
  });

  it('never returns a nonsense delay for a nonsense attempt', () => {
    for (const attempt of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const delay = wonderlandReconnectDelayMs(attempt);
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(WONDERLAND_RECONNECT_BASE_MS);
      expect(delay).toBeLessThanOrEqual(WONDERLAND_RECONNECT_CEILING_MS);
    }
  });

  it('counts attempts across losses and forgets them on success', () => {
    let session = wonderlandBridgeLive(wonderlandBridgePairing(open()));
    expect(session.reconnectAttempts).toBe(0);
    session = wonderlandBridgeLost(session);
    session = wonderlandBridgeLost(session);
    expect(session.reconnectAttempts).toBe(2);
    session = wonderlandBridgeLive(session);
    expect(session.reconnectAttempts).toBe(0);
  });
});

/* ------------------------------------------ a disconnection is not a fact */

describe('what a lost connection may never do', () => {
  const working = () => {
    let session = wonderlandBridgeLive(wonderlandBridgePairing(open()));
    session = applyWonderlandBridgeEvent(session, runState('EXECUTING', { missionId: 'm1' }));
    session = applyWonderlandBridgeUsageReport(session, usageReport(1, 300));
    return session;
  };

  it('never changes what Julius is shown to be doing', () => {
    const before = working();
    const after = wonderlandBridgeLost(before);
    expect(before.embodiment.visualState).toBe('coding');
    expect(after.embodiment.visualState).toBe('coding');
    expect(after.embodiment.animation).toBe(before.embodiment.animation);
  });

  it('never sets terminal', () => {
    const after = wonderlandBridgeLost(working());
    expect(after.embodiment.terminal).toBe(false);
  });

  it('never clears the usage figures', () => {
    const after = wonderlandBridgeLost(working());
    expect(projectWonderlandBridge(after, AT).usage.hud.compoundAgent.remainingUnits.value).toBe(
      300,
    );
  });

  it('never moves the replay cursor', () => {
    const before = working();
    const after = wonderlandBridgeLost(before);
    expect(wonderlandBridgeResume(after).cursor).toBe(wonderlandBridgeResume(before).cursor);
  });

  it('keeps the last snapshot instant through every transition', () => {
    // "How old is what I am looking at" is the question a dimmed world exists
    // to let a viewer ask.
    let session = working();
    const stamped = session.link.lastSnapshotAtIso;
    expect(stamped).not.toBeNull();
    for (const move of [wonderlandBridgeLost, wonderlandBridgePairing, wonderlandBridgeExpired]) {
      session = move(session);
      expect(session.link.lastSnapshotAtIso).toBe(stamped);
    }
  });

  it('says why, in words, whenever it dims', () => {
    const generic = wonderlandBridgeLost(working());
    expect(generic.link.explanation).toBe(WONDERLAND_LINK_EXPLANATIONS.stale);
    const specific = wonderlandBridgeLost(working(), {
      explanation: 'The stream closed after 40 seconds without a heartbeat.',
    });
    expect(specific.link.explanation).toContain('heartbeat');
  });

  it('does not treat connecting as an event either', () => {
    // A world that changed what Julius was doing because a socket opened would
    // be reporting the transport as the subject.
    const before = working();
    const after = wonderlandBridgeLive(wonderlandBridgePairing(wonderlandBridgeLost(before)));
    expect(after.embodiment).toEqual(before.embodiment);
  });
});

/* ------------------------------------------------------------- ingestion */

describe('folding events through the session', () => {
  it('accepts a late delivery even after the client gave up', () => {
    // A late event from a dead connection is still an ordered fact about the
    // mission. Refusing it for a reason about the wire discards mission truth.
    let session = wonderlandBridgeLost(wonderlandBridgeLive(open()));
    session = applyWonderlandBridgeEvent(session, runState('REVIEWING', { missionId: 'm1' }));
    expect(session.embodiment.visualState).toBe('independent_review');
    expect(session.link.state).toBe('stale');
  });

  it('stamps the snapshot instant only when the reducer actually advanced', () => {
    let session = wonderlandBridgeLive(open());
    const accepted = runState('EXECUTING', { missionId: 'm1', timestamp: '2026-09-07T11:00:00.000Z' });
    session = applyWonderlandBridgeEvent(session, accepted);
    expect(session.link.lastSnapshotAtIso).toBe('2026-09-07T11:00:00.000Z');

    // A duplicate the reducer refuses did not tell us anything about now.
    session = applyWonderlandBridgeEvent(session, {
      ...accepted,
      timestamp: '2026-09-07T12:00:00.000Z',
    });
    expect(session.link.lastSnapshotAtIso).toBe('2026-09-07T11:00:00.000Z');
    expect(session.eventsApplied).toBe(1);
  });

  it('refuses another project, on the wire as in the fold', () => {
    let session = wonderlandBridgeLive(open());
    session = applyWonderlandBridgeEvent(
      session,
      runState('COMPLETED', { projectId: 'project-b', missionId: 'm1' }),
    );
    expect(session.embodiment.visualState).toBeNull();
    expect(session.embodiment.terminal).toBe(false);
    expect(session.embodiment.foreignProjectEventsRejected).toBe(1);
  });

  it('refuses another project’s usage figures too', () => {
    const session = applyWonderlandBridgeUsageReport(open(), {
      ...usageReport(1, 5),
      projectId: 'project-b',
    });
    expect(session.usage.foreignProjectReportsRejected).toBe(1);
    expect(projectWonderlandBridge(session, AT).usage.status.reading).toBe('not_reported');
  });
});

/* ----------------------------------------------------------- rehydration */

describe('recovering after a lost stream', () => {
  const stream = (): readonly WonderlandEvent[] => {
    seq = 0;
    return [
      runState('PLANNING', { missionId: 'm1' }),
      runState('EXECUTING', { missionId: 'm1' }),
      event({ eventType: 'presence.updated' }),
      runState('REVIEWING', { missionId: 'm1' }),
    ];
  };

  it('asks for everything after what it actually APPLIED', () => {
    const events = stream();
    const session = events
      .slice(0, 2)
      .reduce(applyWonderlandBridgeEvent, wonderlandBridgeLive(open()));
    const request = wonderlandBridgeResume(session);
    expect(request.projectId).toBe(PROJECT);
    expect(request.missionId).toBe('m1');
    expect(request.cursor).toBe(session.embodiment.sequence);
  });

  it('reaches the state a session that never dropped would hold', () => {
    const events = stream();
    const uninterrupted = events.reduce(applyWonderlandBridgeEvent, wonderlandBridgeLive(open()));

    let dropped = events.slice(0, 2).reduce(applyWonderlandBridgeEvent, wonderlandBridgeLive(open()));
    dropped = wonderlandBridgeLost(dropped);
    const request = wonderlandBridgeResume(dropped);
    dropped = wonderlandBridgeLive(wonderlandBridgePairing(dropped));
    const recovered = events
      .filter((e) => e.sequence > request.cursor)
      .reduce(applyWonderlandBridgeEvent, dropped);

    expect(recovered.embodiment.visualState).toBe(uninterrupted.embodiment.visualState);
    expect(recovered.embodiment.sequence).toBe(uninterrupted.embodiment.sequence);
    expect(recovered.link.state).toBe('live');
  });

  it('survives the overlap a replay-then-subscribe stream produces', () => {
    const events = stream();
    const clean = events.reduce(applyWonderlandBridgeEvent, wonderlandBridgeLive(open()));
    const overlapped = [...events, ...events.slice(-2)].reduce(
      applyWonderlandBridgeEvent,
      wonderlandBridgeLive(open()),
    );
    expect(overlapped.embodiment.visualState).toBe(clean.embodiment.visualState);
    expect(overlapped.embodiment.sequence).toBe(clean.embodiment.sequence);
    expect(overlapped.eventsApplied).toBe(clean.eventsApplied);
  });

  it('asks for a full resync only after a gap it could not close', () => {
    const clean = stream().reduce(applyWonderlandBridgeEvent, wonderlandBridgeLive(open()));
    expect(wonderlandBridgeNeedsResync(clean)).toBe(false);

    seq = 40;
    const gapped = applyWonderlandBridgeEvent(clean, runState('COMPLETED', { missionId: 'm1' }));
    expect(wonderlandBridgeNeedsResync(gapped)).toBe(true);
    expect(wonderlandBridgeFullResync(gapped).cursor).toBe(0);
    expect(wonderlandBridgeFullResync(gapped).projectId).toBe(PROJECT);
  });

  it('rebuilds the world from a replay without discarding usage', () => {
    // Usage reports carry their own revisions and are not part of the event
    // stream. Throwing them away because the event stream had a gap would
    // discard a fact that never went missing.
    const withUsage = applyWonderlandBridgeUsageReport(
      wonderlandBridgeLive(open()),
      usageReport(3, 275),
    );
    const rebuilt = rehydrateWonderlandBridge(withUsage, stream());
    expect(rebuilt.embodiment.visualState).toBe('independent_review');
    expect(rebuilt.embodiment.sequenceGapsObserved).toBe(0);
    expect(projectWonderlandBridge(rebuilt, AT).usage.status.revision).toBe(3);
  });

  it('keeps the subscription through a rebuild', () => {
    const rebuilt = rehydrateWonderlandBridge(wonderlandBridgeLive(open()), stream());
    expect(rebuilt.subscription.projectId).toBe(PROJECT);
    expect(rebuilt.subscription.missionId).toBe('m1');
    expect(rebuilt.embodiment.projectId).toBe(PROJECT);
  });
});

/* ------------------------------------------------------------- the view */

describe('what a surface reads', () => {
  it('says dim, and says a person is needed, separately', () => {
    const live = projectWonderlandBridge(wonderlandBridgeLive(open()), AT);
    expect(live.dimmed).toBe(false);
    expect(live.needsOperator).toBe(false);

    const lost = projectWonderlandBridge(wonderlandBridgeLost(wonderlandBridgeLive(open())), AT);
    expect(lost.dimmed).toBe(true);
    expect(lost.needsOperator).toBe(false);

    const expired = projectWonderlandBridge(wonderlandBridgeExpired(wonderlandBridgeLive(open())), AT);
    expect(expired.dimmed).toBe(true);
    expect(expired.needsOperator).toBe(true);

    const refused = projectWonderlandBridge(wonderlandBridgeRefused(open()), AT);
    expect(refused.needsOperator).toBe(true);
  });

  it('computes staleness when READ, not when stored', () => {
    // A session that has not had a report in ten minutes is not stale in
    // storage; it is stale when someone looks.
    const session = applyWonderlandBridgeUsageReport(wonderlandBridgeLive(open()), usageReport(1, 300));
    expect(projectWonderlandBridge(session, AT).usage.status.reading).toBe('known');
    const later = new Date(Date.parse(AT) + 600_000).toISOString();
    expect(projectWonderlandBridge(session, later).usage.status.reading).toBe('stale');
  });

  it('hands a surface the resume request without it having to build one', () => {
    const session = applyWonderlandBridgeEvent(
      wonderlandBridgeLive(open()),
      runState('EXECUTING', { missionId: 'm1' }),
    );
    const view = projectWonderlandBridge(session, AT);
    expect(view.resume.cursor).toBe(session.embodiment.sequence);
    expect(view.needsResync).toBe(false);
  });
});
