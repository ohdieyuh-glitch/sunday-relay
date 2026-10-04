import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_DEFAULT_VISIBILITY,
  WONDERLAND_SOCIAL_SETTING_FIELDS,
  createMemoryWonderlandSocialStore,
  parseWonderlandSocialSettings,
  projectWonderlandConversation,
  projectWonderlandFriends,
  projectWonderlandInbox,
  projectWonderlandInstanceListing,
  projectWonderlandParty,
  projectWonderlandPresenceOf,
  projectWonderlandRecentPlayers,
  projectWonderlandRoster,
  projectWonderlandServer,
  projectWonderlandServers,
  projectWonderlandVoiceRoster,
  wonderlandVoiceRouting,
  type WonderlandSocialCommand,
  type WonderlandSocialState,
} from './index';

/**
 * THE PRIVACY WALL, ATTACKED.
 *
 * Each case is written from the side of the person trying to learn something
 * they may not: a stranger looking for a hidden player, a blocked player looking
 * for the one who blocked them. The strongest form of the assertion is used
 * wherever it applies — the attacker's whole view with the target PRESENT is
 * deep-equal to the same view with the target ABSENT — because anything weaker
 * (an entry removed but a count kept, a different error code, a "hidden" badge)
 * is still an inference, and these tests exist to make every such inference a
 * red build.
 */

const HUB = 'public:hub';
const at = (minute: number): string => `2026-10-04T12:${String(minute).padStart(2, '0')}:00.000Z`;
let commandSeq = 0;

type Store = ReturnType<typeof createMemoryWonderlandSocialStore>;

async function run(store: Store, actorId: string, command: WonderlandSocialCommand, minute = 0) {
  commandSeq += 1;
  return store.execute({ actorId, commandId: `cmd-${String(commandSeq)}`, command, at: at(minute) });
}
const enter = (store: Store, playerId: string, instanceId = HUB, minute = 1) =>
  run(store, playerId, { kind: 'ENTER_INSTANCE', instanceId, location: { zone: 'plaza', x: 1, y: 2, z: 0 }, activity: 'EXPLORING', dogId: 'dog-corgi' }, minute);
