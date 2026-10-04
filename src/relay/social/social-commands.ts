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
import { deriveActivity, resolvePresenceFor, resolveProfileFor, type WonderlandActivitySignals } from './social-presence';
import { buildSocialView } from './social-preview';
import { areFriends, blockedEitherWay, friendIdsOf, partyOf, type SocialState } from './social-state';
import {
  WORLD_MOTIONS,
  contextOf,
  emptyWorldState,
  inviteToWorld,
  joinWorld,
  leaveWorld,
  reportAvatar,
  worldViewFor,
  type WorldJoinTarget,
  type WorldMotion,
  type WorldState,
} from './world-presence';

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
  const trimmed = value.trim();
  if (required && trimmed.length === 0) return { ok: false, message: `${field} must not be empty` };
  if (trimmed.length > max) return { ok: false, message: `${field} is longer than ${max} characters` };
  return { ok: true, value: trimmed };
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
  const user = state.users[actorId];
  if (user === undefined) return { ok: false, error: relayError('not-found', 'user not found') };
  const party = partyOf(state, actorId);
  const current = user.presence;
  const connected = input.connected ?? current.connected;
  const activity = input.signals !== undefined ? deriveActivity({ ...input.signals, inParty: party !== undefined }) : current.activity;
  const presence = {
    ...current,
    connected,
    availability: input.availability ?? current.availability,
    activity,
    activityDetail: input.activityDetail !== undefined ? input.activityDetail : current.activityDetail,
    location: input.location !== undefined ? input.location : current.location,
    partyId: party?.partyId ?? null,
    lastSeenAtIso: connected ? atIso : current.lastSeenAtIso,
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
  const user = state.users[actorId];
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
  const serverId = str(body, 'serverId', MAX_LABEL);
  const serverKind = oneOf(body, 'serverKind', SOCIAL_SERVER_KINDS);
  const serverName = str(body, 'serverName', MAX_LABEL);
  const placeLabel = str(body, 'placeLabel', MAX_LABEL, false);
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
): RelayResult<SocialCommandOutcome> {
  const outcome = applyOne(reconcileBlockedParties(state), op, actorId, input, nowIso, world);
  if (!outcome.ok || outcome.value.audience.length === 0) return outcome;
  const after = outcome.value.state;
  const exempt = new Set(outcome.value.floorExempt ?? []);
  const audience = outcome.value.audience.filter((id) => id === actorId || exempt.has(id) || !blockedEitherWay(after, actorId, id));
  return { ok: true, value: { ...outcome.value, audience } };
}

