import { describe, expect, it } from 'vitest';
import {
  NEVER_SOCIAL_CONCERNS,
  PARTY_INVITE_TTL_MS,
  VOICE_TRANSPORT_PENDING,
  acceptFriendRequest,
  acceptPartyInvite,
  blockUser,
  cancelFriendRequest,
  conversationsFor,
  createLocalVoiceHarness,
  createParty,
  createUnavailableVoiceService,
  declineFriendRequest,
  deriveActivity,
  inviteToParty,
  joinParty,
  leaveParty,
  markRead,
  openDirectConversation,
  partyInvitesFor,
  partyOf,
  partyById,
  partyViewFor,
  pendingRequestsFor,
  promotePartyLeader,
  recentPlayersFor,
  removeFriend,
  removePartyMember,
  resolvePresenceFor,
  resolveProfileFor,
  sendFriendRequest,
  sendMessage,
  setMute,
  setSelfMuted,
  totalUnread,
  unblockUser,
  unreadCount,
  voiceAudienceFor,
  type SocialOperationId,
  type SocialState,
  type UserPresence,
} from './index';
import { FIXTURE_NOW, FIXTURE_USERS as U, createSocialFixture } from './social-fixtures';
import { applySocialOperation } from './social-commands';
import type { RelayResult } from '../protocol/errors';

const T = (minutes: number) => new Date(Date.parse(FIXTURE_NOW) + minutes * 60_000).toISOString();

function must<T>(r: RelayResult<T>): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function withPresence(s: SocialState, userId: string, patch: Partial<UserPresence>): SocialState {
  const u = s.users[userId];
  return { ...s, users: { ...s.users, [userId]: { ...u, presence: { ...u.presence, ...patch } } } };
}

/** Every key anywhere in a value, recursively -- to prove a forbidden concern is ABSENT, not just empty. */
function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

describe('the profile', () => {
  it('opens another user with their primary Compound AI Agent, Relay Dog, companion and pending rank/level', () => {
    const s = createSocialFixture();
    const view = resolveProfileFor(s, U.KAI, U.RHEA)!;
    expect(view.profile.primaryAgent?.displayName).toBe('Julius');
    expect(view.profile.primaryAgent?.kind).toBe('JULIUS');
    expect(view.profile.relayDog.skinId).toBe('baal');
    expect(view.profile.relayDog.flame).toBe('#7FD4FF');
    expect(view.profile.activeCompanion?.kind).toBe('LLM_COMPANION');
    // No ledger exists: rank and level are PENDING, never invented, and the Dog's chosen tier is not a rank.
    expect(view.profile.progression).toEqual({ source: 'PENDING', rank: null, level: null });
    expect(view.relationship).toBe('FRIEND');
    expect(view.mutualFriendIds).toEqual([U.NOVA]);
  });

  it('shows the owner\'s other visible agents and companions, with provisional ratings flagged', () => {
    const s = createSocialFixture();
    const own = resolveProfileFor(s, U.NOVA, U.KAI)!;
    expect(own.profile.showcaseAgents.map((a) => a.displayName)).toEqual(['Forge']);
    expect(own.profile.showcaseAgents[0].ratings[0].provisional).toBe(true);
    expect(own.profile.showcaseCompanions.map((c) => c.displayName)).toEqual(['Jhinn']);
  });

  it('never carries credentials, prompts, Brain, mission or wallet data in any social view', () => {
    const s = createSocialFixture();
    const keys = new Set<string>();
    for (const viewer of Object.values(U)) {
      for (const subject of Object.values(U)) {
        allKeys(resolveProfileFor(s, viewer, subject), keys);
        allKeys(resolvePresenceFor(s, viewer, subject), keys);
      }
      allKeys(conversationsFor(s, viewer), keys);
    }
    for (const forbidden of NEVER_SOCIAL_CONCERNS) expect(keys.has(forbidden)).toBe(false);
  });

  it('opens the same profile from Friends, Messages and Party (one resolver, one answer)', () => {
    const s = createSocialFixture();
    const fromFriends = resolveProfileFor(s, U.KAI, U.NOVA);
    const fromMessages = resolveProfileFor(s, U.KAI, conversationsFor(s, U.KAI)[0].otherUserId!);
    const party = partyOf(s, U.ORION)!;
    const fromParty = resolveProfileFor(s, U.KAI, party.members.find((m) => m.userId === U.LYRA)!.userId);
    expect(fromMessages).toEqual(fromFriends);
    expect(fromParty?.profile.userId).toBe(U.LYRA);
  });
});

