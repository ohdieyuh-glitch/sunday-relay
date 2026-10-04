import { describe, expect, it } from 'vitest';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { blockUser } from './social-friends';
import { recentPlayersViewFor } from './social-parties';
import { resolvePresenceFor } from './social-presence';
import type { SocialState } from './social-state';
import {
  WORLD_AVATAR_STALE_MS,
  WORLD_PUBLIC_CAPACITY,
  contextOf,
  emptyWorldState,
  joinWorld,
  reportAvatar,
  sweepWorld,
  worldViewFor,
  type WorldState,
} from './world-presence';

/*
 * MULTIPLAYER PHASE 1, the shared presence layer: who is in which world context, and what each player sees of the
 * others there. On the fixture's real people and the real presence authority.
 */

const T0 = Date.parse('2026-10-01T20:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();

function run(state: SocialState, world: WorldState, actor: string, op: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown> = {}, ms = 0) {
  const r = applySocialOperation(state, op, actor, { ids: [], body, query: {} }, at(ms), world);
  if (!r.ok) throw new Error(`${op} refused: ${r.error.message}`);
  return r.value as SocialCommandOutcome & { world: WorldState };
}

const here = { x: 100, y: 200, z: 22, yaw: 90, speed: 0, motion: 'IDLE', skinId: 'shadow_flame' };

describe('the shared presence layer', () => {
  it('two players in the same public world see each other, positions and skins; a player never sees themself', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }));
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC' }));
    expect(contextOf(w, U.KAI)?.contextId).toBe('pub_golden_arrival_1');
    expect(contextOf(w, U.NOVA)?.contextId).toBe('pub_golden_arrival_1');
    ({ world: w } = run(s, w, U.KAI, 'world.state', here, 200));
    ({ world: w } = run(s, w, U.NOVA, 'world.state', { ...here, x: 400, motion: 'RUN', speed: 600, skinId: 'celestial_light' }, 200));
    const kaiSees = worldViewFor(w, s, U.KAI, T0 + 300);
    expect(kaiSees.avatars.map((a) => [a.userId, a.x, a.motion, a.skinId])).toEqual([[U.NOVA, 400, 'RUN', 'celestial_light']]);
    expect(worldViewFor(w, s, U.NOVA, T0 + 300).avatars.map((a) => a.userId)).toEqual([U.KAI]);
    expect(kaiSees.context?.population).toBe(2);
    // joining wrote the place into presence, through the one presence authority
    expect(s.users[U.KAI].presence.location?.serverName).toBe('Golden Arrival');
  });

  it('a block hides both players from each other in the world, whatever context they share', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }));
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC' }));
    ({ world: w } = run(s, w, U.KAI, 'world.state', here, 200));
    ({ world: w } = run(s, w, U.NOVA, 'world.state', here, 200));
    const blocked = blockUser(s, U.NOVA, U.KAI, at(300));
    if (!blocked.ok) throw new Error('block');
    s = blocked.value;
    expect(worldViewFor(w, s, U.KAI, T0 + 400).avatars).toEqual([]);
    expect(worldViewFor(w, s, U.NOVA, T0 + 400).avatars).toEqual([]);
  });

  it("following a friend obeys THEIR server-join rule, decided by the presence authority", () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PRIVATE', name: "Nova's Lab" }));
    // Kai is Nova's friend; Nova's server-join policy (fixture default FRIENDS) admits friends -- unless the
    // presence authority withholds the private server's location from this viewer, in which case it refuses.
    const follow = applySocialOperation(s, 'world.join', U.KAI, { ids: [], body: { target: 'FRIEND', userId: U.NOVA }, query: {} }, at(100), w);
    const novaPrivacy = s.users[U.NOVA].privacy;
    if (novaPrivacy.privateServerVisibility === 'NOBODY') {
      expect(follow.ok).toBe(false);
    } else {
      expect(follow.ok).toBe(true);
    }
    // a stranger (Vega is not Nova's friend) is refused by the FRIENDS rule
    const stranger = applySocialOperation(s, 'world.join', U.VEGA, { ids: [], body: { target: 'FRIEND', userId: U.NOVA }, query: {} }, at(100), w);
    expect(stranger.ok).toBe(false);
  });

  it('an invitation brings a friend into the inviter\'s context; the party follows its leader', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PRIVATE', name: "Kai's Workshop" }));
    const invited = run(s, w, U.KAI, 'world.invite', { toUserId: U.NOVA }, 100);
    w = invited.world;
    expect(invited.audience).toEqual([U.NOVA]);
    const invite = worldViewFor(w, s, U.NOVA, T0 + 200).invites[0];
    expect(invite.serverName).toBe("Kai's Workshop");
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'INVITE', inviteId: invite.inviteId }, 300));
    expect(contextOf(w, U.NOVA)?.contextId).toBe(`priv_${U.KAI}`);
    // the fixture's Arena Run party: Lyra follows her leader Orion into his world
    ({ state: s, world: w } = run(s, w, U.ORION, 'world.join', { target: 'PUBLIC', place: 'tower_lane', placeName: 'Tower Lane' }, 400));
    ({ state: s, world: w } = run(s, w, U.LYRA, 'world.join', { target: 'PARTY' }, 500));
    expect(contextOf(w, U.LYRA)?.contextId).toBe(contextOf(w, U.ORION)?.contextId);
  });

  it('a full public shard opens the next; a silent client leaves after the stale window; leaving clears presence', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    const ids = Object.keys(s.users);
    // fill shard 1 with synthetic members directly (the fixture has fewer people than a shard holds)
    w = { ...w, contexts: { pub_golden_arrival_1: { contextId: 'pub_golden_arrival_1', kind: 'PUBLIC_WORLD', serverName: 'Golden Arrival', ownerId: null, capacity: WORLD_PUBLIC_CAPACITY, authority: 'CLIENT_REPORTED', memberIds: Array.from({ length: WORLD_PUBLIC_CAPACITY }, (_, i) => `ghost_${i}`) } } };
    ({ state: s, world: w } = run(s, w, ids[0], 'world.join', { target: 'PUBLIC' }));
    expect(contextOf(w, ids[0])?.contextId).toBe('pub_golden_arrival_2');
    ({ world: w } = run(s, w, ids[0], 'world.state', here, 100));
    expect(contextOf(sweepWorld(w, T0 + 100 + WORLD_AVATAR_STALE_MS + 1), ids[0])).toBeUndefined();
    const left = run(s, w, ids[0], 'world.leave', {}, 200);
    expect(left.state.users[ids[0]].presence.location).toBeNull();
    expect(contextOf(left.world, ids[0])).toBeUndefined();
  });

  it('refuses a report from outside a world, an impossible position, an unknown motion', () => {
    const w = emptyWorldState();
    expect(reportAvatar(w, U.KAI, { ...here, motion: 'IDLE' }, T0).ok).toBe(false);
    const s = createSocialFixture();
    const joined = joinWorld(w, s, U.KAI, { kind: 'PUBLIC', place: 'golden_arrival', placeName: 'Golden Arrival' }, T0);
    if (!joined.ok) throw new Error('join');
    expect(reportAvatar(joined.value.world, U.KAI, { ...here, motion: 'IDLE', x: Number.NaN }, T0).ok).toBe(false);
    expect(reportAvatar(joined.value.world, U.KAI, { ...here, motion: 'IDLE', x: 1e12 }, T0).ok).toBe(false);
    expect(reportAvatar(joined.value.world, U.KAI, { ...here, motion: 'TELEPORT' as never }, T0).ok).toBe(false);
  });
});

