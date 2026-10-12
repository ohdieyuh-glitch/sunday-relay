/**
 * WONDERLAND SOCIAL — one operation of the `social` capability, applied to the one social state.
 *
 * The transport (relay-bridge/wonderland-social-routes.ts) authenticates the session, binds the actor to the session's
 * player and finds the operation (wonderland-social-scope.ts). This module does the rest, and nothing else: it validates the
 * operation's own inputs, runs the domain rule (social-friends / -conversations / -parties / -presence), and returns
 *   - the next state (unchanged for a read),
 *   - what the caller gets back (a view made FOR the actor, never a raw record), and
 *   - the AUDIENCE: whose views the change may have altered, so the events stream can tell exactly them to refresh.
 *
 * PRIVACY IN THE AUDIENCE. A block, a mute and a report are told to nobody but the actor: the blocked, muted or reported
 * person is never sent an event about it (their views change on their next refresh, like any other). Reads have no audience.
 * THE BLOCK FLOOR: no update a player CAUSES ever reaches anyone blocked either way with them -- a shared party (which a
 * block does not break) included: B's self-mute or role change produces no event for the A that B blocked (F1, 10-02).
 * ONE EXCEPTION, THE ORDINARY PARTY CHANGE (founder, 10-04): when a block separates a shared party, the member it happens to
 * is told exactly what a kick or a leave tells anyone (floorExempt) -- never that it was a block.
 *
 * Pure: the same state, operation and inputs give the same result on every machine.
 */

import { relayError, type RelayResult } from '../protocol/errors';
import {
  MESSAGE_KINDS,
  PARTY_INVITE_PERMISSIONS,
  PARTY_PRIVACIES,
  SOCIAL_AUDIENCES,
  SOCIAL_AVAILABILITY,
  SOCIAL_REPORT_REASONS,
  SOCIAL_SERVER_KINDS,
  WONDERLAND_NATION_IDS,
  type MessageKind,
  type PartyInvitePermission,
  type PartyPrivacy,
  type SocialAudience,
  type SocialAvailability,
  type SocialLocation,
  type SocialOperationId,
  type SocialPrivacySettings,
  type SocialReportReason,
  type SocialUserId,
} from './social-contracts';
import { conversationsFor, isWalledDirect, markRead, openDirectConversation, sendMessage } from './social-conversations';
import {
  acceptFriendRequest,
  blockUser,
  cancelFriendRequest,
  declineFriendRequest,
  fileReport,
  pendingRequestsFor,
  recordPlayedTogether,
  removeFriend,
  sendFriendRequest,
  setMute,
  unblockUser,
} from './social-friends';
import {
  acceptPartyInvite,
  createParty,
  declinePartyInvite,
  inviteToParty,
  joinParty,
  leaveParty,
  partyInvitesFor,
  partyViewFor,
  promotePartyLeader,
  removePartyMember,
  reconcileBlockedParties,
  recentPlayersViewFor,
  separateForBlock,
  setPartyRules,
  setSelfMuted,
  sharedPartyBlockWarning,
  sharedPartyOf,
} from './social-parties';
import {
  LFF_CATEGORIES,
  LFF_DESCRIPTION_MAX,
  LFF_FEED_PAGE_DEFAULT,
  LFF_FEED_PAGE_MAX,
  LFF_MESSAGE_MAX,
  LFF_PROJECT_LABEL_MAX,
  LFF_SKILL_MAX,
  LFF_SKILLS_MAX,
  LFF_SLOTS_MAX,
  LFF_SLOTS_MIN,
  LFF_TITLE_MAX,
  acceptLffRequest,
  closeLffPost,
  createLffPost,
  createLffRequest,
  declineLffRequest,
  deleteLffPost,
  editLffPost,
  lffBlockNotices,
  lffFeedFor,
  lffNotFound,
  lffPostFor,
  lffRequestsForPost,
  lffRequestsMineFor,
  parseLffCursor,
  withdrawLffRequest,
  type LffChange,
  type LffFeedCursor,
  type LffFeedFilter,
  type LffPostFields,
  type LffPostPatch,
} from './social-lff';
import { deriveActivity, resolvePresenceFor, resolveProfileFor, type WonderlandActivitySignals } from './social-presence';
import { buildSocialView, row } from './social-preview';
import { areFriends, blockedEitherWay, conversationById, friendIdsOf, messagesOf, partyById, partyOf, presenceHiddenFrom, userById, type SocialState } from './social-state';
import {
  WORLD_MOTIONS,
  closePrivateServer,
  contextOf,
  emptyWorldState,
  inviteToWorld,
  joinWorld,
  leaveWorld,
  privateServerAdmits,
  recentlyRemoved,
  removeFromPrivateServer,
  reportAvatar,
  worldViewFor,
  type PrivateServerGate,
  type WorldJoinTarget,
  type WorldMotion,
  type WorldState,
} from './world-presence';
import type { PrivateServerRecord } from './private-server-lifecycle';

/** What one operation did. `audience` is empty for a read. `world` is the shared presence layer's next state, if it moved. */
export interface SocialCommandOutcome {
  readonly state: SocialState;
  readonly data: unknown;
  readonly audience: readonly SocialUserId[];
  readonly world?: WorldState;
  /**
   * The operation the audience is TOLD about, when it must not be the actor's own. A block that separates a shared party is
   * told to the remaining members as the party change it made (a member removed, or a member who left) -- an event named
   * `blocks.add` would tell them a block happened, and who, by who left (the founder's wall: nothing names a block).
   */
  readonly eventOp?: SocialOperationId;
  /**
   * Members of the audience the block floor must NOT remove: the person a block's party change happened TO, told exactly what
   * any such change tells them (founder, 10-04: the member a leader's block removes gets the ORDINARY parties.remove_member, a
   * kick; and the member a blocker leaves is told the ordinary parties.leave, as every remaining member of any leave is).
   * Silence there was itself the tell: a kick, a leave and an unfriend each notify; a block alone did not.
   */
  readonly floorExempt?: readonly SocialUserId[];
  /**
   * A private server's lifecycle record the store MUST persist with this operation (compare-and-set on the version before it), or
   * the operation does not happen: the owner opened their server and its cycle moved (private-server-lifecycle.ts).
   */
  readonly serverWrite?: PrivateServerRecord;
  /** The owner whose private server this operation found closed and emptied: the store records the observation (best effort). */
  readonly closedServerOf?: SocialUserId;
  /**
   * ORDINARY CHANGES TOLD AS THEMSELVES, each as its own event, logged BEFORE the operation's own (LFF, social-lff.ts): the post a
   * fill closed, told to the others with a close's op (never an accept's: that would say it filled); and an LFF request a block
   * cancelled, told to the other side as a withdrawal or a deletion (silence was itself the tell, SEC-M2). The block floor applies
   * to them as to `audience`; the counterparts a block's own notices are addressed to are in `floorExempt`. A store must log
   * them with the operation, in the same commit (the PostgreSQL store: B2b).
   */
  readonly extraEvents?: readonly { readonly op: SocialOperationId; readonly audience: readonly SocialUserId[] }[];
}

/** The operation's inputs: the path's ids in order (e.g. a request id, a party id then a member id) and the JSON body. */
export interface SocialCommandInput {
  readonly ids: readonly string[];
  readonly body: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, string>>;
}

const MAX_TEXT = 2000;
const MAX_LABEL = 80;

type Check<T> = { ok: true; value: T } | { ok: false; message: string };

function invalid(message: string): RelayResult<never> {
  return { ok: false, error: relayError('validation-failed', message) };
}

