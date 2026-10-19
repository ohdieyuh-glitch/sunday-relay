import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import {
  SHARED_PARTICIPANT_FIELDS,
  WONDERLAND_ORIGIN_TRANSFORM,
  WONDERLAND_RECONNECT_WINDOW_MS,
  WONDERLAND_SESSION_MAX_PARTICIPANTS,
  WONDERLAND_SESSION_SCHEMA_VERSION,
  type WonderlandParticipant,
  type WonderlandParticipantView,
  type WonderlandSessionDraft,
  type WonderlandSessionView,
  type WonderlandTransform,
} from './multiplayer-contracts';

/**
 * SESSION LIFECYCLE AND AUTHORITY.
 *
 * Create, join, leave, reconnect — and the rule that a participant may act on
 * themselves and on nobody else. Pure and total; time is an injected ISO string.
 *
 * EVERY MUTATION NAMES ITS ACTOR, and the actor is checked before the mutation.
 * There is no function here that moves a player without being told who is doing
 * the moving, because that function is the one a surface would eventually call
 * with the wrong id.
 */

/* --------------------------------------------------------------- helpers */

function bump(session: WonderlandSessionDraft, atIso: string): WonderlandSessionDraft {
  return { ...session, updatedAt: atIso, version: session.version + 1 };
}

const find = (session: WonderlandSessionDraft, userId: string): WonderlandParticipant | undefined =>
  session.participants.find((participant) => participant.userId === userId);

/**
 * A join code a person can read aloud without ambiguity.
 *
 * Deterministic from the session id, so it survives a restart without a second
 * store. The alphabet omits I, O, 0 and 1 — a code that is going to be spoken or
 * retyped should not contain characters people confuse.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function joinCodeFor(sessionId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sessionId.length; i++) {
    hash = Math.imul(hash ^ sessionId.charCodeAt(i), 0x01000193) >>> 0;
  }
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[hash % CODE_ALPHABET.length];
    hash = Math.imul(hash ^ (hash >>> 7), 0x01000193) >>> 0;
  }
  return code;
}

/* ---------------------------------------------------------------- create */

export function createWonderlandSession(input: {
  readonly sessionId: string;
  readonly hostUserId: string;
  readonly hostDisplayName: string;
  readonly name: string;
  readonly createdAtIso: string;
}): RelayResult<WonderlandSessionDraft> {
  if (input.sessionId.trim() === '') {
    return fail(relayError('validation-failed', 'A session needs an id.'));
  }
  if (input.hostUserId.trim() === '') {
    return fail(relayError('validation-failed', 'A session must name the account hosting it.'));
  }
  return ok({
    schemaVersion: WONDERLAND_SESSION_SCHEMA_VERSION,
    sessionId: input.sessionId,
    hostUserId: input.hostUserId,
    joinCode: joinCodeFor(input.sessionId),
    name: input.name.trim() === '' ? 'Wonderland' : input.name.trim(),
    status: 'OPEN',
    participants: [
      {
        userId: input.hostUserId,
        displayName: input.hostDisplayName,
        connection: 'CONNECTED',
        transform: WONDERLAND_ORIGIN_TRANSFORM,
        joinedAtIso: input.createdAtIso,
        lastSeenAtIso: input.createdAtIso,
        reconnectDeadlineIso: null,
        isHost: true,
      },
    ],
    createdAt: input.createdAtIso,
    updatedAt: input.createdAtIso,
    version: 1,
  });
}

/* ------------------------------------------------------------------ join */

export function joinWonderlandSession(
  session: WonderlandSessionDraft,
  input: {
    readonly userId: string;
    readonly displayName: string;
    readonly joinCode: string;
    readonly atIso: string;
  },
): RelayResult<WonderlandSessionDraft> {
  if (session.status === 'CLOSED') {
    return fail(relayError('illegal-transition', 'This session is over.'));
  }
  if (session.status === 'SEALED') {
    return fail(relayError('permission-denied', 'This session is no longer admitting players.'));
  }
  // The code is the invite capability. A session id alone is not enough, or
  // anybody who saw an id in a log could walk in.
  if (input.joinCode !== session.joinCode) {
    return fail(relayError('permission-denied', 'That join code does not match this session.'));
  }
  const existing = find(session, input.userId);
  if (existing !== undefined) {
    // Already here. Joining twice is a reconnect, not a second body.
    return reconnectToWonderlandSession(session, input.userId, input.atIso);
  }
  if (session.participants.length >= WONDERLAND_SESSION_MAX_PARTICIPANTS) {
    return fail(relayError('validation-failed', 'This session is full.'));
  }
  return ok(
    bump(
      {
        ...session,
        participants: [
          ...session.participants,
          {
            userId: input.userId,
            displayName: input.displayName,
            connection: 'CONNECTED',
            transform: WONDERLAND_ORIGIN_TRANSFORM,
            joinedAtIso: input.atIso,
            lastSeenAtIso: input.atIso,
            reconnectDeadlineIso: null,
            isHost: false,
          },
        ],
      },
      input.atIso,
    ),
  );
}

