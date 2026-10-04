/**
 * WONDERLAND SOCIAL — THE VOCABULARY.
 *
 * Friends, blocks, parties, private servers, presence in a world instance,
 * Recent Players and direct messages: the hosted social layer the final RC
 * reaches over HTTPS. Relay is authoritative; the client requests and renders.
 *
 * THE PRIVACY WALL IS THE POINT OF THIS MODULE, and every rule of it is a
 * projection over one durable state (`wonderland-social-privacy.ts`):
 *
 *   P1  A player HIDDEN FROM STRANGERS shows a stranger no Dog, no name, no
 *       population count, and nothing from which presence, location or
 *       activity could be inferred. A stranger's view with that player present
 *       is IDENTICAL to the view with that player absent.
 *   P2  Recent Players is filtered at READ time (and an encounter nobody could
 *       see is never recorded in the first place).
 *   P3  There is no "appear in Recent Players" switch. A request carrying one
 *       is refused, so no client can believe it controls something.
 *   P4  A private-server OWNER who blocks a member removes the member; the
 *       owner stays.
 *   P5  A member who blocks the private server's owner LEAVES; the owner stays.
 *   PARTY  A leader who blocks a member removes them; a non-leader who blocks
 *       anyone in the party leaves it.
 *   DM  Messages between a blocked pair are hidden from BOTH while the block
 *       exists, and none can be sent.
 *   NO INFERENCE  A blocked pair sees no voice, roster entry, role, location,
 *       activity or party of each other, in either direction.
 *
 * PURE: no clock (time arrives as ISO strings), no store, no Node. Closed
 * vocabularies everywhere a client could otherwise smuggle free text into
 * somebody else's screen.
 */

export const WONDERLAND_SOCIAL_SCHEMA_V1 = 'relay-wonderland-social.v1' as const;

