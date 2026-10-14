import { describe, expect, it } from 'vitest';
import { applySocialOperation } from './social-commands';
import type { SocialAudience, SocialOperationId, UserProfileView } from './social-contracts';
import { openGroupConversation, sendMessage } from './social-conversations';
import { identityVisibleTo } from './social-presence';
import { buildSocialView, type SocialPreviewSnapshot } from './social-preview';
import { emptySocialState, wroteDirectlyTo, type SocialState } from './social-state';
import { ensureSocialUser } from './social-store';

/*
 * OBS-1 ROUND 2 (founder 2026-10-14: "no privacy leaks accepted for scoring"; MAIN's r2 order). Round 1 closed the card by id. Two
 * ways round it remained, each a by-id act of the VIEWER that made the subject's identity theirs to read:
 *   F1  a friend request the viewer sends by id (friendRequestPolicy EVERYONE is the default) -- the outgoing-request row, the
 *       snapshot's profiles and the card named the hidden subject; and, the same shape, a block the viewer files by id -- the
 *       BLOCKED BY YOU entry and the card named them;
 *   F2  a DIRECT conversation the viewer opens by id (where the subject's messagePolicy admits strangers) -- titled with the hidden
 *       subject's display name.
 * The rule now: only a relationship the SUBJECT created or accepted reveals them -- a friendship, a request THEY sent, a shared
 * party, or a message THEY wrote to the viewer in a DIRECT conversation. Until then the viewer's own rows carry the bare id they
 * already hold (the client's own fallback for an unknown name), and no card, handle, avatar, skin or showcase.
 */

const NOW = '2026-10-14T12:00:00.000Z';
const ADA = 'usr_ada'; // the subject
const BO = 'usr_bo'; // a stranger who knows her id
const GHOST = 'usr_ghost'; // nobody
const LEAK = /ADA|@ada|baal|Jhinn|cmp_ada/;

type Outcome = ReturnType<typeof applySocialOperation>;
function op(s: SocialState, actor: string, name: SocialOperationId, body: Record<string, unknown> = {}, ids: string[] = []): Outcome {
  return applySocialOperation(s, name, actor, { ids, body, query: {} }, NOW);
}
function run(s: SocialState, actor: string, name: SocialOperationId, body: Record<string, unknown> = {}, ids: string[] = []) {
  const r = op(s, actor, name, body, ids);
  if (!r.ok) throw new Error(`${name} by ${actor} refused: ${r.error.message}`);
  return r.value;
}
const must = (s: SocialState, actor: string, name: SocialOperationId, body: Record<string, unknown> = {}, ids: string[] = []) => run(s, actor, name, body, ids).state;
const view = (s: SocialState, viewer: string): SocialPreviewSnapshot => buildSocialView(s, viewer, NOW, { developmentPreview: false });

/** Ada hides her presence (or not); both accept messages from anybody, so a DM can be opened and answered either way. */
function cast(presenceVisibility: SocialAudience, boPresence: SocialAudience = 'EVERYONE'): SocialState {
  let s = emptySocialState();
  for (const id of [ADA, BO]) s = ensureSocialUser(s, { userId: id, displayName: id.slice(4).toUpperCase(), handle: `@${id.slice(4)}` }, NOW);
  s = {
    ...s,
    users: {
      ...s.users,
      [ADA]: {
        ...s.users[ADA],
        profile: {
          ...s.users[ADA].profile,
          relayDog: { ...s.users[ADA].profile.relayDog, skinId: 'baal' },
          showcaseCompanions: [{ companionId: 'cmp_ada_jhinn', ownerId: ADA, kind: 'JHINN_AGENT', displayName: 'Jhinn', primary: null, secondary: null }],
        },
      },
    },
  };
  for (const id of [ADA, BO]) s = must(s, id, 'presence.update_self', { connected: true, availability: 'AVAILABLE' });
  s = must(s, ADA, 'privacy.update_self', { presenceVisibility, messagePolicy: 'EVERYONE' });
  s = must(s, BO, 'privacy.update_self', { presenceVisibility: boPresence, messagePolicy: 'EVERYONE' });
  return s;
}