describe('presence: one authority', () => {
  it('derives one activity by one precedence', () => {
    const none = { inGveBattle: false, runningMission: false, juliusWorking: false, creating: null, inPrivateServer: false, inParty: false, exploring: false } as const;
    expect(deriveActivity({ ...none, inGveBattle: true, runningMission: true, juliusWorking: true })).toBe('IN_GVE');
    expect(deriveActivity({ ...none, runningMission: true, juliusWorking: true })).toBe('RUNNING_MISSION');
    expect(deriveActivity({ ...none, creating: 'GAME', juliusWorking: true })).toBe('DEVELOPING_GAME');
    expect(deriveActivity({ ...none, juliusWorking: true, exploring: true })).toBe('WORKING_WITH_JULIUS');
    expect(deriveActivity({ ...none, inParty: true })).toBe('IN_PARTY');
    expect(deriveActivity(none)).toBe('IDLE');
  });

  it('shows the founder\'s headlines for online, offline, away, busy, GVE, creating and Julius', () => {
    const s = createSocialFixture();
    expect(resolvePresenceFor(s, U.KAI, U.ORION)!.headline).toBe('IN GVE');
    expect(resolvePresenceFor(s, U.KAI, U.NOVA)!.headline).toBe('CREATING');
    expect(resolvePresenceFor(s, U.KAI, U.NOVA)!.activityLabel).toBe('Creating software · Weather dashboard');
    expect(resolvePresenceFor(s, U.KAI, U.JUNO)!.headline).toBe('OFFLINE');
    expect(resolvePresenceFor(s, U.KAI, U.JUNO)!.lastSeenAtIso).toBe(T(-180));
    expect(resolvePresenceFor(s, U.KAI, U.LYRA)!.headline).toBe('BUSY');
    expect(resolvePresenceFor(s, U.NOVA, U.KAI)!.headline).toBe('WORKING WITH JULIUS');
  });

  it('propagates one change to every surface at once', () => {
    let s = createSocialFixture();
    s = withPresence(s, U.NOVA, { activity: 'RUNNING_MISSION', activityDetail: null });
    const presence = resolvePresenceFor(s, U.KAI, U.NOVA)!;
    const profile = resolveProfileFor(s, U.KAI, U.NOVA)!;
    expect(presence.headline).toBe('IN MISSION');
    expect(profile.presence).toEqual(presence);
    expect(conversationsFor(s, U.KAI)[0].otherUserId).toBe(U.NOVA); // the Messages row draws this same view
  });

  it('APPEAR_OFFLINE is OFFLINE to everybody else, with the last-seen frozen when they hid: no fresh time, no tell-tale null', () => {
    const s = createSocialFixture();
    const sol = resolvePresenceFor(s, U.KAI, U.SOL)!;
    expect(sol.onlineState).toBe('OFFLINE');
    // (10-07, the privacy attacker's M1) a null here, and only here, told every friend "online and hiding from you"
    expect(sol.lastSeenAtIso).toBe(s.users[U.SOL].presence.lastSeenAtIso);
    expect(resolvePresenceFor(s, U.SOL, U.SOL)!.onlineState).toBe('ONLINE');
  });
});

describe('privacy hides restricted activity and location', () => {
  it('a private server stays hidden from a friend when its owner says NOBODY, and cannot be joined', () => {
    const s = createSocialFixture();
    const rhea = resolvePresenceFor(s, U.KAI, U.RHEA)!;
    expect(rhea.onlineState).toBe('ONLINE');
    expect(rhea.location).toBeNull();
    expect(rhea.activityLabel).toBeNull();
    expect(rhea.headline).toBe('ONLINE');
    expect(rhea.can.joinServer).toBe(false);
    expect(rhea.restrictedReason).toBe('PRIVATE');
  });

  it('a stranger sees that somebody is online, not what they are doing or where', () => {
    const s = createSocialFixture();
    const vega = resolvePresenceFor(s, U.KAI, U.VEGA)!;
    expect(vega.onlineState).toBe('ONLINE');
    expect(vega.activityLabel).toBeNull();
    expect(vega.location).toBeNull();
    expect(vega.can.message).toBe(false); // FRIENDS-only messages
    expect(vega.restrictedReason).toBe('FRIENDS_ONLY');
  });

  it('a public GVE player is visible to everybody, by their own choice', () => {
    const s = createSocialFixture();
    expect(resolvePresenceFor(s, U.VEGA, U.ORION)!.location?.serverName).toBe('GVE Arena 7');
  });
});