describe('played together: sharing a world records each in the other\'s Recent Players (R16 rehearsal 10-04)', () => {
  const metIn = (s: SocialState, owner: string, other: string, iso: string) =>
    recentPlayersViewFor(s, owner).filter((e) => e.userId === other && e.context === 'SESSION' && e.metAtIso === iso);

  it('the second player into a public world is recorded for both, labelled with the world, newest first', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 1000));
    expect(metIn(s, U.KAI, U.NOVA, at(2000))).toHaveLength(0);
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC' }, 2000));
    expect(metIn(s, U.KAI, U.NOVA, at(2000)).map((e) => e.contextLabel)).toEqual(['Golden Arrival']);
    expect(metIn(s, U.NOVA, U.KAI, at(2000)).map((e) => e.contextLabel)).toEqual(['Golden Arrival']);
    expect(recentPlayersViewFor(s, U.KAI)[0].userId).toBe(U.NOVA);
  });

  it('nobody is recorded across a block; a different world records nothing', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    const blocked = blockUser(s, U.KAI, U.NOVA, at(0));
    if (!blocked.ok) throw new Error('block refused');
    s = blocked.value;
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 1000));
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC' }, 2000));
    ({ state: s, world: w } = run(s, w, U.LYRA, 'world.join', { target: 'PUBLIC' }, 3000));
    ({ state: s, world: w } = run(s, w, U.ORION, 'world.join', { target: 'PUBLIC', place: 'tower_lane', placeName: 'Tower Lane' }, 4000));
    expect(metIn(s, U.KAI, U.NOVA, at(2000))).toHaveLength(0);
    expect(metIn(s, U.NOVA, U.KAI, at(2000))).toHaveLength(0);
    // the separate opt-out is gone (P3): Lyra is visible to Kai, so the one presence rule records her
    expect(metIn(s, U.KAI, U.LYRA, at(3000))).toHaveLength(1);
    expect(metIn(s, U.LYRA, U.KAI, at(3000))).toHaveLength(1);
    expect(recentPlayersViewFor(s, U.ORION).filter((e) => e.metAtIso === at(4000))).toHaveLength(0);
  });
});