/* ----------------------------------------------------------------- leave */

/**
 * An explicit departure. Only the participant themselves, or the host, may do
 * it — and a host removing somebody is a different act from that person leaving,
 * so the caller is checked rather than assumed.
 */
export function leaveWonderlandSession(
  session: WonderlandSessionDraft,
  actorUserId: string,
  targetUserId: string,
  atIso: string,
): RelayResult<WonderlandSessionDraft> {
  if (actorUserId !== targetUserId && actorUserId !== session.hostUserId) {
    return fail(
      relayError('permission-denied', 'Only the player themselves, or the host, may remove them.', {
        entityIds: { sessionId: session.sessionId, actorUserId, targetUserId },
      }),
    );
  }
  if (find(session, targetUserId) === undefined) {
    return fail(relayError('not-found', 'That account is not in this session.'));
  }
  const participants = session.participants.filter((p) => p.userId !== targetUserId);
  // The host leaving ends the session rather than orphaning it. A beta session
  // with no host has nobody who can seal or close it.
  const status = targetUserId === session.hostUserId ? 'CLOSED' as const : session.status;
  return ok(bump({ ...session, participants, status }, atIso));
}

/* ------------------------------------------------------ connection states */

/** The network dropped. The slot is HELD — this is not a departure. */
export function markWonderlandDisconnected(
  session: WonderlandSessionDraft,
  userId: string,
  atIso: string,
): RelayResult<WonderlandSessionDraft> {
  const participant = find(session, userId);
  if (participant === undefined) {
    return fail(relayError('not-found', 'That account is not in this session.'));
  }
  const deadline = new Date(Date.parse(atIso) + WONDERLAND_RECONNECT_WINDOW_MS).toISOString();
  return ok(
    bump(
      {
        ...session,
        participants: session.participants.map((p) =>
          p.userId === userId
            ? { ...p, connection: 'RECONNECTING' as const, reconnectDeadlineIso: deadline }
            : p,
        ),
      },
      atIso,
    ),
  );
}

/**
 * They came back.
 *
 * The participant's identity, host flag and transform are UNCHANGED — a
 * reconnect restores a player to where they were and to what they were. It does
 * not re-derive their authority from the reconnect request, which is what would
 * let a reconnect be used to claim somebody else's standing.
 */
export function reconnectToWonderlandSession(
  session: WonderlandSessionDraft,
  userId: string,
  atIso: string,
): RelayResult<WonderlandSessionDraft> {
  const participant = find(session, userId);
  if (participant === undefined) {
    return fail(relayError('not-found', 'That account has no slot in this session.'));
  }
  if (session.status === 'CLOSED') {
    return fail(relayError('illegal-transition', 'This session is over.'));
  }
  if (
    participant.reconnectDeadlineIso !== null &&
    Date.parse(atIso) > Date.parse(participant.reconnectDeadlineIso)
  ) {
    return fail(
      relayError('validation-failed', 'The reconnect window for this slot has passed.', {
        entityIds: { sessionId: session.sessionId, userId },
      }),
    );
  }
  return ok(
    bump(
      {
        ...session,
        participants: session.participants.map((p) =>
          p.userId === userId
            ? { ...p, connection: 'CONNECTED' as const, reconnectDeadlineIso: null, lastSeenAtIso: atIso }
            : p,
        ),
      },
      atIso,
    ),
  );
}

/** Release slots whose reconnect window has expired. Never called implicitly. */
export function expireWonderlandReconnects(
  session: WonderlandSessionDraft,
  atIso: string,
): WonderlandSessionDraft {
  const now = Date.parse(atIso);
  const participants = session.participants.filter(
    (p) => p.reconnectDeadlineIso === null || now <= Date.parse(p.reconnectDeadlineIso),
  );
  return participants.length === session.participants.length
    ? session
    : bump({ ...session, participants }, atIso);
}

