/**
 * THE BRIDGE SESSION — one world's connection to Relay, and what survives losing it.
 *
 * The link folds events. The authority holds usage. Neither of them knows
 * whether the connection is up, and that turns out to be the fact a world needs
 * most: everything in this file exists to keep "we lost contact" from being
 * mistaken for "nothing is happening", which is the same class of untruth as an
 * unreported meter rendering as empty.
 *
 * THE VOCABULARY IS UNREAL'S OWN, AND IT ALREADY EXISTED. `EWonderlandLinkState`
 * has been in `WonderlandTypes.h` since the world module was written, carrying a
 * comment that reads:
 *
 *     "Relay does not model the client's socket, so there is nothing here to
 *      mirror and the parity test records this enum as C++-only."
 *
 * That stopped being true when this file was written. So the enum moves out of
 * the C++-only allowlist and into the parity table, and these six states are its
 * six states — rather than a seventh vocabulary meaning almost the same thing.
 * Its own comment already states the rule the rest of this module implements:
 * a stale link KEEPS the last snapshot and dims, because "we lost contact 40
 * seconds ago" is more useful than an empty scene.
 *
 * `stale` covers both "retrying" and "given up", deliberately. What the world
 * shows is identical — the last known state, dimmed, with an explanation — and
 * the retry count is a NUMBER beside the state rather than a state of its own.
 * Splitting them would have produced two states nothing renders differently.
 *
 * NOT TO BE CONFUSED WITH `ConnectionState` in `mission/terminal`, which is the
 * LIVE TERMINAL's own OFFLINE/RECONNECTING/LIVE. Different surface, different
 * subject, and the two are deliberately not merged: a world can be connected
 * while a terminal is not.
 *
 * WHAT A DISCONNECTION MAY NEVER DO:
 *
 *   change what Julius is shown to be doing
 *   set `terminal`
 *   clear the usage figures
 *   move the replay cursor
 *
 * All four are tested. A dropped socket is a fact about the wire and about
 * nothing else, and every one of those four would let it become a fact about
 * the mission.
 *
 * PURE. No socket, no timer, no clock — every instant is injected, and the
 * backoff schedule is a function of the attempt count rather than of elapsed
 * real time.
 */

import { exactKeys } from './wonderland-contracts';
import type { WonderlandEvent } from './wonderland-backend';
import { applyJuliusEvent, emptyJuliusEmbodiment } from './wonderland-julius-state';
import type { JuliusEmbodiment } from './wonderland-julius-state';
import {
  applyWonderlandUsageReport,
  emptyWonderlandUsageAuthority,
  projectWonderlandUsageFromAuthority,
} from './wonderland-usage-authority';
import type {
  WonderlandUsageAuthorityProjection,
  WonderlandUsageAuthorityState,
  WonderlandUsageReport,
} from './wonderland-usage-authority';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_BRIDGE_SCHEMA_V1 = 'relay-wonderland-bridge.v1' as const;
export type WonderlandBridgeSchemaVersion = typeof WONDERLAND_BRIDGE_SCHEMA_V1;

/* ------------------------------------------------------------ link state */

/**
 * Mirrors `EWonderlandLinkState`, member for member.
 *
 * `never_connected` is ordinal 0 because the C++ struct zero-fills: a
 * default-constructed link must say it has never been up, never that it is live.
 */
export const WONDERLAND_LINK_STATES = [
  'never_connected',
  'pairing',
  'live',
  'stale',
  'session_expired',
  'refused',
] as const;
export type WonderlandLinkState = (typeof WONDERLAND_LINK_STATES)[number];

/** True while the link may still deliver events without a new grant. */
export const wonderlandLinkIsRecoverable = (state: WonderlandLinkState): boolean =>
  state !== 'session_expired' && state !== 'refused';

/** True when the world should DIM rather than blank: contact was had, and lost. */
export const wonderlandLinkIsDimmed = (state: WonderlandLinkState): boolean =>
  state === 'stale' || state === 'session_expired' || state === 'refused';

/**
 * Mirrors `FWonderlandLinkStatus`.
 *
 * `explanation` is never null — the C++ field is a bare `FString` and its own
 * comment is "Always a sentence. A dimmed world has to be able to say why it is
 * dimmed." A never-connected link explains that too.
 */