/** A player id, as the account and session layers mint it. */
export const WONDERLAND_SOCIAL_PLAYER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
/** Party, server and message ids: server- or command-derived, never free text. */
export const WONDERLAND_SOCIAL_ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
/** A public world instance (`public:<name>`) or a private server's (`server:<serverId>`). */
export const WONDERLAND_INSTANCE_ID = /^(?:public|server):[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/u;

export const isWonderlandPlayerId = (value: unknown): value is string =>
  typeof value === 'string' && WONDERLAND_SOCIAL_PLAYER_ID.test(value);
export const isWonderlandEntityId = (value: unknown): value is string =>
  typeof value === 'string' && WONDERLAND_SOCIAL_ENTITY_ID.test(value);
export const isWonderlandInstanceId = (value: unknown): value is string =>
  typeof value === 'string' && WONDERLAND_INSTANCE_ID.test(value);

export const wonderlandServerInstanceId = (serverId: string): string => `server:${serverId}`;
export const wonderlandServerIdOfInstance = (instanceId: string): string | null =>
  instanceId.startsWith('server:') ? instanceId.slice('server:'.length) : null;

/**
 * WHO MAY SEE A PLAYER WHO IS NOT A FRIEND.
 *
 *   EVERYONE                 visible to anyone sharing an instance (blocks aside).
 *   HIDDEN_FROM_STRANGERS    visible only to self, friends and party-mates.
 *
 * The default is stated, not inferred: a player with no settings row is
 * EVERYONE, because that is what the product promises a new player and the
 * setting exists to narrow it. The default is a constant a test pins.
 */
export const WONDERLAND_SOCIAL_VISIBILITIES = ['EVERYONE', 'HIDDEN_FROM_STRANGERS'] as const;
export type WonderlandSocialVisibility = (typeof WONDERLAND_SOCIAL_VISIBILITIES)[number];
export const WONDERLAND_DEFAULT_VISIBILITY: WonderlandSocialVisibility = 'EVERYONE';

/**
 * THE SETTINGS A PLAYER CONTROLS — exactly these, and nothing else.
 *
 * P3: the dead "appear in Recent Players" switch is NOT here. Recent Players
 * follows visibility and blocks, read at read time; a separate switch that
 * nothing honoured was a promise the product did not keep. A request carrying
 * it is refused by name (`parseWonderlandSocialSettings`).
 */
export interface WonderlandSocialSettings {
  readonly visibility: WonderlandSocialVisibility;
}
export const WONDERLAND_SOCIAL_SETTING_FIELDS = ['visibility'] as const;
/** Fields a client might send that this backend does not have, refused by name. */
export const WONDERLAND_SOCIAL_REMOVED_SETTINGS = ['appearInRecentPlayers'] as const;

/** What a player is doing, as a closed vocabulary: no free text reaches another screen. */
export const WONDERLAND_ACTIVITIES = ['IDLE', 'EXPLORING', 'BUILDING', 'IN_BATTLE', 'IN_MISSION', 'AWAY'] as const;
export type WonderlandActivity = (typeof WONDERLAND_ACTIVITIES)[number];

/** Where a player stands. Bounded, finite numbers; the zone is an id, never prose. */
export interface WonderlandLocation {
  readonly zone: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export const WONDERLAND_LOCATION_BOUND = 1_000_000;
export const WONDERLAND_ZONE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

/** A Dog's appearance: an id from the client's catalogue. Cosmetic, never identity. */
export const WONDERLAND_DOG_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

/** The most players one party holds — the same ceiling as a session. */
export const WONDERLAND_PARTY_MAX_MEMBERS = 8;
/** The most members (owner included) one private server holds. */
export const WONDERLAND_SERVER_MAX_MEMBERS = 50;
/** The longest direct message, in characters. */
export const WONDERLAND_MESSAGE_MAX_CHARS = 2_000;
/** The longest private server name, in characters. */
export const WONDERLAND_SERVER_NAME_MAX_CHARS = 64;
/** How many Recent Players one read returns, newest first. */
export const WONDERLAND_RECENT_PLAYERS_LIMIT = 50;

/* ------------------------------------------------------------------ state */

export interface WonderlandSocialProfile {
  /** From the account, never from the client. Null renders Unknown. */
  readonly displayName: string | null;
}

export interface WonderlandPresence {
  readonly playerId: string;
  readonly instanceId: string;
  readonly location: WonderlandLocation | null;
  readonly activity: WonderlandActivity;
  readonly dogId: string | null;
  readonly updatedAt: string;
}

export interface WonderlandParty {
  readonly partyId: string;
  readonly leaderId: string;
  /** Join order, leader included. The next leader is the earliest remaining member. */
  readonly memberIds: readonly string[];
  readonly createdAt: string;
}

export interface WonderlandPrivateServer {
  readonly serverId: string;
  readonly ownerId: string;
  readonly name: string;
  /** Members other than the owner, in join order. */
  readonly memberIds: readonly string[];
  readonly createdAt: string;
}

export interface WonderlandEncounter {
  /** Whose Recent Players this row belongs to. */
  readonly playerId: string;
  readonly otherId: string;
  readonly instanceId: string;
  readonly at: string;
}

export interface WonderlandDirectMessage {
  readonly messageId: string;
  readonly fromId: string;
  readonly toId: string;
  readonly body: string;
  readonly sentAt: string;
}

export interface WonderlandSocialState {
  readonly profiles: Readonly<Record<string, WonderlandSocialProfile>>;
  readonly settings: Readonly<Record<string, WonderlandSocialSettings>>;
  /** Sorted pair keys `a|b` with a < b. */
  readonly friendships: readonly string[];
  readonly friendRequests: readonly { readonly fromId: string; readonly toId: string; readonly at: string }[];
  readonly blocks: readonly { readonly blockerId: string; readonly blockedId: string; readonly at: string }[];
  readonly parties: Readonly<Record<string, WonderlandParty>>;
  readonly partyInvites: readonly { readonly partyId: string; readonly inviteeId: string; readonly inviterId: string; readonly at: string }[];
  readonly servers: Readonly<Record<string, WonderlandPrivateServer>>;
  readonly serverInvites: readonly { readonly serverId: string; readonly inviteeId: string; readonly at: string }[];
  readonly presence: Readonly<Record<string, WonderlandPresence>>;
  readonly encounters: readonly WonderlandEncounter[];
  readonly messages: readonly WonderlandDirectMessage[];
}

export const WONDERLAND_EMPTY_SOCIAL_STATE: WonderlandSocialState = Object.freeze({
  profiles: Object.freeze({}),
  settings: Object.freeze({}),
  friendships: Object.freeze([]),
  friendRequests: Object.freeze([]),
  blocks: Object.freeze([]),
  parties: Object.freeze({}),
  partyInvites: Object.freeze([]),
  servers: Object.freeze({}),
  serverInvites: Object.freeze([]),
  presence: Object.freeze({}),
  encounters: Object.freeze([]),
  messages: Object.freeze([]),
});

export const wonderlandFriendKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/* ------------------------------------------------------- commands, results */

export type WonderlandSocialCommand =
  | { readonly kind: 'SET_SETTINGS'; readonly settings: WonderlandSocialSettings }
  | { readonly kind: 'FRIEND_REQUEST'; readonly toId: string }
  | { readonly kind: 'FRIEND_ACCEPT'; readonly fromId: string }
  | { readonly kind: 'FRIEND_DECLINE'; readonly fromId: string }
  | { readonly kind: 'FRIEND_REMOVE'; readonly otherId: string }
  | { readonly kind: 'BLOCK'; readonly targetId: string }
  | { readonly kind: 'UNBLOCK'; readonly targetId: string }
  | { readonly kind: 'PARTY_CREATE'; readonly partyId: string }
  | { readonly kind: 'PARTY_INVITE'; readonly inviteeId: string }
  | { readonly kind: 'PARTY_JOIN'; readonly partyId: string }
  | { readonly kind: 'PARTY_LEAVE' }
  | { readonly kind: 'PARTY_KICK'; readonly memberId: string }
  | { readonly kind: 'SERVER_CREATE'; readonly serverId: string; readonly name: string }
  | { readonly kind: 'SERVER_INVITE'; readonly serverId: string; readonly inviteeId: string }
  | { readonly kind: 'SERVER_JOIN'; readonly serverId: string }
  | { readonly kind: 'SERVER_LEAVE'; readonly serverId: string }
  | { readonly kind: 'SERVER_REMOVE_MEMBER'; readonly serverId: string; readonly memberId: string }
  | { readonly kind: 'ENTER_INSTANCE'; readonly instanceId: string; readonly location: WonderlandLocation | null; readonly activity: WonderlandActivity; readonly dogId: string | null }
  | { readonly kind: 'UPDATE_PRESENCE'; readonly location: WonderlandLocation | null; readonly activity: WonderlandActivity }
  | { readonly kind: 'LEAVE_INSTANCE' }
  | { readonly kind: 'SEND_MESSAGE'; readonly messageId: string; readonly toId: string; readonly body: string };

export type WonderlandSocialCommandKind = WonderlandSocialCommand['kind'];

/**
 * WHY A COMMAND DID NOTHING.
 *
 * `UNAVAILABLE` is deliberately one code for every reason that would otherwise
 * tell the actor something about ANOTHER player: unknown, blocked in either
 * direction, hidden from strangers, or not accepting. A caller cannot tell
 * those apart, so none of them leaks. Codes that only describe the actor's
 * own situation (not in a party, not the leader) are specific, because they
 * tell the actor nothing about anyone else.
 */
export const WONDERLAND_SOCIAL_REFUSALS = [
  'INVALID',
  'SELF',
  'UNAVAILABLE',
  'NOT_PERMITTED',
  'ALREADY_IN_PARTY',
  'NOT_IN_PARTY',
  'PARTY_FULL',
  'SERVER_FULL',
  'NOT_A_MEMBER',
  'NOT_IN_INSTANCE',
  'ID_TAKEN',
] as const;
export type WonderlandSocialRefusal = (typeof WONDERLAND_SOCIAL_REFUSALS)[number];

export type WonderlandSocialOutcome =
  | { readonly ok: true; readonly code: 'DONE' | 'NO_CHANGE' }
  | { readonly ok: false; readonly code: WonderlandSocialRefusal };

/**
 * ONE CHANGE TO THE DURABLE STATE. A command decides a list of these; the
 * memory store and the PostgreSQL store both apply the SAME list, which is what
 * keeps the two from deciding the same command two ways.
 */
export type WonderlandSocialMutation =
  | { readonly kind: 'SETTINGS_SET'; readonly playerId: string; readonly settings: WonderlandSocialSettings }
  | { readonly kind: 'FRIEND_REQUEST_ADDED'; readonly fromId: string; readonly toId: string; readonly at: string }
  | { readonly kind: 'FRIEND_REQUEST_REMOVED'; readonly fromId: string; readonly toId: string }
  | { readonly kind: 'FRIENDSHIP_ADDED'; readonly a: string; readonly b: string; readonly at: string }
  | { readonly kind: 'FRIENDSHIP_REMOVED'; readonly a: string; readonly b: string }
  | { readonly kind: 'BLOCK_ADDED'; readonly blockerId: string; readonly blockedId: string; readonly at: string }
  | { readonly kind: 'BLOCK_REMOVED'; readonly blockerId: string; readonly blockedId: string }
  | { readonly kind: 'PARTY_CREATED'; readonly partyId: string; readonly leaderId: string; readonly at: string }
  | { readonly kind: 'PARTY_MEMBER_ADDED'; readonly partyId: string; readonly playerId: string }
  | { readonly kind: 'PARTY_MEMBER_REMOVED'; readonly partyId: string; readonly playerId: string }
  | { readonly kind: 'PARTY_LEADER_SET'; readonly partyId: string; readonly leaderId: string }
  | { readonly kind: 'PARTY_DISBANDED'; readonly partyId: string }
  | { readonly kind: 'PARTY_INVITE_ADDED'; readonly partyId: string; readonly inviteeId: string; readonly inviterId: string; readonly at: string }
  | { readonly kind: 'PARTY_INVITE_REMOVED'; readonly partyId: string; readonly inviteeId: string }
  | { readonly kind: 'SERVER_CREATED'; readonly serverId: string; readonly ownerId: string; readonly name: string; readonly at: string }
  | { readonly kind: 'SERVER_MEMBER_ADDED'; readonly serverId: string; readonly playerId: string }
  | { readonly kind: 'SERVER_MEMBER_REMOVED'; readonly serverId: string; readonly playerId: string }
  | { readonly kind: 'SERVER_INVITE_ADDED'; readonly serverId: string; readonly inviteeId: string; readonly at: string }
  | { readonly kind: 'SERVER_INVITE_REMOVED'; readonly serverId: string; readonly inviteeId: string }
  | { readonly kind: 'PRESENCE_SET'; readonly presence: WonderlandPresence }
  | { readonly kind: 'PRESENCE_CLEARED'; readonly playerId: string }
  | { readonly kind: 'ENCOUNTER_RECORDED'; readonly encounter: WonderlandEncounter }
  | { readonly kind: 'MESSAGE_SENT'; readonly message: WonderlandDirectMessage };

export type WonderlandSocialMutationKind = WonderlandSocialMutation['kind'];

/* ------------------------------------------------------------- validation */

const isFiniteBounded = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= WONDERLAND_LOCATION_BOUND;

export function parseWonderlandLocation(value: unknown): WonderlandLocation | null | 'INVALID' {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return 'INVALID';
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if (keys !== 'x,y,z,zone') return 'INVALID';
  if (typeof record.zone !== 'string' || !WONDERLAND_ZONE_ID.test(record.zone)) return 'INVALID';
  if (!isFiniteBounded(record.x) || !isFiniteBounded(record.y) || !isFiniteBounded(record.z)) return 'INVALID';
  return Object.freeze({ zone: record.zone, x: record.x, y: record.y, z: record.z });
}

export const isWonderlandActivity = (value: unknown): value is WonderlandActivity =>
  (WONDERLAND_ACTIVITIES as readonly unknown[]).includes(value);

/**
 * P3, AT THE BOUNDARY. Exactly the fields this backend has; the removed switch
 * is refused BY NAME so the refusal says what happened, and any other unknown
 * field is refused too, so a future client cannot believe it set something.
 */
export function parseWonderlandSocialSettings(value: unknown):
  | { readonly ok: true; readonly settings: WonderlandSocialSettings }
  | { readonly ok: false; readonly reason: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'settings_must_be_an_object' };
  const record = value as Record<string, unknown>;
  for (const removed of WONDERLAND_SOCIAL_REMOVED_SETTINGS) {
    if (removed in record) return { ok: false, reason: `setting_removed:${removed}` };
  }
  for (const key of Object.keys(record)) {
    if (!(WONDERLAND_SOCIAL_SETTING_FIELDS as readonly string[]).includes(key)) return { ok: false, reason: `setting_unknown:${key.slice(0, 40)}` };
  }
  if (!(WONDERLAND_SOCIAL_VISIBILITIES as readonly unknown[]).includes(record.visibility)) return { ok: false, reason: 'visibility_invalid' };
  return { ok: true, settings: Object.freeze({ visibility: record.visibility as WonderlandSocialVisibility }) };
}

/** A message body: trimmed, non-empty, bounded, no control characters but newline and tab. */
export function parseWonderlandMessageBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  if (body.length === 0 || body.length > WONDERLAND_MESSAGE_MAX_CHARS) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(body)) return null;
  return body;
}

/** A private server's name: trimmed, non-empty, bounded, printable. */
export function parseWonderlandServerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name.length === 0 || name.length > WONDERLAND_SERVER_NAME_MAX_CHARS) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/u.test(name)) return null;
  return name;
}