const HIDDEN: readonly SocialAudience[] = ['FRIENDS', 'PARTY', 'NOBODY'];
/** The neutral identity: the bare id the viewer already holds, no handle, the generated avatar of that id. */
const neutral = (id: string) => ({ userId: id, displayName: id, handle: '', avatarRef: `generated:${id}` });

describe('F1: a request the viewer sends by id never names a hidden subject', () => {
  for (const audience of HIDDEN) {
    it(`presence ${audience}: Bo's outgoing row, profiles, profile.read and showcase.read reveal nothing of Ada`, () => {
      const s = must(cast(audience), BO, 'requests.send', { toUserId: ADA });
      const bo = view(s, BO);
      expect(bo.requests.outgoing.length).toBe(1);
      const { presence: _p, ...to } = bo.requests.outgoing[0].to;
      expect(to).toEqual(neutral(ADA));
      expect(bo.profiles[ADA]).toBeUndefined();
      expect(JSON.stringify(bo)).not.toMatch(LEAK);
      for (const read of ['profile.read', 'showcase.read'] as const) {
        expect(op(s, BO, read, {}, [ADA]), read).toEqual(op(s, BO, read, {}, [GHOST]));
      }
      // the requests list read alone (requests.list) carries ids only
      expect(JSON.stringify(run(s, BO, 'requests.list').data)).not.toMatch(LEAK);
    });
  }

  it('the subject sees the incoming request with the sender\'s identity -- even a sender hidden from strangers (they reached out)', () => {
    const s = must(cast('FRIENDS', 'NOBODY'), BO, 'requests.send', { toUserId: ADA });
    const ada = view(s, ADA);
    expect(ada.requests.incoming[0].from.displayName).toBe('BO');
    expect(ada.profiles[BO]?.profile.displayName).toBe('BO');
    expect(run(s, ADA, 'profile.read', {}, [BO]).data).toMatchObject({ relationship: 'REQUEST_RECEIVED' });
  });

  it('requests work end to end by id: cancel; send again, accept -- and after the accept the card appears', () => {
    let s = must(cast('NOBODY'), BO, 'requests.send', { toUserId: ADA });
    const first = view(s, BO).requests.outgoing[0].requestId;
    s = must(s, BO, 'requests.cancel', {}, [first]);
    expect(view(s, BO).requests.outgoing).toEqual([]);
    s = must(s, BO, 'requests.send', { toUserId: ADA });
    const second = view(s, ADA).requests.incoming[0].requestId;
    expect(op(s, BO, 'profile.read', {}, [ADA]).ok, 'before the accept: no card').toBe(false);
    s = must(s, ADA, 'requests.accept', {}, [second]);
    const card = run(s, BO, 'profile.read', {}, [ADA]).data as UserProfileView;
    expect([card.relationship, card.profile.displayName, card.profile.handle]).toEqual(['FRIEND', 'ADA', '@ada']);
    expect(view(s, BO).friends.map((f) => f.displayName)).toEqual(['ADA']);
  });

  it('control: a PUBLIC subject is named on the outgoing row, as before', () => {
    const s = must(cast('EVERYONE'), BO, 'requests.send', { toUserId: ADA });
    const bo = view(s, BO);
    expect([bo.requests.outgoing[0].to.displayName, bo.requests.outgoing[0].to.handle]).toEqual(['ADA', '@ada']);
    expect(bo.profiles[ADA]?.profile.displayName).toBe('ADA');
  });
});

