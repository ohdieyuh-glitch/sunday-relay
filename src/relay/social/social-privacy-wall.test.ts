import { describe, expect, it } from 'vitest';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { partyInvitesFor, recentPlayersViewFor } from './social-parties';
import { conversationsFor } from './social-conversations';
import { buildSocialView } from './social-preview';
import { partyOf, type SocialState } from './social-state';
import { ensureSocialUser } from './social-store';
import { resolvePresenceFor } from './social-presence';
import type { UserProfileView } from './social-contracts';

/*
 * THE PRIVACY WALL, AS SECOND'S ADVERSARIAL R16 HARNESS FOUND IT (2026-10-04, stub identities on a throwaway database), and the
 * founder's rulings on it. One describe per defect; each case is the harness's reproduction, made pure.
 */

const NOW = '2026-10-04T05:00:00.000Z';

type Outcome = { ok: true; value: SocialCommandOutcome } | { ok: false; error: { code: string; message: string } };
function op(s: SocialState, actor: string, name: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown> = {}, ids: string[] = []): Outcome {
  return applySocialOperation(s, name, actor, { ids, body, query: {} }, NOW) as Outcome;
}
function must(s: SocialState, actor: string, name: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown> = {}, ids: string[] = []) {
  const r = op(s, actor, name, body, ids);
  if (!r.ok) throw new Error(`${name} by ${actor} refused: ${r.error.message}`);
  return r.value;
}
/** What a refusal looks like from the outside: its code and its words. */
const refusal = (r: Outcome) => (r.ok ? 'ACCEPTED' : `${r.error.code}: ${r.error.message}`);
const view = (s: SocialState, viewer: string) => buildSocialView(s, viewer, NOW, { developmentPreview: false });

describe('D1 / D7: a block revokes every pending party invite that would carry one of the pair to the other', () => {
  it('the invite between the pair dies with the block, in both directions, and is not usable after the unblock', () => {
    for (const [blocker, blocked] of [[U.NOVA, U.KAI], [U.KAI, U.NOVA]]) {
      let s = createSocialFixture();
      s = must(s, U.KAI, 'parties.create', { name: 'Builders' }).state;
      const pid = partyOf(s, U.KAI)!.partyId;
      const invited = must(s, U.KAI, 'parties.invite', { toUserId: U.NOVA }, [pid]);
      const inviteId = (invited.data as { inviteId: string }).inviteId;
      s = must(invited.state, blocker, 'blocks.add', { targetId: blocked }).state;
      expect(s.partyInvites.find((i) => i.inviteId === inviteId)?.status, `${blocker} blocks ${blocked}`).toBe('REVOKED');
      expect(partyInvitesFor(s, U.NOVA, NOW)).toEqual([]);
      expect(view(s, U.NOVA).partyInvites).toEqual([]);
      s = must(s, blocker, 'blocks.remove', {}, [blocked]).state;
      // the pre-block invite stays dead: accepting it reads like any invite that is no longer there
      expect(refusal(op(s, U.NOVA, 'party_invites.accept', {}, [inviteId]))).toBe('not-found: pending party invite not found');
      expect(partyOf(s, U.NOVA)).toBeUndefined();
    }
  });

  it('an invite INTO a party the other is in dies too (Orion invites Kai; Kai blocks Lyra, who is in Orion\'s party)', () => {
    let s = createSocialFixture();
    const arena = partyOf(s, U.ORION)!.partyId;
    s = must(s, U.ORION, 'parties.rules', { privacy: 'INVITE_ONLY' }, [arena]).state;
    const invited = must(s, U.ORION, 'parties.invite', { toUserId: U.KAI }, [arena]);
    const inviteId = (invited.data as { inviteId: string }).inviteId;
    s = must(invited.state, U.KAI, 'blocks.add', { targetId: U.LYRA }).state;
    expect(s.partyInvites.find((i) => i.inviteId === inviteId)?.status).toBe('REVOKED');
    // and the fixture's own pending invite (Rhea's Lab Crew to Kai) dies when Kai blocks Rhea
    const lab = createSocialFixture();
    const labInvite = lab.partyInvites.find((i) => i.toUserId === U.KAI && i.status === 'PENDING')!;
    expect(must(lab, U.KAI, 'blocks.add', { targetId: U.RHEA }).state.partyInvites.find((i) => i.inviteId === labInvite.inviteId)?.status).toBe('REVOKED');
  });

  it('control: a block between two OTHER people leaves an invite alone', () => {
    let s = createSocialFixture();
    const labInvite = s.partyInvites.find((i) => i.toUserId === U.KAI && i.status === 'PENDING')!;
    s = must(s, U.NOVA, 'blocks.add', { targetId: U.ORION }).state;
    expect(s.partyInvites.find((i) => i.inviteId === labInvite.inviteId)?.status).toBe('PENDING');
  });
});

