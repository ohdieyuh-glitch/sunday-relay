import { describe, expect, it } from 'vitest';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { blockUser } from './social-friends';
import { recentPlayersViewFor } from './social-parties';
import { resolvePresenceFor, resolveProfileFor } from './social-presence';
import { buildSocialView } from './social-preview';
import type { SocialState } from './social-state';
import { emptySocialState, friendIdsOf } from './social-state';
import { ensureSocialUser } from './social-store';
import {
  WORLD_AVATAR_STALE_MS,
  WORLD_HANDOFFS,
  WORLD_HANDOFF_EVENT_MIN_INTERVAL_MS,
  WORLD_HANDOFF_EVENT_RETAIN_MS,
  parseHandoffEvent,
  WORLD_PUBLIC_CAPACITY,
  coerceWorldHandoff,
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

/**
 * What a viewer is told about a figure's handoff: 'NO FIGURE' when the figure is not shown at all, 'ABSENT' when it is shown WITHOUT a
 * `handoff` key (NONE is left out of the view, Skywalker's ruling 10-23; clients read absent as NONE), else the exact value.
 */
const handoffShown = (a: { readonly handoff?: string } | undefined): string => (a === undefined ? 'NO FIGURE' : 'handoff' in a ? String(a.handoff) : 'ABSENT');

describe('MP-VIS-02: the equipped Mission Handoff is transported to the other players, as a closed enum and nothing more', () => {
  const joined2 = () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }));
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC' }));
    return { s, w };
  };
  const novaFromKai = (w: WorldState, s: SocialState, ms: number) => worldViewFor(w, s, U.NOVA, T0 + ms).avatars.find((a) => a.userId === U.KAI);

  it('the closed list is NONE and TWIN_SWORDS, and the coercion reads everything else as NONE', () => {
    expect([...WORLD_HANDOFFS]).toEqual(['NONE', 'TWIN_SWORDS']);
    expect(coerceWorldHandoff('TWIN_SWORDS')).toBe('TWIN_SWORDS');
    for (const bad of [undefined, null, '', 'twin_swords', 'TWIN_SWORDS ', 'HELD', 7, true, {}, ['TWIN_SWORDS']]) {
      expect(coerceWorldHandoff(bad), String(bad)).toBe('NONE');
    }
  });

  it('a report that omits the field (an older client) reads NONE; activation, movement and deactivation reach the other player; each report is the whole truth', () => {
    const { s, w: w0 } = joined2();
    let w = w0;
    ({ world: w } = run(s, w, U.KAI, 'world.state', here, 200));
    expect(handoffShown(novaFromKai(w, s, 250)), 'older client: field absent, NONE is left out').toBe('ABSENT');
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'TWIN_SWORDS' }, 400));
    expect(novaFromKai(w, s, 450)?.handoff).toBe('TWIN_SWORDS');
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, x: 900, motion: 'RUN', speed: 500, handoff: 'TWIN_SWORDS' }, 600));
    expect([novaFromKai(w, s, 650)?.x, novaFromKai(w, s, 650)?.handoff]).toEqual([900, 'TWIN_SWORDS']);
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'NONE' }, 800));
    expect(handoffShown(novaFromKai(w, s, 850))).toBe('ABSENT');
    // nothing sticks from an earlier report: a later report that omits the field clears it
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'TWIN_SWORDS' }, 1000));
    ({ world: w } = run(s, w, U.KAI, 'world.state', here, 1200));
    expect(handoffShown(novaFromKai(w, s, 1250))).toBe('ABSENT');
  });

  it('a malformed or unknown value never fails the report: the position is taken and the handoff reads NONE', () => {
    const { s, w: w0 } = joined2();
    let w = w0;
    let ms = 200;
    for (const bad of ['twin_swords', 'MYSTERY_FORM', '', 7, null, true, { form: 'TWIN_SWORDS' }, ['TWIN_SWORDS'], 'A'.repeat(5000)]) {
      ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, x: ms, handoff: bad }, ms));
      const seen = novaFromKai(w, s, ms + 10);
      expect([seen?.x, handoffShown(seen)], String(JSON.stringify(bad)).slice(0, 40)).toEqual([ms, 'ABSENT']);
      ms += 200;
    }
  });

  it("a player can only set their OWN handoff: another player's report never changes it, whatever ids the body names", () => {
    const { s, w: w0 } = joined2();
    let w = w0;
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'TWIN_SWORDS' }, 200));
    ({ world: w } = run(s, w, U.NOVA, 'world.state', { ...here, userId: U.KAI, actorId: U.KAI, handoff: 'NONE' }, 300));
    expect(worldViewFor(w, s, U.NOVA, T0 + 350).avatars.find((a) => a.userId === U.KAI)?.handoff).toBe('TWIN_SWORDS');
    expect(handoffShown(worldViewFor(w, s, U.KAI, T0 + 350).avatars.find((a) => a.userId === U.NOVA))).toBe('ABSENT');
    expect(w.avatars[U.NOVA]?.userId).toBe(U.NOVA);
  });

  it('a late joiner sees the current handoff on their first view; a silent owner drops after the stale window and returns with the flag on the next report', () => {
    let { s, w } = joined2();
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'TWIN_SWORDS' }, 200));
    ({ state: s, world: w } = run(s, w, U.ORION, 'world.join', { target: 'PUBLIC' }, 400));
    expect(worldViewFor(w, s, U.ORION, T0 + 450).avatars.find((a) => a.userId === U.KAI)?.handoff, 'late join').toBe('TWIN_SWORDS');
    expect(worldViewFor(w, s, U.NOVA, T0 + 200 + WORLD_AVATAR_STALE_MS + 1).avatars.find((a) => a.userId === U.KAI), 'stale: gone').toBeUndefined();
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'TWIN_SWORDS' }, 200 + WORLD_AVATAR_STALE_MS + 500));
    expect(worldViewFor(w, s, U.NOVA, T0 + 200 + WORLD_AVATAR_STALE_MS + 600).avatars.find((a) => a.userId === U.KAI)?.handoff, 'reconnect').toBe('TWIN_SWORDS');
  });

  it('leaving the world takes the handoff with the avatar; a rejoin shows nothing until the next report', () => {
    let { s, w } = joined2();
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'TWIN_SWORDS' }, 200));
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.leave', {}, 300));
    expect(w.avatars[U.KAI]).toBeUndefined();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 400));
    expect(novaFromKai(w, s, 450)).toBeUndefined();
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'TWIN_SWORDS' }, 600));
    expect(novaFromKai(w, s, 650)?.handoff).toBe('TWIN_SWORDS');
  });

  it('a block, either way, hides the figure and so its handoff; reportAvatar keeps the direct contract (default NONE, stored value, coerced forgery)', () => {
    let { s, w } = joined2();
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'TWIN_SWORDS' }, 200));
    expect(novaFromKai(w, s, 250)?.handoff).toBe('TWIN_SWORDS');
    const blocked = blockUser(s, U.NOVA, U.KAI, at(300));
    if (!blocked.ok) throw new Error('block');
    s = blocked.value;
    expect(worldViewFor(w, s, U.NOVA, T0 + 400).avatars).toEqual([]);
    expect(worldViewFor(w, s, U.KAI, T0 + 400).avatars).toEqual([]);
    const j = joinWorld(emptyWorldState(), createSocialFixture(), U.KAI, { kind: 'PUBLIC', place: 'golden_arrival', placeName: 'Golden Arrival' }, T0);
    if (!j.ok) throw new Error('join');
    const noField = reportAvatar(j.value.world, U.KAI, { ...here, motion: 'IDLE' }, T0 + 200);
    const withField = reportAvatar(j.value.world, U.KAI, { ...here, motion: 'IDLE', handoff: 'TWIN_SWORDS' }, T0 + 200);
    const forced = reportAvatar(j.value.world, U.KAI, { ...here, motion: 'IDLE', handoff: 'EVIL' as never }, T0 + 200);
    expect([noField, withField, forced].map((r) => (r.ok ? r.value.avatars[U.KAI]?.handoff : 'refused'))).toEqual(['NONE', 'TWIN_SWORDS', 'NONE']);
  });

  it('the view leaves NONE out and gives every other form exactly, in the place it had: a NONE figure is byte for byte a figure from before the handoff existed', () => {
    const { s, w: w0 } = joined2();
    let w = w0;
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'NONE' }, 200));
    const none = novaFromKai(w, s, 250);
    expect(none, 'the figure itself is shown').toBeDefined();
    expect(Object.keys(none ?? {}).includes('handoff')).toBe(false);
    expect(Object.keys(none ?? {})).toEqual(['userId', 'contextId', 'x', 'y', 'z', 'yaw', 'speed', 'motion', 'skinId', 'reportedAtMs', 'displayName', 'ageMs']);
    // every non-NONE form in the closed list is returned with its exact value, right after skinId (where the stored avatar keeps it)
    let ms = 400;
    for (const form of WORLD_HANDOFFS.filter((f) => f !== 'NONE')) {
      ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: form }, ms));
      const on = novaFromKai(w, s, ms + 50);
      expect(handoffShown(on), form).toBe(form);
      expect(Object.keys(on ?? {}).slice(8, 10), form).toEqual(['skinId', 'handoff']);
      ms += 200;
    }
    // and back to NONE: left out again
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'NONE' }, ms));
    expect(handoffShown(novaFromKai(w, s, ms + 50))).toBe('ABSENT');
  });

  it('on input, a missing field and NONE are the same: the same stored avatar, the same view, the same bytes, and the same legality for the next event', () => {
    const j = joinWorld(emptyWorldState(), createSocialFixture(), U.KAI, { kind: 'PUBLIC', place: 'golden_arrival', placeName: 'Golden Arrival' }, T0);
    if (!j.ok) throw new Error('join');
    const missing = reportAvatar(j.value.world, U.KAI, { ...here, motion: 'IDLE' }, T0 + 200);
    const none = reportAvatar(j.value.world, U.KAI, { ...here, motion: 'IDLE', handoff: 'NONE' }, T0 + 200);
    if (!missing.ok || !none.ok) throw new Error('report');
    expect(missing.value.avatars[U.KAI]).toEqual(none.value.avatars[U.KAI]);
    expect(JSON.stringify(missing.value.avatars[U.KAI])).toBe(JSON.stringify(none.value.avatars[U.KAI]));
    expect(coerceWorldHandoff(undefined)).toBe(coerceWorldHandoff('NONE'));
    // through the command layer, for a viewer: identical answers
    const { s, w: w0 } = joined2();
    const viaMissing = run(s, w0, U.KAI, 'world.state', here, 200).world;
    const viaNone = run(s, w0, U.KAI, 'world.state', { ...here, handoff: 'NONE' }, 200).world;
    expect(JSON.stringify(worldViewFor(viaMissing, s, U.NOVA, T0 + 250))).toBe(JSON.stringify(worldViewFor(viaNone, s, U.NOVA, T0 + 250)));
    // the stored state an ACTIVATE is checked against is NONE either way, so the same activation is accepted after both
    const act = { epoch: 7, n: 1, kind: 'ACTIVATE', form: 'TWIN_SWORDS', sinceMs: 0 };
    const afterMissing = run(s, viaMissing, U.KAI, 'world.state', { ...here, handoff: 'TWIN_SWORDS', handoffEvent: act }, 1200).world;
    const afterNone = run(s, viaNone, U.KAI, 'world.state', { ...here, handoff: 'TWIN_SWORDS', handoffEvent: act }, 1200).world;
    expect(worldViewFor(afterMissing, s, U.NOVA, T0 + 1250).avatars.find((a) => a.userId === U.KAI)?.handoffEvent).toMatchObject({ seq: 1, kind: 'ACTIVATE' });
    expect(JSON.stringify(worldViewFor(afterMissing, s, U.NOVA, T0 + 1250))).toBe(JSON.stringify(worldViewFor(afterNone, s, U.NOVA, T0 + 1250)));
  });
});