describe('blocks', () => {
  it('a blocked user sees the blocker OFFLINE with nothing else -- as an ordinary private stranger, never as BLOCKED', () => {
    const s = createSocialFixture();
    const mira = resolvePresenceFor(s, U.KAI, U.MIRA)!;
    expect(mira.onlineState).toBe('OFFLINE');
    expect(mira.activityLabel).toBeNull();
    expect(mira.location).toBeNull();
    expect(mira.lastSeenAtIso).toBeNull();
    // founder, 10-04: nothing shown to the blocked side names the block; it reads as a stranger who shares nothing
    expect(mira.restrictedReason).toBe('PRIVATE');
    expect(mira.can.message).toBe(false);
    expect(mira.can.sendFriendRequest).toBe(false);
    const card = resolveProfileFor(s, U.KAI, U.MIRA);
    expect(card?.relationship).toBe('NONE');
    expect(card?.mutualFriendIds).toEqual([]);
    expect(card?.partyStatus).toEqual({ inParty: false, memberCount: null, joinable: false });
  });

  it('blocking ends the friendship, the requests, messages and invites both ways; unblocking restores nothing', () => {
    let s = createSocialFixture();
    const dm = conversationsFor(s, U.KAI)[0].conversationId;
    s = must(blockUser(s, U.KAI, U.NOVA, T(1)));
    expect(resolvePresenceFor(s, U.NOVA, U.KAI)!.onlineState).toBe('OFFLINE');
    expect(resolvePresenceFor(s, U.KAI, U.NOVA)!.restrictedReason).toBe('BLOCKED');
    expect(sendMessage(s, U.NOVA, dm, { body: 'hello?' }, T(2)).ok).toBe(false);
    expect(sendFriendRequest(s, U.NOVA, U.KAI, T(2)).ok).toBe(false);
    s = must(unblockUser(s, U.KAI, U.NOVA));
    expect(resolvePresenceFor(s, U.KAI, U.NOVA)!.can.removeFriend).toBe(false); // the friendship stays ended
  });
});

describe('friend requests', () => {
  it('lives through send, accept, decline and cancel, and only the right party may act', () => {
    let s = createSocialFixture();
    const incoming = pendingRequestsFor(s, U.KAI).incoming;
    expect(incoming.map((r) => r.fromUserId)).toEqual([U.VEGA]);
    expect(acceptFriendRequest(s, U.VEGA, incoming[0].requestId, T(1)).ok).toBe(false); // the sender cannot accept
    expect(cancelFriendRequest(s, U.KAI, incoming[0].requestId, T(1)).ok).toBe(false); // the recipient cannot cancel
    s = must(acceptFriendRequest(s, U.KAI, incoming[0].requestId, T(1)));
    expect(resolvePresenceFor(s, U.KAI, U.VEGA)!.activityLabel).toBe('Developing a game'); // now a friend: activity visible
    s = must(removeFriend(s, U.KAI, U.VEGA));
    s = must(sendFriendRequest(s, U.VEGA, U.KAI, T(2)));
    const again = pendingRequestsFor(s, U.KAI).incoming[0];
    s = must(declineFriendRequest(s, U.KAI, again.requestId, T(3)));
    expect(pendingRequestsFor(s, U.KAI).incoming).toEqual([]);
    expect(sendFriendRequest(s, U.KAI, U.KAI, T(4)).ok).toBe(false);
  });

  it('two crossing requests make two friends', () => {
    let s = createSocialFixture();
    s = must(removeFriend(s, U.KAI, U.JUNO));
    s = must(sendFriendRequest(s, U.KAI, U.JUNO, T(1)));
    s = must(sendFriendRequest(s, U.JUNO, U.KAI, T(2)));
    expect(resolvePresenceFor(s, U.KAI, U.JUNO)!.can.removeFriend).toBe(true);
    expect(pendingRequestsFor(s, U.KAI).outgoing).toEqual([]);
  });
});