describe('F1, the same shape: a block the viewer files by id never names a hidden subject, and UNBLOCK stays reachable', () => {
  for (const audience of HIDDEN) {
    it(`presence ${audience}: Bo blocks Ada by id -- the BLOCKED card is the bare id, base form, nothing shown; unblock works`, () => {
      const s = must(cast(audience), BO, 'blocks.add', { targetId: ADA });
      const card = run(s, BO, 'profile.read', {}, [ADA]).data as UserProfileView;
      expect(card.relationship).toBe('BLOCKED');
      expect({ userId: card.profile.userId, displayName: card.profile.displayName, handle: card.profile.handle, avatarRef: card.profile.avatarRef }).toEqual(neutral(ADA));
      expect(card.profile.relayDog.skinId).toBe('relay_og');
      expect([card.profile.showcaseCompanions, card.profile.showcaseAgents, card.profile.stats, card.profile.memberSinceIso]).toEqual([[], [], [], null]);
      expect(JSON.stringify(card)).not.toMatch(LEAK);
      expect(JSON.stringify(run(s, BO, 'showcase.read', {}, [ADA]).data)).not.toMatch(LEAK);
      // the BLOCKED BY YOU list is drawn from the snapshot's profiles: the entry is there, and it is the same neutral card
      const bo = view(s, BO);
      expect(bo.profiles[ADA]?.relationship).toBe('BLOCKED');
      expect(JSON.stringify(bo)).not.toMatch(LEAK);
      expect(op(s, BO, 'blocks.remove', {}, [ADA]).ok).toBe(true);
    });
  }

  it('control: a PUBLIC subject the viewer blocked keeps their name on the card (base form, as before)', () => {
    const s = must(cast('EVERYONE'), BO, 'blocks.add', { targetId: ADA });
    const card = run(s, BO, 'profile.read', {}, [ADA]).data as UserProfileView;
    expect([card.relationship, card.profile.displayName, card.profile.relayDog.skinId]).toEqual(['BLOCKED', 'ADA', 'relay_og']);
  });
});

describe('F2: a DIRECT conversation the viewer opens by id never names a hidden subject until she writes in it', () => {
  for (const audience of HIDDEN) {
    it(`presence ${audience}: titled with the bare id, no card, through Bo's own messages; Ada's reply names her`, () => {
      const opened = run(cast(audience), BO, 'conversations.open', { otherUserId: ADA });
      const cid = (opened.data as { conversationId: string }).conversationId;
      let s = must(opened.state, BO, 'messages.send', { body: 'hello?' }, [cid]);
      const titleFor = (st: SocialState, viewer: string) => view(st, viewer).conversations.find((c) => c.conversationId === cid)!.title;
      expect(titleFor(s, BO)).toBe(ADA);
      expect(JSON.stringify(run(s, BO, 'conversations.list').data)).not.toMatch(LEAK);
      expect(JSON.stringify(view(s, BO))).not.toMatch(LEAK);
      expect(op(s, BO, 'profile.read', {}, [ADA])).toEqual(op(s, BO, 'profile.read', {}, [GHOST]));
      // Ada sees Bo (public) by name, and answers: from then on she has shown herself to him
      expect(titleFor(s, ADA)).toBe('BO');
      s = must(s, ADA, 'messages.send', { body: 'hi' }, [cid]);
      expect(titleFor(s, BO)).toBe('ADA');
      expect((run(s, BO, 'profile.read', {}, [ADA]).data as UserProfileView).profile.displayName).toBe('ADA');
    });
  }

  it('both hidden: the subject sees the opener as a bare id until the opener writes (an opened, empty DM names nobody)', () => {
    const opened = run(cast('FRIENDS', 'FRIENDS'), BO, 'conversations.open', { otherUserId: ADA });
    const cid = (opened.data as { conversationId: string }).conversationId;
    const titleFor = (st: SocialState, viewer: string) => view(st, viewer).conversations.find((c) => c.conversationId === cid)!.title;
    expect([titleFor(opened.state, ADA), titleFor(opened.state, BO)]).toEqual([BO, ADA]);
    const s = must(opened.state, BO, 'messages.send', { body: 'hello?' }, [cid]);
    expect([titleFor(s, ADA), titleFor(s, BO)]).toEqual(['BO', ADA]);
  });

  it('control: a PUBLIC subject\'s DM is titled with her name from the start', () => {
    const opened = run(cast('EVERYONE'), BO, 'conversations.open', { otherUserId: ADA });
    const cid = (opened.data as { conversationId: string }).conversationId;
    expect(view(opened.state, BO).conversations.find((c) => c.conversationId === cid)!.title).toBe('ADA');
  });
});