describe('D2 / ruling (a): nobody is invited or joins across a wall, and the refusal is the ordinary one', () => {
  it('an invite to somebody walled from ANY member is refused exactly like an invite to a stranger', () => {
    let s = createSocialFixture();
    const arena = partyOf(s, U.ORION)!.partyId; // Orion leads, Lyra is in it
    s = must(s, U.LYRA, 'blocks.add', { targetId: U.KAI }).state; // Lyra blocks Kai; Orion and Kai stay friends
    const acrossTheWall = op(s, U.ORION, 'parties.invite', { toUserId: U.KAI }, [arena]);
    const toAStranger = op(s, U.ORION, 'parties.invite', { toUserId: U.VEGA }, [arena]);
    expect(acrossTheWall.ok).toBe(false);
    expect(refusal(acrossTheWall)).toBe(refusal(toAStranger));
    expect(refusal(acrossTheWall)).toBe('permission-denied: this person cannot be invited');
    // and the inviter's own block reads the same
    const blockedPair = must(createSocialFixture(), U.KAI, 'blocks.add', { targetId: U.NOVA }).state;
    const kaiParty = must(blockedPair, U.KAI, 'parties.create', {}).state;
    expect(refusal(op(kaiParty, U.KAI, 'parties.invite', { toUserId: U.NOVA }, [partyOf(kaiParty, U.KAI)!.partyId]))).toBe(refusal(toAStranger));
  });

  it('joining a party behind your wall reads exactly like joining a party that does not exist', () => {
    let s = createSocialFixture();
    const arena = partyOf(s, U.ORION)!.partyId; // OPEN_TO_FRIENDS
    s = must(s, U.KAI, 'parties.join', {}, [arena]).state; // Mira blocked Kai; Kai is now in the arena
    s = must(s, U.MIRA, 'requests.send', { toUserId: U.LYRA }).state;
    s = must(s, U.LYRA, 'requests.accept', {}, [s.requests.find((r) => r.fromUserId === U.MIRA && r.status === 'PENDING')!.requestId]).state;
    const walled = op(s, U.MIRA, 'parties.join', {}, [arena]);
    expect(walled.ok).toBe(false);
    expect(refusal(walled)).toBe(refusal(op(s, U.MIRA, 'parties.join', {}, ['pty_does_not_exist'])));
  });

  it('an invite a later join brought behind the invitee\'s wall is not shown, and accepting it reads like one that is gone', () => {
    let s = createSocialFixture();
    s = must(s, U.NOVA, 'blocks.add', { targetId: U.JUNO }).state;
    s = must(s, U.KAI, 'parties.create', { name: 'Builders' }).state;
    const pid = partyOf(s, U.KAI)!.partyId;
    const toNova = must(s, U.KAI, 'parties.invite', { toUserId: U.NOVA }, [pid]);
    s = toNova.state;
    const novaInvite = (toNova.data as { inviteId: string }).inviteId;
    const toJuno = must(s, U.KAI, 'parties.invite', { toUserId: U.JUNO }, [pid]);
    s = must(toJuno.state, U.JUNO, 'party_invites.accept', {}, [(toJuno.data as { inviteId: string }).inviteId]).state;
    expect(partyInvitesFor(s, U.NOVA, NOW)).toEqual([]);
    expect(JSON.stringify(view(s, U.NOVA))).not.toContain('Builders');
    expect(refusal(op(s, U.NOVA, 'party_invites.accept', {}, [novaInvite]))).toBe(refusal(op(s, U.NOVA, 'party_invites.accept', {}, ['pinv_gone'])));
    expect(partyOf(s, U.NOVA)).toBeUndefined();
  });
});