export interface WonderlandLinkStatus {
  readonly state: WonderlandLinkState;
  /** When the last event was accepted. Null until one has been. */
  readonly lastSnapshotAtIso: string | null;
  readonly explanation: string;
}

export const WONDERLAND_LINK_STATUS_FIELDS = exactKeys<WonderlandLinkStatus>()([
  'state',
  'lastSnapshotAtIso',
  'explanation',
] as const);

/** The sentence for each state a client reaches without being told a reason. */
export const WONDERLAND_LINK_EXPLANATIONS: Readonly<Record<WonderlandLinkState, string>> =
  Object.freeze({
    never_connected: 'This world has not connected to Relay yet.',
    pairing: 'Connecting to Relay.',
    live: 'Connected to Relay.',
    stale: 'Contact with Relay was lost. The world is showing the last state it received.',
    session_expired: 'This world session expired. Pair again to reconnect.',
    refused: 'Relay refused this connection.',
  });

/* --------------------------------------------------------------- backoff */

/**
 * How long to wait before attempt N, as a pure function of N.
 *
 * A function rather than a timer because the schedule is the part worth
 * testing and the sleeping is not. Exponential from a second, capped at thirty:
 * uncapped doubling reaches hours, and a world that gave up for an hour after a
 * blip would look identical to one that had crashed.
 *
 * NO JITTER, and that is a real limitation rather than an oversight. Jitter
 * needs a random source, this module has none by design, and a caller that
 * wants it should add it around this schedule — where the randomness is
 * visible — rather than inside a function whose whole value is being
 * predictable.
 */
export const WONDERLAND_RECONNECT_BASE_MS = 1_000;
export const WONDERLAND_RECONNECT_CEILING_MS = 30_000;

export function wonderlandReconnectDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return WONDERLAND_RECONNECT_BASE_MS;
  const doubled = WONDERLAND_RECONNECT_BASE_MS * 2 ** (Math.floor(attempt) - 1);
  return Math.min(doubled, WONDERLAND_RECONNECT_CEILING_MS);
}

/* ------------------------------------------------------------ the session */

/**
 * WHO THIS WORLD IS WATCHING.
 *
 * A subscription names a project and, optionally, one mission inside it. Both
 * travel because both are enforced: the event reducer refuses another project
 * outright and skips another mission while advancing its cursor, and the usage
 * authority refuses another project's figures. A session for project A cannot
 * be made to animate project B by anything arriving on the wire.
 */
export interface WonderlandBridgeSubscription {
  readonly projectId: string;
  /** Null watches the project's whole stream rather than one mission. */
  readonly missionId: string | null;
  /** The Julius instance this world embodies, when the caller knows it. */
  readonly agentId: string | null;
}

export interface WonderlandBridgeSession {
  readonly schemaVersion: WonderlandBridgeSchemaVersion;
  readonly subscription: WonderlandBridgeSubscription;
  readonly link: WonderlandLinkStatus;
  readonly embodiment: JuliusEmbodiment;
  readonly usage: WonderlandUsageAuthorityState;
  /** How many times the link has been lost and not yet recovered. */
  readonly reconnectAttempts: number;
  /** Events accepted since the session opened, across all connections. */
  readonly eventsApplied: number;
}

export function openWonderlandBridge(input: {
  readonly projectId: string;
  readonly missionId?: string | null;
  readonly agentId?: string | null;
  readonly staleAfterSeconds?: number;
}): WonderlandBridgeSession {
  const subscription: WonderlandBridgeSubscription = Object.freeze({
    projectId: input.projectId,
    missionId: input.missionId ?? null,
    agentId: input.agentId ?? null,
  });
  return Object.freeze({
    schemaVersion: WONDERLAND_BRIDGE_SCHEMA_V1,
    subscription,
    link: Object.freeze({
      state: 'never_connected' as WonderlandLinkState,
      lastSnapshotAtIso: null,
      explanation: WONDERLAND_LINK_EXPLANATIONS.never_connected,
    }),
    embodiment: emptyJuliusEmbodiment({
      projectId: subscription.projectId,
      missionId: subscription.missionId,
      agentId: subscription.agentId,
    }),
    usage: emptyWonderlandUsageAuthority({
      projectId: subscription.projectId,
      staleAfterSeconds: input.staleAfterSeconds,
    }),
    reconnectAttempts: 0,
    eventsApplied: 0,
  });
}