function str(body: Readonly<Record<string, unknown>>, field: string, max: number, required = true): Check<string | null> {
  const value = body[field];
  if (value === undefined || value === null) return required ? { ok: false, message: `${field} is required` } : { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, message: `${field} must be a string` };
  // PostgreSQL text cannot hold U+0000: refused here as a 400, never sent to the store to fail there as a "retry" (MINOR 1, 10-07)
  if (value.includes('\u0000')) return { ok: false, message: `${field} must not contain a NUL character` };
  const trimmed = value.trim();
  if (required && trimmed.length === 0) return { ok: false, message: `${field} must not be empty` };
  if (trimmed.length > max) return { ok: false, message: `${field} is longer than ${max} characters` };
  return { ok: true, value: trimmed };
}

/**
 * A CONTROL CHARACTER: C0 (U+0000-U+001F, so NUL, TAB, LF, CR and ESC among them), DEL (U+007F), or the Unicode line and
 * paragraph separators (U+2028, U+2029). Judged by code unit, so this file writes no escape for any of them.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

const controlRefusal = (field: string) => `${field} must not contain a control character or a line break`;

/** A C1 control (U+0080-U+009F): refused where a migration's CHECK refuses [[:cntrl:]], so memory and PostgreSQL agree (world.join). */
const hasC1Control = (value: string): boolean => /[\u0080-\u009f]/u.test(value);

/** A UTF-16 surrogate that is not half of a pair (what a JSON escape of a lone high or low surrogate decodes to). Judged by code unit. */
function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return true;
      i += 1;
    }
  }
  return false;
}

/**
 * TEXT A PLAYER WRITES FOR OTHER PLAYERS TO READ: str(), and no control character anywhere in it (CORE, 10-07, the log-injection
 * finding). A party name, a private server's name, an activity detail, a location label and a message body each reach other
 * players' clients, and the clients write some of them into their logs exactly as received: a party name in the snapshot line
 * and the hub's description, a private server's name in "WLWORLD joined", a message body in the QA harness's evidence lines. A
 * line break there FORGES a log line (a fake "WLSOCIALLIVE ... PASS"); ESC drives the terminal a log is read in. Judged on the
 * value AS SENT, before any trim (a trailing line break is refused, not trimmed away). Ordinary text in any script passes.
 */
function displayText(body: Readonly<Record<string, unknown>>, field: string, max: number, required = true): Check<string | null> {
  const checked = str(body, field, max, required);
  if (!checked.ok || checked.value === null) return checked;
  return hasControlCharacter(body[field] as string) ? { ok: false, message: controlRefusal(field) } : checked;
}

/**
 * WHO MAY BE TOLD: the candidates whose VIEW of the actor moved between two states (the card, its presence and actions, and
 * whether the actor is hidden from them). An online person's last-seen is "now" on every report, so it is left out of the
 * comparison: it moves with any call and would make every change "visible". P1: a change nobody can see is told to nobody.
 */
function viewMoved(before: SocialState, after: SocialState, actorId: SocialUserId, candidates: readonly SocialUserId[]): SocialUserId[] {
  const viewOf = (st: SocialState, viewerId: SocialUserId) => {
    const card = resolveProfileFor(st, viewerId, actorId);
    const presence = card?.presence;
    const steady = presence !== undefined && presence.onlineState !== 'OFFLINE' ? { ...presence, lastSeenAtIso: null } : presence;
    return JSON.stringify([card === null ? null : { ...card, presence: steady }, presenceHiddenFrom(st, viewerId, actorId)]);
  };
  return [...new Set(candidates)].filter((id) => id !== actorId && viewOf(before, id) !== viewOf(after, id));
}

function oneOf<T extends string>(body: Readonly<Record<string, unknown>>, field: string, allowed: readonly T[], required = true): Check<T | null> {
  const value = body[field];
  if (value === undefined || value === null) return required ? { ok: false, message: `${field} is required` } : { ok: true, value: null };
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) return { ok: false, message: `${field} must be one of ${allowed.join(', ')}` };
  return { ok: true, value: value as T };
}

function bool(body: Readonly<Record<string, unknown>>, field: string): Check<boolean | null> {
  const value = body[field];
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'boolean') return { ok: false, message: `${field} must be true or false` };
  return { ok: true, value };
}

/* ------------------------------------------------------------------------------------------- LFF inputs (social-lff.ts) */

/** A field name safe to repeat in a refusal: a client-sent key is echoed only when it is a plain identifier. */
const PLAIN_FIELD = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/**
 * UNKNOWN FIELDS ARE REFUSED (the LFF contract, rule 7): every key of the body, and of the query, must be one the operation takes.
 * Validation never depends on whether the post exists, so a refusal here says nothing about it.
 */
function onlyFields(input: SocialCommandInput, bodyFields: readonly string[], queryFields: readonly string[] = []): Check<true> {
  const unknown =
    Object.keys(input.body ?? {}).find((k) => !bodyFields.includes(k)) ?? Object.keys(input.query ?? {}).find((k) => !queryFields.includes(k));
  if (unknown === undefined) return { ok: true, value: true };
  return { ok: false, message: PLAIN_FIELD.test(unknown) ? `${unknown} is not a field of this operation` : 'a field is not one this operation takes' };
}

/**
 * TEXT A PLAYER WRITES ON LFF FOR OTHER PLAYERS TO READ: displayText's rule exactly -- a NUL refused in str()'s words, any other
 * control character or line break in controlRefusal's, judged on the value AS SENT -- plus the C1 controls (U+0080-U+009F), as a
 * private server's name refuses them (world.join), so that memory and a PostgreSQL CHECK on [[:cntrl:]] agree. Lengths are counted
 * in CODE POINTS after the trim (PostgreSQL's char_length, as private-server-lifecycle.ts cleanServerName): an emoji is one.
 */
function lffText(value: unknown, field: string, min: 0 | 1, max: number, required: boolean): Check<string | null> {
  if (value === undefined || value === null) return required ? { ok: false, message: `${field} is required` } : { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, message: `${field} must be a string` };
  if (value.includes('\u0000')) return { ok: false, message: `${field} must not contain a NUL character` };
  if (hasControlCharacter(value) || hasC1Control(value)) return { ok: false, message: controlRefusal(field) };
  // an unpaired surrogate is no text at all: the pg driver would store U+FFFD in its place, so memory and PostgreSQL would disagree
  if (hasLoneSurrogate(value)) return { ok: false, message: `${field} is not valid text` };
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  if (length < min) return { ok: false, message: `${field} must not be empty` };
  if (length > max) return { ok: false, message: `${field} is longer than ${max} characters` };
  return { ok: true, value: trimmed };
}

/** The skills a post asks for: 0-8 items, each 1-32 code points of player text. */
function lffSkills(value: unknown): Check<string[] | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!Array.isArray(value)) return { ok: false, message: 'skills must be a list' };
  if (value.length > LFF_SKILLS_MAX) return { ok: false, message: `skills has more than ${LFF_SKILLS_MAX} items` };
  const skills: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = lffText(value[i], `skills[${i}]`, 1, LFF_SKILL_MAX, true);
    if (!item.ok) return item;
    skills.push(item.value as string);
  }
  return { ok: true, value: skills };
}

function lffSlots(value: unknown, required: boolean): Check<number | null> {
  if (value === undefined || value === null) return required ? { ok: false, message: 'openSlots is required' } : { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < LFF_SLOTS_MIN || value > LFF_SLOTS_MAX) {
    return { ok: false, message: `openSlots must be a whole number from ${LFF_SLOTS_MIN} to ${LFF_SLOTS_MAX}` };
  }
  return { ok: true, value };
}