/** A stranger to everybody, online, who shares nothing: every audience NOBODY. */
function withPrivateStranger(s: SocialState, id = 'usr_zed'): SocialState {
  const zed = ensureSocialUser(s, { userId: id, displayName: 'Zed', handle: '@zed' }, NOW);
  const record = zed.users[id];
  return {
    ...zed,
    users: {
      ...zed.users,
      [id]: {
        ...record,
        presence: { ...record.presence, connected: true, activity: 'EXPLORING' },
        privacy: { ...record.privacy, presenceVisibility: 'NOBODY', activityVisibility: 'NOBODY', locationVisibility: 'NOBODY', messagePolicy: 'NOBODY', friendRequestPolicy: 'NOBODY' },
      },
    },
  };
}
const withoutId = <T extends { userId: string }>(v: T) => ({ ...v, userId: '<subject>' });

describe('D1 / D4: the blocked side sees the blocker as an ordinary private stranger, and is refused as one', () => {
  it('presence: field for field what a stranger who shares nothing shows -- never BLOCKED', () => {
    const s = withPrivateStranger(createSocialFixture()); // the fixture's Mira has blocked Kai
    const blocker = resolvePresenceFor(s, U.KAI, U.MIRA)!;
    expect(withoutId(blocker)).toEqual(withoutId(resolvePresenceFor(s, U.KAI, 'usr_zed')!));
    expect(blocker.restrictedReason).toBe('PRIVATE');
    expect(JSON.stringify(blocker)).not.toMatch(/BLOCKED|blocked/);
    // the blocker still sees their own block, to manage it
    expect(resolvePresenceFor(s, U.MIRA, U.KAI)!.restrictedReason).toBe('BLOCKED');
  });

  it('profile.read and showcase.read of the blocker answer exactly as a private stranger\'s: relationship NONE, no mutual friends, no party', () => {
    const s = withPrivateStranger(createSocialFixture());
    const blocker = op(s, U.KAI, 'profile.read', {}, [U.MIRA]);
    const stranger = op(s, U.KAI, 'profile.read', {}, ['usr_zed']);
    if (!blocker.ok || !stranger.ok) throw new Error('both profiles must open');
    const shape = (v: SocialCommandOutcome) => {
      const { profile: _card, presence, ...rest } = v.data as UserProfileView;
      return { ...rest, presence: withoutId(presence) };
    };
    expect(shape(blocker.value)).toEqual(shape(stranger.value));
    expect((blocker.value.data as UserProfileView).relationship).toBe('NONE');
    expect(JSON.stringify(blocker.value.data)).not.toMatch(/BLOCKED/);
    expect(op(s, U.KAI, 'showcase.read', {}, [U.MIRA]).ok).toBe(op(s, U.KAI, 'showcase.read', {}, ['usr_zed']).ok);
  });

  it('snapshot.profiles: a blocker is absent exactly as a stranger is absent -- the same absence an unfriend leaves', () => {
    const s = withPrivateStranger(createSocialFixture());
    const kai = view(s, U.KAI);
    expect(kai.profiles[U.MIRA]).toBeUndefined();
    expect(kai.profiles['usr_zed']).toBeUndefined();
    expect(kai.profiles[U.NOVA]?.relationship).toBe('FRIEND');
    // the blocker keeps their own block list (to unblock), as BLOCKED
    expect(view(s, U.MIRA).profiles[U.KAI]?.relationship).toBe('BLOCKED');
    // Kai and Juno: friends, nothing else shared. An unfriend and a block leave Kai's snapshot with the same people in it.
    const unfriended = must(createSocialFixture(), U.JUNO, 'friends.remove', {}, [U.KAI]).state;
    const blocked = must(createSocialFixture(), U.JUNO, 'blocks.add', { targetId: U.KAI }).state;
    expect(Object.keys(view(blocked, U.KAI).profiles)).toEqual(Object.keys(view(unfriended, U.KAI).profiles));
    expect(view(blocked, U.KAI).profiles[U.JUNO]).toBeUndefined();
  });

  it('a friend request across the wall, either way, answers exactly as one to a stranger who accepts none', () => {
    const s = withPrivateStranger(createSocialFixture());
    const toStranger = refusal(op(s, U.KAI, 'requests.send', { toUserId: 'usr_zed' }));
    expect(toStranger).toBe('permission-denied: this person is not accepting friend requests');
    expect(refusal(op(s, U.KAI, 'requests.send', { toUserId: U.MIRA }))).toBe(toStranger); // the blocked side
    expect(refusal(op(s, U.MIRA, 'requests.send', { toUserId: U.KAI }))).toBe(toStranger); // the blocker
  });
});

