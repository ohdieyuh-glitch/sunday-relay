import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_PRESENCE_HEARTBEAT_SECONDS,
  WONDERLAND_PRESENCE_TTL_SECONDS,
  createMemoryWonderlandSocialStore,
  decideWonderlandSocialCommand,
  isWonderlandPresenceLive,
  projectWonderlandFriends,
  projectWonderlandInstanceListing,
  projectWonderlandPresenceOf,
  projectWonderlandRecentPlayers,
  projectWonderlandRoster,
  wonderlandLiveState,
  type WonderlandSocialCommand,
} from './index';

/**
 * PRESENCE IS LIVE, OR IT IS NOT PRESENCE.
 *
 * Every case is a player who has GONE (a crashed client, a closed laptop, a
 * dropped network) without saying so, and asks whether anything still reports
 * them as there: a friend's lookup, a roster, a population count, an encounter
 * recorded on someone else's entry, a voice plan. Nothing may. A player who
 * keeps their heartbeat stays, and one whose presence expired is told to enter
 * again rather than silently revived.
 */

const HUB = 'public:hub';
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString();
const TTL = WONDERLAND_PRESENCE_TTL_SECONDS;
let seq = 0;

type Store = ReturnType<typeof createMemoryWonderlandSocialStore>;
const run = (store: Store, actorId: string, command: WonderlandSocialCommand, seconds: number) =>
  store.execute({ actorId, commandId: `live-${String(++seq)}`, command, at: at(seconds) });
const enter = (store: Store, playerId: string, seconds: number) =>
  run(store, playerId, { kind: 'ENTER_INSTANCE', instanceId: HUB, location: { zone: 'plaza', x: 1, y: 2, z: 0 }, activity: 'EXPLORING', dogId: 'dog-corgi' }, seconds);
const heartbeat = (store: Store, playerId: string, seconds: number) =>
  run(store, playerId, { kind: 'UPDATE_PRESENCE', location: { zone: 'plaza', x: 3, y: 2, z: 0 }, activity: 'IDLE' }, seconds);

async function world(names: readonly string[]): Promise<Store> {
  const store = createMemoryWonderlandSocialStore();
  for (const name of names) await store.upsertProfile({ playerId: name, displayName: name.toUpperCase() });
  return store;
}
const rosterIds = (state: Parameters<typeof projectWonderlandRoster>[0], viewer: string): string[] => {
  const view = projectWonderlandRoster(state, viewer, HUB);
  return view.available ? view.players.map((entry) => entry.playerId) : [];
};

describe('a presence counts for its time to live, and not a moment longer', () => {
  it('the boundary is exact, an unreadable instant is never live, and a refresh from a clock slightly ahead is', () => {
    expect(WONDERLAND_PRESENCE_TTL_SECONDS).toBe(4 * WONDERLAND_PRESENCE_HEARTBEAT_SECONDS);
    expect(isWonderlandPresenceLive({ updatedAt: at(0) }, at(TTL))).toBe(true);
    expect(isWonderlandPresenceLive({ updatedAt: at(0) }, new Date(T0 + TTL * 1000 + 1).toISOString())).toBe(false);
    expect(isWonderlandPresenceLive({ updatedAt: 'not a time' }, at(0))).toBe(false);
    expect(isWonderlandPresenceLive({ updatedAt: at(0) }, 'not a time')).toBe(false);
    expect(isWonderlandPresenceLive({ updatedAt: at(5) }, at(0))).toBe(true);
  });

  it('removes only what expired, and returns the very same state when nothing did', async () => {
    const store = await world(['ann', 'ben']);
    await enter(store, 'ann', 0);
    await enter(store, 'ben', 100);
    const state = store.snapshot();
    expect(wonderlandLiveState(state, at(100))).toBe(state);
    expect(Object.keys(wonderlandLiveState(state, at(TTL + 1)).presence)).toEqual(['ben']);
    expect(wonderlandLiveState(state, at(TTL + 1)).friendships).toBe(state.friendships);
  });
});