describe('played together respects presence: no durable trace where the owner could not see them online (Second, 7024e331)', () => {
  const rowsFor = (s: SocialState, owner: string, other: string) => recentPlayersViewFor(s, owner).filter((e) => e.userId === other && e.context === 'SESSION');

  it('a player whose presence nobody may see lands in nobody\'s list; the people they saw still land in theirs', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    s = { ...s, users: { ...s.users, [U.LYRA]: { ...s.users[U.LYRA], privacy: { ...s.users[U.LYRA].privacy, presenceVisibility: 'NOBODY' } } } };
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 1000));
    ({ state: s, world: w } = run(s, w, U.LYRA, 'world.join', { target: 'PUBLIC' }, 2000));
    expect(rowsFor(s, U.KAI, U.LYRA).filter((e) => e.metAtIso === at(2000))).toHaveLength(0);
    expect(rowsFor(s, U.LYRA, U.KAI).filter((e) => e.metAtIso === at(2000))).toHaveLength(1);
  });

  it('a player appearing offline is not recorded for others; control: the same player, available, is', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 1000));
    ({ state: s, world: w } = run(s, w, U.SOL, 'world.join', { target: 'PUBLIC' }, 2000));
    expect(rowsFor(s, U.KAI, U.SOL).filter((e) => e.metAtIso === at(2000))).toHaveLength(0);
    expect(rowsFor(s, U.SOL, U.KAI).filter((e) => e.metAtIso === at(2000))).toHaveLength(1);
    s = { ...s, users: { ...s.users, [U.SOL]: { ...s.users[U.SOL], presence: { ...s.users[U.SOL].presence, availability: 'AVAILABLE' } } } };
    ({ state: s, world: w } = run(s, w, U.SOL, 'world.join', { target: 'PUBLIC' }, 3000));
    expect(rowsFor(s, U.KAI, U.SOL).filter((e) => e.metAtIso === at(3000))).toHaveLength(1);
  });

  it('a rejoin refreshes the one row for the pair, never adds a second', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 1000));
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC' }, 2000));
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC' }, 5000));
    expect(recentPlayersViewFor(s, U.KAI).filter((e) => e.userId === U.NOVA).map((e) => e.metAtIso)).toEqual([at(5000)]);
  });
});