describe('D7 / ruling (b): a block hides the pair\'s DM from both; an unfriended writer meets the message policy', () => {
  const dmOf = (s: SocialState) => conversationsFor(s, U.KAI).find((c) => c.otherUserId === U.NOVA)!.conversationId;

  it('while the block stands the DM is gone for BOTH -- list, snapshot, read, write, mark-read, re-open -- and returns unchanged', () => {
    const before = createSocialFixture();
    const dm = dmOf(before);
    const history = before.messages[dm];
    let s = must(before, U.NOVA, 'blocks.add', { targetId: U.KAI }).state;
    const missing = (who: string) => ({
      list: refusal(op(s, who, 'messages.list', {}, ['dm_nope'])),
      send: refusal(op(s, who, 'messages.send', { body: 'x' }, ['dm_nope'])),
      read: refusal(op(s, who, 'messages.read', {}, ['dm_nope'])),
    });
    for (const [who, other] of [[U.KAI, U.NOVA], [U.NOVA, U.KAI]]) {
      expect(conversationsFor(s, who).map((c) => c.conversationId)).not.toContain(dm);
      const snapshot = view(s, who);
      expect(Object.keys(snapshot.messages)).not.toContain(dm);
      expect(JSON.stringify({ c: snapshot.conversations, m: snapshot.messages })).not.toContain(other);
      // the BLOCKED side's whole snapshot names the blocker nowhere; the blocker keeps only their own block entry (to unblock)
      if (who === U.KAI) expect(JSON.stringify(snapshot)).not.toContain(other);
      else expect(snapshot.profiles[other]?.relationship).toBe('BLOCKED');
      expect(refusal(op(s, who, 'messages.list', {}, [dm]))).toBe(missing(who).list);
      expect(refusal(op(s, who, 'messages.send', { body: 'still there?' }, [dm]))).toBe(missing(who).send);
      expect(refusal(op(s, who, 'messages.read', {}, [dm]))).toBe(missing(who).read);
      // re-opening it answers as a stranger who does not accept your messages (Vega, FRIENDS-only, is such a stranger to Kai)
      expect(refusal(op(s, who, 'conversations.open', { otherUserId: other }))).toBe(refusal(op(s, U.KAI, 'conversations.open', { otherUserId: U.VEGA })));
    }
    s = must(s, U.NOVA, 'blocks.remove', {}, [U.KAI]).state;
    expect(conversationsFor(s, U.KAI).map((c) => c.conversationId)).toContain(dm);
    expect(s.messages[dm]).toEqual(history);
    const back = op(s, U.NOVA, 'messages.list', {}, [dm]);
    expect(back.ok && back.value.data).toEqual(history);
  });

  it('an unfriended writer is refused by a FRIENDS policy exactly as a new DM would be; an EVERYONE policy still admits them', () => {
    let s = createSocialFixture();
    const dm = dmOf(s);
    s = must(s, U.NOVA, 'friends.remove', {}, [U.KAI]).state;
    const toFormerFriend = op(s, U.KAI, 'messages.send', { body: 'are we still talking?' }, [dm]);
    expect(refusal(toFormerFriend)).toBe('permission-denied: this person is not accepting messages from you');
    expect(refusal(toFormerFriend)).toBe(refusal(op(s, U.KAI, 'conversations.open', { otherUserId: U.VEGA })));
    // the conversation itself is still theirs to read (an unfriend is not a block)
    expect(op(s, U.KAI, 'messages.list', {}, [dm]).ok).toBe(true);
    s = must(s, U.NOVA, 'privacy.update_self', { messagePolicy: 'EVERYONE' }).state;
    expect(op(s, U.KAI, 'messages.send', { body: 'thanks' }, [dm]).ok).toBe(true);
  });
});

