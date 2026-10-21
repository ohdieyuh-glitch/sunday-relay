import { describe, expect, it } from 'vitest';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import type { SocialOperationId } from './social-contracts';
import type { SocialState } from './social-state';
import { emptySocialState } from './social-state';
import { ensureSocialUser } from './social-store';
import {
  WORLD_TRAIL_MAX_AGE_MS,
  WORLD_TRAIL_MAX_ENTRIES,
  appendToTrail,
  clearTrailsWhereAudienceMoved,
  emptyWorldState,
  worldAudienceKey,
  worldViewFor,
  type TrailSample,
  type WorldState,
} from './world-presence';

/*
 * THE TRANSPORT RING (r16reh18 PROTOTYPE, before the reviewer's T1 ruling; not evidence -- the T1 design doc governs).
 *
 * Every test is named with an id (RING-...) that scripts/world-trail-mutations.mjs cites: each privacy invariant has a mutant that
 * removes its clear or its filter, and that mutant must fail the test named here.
 *
 * The cast: SAM is the subject whose figure and ring are watched, VAL the viewer, WES a second viewer, XAN somebody outside.
 */

const T0 = Date.parse('2026-10-21T12:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
const SAM = 'usr_sam';
const VAL = 'usr_val';
const WES = 'usr_wes';
const XAN = 'usr_xan';

interface World {
  s: SocialState;
  w: WorldState;
}

function apply(g: World, actor: string, op: SocialOperationId, body: Record<string, unknown> = {}, ms = 0, ids: string[] = []): SocialCommandOutcome {
  const r = applySocialOperation(g.s, op, actor, { ids, body, query: {} }, at(ms), g.w);
  if (!r.ok) throw new Error(`${op} by ${actor} refused: ${r.error.message}`);
  g.s = r.value.state;
  if (r.value.world !== undefined) g.w = r.value.world;
  return r.value;
}

/** Four players with records, signed in, everyone's presence open to everyone (the default), nobody in a world. */
function cast(): World {
  let s = emptySocialState();
  for (const [userId, name] of [[SAM, 'Sam'], [VAL, 'Val'], [WES, 'Wes'], [XAN, 'Xan']]) s = ensureSocialUser(s, { userId, displayName: name, handle: `@${name.toLowerCase()}` }, at(-1000));
  const g: World = { s, w: emptyWorldState() };
  for (const id of [SAM, VAL, WES, XAN]) apply(g, id, 'presence.update_self', { connected: true }, -900);
  return g;
}

/** SAM, VAL and WES in the same public world. */
function together(): World {
  const g = cast();
  for (const id of [SAM, VAL, WES]) apply(g, id, 'world.join', { target: 'PUBLIC' }, -500);
  return g;
}

const pos = (x: number) => ({ x, y: 0, z: 10, yaw: 90, speed: 600, motion: 'RUN', skinId: 'shadow_flame' });
const report = (g: World, who: string, ms: number) => apply(g, who, 'world.state', pos(ms), ms);
const reports = (g: World, who: string, times: number[]) => times.forEach((ms) => report(g, who, ms));
/** The ring of a player as report times relative to T0. */
const ring = (g: World, who: string) => (g.w.trails?.[who] ?? []).map((e) => e.reportedAtMs - T0);
/** What `viewer` is served at `ms`, cursor `since` (relative to T0; absent = no cursor). */
const view = (g: World, viewer: string, ms: number, since?: number) => worldViewFor(g.w, g.s, viewer, T0 + ms, since === undefined ? undefined : T0 + since);
const figure = (g: World, viewer: string, subject: string, ms: number, since?: number) => view(g, viewer, ms, since).avatars.find((a) => a.userId === subject);
/** The trail served to `viewer` for `subject`, as report times relative to T0 (asOf - age); [] when none; null when no figure. */
function trailTimes(g: World, viewer: string, subject: string, ms: number, since?: number): number[] | null {
  const f = figure(g, viewer, subject, ms, since);
  if (f === undefined) return null;
  return (f.trail ?? []).map((p) => ms - p.ageMs);
}
const tenths = (from: number, to: number) => Array.from({ length: (to - from) / 100 + 1 }, (_, i) => from + i * 100);

/* ------------------------------------------------------------------------------------------------------------ storage */

describe('the ring: what is stored, and for how long', () => {
  it('RING-S01 accepted reports enter the ring oldest first; a resent report inside the 100 ms floor never enters it', () => {
    const g = together();
    reports(g, SAM, [100, 150, 200, 200, 260, 300]);
    expect(ring(g, SAM)).toEqual([100, 200, 300]);
  });

  it(`RING-S02 the ring keeps at most ${WORLD_TRAIL_MAX_ENTRIES} reports per player`, () => {
    const g = together();
    reports(g, SAM, tenths(100, 2000));
    expect(ring(g, SAM)).toEqual(tenths(1300, 2000));
  });

  it(`RING-S03 the ring drops reports older than ${WORLD_TRAIL_MAX_AGE_MS} ms when the next one is stored`, () => {
    const g = together();
    reports(g, SAM, [100, 200, 300]);
    report(g, SAM, 2250);
    expect(ring(g, SAM)).toEqual([300, 2250]);
    report(g, SAM, 5000);
    expect(ring(g, SAM)).toEqual([5000]);
  });

  it('RING-S04 a duplicate or out-of-order sample never enters the ring, whatever the caller', () => {
    const s = (ms: number): TrailSample => ({ contextId: 'pub_x_1', x: ms, y: 0, z: 0, yaw: 0, speed: 0, motion: 'IDLE', reportedAtMs: T0 + ms });
    let r = appendToTrail(undefined, s(100));
    r = appendToTrail(r, s(300));
    expect(appendToTrail(r, s(300))).toBe(r);   // a duplicate
    expect(appendToTrail(r, s(200))).toBe(r);   // out of order
    expect(appendToTrail(r, { ...s(300), x: 999 })).toBe(r);   // the same time, other content
    expect(appendToTrail(r, s(400)).map((e) => e.reportedAtMs - T0)).toEqual([100, 300, 400]);
  });

  it('RING-S05 a ring entry holds the stored position fields, its context and its time: never an id, a skin or a name', () => {
    const g = together();
    report(g, SAM, 100);
    expect(Object.keys(g.w.trails?.[SAM]?.[0] ?? {}).sort()).toEqual(['contextId', 'motion', 'reportedAtMs', 'speed', 'x', 'y', 'yaw', 'z']);
  });

  it('RING-S06 memory only: a ring exists only beside a live figure, and a restart (an empty world) has none', () => {
    const g = together();
    reports(g, SAM, [100, 200]);
    reports(g, VAL, [110, 210]);
    apply(g, VAL, 'world.leave', {}, 300);
    expect(Object.keys(g.w.trails ?? {}).every((id) => g.w.avatars[id] !== undefined)).toBe(true);
    expect(emptyWorldState().trails).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------------------------------------------- serve */

describe('serving: a cursor, oldest first, nothing twice, nothing older than the ring', () => {
  it('RING-V01 without a cursor the view is exactly today\'s: no asOfMs, no trail, the same bytes', () => {
    const g = together();
    reports(g, SAM, tenths(100, 800));
    const now = view(g, VAL, 850);
    expect(JSON.stringify(now)).toBe(JSON.stringify(worldViewFor({ ...g.w, trails: undefined }, g.s, VAL, T0 + 850)));
    expect('asOfMs' in now).toBe(false);
    expect(now.avatars.some((a) => 'trail' in a)).toBe(false);
    // through the operation too: a world.state without sinceMs answers no asOfMs
    const answer = apply(g, VAL, 'world.state', pos(1), 860).data as Record<string, unknown>;
    expect('asOfMs' in answer).toBe(false);
  });

  it('RING-V02 with a cursor: the reports strictly between the cursor and the newest, oldest first, each with its age; asOfMs is the answer time', () => {
    const g = together();
    reports(g, SAM, tenths(100, 800));
    const v = view(g, VAL, 850, 350);
    expect(v.asOfMs).toBe(T0 + 850);
    const sam = v.avatars.find((a) => a.userId === SAM);
    expect(sam?.reportedAtMs).toBe(T0 + 800);
    expect(sam?.trail?.map((p) => p.ageMs)).toEqual([450, 350, 250, 150]);
    expect(trailTimes(g, VAL, SAM, 850, 350)).toEqual([400, 500, 600, 700]);
  });

  it('RING-V03 a report at exactly the echoed cursor was already sent: it is not sent again', () => {
    const g = together();
    report(g, SAM, 1000);
    const first = view(g, VAL, 1000, 0);
    expect(first.avatars.find((a) => a.userId === SAM)?.reportedAtMs).toBe(T0 + 1000);
    reports(g, SAM, [1100, 1200]);
    expect(trailTimes(g, VAL, SAM, 1250, (first.asOfMs as number) - T0)).toEqual([1100]);
  });

  it('RING-V04 the newest report, carried by the figure itself, is never repeated in its trail', () => {
    const g = together();
    reports(g, SAM, [100, 200]);
    expect(trailTimes(g, VAL, SAM, 250, 0)).toEqual([100]);
    expect(figure(g, VAL, SAM, 250, 0)?.reportedAtMs).toBe(T0 + 200);
  });

  it(`RING-V05 a cursor of 0, a negative, a non-integer or a too-old one reaches no further back than ${WORLD_TRAIL_MAX_AGE_MS} ms`, () => {
    const g = together();
    reports(g, SAM, tenths(0, 700));
    expect(ring(g, SAM)).toEqual(tenths(0, 700));
    const expected = [400, 500, 600];   // after 2350 - 2000 = 350, before the newest (700)
    expect(trailTimes(g, VAL, SAM, 2350, -T0)).toEqual(expected);   // sinceMs 0
    expect(trailTimes(g, VAL, SAM, 2350, -T0 - 5e12)).toEqual(expected);   // negative
    expect(trailTimes(g, VAL, SAM, 2350, -1_000_000)).toEqual(expected);   // too old
    expect(trailTimes(g, VAL, SAM, 2350, 350.5)).toEqual(expected);   // non-integer
    expect(trailTimes(g, VAL, SAM, 2350, 450.5)).toEqual([500, 600]);
  });

  it('RING-V06 a future cursor reaches nothing, and is no error', () => {
    const g = together();
    reports(g, SAM, tenths(100, 500));
    const v = view(g, VAL, 550, 1e9);
    expect(v.asOfMs).toBe(T0 + 550);
    expect(trailTimes(g, VAL, SAM, 550, 1e9)).toEqual([]);
    expect(JSON.stringify(v.avatars)).toBe(JSON.stringify(view(g, VAL, 550).avatars));
  });

  it('RING-V07 a trail entry carries only the figure\'s position fields and its age', () => {
    const g = together();
    reports(g, SAM, [100, 200]);
    const p = figure(g, VAL, SAM, 250, 0)?.trail?.[0];
    expect(Object.keys(p ?? {}).sort()).toEqual(['ageMs', 'motion', 'speed', 'x', 'y', 'yaw', 'z']);
    expect(p).toEqual({ x: 100, y: 0, z: 10, yaw: 90, speed: 600, motion: 'RUN', ageMs: 150 });
  });

  it('RING-V08 two viewers, two cursors, one ring: each is served by its own echoed cursor, and serving changes nothing (no per-viewer state)', () => {
    const g = together();
    reports(g, SAM, tenths(100, 600));
    const before = JSON.stringify(g.w);
    expect(trailTimes(g, VAL, SAM, 650, 250)).toEqual([300, 400, 500]);
    expect(trailTimes(g, WES, SAM, 650, 450)).toEqual([500]);
    expect(JSON.stringify(g.w)).toBe(before);
    expect(Object.keys(g.w).sort()).toEqual(['avatars', 'contexts', 'invites', 'nextSerial', 'trails']);
    expect(Object.keys(g.w.trails ?? {}).sort()).toEqual([SAM]);
  });

  it('RING-V09 history unavailable -- after a restart, a cleared ring, a cursor older than the ring -- is today\'s single report with asOfMs, never an error', () => {
    const g = together();
    reports(g, SAM, tenths(100, 1500));
    // a cursor older than the ring: the ring's own reports (no more), and the newest as today
    expect(trailTimes(g, VAL, SAM, 1550, 100)).toEqual(tenths(800, 1400));
    // a restart: the world is empty, the players rejoin, one report each
    const r: World = { s: g.s, w: emptyWorldState() };
    for (const id of [SAM, VAL]) apply(r, id, 'world.join', { target: 'PUBLIC' }, 2000);
    report(r, SAM, 2100);
    const answer = apply(r, VAL, 'world.state', { ...pos(5), sinceMs: T0 + 1550 }, 2150).data as ReturnType<typeof worldViewFor>;
    expect(answer.asOfMs).toBe(T0 + 2150);
    expect(answer.avatars.map((a) => [a.userId, a.reportedAtMs - T0, a.trail])).toEqual([[SAM, 2100, undefined]]);
    // a cleared ring (Sam hid and came back): the newest alone
    apply(g, SAM, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 1560);
    apply(g, SAM, 'presence.update_self', { availability: 'AVAILABLE' }, 1570);
    report(g, SAM, 1600);
    expect(trailTimes(g, VAL, SAM, 1650, 100)).toEqual([]);
    expect(figure(g, VAL, SAM, 1650, 100)?.reportedAtMs).toBe(T0 + 1600);
    // saving a setting unchanged changes nobody's audience, so it clears nothing
    reports(g, SAM, [1700, 1800]);
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'EVERYONE' }, 1850);
    expect(ring(g, SAM)).toEqual([1600, 1700, 1800]);
  });

  it('RING-V10 an entry stored in another context is never served, even if a ring held one', () => {
    const g = together();
    reports(g, SAM, [100, 200, 300]);
    const ctx = g.w.avatars[SAM].contextId;
    const forged = (g.w.trails?.[SAM] ?? []).map((e) => (e.reportedAtMs === T0 + 100 ? { ...e, contextId: 'priv_usr_xan' } : e));
    g.w = { ...g.w, trails: { ...g.w.trails, [SAM]: forged } };
    expect(ctx).toBe('pub_golden_arrival_1');
    expect(trailTimes(g, VAL, SAM, 350, 0)).toEqual([200]);
  });

  it('RING-V11 a sinceMs that is not a finite number is ignored: the answer is today\'s, byte for byte', () => {
    for (const bad of ['0', true, null, {}, [], 'NaN']) {
      const a = together();
      const b = together();
      reports(a, SAM, [100, 200, 300]);
      reports(b, SAM, [100, 200, 300]);
      const withBad = apply(a, VAL, 'world.state', { ...pos(1), sinceMs: bad }, 350).data;
      const without = apply(b, VAL, 'world.state', pos(1), 350).data;
      expect(JSON.stringify(withBad)).toBe(JSON.stringify(without));
    }
  });
});

/* ------------------------------------------------------------------------------------------------------- today's filter */

describe("the trail rides on the figure: only a viewer today's filter shows the subject to is served anything", () => {
  it('RING-F01 a subject appearing offline has no figure and no trail for anyone, though their reports are still stored', () => {
    const g = together();
    apply(g, SAM, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 50);
    reports(g, SAM, tenths(100, 500));
    expect(ring(g, SAM)).toEqual(tenths(100, 500));
    expect(figure(g, VAL, SAM, 550, 0)).toBeUndefined();
    expect(figure(g, WES, SAM, 550, 0)).toBeUndefined();
  });

  it('RING-F02 a presence audience of FRIENDS: the friend is served the trail, the stranger nothing', () => {
    const g = together();
    apply(g, SAM, 'requests.send', { toUserId: WES }, 10);
    apply(g, WES, 'requests.accept', {}, 20, [g.s.requests[0].requestId]);
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'FRIENDS' }, 30);
    reports(g, SAM, tenths(100, 400));
    expect(trailTimes(g, WES, SAM, 450, 0)).toEqual([100, 200, 300]);
    expect(trailTimes(g, VAL, SAM, 450, 0)).toBeNull();
  });

  it('RING-F03 a block either way: neither side is served the other\'s figure or trail, though their reports are still stored', () => {
    const g = together();
    apply(g, VAL, 'blocks.add', { targetId: SAM }, 50);
    reports(g, SAM, tenths(100, 400));
    reports(g, VAL, tenths(110, 410));
    expect(ring(g, SAM).length).toBe(4);
    expect(figure(g, VAL, SAM, 450, 0)).toBeUndefined();
    expect(figure(g, SAM, VAL, 450, 0)).toBeUndefined();
    expect(trailTimes(g, WES, SAM, 450, 0)).toEqual([100, 200, 300]);
  });

  it('RING-F04 a viewer in another context is served nothing of the subject', () => {
    const g = together();
    apply(g, VAL, 'world.join', { target: 'PRIVATE', name: 'Elsewhere' }, 50);
    reports(g, SAM, tenths(100, 400));
    expect(figure(g, VAL, SAM, 450, 0)).toBeUndefined();
    expect(view(g, VAL, 450, 0).avatars).toEqual([]);
  });
});

/* -------------------------------------------------------------------------------------------- the leading invariant */

describe('the leading invariant: every audience-affecting change involving the subject clears their ring', () => {
  it('RING-C01 appearing offline clears the ring, and coming back clears it again: nothing stored while hidden is replayed', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    apply(g, SAM, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 350);
    expect(ring(g, SAM)).toEqual([]);
    reports(g, SAM, tenths(400, 600));
    expect(ring(g, SAM)).toEqual(tenths(400, 600));
    apply(g, SAM, 'presence.update_self', { availability: 'AVAILABLE' }, 650);
    expect(ring(g, SAM)).toEqual([]);
    report(g, SAM, 700);
    expect(trailTimes(g, VAL, SAM, 750, 0)).toEqual([]);
    expect(figure(g, VAL, SAM, 750, 0)?.reportedAtMs).toBe(T0 + 700);
  });

  it('RING-C02 a presence visibility change clears the ring, either way: nothing stored under FRIENDS reaches a stranger after it opens', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'FRIENDS' }, 350);
    expect(ring(g, SAM)).toEqual([]);
    reports(g, SAM, tenths(400, 600));
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'EVERYONE' }, 650);
    expect(ring(g, SAM)).toEqual([]);
    report(g, SAM, 700);
    expect(trailTimes(g, VAL, SAM, 750, 0)).toEqual([]);
  });

  it('RING-C03 a block added or removed clears the ring of BOTH sides, whoever acted and wherever the other is', () => {
    // the viewer blocks the subject
    const g = together();
    reports(g, SAM, tenths(100, 300));
    reports(g, VAL, tenths(110, 310));
    apply(g, VAL, 'blocks.add', { targetId: SAM }, 350);
    expect(ring(g, SAM)).toEqual([]);
    expect(ring(g, VAL)).toEqual([]);
    // reports stored during the block are not replayed when it ends
    reports(g, SAM, tenths(400, 600));
    apply(g, VAL, 'blocks.remove', {}, 650, [SAM]);
    expect(ring(g, SAM)).toEqual([]);
    report(g, SAM, 700);
    expect(trailTimes(g, VAL, SAM, 750, 0)).toEqual([]);
    // the subject blocks somebody who is in no world at all: the subject's ring is still cleared
    const h = together();
    reports(h, SAM, tenths(100, 300));
    apply(h, SAM, 'blocks.add', { targetId: XAN }, 350);
    expect(ring(h, SAM)).toEqual([]);
    reports(h, SAM, tenths(400, 500));
    apply(h, SAM, 'blocks.remove', {}, 550, [XAN]);
    expect(ring(h, SAM)).toEqual([]);
  });

  it('RING-C04 a friendship made or ended clears both rings, the viewer\'s own accept included', () => {
    const g = together();
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'FRIENDS' }, 10);
    apply(g, SAM, 'requests.send', { toUserId: VAL }, 20);
    reports(g, SAM, tenths(100, 300));
    expect(ring(g, SAM)).toEqual(tenths(100, 300));
    apply(g, VAL, 'requests.accept', {}, 350, [g.s.requests[0].requestId]);   // the viewer accepts
    expect(ring(g, SAM)).toEqual([]);
    report(g, SAM, 400);
    expect(trailTimes(g, VAL, SAM, 450, 0)).toEqual([]);
    reports(g, SAM, tenths(500, 600));
    apply(g, VAL, 'friends.remove', {}, 650, [SAM]);   // the viewer ends it
    expect(ring(g, SAM)).toEqual([]);
  });

  it('RING-C05 a party change clears the members\' rings (a PARTY presence audience): the viewer joining the party sees nothing from before', () => {
    const g = together();
    apply(g, SAM, 'requests.send', { toUserId: VAL }, 10);
    apply(g, VAL, 'requests.accept', {}, 20, [g.s.requests[0].requestId]);
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'PARTY' }, 30);
    const created = apply(g, SAM, 'parties.create', { name: 'Run' }, 40).data as { partyId: string };
    const invited = apply(g, SAM, 'parties.invite', { toUserId: VAL }, 50, [created.partyId]).data as { inviteId: string };
    reports(g, SAM, tenths(100, 300));
    expect(figure(g, VAL, SAM, 350, 0)).toBeUndefined();
    apply(g, VAL, 'party_invites.accept', {}, 350, [invited.inviteId]);   // the viewer joins
    expect(ring(g, SAM)).toEqual([]);
    report(g, SAM, 400);
    expect(trailTimes(g, VAL, SAM, 450, 0)).toEqual([]);
    reports(g, SAM, tenths(500, 600));
    apply(g, VAL, 'parties.leave', {}, 650, [created.partyId]);   // the viewer leaves
    expect(ring(g, SAM)).toEqual([]);
  });

  it('RING-C06 a sign-out clears the ring at once (its presence step), and its leave drops it with the figure', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    apply(g, SAM, 'presence.update_self', { connected: false }, 350);
    expect(ring(g, SAM)).toEqual([]);
    apply(g, SAM, 'world.leave', {}, 360);
    expect(g.w.trails?.[SAM]).toBeUndefined();
  });

  it('RING-C07 a record that disappears clears the ring (no operation deletes one today), and a missing record is never served', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    const { [SAM]: _gone, ...users } = g.s.users;
    const after: SocialState = { ...g.s, users };
    const cleared = clearTrailsWhereAudienceMoved(g.w, g.s, after);
    expect(cleared.trails?.[SAM]).toBeUndefined();
    expect(worldViewFor(g.w, after, VAL, T0 + 350, T0).avatars.find((a) => a.userId === SAM)).toBeUndefined();
  });

  it('RING-C08 the party reconciliation that runs before every operation (a carried-in block inside a party) clears the rings it moves', () => {
    const g = together();
    for (const [a, b] of [[SAM, VAL], [SAM, WES]]) {
      apply(g, a, 'requests.send', { toUserId: b }, 1);
      apply(g, b, 'requests.accept', {}, 2, [g.s.requests[g.s.requests.length - 1].requestId]);
    }
    const created = apply(g, SAM, 'parties.create', { name: 'Run' }, 3).data as { partyId: string };
    for (const id of [VAL, WES]) {
      const inv = apply(g, SAM, 'parties.invite', { toUserId: id }, 4, [created.partyId]).data as { inviteId: string };
      apply(g, id, 'party_invites.accept', {}, 5, [inv.inviteId]);
    }
    apply(g, VAL, 'privacy.update_self', { presenceVisibility: 'PARTY' }, 6);
    reports(g, VAL, tenths(100, 300));
    // carried-in data: Wes has blocked Val while both are still in Sam's party (a restore, a race)
    g.s = { ...g.s, blocks: [...g.s.blocks, { blockerId: WES, blockedId: VAL, sinceIso: at(350) }] };
    // any operation at all, even a read by somebody else, reconciles first: Wes leaves the party, and Val's PARTY audience moved
    apply(g, XAN, 'snapshot.read', {}, 360);
    expect(g.s.parties[created.partyId].members.map((m) => m.userId)).not.toContain(WES);
    expect(ring(g, VAL)).toEqual([]);
  });

  it('RING-C09 leaving drops the ring with the figure; so do a move to another context, the stale sweep and a block\'s removal from a private server', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    apply(g, SAM, 'world.leave', {}, 350);
    expect(g.w.trails?.[SAM]).toBeUndefined();
    // a move: public -> a private server
    apply(g, SAM, 'world.join', { target: 'PUBLIC' }, 400);
    reports(g, SAM, tenths(500, 700));
    apply(g, SAM, 'world.join', { target: 'PRIVATE', name: 'Den' }, 750);
    expect(g.w.trails?.[SAM]).toBeUndefined();
    // the stale sweep, which runs at any join: Sam silent past the stale window
    reports(g, SAM, tenths(800, 900));
    apply(g, XAN, 'world.join', { target: 'PUBLIC' }, 900 + 15_001);
    expect(g.w.trails?.[SAM]).toBeUndefined();
    // a block that removes a member from the owner's private server
    const h = together();
    apply(h, WES, 'world.join', { target: 'PRIVATE', name: 'Den' }, 10);
    apply(h, SAM, 'requests.send', { toUserId: WES }, 20);
    apply(h, WES, 'requests.accept', {}, 30, [h.s.requests[0].requestId]);
    apply(h, WES, 'privacy.update_self', { privateServerVisibility: 'FRIENDS' }, 40);
    apply(h, SAM, 'world.join', { target: 'FRIEND', userId: WES }, 50);
    reports(h, SAM, tenths(100, 300));
    expect(ring(h, SAM)).toEqual(tenths(100, 300));
    apply(h, WES, 'blocks.add', { targetId: SAM }, 350);
    expect(h.w.trails?.[SAM]).toBeUndefined();
  });

  it('RING-C10 a viewer arriving is never served what the members did before they arrived, whatever cursor it sends', () => {
    const g = cast();
    for (const id of [SAM, WES]) apply(g, id, 'world.join', { target: 'PUBLIC' }, -500);
    reports(g, SAM, tenths(100, 500));
    apply(g, VAL, 'world.join', { target: 'PUBLIC' }, 550);
    expect(ring(g, SAM)).toEqual([]);
    reports(g, SAM, [600, 700]);
    expect(trailTimes(g, VAL, SAM, 750, 0)).toEqual([600]);
  });

  it('RING-C11 viewer-side: the viewer hiding clears only its own ring (it still sees the subject); the viewer leaving and coming back sees nothing from its absence', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    reports(g, VAL, tenths(110, 310));
    apply(g, VAL, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 350);
    expect(ring(g, VAL)).toEqual([]);
    expect(ring(g, SAM)).toEqual(tenths(100, 300));
    report(g, SAM, 400);
    expect(trailTimes(g, VAL, SAM, 450, 0)).toEqual([100, 200, 300]);
    // away and back
    apply(g, VAL, 'world.join', { target: 'PRIVATE', name: 'Away' }, 500);
    reports(g, SAM, tenths(600, 800));
    apply(g, VAL, 'world.join', { target: 'PUBLIC' }, 850);
    expect(ring(g, SAM)).toEqual([]);
    report(g, SAM, 900);
    expect(trailTimes(g, VAL, SAM, 950, 0)).toEqual([]);
  });

  it('RING-C12 what changes nobody\'s audience leaves the rings alone: a message, a mute, an activity, a skin, a report, a read', () => {
    const g = together();
    apply(g, SAM, 'requests.send', { toUserId: VAL }, 1);
    apply(g, VAL, 'requests.accept', {}, 2, [g.s.requests[0].requestId]);
    reports(g, SAM, tenths(100, 300));
    const conv = apply(g, VAL, 'conversations.open', { otherUserId: SAM }, 310).data as { conversationId: string };
    const quiet = [
      apply(g, VAL, 'messages.send', { body: 'hi' }, 320, [conv.conversationId]),
      apply(g, SAM, 'mutes.set', { targetId: VAL }, 330),
      apply(g, SAM, 'presence.update_self', { signals: { exploring: true }, activityDetail: 'Running' }, 340),
      apply(g, VAL, 'snapshot.read', {}, 350),
      apply(g, WES, 'world.state', { ...pos(1), skinId: 'celestial_light' }, 360),
    ];
    expect(quiet.every((o) => o.world === undefined || o.world.trails?.[SAM] === g.w.trails?.[SAM])).toBe(true);
    expect(ring(g, SAM)).toEqual(tenths(100, 300));
  });
});