describe('nobody reports a player who has gone', () => {
  it('a stranger\'s roster and population, a friend\'s lookup and friend list, and a voice plan all lose them together', async () => {
    const store = await world(['ann', 'ben', 'cal']);
    await run(store, 'ann', { kind: 'FRIEND_REQUEST', toId: 'ben' }, 0);
    await run(store, 'ben', { kind: 'FRIEND_ACCEPT', fromId: 'ann' }, 0);
    await enter(store, 'ann', 0);
    await enter(store, 'ben', 60);
    await enter(store, 'cal', 60);
    // Still there at the edge of Ann's time to live...
    const present = await store.stateFor({ viewerId: 'cal', now: at(TTL) });
    expect(rosterIds(present, 'cal')).toEqual(['ann', 'ben', 'cal']);
    // ...and gone a second later, everywhere at once, while Ben and Cal (who entered later) remain.
    const gone = await store.stateFor({ viewerId: 'cal', now: at(TTL + 1) });
    expect(rosterIds(gone, 'cal')).toEqual(['ben', 'cal']);
    expect(projectWonderlandInstanceListing(gone, 'cal', [HUB])).toEqual([{ instanceId: HUB, population: 2 }]);
    const benView = await store.stateFor({ viewerId: 'ben', now: at(TTL + 1) });
    expect(projectWonderlandPresenceOf(benView, 'ben', 'ann')).toEqual({ status: 'UNAVAILABLE' });
    expect(projectWonderlandFriends(benView, 'ben').friends).toEqual([{ playerId: 'ann', displayName: 'ANN', presence: { status: 'UNAVAILABLE' } }]);
    // A voice plan is drawn from the same state: whoever has gone stands in no instance there.
    const voice = await store.voiceStateFor({ participantIds: ['ann', 'ben', 'cal'], now: at(TTL + 1) });
    expect(Object.keys(voice.presence).sort()).toEqual(['ben', 'cal']);
  });

  it('a heartbeat keeps a player present, and four missed heartbeats make them absent', async () => {
    const store = await world(['ann', 'ben']);
    await enter(store, 'ann', 0);
    await enter(store, 'ben', 0);
    for (let beat = 1; beat <= 6; beat += 1) {
      expect(await heartbeat(store, 'ann', beat * WONDERLAND_PRESENCE_HEARTBEAT_SECONDS)).toEqual({ ok: true, code: 'DONE' });
    }
    const last = 6 * WONDERLAND_PRESENCE_HEARTBEAT_SECONDS;
    expect(rosterIds(await store.stateFor({ viewerId: 'ann', now: at(last + TTL) }), 'ann')).toEqual(['ann']);
    expect(rosterIds(await store.stateFor({ viewerId: 'ann', now: at(last + TTL + 1) }), 'ann')).toEqual([]);
  });

  it('an entry records no encounter with someone who has gone', async () => {
    const store = await world(['ann', 'cal']);
    await enter(store, 'ann', 0);
    await enter(store, 'cal', TTL + 30);
    const later = await store.stateFor({ viewerId: 'cal', now: at(TTL + 30) });
    expect(projectWonderlandRecentPlayers(later, 'cal')).toEqual([]);
    expect(store.snapshot().encounters).toEqual([]);
    // A live meeting still records, both ways.
    await enter(store, 'ann', TTL + 40);
    expect(store.snapshot().encounters.map((row) => `${row.playerId}>${row.otherId}`).sort()).toEqual(['ann>cal', 'cal>ann']);
  });

  it('a heartbeat from an expired presence is told to enter again, and entering again works', async () => {
    const store = await world(['ann']);
    await enter(store, 'ann', 0);
    expect(await heartbeat(store, 'ann', TTL + 1)).toEqual({ ok: false, code: 'NOT_IN_INSTANCE' });
    expect(await run(store, 'ann', { kind: 'LEAVE_INSTANCE' }, TTL + 2)).toEqual({ ok: true, code: 'NO_CHANGE' });
    expect(await enter(store, 'ann', TTL + 3)).toEqual({ ok: true, code: 'DONE' });
    expect(rosterIds(await store.stateFor({ viewerId: 'ann', now: at(TTL + 3) }), 'ann')).toEqual(['ann']);
  });
});