describe('MP-VIS-02 REV2: the activation event is sequenced by the server, idempotent, bounded, and visible only to those who may see the player', () => {
  const ev = (n: number, kind: 'ACTIVATE' | 'DEACTIVATE', extra: Record<string, unknown> = {}) => ({ epoch: 7, n, kind, form: 'TWIN_SWORDS', sinceMs: 0, ...extra });
  const on = { ...here, handoff: 'TWIN_SWORDS' };
  const joined = () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }));
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC' }));
    return { s, w };
  };
  const seen = (w: WorldState, s: SocialState, ms: number, viewer: string = U.NOVA, who: string = U.KAI) => worldViewFor(w, s, viewer, T0 + ms).avatars.find((a) => a.userId === who);

  it('parseHandoffEvent is total: only a whole, closed, in-range event survives; sinceMs is clamped', () => {
    expect(parseHandoffEvent(ev(1, 'ACTIVATE'))).toEqual({ epoch: 7, n: 1, kind: 'ACTIVATE', form: 'TWIN_SWORDS', sinceMs: 0 });
    expect(parseHandoffEvent(ev(1, 'ACTIVATE', { sinceMs: 99999 }))?.sinceMs).toBe(1000);
    expect(parseHandoffEvent(ev(1, 'ACTIVATE', { sinceMs: -5 }))?.sinceMs).toBe(0);
    expect(parseHandoffEvent({ epoch: 7, n: 1, kind: 'ACTIVATE', form: 'TWIN_SWORDS' })?.sinceMs).toBe(0);
    for (const bad of [undefined, null, 7, 'ACTIVATE', [], {}, ev(0, 'ACTIVATE'), ev(1.5, 'ACTIVATE'), ev(2 ** 31, 'ACTIVATE'), ev(1, 'activate' as never), ev(1, 'EXPLODE' as never),
      ev(1, 'ACTIVATE', { form: 'NONE' }), ev(1, 'ACTIVATE', { form: 'SPACESHIP' }), ev(1, 'ACTIVATE', { form: 7 }), ev(1, 'ACTIVATE', { epoch: -1 }), ev(1, 'ACTIVATE', { sinceMs: 'soon' }),
      ev(1, 'ACTIVATE', { sinceMs: Number.NaN })]) {
      expect(parseHandoffEvent(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('an ACTIVATE is stored with a server seq and returned with its age and without the client keys; a resend of the same (epoch, n) is idempotent', () => {
    const { s, w: w0 } = joined();
    let w = w0;
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(1, 'ACTIVATE') }, 1000));
    expect(seen(w, s, 1300)?.handoffEvent).toEqual({ seq: 1, kind: 'ACTIVATE', form: 'TWIN_SWORDS', ageMs: 300 });
    for (const ms of [1200, 1400, 1600]) ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(1, 'ACTIVATE') }, ms));
    expect(seen(w, s, 1700)?.handoffEvent, 'resends neither re-sequence nor move the start').toEqual({ seq: 1, kind: 'ACTIVATE', form: 'TWIN_SWORDS', ageMs: 700 });
    expect(JSON.stringify(seen(w, s, 1700))).not.toContain('epoch');
  });

  it('sinceMs back-dates the start by at most one second; an event older than the retain window is no longer returned (the persistent state still is)', () => {
    const { s, w: w0 } = joined();
    let w = w0;
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(1, 'ACTIVATE', { sinceMs: 400 }) }, 2000));
    expect(seen(w, s, 2000)?.handoffEvent?.ageMs).toBe(400);
    // the owner keeps reporting (and resending the same event) so the figure stays; the event started at 1600
    for (const ms of [6000, 11500]) ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(1, 'ACTIVATE', { sinceMs: 400 }) }, ms));
    expect(seen(w, s, 1600 + WORLD_HANDOFF_EVENT_RETAIN_MS)?.handoffEvent, 'at the limit it is still returned').toBeDefined();
    expect(seen(w, s, 1600 + WORLD_HANDOFF_EVENT_RETAIN_MS + 1)?.handoffEvent).toBeUndefined();
    expect(seen(w, s, 1600 + WORLD_HANDOFF_EVENT_RETAIN_MS + 1)?.handoff).toBe('TWIN_SWORDS');
  });

  it('out-of-order and duplicate events never move the sequence back; a new launch (new epoch) is accepted although its counter restarted', () => {
    const { s, w: w0 } = joined();
    let w = w0;
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(5, 'ACTIVATE') }, 1000));
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'NONE', handoffEvent: ev(6, 'DEACTIVATE') }, 5000));
    expect(seen(w, s, 5100)?.handoffEvent?.kind).toBe('DEACTIVATE');
    // a delayed copy of the older ACTIVATE (n=5) arrives afterwards: ignored, and the persistent state stays what the newest report said
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'NONE', handoffEvent: ev(5, 'ACTIVATE') }, 5300));
    expect(seen(w, s, 5400)?.handoffEvent).toMatchObject({ seq: 2, kind: 'DEACTIVATE' });
    // a new launch: epoch 8, n restarts at 1
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(1, 'ACTIVATE', { epoch: 8 }) }, 9000));
    expect(seen(w, s, 9100)?.handoffEvent).toMatchObject({ seq: 3, kind: 'ACTIVATE' });
  });

  it('is bounded: a second NEW event within the minimum interval is dropped, and is not revived later by a resend (its report already stated the new equipped state)', () => {
    const { s, w: w0 } = joined();
    let w = w0;
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(1, 'ACTIVATE') }, 1000));
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'NONE', handoffEvent: ev(2, 'DEACTIVATE') }, 1000 + WORLD_HANDOFF_EVENT_MIN_INTERVAL_MS - 200));
    expect(seen(w, s, 1700)?.handoffEvent?.seq).toBe(1);
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'NONE', handoffEvent: ev(2, 'DEACTIVATE') }, 1000 + WORLD_HANDOFF_EVENT_MIN_INTERVAL_MS + 200));
    expect(seen(w, s, 2100)?.handoffEvent?.seq, 'the persistent state is NONE now, so a DEACTIVATE is no longer legal').toBe(1);
    expect(handoffShown(seen(w, s, 2100))).toBe('ABSENT');
  });

  it('is legal only for what the player has equipped and only consistent with the report that carries it', () => {
    const { s, w: w0 } = joined();
    let w = w0;
    // DEACTIVATE with nothing equipped: ignored (the report is still taken)
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, x: 555, handoff: 'NONE', handoffEvent: ev(1, 'DEACTIVATE') }, 1000));
    expect([seen(w, s, 1100)?.x, seen(w, s, 1100)?.handoffEvent]).toEqual([555, undefined]);
    // ACTIVATE while the same report says NONE: inconsistent, ignored
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'NONE', handoffEvent: ev(2, 'ACTIVATE') }, 1200));
    expect(seen(w, s, 1300)?.handoffEvent).toBeUndefined();
    // a restored HELD (no event) then a DEACTIVATE: legal, because the previous report said equipped
    ({ world: w } = run(s, w, U.KAI, 'world.state', on, 1400));
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, handoff: 'NONE', handoffEvent: ev(3, 'DEACTIVATE') }, 1600));
    expect(seen(w, s, 1700)?.handoffEvent).toMatchObject({ seq: 1, kind: 'DEACTIVATE' });
    // a proper ACTIVATE afterwards is the second event
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(4, 'ACTIVATE') }, 3000));
    expect(seen(w, s, 3100)?.handoffEvent).toMatchObject({ seq: 2, kind: 'ACTIVATE' });
    // ACTIVATE while already equipped: ignored
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(5, 'ACTIVATE') }, 5000));
    expect(seen(w, s, 5100)?.handoffEvent?.seq, 'a second ACTIVATE while equipped changes nothing').toBe(2);
  });

  it('a malformed event never costs the report: the position is taken, the event is ignored; an animation name in the body is never read', () => {
    const { s, w: w0 } = joined();
    let w = w0;
    let ms = 1000;
    for (const bad of ['ACTIVATE', 7, [], { kind: 'ACTIVATE' }, { ...ev(1, 'ACTIVATE'), form: '/Game/Anim/Evil' }, { epoch: 'x' }]) {
      ({ world: w } = run(s, w, U.KAI, 'world.state', { ...here, x: ms, handoffEvent: bad }, ms));
      expect([seen(w, s, ms + 10)?.x, seen(w, s, ms + 10)?.handoffEvent], JSON.stringify(bad)).toEqual([ms, undefined]);
      ms += 200;
    }
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: { ...ev(1, 'ACTIVATE'), animation: 'Evil', duration: 1e9, x: 1e12 } }, ms));
    expect(JSON.stringify(seen(w, s, ms + 10)?.handoffEvent)).toBe(JSON.stringify({ seq: 1, kind: 'ACTIVATE', form: 'TWIN_SWORDS', ageMs: 10 }));
  });

  it('two players activate at the same moment: each has their own sequence, and neither can write the other', () => {
    const { s, w: w0 } = joined();
    let w = w0;
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(1, 'ACTIVATE') }, 1000));
    ({ world: w } = run(s, w, U.NOVA, 'world.state', { ...on, handoffEvent: { ...ev(1, 'ACTIVATE'), epoch: 99 } }, 1000));
    expect(seen(w, s, 1100, U.NOVA, U.KAI)?.handoffEvent).toMatchObject({ seq: 1, kind: 'ACTIVATE' });
    expect(seen(w, s, 1100, U.KAI, U.NOVA)?.handoffEvent).toMatchObject({ seq: 1, kind: 'ACTIVATE' });
    // Nova sends an event while Kai is the only one equipped in her body's claim: Kai's record is untouched by it
    ({ world: w } = run(s, w, U.NOVA, 'world.state', { ...here, handoff: 'NONE', handoffEvent: ev(2, 'DEACTIVATE', { epoch: 99 }) }, 5000));
    expect(seen(w, s, 5100, U.NOVA, U.KAI)?.handoffEvent).toMatchObject({ seq: 1, kind: 'ACTIVATE' });
  });

  it('a late joiner is given the event with its age (to play the remainder or to settle) and the persistent state; the block wall hides both', () => {
    let { s, w } = joined();
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(1, 'ACTIVATE') }, 1000));
    ({ state: s, world: w } = run(s, w, U.ORION, 'world.join', { target: 'PUBLIC' }, 2000));
    expect(seen(w, s, 2500, U.ORION, U.KAI)).toMatchObject({ handoff: 'TWIN_SWORDS', handoffEvent: { seq: 1, kind: 'ACTIVATE', ageMs: 1500 } });
    const blocked = blockUser(s, U.NOVA, U.KAI, at(2600));
    if (!blocked.ok) throw new Error('block');
    s = blocked.value;
    expect(seen(w, s, 2700, U.NOVA, U.KAI)).toBeUndefined();
    expect(seen(w, s, 2700, U.ORION, U.KAI)?.handoffEvent?.seq).toBe(1);
  });

  it('leaving the world drops the event with the avatar: a rejoin starts without one', () => {
    let { s, w } = joined();
    ({ world: w } = run(s, w, U.KAI, 'world.state', { ...on, handoffEvent: ev(1, 'ACTIVATE') }, 1000));
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.leave', {}, 1500));
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PUBLIC' }, 1600));
    ({ world: w } = run(s, w, U.KAI, 'world.state', on, 1800));
    expect(seen(w, s, 1900)).toMatchObject({ handoff: 'TWIN_SWORDS' });
    expect(seen(w, s, 1900)?.handoffEvent).toBeUndefined();
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
    // (10-07, B3) the owner's wall now answers exactly as a leader in no world: the follow names nothing about where the leader is
    if (!walledJoin.ok) expect(walledJoin.error.message).toBe('Your party leader is not in a world');
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

  it("P4: the owner's block removes the blocked player from the owner's private server at once, clears their location, and their next report is answered with no context (the client's \"You can't stay in this server.\"); the owner stays; re-entry is refused", () => {
    const { s, w } = kaiHostsNovaInside();
    expect(contextOf(w, U.NOVA)?.contextId).toBe(`priv_${U.KAI}`);
    const blocked = run(s, w, U.KAI, 'blocks.add', { targetId: U.NOVA }, 2000);
    expect(blocked.world).toBeDefined();
    expect(contextOf(blocked.world, U.NOVA)).toBeUndefined();
    expect(blocked.state.users[U.NOVA].presence.location).toBeNull();
    expect(contextOf(blocked.world, U.KAI)?.contextId).toBe(`priv_${U.KAI}`);
    // the removed player's own tick is ANSWERED with no context (the client words it "You can't stay in this server.")
    const report = applySocialOperation(blocked.state, 'world.state', U.NOVA, { ids: [], body: here, query: {} }, at(2100), blocked.world);
    expect(report.ok).toBe(true);
    if (report.ok) {
      const view = report.value.data as ReturnType<typeof worldViewFor>;
      expect(view.context ?? null).toBeNull();
      expect(view.avatars).toEqual([]);
      expect(JSON.stringify(view)).not.toMatch(/block/i);
    }
    // re-entry while the block stands: refused with the ordinary can't-join
    const back = applySocialOperation(blocked.state, 'world.join', U.NOVA, { ids: [], body: { target: 'FRIEND', userId: U.KAI }, query: {} }, at(2200), blocked.world);
    expect(back.ok).toBe(false);
  });

  it("P5 (the founder's written correction, 10-04 ~17:35Z): a MEMBER blocking the OWNER inside the owner's server -- the blocker is out at once (answered with no context), the owner stays, re-entry is refused while the block stands", () => {
    const { s, w } = kaiHostsNovaInside();
    const memberBlocks = run(s, w, U.NOVA, 'blocks.add', { targetId: U.KAI }, 2000);
    expect(memberBlocks.world).toBeDefined();
    expect(contextOf(memberBlocks.world, U.NOVA)).toBeUndefined(); // the blocker left
    expect(contextOf(memberBlocks.world, U.KAI)?.contextId).toBe(`priv_${U.KAI}`); // the owner stays
    expect(memberBlocks.state.users[U.NOVA].presence.location).toBeNull();
    const report = applySocialOperation(memberBlocks.state, 'world.state', U.NOVA, { ids: [], body: here, query: {} }, at(2100), memberBlocks.world);
    expect(report.ok).toBe(true);
    if (report.ok) expect((report.value.data as ReturnType<typeof worldViewFor>).context ?? null).toBeNull();
    // the control: someone who never joined is still refused ("Join a world first"), not answered
    const stranger = applySocialOperation(memberBlocks.state, 'world.state', U.VEGA, { ids: [], body: here, query: {} }, at(2100), memberBlocks.world);
    expect(stranger.ok).toBe(false);
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

describe("the presence control (founder 10-04, CORE's Hub): the player's own choice, to them alone; nothing inferred from events (Second)", () => {
  const snapshotOf = (s: SocialState, who: string) => {
    const r = applySocialOperation(s, 'snapshot.read', who, { ids: [], body: {}, query: {} }, at(900), emptyWorldState());
    if (!r.ok) throw new Error(r.error.message);
    return r.value.data as { self: { presence: Record<string, unknown> } };
  };
  /** Every object anywhere in a view that is ABOUT this user (carries their userId). */
  const aboutUser = (value: unknown, userId: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
    if (Array.isArray(value)) for (const v of value) aboutUser(v, userId, out);
    else if (value !== null && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      if (o.userId === userId) out.push(o);
      for (const v of Object.values(o)) aboutUser(v, userId, out);
    }
    return out;
  };
  const update = (s: SocialState, who: string, body: Record<string, unknown>, ms: number) => {
    const r = applySocialOperation(s, 'presence.update_self', who, { ids: [], body, query: {} }, at(ms), emptyWorldState());
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  it("snapshot.self.presence.availability is the player's own choice -- APPEAR_OFFLINE included -- and no other player's snapshot carries it for them", () => {
    let s = createSocialFixture();
    for (const availability of ['AWAY', 'BUSY', 'APPEAR_OFFLINE', 'AVAILABLE'] as const) {
      s = update(s, U.KAI, { availability }, 100).state;
      expect(snapshotOf(s, U.KAI).self.presence.availability, availability).toBe(availability);
      for (const viewer of Object.keys(s.users).filter((id) => id !== U.KAI)) {
        const about = aboutUser(snapshotOf(s, viewer), U.KAI);
        for (const o of about) expect(Object.keys(o), `${viewer} reading Kai at ${availability}`).not.toContain('availability');
      }
    }
    // the control: the others DO read Kai (the walk is not blind), and what they see is the result -- appearing offline reads OFFLINE
    expect(aboutUser(snapshotOf(s, U.NOVA), U.KAI).length).toBeGreaterThan(0);
    s = update(s, U.KAI, { availability: 'APPEAR_OFFLINE' }, 200).state;
    expect(resolvePresenceFor(s, U.NOVA, U.KAI)?.onlineState).toBe('OFFLINE');
    expect(snapshotOf(s, U.KAI).self.presence.onlineState).toBe('ONLINE'); // why the field exists: SELF reads ONLINE
  });

  it('a presence change is told only to those who could see it before or after: going hidden and coming back are told; a change made while hidden is told to nobody else', () => {
    let s = update(createSocialFixture(), U.KAI, { availability: 'AVAILABLE', connected: true }, 100).state;
    const toldOf = (body: Record<string, unknown>, ms: number) => {
      const out = update(s, U.KAI, body, ms);
      s = out.state;
      return [...out.audience].sort();
    };
    const visible = toldOf({ activityDetail: 'in the open' }, 200);
    expect(visible).toEqual(expect.arrayContaining([U.KAI, ...friendIdsOf(s, U.KAI)]));
    expect(visible.length).toBeGreaterThan(3);
    expect(toldOf({ availability: 'APPEAR_OFFLINE' }, 300)).toEqual(visible); // going hidden: their views change
    expect(toldOf({ activityDetail: 'while hidden' }, 400)).toEqual([U.KAI]); // a change while hidden: nobody else
    expect(toldOf({ connected: false }, 450)).toEqual([U.KAI]); // signing out while hidden: nobody learns when
    expect(toldOf({ connected: true, availability: 'BUSY' }, 500)).toEqual(visible); // coming back: told
    // an audience that leaves the friends out hides the same way
    s = { ...s, users: { ...s.users, [U.KAI]: { ...s.users[U.KAI], privacy: { ...s.users[U.KAI].privacy, presenceVisibility: 'NOBODY' } } } };
    expect(toldOf({ activityDetail: 'to nobody' }, 600)).toEqual([U.KAI]);
  });
});

describe("the removal notice survives a sleeping client (Second's review of CORE aabfb10c, m5)", () => {
  it('ten minutes after a block removed them, the first report back is still answered with no context; past the window, or after any join, the ordinary paths apply', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.KAI, 'world.join', { target: 'PRIVATE', name: "Kai's Workshop" }, 1000));
    w = run(s, w, U.KAI, 'world.invite', { toUserId: U.NOVA }, 1100).world;
    ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'INVITE', inviteId: worldViewFor(w, s, U.NOVA, T0 + 1200).invites[0].inviteId }, 1300));
    const blocked = run(s, w, U.KAI, 'blocks.add', { targetId: U.NOVA }, 2000);
    const report = (ms: number) => applySocialOperation(blocked.state, 'world.state', U.NOVA, { ids: [], body: here, query: {} }, at(ms), blocked.world);
    const late = report(2000 + 10 * 60_000); // the client slept ten minutes
    expect(late.ok).toBe(true);
    if (late.ok) expect((late.value.data as ReturnType<typeof worldViewFor>).context ?? null).toBeNull();
    // past the window: the ordinary refusal (the entry is dropped by the sweep, too)
    expect(report(2000 + 16 * 60_000).ok).toBe(false);
  });
});