describe('the leading invariant holds on carried-in data', () => {
  it('RING-C13 a player listed in two parties (carried-in data): the viewer joining the SECOND party clears the ring', () => {
    const g = together();
    apply(g, WES, 'requests.send', { toUserId: VAL }, 1);
    apply(g, VAL, 'requests.accept', {}, 2, [g.s.requests[0].requestId]);
    const p1 = (apply(g, SAM, 'parties.create', { name: 'One' }, 3).data as { partyId: string }).partyId;
    const p2 = (apply(g, WES, 'parties.create', { name: 'Two' }, 4).data as { partyId: string }).partyId;
    // carried-in: Sam is listed in Wes's party too (a restore, a race), while still in his own
    const two = g.s.parties[p2];
    g.s = { ...g.s, parties: { ...g.s.parties, [p2]: { ...two, members: [...two.members, { ...two.members[0], userId: SAM }] } } };
    expect(Object.keys(g.s.parties)[0]).toBe(p1);
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'PARTY' }, 5);
    reports(g, SAM, tenths(100, 300));
    expect(figure(g, VAL, SAM, 350, 0)).toBeUndefined();
    const inv = apply(g, WES, 'parties.invite', { toUserId: VAL }, 360, [p2]).data as { inviteId: string };
    apply(g, VAL, 'party_invites.accept', {}, 370, [inv.inviteId]);
    expect(figure(g, VAL, SAM, 380, 0)?.userId).toBe(SAM);
    expect(ring(g, SAM)).toEqual([]);
    report(g, SAM, 400);
    expect(trailTimes(g, VAL, SAM, 450, 0)).toEqual([]);
  });
});