describe('messages and unread', () => {
  it('counts unread, clears on read, and treats own messages as read', () => {
    let s = createSocialFixture();
    const dm = conversationsFor(s, U.KAI)[0];
    expect(dm.unread).toBe(2);
    expect(totalUnread(s, U.KAI)).toBe(2);
    expect(unreadCount(s, U.NOVA, dm.conversationId)).toBe(0);
    s = must(markRead(s, U.KAI, dm.conversationId));
    expect(totalUnread(s, U.KAI)).toBe(0);
    s = must(sendMessage(s, U.NOVA, dm.conversationId, { body: 'one more' }, T(1)));
    expect(totalUnread(s, U.KAI)).toBe(1);
    s = must(setMute(s, U.KAI, U.NOVA, { voice: false, messages: true }));
    expect(totalUnread(s, U.KAI)).toBe(0);
  });

  it('refuses strangers under a FRIENDS policy, empty and oversized messages, and non-members', () => {
    const s = createSocialFixture();
    expect(openDirectConversation(s, U.VEGA, U.KAI, T(1)).ok).toBe(false);
    const dm = conversationsFor(s, U.KAI)[0].conversationId;
    expect(sendMessage(s, U.KAI, dm, { body: '   ' }, T(1)).ok).toBe(false);
    expect(sendMessage(s, U.KAI, dm, { body: 'x'.repeat(2001) }, T(1)).ok).toBe(false);
    expect(sendMessage(s, U.ORION, dm, { body: 'hi' }, T(1)).ok).toBe(false);
  });

  it('carries a party invite inside the conversation', () => {
    let s = createSocialFixture();
    const made = must(createParty(s, U.KAI, { name: 'Builders' }, T(1)));
    const invite = must(inviteToParty(made.state, U.KAI, made.partyId, U.NOVA, T(2)));
    const dm = conversationsFor(invite.state, U.KAI)[0].conversationId;
    s = must(sendMessage(invite.state, U.KAI, dm, { kind: 'PARTY_INVITE', body: 'Join Builders', ref: invite.inviteId }, T(2)));
    expect(conversationsFor(s, U.NOVA)[0].lastMessagePreview).toBe('Party invite');
    expect(partyInvitesFor(s, U.NOVA, T(3)).map((i) => i.inviteId)).toEqual([invite.inviteId]);
  });
});