describe('D2 / D3: a party name never carries a person, and a recent-player label never crosses a wall', () => {
  it('a party nobody named is "Party", not the leader\'s name', () => {
    const s = must(createSocialFixture(), U.KAI, 'parties.create', {}).state;
    expect(partyOf(s, U.KAI)!.name).toBe('Party');
    expect(partyOf(s, U.KAI)!.name).not.toContain('Kai');
  });

  it('B met C in A\'s party; after A blocks B, B\'s label for C names neither A nor A\'s party -- across a rename -- while C still reads it', () => {
    // Orion leads the open "Arena Run" with Lyra; Kai (Orion's friend) joins it, and so meets Lyra in Orion's party
    let s = createSocialFixture();
    const arena = partyOf(s, U.ORION)!.partyId;
    s = must(s, U.KAI, 'parties.join', {}, [arena]).state;
    const label = (st: SocialState, owner: string, other: string) => recentPlayersViewFor(st, owner).find((e) => e.userId === other)?.contextLabel;
    expect(label(s, U.KAI, U.LYRA)).toBe('Arena Run'); // Kai may see the party: its name
    // the stored label is the party's id -- the source -- never a name
    expect(s.recentPlayers.find((e) => e.ownerId === U.KAI && e.userId === U.LYRA)?.contextLabel).toBe(arena);
    s = must(s, U.ORION, 'blocks.add', { targetId: U.KAI, confirmSharedParty: true }).state; // the leader blocks Kai: Kai is removed
    s = must(s, U.ORION, 'parties.rules', { name: 'Orion Secret Plans' }, [arena]).state;
    expect(label(s, U.KAI, U.LYRA)).toBe('Party');
    expect(JSON.stringify(view(s, U.KAI))).not.toMatch(/Arena Run|Orion Secret Plans/);
    const recent = op(s, U.KAI, 'recent.list');
    expect(recent.ok && JSON.stringify(recent.value.data)).not.toMatch(/Arena Run|Orion Secret Plans/);
    // Lyra, still in the party, reads the live name for Kai
    expect(label(s, U.LYRA, U.KAI)).toBe('Orion Secret Plans');
  });

  it('a label stored before the fix (a name, not an id) reads as "Party"', () => {
    const s = createSocialFixture();
    const legacy = { ...s, recentPlayers: [{ ownerId: U.KAI, userId: U.SOL, context: 'PARTY' as const, contextLabel: "Mira's party", metAtIso: NOW }] };
    expect(recentPlayersViewFor(legacy, U.KAI)[0].contextLabel).toBe('Party');
  });
});