describe('a member removed from a private server stays out of it, whatever order the commands are decided in', () => {
  const SERVER = 'server:srv';
  const enterServer = (store: Store, playerId: string, seconds: number) =>
    run(store, playerId, { kind: 'ENTER_INSTANCE', instanceId: SERVER, location: { zone: 'hall', x: 1, y: 1, z: 0 }, activity: 'EXPLORING', dogId: 'dog-corgi' }, seconds);
  const serverWorld = async (): Promise<Store> => {
    const store = await world(['owen', 'mia', 'max']);
    await run(store, 'owen', { kind: 'SERVER_CREATE', serverId: 'srv', name: 'Owen' }, 0);
    for (const member of ['mia', 'max']) {
      await run(store, 'owen', { kind: 'SERVER_INVITE', serverId: 'srv', inviteeId: member }, 0);
      await run(store, member, { kind: 'SERVER_JOIN', serverId: 'srv' }, 0);
    }
    await enterServer(store, 'mia', 0);
    await enterServer(store, 'max', 0);
    return store;
  };

  it('the review\'s case: removed just after her lease lapsed, her heartbeat stamped earlier but decided later does not bring her back', async () => {
    const store = await serverWorld();
    // Owen's block is stamped 50 ms after Mia's lease ran out, and is decided first: she is removed (P4).
    expect(await run(store, 'owen', { kind: 'BLOCK', targetId: 'mia' }, TTL + 0.05)).toMatchObject({ ok: true, code: 'DONE' });
    expect(store.snapshot().presence.mia, 'her stored presence goes with her membership, lapsed or not').toBeUndefined();
    // Her heartbeat was stamped 10 ms before the lease ran out, and is decided second.
    expect(await run(store, 'mia', { kind: 'UPDATE_PRESENCE', location: { zone: 'hall', x: 2, y: 1, z: 0 }, activity: 'IDLE' }, TTL - 0.01))
      .toMatchObject({ ok: false, code: 'NOT_IN_INSTANCE' });
    expect(store.snapshot().presence.mia).toBeUndefined();
    // Max, still a member and still live, never sees her again.
    await run(store, 'max', { kind: 'UPDATE_PRESENCE', location: { zone: 'hall', x: 3, y: 1, z: 0 }, activity: 'IDLE' }, TTL - 1);
    const later = wonderlandLiveState(store.snapshot(), at(TTL + 30));
    const view = projectWonderlandRoster(later, 'max', SERVER);
    expect(view.available ? view.players.map((entry) => entry.playerId) : []).not.toContain('mia');
  });

  it('a heartbeat from a player who is no longer a member is refused, even where their presence row survived', async () => {
    const store = await serverWorld();
    const stored = store.snapshot();
    // A row the removal did not clear (as an older store could hold): the membership is gone, the presence is not.
    const orphaned = { ...stored, servers: { ...stored.servers, srv: { ...stored.servers.srv!, memberIds: stored.servers.srv!.memberIds.filter((id) => id !== 'mia') } } };
    const decided = decideWonderlandSocialCommand(orphaned, 'mia', { kind: 'UPDATE_PRESENCE', location: { zone: 'hall', x: 2, y: 1, z: 0 }, activity: 'IDLE' }, at(10));
    expect(decided.outcome).toMatchObject({ ok: false, code: 'NOT_IN_INSTANCE' });
    expect(decided.mutations).toEqual([]);
  });
});