describe('world names never carry a person, and a wall holds through a friend in a private server (Second, R16 review 10-04)', () => {
  const sharePrivateServer = (s: SocialState, who: string): SocialState => ({
    ...s,
    users: { ...s.users, [who]: { ...s.users[who], privacy: { ...s.users[who].privacy, privateServerVisibility: 'FRIENDS' } } },
  });

  it('a public world is named by the server from its place id; a client-sent name reaches nobody', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    // the FIRST joiner of a new shard used to name it for everybody after
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC', place: 'golden_arrival', placeName: 'Kai was here http://phish.invalid' }, 1000));
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC', place: 'golden_arrival', placeName: 'Golden Arrival' }, 2000));
    expect(contextOf(w, U.KAI)?.serverName).toBe('Golden Arrival');
    expect(s.users[U.NOVA].presence.location?.serverName).toBe('Golden Arrival');
    expect([...recentPlayersViewFor(s, U.KAI), ...recentPlayersViewFor(s, U.NOVA)].filter((e) => e.context === 'SESSION' && e.metAtIso === at(2000)).map((e) => e.contextLabel)).toEqual([
      'Golden Arrival',
      'Golden Arrival',
    ]);
    expect(JSON.stringify({ s, w })).not.toContain('phish');
    expect(JSON.stringify({ s, w })).not.toContain('Kai was here');
  });

  it("a private server's default name is neutral, and a Recent Players row from one never stores a name", () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PRIVATE' }, 1000));
    expect(contextOf(w, U.KAI)?.serverName).toBe('Private server');
    // a server its owner named: the name travels with the owner's own sharing (invites), never into a durable label
    let s2 = createSocialFixture();
    let w2 = emptyWorldState();
    ({ state: s2, world: w2 } = run(s2, w2, U.KAI, 'world.join', { target: 'PRIVATE', name: "Kai's Workshop" }, 1000));
    const invited = run(s2, w2, U.KAI, 'world.invite', { toUserId: U.NOVA }, 1100);
    w2 = invited.world;
    const invite = worldViewFor(w2, s2, U.NOVA, T0 + 1200).invites[0];
    expect(invite.serverName).toBe("Kai's Workshop");
    ({ state: s2, world: w2 } = run(s2, w2, U.NOVA, 'world.join', { target: 'INVITE', inviteId: invite.inviteId }, 1300));
    const labels = [...recentPlayersViewFor(s2, U.KAI), ...recentPlayersViewFor(s2, U.NOVA)].filter((e) => e.context === 'SESSION' && e.metAtIso === at(1300));
    expect(labels.map((e) => e.contextLabel)).toEqual(['Private server', 'Private server']);
  });

  it("a viewer walled from a private server's OWNER learns nothing of it through a friend who is there; control: an unwalled friend still sees where the friend is", () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    s = sharePrivateServer(s, U.KAI); // Kai shares their private-server whereabouts with friends (not the default)
    const walled = blockUser(s, U.NOVA, U.ORION, at(0)); // Nova (the owner) and Orion (Kai's friend) are walled
    if (!walled.ok) throw new Error('block refused');
    s = walled.value;
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PRIVATE', name: "Nova's Lab" }, 1000));
    const invited = run(s, w, U.NOVA, 'world.invite', { toUserId: U.KAI }, 1100);
    w = invited.world;
    const invite = worldViewFor(w, s, U.KAI, T0 + 1200).invites[0];
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'INVITE', inviteId: invite.inviteId }, 1300));
    expect(contextOf(w, U.KAI)?.contextId).toBe(`priv_${U.NOVA}`);
    const orionSees = resolvePresenceFor(s, U.ORION, U.KAI);
    expect(orionSees).not.toBeNull();
    expect(orionSees?.location).toBeNull();
    expect(JSON.stringify(orionSees)).not.toContain(U.NOVA);
    expect(JSON.stringify(orionSees)).not.toContain('Nova');
    // the control: Lyra, Kai's friend and walled from nobody, is shown where Kai is -- the rule is the wall, not a blanket hide
    const lyraSees = resolvePresenceFor(s, U.LYRA, U.KAI);
    expect(lyraSees?.location?.serverId).toBe(`priv_${U.NOVA}`);
  });

  // the owner Nova and Orion are walled; Kai (both their friend) is inside Nova's private server
  const novaHostsKaiInside = () => {
    let s = sharePrivateServer(createSocialFixture(), U.KAI);
    let w = emptyWorldState();
    const walled = blockUser(s, U.NOVA, U.ORION, at(0));
    if (!walled.ok) throw new Error('block refused');
    s = walled.value;
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PRIVATE', name: "Nova's Lab" }, 1000));
    const invited = run(s, w, U.NOVA, 'world.invite', { toUserId: U.KAI }, 1100);
    w = invited.world;
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'INVITE', inviteId: worldViewFor(w, s, U.KAI, T0 + 1200).invites[0].inviteId }, 1300));
    return { s, w };
  };

  it("nobody walled from a private server's owner FOLLOWS a friend into it; control: an unwalled friend does", () => {
    const { s, w } = novaHostsKaiInside();
    const orion = applySocialOperation(s, 'world.join', U.ORION, { ids: [], body: { target: 'FRIEND', userId: U.KAI }, query: {} }, at(2000), w);
    expect(orion.ok).toBe(false);
    if (!orion.ok) expect(orion.error.message).toBe('You cannot join them there'); // the ordinary can't-join, naming nobody
    const lyra = applySocialOperation(s, 'world.join', U.LYRA, { ids: [], body: { target: 'FRIEND', userId: U.KAI }, query: {} }, at(2000), w);
    expect(lyra.ok).toBe(true);
  });

  it("an invitation from inside to someone walled from the owner is answered alike and never delivered; control: an unwalled friend's arrives", () => {
    const { s, w } = novaHostsKaiInside();
    const toOrion = run(s, w, U.KAI, 'world.invite', { toUserId: U.ORION }, 2000);
    expect(toOrion.audience).toEqual([]);
    expect(worldViewFor(toOrion.world, s, U.ORION, T0 + 2100).invites).toEqual([]);
    const toLyra = run(s, toOrion.world, U.KAI, 'world.invite', { toUserId: U.LYRA }, 2200);
    expect(toLyra.audience).toEqual([U.LYRA]);
    expect(worldViewFor(toLyra.world, s, U.LYRA, T0 + 2300).invites.map((i) => i.serverName)).toEqual(["Nova's Lab"]);
    // an invitation that somehow exists still cannot carry the walled player in
    const planted: WorldState = { ...toLyra.world, invites: [...toLyra.world.invites, { inviteId: 'winv_planted', contextId: `priv_${U.NOVA}`, fromUserId: U.KAI, toUserId: U.ORION, expiresAtMs: T0 + 60_000 }] };
    expect(worldViewFor(planted, s, U.ORION, T0 + 2400).invites).toEqual([]);
    const join = applySocialOperation(s, 'world.join', U.ORION, { ids: [], body: { target: 'INVITE', inviteId: 'winv_planted' }, query: {} }, at(2500), planted);
    expect(join.ok).toBe(false);
    if (!join.ok) expect(join.error.message).toBe('That invitation is no longer open');
  });

  it("a party member walled from the owner cannot follow the leader into a private server; control: without the wall they can", () => {
    // the fixture's Arena Run party: Orion leads, Lyra is a member. Kai hosts; Orion joins Kai's server by invitation.
    const setUp = (wall: boolean) => {
      let s = createSocialFixture();
      let w = emptyWorldState();
      if (wall) {
        const walled = blockUser(s, U.KAI, U.LYRA, at(0));
        if (!walled.ok) throw new Error('block refused');
        s = walled.value;
      }
      ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PRIVATE', name: "Kai's Workshop" }, 1000));
      const invited = run(s, w, U.KAI, 'world.invite', { toUserId: U.ORION }, 1100);
      w = invited.world;
      ({ state: s, world: w } = run(s, w, U.ORION, 'world.join', { target: 'INVITE', inviteId: worldViewFor(w, s, U.ORION, T0 + 1200).invites[0].inviteId }, 1300));
      return applySocialOperation(s, 'world.join', U.LYRA, { ids: [], body: { target: 'PARTY' }, query: {} }, at(2000), w);
    };
    const walledJoin = setUp(true);
    expect(walledJoin.ok).toBe(false);
    if (!walledJoin.ok) expect(walledJoin.error.message).toBe('You cannot join them there');
    expect(setUp(false).ok).toBe(true);
  });
});