const hide = (store: Store, playerId: string) => run(store, playerId, { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
const befriend = async (store: Store, a: string, b: string) => {
  await run(store, a, { kind: 'FRIEND_REQUEST', toId: b });
  await run(store, b, { kind: 'FRIEND_ACCEPT', fromId: a });
};
const block = (store: Store, blocker: string, blocked: string) => run(store, blocker, { kind: 'BLOCK', targetId: blocked });

async function world(names: readonly string[]): Promise<Store> {
  const store = createMemoryWonderlandSocialStore();
  for (const name of names) await store.upsertProfile({ playerId: name, displayName: name.toUpperCase() });
  return store;
}

/** Everything a viewer can read about the world, in one value. */
function everythingVisibleTo(state: WonderlandSocialState, viewerId: string, otherIds: readonly string[], voice: readonly string[] = []) {
  return {
    roster: projectWonderlandRoster(state, viewerId, HUB),
    listing: projectWonderlandInstanceListing(state, viewerId, [HUB]),
    presence: otherIds.map((id) => projectWonderlandPresenceOf(state, viewerId, id)),
    friends: projectWonderlandFriends(state, viewerId),
    recent: projectWonderlandRecentPlayers(state, viewerId),
    party: projectWonderlandParty(state, viewerId),
    servers: projectWonderlandServers(state, viewerId),
    inbox: projectWonderlandInbox(state, viewerId),
    conversations: otherIds.map((id) => projectWonderlandConversation(state, viewerId, id)),
    voice: projectWonderlandVoiceRoster(state, viewerId, voice),
  };
}

describe('P1: a player hidden from strangers', () => {
  it('a stranger\'s whole view with the hidden player present is IDENTICAL to the view with them absent', async () => {
    // With: H (hidden) and S (stranger) stand in the same hub.
    const withHidden = await world(['hana', 'sam', 'pat']);
    await hide(withHidden, 'hana');
    await enter(withHidden, 'pat');
    await enter(withHidden, 'hana');
    await enter(withHidden, 'sam');
    // Without: H never came.
    const without = await world(['hana', 'sam', 'pat']);
    await hide(without, 'hana');
    await enter(without, 'pat');
    await enter(without, 'sam');

    const seen = everythingVisibleTo(withHidden.snapshot(), 'sam', ['hana', 'pat'], ['sam', 'hana', 'pat']);
    const absent = everythingVisibleTo(without.snapshot(), 'sam', ['hana', 'pat'], ['sam', 'pat']);
    expect(seen).toEqual(absent);
    // And spelled out, so a failure says which wall fell:
    expect(JSON.stringify(seen)).not.toContain('hana');
    expect(JSON.stringify(seen)).not.toContain('HANA');
    if (seen.roster.available) expect(seen.roster.population).toBe(2);
  });

  it('a lookup cannot tell hidden from offline from unknown', async () => {
    const store = await world(['hana', 'sam']);
    await hide(store, 'hana');
    await enter(store, 'hana');
    const state = store.snapshot();
    const hiddenOnline = projectWonderlandPresenceOf(state, 'sam', 'hana');
    expect(hiddenOnline).toEqual(projectWonderlandPresenceOf(state, 'sam', 'nobody-at-all'));
    expect(hiddenOnline).toEqual({ status: 'UNAVAILABLE' });
  });

  it('a stranger is not told even when the hidden player was VISIBLE: lookups answer friends only', async () => {
    const store = await world(['vic', 'sam']);
    await enter(store, 'vic');
    expect(projectWonderlandPresenceOf(store.snapshot(), 'sam', 'vic')).toEqual({ status: 'UNAVAILABLE' });
  });

  it('friends and party-mates still see the hidden player, Dog, name, place and activity', async () => {
    const store = await world(['hana', 'fay', 'pip', 'sam']);
    await hide(store, 'hana');
    await befriend(store, 'hana', 'fay');
    await run(store, 'pip', { kind: 'PARTY_CREATE', partyId: 'party-1' });
    await run(store, 'pip', { kind: 'PARTY_INVITE', inviteeId: 'hana' });
    await run(store, 'hana', { kind: 'PARTY_JOIN', partyId: 'party-1' });
    for (const player of ['hana', 'fay', 'pip', 'sam']) await enter(store, player);
    const state = store.snapshot();
    for (const viewer of ['fay', 'pip']) {
      const roster = projectWonderlandRoster(state, viewer, HUB);
      expect(roster.available && roster.players.map((entry) => entry.playerId)).toContain('hana');
    }
    const forFay = projectWonderlandRoster(state, 'fay', HUB);
    expect(forFay.available && forFay.players.find((entry) => entry.playerId === 'hana')).toMatchObject({
      displayName: 'HANA', dogId: 'dog-corgi', activity: 'EXPLORING', relation: 'FRIEND',
    });
    expect(projectWonderlandPresenceOf(state, 'fay', 'hana')).toMatchObject({ status: 'AVAILABLE', instanceId: HUB });
    const forSam = projectWonderlandRoster(state, 'sam', HUB);
    expect(forSam.available && forSam.players.map((entry) => entry.playerId)).not.toContain('hana');
  });

  it('a stranger cannot hear the hidden player either: a voice with no Dog is presence inferred', async () => {
    const store = await world(['hana', 'sam']);
    await hide(store, 'hana');
    const routing = wonderlandVoiceRouting(store.snapshot(), ['hana', 'sam']);
    expect(routing).toEqual([
      { listenerId: 'hana', audibleSpeakerIds: ['sam'], mutedSpeakerIds: [] },
      { listenerId: 'sam', audibleSpeakerIds: [], mutedSpeakerIds: ['hana'] },
    ]);
    expect(projectWonderlandVoiceRoster(store.snapshot(), 'sam', ['hana', 'sam'])).toEqual([]);
  });

  it('a private server\'s own member list hides a hidden member from a stranger — the owner included (OWNER_NOT_EXEMPT)', async () => {
    const store = await world(['owen', 'hana', 'sam']);
    await run(store, 'owen', { kind: 'SERVER_CREATE', serverId: 'srv-1', name: 'Owen\'s garden' });
    for (const member of ['hana', 'sam']) {
      await run(store, 'owen', { kind: 'SERVER_INVITE', serverId: 'srv-1', inviteeId: member });
      await run(store, member, { kind: 'SERVER_JOIN', serverId: 'srv-1' });
    }
    await hide(store, 'hana');
    const state = store.snapshot();
    for (const viewer of ['owen', 'sam']) {
      const view = projectWonderlandServer(state, viewer, 'srv-1');
      expect(view.available && view.members.map((member) => member.playerId)).not.toContain('hana');
      expect(JSON.stringify(view)).not.toMatch(/count|total|hidden/iu);
    }
  });

  it('the instance browser counts only who the viewer may see, and states no capacity', async () => {
    const store = await world(['hana', 'sam', 'pat']);
    await hide(store, 'hana');
    await enter(store, 'hana');
    await enter(store, 'pat');
    expect(projectWonderlandInstanceListing(store.snapshot(), 'sam', [HUB])).toEqual([{ instanceId: HUB, population: 1 }]);
  });
});

describe('P2: Recent Players, filtered at read time', () => {
  it('a meeting the viewer could not see is never recorded, so turning visible later reveals nothing', async () => {
    const store = await world(['hana', 'sam']);
    await hide(store, 'hana');
    await enter(store, 'sam', HUB, 1);
    await enter(store, 'hana', HUB, 2);
    await run(store, 'hana', { kind: 'SET_SETTINGS', settings: { visibility: 'EVERYONE' } });
    expect(projectWonderlandRecentPlayers(store.snapshot(), 'sam')).toEqual([]);
    // The hidden player, who could see Sam, remembers Sam.
    expect(projectWonderlandRecentPlayers(store.snapshot(), 'hana').map((row) => row.playerId)).toEqual(['sam']);
  });

  it('a block in either direction removes the row at read time, and an unblock brings it back', async () => {
    const store = await world(['ann', 'ben']);
    await enter(store, 'ann', HUB, 1);
    await enter(store, 'ben', HUB, 2);
    expect(projectWonderlandRecentPlayers(store.snapshot(), 'ann').map((row) => row.playerId)).toEqual(['ben']);
    await block(store, 'ben', 'ann');
    expect(projectWonderlandRecentPlayers(store.snapshot(), 'ann'), 'the blocked side').toEqual([]);
    expect(projectWonderlandRecentPlayers(store.snapshot(), 'ben'), 'the blocking side').toEqual([]);
    await run(store, 'ben', { kind: 'UNBLOCK', targetId: 'ann' });
    expect(projectWonderlandRecentPlayers(store.snapshot(), 'ann').map((row) => row.playerId)).toEqual(['ben']);
  });

  it('a player who later hides drops out of strangers\' Recent Players, and stays in friends\'', async () => {
    const store = await world(['hana', 'sam', 'fay']);
    await befriend(store, 'hana', 'fay');
    for (const player of ['sam', 'fay', 'hana']) await enter(store, player);
    await hide(store, 'hana');
    expect(projectWonderlandRecentPlayers(store.snapshot(), 'sam').map((row) => row.playerId)).not.toContain('hana');
    expect(projectWonderlandRecentPlayers(store.snapshot(), 'fay').map((row) => row.playerId)).toContain('hana');
  });
});

describe('P3: the dead "appear in Recent Players" switch is gone', () => {
  it('the settings are exactly visibility, and the removed switch is refused by name', () => {
    expect(WONDERLAND_SOCIAL_SETTING_FIELDS).toEqual(['visibility']);
    expect(WONDERLAND_DEFAULT_VISIBILITY).toBe('EVERYONE');
    expect(parseWonderlandSocialSettings({ visibility: 'EVERYONE', appearInRecentPlayers: false }))
      .toEqual({ ok: false, reason: 'setting_removed:appearInRecentPlayers' });
    expect(parseWonderlandSocialSettings({ appearInRecentPlayers: true }))
      .toEqual({ ok: false, reason: 'setting_removed:appearInRecentPlayers' });
    expect(parseWonderlandSocialSettings({ visibility: 'EVERYONE', somethingNew: 1 }))
      .toEqual({ ok: false, reason: 'setting_unknown:somethingNew' });
  });

  it('a command carrying it changes nothing', async () => {
    const store = await world(['ann']);
    const outcome = await run(store, 'ann', { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS', appearInRecentPlayers: false } as never });
    expect(outcome).toEqual({ ok: false, code: 'INVALID' });
    expect(store.snapshot().settings.ann).toBeUndefined();
  });
});

async function serverWith(owner: string, members: readonly string[]): Promise<Store> {
  const store = await world([owner, ...members, 'outsider']);
  await run(store, owner, { kind: 'SERVER_CREATE', serverId: 'srv-1', name: 'The garden' });
  for (const member of members) {
    await run(store, owner, { kind: 'SERVER_INVITE', serverId: 'srv-1', inviteeId: member });
    await run(store, member, { kind: 'SERVER_JOIN', serverId: 'srv-1' });
  }
  for (const player of [owner, ...members]) await enter(store, player, 'server:srv-1');
  return store;
}

describe('P4: the owner blocks a member', () => {
  it('the member is removed and ejected; the owner stays; the member cannot come back while the block exists', async () => {
    const store = await serverWith('owen', ['mia', 'max']);
    await block(store, 'owen', 'mia');
    const state = store.snapshot();
    expect(state.servers['srv-1']).toMatchObject({ ownerId: 'owen', memberIds: ['max'] });
    expect(state.presence.mia, 'ejected from the instance').toBeUndefined();
    expect(state.presence.owen?.instanceId).toBe('server:srv-1');
    expect(projectWonderlandServer(state, 'mia', 'srv-1')).toEqual({ available: false });
    expect(await run(store, 'mia', { kind: 'SERVER_JOIN', serverId: 'srv-1' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(await enter(store, 'mia', 'server:srv-1')).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(await run(store, 'owen', { kind: 'SERVER_INVITE', serverId: 'srv-1', inviteeId: 'mia' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });

  it('the refusal to rejoin is the same answer a server that does not exist gives', async () => {
    const store = await serverWith('owen', ['mia']);
    await block(store, 'owen', 'mia');
    expect(await run(store, 'mia', { kind: 'SERVER_JOIN', serverId: 'srv-1' }))
      .toEqual(await run(store, 'mia', { kind: 'SERVER_JOIN', serverId: 'srv-none' }));
  });
});

describe('P5: a member blocks the owner', () => {
  it('the blocker leaves; the owner and every other member stay', async () => {
    const store = await serverWith('owen', ['mia', 'max']);
    await block(store, 'mia', 'owen');
    const state = store.snapshot();
    expect(state.servers['srv-1']).toMatchObject({ ownerId: 'owen', memberIds: ['max'] });
    expect(state.presence.mia).toBeUndefined();
    expect(state.presence.owen?.instanceId).toBe('server:srv-1');
    expect(state.presence.max?.instanceId).toBe('server:srv-1');
  });

  it('two ordinary members who block each other both stay, and cannot see or hear each other there', async () => {
    const store = await serverWith('owen', ['mia', 'max']);
    await block(store, 'mia', 'max');
    const state = store.snapshot();
    expect(state.servers['srv-1']!.memberIds).toEqual(['mia', 'max']);
    for (const [viewer, other] of [['mia', 'max'], ['max', 'mia']] as const) {
      const roster = projectWonderlandRoster(state, viewer, 'server:srv-1');
      expect(roster.available && roster.players.map((entry) => entry.playerId)).not.toContain(other);
      expect(projectWonderlandVoiceRoster(state, viewer, ['owen', 'mia', 'max'])).not.toContain(other);
    }
  });
});

async function partyOf(leader: string, members: readonly string[]): Promise<Store> {
  const store = await world([leader, ...members]);
  await run(store, leader, { kind: 'PARTY_CREATE', partyId: 'party-1' });
  for (const member of members) {
    await run(store, leader, { kind: 'PARTY_INVITE', inviteeId: member });
    await run(store, member, { kind: 'PARTY_JOIN', partyId: 'party-1' });
  }
  return store;
}

describe('PARTY: blocks inside a party', () => {
  it('the leader blocks a member: the member is removed, the leader stays leader', async () => {
    const store = await partyOf('lea', ['mo', 'ned']);
    await block(store, 'lea', 'mo');
    expect(store.snapshot().parties['party-1']).toMatchObject({ leaderId: 'lea', memberIds: ['lea', 'ned'] });
    expect(projectWonderlandParty(store.snapshot(), 'mo')).toEqual({ inParty: false, invitations: [] });
  });

  it('a non-leader blocks the leader: the blocker leaves', async () => {
    const store = await partyOf('lea', ['mo', 'ned']);
    await block(store, 'mo', 'lea');
    expect(store.snapshot().parties['party-1']).toMatchObject({ leaderId: 'lea', memberIds: ['lea', 'ned'] });
  });

  it('a non-leader blocks another non-leader: the blocker leaves', async () => {
    const store = await partyOf('lea', ['mo', 'ned']);
    await block(store, 'ned', 'mo');
    expect(store.snapshot().parties['party-1']).toMatchObject({ leaderId: 'lea', memberIds: ['lea', 'mo'] });
  });

  it('a blocked player cannot be invited, cannot join, and a pending invitation dies with the block', async () => {
    const store = await partyOf('lea', ['ned']);
    await store.upsertProfile({ playerId: 'zed', displayName: 'ZED' });
    await run(store, 'lea', { kind: 'PARTY_INVITE', inviteeId: 'zed' });
    await block(store, 'ned', 'zed');
    expect(projectWonderlandParty(store.snapshot(), 'zed'), 'the invitation is gone').toEqual({ inParty: false, invitations: [] });
    expect(await run(store, 'zed', { kind: 'PARTY_JOIN', partyId: 'party-1' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(await run(store, 'lea', { kind: 'PARTY_INVITE', inviteeId: 'zed' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });

  it('a party never holds a blocked pair, so its view never shows one', async () => {
    const store = await partyOf('lea', ['mo', 'ned']);
    await block(store, 'mo', 'ned');
    const view = projectWonderlandParty(store.snapshot(), 'ned');
    expect(view.inParty && view.members.map((member) => member.playerId)).toEqual(['lea', 'ned']);
  });
});

describe('DM: blocked conversations are hidden from both', () => {
  it('history is hidden from both sides while the block exists, nothing can be sent, and an unblock shows the history again', async () => {
    const store = await world(['ann', 'ben']);
    await befriend(store, 'ann', 'ben');
    await run(store, 'ann', { kind: 'SEND_MESSAGE', messageId: 'm-1', toId: 'ben', body: 'hello' }, 3);
    await run(store, 'ben', { kind: 'SEND_MESSAGE', messageId: 'm-2', toId: 'ann', body: 'hi back' }, 4);
    await block(store, 'ann', 'ben');
    const state = store.snapshot();
    for (const [viewer, other] of [['ann', 'ben'], ['ben', 'ann']] as const) {
      expect(projectWonderlandConversation(state, viewer, other)).toEqual([]);
      expect(projectWonderlandInbox(state, viewer)).toEqual([]);
    }
    expect(await run(store, 'ben', { kind: 'SEND_MESSAGE', messageId: 'm-3', toId: 'ann', body: 'are you there' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(await run(store, 'ann', { kind: 'SEND_MESSAGE', messageId: 'm-4', toId: 'ben', body: 'never mind' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
    await run(store, 'ann', { kind: 'UNBLOCK', targetId: 'ben' });
    expect(projectWonderlandConversation(store.snapshot(), 'ben', 'ann').map((m) => m.messageId), 'nothing sent during the block exists').toEqual(['m-1', 'm-2']);
  });

  it('a stranger cannot message a player hidden from strangers, and is told what a nonexistent player tells them', async () => {
    const store = await world(['hana', 'sam']);
    await hide(store, 'hana');
    const toHidden = await run(store, 'sam', { kind: 'SEND_MESSAGE', messageId: 'm-5', toId: 'hana', body: 'hi' });
    expect(toHidden).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(toHidden).toEqual(await run(store, 'sam', { kind: 'SEND_MESSAGE', messageId: 'm-6', toId: 'nobody-at-all', body: 'hi' }));
    expect(store.snapshot().messages).toEqual([]);
  });

  it('an unknown player cannot be befriended, invited, blocked or messaged, and the answer is the one a block gives', async () => {
    const store = await world(['ann', 'ben']);
    await block(store, 'ben', 'ann');
    const blocked = await run(store, 'ann', { kind: 'FRIEND_REQUEST', toId: 'ben' });
    expect(await run(store, 'ann', { kind: 'FRIEND_REQUEST', toId: 'ghost' })).toEqual(blocked);
    expect(await run(store, 'ann', { kind: 'BLOCK', targetId: 'ghost' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(store.snapshot().friendRequests).toEqual([]);
  });
});

describe('NO INFERENCE: a blocked pair in a shared public instance', () => {
  it('the blocked player\'s whole view with the blocker present is IDENTICAL to the view with the blocker absent', async () => {
    const withBlocker = await world(['ann', 'ben', 'pat']);
    await befriend(withBlocker, 'ann', 'ben');
    await run(withBlocker, 'ann', { kind: 'PARTY_CREATE', partyId: 'party-1' });
    await run(withBlocker, 'ann', { kind: 'PARTY_INVITE', inviteeId: 'ben' });
    await run(withBlocker, 'ben', { kind: 'PARTY_JOIN', partyId: 'party-1' });
    await run(withBlocker, 'ann', { kind: 'SEND_MESSAGE', messageId: 'm-1', toId: 'ben', body: 'see you' });
    for (const player of ['pat', 'ann', 'ben']) await enter(withBlocker, player);
    await block(withBlocker, 'ann', 'ben');

    // The same world, had Ann never been there for Ben at all.
    const without = await world(['ann', 'ben', 'pat']);
    for (const player of ['pat', 'ben']) await enter(without, player);

    const seen = everythingVisibleTo(withBlocker.snapshot(), 'ben', ['ann', 'pat'], ['ann', 'ben', 'pat']);
    const absent = everythingVisibleTo(without.snapshot(), 'ben', ['ann', 'pat'], ['ben', 'pat']);
    // Recent Players differs only by Pat's meeting time, which belongs to Pat.
    expect({ ...seen, recent: null }).toEqual({ ...absent, recent: null });
    expect(seen.recent.map((row) => row.playerId)).toEqual(['pat']);
    expect(JSON.stringify(seen)).not.toMatch(/ann|ANN/u);
  });

  it('and the blocker sees nothing of the blocked player either', async () => {
    const store = await world(['ann', 'ben']);
    for (const player of ['ann', 'ben']) await enter(store, player);
    await block(store, 'ann', 'ben');
    expect(JSON.stringify(everythingVisibleTo(store.snapshot(), 'ann', ['ben'], ['ann', 'ben']))).not.toMatch(/ben|BEN/u);
  });

  it('the block ends the friendship and every pending request, and an unblock restores none of it', async () => {
    const store = await world(['ann', 'ben']);
    await befriend(store, 'ann', 'ben');
    await block(store, 'ben', 'ann');
    expect(store.snapshot().friendships).toEqual([]);
    await run(store, 'ben', { kind: 'UNBLOCK', targetId: 'ann' });
    expect(store.snapshot().friendships).toEqual([]);
    expect(projectWonderlandFriends(store.snapshot(), 'ann').friends).toEqual([]);
  });

  it('a friend request to or from a blocked player is refused, and a pending one is removed', async () => {
    const store = await world(['ann', 'ben']);
    await run(store, 'ann', { kind: 'FRIEND_REQUEST', toId: 'ben' });
    await block(store, 'ben', 'ann');
    expect(store.snapshot().friendRequests).toEqual([]);
    expect(await run(store, 'ann', { kind: 'FRIEND_REQUEST', toId: 'ben' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(await run(store, 'ben', { kind: 'FRIEND_REQUEST', toId: 'ann' })).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