/** Move the link, keeping everything the link does not own. */
function withLink(
  session: WonderlandBridgeSession,
  state: WonderlandLinkState,
  explanation: string,
  reconnectAttempts: number,
): WonderlandBridgeSession {
  return Object.freeze({
    ...session,
    link: Object.freeze({
      state,
      // The last snapshot instant SURVIVES every transition. It is the answer to
      // "how old is what I am looking at", which is the question a dimmed world
      // exists to let a viewer ask.
      lastSnapshotAtIso: session.link.lastSnapshotAtIso,
      explanation,
    }),
    reconnectAttempts,
  });
}

/** The client has begun connecting. */
export const wonderlandBridgePairing = (
  session: WonderlandBridgeSession,
): WonderlandBridgeSession =>
  withLink(session, 'pairing', WONDERLAND_LINK_EXPLANATIONS.pairing, session.reconnectAttempts);

/**
 * The stream is up.
 *
 * Resets the attempt counter, because the next loss starts its own backoff. It
 * does NOT touch the embodiment: connecting is not an event, and a world that
 * changed what Julius was doing because a socket opened would be reporting the
 * transport as the subject.
 */
export const wonderlandBridgeLive = (
  session: WonderlandBridgeSession,
): WonderlandBridgeSession =>
  withLink(session, 'live', WONDERLAND_LINK_EXPLANATIONS.live, 0);

/**
 * Contact was lost.
 *
 * The world keeps everything: the visual state, the usage figures, the cursor,
 * `terminal`. All that changes is that it now says so. A caller may supply its
 * own sentence — a network error's own words are more useful than a generic
 * one — and the default is used when it cannot.
 */
export function wonderlandBridgeLost(
  session: WonderlandBridgeSession,
  input: { readonly explanation?: string } = {},
): WonderlandBridgeSession {
  return withLink(
    session,
    'stale',
    input.explanation ?? WONDERLAND_LINK_EXPLANATIONS.stale,
    session.reconnectAttempts + 1,
  );
}

/**
 * The session's grant expired, or Relay refused it.
 *
 * Kept apart from `stale` because they are not recoverable by waiting: a
 * client that retried a refused connection on a backoff would retry forever,
 * and one that showed "reconnecting" for an expired grant would never tell the
 * founder the thing they have to do.
 */
export const wonderlandBridgeExpired = (
  session: WonderlandBridgeSession,
  explanation?: string,
): WonderlandBridgeSession =>
  withLink(
    session,
    'session_expired',
    explanation ?? WONDERLAND_LINK_EXPLANATIONS.session_expired,
    session.reconnectAttempts,
  );

export const wonderlandBridgeRefused = (
  session: WonderlandBridgeSession,
  explanation?: string,
): WonderlandBridgeSession =>
  withLink(
    session,
    'refused',
    explanation ?? WONDERLAND_LINK_EXPLANATIONS.refused,
    session.reconnectAttempts,
  );

/* -------------------------------------------------------------- ingestion */

/**
 * Fold one world event into the session.
 *
 * Accepted in ANY link state, including `stale`. A late delivery from a
 * connection the client has already given up on is still an ordered event about
 * the mission, and the reducer's own rules — foreign project, stale sequence,
 * foreign mission — are the ones that decide whether it counts. Refusing it
 * here for a reason about the wire would discard mission truth on transport
 * grounds.
 *
 * `lastSnapshotAtIso` moves only when the reducer actually ADVANCED. An event
 * the reducer rejected did not tell us anything about now.
 */
export function applyWonderlandBridgeEvent(
  session: WonderlandBridgeSession,
  event: WonderlandEvent,
): WonderlandBridgeSession {
  const embodiment = applyJuliusEvent(session.embodiment, event);
  const advanced = embodiment.sequence > session.embodiment.sequence;
  return Object.freeze({
    ...session,
    embodiment,
    eventsApplied: session.eventsApplied + (advanced ? 1 : 0),
    link: advanced
      ? Object.freeze({ ...session.link, lastSnapshotAtIso: event.timestamp })
      : session.link,
  });
}

/** Fold a usage report in. The authority's own refusals apply unchanged. */
export function applyWonderlandBridgeUsageReport(
  session: WonderlandBridgeSession,
  report: WonderlandUsageReport,
): WonderlandBridgeSession {
  return Object.freeze({ ...session, usage: applyWonderlandUsageReport(session.usage, report) });
}

/* ------------------------------------------------------------- rehydration */

