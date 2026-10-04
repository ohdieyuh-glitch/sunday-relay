import { describe, expect, it } from 'vitest';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { blockUser } from './social-friends';
import { recentPlayersViewFor } from './social-parties';
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

  it('nobody is recorded across a block, nor into anyone\'s list who opted out of appearing; a different world records nothing', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    const blocked = blockUser(s, U.KAI, U.NOVA, at(0));
    if (!blocked.ok) throw new Error('block refused');
    s = blocked.value;
    s = { ...s, users: { ...s.users, [U.LYRA]: { ...s.users[U.LYRA], privacy: { ...s.users[U.LYRA].privacy, appearInRecentPlayers: false } } } };
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 1000));
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC' }, 2000));
    ({ state: s, world: w } = run(s, w, U.LYRA, 'world.join', { target: 'PUBLIC' }, 3000));
    ({ state: s, world: w } = run(s, w, U.ORION, 'world.join', { target: 'PUBLIC', place: 'tower_lane', placeName: 'Tower Lane' }, 4000));
    expect(metIn(s, U.KAI, U.NOVA, at(2000))).toHaveLength(0);
    expect(metIn(s, U.NOVA, U.KAI, at(2000))).toHaveLength(0);
    expect(metIn(s, U.KAI, U.LYRA, at(3000))).toHaveLength(0);
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