describe("a privacy change is told only to those whose view of the player it changes (Second's harness at 30a3e864)", () => {
  const privacy = (s: SocialState, body: Record<string, unknown>, ms: number) => {
    const r = applySocialOperation(s, 'privacy.update_self', U.KAI, { ids: [], body, query: {} }, at(ms), emptyWorldState());
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const presence = (s: SocialState, body: Record<string, unknown>, ms: number) => {
    const r = applySocialOperation(s, 'presence.update_self', U.KAI, { ids: [], body, query: {} }, at(ms), emptyWorldState());
    if (!r.ok) throw new Error(r.error.message);
    return r.value.state;
  };

  it('while Kai appears offline, a change no friend can see is told to nobody else; visible, the same change reaches the friends it moves', () => {
    let s = presence(createSocialFixture(), { availability: 'AVAILABLE', connected: true }, 100);
    s = privacy(s, { activityVisibility: 'FRIENDS', messagePolicy: 'FRIENDS' }, 150).state;
    // visible: hiding the activity from friends changes every friend's card (their activity label goes) -- they are told
    const visible = privacy(s, { activityVisibility: 'NOBODY' }, 200);
    expect([...visible.audience].sort()).toEqual(expect.arrayContaining([U.KAI, ...friendIdsOf(s, U.KAI)].sort()));
    // hidden: the same kind of change moves nothing a friend sees (Kai reads OFFLINE to them either way) -- only Kai is told
    s = presence(visible.state, { availability: 'APPEAR_OFFLINE' }, 300);
    const hidden = privacy(s, { activityVisibility: 'FRIENDS' }, 400);
    expect([...hidden.audience]).toEqual([U.KAI]);
    // the control: a change a hidden player's friends CAN see (who may message him) is still told to them
    const message = privacy(hidden.state, { messagePolicy: 'NOBODY' }, 500);
    expect(message.audience.length).toBeGreaterThan(1);
  });
});

describe('10-07 B3: following the party leader never reveals a leader the member may not see', () => {
  const answerOf = (r: ReturnType<typeof applySocialOperation>) => (r.ok ? 'ACCEPTED' : `${r.error.code}: ${r.error.message}`);
  const follow = (s: SocialState, w: WorldState, ms: number) => applySocialOperation(s, 'world.join', U.LYRA, { ids: [], body: { target: 'PARTY' }, query: {} }, at(ms), w);

  it('a HIDDEN leader (appear offline, or presence to nobody) answers exactly as a leader in no world', () => {
    const base = createSocialFixture();
    const nowhere = answerOf(follow(base, emptyWorldState(), 0)); // Orion is in no world yet
    for (const hide of [{ availability: 'APPEAR_OFFLINE' }, { privacy: { presenceVisibility: 'NOBODY' } }] as const) {
      let s = base;
      let w = emptyWorldState();
      ({ state: s, world: w } = run(s, w, U.ORION, 'world.join', { target: 'PUBLIC', place: 'tower_lane', placeName: 'Tower Lane' }, 100));
      if ('availability' in hide) ({ state: s } = run(s, w, U.ORION, 'presence.update_self', { availability: hide.availability }, 150));
      else ({ state: s } = run(s, w, U.ORION, 'privacy.update_self', hide.privacy, 150));
      const r = follow(s, w, 200);
      expect(answerOf(r), JSON.stringify(hide)).toBe(nowhere);
      expect(r.ok ? contextOf((r.value as SocialCommandOutcome & { world: WorldState }).world, U.LYRA) : undefined, JSON.stringify(hide)).toBeUndefined();
    }
  });

  it('control: a leader the member may see is still followed, into a public world and into a private server under the default privacy', () => {
    let s = createSocialFixture();
    let w = emptyWorldState();
    ({ state: s, world: w } = run(s, w, U.ORION, 'world.join', { target: 'PUBLIC', place: 'tower_lane', placeName: 'Tower Lane' }, 100));
    const r = follow(s, w, 200);
    expect(r.ok).toBe(true);
    if (r.ok) expect(contextOf((r.value as SocialCommandOutcome & { world: WorldState }).world, U.LYRA)?.contextId).toBe(contextOf(w, U.ORION)?.contextId);
    // the leader's OWN private server (privateServerVisibility NOBODY by default): the party still follows
    let s2 = createSocialFixture();
    let w2 = emptyWorldState();
    ({ state: s2, world: w2 } = run(s2, w2, U.ORION, 'world.join', { target: 'PRIVATE', name: "Orion's Den" }, 100));
    const r2 = follow(s2, w2, 200);
    expect(r2.ok).toBe(true);
  });
});

describe('10-07 M3: a move between worlds is told only to friends who may see where the player is', () => {
  it('a friend whose view of the location is hidden is not told of an A -> B move; control: a friend who sees it is told', () => {
    for (const hidden of [true, false]) {
      let s = createSocialFixture();
      let w = emptyWorldState();
      if (hidden) ({ state: s } = run(s, w, U.NOVA, 'privacy.update_self', { locationVisibility: 'NOBODY' }, 50));
      ({ state: s, world: w } = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC' }, 100));
      const moved = run(s, w, U.NOVA, 'world.join', { target: 'PUBLIC', place: 'tower_lane', placeName: 'Tower Lane' }, 200);
      expect(contextOf(moved.world, U.NOVA)?.contextId, 'the move happened').not.toBe(contextOf(w, U.NOVA)?.contextId);
      expect(moved.audience.includes(U.KAI), `location hidden from Kai: ${hidden}`).toBe(!hidden);
    }
  });
});

/*
 * BF-2 (R16 B23): ANOTHER PLAYER'S PROFILE SHOWS THEIR RELAY DOG IN THE SKIN THEY WEAR. Real records here, not the fixture's
 * synthetic people (whose cards carry preset skins and a preview Julius): three players made on first contact, as the routes make
 * them, so every skin on a card below was recorded by a world report.
 */
describe('BF-2: the profile Relay Dog wears the skin the player wears, through the presence audience', () => {
  const A = 'usr_bf2_a';
  const B = 'usr_bf2_b';
  const C = 'usr_bf2_c';
  const tick = (skinId: string) => ({ x: 10, y: 20, z: 30, yaw: 0, speed: 0, motion: 'IDLE', skinId });
  const skinOn = (s: SocialState, viewer: string, subject: string) => resolveProfileFor(s, viewer, subject)?.profile.relayDog.skinId;
  /** A and B friends, C a stranger; A in Golden Arrival. Nothing has reported a skin yet. */
  function loop() {
    let s = emptySocialState();
    for (const [id, name] of [[A, 'Ada'], [B, 'Bo'], [C, 'Cy']]) s = ensureSocialUser(s, { userId: id, displayName: name, handle: `@${name.toLowerCase()}` }, at(0));
    s = run(s, emptyWorldState(), A, 'requests.send', { toUserId: B }, 10).state;
    const accepted = applySocialOperation(s, 'requests.accept', B, { ids: [s.requests[0].requestId], body: {}, query: {} }, at(20), emptyWorldState());
    if (!accepted.ok) throw new Error(accepted.error.message);
    const joined = run(accepted.value.state, emptyWorldState(), A, 'world.join', { target: 'PUBLIC' }, 100);
    return { s: joined.state, w: joined.world };
  }

  it('a canonical skin from world.state is recorded on the profile and served to a friend and a stranger who may see the player', () => {
    const { s, w } = loop();
    // the control before any report: every card reads the base form
    expect([skinOn(s, B, A), skinOn(s, C, A), skinOn(s, A, A)]).toEqual(['relay_og', 'relay_og', 'relay_og']);
    const r = run(s, w, A, 'world.state', tick('baal'), 300);
    expect(r.state.users[A].profile.relayDog).toEqual({ skinId: 'baal', primary: null, secondary: null, flame: null, appearanceTier: null });
    expect([skinOn(r.state, B, A), skinOn(r.state, C, A), skinOn(r.state, A, A)]).toEqual(['baal', 'baal', 'baal']);
    // the snapshot's card (the hub opens a friend's profile from it) and the in-world figure agree with the profile
    expect(buildSocialView(r.state, B, at(300), { developmentPreview: false }).profiles[A]?.profile.relayDog.skinId).toBe('baal');
    expect(r.world.avatars[A]?.skinId).toBe('baal');
    // told to A and to the friend whose card moved, so the friend's snapshot follows; a stranger is no candidate (as for presence)
    expect([...r.audience].sort()).toEqual([A, B].sort());
  });

  it('a tick that changes no skin is the SAME state and tells nobody; a report inside the minimum interval records nothing', () => {
    const { s, w } = loop();
    const first = run(s, w, A, 'world.state', tick('baal'), 300);
    const again = run(first.state, first.world, A, 'world.state', { ...tick('baal'), x: 99 }, 500);
    expect(again.state).toBe(first.state);
    expect(again.audience).toEqual([]);
    // inside WORLD_REPORT_MIN_INTERVAL_MS the world keeps the earlier figure, so the profile keeps the earlier skin
    const tooSoon = run(again.state, again.world, A, 'world.state', tick('jack_flame'), 550);
    expect(tooSoon.state).toBe(again.state);
    expect(tooSoon.world.avatars[A]?.skinId).toBe('baal');
    // the control: the same change one interval later is recorded
    expect(run(tooSoon.state, tooSoon.world, A, 'world.state', tick('jack_flame'), 700).state.users[A].profile.relayDog.skinId).toBe('jack_flame');
  });

  it('an id outside the canonical registry is never recorded (retired, removed or invented); a malformed one is refused outright', () => {
    const { s, w } = loop();
    const worn = run(s, w, A, 'world.state', tick('celestial_light'), 300);
    let t = 300;
    for (const id of ['bee', 'hagoromo', 'apollo', 'arden_infernal', 'skeleton_flame_v1', 'not_a_skin']) {
      t += 200;
      const r = run(worn.state, worn.world, A, 'world.state', tick(id), t);
      expect(r.state, id).toBe(worn.state); // the profile keeps the canonical skin it had
      expect(skinOn(r.state, B, A), id).toBe('celestial_light');
      expect(r.world.avatars[A]?.skinId, `${id}: the in-world report itself stands, as before BF-2`).toBe(id);
    }
    for (const bad of ['BAAL', 'baal!', '', 'x'.repeat(41)]) {
      const r = applySocialOperation(worn.state, 'world.state', A, { ids: [], body: tick(bad), query: {} }, at(2000), worn.world);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
    // the control: a registered id in the same place IS recorded
    expect(run(worn.state, worn.world, A, 'world.state', tick('shadow_flame'), 3000).state.users[A].profile.relayDog.skinId).toBe('shadow_flame');
  });

  it('privacy: outside the presence audience, or blocked either way, the card shows the base form -- exactly a private stranger', () => {
    const { s, w } = loop();
    let x = run(s, w, A, 'world.state', tick('jack_flame'), 300).state;
    x = run(x, emptyWorldState(), A, 'privacy.update_self', { presenceVisibility: 'FRIENDS' }, 400).state;
    // the stranger C, outside the audience, reads no card at all (OBS-1, C14-WL3-12, founder 10-14), let alone the skin
    expect([skinOn(x, B, A), skinOn(x, C, A), skinOn(x, A, A)]).toEqual(['jack_flame', undefined, 'jack_flame']);
    x = run(x, emptyWorldState(), A, 'privacy.update_self', { presenceVisibility: 'NOBODY' }, 500).state;
    expect([skinOn(x, B, A), skinOn(x, A, A)]).toEqual(['relay_og', 'jack_flame']);
    // blocked, either way: nothing (presence EVERYONE again, so only the block decides)
    x = run(x, emptyWorldState(), A, 'privacy.update_self', { presenceVisibility: 'EVERYONE' }, 600).state;
    expect(skinOn(x, C, A), 'control: the stranger sees it while nothing walls them').toBe('jack_flame');
    const aBlocksC = run(x, emptyWorldState(), A, 'blocks.add', { targetId: C }, 700).state;
    const cBlocksA = run(x, emptyWorldState(), C, 'blocks.add', { targetId: A }, 700).state;
    // the blocked side (C, blocked by A) reads no card (OBS-1: the stranger who shares nothing has none); the blocker (C, who blocked
    // A) keeps A's card to manage the block, in the base form
    expect([skinOn(aBlocksC, C, A), skinOn(cBlocksA, C, A)]).toEqual([undefined, 'relay_og']);
    expect(skinOn(aBlocksC, B, A), 'a block between A and C changes nothing for B').toBe('jack_flame');
    // the blocked side's answer is a private stranger's: since OBS-1 both are no card at all
    const privateStranger = run(x, emptyWorldState(), A, 'privacy.update_self', { presenceVisibility: 'NOBODY' }, 800).state;
    expect(resolveProfileFor(aBlocksC, C, A)).toBeNull();
    expect(resolveProfileFor(privateStranger, C, A)).toBeNull();
  });

  it('a skin change is told only to friends whose card moved: a friend outside the presence audience is not told', () => {
    for (const hidden of [true, false]) {
      const base = loop();
      const w = base.w;
      let s = base.s;
      if (hidden) s = run(s, w, A, 'privacy.update_self', { presenceVisibility: 'NOBODY' }, 50).state;
      const r = run(s, w, A, 'world.state', tick('baal'), 300);
      expect(r.state.users[A].profile.relayDog.skinId, 'recorded either way: it is the player\'s own card').toBe('baal');
      expect(r.audience.includes(B), `presence hidden from B: ${hidden}`).toBe(!hidden);
    }
  });

  it('FROZEN WHILE HIDDEN: appearing offline, a new skin changes nothing others can read and tells nobody; visible again, it is recorded', () => {
    const { s, w } = loop();
    const worn = run(s, w, A, 'world.state', tick('baal'), 300);
    const hidden = run(worn.state, worn.world, A, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 400);
    const r = run(hidden.state, worn.world, A, 'world.state', tick('skeleton_flame'), 600);
    expect(r.state).toBe(hidden.state);
    expect(r.audience).toEqual([]);
    expect(skinOn(r.state, B, A)).toBe('baal');
    // the control: the same report once visible again is recorded, and told
    const back = run(r.state, r.world, A, 'presence.update_self', { availability: 'AVAILABLE' }, 700);
    const shown = run(back.state, r.world, A, 'world.state', tick('skeleton_flame'), 900);
    expect(skinOn(shown.state, B, A)).toBe('skeleton_flame');
    expect(shown.audience).toContain(B);
  });

  it('FROZEN WHEN SIGNED OUT (R360-2: Appear Offline == sign-out): a tick still in flight after sign-out records nothing; signed back in, it is recorded', () => {
    const { s, w } = loop();
    const worn = run(s, w, A, 'world.state', tick('baal'), 300);
    // a sign-out does not leave the world (presence.update_self has no leaveWorld), so the client's next tick is still answered
    const out = run(worn.state, worn.world, A, 'presence.update_self', { connected: false }, 400);
    expect(out.state.users[A].presence.connected).toBe(false);
    const r = run(out.state, worn.world, A, 'world.state', tick('shadow_flame'), 600);
    expect(r.world.avatars[A]?.skinId, 'the tick itself was taken').toBe('shadow_flame');
    expect(r.state).toBe(out.state);
    expect(r.audience).toEqual([]);
    expect([skinOn(r.state, B, A), skinOn(r.state, C, A)]).toEqual(['baal', 'baal']);
    // the control: signed back in, the same report is recorded and told
    const back = run(r.state, r.world, A, 'presence.update_self', { connected: true }, 700);
    const shown = run(back.state, r.world, A, 'world.state', tick('shadow_flame'), 900);
    expect([skinOn(shown.state, B, A), skinOn(shown.state, C, A)]).toEqual(['shadow_flame', 'shadow_flame']);
    expect(shown.audience).toContain(B);
  });

  it('a stored id outside the registry (a record written behind the store) is never served, not even to its owner', () => {
    const { s } = loop();
    const dog = { ...s.users[A].profile.relayDog, skinId: 'apollo' } as unknown as SocialState['users'][string]['profile']['relayDog'];
    const tampered: SocialState = { ...s, users: { ...s.users, [A]: { ...s.users[A], profile: { ...s.users[A].profile, relayDog: dog } } } };
    expect([skinOn(tampered, B, A), skinOn(tampered, A, A)]).toEqual(['relay_og', 'relay_og']);
  });

  it("RQ-1: a real player's primary Compound AI Agent is null (no agent configured) through the whole loop -- never a default Julius", () => {
    const { s, w } = loop();
    const after = run(s, w, A, 'world.state', tick('baal'), 300).state;
    for (const viewer of [A, B, C]) expect(resolveProfileFor(after, viewer, A)?.profile.primaryAgent, viewer).toBeNull();
    expect(buildSocialView(after, B, at(300), { developmentPreview: false }).profiles[A]?.profile.primaryAgent).toBeNull();
    // the control: the resolver does carry an agent when a record has one (the preview fixture's synthetic Julius)
    expect(resolveProfileFor(createSocialFixture(), U.KAI, U.NOVA)?.profile.primaryAgent?.kind).toBe('JULIUS');
  });
});