describe("the founder's 10-04 rulings P1 / P2 / P4 / P5: hidden means hidden, and a block holds at a private server (Second)", () => {
  type Privacy = SocialState['users'][string]['privacy'];
  type Presence = SocialState['users'][string]['presence'];
  const setPrivacy = (s: SocialState, who: string, patch: Partial<Privacy>): SocialState => ({
    ...s,
    users: { ...s.users, [who]: { ...s.users[who], privacy: { ...s.users[who].privacy, ...patch } } },
  });
  const setPresence = (s: SocialState, who: string, patch: Partial<Presence>): SocialState => ({
    ...s,
    users: { ...s.users, [who]: { ...s.users[who], presence: { ...s.users[who].presence, ...patch } } },
  });
  const kaiHostsNovaInside = () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PRIVATE', name: "Kai's Workshop" }, 1000));
    const invited = run(s, w, U.KAI, 'world.invite', { toUserId: U.NOVA }, 1100);
    w = invited.world;
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'INVITE', inviteId: worldViewFor(w, s, U.NOVA, T0 + 1200).invites[0].inviteId }, 1300));
    return { s, w };
  };

  it('P2: Recent Players leaves out whoever now hides from the owner and shows them again unchanged when they show; someone merely signed out stays listed', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    // Kai and Vega are strangers, both visible: they meet
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 1000));
    ({ state: s, world: w } = run(s, w, U.VEGA, 'world.join', { target: 'PUBLIC' }, 2000));
    const vegaRows = (st: SocialState) => recentPlayersViewFor(st, U.KAI).filter((e) => e.userId === U.VEGA);
    expect(vegaRows(s)).toHaveLength(1);
    const hidden = setPrivacy(s, U.VEGA, { presenceVisibility: 'FRIENDS' });
    expect(vegaRows(hidden)).toHaveLength(0);
    expect(vegaRows(setPresence(s, U.VEGA, { availability: 'APPEAR_OFFLINE' }))).toHaveLength(0);
    // the row is KEPT internally and comes back unchanged when Vega shows again
    expect(hidden.recentPlayers.filter((e) => e.ownerId === U.KAI && e.userId === U.VEGA)).toHaveLength(1);
    expect(vegaRows(setPrivacy(hidden, U.VEGA, { presenceVisibility: 'EVERYONE' }))).toEqual(vegaRows(s));
    // the control: signed out but not hiding -- still listed
    expect(vegaRows(setPresence(s, U.VEGA, { connected: false }))).toHaveLength(1);
  });

  it("P1: a player hiding from strangers is not in a stranger's world -- no figure, no name, not counted -- and the arrival and the leave are told to nobody who cannot see them; control: shown, they are", () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    s = setPrivacy(s, U.VEGA, { presenceVisibility: 'FRIENDS' }); // Vega hides from strangers; Kai is one
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 1000));
    const vegaJoin = run(s, w, U.VEGA, 'world.join', { target: 'PUBLIC' }, 2000);
    ({ state: s, world: w } = vegaJoin);
    expect(vegaJoin.audience).not.toContain(U.KAI);
    ({ world: w } = run(s, w, U.KAI, 'world.state', here, 2100));
    ({ world: w } = run(s, w, U.VEGA, 'world.state', here, 2100));
    const kaiSees = worldViewFor(w, s, U.KAI, T0 + 2200);
    expect(kaiSees.avatars.map((a) => a.userId)).toEqual([]);
    expect(kaiSees.context?.population).toBe(1);
    expect(JSON.stringify(kaiSees)).not.toContain('Vega');
    expect(worldViewFor(w, s, U.VEGA, T0 + 2200).avatars.map((a) => a.userId)).toEqual([U.KAI]); // Vega still sees Kai
    const leave = run(s, w, U.VEGA, 'world.leave', {}, 2300);
    expect(leave.audience).not.toContain(U.KAI);
    // the control: Vega shown again -- Kai sees the figure and counts two
    const shown = setPrivacy(s, U.VEGA, { presenceVisibility: 'EVERYONE' });
    expect(worldViewFor(w, shown, U.KAI, T0 + 2200).avatars.map((a) => a.userId)).toEqual([U.VEGA]);
    expect(worldViewFor(w, shown, U.KAI, T0 + 2200).context?.population).toBe(2);
  });

  it("P1: friends follow the player's own setting -- appearing offline hides them from friends too; an audience of FRIENDS shows them to a friend", () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    // Sol appears offline (the fixture) and is Kai's friend; Lyra is Kai's friend and shows to FRIENDS
    s = setPrivacy(s, U.LYRA, { presenceVisibility: 'FRIENDS' });
    s = setPresence(s, U.LYRA, { availability: 'AVAILABLE' });
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 1000));
    ({ state: s, world: w } = run(s, w, U.SOL, 'world.join', { target: 'PUBLIC' }, 1100));
    ({ state: s, world: w } = run(s, w, U.LYRA, 'world.join', { target: 'PUBLIC' }, 1200));
    for (const who of [U.KAI, U.SOL, U.LYRA]) ({ world: w } = run(s, w, who, 'world.state', here, 1300));
    expect(worldViewFor(w, s, U.KAI, T0 + 1400).avatars.map((a) => a.userId)).toEqual([U.LYRA]);
  });

  it("P4: the owner's block removes the blocked player from the owner's private server at once, clears their location, and their next report reads the generic \"You can't stay in this server.\"; the owner stays; re-entry is refused", () => {
    const { s, w } = kaiHostsNovaInside();
    expect(contextOf(w, U.NOVA)?.contextId).toBe(`priv_${U.KAI}`);
    const blocked = run(s, w, U.KAI, 'blocks.add', { targetId: U.NOVA }, 2000);
    expect(blocked.world).toBeDefined();
    expect(contextOf(blocked.world, U.NOVA)).toBeUndefined();
    expect(blocked.state.users[U.NOVA].presence.location).toBeNull();
    expect(contextOf(blocked.world, U.KAI)?.contextId).toBe(`priv_${U.KAI}`);
    const report = applySocialOperation(blocked.state, 'world.state', U.NOVA, { ids: [], body: here, query: {} }, at(2100), blocked.world);
    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.error.message).toBe("You can't stay in this server.");
      expect(report.error.message).not.toMatch(/block/i);
    }
    // re-entry while the block stands: refused with the ordinary can't-join
    const back = applySocialOperation(blocked.state, 'world.join', U.NOVA, { ids: [], body: { target: 'FRIEND', userId: U.KAI }, query: {} }, at(2200), blocked.world);
    expect(back.ok).toBe(false);
  });

  it("P5 (the founder's written correction, 10-04 ~17:35Z): a MEMBER blocking the OWNER inside the owner's server -- the blocker is out at once with the generic message, the owner stays, re-entry is refused while the block stands", () => {
    const { s, w } = kaiHostsNovaInside();
    const memberBlocks = run(s, w, U.NOVA, 'blocks.add', { targetId: U.KAI }, 2000);
    expect(memberBlocks.world).toBeDefined();
    expect(contextOf(memberBlocks.world, U.NOVA)).toBeUndefined(); // the blocker left
    expect(contextOf(memberBlocks.world, U.KAI)?.contextId).toBe(`priv_${U.KAI}`); // the owner stays
    expect(memberBlocks.state.users[U.NOVA].presence.location).toBeNull();
    const report = applySocialOperation(memberBlocks.state, 'world.state', U.NOVA, { ids: [], body: here, query: {} }, at(2100), memberBlocks.world);
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.error.message).toBe("You can't stay in this server.");
    const reenter = applySocialOperation(memberBlocks.state, 'world.join', U.NOVA, { ids: [], body: { target: 'FRIEND', userId: U.KAI }, query: {} }, at(2200), memberBlocks.world);
    expect(reenter.ok).toBe(false);
    // after a new join anywhere the notice is gone: the player moved on
    const elsewhere = run(memberBlocks.state, memberBlocks.world, U.NOVA, 'world.join', { target: 'PUBLIC' }, 2300);
    expect(elsewhere.world.removals?.[U.NOVA]).toBeUndefined();
    // the control: the owner blocking someone OUTSIDE the server moves nobody
    const outsider = run(s, w, U.KAI, 'blocks.add', { targetId: U.VEGA }, 2500);
    expect(outsider.world).toBeUndefined();
  });
});