describe('parties', () => {
  it('create, invite, accept, leave with a hand-over, and the last one out ends it', () => {
    let s = createSocialFixture();
    const made = must(createParty(s, U.KAI, { name: 'Builders' }, T(1)));
    s = made.state;
    const inv = must(inviteToParty(s, U.KAI, made.partyId, U.NOVA, T(2)));
    s = must(acceptPartyInvite(inv.state, U.NOVA, inv.inviteId, T(3)));
    expect(partyViewFor(s, U.NOVA, made.partyId)?.members.map((m) => m.userId)).toEqual([U.KAI, U.NOVA]);
    expect(recentPlayersFor(s, U.NOVA).map((r) => r.userId)).toContain(U.KAI);
    s = must(leaveParty(s, U.KAI));
    expect(s.parties[made.partyId].leaderId).toBe(U.NOVA);
    s = must(leaveParty(s, U.NOVA));
    expect(s.parties[made.partyId]).toBeUndefined();
  });

  it('only friends are invited, invites expire, and nobody joins across a block', () => {
    let s = createSocialFixture();
    const made = must(createParty(s, U.KAI, {}, T(1)));
    expect(inviteToParty(made.state, U.KAI, made.partyId, U.VEGA, T(1)).ok).toBe(false); // not a friend
    const inv = must(inviteToParty(made.state, U.KAI, made.partyId, U.RHEA, T(1)));
    const late = new Date(Date.parse(T(1)) + PARTY_INVITE_TTL_MS + 1).toISOString();
    s = must(acceptPartyInvite(inv.state, U.RHEA, inv.inviteId, late));
    expect(s.partyInvites.find((i) => i.inviteId === inv.inviteId)?.status).toBe('EXPIRED');

    // ACROSS A BLOCK: Mira (who blocked Kai) befriends Lyra, so friendship alone would admit her to the open party -- but Kai
    // is in it, and the block refuses her. FOUNDER RULING (a), 10-04: the refusal is an ordinary "can't join" that names
    // nothing -- exactly the answer for a party that does not exist.
    let b = createSocialFixture();
    const arena = partyOf(b, U.ORION)!.partyId;
    b = must(joinParty(b, U.KAI, arena, T(1)));
    b = must(sendFriendRequest(b, U.MIRA, U.LYRA, T(2)));
    b = must(acceptFriendRequest(b, U.LYRA, b.requests.find((r) => r.fromUserId === U.MIRA && r.toUserId === U.LYRA)!.requestId, T(2)));
    const refused = joinParty(b, U.MIRA, arena, T(3));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toEqual((joinParty(b, U.MIRA, 'pty_missing', T(3)) as { error: unknown }).error);
  });

  it('a friend joins an OPEN party from the Friends list; the leader removes and promotes', () => {
    let s = createSocialFixture();
    const orion = resolvePresenceFor(s, U.KAI, U.ORION)!;
    expect(orion.can.joinParty).toBe(true);
    s = must(joinParty(s, U.KAI, orion.partyId!, T(1)));
    expect(removePartyMember(s, U.KAI, orion.partyId!, U.LYRA).ok).toBe(false); // not the leader
    s = must(promotePartyLeader(s, U.ORION, orion.partyId!, U.KAI));
    s = must(removePartyMember(s, U.KAI, orion.partyId!, U.ORION));
    expect(partyViewFor(s, U.KAI, orion.partyId!)?.members.map((m) => m.userId)).toEqual([U.LYRA, U.KAI]);
  });

  it('self-mute is party state everybody sees', () => {
    let s = createSocialFixture();
    s = must(setSelfMuted(s, U.LYRA, true));
    expect(partyViewFor(s, U.ORION, partyOf(s, U.LYRA)!.partyId)?.members.find((m) => m.userId === U.LYRA)?.selfMuted).toBe(true);
  });
});

describe('party voice', () => {
  it('says VOICE TRANSPORT PENDING when no provider is configured, and connects nothing', () => {
    const voice = createUnavailableVoiceService();
    expect(voice.getState().connection).toBe('UNAVAILABLE');
    expect(voice.getState().providerId).toBeNull();
    expect(voice.connect('pty_1', ['a'])).toEqual({ ok: false, reason: VOICE_TRANSPORT_PENDING });
  });

  it('carries reconnect and failure with their reason, never speaking while not connected, and leaving voice keeps the party', () => {
    const voice = createLocalVoiceHarness(U.KAI);
    expect(createUnavailableVoiceService().getState().detail).toBe(VOICE_TRANSPORT_PENDING);
    voice.connect('pty_1', [U.NOVA]);
    voice.emit({ kind: 'connected' });
    voice.emit({ kind: 'member-joined', userId: U.NOVA });
    voice.emit({ kind: 'speaking', userId: U.NOVA, speaking: true });
    voice.emit({ kind: 'connection', state: 'RECONNECTING', detail: 'network changed' });
    expect(voice.getState()).toMatchObject({ connection: 'RECONNECTING', detail: 'network changed' });
    expect(voice.getState().participants.some((p) => p.speaking)).toBe(false);
    voice.emit({ kind: 'connected' });
    expect(voice.getState()).toMatchObject({ connection: 'CONNECTED', detail: null });
    expect(voice.getState().participants.find((p) => p.userId === U.NOVA)?.speaking).toBe(true);
    voice.emit({ kind: 'connection', state: 'FAILED', detail: 'provider refused' });
    expect(voice.getState()).toMatchObject({ connection: 'FAILED', detail: 'provider refused' });
    expect(voice.setMicMuted(true).ok).toBe(false);
    expect(voice.disconnect().ok).toBe(true); // LEAVE VOICE
    expect(voice.getState()).toMatchObject({ connection: 'DISCONNECTED', partyId: null, participants: [] });
  });

  it('shows speaking only for a connected, open-mic, not-locally-muted member, deterministically', () => {
    const voice = createLocalVoiceHarness(U.KAI);
    const seen: string[] = [];
    voice.subscribe((st) => seen.push(`${st.connection}:${st.participants.filter((p) => p.speaking).map((p) => p.userId).join(',')}`));
    voice.connect('pty_1', [U.NOVA, U.ORION]);
    voice.emit({ kind: 'speaking', userId: U.NOVA, speaking: true });
    expect(voice.getState().participants.find((p) => p.userId === U.NOVA)?.speaking).toBe(false); // not connected yet
    voice.emit({ kind: 'connected' });
    voice.emit({ kind: 'member-joined', userId: U.NOVA });
    expect(voice.getState().participants.find((p) => p.userId === U.NOVA)?.speaking).toBe(true);
    voice.setLocallyMuted(U.NOVA, true);
    expect(voice.getState().participants.find((p) => p.userId === U.NOVA)).toMatchObject({ speaking: false, mutedLocally: true });
    voice.setLocallyMuted(U.NOVA, false);
    voice.emit({ kind: 'member-mic', userId: U.NOVA, muted: true });
    expect(voice.getState().participants.find((p) => p.userId === U.NOVA)?.speaking).toBe(false);
    voice.setMicMuted(true);
    expect(voice.getState().participants.find((p) => p.userId === U.KAI)?.micMuted).toBe(true);
    voice.disconnect();
    expect(voice.getState().connection).toBe('DISCONNECTED');
    expect(seen[0]).toBe('DISCONNECTED:');
    expect(seen).toContain('CONNECTED:usr_nova');
  });
});