const LFF_POST_FIELDS = ['category', 'title', 'description', 'projectLabel', 'skills', 'openSlots'] as const;

/** A post's fields: to create, category, title and openSlots are required (the rest may be left out); to edit, any of them. */
function readLffPost(body: Readonly<Record<string, unknown>>, partial: boolean): Check<LffPostPatch> {
  const category = oneOf(body, 'category', LFF_CATEGORIES, !partial);
  if (!category.ok) return category;
  const title = lffText(body.title, 'title', 1, LFF_TITLE_MAX, !partial);
  if (!title.ok) return title;
  const description = lffText(body.description, 'description', 0, LFF_DESCRIPTION_MAX, false);
  if (!description.ok) return description;
  const projectLabel = lffText(body.projectLabel, 'projectLabel', 0, LFF_PROJECT_LABEL_MAX, false);
  if (!projectLabel.ok) return projectLabel;
  const skills = lffSkills(body.skills);
  if (!skills.ok) return skills;
  const openSlots = lffSlots(body.openSlots, !partial);
  if (!openSlots.ok) return openSlots;
  const patch: { -readonly [K in keyof LffPostFields]?: LffPostFields[K] } = {};
  if (category.value !== null) patch.category = category.value;
  if (title.value !== null) patch.title = title.value;
  if (description.value !== null) patch.description = description.value;
  if (projectLabel.value !== null) patch.projectLabel = projectLabel.value;
  if (skills.value !== null) patch.skills = skills.value;
  if (openSlots.value !== null) patch.openSlots = openSlots.value;
  return { ok: true, value: patch };
}

const LFF_FEED_FIELDS = ['category', 'projectLabel', 'skill', 'hasOpenSlots', 'mine', 'cursor', 'limit'] as const;

/** A yes/no filter: a JSON boolean in a body, or 1 / 0 / true / false in a query string. Absent is no. */
function lffFlag(value: unknown, field: string): Check<boolean> {
  if (value === undefined || value === null) return { ok: true, value: false };
  if (value === true || value === '1' || value === 'true') return { ok: true, value: true };
  if (value === false || value === '0' || value === 'false') return { ok: true, value: false };
  return { ok: false, message: `${field} must be true or false` };
}

/** The feed's filters, from the query (a GET) or the body. An empty query value is no filter. */
function readLffFeedFilter(input: SocialCommandInput): Check<LffFeedFilter> {
  const known = onlyFields(input, LFF_FEED_FIELDS, LFF_FEED_FIELDS);
  if (!known.ok) return known;
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ ...(input.query ?? {}), ...(input.body ?? {}) })) if (value !== '') raw[key] = value;
  const category = oneOf(raw, 'category', LFF_CATEGORIES, false);
  if (!category.ok) return category;
  const projectLabel = lffText(raw.projectLabel, 'projectLabel', 1, LFF_PROJECT_LABEL_MAX, false);
  if (!projectLabel.ok) return projectLabel;
  const skill = lffText(raw.skill, 'skill', 1, LFF_SKILL_MAX, false);
  if (!skill.ok) return skill;
  const hasOpenSlots = lffFlag(raw.hasOpenSlots, 'hasOpenSlots');
  if (!hasOpenSlots.ok) return hasOpenSlots;
  const mine = lffFlag(raw.mine, 'mine');
  if (!mine.ok) return mine;
  const rawCursor = raw.cursor;
  let cursor: LffFeedCursor | null = null;
  if (rawCursor !== undefined && rawCursor !== null) {
    cursor = typeof rawCursor === 'string' ? parseLffCursor(rawCursor) : null;
    if (cursor === null) return { ok: false, message: 'cursor is not one this feed gave' };
  }
  const rawLimit = raw.limit;
  let limit = LFF_FEED_PAGE_DEFAULT;
  if (rawLimit !== undefined && rawLimit !== null) {
    const n = typeof rawLimit === 'number' ? rawLimit : typeof rawLimit === 'string' && /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
    if (!Number.isInteger(n) || n < 1 || n > LFF_FEED_PAGE_MAX) return { ok: false, message: `limit must be a whole number from 1 to ${LFF_FEED_PAGE_MAX}` };
    limit = n;
  }
  return {
    ok: true,
    value: { category: category.value, projectLabel: projectLabel.value, skill: skill.value, hasOpenSlots: hasOpenSlots.value, mine: mine.value, cursor, limit },
  };
}

/**
 * An LFF change as an outcome: the next state, the actor's answer, exactly the people it concerns, and any ordinary change it also
 * tells as itself (a fill's close) -- then the block floor, for all of them.
 */
function lffChanged(change: LffChange, data: unknown): RelayResult<SocialCommandOutcome> {
  const notices = (change.notices ?? []).filter((n) => n.audience.length > 0).map((n) => ({ op: n.op, audience: [...new Set(n.audience)] }));
  return { ok: true, value: { state: change.state, data, audience: [...new Set(change.told)], ...(notices.length === 0 ? {} : { extraEvents: notices }) } };
}

function lffResult(result: RelayResult<LffChange>, data: unknown): RelayResult<SocialCommandOutcome> {
  return result.ok ? lffChanged(result.value, data) : result;
}

function unchanged(state: SocialState, data: unknown): RelayResult<SocialCommandOutcome> {
  return { ok: true, value: { state, data, audience: [] } };
}

function changed(next: RelayResult<SocialState>, data: unknown, audience: readonly SocialUserId[]): RelayResult<SocialCommandOutcome> {
  if (!next.ok) return next;
  return { ok: true, value: { state: next.value, data, audience: [...new Set(audience)] } };
}

/** Everyone in the actor's party, if any. */
function partyMembers(state: SocialState, userId: SocialUserId): SocialUserId[] {
  return partyOf(state, userId)?.members.map((m) => m.userId) ?? [];
}

/* ----------------------------------------------------------------------------------------------- presence & privacy */

export interface OwnPresenceInput {
  readonly connected?: boolean;
  readonly availability?: SocialAvailability;
  readonly signals?: WonderlandActivitySignals;
  readonly activityDetail?: string | null;
  readonly location?: SocialLocation | null;
}

/**
 * THE PLAYER'S OWN PRESENCE, as their client reports it. The activity is derived by the one precedence (deriveActivity),
 * with "in a party" taken from the party record, never from the client; the party id likewise. Nobody sets anyone else's.
 */
export function updateOwnPresence(state: SocialState, actorId: SocialUserId, input: OwnPresenceInput, atIso: string): RelayResult<SocialState> {
  const user = userById(state, actorId);
  if (user === undefined) return { ok: false, error: relayError('not-found', 'user not found') };
  const party = partyOf(state, actorId);
  const current = user.presence;
  const connected = input.connected ?? current.connected;
  const availability = input.availability ?? current.availability;
  const activity = input.signals !== undefined ? deriveActivity({ ...input.signals, inParty: party !== undefined }) : current.activity;
  const presence = {
    ...current,
    connected,
    availability,
    activity,
    activityDetail: input.activityDetail !== undefined ? input.activityDetail : current.activityDetail,
    location: input.location !== undefined ? input.location : current.location,
    partyId: party?.partyId ?? null,
    // FROZEN WHILE HIDDEN (M1): an APPEAR_OFFLINE player's last-seen stays where it was when they went hidden, so friends read
    // them exactly as a player who signed out at that moment -- never a fresh time, never a tell-tale null.
    lastSeenAtIso: connected && availability !== 'APPEAR_OFFLINE' ? atIso : current.lastSeenAtIso,
    updatedAtIso: atIso,
  };
  return { ok: true, value: { ...state, users: { ...state.users, [actorId]: { ...user, presence } } } };
}