function applyOne(
  state: SocialState,
  op: SocialOperationId,
  actorId: SocialUserId,
  input: SocialCommandInput,
  nowIso: string,
  world: WorldState,
): RelayResult<SocialCommandOutcome> {
  const { ids, body } = input;
  const nowMs = Date.parse(nowIso);
  const worldFail = (r: { code: string; message: string }): RelayResult<never> => ({
    ok: false,
    error: relayError(r.code === 'permission-denied' ? 'permission-denied' : r.code === 'not-found' ? 'not-found' : r.code === 'full' ? 'illegal-transition' : 'validation-failed', r.message),
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
      return unchanged(state, state.users[actorId]?.privacy ?? null);
    case 'friends.list':
      return unchanged(state, buildSocialView(state, actorId, nowIso, { developmentPreview: false }).friends);
    case 'requests.list':
      return unchanged(state, pendingRequestsFor(state, actorId));
    case 'recent.list':
      return unchanged(state, recentPlayersViewFor(state, actorId));
    case 'conversations.list':
      return unchanged(state, conversationsFor(state, actorId));
    case 'messages.list': {
      const conversation = state.conversations[id0];
      // a DIRECT conversation across a block is hidden from both (ruling (b)): exactly a missing conversation's answer
      if (conversation === undefined || !conversation.memberIds.includes(actorId) || isWalledDirect(state, conversation, actorId)) {
        return { ok: false, error: relayError('not-found', 'conversation not found') };
      }
      return unchanged(state, state.messages[id0] ?? []);
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

    /* ---- presence & privacy: the actor's own, told to their friends (whose views of the actor change) */
    case 'presence.update_self': {
      const connected = bool(body, 'connected');
      const availability = oneOf(body, 'availability', SOCIAL_AVAILABILITY, false);
      const detail = str(body, 'activityDetail', MAX_LABEL, false);
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
      return changed(next, null, [actorId, ...friendIdsOf(state, actorId), ...partyMembers(state, actorId)]);
    }
    case 'privacy.update_self': {
      const patch: Record<string, SocialAudience> = {};
      for (const field of PRIVACY_FIELDS) {
        const c = oneOf(body, field, SOCIAL_AUDIENCES, false);
        if (!c.ok) return invalid(c.message);
        if (c.value !== null) patch[field] = c.value;
      }
      return changed(updateOwnPrivacy(state, actorId, patch), null, [actorId, ...friendIdsOf(state, actorId)]);
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
        const warning = sharedPartyBlockWarning(state, actorId, state.users[targetId]?.profile.displayName ?? 'this player');
        return { ok: false, error: relayError('illegal-transition', `BLOCK_NEEDS_CONFIRMATION: ${warning} Confirm with confirmSharedParty.`) };
      }
      const separated = separateForBlock(state, actorId, targetId);
      if (!separated.ok) return separated;
      const remaining = shared !== undefined ? (separated.value.parties[shared.partyId]?.members.map((m) => m.userId) ?? []) : [];
      const endsFriendship = areFriends(state, actorId, targetId);
      const told = shared !== undefined || endsFriendship ? [actorId, ...remaining, targetId] : [actorId];
      const outcome = changed(blockUser(separated.value, actorId, targetId, nowIso), null, told);
      if (!outcome.ok) return outcome;
      // TOLD AS THE ORDINARY CHANGE, NEVER AS A BLOCK: the leader removed a member, the blocker left, or a friendship ended.
      if (shared !== undefined) {
        return {
          ok: true,
          value: { ...outcome.value, eventOp: shared.leaderId === actorId ? 'parties.remove_member' : 'parties.leave', floorExempt: [targetId] },
        };
      }
      if (endsFriendship) return { ok: true, value: { ...outcome.value, eventOp: 'friends.remove', floorExempt: [targetId] } };
      return outcome;
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
      const text = str(body, 'body', MAX_TEXT);
      const kind = oneOf(body, 'kind', MESSAGE_KINDS, false);
      for (const c of [text, kind]) if (!c.ok) return invalid(c.message);
      const conversation = state.conversations[id0];
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
      const name = str(body, 'name', MAX_LABEL, false);
      const privacy = oneOf(body, 'privacy', PARTY_PRIVACIES, false);
      for (const c of [name, privacy]) if (!c.ok) return invalid(c.message);
      const created = createParty(
        state,
        actorId,
        { name: (name as { value: string | null }).value ?? undefined, privacy: (privacy as { value: PartyPrivacy | null }).value ?? undefined },
        nowIso,
      );
      if (!created.ok) return created;
      return { ok: true, value: { state: created.value.state, data: { partyId: created.value.partyId }, audience: [actorId, ...friendIdsOf(state, actorId)] } };
    }
    case 'parties.join': {
      const next = joinParty(state, actorId, id0, nowIso);
      return changed(next, null, [actorId, ...(state.parties[id0]?.members.map((m) => m.userId) ?? [])]);
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
        value: { state: invited.value.state, data: { inviteId: invited.value.inviteId }, audience: [to.value as string, ...(state.parties[id0]?.members.map((m) => m.userId) ?? [])] },
      };
    }
    case 'parties.remove_member': {
      const before = state.parties[id0]?.members.map((m) => m.userId) ?? [];
      return changed(removePartyMember(state, actorId, id0, id1), null, [id1, ...before]);
    }
    case 'parties.promote':
      return changed(promotePartyLeader(state, actorId, id0, String(body.memberId ?? '')), null, state.parties[id0]?.members.map((m) => m.userId) ?? [actorId]);
    case 'parties.rules': {
      const privacy = oneOf(body, 'privacy', PARTY_PRIVACIES, false);
      const permission = oneOf(body, 'invitePermission', PARTY_INVITE_PERMISSIONS, false);
      const name = str(body, 'name', MAX_LABEL, false);
      for (const c of [privacy, permission, name]) if (!c.ok) return invalid(c.message);
      const rules: { privacy?: PartyPrivacy; invitePermission?: PartyInvitePermission; name?: string } = {};
      if ((privacy as { value: PartyPrivacy | null }).value !== null) rules.privacy = (privacy as { value: PartyPrivacy }).value;
      if ((permission as { value: PartyInvitePermission | null }).value !== null) rules.invitePermission = (permission as { value: PartyInvitePermission }).value;
      if ((name as { value: string | null }).value !== null) rules.name = (name as { value: string }).value;
      return changed(setPartyRules(state, actorId, id0, rules), null, state.parties[id0]?.members.map((m) => m.userId) ?? [actorId]);
    }
    case 'parties.self_mute': {
      const muted = bool(body, 'muted');
      if (!muted.ok || muted.value === null) return invalid(muted.ok ? 'muted is required' : muted.message);
      return changed(setSelfMuted(state, actorId, muted.value), null, partyMembers(state, actorId).length > 0 ? partyMembers(state, actorId) : [actorId]);
    }
    case 'party_invites.accept': {
      const invite = state.partyInvites.find((i) => i.inviteId === id0);
      const members = invite ? (state.parties[invite.partyId]?.members.map((m) => m.userId) ?? []) : [];
      return changed(acceptPartyInvite(state, actorId, id0, nowIso), null, [actorId, ...members]);
    }
    /* ---- MULTIPLAYER PHASE 1: the shared presence layer (world-presence.ts) */
    case 'world.read':
      return { ok: true, value: { state, world, data: worldViewFor(world, state, actorId, nowMs), audience: [] } };
    case 'world.join': {
      const kind = oneOf(body, 'target', ['PUBLIC', 'PRIVATE', 'FRIEND', 'INVITE', 'PARTY'] as const);
      if (!kind.ok) return invalid(kind.message);
      const text = (field: string) => (typeof body[field] === 'string' ? (body[field] as string) : '');
      const target: WorldJoinTarget =
        kind.value === 'PUBLIC' ? { kind: 'PUBLIC', place: text('place') || 'golden_arrival', placeName: text('placeName') || 'Golden Arrival' }
        : kind.value === 'PRIVATE' ? { kind: 'PRIVATE', name: text('name') }
        : kind.value === 'FRIEND' ? { kind: 'FRIEND', userId: text('userId') }
        : kind.value === 'INVITE' ? { kind: 'INVITE', inviteId: text('inviteId') }
        : { kind: 'PARTY' };
      const joined = joinWorld(world, state, actorId, target, nowMs);
      if (!joined.ok) return worldFail(joined);
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
      // context they just joined, both ways, through the one rule (nothing across a block; not into anyone's list who opted out).
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
          data: worldViewFor(joined.value.world, met, actorId, nowMs),
          audience: [actorId, ...friendIdsOf(state, actorId), ...ctx.memberIds],
        },
      };
    }
    case 'world.leave': {
      const before = contextOf(world, actorId);
      const left = leaveWorld(world, actorId);
      const located = updateOwnPresence(state, actorId, { location: null }, nowIso);
      if (!located.ok) return located;
      return { ok: true, value: { state: located.value, world: left, data: null, audience: [actorId, ...friendIdsOf(state, actorId), ...(before?.memberIds ?? [])] } };
    }
    case 'world.state': {
      const motion = oneOf(body, 'motion', WORLD_MOTIONS);
      const skin = str(body, 'skinId', 40);
      for (const c of [motion, skin]) if (!c.ok) return invalid(c.message);
      const num = (field: string) => (typeof body[field] === 'number' ? (body[field] as number) : Number.NaN);
      const reported = reportAvatar(
        world,
        actorId,
        { x: num('x'), y: num('y'), z: num('z'), yaw: num('yaw'), speed: num('speed'), motion: (motion as { value: WorldMotion }).value, skinId: (skin as { value: string }).value },
        nowMs,
      );
      if (!reported.ok) return worldFail(reported);
      // ONE CALL A TICK: the report answers with the view, so a client reporting ~5 a second needs nothing else to see the others.
      return { ok: true, value: { state, world: reported.value, data: worldViewFor(reported.value, state, actorId, nowMs), audience: [] } };
    }
    case 'world.invite': {
      const to = str(body, 'toUserId', MAX_LABEL);
      if (!to.ok) return invalid(to.message);
      const invited = inviteToWorld(world, state, actorId, to.value as string, nowMs);
      if (!invited.ok) return worldFail(invited);
      // an invitation the owner's wall stops is answered alike but reaches nobody (world-presence.ts walledFromOwner)
      return { ok: true, value: { state, world: invited.value.world, data: { inviteId: invited.value.inviteId }, audience: invited.value.delivered ? [to.value as string] : [] } };
    }
    case 'party_invites.decline': {
      const invite = state.partyInvites.find((i) => i.inviteId === id0);
      return changed(declinePartyInvite(state, actorId, id0), null, invite ? [actorId, invite.fromUserId] : [actorId]);
    }
    default: {
      const never: never = op;
      return invalid(`unknown operation ${String(never)}`);
    }
  }
}

