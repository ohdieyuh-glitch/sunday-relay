import { describe, expect, it } from 'vitest';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import type { SocialOperationId } from './social-contracts';
import type { SocialState } from './social-state';
import { emptySocialState } from './social-state';
import { openDirectConversation, markRead, sendMessage } from './social-conversations';
import { blockUser, fileReport, sendFriendRequest, setMute } from './social-friends';
import { joinParty as joinPartyRule } from './social-parties';
import { ensureSocialUser } from './social-store';
import { updateOwnPresence } from './social-commands';
import {
  WORLD_TRAIL_MAX_AGE_MS,
  WORLD_TRAIL_MAX_ENTRIES,
  appendToTrail,
  contextOf,
  emptyWorldState,
  joinWorld,
  noteAudienceChange,
  reportAvatar,
  positionVisibleTo,
  touchedPlayers,
  worldViewFor,
  type TrailSample,
  type WorldState,
  type WorldView,
} from './world-presence';

/*
 * THE TRANSPORT RING, to TRANSPORT_RING_DESIGN_T1_v1.md (0a710c29). Still a PROTOTYPE before the reviewer's T1 ruling; not evidence.
 *
 * Every test is named with its id(s): the prototype's RING-... ids, and v1's R.. ids where the test is the design's. Each privacy
 * invariant has a mutant in scripts/world-trail-mutations.mjs that removes its gate or its filter and must fail the test named there.
 *
 * The cast: SAM is the subject whose figure and ring are watched, VAL the viewer, WES a second viewer, XAN somebody else.
 * Times are ms after T0; a cursor (`since`) is relative to T0 too, and ZERO is the absolute cursor 0.
 */

const T0 = Date.parse('2026-10-21T12:00:00.000Z');
const ZERO = -T0;
const at = (ms: number) => new Date(T0 + ms).toISOString();
const SAM = 'usr_sam';
const VAL = 'usr_val';
const WES = 'usr_wes';
const XAN = 'usr_xan';

interface World {
  s: SocialState;
  w: WorldState;
}

function attempt(g: World, actor: string, op: SocialOperationId, body: Record<string, unknown> = {}, ms = 0, ids: string[] = [], query: Record<string, string> = {}) {
  const r = applySocialOperation(g.s, op, actor, { ids, body, query }, at(ms), g.w);
  if (r.ok) {
    g.s = r.value.state;
    if (r.value.world !== undefined) g.w = r.value.world;
  }
  return r;
}