type PrivacyPatch = Partial<Omit<SocialPrivacySettings, 'userId'>>;

const PRIVACY_FIELDS = [
  'presenceVisibility',
  'activityVisibility',
  'locationVisibility',
  'privateServerVisibility',
  'messagePolicy',
  'friendRequestPolicy',
  'serverJoinPolicy',
] as const;

/** The player's own privacy. Friend requests are EVERYONE or NOBODY: an audience of friends asking to be friends is no audience. */
export function updateOwnPrivacy(state: SocialState, actorId: SocialUserId, patch: PrivacyPatch): RelayResult<SocialState> {
  const user = userById(state, actorId);
  if (user === undefined) return { ok: false, error: relayError('not-found', 'user not found') };
  if (patch.friendRequestPolicy !== undefined && patch.friendRequestPolicy !== 'EVERYONE' && patch.friendRequestPolicy !== 'NOBODY') {
    return invalid('friendRequestPolicy must be EVERYONE or NOBODY');
  }
  return { ok: true, value: { ...state, users: { ...state.users, [actorId]: { ...user, privacy: { ...user.privacy, ...patch } } } } };
}

function readLocation(raw: unknown): Check<SocialLocation | null> {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'location must be an object or null' };
  const body = raw as Record<string, unknown>;
  // every string of a reported location is shown to the friends who may see it: displayText (no control character)
  const serverId = displayText(body, 'serverId', MAX_LABEL);
  const serverKind = oneOf(body, 'serverKind', SOCIAL_SERVER_KINDS);
  const serverName = displayText(body, 'serverName', MAX_LABEL);
  const placeLabel = displayText(body, 'placeLabel', MAX_LABEL, false);
  const nationId = oneOf(body, 'nationId', WONDERLAND_NATION_IDS, false);
  for (const c of [serverId, serverKind, serverName, placeLabel, nationId]) if (!c.ok) return { ok: false, message: `location.${c.message}` };
  return {
    ok: true,
    value: {
      serverId: (serverId as { value: string }).value,
      serverKind: (serverKind as { value: SocialLocation['serverKind'] }).value,
      serverName: (serverName as { value: string }).value,
      placeLabel: (placeLabel as { value: string | null }).value,
      nationId: (nationId as { value: SocialLocation['nationId'] }).value,
    },
  };
}

function readSignals(raw: unknown): Check<WonderlandActivitySignals | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'signals must be an object' };
  const body = raw as Record<string, unknown>;
  const flags = ['inGveBattle', 'runningMission', 'juliusWorking', 'inPrivateServer', 'exploring'] as const;
  const out: Record<string, boolean> = {};
  for (const flag of flags) {
    const value = body[flag] ?? false;
    if (typeof value !== 'boolean') return { ok: false, message: `signals.${flag} must be true or false` };
    out[flag] = value;
  }
  const creating = body.creating ?? null;
  if (creating !== null && creating !== 'SOFTWARE' && creating !== 'GAME' && creating !== 'CONTENT') return { ok: false, message: 'signals.creating must be SOFTWARE, GAME, CONTENT or null' };
  return {
    ok: true,
    value: {
      inGveBattle: out.inGveBattle,
      runningMission: out.runningMission,
      juliusWorking: out.juliusWorking,
      creating: creating as WonderlandActivitySignals['creating'],
      inPrivateServer: out.inPrivateServer,
      inParty: false, // from the party record, never from the client (updateOwnPresence)
      exploring: out.exploring,
    },
  };
}

/* ----------------------------------------------------------------------------------------------------- the operations */

/**
 * APPLY ONE OPERATION for the actor. The caller has already: authenticated the session, refused anything not in the table,
 * and bound the actor to the session's own player (bindSocialActor). Ids come from the path; everything else from the body.
 * First any coexisting blocked pair is RECONCILED (reconcileBlockedParties: the founder's membership rule, applied to data
 * from before it, a restore or a race; the store persists it with the operation's own change). The audience then passes
 * THE BLOCK FLOOR (see the header), judged on the state AFTER the operation.
 */
export function applySocialOperation(
  state: SocialState,
  op: SocialOperationId,
  actorId: SocialUserId,
  input: SocialCommandInput,
  nowIso: string,
  world: WorldState = emptyWorldState(),
  servers: PrivateServerGate | null = null,
): RelayResult<SocialCommandOutcome> {
  const outcome = applyOne(reconcileBlockedParties(state), op, actorId, input, nowIso, world, servers);
  if (!outcome.ok || (outcome.value.audience.length === 0 && (outcome.value.extraEvents ?? []).length === 0)) return outcome;
  const after = outcome.value.state;
  const exempt = new Set(outcome.value.floorExempt ?? []);
  const admits = (id: SocialUserId) => id === actorId || exempt.has(id) || !blockedEitherWay(after, actorId, id);
  const audience = outcome.value.audience.filter(admits);
  if (outcome.value.extraEvents === undefined) return { ok: true, value: { ...outcome.value, audience } };
  const extraEvents = outcome.value.extraEvents.map((e) => ({ op: e.op, audience: e.audience.filter(admits) })).filter((e) => e.audience.length > 0);
  return { ok: true, value: { ...outcome.value, audience, extraEvents } };
}