describe("the founder's 10-04 ruling P3: ONE canonical visibility rule, and no stale field bypasses it (Second)", () => {
  it('a stale appearInRecentPlayers in stored privacy changes nothing: recording and reading follow presence alone', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    // stale data from before the field was dropped, either value, must not move the rule
    const stale = (st: SocialState, who: string, value: boolean): SocialState => ({
      ...st,
      users: { ...st.users, [who]: { ...st.users[who], privacy: { ...st.users[who].privacy, appearInRecentPlayers: value } as SocialState['users'][string]['privacy'] } },
    });
    s = stale(s, U.VEGA, false); // a stale opt-OUT on a VISIBLE player: recorded anyway
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 1000));
    ({ state: s, world: w } = run(s, w, U.VEGA, 'world.join', { target: 'PUBLIC' }, 2000));
    expect(recentPlayersViewFor(s, U.KAI).filter((e) => e.userId === U.VEGA)).toHaveLength(1);
    // a stale opt-IN on a HIDDEN player: still hidden (P2), and not seen in the world (P1)
    let h = stale(s, U.VEGA, true);
    h = { ...h, users: { ...h.users, [U.VEGA]: { ...h.users[U.VEGA], privacy: { ...h.users[U.VEGA].privacy, presenceVisibility: 'FRIENDS' } } } };
    expect(recentPlayersViewFor(h, U.KAI).filter((e) => e.userId === U.VEGA)).toHaveLength(0);
    ({ world: w } = run(h, w, U.KAI, 'world.state', here, 2100));
    ({ world: w } = run(h, w, U.VEGA, 'world.state', here, 2100));
    expect(worldViewFor(w, h, U.KAI, T0 + 2200).avatars.map((a) => a.userId)).toEqual([]);
  });

  it('the privacy contract no longer carries the field: defaults and a privacy read have no appearInRecentPlayers', () => {
    const s = createSocialFixture();
    expect(Object.keys(s.users[U.KAI].privacy)).not.toContain('appearInRecentPlayers');
    const read = applySocialOperation(s, 'privacy.read_self', U.KAI, { ids: [], body: {}, query: {} }, at(0), emptyWorldState());
    expect(read.ok).toBe(true);
    if (read.ok) expect(JSON.stringify(read.value.data)).not.toContain('appearInRecentPlayers');
  });
});