function apply(g: World, actor: string, op: SocialOperationId, body: Record<string, unknown> = {}, ms = 0, ids: string[] = [], query: Record<string, string> = {}): SocialCommandOutcome {
  const r = attempt(g, actor, op, body, ms, ids, query);
  if (!r.ok) throw new Error(`${op} by ${actor} refused: ${r.error.message}`);
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

const befriend = (g: World, a: string, b: string, ms: number) => {
  apply(g, a, 'requests.send', { toUserId: b }, ms);
  apply(g, b, 'requests.accept', {}, ms, [g.s.requests[g.s.requests.length - 1].requestId]);
};
const createParty = (g: World, leader: string, ms: number) => (apply(g, leader, 'parties.create', { name: 'P' }, ms).data as { partyId: string }).partyId;
const joinParty = (g: World, leader: string, party: string, who: string, ms: number) => {
  const inv = apply(g, leader, 'parties.invite', { toUserId: who }, ms, [party]).data as { inviteId: string };
  apply(g, who, 'party_invites.accept', {}, ms, [inv.inviteId]);
};
const pos = (x: number) => ({ x, y: 0, z: 10, yaw: 90, speed: 600, motion: 'RUN', skinId: 'shadow_flame' });
const report = (g: World, who: string, ms: number) => apply(g, who, 'world.state', pos(ms), ms);
const reports = (g: World, who: string, times: number[]) => times.forEach((ms) => report(g, who, ms));
/** The ring of a player as report times relative to T0. */
const ring = (g: World, who: string) => (g.w.trails?.[who] ?? []).map((e) => e.reportedAtMs - T0);
const floorOf = (g: World, subject: string, viewer: string) => g.w.floors?.[subject]?.[viewer];
/** Every pair floor, as "subject<-viewer" -> serial number. */
const floorMap = (w: WorldState) => new Map(Object.entries(w.floors ?? {}).flatMap(([s, row]) => Object.entries(row).map(([v, f]) => [`${s}<-${v}`, f] as const)));
/** What `viewer` is served at `ms`, cursor `since` (relative to T0; absent = no cursor). */
const view = (g: World, viewer: string, ms: number, since?: number) => worldViewFor(g.w, g.s, viewer, T0 + ms, since === undefined ? undefined : T0 + since);
const figure = (g: World, viewer: string, subject: string, ms: number, since?: number) => view(g, viewer, ms, since).avatars.find((a) => a.userId === subject);
/** The trail served to `viewer` for `subject`, as report times relative to T0 (asOf - age); [] when none; null when no figure. */
function trailTimes(g: World, viewer: string, subject: string, ms: number, since: number = ZERO): number[] | null {
  const f = figure(g, viewer, subject, ms, since);
  if (f === undefined) return null;
  return (f.trail ?? []).map((p) => ms - p.ageMs);
}
const tenths = (from: number, to: number) => Array.from({ length: (to - from) / 100 + 1 }, (_, i) => from + i * 100);
const sample = (ms: number, seq: number): TrailSample => ({ contextId: 'pub_x_1', x: ms, y: 0, z: 0, yaw: 0, speed: 0, motion: 'IDLE', reportedAtMs: T0 + ms, seq });

/* ------------------------------------------------------------------------------------------------------------ storage */

describe('the ring: what is stored, and for how long', () => {
  it('RING-S01 R05 accepted reports enter the ring oldest first; a resent report inside the 100 ms floor never enters it', () => {
    const g = together();
    reports(g, SAM, [100, 150, 200, 200, 260, 300]);
    expect(ring(g, SAM)).toEqual([100, 200, 300]);
  });

  it(`RING-S02 R05 the ring keeps at most ${WORLD_TRAIL_MAX_ENTRIES} reports per player`, () => {
    const g = together();
    reports(g, SAM, tenths(100, 2000));
    expect(ring(g, SAM)).toEqual(tenths(1300, 2000));
  });

  it(`RING-S03 R05 the ring drops reports older than ${WORLD_TRAIL_MAX_AGE_MS} ms when the next one is stored`, () => {
    const g = together();
    reports(g, SAM, [100, 200, 300]);
    report(g, SAM, 2250);
    expect(ring(g, SAM)).toEqual([300, 2250]);
    report(g, SAM, 5000);
    expect(ring(g, SAM)).toEqual([5000]);
  });

  it('RING-S04 R25 a duplicate or out-of-order report never enters the ring, whatever the caller', () => {
    let r = appendToTrail(undefined, sample(100, 1));
    r = appendToTrail(r, sample(300, 2));
    expect(appendToTrail(r, sample(300, 3))).toBe(r);   // a duplicate
    expect(appendToTrail(r, sample(200, 4))).toBe(r);   // out of order
    expect(appendToTrail(r, { ...sample(300, 5), x: 999 })).toBe(r);   // the same time, other content
    expect(appendToTrail(r, sample(400, 6)).map((e) => e.reportedAtMs - T0)).toEqual([100, 300, 400]);
    // through the operation: a request stamped earlier than the stored report, executed after it, is answered and stored nowhere
    const g = together();
    reports(g, SAM, [500, 400, 450, 600]);
    expect(ring(g, SAM)).toEqual([500, 600]);
  });

  it('RING-S05 a ring entry holds the stored position fields, its context, its time and its serial number: never an id, a skin or a name', () => {
    const g = together();
    report(g, SAM, 100);
    expect(Object.keys(g.w.trails?.[SAM]?.[0] ?? {}).sort()).toEqual(['contextId', 'motion', 'reportedAtMs', 'seq', 'speed', 'x', 'y', 'yaw', 'z']);
  });

  it('RING-S06 memory only: rings, floors and epochs exist only for current members, and a restart (an empty world) has none', () => {
    const g = together();
    reports(g, SAM, [100, 200]);
    reports(g, VAL, [110, 210]);
    apply(g, VAL, 'blocks.add', { targetId: SAM }, 220);
    expect(floorOf(g, SAM, VAL)).toBeDefined();
    apply(g, VAL, 'world.leave', {}, 300);
    const members = new Set(Object.values(g.w.contexts).flatMap((c) => c.memberIds));
    expect(Object.keys(g.w.trails ?? {}).every((id) => g.w.avatars[id] !== undefined)).toBe(true);
    expect(Object.keys(g.w.joinedSeq ?? {}).every((id) => members.has(id))).toBe(true);
    expect(Object.entries(g.w.floors ?? {}).every(([s, row]) => members.has(s) && Object.keys(row).every((v) => members.has(v)))).toBe(true);
    const empty = emptyWorldState();
    expect([empty.trails, empty.floors, empty.joinedSeq, empty.seq]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('RING-S07 prototype-safe (T2 R2): players named __proto__, constructor, toString and hasOwnProperty get rings, floors and epochs as OWN entries, no prototype is touched, and the gate holds for them', () => {
    const hostile = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
    let s = emptySocialState();
    [SAM, ...hostile].forEach((id, i) => {
      s = ensureSocialUser(s, { userId: id, displayName: `p${i}`, handle: `@hostile${i}` }, at(-1000));
    });
    const g: World = { s, w: emptyWorldState() };
    for (const id of [SAM, ...hostile]) {
      apply(g, id, 'presence.update_self', { connected: true }, -900);
      apply(g, id, 'world.join', { target: 'PUBLIC' }, -500);
    }
    reports(g, SAM, [100, 200, 300]);
    for (const id of hostile) reports(g, id, [110, 210, 310]);
    for (const id of hostile) {
      apply(g, id, 'blocks.add', { targetId: SAM }, 320);
      apply(g, id, 'blocks.remove', {}, 330, [SAM]);
    }
    for (const map of [g.w.floors, g.w.floors?.[SAM], g.w.joinedSeq, g.w.trails]) expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
    for (const id of hostile) {
      expect(Object.hasOwn(g.w.floors ?? {}, id), `floors on ${id}`).toBe(true);
      expect(Object.hasOwn(g.w.floors?.[SAM] ?? {}, id), `Sam's floor for ${id}`).toBe(true);
      expect(Object.hasOwn(g.w.joinedSeq ?? {}, id), `epoch of ${id}`).toBe(true);
      expect(Object.hasOwn(g.w.trails ?? {}, id), `ring of ${id}`).toBe(true);
    }
    expect(({} as { toString: unknown }).toString).toBe(Object.prototype.toString);
    // the gate holds for them: nothing from before the block's end, then the next report
    report(g, SAM, 400);
    for (const id of hostile) expect(trailTimes(g, id, SAM, 450), id).toEqual([]);
    report(g, SAM, 500);
    for (const id of hostile) expect(trailTimes(g, id, SAM, 550), id).toEqual([400]);
  });
});

/* -------------------------------------------------------------------------------------------------------------- serve */

describe('serving: a cursor, oldest first, at least once, nothing older than the ring', () => {
  it("RING-V01 R01 R30 without a valid cursor the view is exactly today's: no asOfMs, no trail, the same bytes; a body sinceMs is ignored", () => {
    const g = together();
    reports(g, SAM, tenths(100, 800));
    apply(g, VAL, 'blocks.add', { targetId: WES }, 810);   // floors exist too
    const now = view(g, VAL, 850);
    const bare = { ...g.w, trails: undefined, floors: undefined, joinedSeq: undefined, seq: undefined };
    expect(JSON.stringify(now)).toBe(JSON.stringify(worldViewFor(bare, g.s, VAL, T0 + 850)));
    expect('asOfMs' in now).toBe(false);
    expect(now.avatars.some((a) => 'trail' in a)).toBe(false);
    // through the operation: no query, or a cursor in the BODY, answers no asOfMs
    [pos(1), { ...pos(1), sinceMs: 0 }, { ...pos(1), sinceMs: '0' }].forEach((body, i) => {
      const answer = apply(g, VAL, 'world.state', body, 900 + i * 200).data as Record<string, unknown>;
      expect('asOfMs' in answer).toBe(false);
    });
  });

  it('RING-V02 R04 with a cursor: the reports after (cursor - 100 ms) and before the newest, oldest first, each with its age; asOfMs is the answer time', () => {
    const g = together();
    reports(g, SAM, tenths(100, 800));
    const v = view(g, VAL, 850, 350);
    expect(v.asOfMs).toBe(T0 + 850);
    const sam = v.avatars.find((a) => a.userId === SAM);
    expect(sam?.reportedAtMs).toBe(T0 + 800);
    expect(sam?.trail?.map((p) => p.ageMs)).toEqual([550, 450, 350, 250, 150]);
    expect(trailTimes(g, VAL, SAM, 850, 350)).toEqual([300, 400, 500, 600, 700]);
  });

  it("RING-V03 R15b at least once: a report stored in the cursor's millisecond, or stamped before the view but run after it, is delivered next time; a repeat carries the same server key", () => {
    const g = together();
    apply(g, XAN, 'world.join', { target: 'PUBLIC' }, -400);
    report(g, SAM, 920);
    const first = view(g, VAL, 1000, ZERO);
    expect(first.avatars.find((a) => a.userId === SAM)?.reportedAtMs).toBe(T0 + 920);
    // run AFTER the view at 1000: Wes's report stamped in its very millisecond, and Xan's stamped 40 ms before it
    report(g, WES, 1000);
    report(g, XAN, 960);
    reports(g, SAM, [1020, 1120]);
    reports(g, WES, [1100]);
    reports(g, XAN, [1100]);
    const cursor = (first.asOfMs as number) - T0;
    expect(trailTimes(g, VAL, WES, 1150, cursor)).toEqual([1000]);
    expect(trailTimes(g, VAL, XAN, 1150, cursor)).toEqual([960]);
    // Sam: 920 comes again -- the latest Val already applied, with the same server key (asOfMs - ageMs) -- and the client drops it
    expect(trailTimes(g, VAL, SAM, 1150, cursor)).toEqual([920, 1020]);
  });

  it('RING-V04 R04 the newest report, carried by the figure itself, is never repeated in its trail', () => {
    const g = together();
    reports(g, SAM, [100, 200]);
    expect(trailTimes(g, VAL, SAM, 250)).toEqual([100]);
    expect(figure(g, VAL, SAM, 250, ZERO)?.reportedAtMs).toBe(T0 + 200);
  });

  it(`RING-V05 R06 a cursor of 0 or a too-old one reaches no further back than ${WORLD_TRAIL_MAX_AGE_MS} ms`, () => {
    const g = together();
    reports(g, SAM, tenths(0, 700));
    expect(ring(g, SAM)).toEqual(tenths(0, 700));
    const expected = [400, 500, 600];   // after 2350 - 2000 = 350, before the newest (700)
    expect(trailTimes(g, VAL, SAM, 2350, ZERO)).toEqual(expected);
    expect(trailTimes(g, VAL, SAM, 2350, -1_000_000)).toEqual(expected);
    expect(trailTimes(g, VAL, SAM, 2350, 550)).toEqual([500, 600]);   // the slack: after 450
  });

  it('RING-V06 R06 a future cursor reaches nothing, and is no error', () => {
    const g = together();
    reports(g, SAM, tenths(100, 500));
    const v = view(g, VAL, 550, 1e9);
    expect(v.asOfMs).toBe(T0 + 550);
    expect(trailTimes(g, VAL, SAM, 550, 1e9)).toEqual([]);
    expect(JSON.stringify(v.avatars)).toBe(JSON.stringify(view(g, VAL, 550).avatars));
  });

  it("RING-V07 R03 a trail entry carries only the figure's position fields and its age, measured from asOfMs", () => {
    const g = together();
    reports(g, SAM, [100, 200]);
    const v = view(g, VAL, 250, ZERO);
    const p = v.avatars.find((a) => a.userId === SAM)?.trail?.[0];
    expect(Object.keys(p ?? {}).sort()).toEqual(['ageMs', 'motion', 'speed', 'x', 'y', 'yaw', 'z']);
    expect(p).toEqual({ x: 100, y: 0, z: 10, yaw: 90, speed: 600, motion: 'RUN', ageMs: 150 });
    expect((v.asOfMs as number) - (p?.ageMs ?? 0)).toBe(T0 + 100);
  });

  it('RING-V08 R07 two viewers, two cursors, one ring: each is served by its own echoed cursor, and a view writes nothing (no per-viewer state)', () => {
    const g = together();
    reports(g, SAM, tenths(100, 600));
    const before = JSON.stringify(g.w);
    expect(trailTimes(g, VAL, SAM, 650, 350)).toEqual([300, 400, 500]);
    expect(trailTimes(g, WES, SAM, 650, 550)).toEqual([500]);
    expect(JSON.stringify(g.w)).toBe(before);
    expect(Object.keys(g.w).sort()).toEqual(['avatars', 'contexts', 'invites', 'joinedSeq', 'nextSerial', 'seq', 'trails']);
  });

  it("RING-V09 R26 R23 history unavailable -- after a restart, a floor, a cursor older than the ring -- is today's single report with asOfMs, never an error", () => {
    const g = together();
    reports(g, SAM, tenths(100, 1500));
    // a cursor older than the ring: the ring's own reports (no more), and the newest as today
    expect(trailTimes(g, VAL, SAM, 1550, 100)).toEqual(tenths(800, 1400));
    // a restart: the world is empty, the players rejoin, one report each
    const r: World = { s: g.s, w: emptyWorldState() };
    for (const id of [SAM, VAL]) apply(r, id, 'world.join', { target: 'PUBLIC' }, 2000);
    report(r, SAM, 2100);
    const answer = apply(r, VAL, 'world.state', pos(5), 2150, [], { sinceMs: String(T0 + 1550) }).data as WorldView;
    expect(answer.asOfMs).toBe(T0 + 2150);
    expect(answer.avatars.map((a) => [a.userId, a.reportedAtMs - T0, a.trail])).toEqual([[SAM, 2100, undefined]]);
    // a floor (Sam hid and came back): the newest alone
    apply(g, SAM, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 1560);
    apply(g, SAM, 'presence.update_self', { availability: 'AVAILABLE' }, 1570);
    report(g, SAM, 1600);
    expect(trailTimes(g, VAL, SAM, 1650, 100)).toEqual([]);
    expect(figure(g, VAL, SAM, 1650, 100)?.reportedAtMs).toBe(T0 + 1600);
    // saving a setting unchanged moves nobody's answer, so it floors nothing
    reports(g, SAM, [1700, 1800]);
    const floors = JSON.stringify(g.w.floors);
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'EVERYONE' }, 1850);
    expect(JSON.stringify(g.w.floors)).toBe(floors);
    expect(trailTimes(g, VAL, SAM, 1850, 100)).toEqual([1600, 1700]);
  });

  it('RING-V10 an entry stored in another context is never served, even if a ring held one', () => {
    const g = together();
    reports(g, SAM, [100, 200, 300]);
    const forged = (g.w.trails?.[SAM] ?? []).map((e) => (e.reportedAtMs === T0 + 100 ? { ...e, contextId: 'priv_usr_xan' } : e));
    g.w = { ...g.w, trails: { ...g.w.trails, [SAM]: forged } };
    expect(g.w.avatars[SAM].contextId).toBe('pub_golden_arrival_1');
    expect(trailTimes(g, VAL, SAM, 350)).toEqual([200]);
  });

  it("RING-V11 R06 R30 the cursor is the query's whole number only: anything else -- or a body field -- is today's answer, byte for byte", () => {
    const bad: Array<{ query: Record<string, string>; body?: Record<string, unknown> }> = [
      { query: { sinceMs: '-5' } }, { query: { sinceMs: '1.5' } }, { query: { sinceMs: '1e3' } }, { query: { sinceMs: 'abc' } },
      { query: { sinceMs: '' } }, { query: { sinceMs: '1234567890123456' } }, { query: { since: '0' } },
      { query: {}, body: { sinceMs: 0 } }, { query: {}, body: { sinceMs: '0' } },
    ];
    for (const { query, body } of bad) {
      const a = together();
      const b = together();
      reports(a, SAM, [100, 200, 300]);
      reports(b, SAM, [100, 200, 300]);
      const withBad = apply(a, VAL, 'world.state', { ...pos(1), ...(body ?? {}) }, 350, [], query).data;
      const without = apply(b, VAL, 'world.state', pos(1), 350).data;
      expect(JSON.stringify(withBad), JSON.stringify({ query, body })).toBe(JSON.stringify(without));
    }
    // control: a valid one is read, leading zeros and all
    const c = together();
    reports(c, SAM, [100, 200, 300]);
    expect((apply(c, VAL, 'world.state', pos(1), 350, [], { sinceMs: '0' }).data as WorldView).asOfMs).toBe(T0 + 350);
    expect((apply(c, VAL, 'world.state', pos(1), 450, [], { sinceMs: '000000000000000' }).data as WorldView).asOfMs).toBe(T0 + 450);
  });

  it('RING-V12 the 2 s window is exact (NB, T2 R1): an entry stored at exactly nowMs - 2000 is not served; one at nowMs - 1999 is', () => {
    const g = together();
    reports(g, SAM, [1000, 1100, 1200]);
    expect(trailTimes(g, VAL, SAM, 3000)).toEqual([1100]);   // 1000 = 3000 - 2000: out
    expect(trailTimes(g, VAL, SAM, 2999)).toEqual([1000, 1100]);   // 1000 = 2999 - 1999: in
    expect(trailTimes(g, VAL, SAM, 3000, 950)).toEqual([1100]);   // with a cursor whose slack reaches below the window too
  });

  it('R02 no served object carries an internal key: no trails, seq, joinedSeq or floors anywhere; no contextId, reportedAtMs or seq in a trail entry', () => {
    const g = together();
    reports(g, SAM, tenths(100, 500));
    apply(g, WES, 'blocks.add', { targetId: VAL }, 510);
    const answer = apply(g, VAL, 'world.state', pos(1), 550, [], { sinceMs: '0' }).data;
    const keys: string[] = [];
    const walk = (v: unknown, inTrail: boolean) => {
      if (Array.isArray(v)) v.forEach((x) => walk(x, inTrail));
      else if (v !== null && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          keys.push(inTrail ? `trail.${k}` : k);
          walk(x, inTrail || k === 'trail');
        }
      }
    };
    walk(answer, false);
    expect(keys.filter((k) => ['trails', 'seq', 'joinedSeq', 'floors'].includes(k) || /^trail\.(contextId|reportedAtMs|seq|userId|skinId)$/.test(k))).toEqual([]);
    expect(keys.filter((k) => k.startsWith('trail.')).length).toBeGreaterThan(0);
  });

  it('R20 world.read and world.join never carry asOfMs or a trail, whatever the query', () => {
    const g = together();
    reports(g, SAM, tenths(100, 400));
    const read = apply(g, VAL, 'world.read', {}, 450, [], { sinceMs: '0' }).data as Record<string, unknown>;
    expect('asOfMs' in read).toBe(false);
    const joined = apply(g, XAN, 'world.join', { target: 'PUBLIC' }, 460, [], { sinceMs: '0' }).data as WorldView;
    expect('asOfMs' in joined).toBe(false);
    expect(joined.avatars.some((a) => 'trail' in a)).toBe(false);
  });

  it('R21 the removal answer (a block took them out of a private server) carries no asOfMs and no trail: the same bytes with or without a cursor', () => {
    const g = cast();
    apply(g, WES, 'world.join', { target: 'PRIVATE', name: 'Den' }, 0);
    befriend(g, SAM, WES, 10);
    apply(g, WES, 'privacy.update_self', { privateServerVisibility: 'FRIENDS' }, 20);
    apply(g, SAM, 'world.join', { target: 'FRIEND', userId: WES }, 30);
    reports(g, WES, [100, 200]);
    apply(g, WES, 'blocks.add', { targetId: SAM }, 300);
    const a: World = { ...g };
    const withCursor = apply(a, SAM, 'world.state', pos(1), 400, [], { sinceMs: '0' }).data as WorldView;
    const b: World = { ...g };
    const without = apply(b, SAM, 'world.state', pos(1), 400).data;
    expect(withCursor.context).toBeNull();
    expect(JSON.stringify(withCursor)).toBe(JSON.stringify(without));
  });

  it('R24 a stale subject: neither the figure nor a trail', () => {
    const g = together();
    reports(g, SAM, tenths(100, 500));
    expect(figure(g, VAL, SAM, 500 + 15_001, ZERO)).toBeUndefined();
    expect(figure(g, VAL, SAM, 500 + 14_000, ZERO)?.trail).toBeUndefined();   // still drawn; the ring is past its 2 s
  });
});

/* ------------------------------------------------------------------------------------------------------- today's filter */

describe("the trail rides on the figure: only a viewer today's decision shows the subject to is served anything", () => {
  it('RING-F01 a subject appearing offline has no figure and no trail for anyone, though their reports are still stored', () => {
    const g = together();
    apply(g, SAM, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 50);
    reports(g, SAM, tenths(100, 500));
    expect(ring(g, SAM)).toEqual(tenths(100, 500));
    expect(figure(g, VAL, SAM, 550, ZERO)).toBeUndefined();
    expect(figure(g, WES, SAM, 550, ZERO)).toBeUndefined();
  });

  it('RING-F02 a presence audience of FRIENDS: the friend is served the trail, the stranger nothing', () => {
    const g = together();
    befriend(g, SAM, WES, 10);
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'FRIENDS' }, 30);
    reports(g, SAM, tenths(100, 400));
    expect(trailTimes(g, WES, SAM, 450)).toEqual([100, 200, 300]);
    expect(trailTimes(g, VAL, SAM, 450)).toBeNull();
  });

  it("RING-F03 a block either way: neither side is served the other's figure or trail, though their reports are still stored", () => {
    const g = together();
    apply(g, VAL, 'blocks.add', { targetId: SAM }, 50);
    reports(g, SAM, tenths(100, 400));
    reports(g, VAL, tenths(110, 410));
    expect(ring(g, SAM).length).toBe(4);
    expect(figure(g, VAL, SAM, 450, ZERO)).toBeUndefined();
    expect(figure(g, SAM, VAL, 450, ZERO)).toBeUndefined();
    expect(trailTimes(g, WES, SAM, 450)).toEqual([100, 200, 300]);
  });

  it('RING-F04 a viewer in another context is served nothing of the subject', () => {
    const g = together();
    apply(g, VAL, 'world.join', { target: 'PRIVATE', name: 'Elsewhere' }, 50);
    reports(g, SAM, tenths(100, 400));
    expect(figure(g, VAL, SAM, 450, ZERO)).toBeUndefined();
    expect(view(g, VAL, 450, ZERO).avatars).toEqual([]);
  });
});