/* ------------------------------------------------------------- movement */

/**
 * MOVE. The one mutation a peer performs constantly, and therefore the one most
 * worth getting right: a player may move THEMSELVES.
 *
 * There is no host override and no admin move. Moving another player's body is
 * not a capability this system has, which is a stronger guarantee than a check
 * that could be bypassed by a future caller passing the wrong id.
 */
export function moveWonderlandParticipant(
  session: WonderlandSessionDraft,
  actorUserId: string,
  transform: WonderlandTransform,
  atIso: string,
): RelayResult<WonderlandSessionDraft> {
  const participant = find(session, actorUserId);
  if (participant === undefined) {
    return fail(relayError('permission-denied', 'Only a participant may move in this session.'));
  }
  if (![transform.x, transform.y, transform.z, transform.yawDegrees].every(Number.isFinite)) {
    return fail(relayError('validation-failed', 'A transform must be finite.'));
  }
  return ok(
    bump(
      {
        ...session,
        participants: session.participants.map((p) =>
          p.userId === actorUserId ? { ...p, transform, lastSeenAtIso: atIso } : p,
        ),
      },
      atIso,
    ),
  );
}

/* ---------------------------------------------------------------- sealing */

export function sealWonderlandSessionToJoins(
  session: WonderlandSessionDraft,
  actorUserId: string,
  atIso: string,
): RelayResult<WonderlandSessionDraft> {
  if (actorUserId !== session.hostUserId) {
    return fail(relayError('permission-denied', 'Only the host may seal this session.'));
  }
  return ok(bump({ ...session, status: 'SEALED' }, atIso));
}

export function closeWonderlandSession(
  session: WonderlandSessionDraft,
  actorUserId: string,
  atIso: string,
): RelayResult<WonderlandSessionDraft> {
  if (actorUserId !== session.hostUserId) {
    return fail(relayError('permission-denied', 'Only the host may close this session.'));
  }
  return ok(bump({ ...session, status: 'CLOSED' }, atIso));
}

/* ------------------------------------------------------------ the view */

/**
 * BUILD WHAT A PEER SEES — by naming the shared fields, never by removing
 * private ones.
 *
 * This function is the entire replication boundary. It constructs a new object
 * from `SHARED_PARTICIPANT_FIELDS` rather than spreading a participant and
 * deleting keys, so a field added to the participant record is invisible here
 * until somebody adds its name to that list. The difference matters: a spread
 * with deletions leaks anything the deleter forgot, and it fails silently.
 */
export function viewParticipant(participant: WonderlandParticipant): WonderlandParticipantView {
  const view = {} as Record<string, unknown>;
  for (const field of SHARED_PARTICIPANT_FIELDS) {
    view[field] = participant[field];
  }
  return view as unknown as WonderlandParticipantView;
}

/**
 * The session as ONE viewer may see it.
 *
 * `joinCode` is withheld from everyone but the host, because the code is an
 * invite capability: handing it to every participant would make any guest able
 * to invite, which is not what a host granted when they let somebody in.
 */
export function viewWonderlandSession(
  session: WonderlandSessionDraft,
  viewerUserId: string,
): RelayResult<WonderlandSessionView> {
  if (find(session, viewerUserId) === undefined) {
    return fail(
      relayError('permission-denied', 'Only a participant may observe this session.', {
        entityIds: { sessionId: session.sessionId, viewerUserId },
      }),
    );
  }
  return ok({
    sessionId: session.sessionId,
    name: session.name,
    status: session.status,
    viewerUserId,
    participants: session.participants.map(viewParticipant),
    revision: session.version,
    joinCode: viewerUserId === session.hostUserId ? session.joinCode : null,
  });
}

/* --------------------------------------------------- cross-user authority */

/**
 * THE ADVERSARIAL QUESTION, answered in one place.
 *
 * Being in a session with somebody grants co-presence and NOTHING else. This
 * function exists so that every surface asking "may A touch B's thing?" gets the
 * same answer, and so the answer is testable on its own.
 *
 * It takes no resource type on purpose: there is no resource for which the
 * answer is yes. A future shared-project model will widen this HERE, once,
 * rather than at each call site.
 */
export function mayActOnBehalfOf(
  session: WonderlandSessionDraft,
  actorUserId: string,
  targetUserId: string,
): boolean {
  if (actorUserId === targetUserId) return true;
  void session;
  // Co-presence is not authority. Not for the host either: hosting a world is
  // not owning the people in it.
  return false;
}