function applyOne(
  state: SocialState,
  op: SocialOperationId,
  actorId: SocialUserId,
  input: SocialCommandInput,
  nowIso: string,
  world: WorldState,
  servers: PrivateServerGate | null,
): RelayResult<SocialCommandOutcome> {
  const { ids, body } = input;
  const nowMs = Date.parse(nowIso);
  const worldFail = (r: { code: string; message: string }): RelayResult<never> => ({
    ok: false,
    // a CLOSED private server (cooling down, or unverified) is a 409 like a full world: the request was fine, the server is not open
    error: relayError(r.code === 'permission-denied' ? 'permission-denied' : r.code === 'not-found' ? 'not-found' : r.code === 'full' || r.code === 'closed' ? 'illegal-transition' : 'validation-failed', r.message),
  });
  const id0 = ids[0] ?? '';
  const id1 = ids[1] ?? '';
  switch (op) {
    /* ---- reads: a view made for the actor, nothing changes */
    case 'snapshot.read':
      return unchanged(state, buildSocialView(state, actorId, nowIso, { developmentPreview: false }));
    case 'profile.read': {
      const view = resolveProfileFor(state, actorId, id0);
      return view === null ? { ok: false, error: relayError('not-found', 'profile not found') } : unchanged(state, view);
    }
    case 'presence.read':
      return unchanged(state, friendIdsOf(state, actorId).map((id) => resolvePresenceFor(state, actorId, id)).filter((p) => p !== null));
    case 'privacy.read_self':
      return unchanged(state, userById(state, actorId)?.privacy ?? null);
    case 'friends.list':
      return unchanged(state, buildSocialView(state, actorId, nowIso, { developmentPreview: false }).friends);
    case 'requests.list':
      return unchanged(state, pendingRequestsFor(state, actorId));
    case 'recent.list':
      return unchanged(state, recentPlayersViewFor(state, actorId));
    case 'conversations.list':
      return unchanged(state, conversationsFor(state, actorId));
    case 'messages.list': {
      const conversation = conversationById(state, id0);
      // a DIRECT conversation across a block is hidden from both (ruling (b)): exactly a missing conversation's answer
      if (conversation === undefined || !conversation.memberIds.includes(actorId) || isWalledDirect(state, conversation, actorId)) {
        return { ok: false, error: relayError('not-found', 'conversation not found') };
      }
      return unchanged(state, messagesOf(state, id0));
    }
    case 'parties.read': {
      const view = partyViewFor(state, actorId, id0);
      return view === null ? { ok: false, error: relayError('not-found', 'party not found') } : unchanged(state, view);
    }
    case 'party_invites.list':
      return unchanged(state, partyInvitesFor(state, actorId, nowIso));
    case 'showcase.read': {
      const view = resolveProfileFor(state, actorId, id0);
      return view === null ? { ok: false, error: relayError('not-found', 'profile not found') } : unchanged(state, { showcaseAgents: view.profile.showcaseAgents, showcaseCompanions: view.profile.showcaseCompanions });
    }
    case 'events.stream':
      // Served by the store's event log (wonderland-social-routes.ts), never through here.
      return invalid('events are read from the stream, not as an operation');
    case 'parties.voice_join':
      // Served by the voice provider's token minter (wonderland-social-routes.ts), never through here: it changes no state.
      return invalid('party voice is joined through the voice route, not as an operation');
    case 'voice.eos_client_config':
      // Served from the bridge's in-memory EOS game-client config (wonderland-social-routes.ts), never through here.
      return invalid('the EOS client config is served by the voice route, not as an operation');

    /* ---- presence & privacy: the actor's own, told to their friends (whose views of the actor change) */
    case 'presence.update_self': {
      const connected = bool(body, 'connected');
      const availability = oneOf(body, 'availability', SOCIAL_AVAILABILITY, false);
      const detail = displayText(body, 'activityDetail', MAX_LABEL, false);
      const signals = readSignals(body.signals);
      const location = body.location === undefined ? ({ ok: true, value: undefined } as const) : readLocation(body.location);
      for (const c of [connected, availability, detail, signals, location]) if (!c.ok) return invalid(c.message);
      const next = updateOwnPresence(
        state,
        actorId,
        {
          connected: (connected as { value: boolean | null }).value ?? undefined,
          availability: (availability as { value: SocialAvailability | null }).value ?? undefined,
          signals: (signals as { value: WonderlandActivitySignals | null }).value ?? undefined,
          activityDetail: body.activityDetail === undefined ? undefined : (detail as { value: string | null }).value,
          location: (location as { value: SocialLocation | null | undefined }).value,
        },
        nowIso,
      );
      // P1, NOTHING INFERRED FROM THE EVENT STREAM (Second, 10-04): told to the actor and to those who could see their presence
      // before OR after the change -- going hidden and coming back are told; a change made while hidden from someone (an activity,
      // a sign-out) is told to nobody else, or its timing would say the hidden player is there.
      if (!next.ok) return next;
      // ONLY WHERE THE VIEW MOVED (the privacy attacker's M3, 10-07): "could see presence" was not enough -- an activity or detail
      // change reached friends whose activityVisibility hides it, its timing a tell. Now the same rule as privacy.update_self.
      return changed(next, null, [actorId, ...viewMoved(state, next.value, actorId, [...friendIdsOf(state, actorId), ...partyMembers(state, actorId)])]);
    }
    case 'privacy.update_self': {
      const patch: Record<string, SocialAudience> = {};
      for (const field of PRIVACY_FIELDS) {
        const c = oneOf(body, field, SOCIAL_AUDIENCES, false);
        if (!c.ok) return invalid(c.message);
        if (c.value !== null) patch[field] = c.value;
      }
      const next = updateOwnPrivacy(state, actorId, patch);
      if (!next.ok) return next;
      // P1, NOTHING INFERRED FROM THE EVENT STREAM (Second's harness at 30a3e864): a privacy change is told to the actor and to
      // the friends and party members whose VIEW of the actor it changes -- the card and its presence and actions, or whether the
      // actor is hidden from them (their world, their Recent Players). A change that moves nothing a viewer can see -- made while
      // hidden from them, say -- is told to nobody else, or its timing would say the hidden player is there.
      return changed(next, null, [actorId, ...viewMoved(state, next.value, actorId, [...friendIdsOf(state, actorId), ...partyMembers(state, actorId)])]);
    }

    /* ---- friends */
    case 'requests.send': {
      const to = str(body, 'toUserId', MAX_LABEL);
      if (!to.ok) return invalid(to.message);
      return changed(sendFriendRequest(state, actorId, to.value as string, nowIso), null, [actorId, to.value as string]);
    }
    case 'requests.accept':
    case 'requests.decline':
    case 'requests.cancel': {
      const request = state.requests.find((r) => r.requestId === id0);
      const rule = op === 'requests.accept' ? acceptFriendRequest : op === 'requests.decline' ? declineFriendRequest : cancelFriendRequest;
      return changed(rule(state, actorId, id0, nowIso), null, request ? [request.fromUserId, request.toUserId] : [actorId]);
    }
    case 'friends.remove':
      return changed(removeFriend(state, actorId, id0), null, [actorId, id0]);
    case 'blocks.add': {
      // F1, the founder's final rule: a block inside a shared party is committed ONLY after the blocker confirmed it.
      // Without `confirmSharedParty: true` it is refused with the founder's own warning and NOTHING changes (no block, no
      // membership change). Confirmed, it applies atomically: the block privacy AND the separation -- the leader removes
      // the blocked member and stays leader; otherwise the blocker leaves and the blocked member stays (separateForBlock).
      // Everybody the change concerns is told it AS THE ORDINARY PARTY CHANGE and nothing more (founder, 10-04): the remaining
      // members, and the blocked member too -- removed (a kick: parties.remove_member, exactly what a leader's removal tells the
      // removed) or left behind by the blocker (parties.leave, exactly what any leave tells those who stay). Outside a shared
      // party, a block that ends a FRIENDSHIP is told exactly as an unfriend is (friends.remove, to both). Nothing names a
      // block; a block that changes nothing the other side can see (a stranger's) keeps its own `blocks.add`, told to the
      // blocker alone.
      const target = str(body, 'targetId', MAX_LABEL);
      if (!target.ok) return invalid(target.message);
      const targetId = target.value as string;
      const confirm = bool(body, 'confirmSharedParty');
      if (!confirm.ok) return invalid(confirm.message);
      const shared = sharedPartyOf(state, actorId, targetId);
      if (shared !== undefined && confirm.value !== true) {
        const warning = sharedPartyBlockWarning(state, actorId, userById(state, targetId)?.profile.displayName ?? 'this player');
        return { ok: false, error: relayError('illegal-transition', `BLOCK_NEEDS_CONFIRMATION: ${warning} Confirm with confirmSharedParty.`) };
      }
      const separated = separateForBlock(state, actorId, targetId);
      if (!separated.ok) return separated;
      const remaining = shared !== undefined ? (partyById(separated.value, shared.partyId)?.members.map((m) => m.userId) ?? []) : [];
      const endsFriendship = areFriends(state, actorId, targetId);
      const told = shared !== undefined || endsFriendship ? [actorId, ...remaining, targetId] : [actorId];
      const blocked = changed(blockUser(separated.value, actorId, targetId, nowIso), null, told);
      if (!blocked.ok) return blocked;
      // A BLOCK SEPARATES A PRIVATE SERVER'S OWNER FROM A MEMBER INSIDE IT, both ways (the founder, 10-04: P4 the owner blocks a
      // member -> the member is removed; P5 a member blocks the owner -> the blocker leaves; the mirror of the party rule). The
      // member is taken out at once, the owner stays, their location clears exactly as a leave clears it, and their own world
      // reports are answered with a context-less view for WORLD_REMOVAL_NOTICE_MS (world.state), which the client words
      // "You can't stay in this server.". Re-entry is refused while the block stands (walledFromOwner). Nothing names the block.
      const memberOut = (ownerId: SocialUserId, memberId: SocialUserId): boolean => {
        const server = world.contexts[`priv_${ownerId}`];
        return server !== undefined && server.kind === 'PRIVATE_SERVER' && server.ownerId === ownerId && server.memberIds.includes(memberId);
      };
      const removedId = memberOut(actorId, targetId) ? targetId : memberOut(targetId, actorId) ? actorId : null;
      let outcome = blocked;
      if (removedId !== null) {
        const cleared = updateOwnPresence(blocked.value.state, removedId, { location: null }, nowIso);
        if (!cleared.ok) return cleared;
        outcome = { ok: true, value: { ...blocked.value, state: cleared.value, world: removeFromPrivateServer(world, removedId, Date.parse(nowIso)) } };
      }
      // LFF REQUESTS THE BLOCK CANCELLED are told to the other side as the ordinary change each now reads as -- to an owner a
      // withdrawal, to a requester the post's deletion (social-lff.ts lffBlockNotices; SEC-M2: silence was itself the tell) --
      // each past the block floor for exactly its one addressee, and logged before the block's own event.
      const notices = lffBlockNotices(state, outcome.value.state, actorId);
      const withLffNotices = (value: SocialCommandOutcome): RelayResult<SocialCommandOutcome> =>
        notices.length === 0
          ? { ok: true, value }
          : { ok: true, value: { ...value, extraEvents: notices, floorExempt: [...(value.floorExempt ?? []), ...notices.flatMap((n) => n.audience)] } };
      // TOLD AS THE ORDINARY CHANGE, NEVER AS A BLOCK: the leader removed a member, the blocker left, or a friendship ended.
      if (shared !== undefined) {
        return withLffNotices({ ...outcome.value, eventOp: shared.leaderId === actorId ? 'parties.remove_member' : 'parties.leave', floorExempt: [targetId] });
      }
      if (endsFriendship) return withLffNotices({ ...outcome.value, eventOp: 'friends.remove', floorExempt: [targetId] });
      return withLffNotices(outcome.value);
    }
    case 'blocks.remove':
      return changed(unblockUser(state, actorId, id0), null, [actorId]);
    case 'mutes.set': {
      const target = str(body, 'targetId', MAX_LABEL);
      const voice = bool(body, 'voice');
      const messages = bool(body, 'messages');
      for (const c of [target, voice, messages]) if (!c.ok) return invalid(c.message);
      return changed(
        setMute(state, actorId, (target as { value: string }).value, { voice: (voice as { value: boolean | null }).value ?? true, messages: (messages as { value: boolean | null }).value ?? true }),
        null,
        [actorId],
      );
    }
    case 'reports.file': {
      const reported = str(body, 'reportedId', MAX_LABEL);
      const reason = oneOf(body, 'reason', SOCIAL_REPORT_REASONS);
      const note = str(body, 'note', MAX_TEXT, false);
      const subjectRef = str(body, 'subjectRef', MAX_LABEL, false);
      for (const c of [reported, reason, note, subjectRef]) if (!c.ok) return invalid(c.message);
      return changed(
        fileReport(
          state,
          actorId,
          {
            reportedId: (reported as { value: string }).value,
            reason: (reason as { value: SocialReportReason }).value,
            note: (note as { value: string | null }).value ?? '',
            subjectRef: (subjectRef as { value: string | null }).value,
          },
          nowIso,
        ),
        null,
        [actorId],
      );
    }

    /* ---- conversations */
    case 'conversations.open': {
      const other = str(body, 'otherUserId', MAX_LABEL);
      if (!other.ok) return invalid(other.message);
      const opened = openDirectConversation(state, actorId, other.value as string, nowIso);
      if (!opened.ok) return opened;
      return { ok: true, value: { state: opened.value.state, data: { conversationId: opened.value.conversationId }, audience: [actorId, other.value as string] } };
    }
    case 'messages.send': {
      // displayText too (CORE, 10-07): the QA harness logs a peer's message body as received (WLSOCIALLIVE LSQ4 / LSQ5 / LSQR1),
      // and the client's composer is one line (Enter sends), so no client of ours ever sends a line break
      const text = displayText(body, 'body', MAX_TEXT);
      const kind = oneOf(body, 'kind', MESSAGE_KINDS, false);
      for (const c of [text, kind]) if (!c.ok) return invalid(c.message);
      const conversation = conversationById(state, id0);
      return changed(
        sendMessage(state, actorId, id0, { kind: ((kind as { value: MessageKind | null }).value ?? 'TEXT') as MessageKind, body: (text as { value: string }).value }, nowIso),
        null,
        conversation?.memberIds ?? [actorId],
      );
    }
    case 'messages.read': {
      const raw = body.sequence;
      if (raw !== undefined && (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0)) return invalid('sequence must be a whole number');
      return changed(markRead(state, actorId, id0, raw as number | undefined), null, [actorId]);
    }

    /* ---- parties: every member before and after hears about it */
    case 'parties.create': {
      const name = displayText(body, 'name', MAX_LABEL, false);
      const privacy = oneOf(body, 'privacy', PARTY_PRIVACIES, false);
      for (const c of [name, privacy]) if (!c.ok) return invalid(c.message);
      const created = createParty(
        state,
        actorId,
        { name: (name as { value: string | null }).value ?? undefined, privacy: (privacy as { value: PartyPrivacy | null }).value ?? undefined },
        nowIso,
      );
      if (!created.ok) return created;
      // A HIDDEN CREATOR TELLS NOBODY (the privacy attacker's M2, 10-07): every friend heard of the new party, including friends the
      // creator is hidden from. Now only friends whose view of the creator moved (an open party they may see, an activity).
      const audience = [actorId, ...viewMoved(state, created.value.state, actorId, friendIdsOf(state, actorId))];
      return { ok: true, value: { state: created.value.state, data: { partyId: created.value.partyId }, audience } };
    }
    case 'parties.join': {
      const next = joinParty(state, actorId, id0, nowIso);
      return changed(next, null, [actorId, ...(partyById(state, id0)?.members.map((m) => m.userId) ?? [])]);
    }
    case 'parties.leave': {
      const before = partyMembers(state, actorId);
      return changed(leaveParty(state, actorId), null, [actorId, ...before]);
    }
    case 'parties.invite': {
      const to = str(body, 'toUserId', MAX_LABEL);
      if (!to.ok) return invalid(to.message);
      const invited = inviteToParty(state, actorId, id0, to.value as string, nowIso);
      if (!invited.ok) return invited;
      return {
        ok: true,
        value: { state: invited.value.state, data: { inviteId: invited.value.inviteId }, audience: [to.value as string, ...(partyById(state, id0)?.members.map((m) => m.userId) ?? [])] },
      };
    }
    case 'parties.remove_member': {
      const before = partyById(state, id0)?.members.map((m) => m.userId) ?? [];
      return changed(removePartyMember(state, actorId, id0, id1), null, [id1, ...before]);
    }
    case 'parties.promote':
      return changed(promotePartyLeader(state, actorId, id0, String(body.memberId ?? '')), null, partyById(state, id0)?.members.map((m) => m.userId) ?? [actorId]);
    case 'parties.rules': {
      const privacy = oneOf(body, 'privacy', PARTY_PRIVACIES, false);
      const permission = oneOf(body, 'invitePermission', PARTY_INVITE_PERMISSIONS, false);
      const name = displayText(body, 'name', MAX_LABEL, false);
      for (const c of [privacy, permission, name]) if (!c.ok) return invalid(c.message);
      const rules: { privacy?: PartyPrivacy; invitePermission?: PartyInvitePermission; name?: string } = {};
      if ((privacy as { value: PartyPrivacy | null }).value !== null) rules.privacy = (privacy as { value: PartyPrivacy }).value;
      if ((permission as { value: PartyInvitePermission | null }).value !== null) rules.invitePermission = (permission as { value: PartyInvitePermission }).value;
      if ((name as { value: string | null }).value !== null) rules.name = (name as { value: string }).value;
      return changed(setPartyRules(state, actorId, id0, rules), null, partyById(state, id0)?.members.map((m) => m.userId) ?? [actorId]);
    }
    case 'parties.self_mute': {
      const muted = bool(body, 'muted');
      if (!muted.ok || muted.value === null) return invalid(muted.ok ? 'muted is required' : muted.message);
      return changed(setSelfMuted(state, actorId, muted.value), null, partyMembers(state, actorId).length > 0 ? partyMembers(state, actorId) : [actorId]);
    }
    case 'party_invites.accept': {
      const invite = state.partyInvites.find((i) => i.inviteId === id0);
      const members = invite ? (partyById(state, invite.partyId)?.members.map((m) => m.userId) ?? []) : [];
      return changed(acceptPartyInvite(state, actorId, id0, nowIso), null, [actorId, ...members]);
    }
    /* ---- MULTIPLAYER PHASE 1: the shared presence layer (world-presence.ts) */
    case 'world.read':
      return { ok: true, value: { state, world, data: worldViewFor(world, state, actorId, nowMs, servers), audience: [] } };
    case 'world.join': {
      const kind = oneOf(body, 'target', ['PUBLIC', 'PRIVATE', 'FRIEND', 'INVITE', 'PARTY'] as const);
      if (!kind.ok) return invalid(kind.message);
      const text = (field: string) => (typeof body[field] === 'string' ? (body[field] as string) : '');
      // A PRIVATE SERVER'S NAME is its owner's text, shown wherever the location travels and logged by the clients that join it
      // ("WLWORLD joined"): no control character (displayText's rule). Everything else about it stays the domain's (trimmed, cut
      // to 60, else the neutral name). The other targets carry no text a person reads: a public place is a safe id, and its
      // placeName is ignored (the server names a public world from that id).
      // ... and no C1 control either (U+0080-U+009F): migration 037 stores the name, and its CHECK refuses every control character, so
      // the rule is the same in memory and on PostgreSQL (the private-server review's m2, 10-11)
      if (kind.value === 'PRIVATE' && (hasControlCharacter(text('name')) || hasC1Control(text('name')))) return invalid(controlRefusal('name'));
      const target: WorldJoinTarget =
        kind.value === 'PUBLIC' ? { kind: 'PUBLIC', place: text('place') || 'golden_arrival', placeName: text('placeName') || 'Golden Arrival' }
        : kind.value === 'PRIVATE' ? { kind: 'PRIVATE', name: text('name') }
        : kind.value === 'FRIEND' ? { kind: 'FRIEND', userId: text('userId') }
        : kind.value === 'INVITE' ? { kind: 'INVITE', inviteId: text('inviteId') }
        : { kind: 'PARTY' };
      const joined = joinWorld(world, state, actorId, target, nowMs, servers);
      if (!joined.ok) return worldFail(joined);
      // THE OWNER'S OPEN moved their cycle (a new Free window, a continuous opening, a lapse put on the Free clock, a rename): the
      // store persists that record with this operation, or nothing happens. The view shows the access AFTER the open.
      const opened = kind.value === 'PRIVATE' && servers !== null && servers.open !== undefined && servers.open.ok ? servers.open : undefined;
      const viewGate: PrivateServerGate | null = opened === undefined ? servers : { ownerId: actorId, access: opened.access };
      // WHERE THEY ARE becomes their presence location, through the one presence authority -- so friends see it as their
      // privacy allows, and a friend's server-join rule has a place to admit them to.
      const ctx = joined.value.context;
      const located = updateOwnPresence(
        state,
        actorId,
        { connected: true, location: { serverId: ctx.contextId, serverKind: ctx.kind, serverName: ctx.serverName, placeLabel: null, nationId: null } },
        nowIso,
      );
      if (!located.ok) return located;
      // PLAYED TOGETHER (R16 rehearsal 10-04: two real players shared Golden Arrival and neither appeared in the other's Recent
      // Players, so a person met in the world could never be added -- only a party recorded anybody): everyone live in the
      // context they just joined, both ways, through the one rule (nothing across a block; the separate opt-out is gone: P3).
      // EACH DIRECTION ONLY WHERE THE OWNER COULD SEE THEM ONLINE (Second's review of 7024e331): a player whose presence is hidden
      // from strangers (presenceVisibility, or appearing offline) leaves no durable "met at T" in a stranger's list -- the row
      // would prove they were online when their own setting says nobody may know. The presence authority decides.
      let met = located.value;
      const seesOnline = (ownerId: SocialUserId, userId: SocialUserId) => (resolvePresenceFor(met, ownerId, userId)?.onlineState ?? 'OFFLINE') !== 'OFFLINE';
      for (const otherId of ctx.memberIds) {
        if (otherId === actorId) continue;
        // NO STORED LABEL NAMES A PERSON (social-contracts.ts; Second's R16 review, 10-04): a private server's name is its owner's
        // text and travels with the owner's own sharing rules; the durable row keeps only that it was a private server.
        const label = ctx.kind === 'PRIVATE_SERVER' ? 'Private server' : ctx.serverName.slice(0, 80);
        const recorded = recordPlayedTogether(met, actorId, otherId, 'SESSION', label, nowIso, seesOnline);
        if (recorded.ok) met = recorded.value;
      }
      return {
        ok: true,
        value: {
          state: met,
          world: joined.value.world,
          data: worldViewFor(joined.value.world, met, actorId, nowMs, viewGate),
          ...(opened !== undefined && opened.write ? { serverWrite: opened.record } : {}),
          // told only to whoever may see the actor (the founder, 10-04, P1): a hidden arrival moves nobody's view, so nobody is told
          // (M3, 10-07) the people IN the world see the arrival through worldViewFor (P1-filtered); a friend elsewhere is told
          // only when their view of the actor moved -- one who may not see the actor's location learns no move from its timing
          audience: [actorId, ...ctx.memberIds.filter((id) => id !== actorId && !presenceHiddenFrom(met, id, actorId)),
            ...viewMoved(state, met, actorId, friendIdsOf(state, actorId).filter((id) => !ctx.memberIds.includes(id)))],
        },
      };
    }
    case 'world.leave': {
      const before = contextOf(world, actorId);
      const left = leaveWorld(world, actorId);
      const located = updateOwnPresence(state, actorId, { location: null }, nowIso);
      if (!located.ok) return located;
      const inside = (before?.memberIds ?? []).filter((id) => id !== actorId && !presenceHiddenFrom(located.value, id, actorId));
      const friendsMoved = viewMoved(state, located.value, actorId, friendIdsOf(state, actorId).filter((id) => !inside.includes(id)));
      return { ok: true, value: { state: located.value, world: left, data: null, audience: [actorId, ...inside, ...friendsMoved] } };
    }
    case 'world.state': {
      const motion = oneOf(body, 'motion', WORLD_MOTIONS);
      const skin = str(body, 'skinId', 40);
      for (const c of [motion, skin]) if (!c.ok) return invalid(c.message);
      const num = (field: string) => (typeof body[field] === 'number' ? (body[field] as number) : Number.NaN);
      // SEPARATED BY A BLOCK (P4/P5): the removed player's own tick is ANSWERED with a view that has no context -- the client's
      // sign of a removal (CORE's client contract: it had a private server, now none, while it wanted to stay -> "You can't stay
      // in this server." and back to the public world). An answer, never an error, and it names nothing.
      if (recentlyRemoved(world, actorId, nowMs)) return { ok: true, value: { state, data: worldViewFor(world, state, actorId, nowMs), audience: [] } };
      // A PRIVATE SERVER THAT IS NO LONGER OPEN (its Free window ended -- by the server's clock, whoever reports -- or its state could
      // not be verified) CLOSES for everyone in it, on the first report that finds it so. Answered, never an error: the view has no
      // context and says when the server may open again; the client takes its player back to the public world.
      const here = contextOf(world, actorId);
      if (here !== undefined && !privateServerAdmits(here, servers)) {
        const reopensAtMs = servers !== null && servers.ownerId === here.ownerId ? servers.access.cooldownUntilMs : null;
        const closed = closePrivateServer(world, here.contextId, reopensAtMs, nowMs);
        // EVERY MEMBER'S LOCATION CLEARS, exactly as a leave clears it (review m1): nobody stays "in" a closed server in a friend's
        // list, and on PostgreSQL the cleared location is what persists. Told to each member and to the friends whose view moved.
        let cleared = state;
        const told: SocialUserId[] = [];
        for (const memberId of here.memberIds) {
          const moved = updateOwnPresence(cleared, memberId, { location: null }, nowIso);
          if (!moved.ok) continue;
          told.push(memberId, ...viewMoved(cleared, moved.value, memberId, friendIdsOf(cleared, memberId).filter((id) => !here.memberIds.includes(id))));
          cleared = moved.value;
        }
        return {
          ok: true,
          value: {
            state: cleared,
            world: closed,
            data: worldViewFor(closed, cleared, actorId, nowMs),
            audience: [...new Set(told)],
            ...(here.ownerId === null ? {} : { closedServerOf: here.ownerId }),
          },
        };
      }
      const reported = reportAvatar(
        world,
        actorId,
        { x: num('x'), y: num('y'), z: num('z'), yaw: num('yaw'), speed: num('speed'), motion: (motion as { value: WorldMotion }).value, skinId: (skin as { value: string }).value },
        nowMs,
      );
      if (!reported.ok) return worldFail(reported);
      // ONE CALL A TICK: the report answers with the view, so a client reporting ~5 a second needs nothing else to see the others.
      return { ok: true, value: { state, world: reported.value, data: worldViewFor(reported.value, state, actorId, nowMs, servers), audience: [] } };
    }
    case 'world.invite': {
      const to = str(body, 'toUserId', MAX_LABEL);
      if (!to.ok) return invalid(to.message);
      const invited = inviteToWorld(world, state, actorId, to.value as string, nowMs, servers);
      if (!invited.ok) return worldFail(invited);
      // an invitation the owner's wall stops is answered alike but reaches nobody (world-presence.ts walledFromOwner)
      return { ok: true, value: { state, world: invited.value.world, data: { inviteId: invited.value.inviteId }, audience: invited.value.delivered ? [to.value as string] : [] } };
    }
    case 'party_invites.decline': {
      const invite = state.partyInvites.find((i) => i.inviteId === id0);
      return changed(declinePartyInvite(state, actorId, id0), null, invite ? [actorId, invite.fromUserId] : [actorId]);
    }

    /* ---- LFF, the Looking For Feed (social-lff.ts): its own bounded reads, never the snapshot; each write told only to whom it
     *      concerns (create and edit: the owner; close and delete: the owner and live requesters; a request: requester and owner) */
    case 'lff.feed.list': {
      const filter = readLffFeedFilter(input);
      if (!filter.ok) return invalid(filter.message);
      return unchanged(state, lffFeedFor(state, actorId, filter.value, nowMs, row));
    }
    case 'lff.post.get': {
      const known = onlyFields(input, []);
      if (!known.ok) return invalid(known.message);
      const view = lffPostFor(state, actorId, id0, nowMs, row);
      return view === null ? { ok: false, error: lffNotFound() } : unchanged(state, view);
    }
    case 'lff.requests.mine': {
      const known = onlyFields(input, []);
      if (!known.ok) return invalid(known.message);
      return unchanged(state, lffRequestsMineFor(state, actorId, nowMs, row));
    }
    case 'lff.requests.forPost': {
      const known = onlyFields(input, []);
      if (!known.ok) return invalid(known.message);
      const view = lffRequestsForPost(state, actorId, id0, row);
      return view.ok ? unchanged(state, view.value) : view;
    }
    case 'lff.post.create': {
      const known = onlyFields(input, LFF_POST_FIELDS);
      if (!known.ok) return invalid(known.message);
      const read = readLffPost(body, false);
      if (!read.ok) return invalid(read.message);
      const p = read.value;
      const fields: LffPostFields = {
        category: p.category!,
        title: p.title!,
        description: p.description ?? '',
        projectLabel: p.projectLabel ?? '',
        skills: p.skills ?? [],
        openSlots: p.openSlots!,
      };
      const created = createLffPost(state, actorId, fields, nowMs);
      return created.ok ? lffChanged(created.value, { postId: created.value.postId }) : created;
    }
    case 'lff.post.edit': {
      const known = onlyFields(input, LFF_POST_FIELDS);
      if (!known.ok) return invalid(known.message);
      const read = readLffPost(body, true);
      if (!read.ok) return invalid(read.message);
      if (Object.keys(read.value).length === 0) return invalid('nothing to change: send at least one field');
      return lffResult(editLffPost(state, actorId, id0, read.value, nowMs), null);
    }
    case 'lff.post.close': {
      const known = onlyFields(input, []);
      if (!known.ok) return invalid(known.message);
      return lffResult(closeLffPost(state, actorId, id0, nowMs), null);
    }
    case 'lff.post.delete': {
      const known = onlyFields(input, []);
      if (!known.ok) return invalid(known.message);
      return lffResult(deleteLffPost(state, actorId, id0), null);
    }
    case 'lff.request.create': {
      const known = onlyFields(input, ['message']);
      if (!known.ok) return invalid(known.message);
      const message = lffText(body.message, 'message', 0, LFF_MESSAGE_MAX, false);
      if (!message.ok) return invalid(message.message);
      const asked = createLffRequest(state, actorId, id0, message.value ?? '', nowMs);
      return asked.ok ? lffChanged(asked.value, { requestId: asked.value.requestId }) : asked;
    }
    case 'lff.request.withdraw':
    case 'lff.request.accept':
    case 'lff.request.decline': {
      const known = onlyFields(input, []);
      if (!known.ok) return invalid(known.message);
      const rule = op === 'lff.request.withdraw' ? withdrawLffRequest : op === 'lff.request.accept' ? acceptLffRequest : declineLffRequest;
      return lffResult(rule(state, actorId, id0, nowMs), null);
    }
    default: {
      const never: never = op;
      return invalid(`unknown operation ${String(never)}`);
    }
  }
}