/* -------------------------------------------------------------------------------------------- the pair gate (P3, P6) */

describe('the pair gate: a change to whether S may be shown to V floors S for V, and for nobody else', () => {
  it('RING-C01 R09 appearing offline, then back: nothing stored before or while hidden is served; the floor is per viewer', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    apply(g, SAM, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 350);
    const hid = floorOf(g, SAM, VAL);
    expect(hid).toBeDefined();
    expect(floorOf(g, SAM, WES)).toBe(hid);
    reports(g, SAM, tenths(400, 600));
    apply(g, SAM, 'presence.update_self', { availability: 'AVAILABLE' }, 650);
    expect(floorOf(g, SAM, VAL)).toBeGreaterThan(hid as number);
    report(g, SAM, 700);
    expect(trailTimes(g, VAL, SAM, 750)).toEqual([]);
    expect(trailTimes(g, WES, SAM, 750)).toEqual([]);
    expect(figure(g, VAL, SAM, 750, ZERO)?.reportedAtMs).toBe(T0 + 700);
    report(g, SAM, 800);
    expect(trailTimes(g, VAL, SAM, 850)).toEqual([700]);
  });

  it('RING-C02 R10 presenceVisibility EVERYONE -> NOBODY -> EVERYONE serves nothing from the hidden period; FRIENDS -> EVERYONE floors no friend', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'NOBODY' }, 350);
    reports(g, SAM, tenths(400, 600));
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'EVERYONE' }, 650);
    report(g, SAM, 700);
    expect(trailTimes(g, VAL, SAM, 750)).toEqual([]);
    // FRIENDS -> EVERYONE: Wes, a friend, saw Sam throughout: no floor for him; Val, a stranger, is floored
    const h = together();
    befriend(h, SAM, WES, 1);
    apply(h, SAM, 'privacy.update_self', { presenceVisibility: 'FRIENDS' }, 2);
    reports(h, SAM, tenths(100, 300));
    apply(h, SAM, 'privacy.update_self', { presenceVisibility: 'EVERYONE' }, 350);
    expect(floorOf(h, SAM, WES)).toBeUndefined();
    expect(floorOf(h, SAM, VAL)).toBeDefined();
    report(h, SAM, 400);
    expect(trailTimes(h, WES, SAM, 450)).toEqual([100, 200, 300]);
    expect(trailTimes(h, VAL, SAM, 450)).toEqual([]);
  });

  it('RING-C03 R08 a block either way, then the unblock: nothing stored before or during the block is served, both directions, by either side', () => {
    for (const blocker of [VAL, SAM]) {
      const other = blocker === VAL ? SAM : VAL;
      const g = together();
      reports(g, SAM, tenths(100, 300));
      reports(g, VAL, tenths(110, 310));
      apply(g, blocker, 'blocks.add', { targetId: other }, 350);
      expect(floorOf(g, SAM, VAL)).toBeDefined();
      expect(floorOf(g, VAL, SAM)).toBeDefined();
      reports(g, SAM, tenths(400, 600));
      reports(g, VAL, tenths(410, 610));
      apply(g, blocker, 'blocks.remove', {}, 650, [other]);
      reports(g, SAM, [700, 800]);
      reports(g, VAL, [710, 810]);
      expect(trailTimes(g, VAL, SAM, 850)).toEqual([700]);
      expect(trailTimes(g, SAM, VAL, 850)).toEqual([710]);
      // the third party was never floored
      expect(floorOf(g, SAM, WES)).toBeUndefined();
    }
  });

  it('RING-C04 R11 a FRIENDS audience: accept, remove, re-accept -- nothing from the gap is served; under EVERYONE a friendship floors nobody', () => {
    const g = together();
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'FRIENDS' }, 10);
    apply(g, SAM, 'requests.send', { toUserId: VAL }, 20);
    reports(g, SAM, tenths(100, 300));
    apply(g, VAL, 'requests.accept', {}, 350, [g.s.requests[0].requestId]);   // the viewer accepts
    report(g, SAM, 400);
    expect(trailTimes(g, VAL, SAM, 450)).toEqual([]);
    reports(g, SAM, [500, 600]);
    expect(trailTimes(g, VAL, SAM, 650)).toEqual([400, 500]);
    apply(g, VAL, 'friends.remove', {}, 660, [SAM]);   // the viewer ends it
    reports(g, SAM, tenths(700, 900));
    befriend(g, SAM, VAL, 950);   // and again
    report(g, SAM, 1000);
    expect(trailTimes(g, VAL, SAM, 1050)).toEqual([]);
    // under EVERYONE the friendship moves nobody's answer
    const h = together();
    reports(h, SAM, tenths(100, 300));
    befriend(h, SAM, VAL, 350);
    expect(h.w.floors).toBeUndefined();
    expect(trailTimes(h, VAL, SAM, 400)).toEqual([100, 200]);
  });

  it('RING-C05 R12 a PARTY audience: an invite accepted, a leave, a removal and a block that separates the party each floor at their own point', () => {
    const g = together();
    befriend(g, SAM, VAL, 1);
    befriend(g, SAM, WES, 2);
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'PARTY' }, 3);
    const party = createParty(g, SAM, 4);
    joinParty(g, SAM, party, WES, 5);
    reports(g, SAM, tenths(100, 300));
    expect(figure(g, VAL, SAM, 350, ZERO)).toBeUndefined();
    expect(trailTimes(g, WES, SAM, 350)).toEqual([100, 200]);
    joinParty(g, SAM, party, VAL, 360);   // the viewer joins
    report(g, SAM, 400);
    expect(trailTimes(g, VAL, SAM, 450)).toEqual([]);
    expect(trailTimes(g, WES, SAM, 450)).toEqual([100, 200, 300]);   // Wes, already in, is not floored
    reports(g, SAM, [500, 600]);
    apply(g, VAL, 'parties.leave', {}, 650, [party]);   // the viewer leaves
    joinParty(g, SAM, party, VAL, 700);
    report(g, SAM, 750);
    expect(trailTimes(g, VAL, SAM, 800)).toEqual([]);
    report(g, SAM, 850);
    apply(g, SAM, 'parties.remove_member', {}, 900, [party, VAL]);   // the leader removes the viewer
    joinParty(g, SAM, party, VAL, 950);
    report(g, SAM, 1000);
    expect(trailTimes(g, VAL, SAM, 1050)).toEqual([]);
    // a block that separates the party: Wes blocks Val (Wes is no leader, so Wes leaves): Sam is floored for Wes
    reports(g, SAM, [1100, 1200]);
    expect(floorOf(g, SAM, WES)).toBeUndefined();
    apply(g, WES, 'blocks.add', { targetId: VAL, confirmSharedParty: true }, 1250);
    expect(floorOf(g, SAM, WES)).toBeDefined();
    report(g, SAM, 1300);
    expect(figure(g, WES, SAM, 1350, ZERO)).toBeUndefined();
  });

  it('RING-C06 R32 a sign-out without a leave floors nothing (the filter never reads connected): the ring follows the figure; its leave drops it', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    apply(g, SAM, 'presence.update_self', { connected: false }, 350);
    expect(g.w.floors).toBeUndefined();
    expect(trailTimes(g, VAL, SAM, 380)).toEqual([100, 200]);
    apply(g, SAM, 'world.leave', {}, 400);
    expect(g.w.trails?.[SAM]).toBeUndefined();
  });

  it('RING-C07 a record that disappears floors every co-member (no operation deletes one today), and a missing record is never served', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    const { [SAM]: _gone, ...users } = g.s.users;
    const after: SocialState = { ...g.s, users };
    const gated = noteAudienceChange(g.w, g.s, after);
    expect(gated.floors?.[SAM]?.[VAL]).toBeDefined();
    expect(gated.floors?.[SAM]?.[WES]).toBeDefined();
    expect(worldViewFor(g.w, after, VAL, T0 + 350, 0).avatars.find((a) => a.userId === SAM)).toBeUndefined();
  });

  it('RING-C08 R13 the reconciliation that runs before every operation, a read included, floors exactly the pairs it changes', () => {
    const g = together();
    befriend(g, SAM, VAL, 1);
    befriend(g, SAM, WES, 2);
    const party = createParty(g, SAM, 3);
    joinParty(g, SAM, party, VAL, 4);
    joinParty(g, SAM, party, WES, 5);
    apply(g, VAL, 'privacy.update_self', { presenceVisibility: 'PARTY' }, 6);
    reports(g, VAL, tenths(100, 300));
    // carried-in data: Wes has blocked Sam, the leader, while both are still in the party; adopted through the pair gate
    const blocked: SocialState = { ...g.s, blocks: [...g.s.blocks, { blockerId: WES, blockedId: SAM, sinceIso: at(350) }] };
    g.w = noteAudienceChange(g.w, g.s, blocked);
    g.s = blocked;
    const before = floorMap(g.w);
    expect(trailTimes(g, WES, VAL, 360)).toEqual([100, 200]);
    // any operation at all, even a read by somebody else, reconciles first: Wes (not the leader) leaves the party
    apply(g, XAN, 'snapshot.read', {}, 370);
    expect(g.s.parties[party].members.map((m) => m.userId)).not.toContain(WES);
    // exactly the pair it changed: Val's PARTY audience no longer holds Wes
    const moved = [...floorMap(g.w)].filter(([pair, f]) => before.get(pair) !== f).map(([pair]) => pair);
    expect(moved).toEqual([`${VAL}<-${WES}`]);
    expect(figure(g, WES, VAL, 380, ZERO)).toBeUndefined();
  });

  it("RING-C09 R18 a leave drops the ring, floors and epoch with the figure; so do a move, the stale sweep and a block's removal from a private server", () => {
    const dropped = (g: World, id: string) => {
      expect(g.w.trails?.[id]).toBeUndefined();
      expect(g.w.floors?.[id]).toBeUndefined();
      expect(Object.values(g.w.floors ?? {}).some((row) => id in row)).toBe(false);
    };
    const g = together();
    reports(g, SAM, tenths(100, 300));
    reports(g, VAL, tenths(110, 310));
    apply(g, VAL, 'blocks.add', { targetId: SAM }, 320);
    apply(g, VAL, 'blocks.remove', {}, 330, [SAM]);
    expect(floorOf(g, SAM, VAL)).toBeDefined();
    expect(floorOf(g, VAL, SAM)).toBeDefined();
    apply(g, SAM, 'world.leave', {}, 350);
    dropped(g, SAM);
    expect(g.w.joinedSeq?.[SAM]).toBeUndefined();
    // a move: public -> a private server (the epoch is the new arrival's)
    apply(g, SAM, 'world.join', { target: 'PUBLIC' }, 400);
    reports(g, SAM, tenths(500, 700));
    const epoch = g.w.joinedSeq?.[SAM];
    apply(g, SAM, 'world.join', { target: 'PRIVATE', name: 'Den' }, 750);
    dropped(g, SAM);
    expect(g.w.joinedSeq?.[SAM]).toBeGreaterThan(epoch as number);
    // the stale sweep, which runs at any join: Sam silent past the stale window
    reports(g, SAM, tenths(800, 900));
    apply(g, XAN, 'world.join', { target: 'PUBLIC' }, 900 + 15_001);
    dropped(g, SAM);
    // a block that removes a member from the owner's private server
    const h = together();
    apply(h, WES, 'world.join', { target: 'PRIVATE', name: 'Den' }, 10);
    befriend(h, SAM, WES, 20);
    apply(h, WES, 'privacy.update_self', { privateServerVisibility: 'FRIENDS' }, 40);
    apply(h, SAM, 'world.join', { target: 'FRIEND', userId: WES }, 50);
    reports(h, SAM, tenths(100, 300));
    expect(ring(h, SAM)).toEqual(tenths(100, 300));
    apply(h, WES, 'blocks.add', { targetId: SAM }, 350);
    dropped(h, SAM);
  });

  it('RING-C10 R16 an arriving viewer -- public, private, friend, invite, party -- is served nothing stored before it arrived, whatever cursor; afterwards it is', () => {
    // Sam waits in Wes's private server; Val arrives five ways
    const setup = () => {
      const g = cast();
      befriend(g, WES, VAL, -50);
      befriend(g, WES, SAM, -49);
      apply(g, WES, 'privacy.update_self', { privateServerVisibility: 'FRIENDS' }, -48);
      apply(g, WES, 'world.join', { target: 'PRIVATE', name: 'Den' }, -47);
      apply(g, SAM, 'world.join', { target: 'FRIEND', userId: WES }, -46);
      return g;
    };
    const arrivals: Array<[string, (g: World) => void]> = [
      ['PUBLIC', (g) => {
        apply(g, SAM, 'world.join', { target: 'PUBLIC' }, -45);
        reports(g, SAM, tenths(100, 300));
        apply(g, VAL, 'world.join', { target: 'PUBLIC' }, 350);
      }],
      ['PRIVATE', (g) => {
        apply(g, VAL, 'world.join', { target: 'PRIVATE', name: 'Vals' }, -45);
        befriend(g, VAL, SAM, -44);
        apply(g, VAL, 'privacy.update_self', { privateServerVisibility: 'FRIENDS' }, -43);
        apply(g, SAM, 'world.join', { target: 'FRIEND', userId: VAL }, -42);
        apply(g, VAL, 'world.leave', {}, -41);
        reports(g, SAM, tenths(100, 300));
        apply(g, VAL, 'world.join', { target: 'PRIVATE', name: 'Vals' }, 350);
      }],
      ['FRIEND', (g) => {
        reports(g, SAM, tenths(100, 300));
        apply(g, VAL, 'world.join', { target: 'FRIEND', userId: WES }, 350);
      }],
      ['INVITE', (g) => {
        reports(g, SAM, tenths(100, 300));
        const inv = apply(g, WES, 'world.invite', { toUserId: VAL }, 320).data as { inviteId: string };
        apply(g, VAL, 'world.join', { target: 'INVITE', inviteId: inv.inviteId }, 350);
      }],
      ['PARTY', (g) => {
        const party = createParty(g, WES, -45);
        joinParty(g, WES, party, VAL, -44);
        reports(g, SAM, tenths(100, 300));
        apply(g, VAL, 'world.join', { target: 'PARTY' }, 350);
      }],
    ];
    for (const [kind, arrive] of arrivals) {
      const g = setup();
      arrive(g);
      expect(contextOf(g.w, VAL)?.contextId, kind).toBe(contextOf(g.w, SAM)?.contextId);
      expect(ring(g, SAM).length, kind).toBeGreaterThan(0);
      expect(trailTimes(g, VAL, SAM, 380), kind).toEqual([]);
      reports(g, SAM, [400, 500, 600]);
      expect(trailTimes(g, VAL, SAM, 650), kind).toEqual([400, 500]);
    }
  });

  it('RING-C11 R19 viewer-side: the viewer appearing offline or changing its own privacy changes nothing it is served; leaving and coming back serves nothing from its absence', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    reports(g, VAL, tenths(110, 310));
    const seen = () => JSON.stringify(view(g, VAL, 380, ZERO).avatars.map((a) => [a.userId, a.trail]));
    const before = seen();
    apply(g, VAL, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 350);
    apply(g, VAL, 'privacy.update_self', { presenceVisibility: 'NOBODY', locationVisibility: 'NOBODY' }, 360);
    expect(seen()).toBe(before);
    expect(floorOf(g, SAM, VAL)).toBeUndefined();
    // away and back
    apply(g, VAL, 'world.join', { target: 'PRIVATE', name: 'Away' }, 500);
    reports(g, SAM, tenths(600, 800));
    apply(g, VAL, 'world.join', { target: 'PUBLIC' }, 850);
    report(g, SAM, 900);
    expect(trailTimes(g, VAL, SAM, 950)).toEqual([]);
  });

  it("RING-C12 what changes nobody's answer floors nothing (the design's no-op rows): a message, a mute, an activity, a skin, a report, a read, a request, a party's rules, a location setting", () => {
    const g = together();
    befriend(g, SAM, VAL, 1);
    const party = createParty(g, SAM, 2);
    reports(g, SAM, tenths(100, 300));
    const conv = apply(g, VAL, 'conversations.open', { otherUserId: SAM }, 310).data as { conversationId: string };
    apply(g, VAL, 'messages.send', { body: 'hi' }, 320, [conv.conversationId]);
    apply(g, SAM, 'mutes.set', { targetId: VAL }, 330);
    apply(g, SAM, 'presence.update_self', { signals: { exploring: true }, activityDetail: 'Running' }, 340);
    apply(g, VAL, 'snapshot.read', {}, 350);
    apply(g, WES, 'world.state', { ...pos(1), skinId: 'celestial_light' }, 360);
    apply(g, XAN, 'requests.send', { toUserId: SAM }, 370);
    apply(g, SAM, 'requests.decline', {}, 380, [g.s.requests[g.s.requests.length - 1].requestId]);
    apply(g, SAM, 'parties.rules', { privacy: 'OPEN_TO_FRIENDS' }, 390, [party]);
    apply(g, SAM, 'privacy.update_self', { locationVisibility: 'NOBODY' }, 395);
    expect(g.w.floors).toBeUndefined();
    expect(trailTimes(g, VAL, SAM, 399)).toEqual([100, 200]);
  });

  it('RING-C13 R28 a player listed in two parties (carried-in data): the viewer joining the SECOND party floors the pair', () => {
    const g = together();
    befriend(g, WES, VAL, 1);
    const p1 = createParty(g, SAM, 3);
    const p2 = createParty(g, WES, 4);
    // carried-in: Sam is listed in Wes's party too (a restore, a race), while still in his own; adopted through the pair gate
    const two = g.s.parties[p2];
    const listed: SocialState = { ...g.s, parties: { ...g.s.parties, [p2]: { ...two, members: [...two.members, { ...two.members[0], userId: SAM }] } } };
    g.w = noteAudienceChange(g.w, g.s, listed);
    g.s = listed;
    expect(Object.keys(g.s.parties)[0]).toBe(p1);
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'PARTY' }, 5);
    reports(g, SAM, tenths(100, 300));
    expect(figure(g, VAL, SAM, 350, ZERO)).toBeUndefined();
    joinParty(g, WES, p2, VAL, 370);
    expect(figure(g, VAL, SAM, 380, ZERO)?.userId).toBe(SAM);
    expect(floorOf(g, SAM, VAL)).toBeDefined();
    report(g, SAM, 400);
    expect(trailTimes(g, VAL, SAM, 450)).toEqual([]);
  });

  it("R14 no third-party tell: Wes, whose view of Sam did not change, gets the same trail before and after Sam blocks, unfriends, changes party or changes privacy for someone else", () => {
    const cases: Array<[string, (g: World) => void, (g: World) => void]> = [
      ['Sam blocks Val', () => undefined, (g) => apply(g, SAM, 'blocks.add', { targetId: VAL }, 350)],
      ['Val blocks Sam', () => undefined, (g) => apply(g, VAL, 'blocks.add', { targetId: SAM }, 350)],
      ['Sam unfriends Val (FRIENDS audience)', (g) => {
        befriend(g, SAM, VAL, 1);
        befriend(g, SAM, WES, 2);
        apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'FRIENDS' }, 3);
      }, (g) => apply(g, SAM, 'friends.remove', {}, 350, [VAL])],
      ['Val joins Sam\'s party (PARTY audience)', (g) => {
        befriend(g, SAM, VAL, 1);
        befriend(g, SAM, WES, 2);
        joinParty(g, SAM, createParty(g, SAM, 3), WES, 4);
        apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'PARTY' }, 5);
      }, (g) => joinParty(g, SAM, Object.keys(g.s.parties)[0], VAL, 350)],
      ['Sam shows only friends (Wes is one)', (g) => befriend(g, SAM, WES, 1), (g) => apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'FRIENDS' }, 350)],
    ];
    for (const [name, setup, act] of cases) {
      const g = together();
      setup(g);
      reports(g, SAM, tenths(100, 300));
      const wes = () => JSON.stringify(view(g, WES, 380, ZERO).avatars.filter((a) => a.userId === SAM));
      const before = wes();
      const valBefore = floorOf(g, SAM, VAL);
      act(g);
      expect(wes(), name).toBe(before);
      expect(floorOf(g, SAM, WES), name).toBeUndefined();
      expect(floorOf(g, SAM, VAL), name).not.toBe(valBefore);   // the pair that changed was floored
    }
  });

  it('R14b no hidden-arrival tell: Xan arrives hidden from Val, and every answer Val receives is unchanged; control: a visible arrival changes only the figure list and the count', () => {
    for (const hidden of [true, false]) {
      const g = together();
      reports(g, SAM, tenths(100, 300));
      reports(g, WES, tenths(110, 310));
      if (hidden) apply(g, XAN, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 50);
      const trails = () => JSON.stringify(view(g, VAL, 380, ZERO).avatars.filter((a) => a.userId !== XAN).map((a) => [a.userId, a.trail]));
      const whole = () => JSON.stringify(view(g, VAL, 380, ZERO));
      const [beforeTrails, beforeWhole] = [trails(), whole()];
      apply(g, XAN, 'world.join', { target: 'PUBLIC' }, 350);
      expect(trails(), `hidden=${hidden}`).toBe(beforeTrails);
      if (hidden) expect(whole()).toBe(beforeWhole);
      report(g, XAN, 360);
      expect(view(g, VAL, 380, ZERO).avatars.some((a) => a.userId === XAN)).toBe(!hidden);
      expect(trails(), `hidden=${hidden}`).toBe(beforeTrails);
    }
  });

  it('R15 serial order, not time: a report stamped after an unhide but executed before it is not served', () => {
    const g = together();
    reports(g, SAM, [100, 200]);
    apply(g, SAM, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 300);
    report(g, SAM, 700);   // its request arrived at 700, but it runs BEFORE the unhide whose request arrived at 600
    apply(g, SAM, 'presence.update_self', { availability: 'AVAILABLE' }, 600);
    report(g, SAM, 900);
    expect(figure(g, VAL, SAM, 950, ZERO)?.reportedAtMs).toBe(T0 + 900);
    expect(trailTimes(g, VAL, SAM, 950)).toEqual([]);
    report(g, SAM, 1000);
    expect(trailTimes(g, VAL, SAM, 1050)).toEqual([900]);
  });

  it("R17 the subject moves A -> B -> A within the ring's 2 s: no position from the earlier stay is ever served", () => {
    const g = together();
    reports(g, SAM, tenths(100, 400));
    apply(g, SAM, 'world.join', { target: 'PRIVATE', name: 'B' }, 450);
    reports(g, SAM, [500, 600]);
    apply(g, SAM, 'world.join', { target: 'PUBLIC' }, 650);
    reports(g, SAM, [700, 800]);
    expect(trailTimes(g, VAL, SAM, 850)).toEqual([700]);
  });

  it("R22 floors are pruned below the ring's oldest serial number, and dropped with a viewer who leaves: never more than one per co-member", () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    apply(g, VAL, 'blocks.add', { targetId: SAM }, 310);
    apply(g, VAL, 'blocks.remove', {}, 320, [SAM]);
    expect(Object.keys(g.w.floors?.[SAM] ?? {})).toEqual([VAL]);
    reports(g, SAM, tenths(400, 1000));   // seven newer reports: one stored before the floor is still kept
    expect(Object.keys(g.w.floors?.[SAM] ?? {})).toEqual([VAL]);
    report(g, SAM, 1100);   // eight: the floor excludes nothing any more
    expect(Object.keys(g.w.floors?.[SAM] ?? {})).toEqual([]);
    // churn: forty arrivals and leaves while Sam hides and shows -- floors on Sam stay one per co-member at most
    const h = together();
    reports(h, SAM, tenths(100, 200));
    for (let i = 0; i < 40; i += 1) {
      const who = i % 2 === 0 ? VAL : WES;
      apply(h, SAM, 'presence.update_self', { availability: i % 2 === 0 ? 'APPEAR_OFFLINE' : 'AVAILABLE' }, 300 + i * 10);
      apply(h, who, 'world.leave', {}, 301 + i * 10);
      apply(h, who, 'world.join', { target: 'PUBLIC' }, 302 + i * 10);
      const members = (contextOf(h.w, SAM)?.memberIds.length ?? 1) - 1;
      expect(Object.keys(h.w.floors?.[SAM] ?? {}).length).toBeLessThanOrEqual(members);
    }
  });
});