/*
 * THE INTERNAL REVIEW OF #368 (r1, F-4): two guards no reachable sequence of operations could fail. Each is pinned here on the state
 * where it decides, and the test says how that state arises.
 */
describe('F-4: carried-in data -- a request that survived a block never names the blocker to the blocked side', () => {
  it('Ada (hidden) asked Bo, then blocked him, and a restore kept the PENDING request: Bo\'s incoming row is the bare id', () => {
    const asked = must(cast('FRIENDS'), ADA, 'requests.send', { toUserId: BO });
    // the control first: the request Ada sent names her to Bo (a relationship she created)
    expect(view(asked, BO).requests.incoming[0].from.displayName).toBe('ADA');
    // CARRIED-IN DATA (a restore or a row written behind the store): the block beside the still-PENDING request. blocks.add itself
    // cancels the pair's requests (blockUser), so no operation reaches this; pendingRequestsFor hides such a request only from the
    // blocker, so the BLOCKED side still lists it -- and identityVisibleTo's block check is all that keeps Ada's name off that row.
    const s: SocialState = { ...asked, blocks: [...asked.blocks, { blockerId: ADA, blockedId: BO, sinceIso: NOW }] };
    const bo = run(s, BO, 'snapshot.read').data as SocialPreviewSnapshot;
    expect(bo.requests.incoming.map((r) => r.from.userId)).toEqual([ADA]);
    const { presence: _p, ...from } = bo.requests.incoming[0].from;
    expect(from).toEqual(neutral(ADA));
    expect(bo.profiles[ADA]).toBeUndefined();
    expect(JSON.stringify(bo)).not.toMatch(LEAK);
    expect(identityVisibleTo(s, BO, ADA)).toBe(false);
    expect(op(s, BO, 'profile.read', {}, [ADA])).toEqual(op(s, BO, 'profile.read', {}, [GHOST]));
  });
});

describe('F-4 / F-5: only a DIRECT conversation is the subject writing to the viewer', () => {
  it('Ada (hidden) writes in a GROUP with Bo (built by the domain: no route creates a group today): Bo still may not know her', () => {
    let s = ensureSocialUser(cast('FRIENDS'), { userId: 'usr_cy', displayName: 'CY', handle: '@cy' }, NOW);
    const group = openGroupConversation(s, 'usr_cy', [ADA, BO], 'Trio', NOW);
    if (!group.ok) throw new Error(group.error.message);
    const wrote = sendMessage(group.value.state, ADA, group.value.conversationId, { body: 'hi all' }, NOW);
    if (!wrote.ok) throw new Error(wrote.error.message);
    s = wrote.value;
    expect(wroteDirectlyTo(s, ADA, BO)).toBe(false);
    expect(identityVisibleTo(s, BO, ADA)).toBe(false);
    expect(op(s, BO, 'profile.read', {}, [ADA])).toEqual(op(s, BO, 'profile.read', {}, [GHOST]));
    const bo = view(s, BO);
    expect(bo.conversations.map((c) => c.title)).toEqual(['Trio']);
    expect(bo.profiles[ADA]).toBeUndefined();
    expect(JSON.stringify(bo)).not.toMatch(LEAK);
  });

  it('the kind check: a record under the DIRECT id that is not DIRECT does not count (constructed state: no operation writes one)', () => {
    const opened = run(cast('FRIENDS'), BO, 'conversations.open', { otherUserId: ADA });
    const cid = (opened.data as { conversationId: string }).conversationId;
    const s = must(opened.state, ADA, 'messages.send', { body: 'hi' }, [cid]);
    expect(wroteDirectlyTo(s, ADA, BO), 'the control: Ada wrote in the DM').toBe(true);
    expect(wroteDirectlyTo(s, BO, ADA), 'Bo did not').toBe(false);
    const regrouped: SocialState = { ...s, conversations: { ...s.conversations, [cid]: { ...s.conversations[cid], kind: 'GROUP' } } };
    expect(wroteDirectlyTo(regrouped, ADA, BO)).toBe(false);
    expect(identityVisibleTo(regrouped, BO, ADA)).toBe(false);
  });
});