/**
 * WHAT TO ASK FOR ON RECONNECT.
 *
 * The whole recovery design, and it is deliberately three fields rather than a
 * protocol: the events route already replays from a cursor, so resuming is
 * asking for the same subscription from the sequence the fold has actually
 * applied. Not the last sequence RECEIVED — the last one APPLIED — because an
 * event the reducer refused must be sent again if it turns out to have been
 * refused for a reason that has since changed.
 */
export interface WonderlandBridgeResumeRequest {
  readonly projectId: string;
  readonly missionId: string | null;
  /** Ask for everything strictly after this. 0 means from the beginning. */
  readonly cursor: number;
}

export const wonderlandBridgeResume = (
  session: WonderlandBridgeSession,
): WonderlandBridgeResumeRequest =>
  Object.freeze({
    projectId: session.subscription.projectId,
    missionId: session.subscription.missionId,
    cursor: session.embodiment.sequence,
  });

/**
 * Whether a full resynchronisation is needed rather than a replay.
 *
 * True when the world has observed a sequence gap it could not close. A gap is
 * accepted and counted by the reducer rather than refused — refusing would
 * strand the world on a stale state forever after one dropped delivery — but a
 * client that has seen one is holding a state assembled from an incomplete
 * stream, and the honest repair is to ask for the stream again from zero.
 *
 * It is a QUESTION, not an action. Nothing here re-requests anything: this
 * module has no transport, and a pure fold that quietly reset itself would be
 * the hardest kind of state loss to trace.
 */
export const wonderlandBridgeNeedsResync = (session: WonderlandBridgeSession): boolean =>
  session.embodiment.sequenceGapsObserved > 0;

/** A resume request that asks for the whole stream again. */
export const wonderlandBridgeFullResync = (
  session: WonderlandBridgeSession,
): WonderlandBridgeResumeRequest =>
  Object.freeze({
    projectId: session.subscription.projectId,
    missionId: session.subscription.missionId,
    cursor: 0,
  });

/**
 * Rebuild a session's world state from a replayed stream, keeping the link and
 * the subscription.
 *
 * This is what a caller does with the answer to `wonderlandBridgeFullResync`.
 * The usage authority is deliberately NOT reset: usage reports carry their own
 * revisions and are not part of the event stream, so discarding them because
 * the event stream had a gap would throw away a fact that never went missing.
 */
export function rehydrateWonderlandBridge(
  session: WonderlandBridgeSession,
  events: readonly WonderlandEvent[],
): WonderlandBridgeSession {
  const fresh = emptyJuliusEmbodiment({
    projectId: session.subscription.projectId,
    missionId: session.subscription.missionId,
    agentId: session.subscription.agentId,
  });
  const embodiment = events.reduce(applyJuliusEvent, fresh);
  return Object.freeze({
    ...session,
    embodiment,
    eventsApplied: session.eventsApplied,
    link: Object.freeze({
      ...session.link,
      lastSnapshotAtIso: embodiment.observedAtIso ?? session.link.lastSnapshotAtIso,
    }),
  });
}

/* ------------------------------------------------------------- projection */

export interface WonderlandBridgeView {
  readonly link: WonderlandLinkStatus;
  /** True when the world should dim rather than blank. */
  readonly dimmed: boolean;
  /** True when waiting will not help — a person has to act. */
  readonly needsOperator: boolean;
  readonly embodiment: JuliusEmbodiment;
  readonly usage: WonderlandUsageAuthorityProjection;
  readonly resume: WonderlandBridgeResumeRequest;
  readonly needsResync: boolean;
}

/**
 * Everything a surface needs, at an instant.
 *
 * The usage projection is computed HERE rather than held, because staleness is
 * a function of when you look. A session that has not received a report in ten
 * minutes is not stale in storage; it is stale when read.
 */
export function projectWonderlandBridge(
  session: WonderlandBridgeSession,
  atIso: string,
): WonderlandBridgeView {
  return {
    link: session.link,
    dimmed: wonderlandLinkIsDimmed(session.link.state),
    needsOperator: !wonderlandLinkIsRecoverable(session.link.state),
    embodiment: session.embodiment,
    usage: projectWonderlandUsageFromAuthority(session.usage, atIso),
    resume: wonderlandBridgeResume(session),
    needsResync: wonderlandBridgeNeedsResync(session),
  };
}
