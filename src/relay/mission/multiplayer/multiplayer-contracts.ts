/**
 * WONDERLAND MULTIPLAYER — the smallest serious slice.
 *
 * This is NOT the final MMO infrastructure and does not pretend to be. It is the
 * smallest thing that makes Wonderland genuinely multiplayer: a session several
 * people can be in at once, where each can see the others move, and where NOBODY
 * can touch anybody else's work.
 *
 * THE DISTINCTION THIS MODULE EXISTS TO ENFORCE:
 *
 *   REPLICATION    what a peer may SEE. A position, a name, a connection state.
 *   AUTHORIZATION  what a peer may CHANGE. Their own things, and nothing else.
 *
 * Confusing the two is the single most damaging bug available here, because it
 * does not look like a bug — it looks like a feature that works. So the two are
 * not merely documented apart, they are STRUCTURALLY apart: the replicated view
 * is built by naming the shared fields explicitly (`SHARED_PARTICIPANT_FIELDS`),
 * never by removing private ones from a full record. A field added to the
 * participant record is therefore private by default and becomes visible only
 * when somebody adds its name to that list — which is a line a reviewer sees.
 *
 * PURE. No sockets, no clock, no transport. The existing Wonderland presence
 * table and SSE fan-out are the transport this binds to; nothing here reimplements
 * them.
 */

/* ------------------------------------------------------------- versioning */

export const WONDERLAND_SESSION_SCHEMA_V1 = 'relay-wonderland-session.v1' as const;
export const WONDERLAND_SESSION_SCHEMA_VERSION = WONDERLAND_SESSION_SCHEMA_V1;
export const SUPPORTED_WONDERLAND_SESSION_SCHEMA_VERSIONS = [
  WONDERLAND_SESSION_SCHEMA_V1,
] as const;
export type WonderlandSessionSchemaVersion =
  (typeof SUPPORTED_WONDERLAND_SESSION_SCHEMA_VERSIONS)[number];

/* ------------------------------------------------------------ vocabularies */

/**
 * `OPEN` accepts joins, `SEALED` holds its current participants and admits no
 * new ones, `CLOSED` is over. Sealing exists so a host can stop admitting people
 * without ejecting the ones already present.
 */
export const WONDERLAND_SESSION_STATUSES = ['OPEN', 'SEALED', 'CLOSED'] as const;
export type WonderlandSessionStatus = (typeof WONDERLAND_SESSION_STATUSES)[number];

/**
 * A DISCONNECTION IS NOT A DEPARTURE.
 *
 * `RECONNECTING` is a real state and is kept distinct from `DISCONNECTED`
 * deliberately: a player whose network dropped has not left, their slot is still
 * theirs, and showing them as gone would be the same class of untruth as
 * reporting a disconnection as a completion. Only an explicit leave, or the
 * expiry of the reconnect window, ends participation.
 */
export const WONDERLAND_CONNECTION_STATES = ['CONNECTED', 'RECONNECTING', 'DISCONNECTED'] as const;
export type WonderlandConnectionState = (typeof WONDERLAND_CONNECTION_STATES)[number];

/** A private-beta session is small on purpose. This is not a shard. */
export const WONDERLAND_SESSION_MAX_PARTICIPANTS = 8;

/** How long a dropped player keeps their slot before the session releases it. */
export const WONDERLAND_RECONNECT_WINDOW_MS = 120_000;

/* -------------------------------------------------------------- transform */

/**
 * Where a player is. Replicated, and the only thing about a body that is.
 *
 * Numbers rather than a vector class because this crosses a wire and a C++
 * boundary; `yawDegrees` alone rather than a full rotation because the beta
 * replicates a standing body's facing, and claiming to replicate pitch and roll
 * that nothing produces would be a contract that lies.
 */
export interface WonderlandTransform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yawDegrees: number;
}

export const WONDERLAND_ORIGIN_TRANSFORM: WonderlandTransform = Object.freeze({
  x: 0, y: 0, z: 0, yawDegrees: 0,
});

/* ------------------------------------------------------------ participant */

/**
 * ONE PLAYER IN A SESSION.
 *
 * Everything here that is not in `SHARED_PARTICIPANT_FIELDS` is private to that
 * player. The record deliberately holds NO project, NO mission, NO creation, NO
 * wallet and NO account state — those live in their own stores behind their own
 * authorization, and a copy here would be a second, unguarded path to them.
 * `multiplayer.test.ts` asserts that absence, so a convenience field cannot be
 * added later without the test objecting.
 */
export interface WonderlandParticipant {
  /** The persistent Wonderland account. Never a device, never a socket id. */
  readonly userId: string;
  readonly displayName: string;
  readonly connection: WonderlandConnectionState;
  readonly transform: WonderlandTransform;
  readonly joinedAtIso: string;
  readonly lastSeenAtIso: string;
  /** Set while RECONNECTING. The instant the slot is released if they do not return. */
  readonly reconnectDeadlineIso: string | null;
  /** True for the account that created the session. */
  readonly isHost: boolean;
}

/**
 * THE ALLOWLIST. What a peer may see of another participant.
 *
 * This is an ALLOWLIST and not a denylist, and that choice is the whole
 * protection: a new field on `WonderlandParticipant` is invisible to peers until
 * somebody adds it here on purpose. A denylist would leak every field anybody
 * forgot to add to it, and the failure would be silent.
 */
export const SHARED_PARTICIPANT_FIELDS = [
  'userId',
  'displayName',
  'connection',
  'transform',
  'isHost',
] as const;
export type SharedParticipantField = (typeof SHARED_PARTICIPANT_FIELDS)[number];

/** Exactly the shared fields, as a type. A peer sees this and nothing more. */
export type WonderlandParticipantView = Pick<WonderlandParticipant, SharedParticipantField>;

/* ---------------------------------------------------------------- session */

export interface WonderlandSession {
  readonly schemaVersion: WonderlandSessionSchemaVersion;
  readonly sessionId: string;
  readonly hostUserId: string;
  /**
   * THE INVITE MECHANISM, kept as simple as it can be: a short code a host reads
   * aloud. Not a social graph, not a friends list, not an email. It is the
   * simplest reliable way to get several testers into one world, which is all
   * the private beta needs.
   */
  readonly joinCode: string;
  readonly name: string;
  readonly status: WonderlandSessionStatus;
  readonly participants: readonly WonderlandParticipant[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly checksum: string;
}

export type WonderlandSessionDraft = Omit<WonderlandSession, 'checksum'>;

/** What a viewer receives. The session, with every participant reduced. */
export interface WonderlandSessionView {
  readonly sessionId: string;
  readonly name: string;
  readonly status: WonderlandSessionStatus;
  readonly viewerUserId: string;
  readonly participants: readonly WonderlandParticipantView[];
  readonly revision: number;
  /** Present ONLY for the host — the code is an invite capability. */
  readonly joinCode: string | null;
}

/* ---------------------------------------------------- what is never shared */

/**
 * THE THINGS A SESSION MUST NEVER CARRY, named so a test can look for them.
 *
 * Replication is a firehose pointed at other people's screens. Anything on this
 * list that ended up inside a session record would be replicated to every peer
 * the moment somebody built a view of it, so the rule is that they are not in
 * the record at all — not merely filtered on the way out.
 */
export const NEVER_REPLICATED_CONCERNS = [
  'missionContract',
  'agentConfig',
  'projectFiles',
  'creationSource',
  'walletBalance',
  'spendingPolicy',
  'accountCredentials',
  'sessionToken',
  'brainRef',
] as const;