describe("a party id naming something Object.prototype holds is a party that does not exist (MAIN's internal review a6d5842c, m4)", () => {
  // Each matches the route's id shape ([A-Za-z0-9_-]{1,80}); a plain state.parties[id] resolved it to an inherited member.
  const INHERITED = ['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf', 'isPrototypeOf'];

  it('the rules answer "not found" for it and never throw; a real party id still resolves (the control)', () => {
    const s = createSocialFixture();
    const real = partyOf(s, U.ORION)!.partyId;
    expect(partyById(s, real)?.partyId).toBe(real);
    expect(voiceAudienceFor(s, U.ORION, real)).toContain(U.LYRA);
    for (const id of INHERITED) {
      expect(partyById(s, id), id).toBeUndefined();
      expect(voiceAudienceFor(s, U.ORION, id), id).toEqual([]);
      expect(partyViewFor(s, U.ORION, id), id).toBeNull();
      const answers = [joinParty(s, U.KAI, id, T(1)), removePartyMember(s, U.ORION, id, U.LYRA), promotePartyLeader(s, U.ORION, id, U.LYRA), inviteToParty(s, U.ORION, id, U.KAI, T(1))];
      expect(answers.map((r) => (r.ok ? 'ok' : r.error.code)), id).toEqual(['not-found', 'not-found', 'not-found', 'not-found']);
    }
  });

  it('every operation that takes a party id refuses it as "not found" -- no thrown TypeError, so never a 500', () => {
    const s = createSocialFixture();
    const cases: Array<[SocialOperationId, Record<string, unknown>, string[]]> = [
      ['parties.read', {}, []],
      ['parties.join', {}, []],
      ['parties.invite', { toUserId: U.KAI }, []],
      ['parties.remove_member', {}, [U.LYRA]],
      ['parties.promote', { memberId: U.LYRA }, []],
      ['parties.rules', { privacy: 'OPEN_TO_FRIENDS' }, []],
    ];
    for (const id of INHERITED) {
      for (const [op, body, more] of cases) {
        // JOIN AS SOMEBODY WITH NO PARTY: the hardening's B2 answers a joiner already in a party "leave your current party first"
        // BEFORE it reads the id (that answer names nothing about the party asked for), so the id path is reached only by Kai.
        const actor = op === 'parties.join' ? U.KAI : U.ORION;
        const r = applySocialOperation(s, op, actor, { ids: [id, ...more], body, query: {} }, T(1));
        expect(r.ok ? 'ok' : r.error.code, `${op} ${id}`).toBe('not-found');
      }
    }
    // the control: the same operations reach a real party (Orion leads Arena Run)
    const real = partyOf(s, U.ORION)!.partyId;
    expect(applySocialOperation(s, 'parties.read', U.ORION, { ids: [real], body: {}, query: {} }, T(1)).ok).toBe(true);
    expect(applySocialOperation(s, 'parties.rules', U.ORION, { ids: [real], body: { privacy: 'INVITE_ONLY' }, query: {} }, T(1)).ok).toBe(true);
  });
});