/* --------------------------------------------------------------------------------------- the key covers the filter */

describe('the audience key covers every input of the world filter', () => {
  it('RING-K01 whenever the filter would show the subject to the viewer differently, the subject\'s key differs (every combination)', () => {
    const states: { name: string; s: SocialState; w: WorldState }[] = [];
    for (const availability of ['AVAILABLE', 'APPEAR_OFFLINE'] as const) {
      for (const presenceVisibility of ['EVERYONE', 'FRIENDS', 'PARTY', 'NOBODY'] as const) {
        for (const friends of [false, true]) {
          for (const party of [false, true]) {
            for (const block of ['none', 'sam>val', 'val>sam'] as const) {
              const g = together();
              if (friends || party) {
                apply(g, SAM, 'requests.send', { toUserId: VAL }, 1);
                apply(g, VAL, 'requests.accept', {}, 2, [g.s.requests[0].requestId]);
              }
              if (party) {
                const created = apply(g, SAM, 'parties.create', { name: 'P' }, 3).data as { partyId: string };
                const inv = apply(g, SAM, 'parties.invite', { toUserId: VAL }, 4, [created.partyId]).data as { inviteId: string };
                apply(g, VAL, 'party_invites.accept', {}, 5, [inv.inviteId]);
              }
              // a party between non-friends: the friendship is ended after the party formed
              if (party && !friends) apply(g, VAL, 'friends.remove', {}, 6, [SAM]);
              apply(g, SAM, 'privacy.update_self', { presenceVisibility }, 7);
              apply(g, SAM, 'presence.update_self', { availability }, 8);
              if (block !== 'none') g.s = { ...g.s, blocks: [...g.s.blocks, block === 'sam>val' ? { blockerId: SAM, blockedId: VAL, sinceIso: at(9) } : { blockerId: VAL, blockedId: SAM, sinceIso: at(9) }] };
              report(g, SAM, 100);
              states.push({ name: `${availability}/${presenceVisibility}/f${friends}/p${party}/${block}`, s: g.s, w: g.w });
            }
          }
        }
      }
    }
    expect(states.length).toBe(96);
    const shows = (x: { s: SocialState; w: WorldState }) => worldViewFor(x.w, x.s, VAL, T0 + 150).avatars.some((a) => a.userId === SAM);
    expect(states.filter(shows).length).toBeGreaterThan(0);
    expect(states.filter((x) => !shows(x)).length).toBeGreaterThan(0);
    const misses: string[] = [];
    for (const a of states) {
      for (const b of states) {
        if (shows(a) !== shows(b) && worldAudienceKey(a.s, SAM) === worldAudienceKey(b.s, SAM)) misses.push(`${a.name} vs ${b.name}`);
      }
    }
    expect(misses).toEqual([]);
  });
});