/* ----------------------------------------------------------------------- T1 v2 (c72f1ea8): R36, R37, R38, R22b */

describe('T1 v2: the touched set from changed records (R36), the view built last (R37), the CPU bound (R38), a leaver\'s floors (R22b)', () => {
  /**
   * Val listed in two parties (carried-in): Xan's first (by insertion order; Sam is not in it) and Wes's, which holds Sam. Sam's
   * audience is PARTY, so Sam is hidden from Val. Everybody is in one public world; Val has never reported (she holds no ring).
   */
  function twoParties(): { g: World; first: string; second: string } {
    const g = together();
    apply(g, XAN, 'world.join', { target: 'PUBLIC' }, -450);
    befriend(g, XAN, VAL, 1);
    befriend(g, WES, SAM, 2);
    const first = createParty(g, XAN, 3);
    joinParty(g, XAN, first, VAL, 4);
    const second = createParty(g, WES, 5);
    joinParty(g, WES, second, SAM, 6);
    const two = g.s.parties[second];
    const listed: SocialState = { ...g.s, parties: { ...g.s.parties, [second]: { ...two, members: [...two.members, { ...two.members[0], userId: VAL, role: 'MEMBER' }] } } };
    g.w = noteAudienceChange(g.w, g.s, listed);
    g.s = listed;
    apply(g, SAM, 'privacy.update_self', { presenceVisibility: 'PARTY' }, 7);
    expect(Object.keys(g.s.parties)[0]).toBe(first);
    return { g, first, second };
  }
  /** carried-in: Val has blocked Xan, who leads her first party, while both are still in it */
  const carriedBlock = (g: World, ms: number) => {
    g.s = { ...g.s, blocks: [...g.s.blocks, { blockerId: VAL, blockedId: XAN, sinceIso: at(ms) }] };
  };

  it("R36 P2-1 a ring-less viewer whose first party switches to one holding Sam -- by a kick, or by a third party's reconciling read -- is never served Sam's entries from before the switch", () => {
    for (const how of ['kick', 'third-party snapshot.read', 'third-party parties.read'] as const) {
      const { g, first, second } = twoParties();
      reports(g, SAM, tenths(100, 300));
      expect(g.w.trails?.[VAL], how).toBeUndefined();
      expect(figure(g, VAL, SAM, 350, ZERO), how).toBeUndefined();
      if (how === 'kick') apply(g, XAN, 'parties.remove_member', {}, 360, [first, VAL]);
      else {
        carriedBlock(g, 355);
        if (how === 'third-party snapshot.read') apply(g, WES, 'snapshot.read', {}, 360);
        else apply(g, WES, 'parties.read', {}, 360, [second]);
      }
      expect(Object.values(g.s.parties).find((p) => p.members.some((m) => m.userId === VAL))?.partyId, how).toBe(second);
      const answer = apply(g, VAL, 'world.state', pos(1), 370, [], { sinceMs: '0' }).data as WorldView;
      const sam = answer.avatars.find((a) => a.userId === SAM);
      expect(sam?.reportedAtMs, how).toBe(T0 + 300);
      expect(sam?.trail, how).toBeUndefined();
      reports(g, SAM, [400, 500]);
      expect(trailTimes(g, VAL, SAM, 550), how).toEqual([400]);
    }
  });

  it("R37 P2-2 a reconciliation inside the viewer's OWN world.state that widens what it may see: the figure appears, with no entry from before, in that very answer; the next report follows", () => {
    const { g } = twoParties();
    // Val reports and views first: she has a cursor
    const first = apply(g, VAL, 'world.state', pos(1), 50, [], { sinceMs: '0' }).data as WorldView;
    reports(g, SAM, tenths(100, 300));
    carriedBlock(g, 320);
    expect(figure(g, VAL, SAM, 330, ZERO)).toBeUndefined();
    // Val's own report: the reconciliation runs first (Val, no leader, leaves Xan's party), so her first party is now Wes's
    const answer = apply(g, VAL, 'world.state', pos(2), 340, [], { sinceMs: String(first.asOfMs) }).data as WorldView;
    expect(Object.values(g.s.parties).find((p) => p.members.some((m) => m.userId === VAL))?.leaderId).toBe(WES);
    const sam = answer.avatars.find((a) => a.userId === SAM);
    expect(sam?.reportedAtMs).toBe(T0 + 300);
    expect(sam?.trail).toBeUndefined();
    report(g, SAM, 400);
    const next = apply(g, VAL, 'world.state', pos(3), 450, [], { sinceMs: String(answer.asOfMs) }).data as WorldView;
    expect(next.avatars.find((a) => a.userId === SAM)?.reportedAtMs).toBe(T0 + 400);
  });

  it('R38 P2-3 the CPU bound, counted on a 10,000-user state (50,000 friendships, 5,000 blocks, 2,000 parties, 32 members with full rings): O(1) when no audience record changed; bounded pair checks otherwise; no per-player key ever', () => {
    // mulberry32: integer arithmetic only, so the sequence never collapses (a float LCG did, and the generator below never ended)
    const rnd = (() => {
      let a = 7;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    const N = 10_000;
    const ids = Array.from({ length: N }, (_, i) => `usr_${i}`);
    const template = ensureSocialUser(emptySocialState(), { userId: 'usr_t', displayName: 't', handle: '@t' }, at(0)).users.usr_t;
    const users = Object.fromEntries(ids.map((id) => [id, { profile: { ...template.profile, userId: id, displayName: id, handle: `@${id}` }, privacy: { ...template.privacy, userId: id }, presence: { ...template.presence, userId: id, connected: true } }]));
    const members = ids.slice(0, 32);
    const friendships = new Map<string, { userA: string; userB: string; sinceIso: string }>();
    friendships.set(`${members[0]}|${members[1]}`, { userA: members[0], userB: members[1], sinceIso: at(0) });
    friendships.set(`${members[2]}|${members[3]}`, { userA: members[2], userB: members[3], sinceIso: at(0) });
    while (friendships.size < 50_000) {
      const a = ids[Math.floor(rnd() * N)];
      const b = ids[Math.floor(rnd() * N)];
      if (a < b) friendships.set(`${a}|${b}`, { userA: a, userB: b, sinceIso: at(0) });
    }
    const blocks = new Map<string, { blockerId: string; blockedId: string; sinceIso: string }>();
    while (blocks.size < 5_000) {
      const a = ids[100 + Math.floor(rnd() * (N - 100))];
      const b = ids[100 + Math.floor(rnd() * (N - 100))];
      if (a !== b) blocks.set(`${a}>${b}`, { blockerId: a, blockedId: b, sinceIso: at(0) });
    }
    const member = (userId: string, leader: boolean) => ({ userId, role: leader ? ('LEADER' as const) : ('MEMBER' as const), joinedAtIso: at(0), selfMuted: false });
    const parties: Record<string, SocialState['parties'][string]> = {};
    // one open party of 7 context members, led by members[0] (a friend of members[1], who will join it)
    parties.pty_ctx = { partyId: 'pty_ctx', name: 'ctx', leaderId: members[0], members: [0, 2, 3, 4, 5, 6, 7].map((i) => member(members[i], i === 0)), privacy: 'OPEN_TO_FRIENDS', invitePermission: 'LEADER_ONLY', createdAtIso: at(0), version: 1 };
    for (let k = 0; k < 1_999; k += 1) {
      const from = 200 + k * 4;
      parties[`pty_${k}`] = { partyId: `pty_${k}`, name: 'p', leaderId: ids[from], members: [0, 1, 2, 3].map((i) => member(ids[from + i], i === 0)), privacy: 'INVITE_ONLY', invitePermission: 'LEADER_ONLY', createdAtIso: at(0), version: 1 };
    }
    let s: SocialState = { ...emptySocialState(), users, friendships: [...friendships.values()], blocks: [...blocks.values()], parties, nextSerial: 100 };
    expect([Object.keys(s.users).length, s.friendships.length, s.blocks.length, Object.keys(s.parties).length]).toEqual([10_000, 50_000, 5_000, 2_000]);
    // 32 members in one context, each with a full ring
    let w = emptyWorldState();
    for (const id of members) {
      const j = joinWorld(w, s, id, { kind: 'PUBLIC', place: 'big', placeName: '' }, T0);
      if (!j.ok) throw new Error(j.message);
      w = j.value.world;
    }
    for (let k = 0; k < 8; k += 1) {
      for (const id of members) {
        const r = reportAvatar(w, id, { x: k, y: 0, z: 0, yaw: 0, speed: 0, motion: 'IDLE', skinId: 'shadow_flame' }, T0 + 100 + k * 100);
        if (!r.ok) throw new Error(r.message);
        w = r.value;
      }
    }
    expect(members.every((id) => (w.trails?.[id] ?? []).length === 8)).toBe(true);
    const conv = openDirectConversation(s, members[0], members[1], at(1));
    if (!conv.ok) throw new Error('conv');
    const sent = sendMessage(conv.value.state, members[0], conv.value.conversationId, { body: 'hi' }, at(2));
    if (!sent.ok) throw new Error('send');
    s = sent.value;
    const must = (r: { ok: true; value: SocialState } | { ok: false }) => {
      if (!r.ok) throw new Error('domain refused');
      return r.value;
    };
    const cost = (after: SocialState) => {
      const stats = { membersCompared: 0, rowsScanned: 0, pairEvaluations: 0, keyComputations: 0 };
      noteAudienceChange(w, s, after, stats);
      return stats;
    };
    const zero = { membersCompared: 0, rowsScanned: 0, pairEvaluations: 0, keyComputations: 0 };
    // mutes.set and messages.read: every counter 0
    expect(cost(must(setMute(s, members[0], members[1], { voice: true, messages: true })))).toEqual(zero);
    expect(cost(must(markRead(s, members[1], conv.value.conversationId)))).toEqual(zero);
    // the other O(1) operations: no pair evaluated
    const opened = openDirectConversation(s, members[2], members[3], at(3));
    if (!opened.ok) throw new Error('open');
    const o1: Array<[string, SocialState]> = [
      ['messages.send', must(sendMessage(s, members[1], conv.value.conversationId, { body: 'yo' }, at(3)))],
      ['conversations.open', opened.value.state],
      ['reports.file', must(fileReport(s, members[2], { reportedId: members[3], reason: 'SPAM', note: '', subjectRef: null }, at(3)))],
      ['requests.send', must(sendFriendRequest(s, members[2], members[9], at(3)))],
      ['a tick without a skin change', s],
    ];
    for (const [name, after] of o1) expect(cost(after).pairEvaluations, name).toBe(0);
    // presence.update_self by a member: at most 2 x 31 pairs, members only compared
    const hid = cost(must(updateOwnPresence(s, members[5], { availability: 'APPEAR_OFFLINE' }, at(4))));
    expect(hid.pairEvaluations).toBeLessThanOrEqual(62);
    expect(hid.pairEvaluations).toBeGreaterThan(0);
    expect(hid.membersCompared).toBe(32);
    // blocks.add between two members: at most 4 x 31
    expect(cost(must(blockUser(s, members[10], members[11], at(4)))).pairEvaluations).toBeLessThanOrEqual(124);
    // parties.join into a party of 7: at most 2 x (8 + 1) x 31
    const joined = must(joinPartyRule(s, members[1], 'pty_ctx', at(4)));
    expect(joined.parties.pty_ctx.members.length).toBe(8);
    expect(cost(joined).pairEvaluations).toBeLessThanOrEqual(558);
    // and never a per-player key
    expect([hid.keyComputations, cost(joined).keyComputations]).toEqual([0, 0]);
  });

  it('R22b P9 a viewer who leaves takes its floors with it: no floors map holds it afterwards, as viewer or as subject', () => {
    const g = together();
    reports(g, SAM, tenths(100, 300));
    reports(g, VAL, tenths(110, 310));
    reports(g, WES, tenths(120, 320));
    apply(g, VAL, 'blocks.add', { targetId: SAM }, 330);
    apply(g, VAL, 'blocks.remove', {}, 340, [SAM]);
    apply(g, WES, 'blocks.add', { targetId: VAL }, 345);
    apply(g, WES, 'blocks.remove', {}, 346, [VAL]);
    expect(floorOf(g, SAM, VAL)).toBeDefined();
    expect(floorOf(g, WES, VAL)).toBeDefined();
    expect(floorOf(g, VAL, WES)).toBeDefined();
    apply(g, VAL, 'world.leave', {}, 350);
    const holders = Object.entries(g.w.floors ?? {}).filter(([s, row]) => s === VAL || Object.hasOwn(row, VAL));
    expect(holders).toEqual([]);
    expect(floorOf(g, SAM, WES)).toBeUndefined();
  });
});

/* --------------------------------------------------------------------------------- the touched set covers the filter */

describe('the touched set covers every input of the one decision', () => {
  it('RING-K01 R28 from each of 96 states, every single change that flips positionVisibleTo(Val, Sam) touches Val or Sam', () => {
    const states: { name: string; s: SocialState }[] = [];
    for (const availability of ['AVAILABLE', 'APPEAR_OFFLINE'] as const) {
      for (const presenceVisibility of ['EVERYONE', 'FRIENDS', 'PARTY', 'NOBODY'] as const) {
        for (const friends of [false, true]) {
          for (const party of [false, true]) {
            for (const block of ['none', 'sam>val', 'val>sam'] as const) {
              const g = together();
              if (friends || party) befriend(g, SAM, VAL, 1);
              if (party) joinParty(g, SAM, createParty(g, SAM, 3), VAL, 4);
              if (party && !friends) apply(g, VAL, 'friends.remove', {}, 6, [SAM]);
              apply(g, SAM, 'privacy.update_self', { presenceVisibility }, 7);
              apply(g, SAM, 'presence.update_self', { availability }, 8);
              if (block !== 'none') g.s = { ...g.s, blocks: [...g.s.blocks, block === 'sam>val' ? { blockerId: SAM, blockedId: VAL, sinceIso: at(9) } : { blockerId: VAL, blockedId: SAM, sinceIso: at(9) }] };
              states.push({ name: `${availability}/${presenceVisibility}/f${friends}/p${party}/${block}`, s: g.s });
            }
          }
        }
      }
    }
    expect(states.length).toBe(96);
    // single changes, made as the domain makes them: a new object for whatever changed, everything else shared
    const user = (s: SocialState, id: string, patch: (u: SocialState['users'][string]) => SocialState['users'][string]): SocialState => ({ ...s, users: { ...s.users, [id]: patch(s.users[id]) } });
    const changes: Array<[string, (s: SocialState) => SocialState]> = [
      ['sam availability', (s) => user(s, SAM, (u) => ({ ...u, presence: { ...u.presence, availability: u.presence.availability === 'AVAILABLE' ? 'APPEAR_OFFLINE' : 'AVAILABLE' } }))],
      ...(['EVERYONE', 'FRIENDS', 'PARTY', 'NOBODY'] as const).map((v): [string, (s: SocialState) => SocialState] => [`sam presence ${v}`, (s) => user(s, SAM, (u) => ({ ...u, privacy: { ...u.privacy, presenceVisibility: v } }))]),
      ['val availability', (s) => user(s, VAL, (u) => ({ ...u, presence: { ...u.presence, availability: u.presence.availability === 'AVAILABLE' ? 'APPEAR_OFFLINE' : 'AVAILABLE' } }))],
      ['friendship toggled', (s) => {
        const has = s.friendships.some((f) => (f.userA === SAM && f.userB === VAL) || (f.userA === VAL && f.userB === SAM));
        return { ...s, friendships: has ? s.friendships.filter((f) => !((f.userA === SAM && f.userB === VAL) || (f.userA === VAL && f.userB === SAM))) : [...s.friendships, { userA: SAM, userB: VAL, sinceIso: at(10) }] };
      }],
      ...([[SAM, VAL], [VAL, SAM]] as const).map(([a, b]): [string, (s: SocialState) => SocialState] => [`block ${a}>${b} toggled`, (s) => {
        const has = s.blocks.some((x) => x.blockerId === a && x.blockedId === b);
        return { ...s, blocks: has ? s.blocks.filter((x) => !(x.blockerId === a && x.blockedId === b)) : [...s.blocks, { blockerId: a, blockedId: b, sinceIso: at(10) }] };
      }]),
      ['val party toggled', (s) => {
        const shared = Object.values(s.parties).find((p) => p.members.some((m) => m.userId === SAM) && p.members.some((m) => m.userId === VAL));
        if (shared !== undefined) return { ...s, parties: { ...s.parties, [shared.partyId]: { ...shared, members: shared.members.filter((m) => m.userId !== VAL) } } };
        const party = { partyId: 'pty_k01', name: 'K', leaderId: SAM, privacy: 'INVITE_ONLY' as const, invitePermission: 'LEADER_ONLY' as const, createdAtIso: at(10), version: 1, members: [SAM, VAL].map((userId) => ({ userId, role: userId === SAM ? ('LEADER' as const) : ('MEMBER' as const), joinedAtIso: at(10), selfMuted: false })) };
        return { ...s, parties: { ...s.parties, [party.partyId]: party } };
      }],
      ['sam record removed', (s) => ({ ...s, users: Object.fromEntries(Object.entries(s.users).filter(([id]) => id !== SAM)) })],
    ];
    let flips = 0;
    const misses: string[] = [];
    for (const { name, s } of states) {
      for (const [what, change] of changes) {
        const after = change(s);
        if (positionVisibleTo(s, VAL, SAM) === positionVisibleTo(after, VAL, SAM)) continue;
        flips += 1;
        const touched = touchedPlayers(s, after);
        if (!touched.has(VAL) && !touched.has(SAM)) misses.push(`${name}: ${what}`);
      }
    }
    expect(misses).toEqual([]);
    expect(flips).toBeGreaterThan(50);
  });
});
