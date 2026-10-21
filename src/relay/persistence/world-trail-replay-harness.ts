/**
 * THE TRANSPORT RING'S RULED INVARIANTS AS BRUTE-FORCE REPLAYS (TEST HELPER; the reviewer's signed T1 ruling d63c15, P2-5 / Q13;
 * TRANSPORT_RING_DESIGN_T1_v2.md c72f1ea8 section 1.3). Used by world-trail-replay.test.ts (in memory, and the PostgreSQL store on a
 * fake pool) and world-trail-replay.real-postgres.test.ts (real PostgreSQL). Never imported by the server.
 *
 * (NB) NO BACK-FILL. If the answer of o_q gives V, under figure S, an entry from S's report stored by o_p, then Ent_t(V,S) for every t
 *      in [p,q] in the same context c; neither V nor S joined, left, moved, was removed or was swept in [p,q]; S's figure is in the
 *      answer under today's rule at Σq; the entry is exactly the stored report's {x,y,z,yaw,speed,motion} with ageMs = asOfMs_q -
 *      reportedAt_p; and nowMs_q - 2000 < reportedAt_p < the figure's reportedAtMs.
 * (NI) NON-INTERFERENCE. Two histories that differ only in ops which, in both, leave Ent(V,.) and V's membership unchanged at every
 *      step: with equal arrival times, V's answers are byte-identical.
 *
 * THE ORACLE NEVER READS THE IMPLEMENTATION'S RING STATE. After every op it takes the state the store ADOPTED (Σt; Σt = Σt-1 for an
 * op that failed or whose commit failed) and computes Ent_t(V,S) from it directly: V != S, no block either way in Σt.blocks, not
 * presenceHiddenFrom(Σt, V, S) (cbe584be's function), and both members of one context in Wt.contexts. Membership events come from the
 * op stream and Wt.contexts. A stored report is read from today's avatar (Wt.avatars[S] replaced, reportedAtMs = the op's nowMs).
 * Today's rule for the figure is the cursor-less worldViewFor -- cbe584be's bytes, the golden oracle of R01. Never a trail, a floor,
 * an epoch, a serial number or the touched set (R28 checks the touched set separately, at every step).
 *
 * THROUGH THE STORE. Every op runs on the store AND on a pure replay (applySocialOperation on the state the test carries). Every store
 * answer must equal the pure one byte for byte; a store refusal of an op the pure function accepted (a failed commit) adopts nothing
 * on either side, and the store's state must then equal the pure one. The oracle checks the pure states, which are the store's.
 */

import type { Pool } from 'pg';

import { applySocialOperation } from '../social/social-commands';
import { reconcileBlockedParties } from '../social/social-parties';
import type { SocialOperationId } from '../social/social-contracts';
import { emptySocialState, presenceHiddenFrom, type SocialState } from '../social/social-state';
import { ensureSocialUser, type SocialStore } from '../social/social-store';
import { emptyWorldState, noteAudienceChange, touchedPlayers, worldViewFor, type WorldState, type WorldView } from '../social/world-presence';

export const REPLAY_T0 = Date.parse('2026-10-21T12:00:00.000Z');
const at = (ms: number) => new Date(REPLAY_T0 + ms).toISOString();
const MAX_AGE_MS = 2_000;
const TRAIL_KEYS = 'ageMs,motion,speed,x,y,yaw,z';

/** A small deterministic PRNG (mulberry32): every history replays exactly. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------------------------------------ the oracle's own view */

const memberOf = (w: WorldState, id: string): string | undefined => Object.values(w.contexts).find((c) => c.memberIds.includes(id))?.contextId;
const blockedEither = (s: SocialState, a: string, b: string) => s.blocks.some((x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a));
/** Ent_t(V,S) in context c, from the state alone (the ruling's definition). */
function entitled(s: SocialState, w: WorldState, v: string, sub: string, context: string | undefined): boolean {
  return context !== undefined && v !== sub && !blockedEither(s, v, sub) && !presenceHiddenFrom(s, v, sub) && memberOf(w, v) === context && memberOf(w, sub) === context;
}
/** A world answer with the ring's two additions taken out. */
function withoutRing(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRing);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => k !== 'asOfMs' && k !== 'trail').map(([k, v]) => [k, withoutRing(v)]));
  return value;
}

/* ------------------------------------------------------------------------------------------------------ stats */

export interface ReplayStats {
  histories: number;
  ops: number;
  views: number;
  served: number;
  storeAnswers: number;
  failedCommits: number;
  retriesAdopted: number;
  reconcilesThatMovedState: number;
  ringlessViewerAnswers: number;
  discarded: number;
  comparedAnswers: number;
  thirdPartyOps: number;
}

export const emptyStats = (): ReplayStats => ({
  histories: 0, ops: 0, views: 0, served: 0, storeAnswers: 0, failedCommits: 0, retriesAdopted: 0, reconcilesThatMovedState: 0,
  ringlessViewerAnswers: 0, discarded: 0, comparedAnswers: 0, thirdPartyOps: 0,
});

/* ---------------------------------------------------------------------------------------------- the store under test */

export interface StoreUnderTest {
  readonly store: SocialStore | null;
  /** The FK technique (PGT:341): delete the player's row behind the store, so the next durable write naming them is refused. */
  readonly deleteRow?: (id: string) => Promise<void>;
  readonly restoreRow?: (id: string) => Promise<void>;
}

/** A fake pool that plays an ordinary database and REFUSES (SQLSTATE 23503) any write naming a player whose row was deleted. */
export function fakeFkPool(): { pool: Pool; deleteRow: (id: string) => Promise<void>; restoreRow: (id: string) => Promise<void> } {
  const deleted = new Set<string>();
  const query = async (sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
    if (sql.includes('shobj_description')) return { rows: [{ c: null }], rowCount: 1 };
    if (sql === 'SELECT current_database() AS db') return { rows: [{ db: 'railway' }], rowCount: 1 };
    if (sql.includes('pg_control_system()')) return { rows: [{ sid: '7000000000000000001' }], rowCount: 1 };
    if (/^\s*(INSERT|UPDATE)/i.test(sql) && params.some((p) => typeof p === 'string' && deleted.has(p))) {
      throw Object.assign(new Error('insert or update violates foreign key constraint'), { code: '23503' });
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, deleteRow: async (id) => { deleted.add(id); }, restoreRow: async (id) => { deleted.delete(id); } };
}

/* ------------------------------------------------------------------------------------------------------ one replay */

interface Step {
  readonly s: SocialState;
  readonly w: WorldState;
  readonly stay: ReadonlyMap<string, number | null>;
}

interface StoredReport {
  readonly t: number;
  readonly at: number;
  readonly context: string;
  readonly fields: string;
}

export class Replay {
  s: SocialState;
  w: WorldState = emptyWorldState();
  readonly history: Step[] = [];
  readonly stored = new Map<string, StoredReport[]>();
  readonly violations: string[];

  constructor(readonly players: readonly string[], initial: SocialState, private readonly sut: StoreUnderTest, private readonly stats: ReplayStats, violations: string[]) {
    this.s = initial;
    this.violations = violations;
    this.history.push({ s: this.s, w: this.w, stay: new Map(players.map((p) => [p, null])) });
  }

  /** One operation, as the store runs it; returns whether it was adopted, and the answer. */
  async run(actor: string, op: SocialOperationId, body: Record<string, unknown>, ms: number, ids: string[] = [], query: Record<string, string> = {}): Promise<{ ok: boolean; data: unknown }> {
    this.stats.ops += 1;
    const iso = at(ms);
    const input = { ids, body, query };
    const hasActor = Object.hasOwn(this.s.users, actor);
    const pure = hasActor ? applySocialOperation(this.s, op, actor, input, iso, this.w) : null;
    let adopt = pure !== null && pure.ok;
    const store = this.sut.store;
    if (store !== null) {
      const answered = await store.apply(op, actor, input, iso);
      this.stats.storeAnswers += 1;
      if (answered.ok) {
        if (pure === null || !pure.ok || JSON.stringify(answered.value) !== JSON.stringify(pure.value.data)) this.violations.push(`${op} by ${actor} at ${ms}: the store's answer differs from the pure one`);
      } else if (pure !== null && pure.ok) {
        // a durable write the store refused (a failed commit): NOTHING is adopted, on either side
        adopt = false;
        this.stats.failedCommits += 1;
        if (JSON.stringify(await store.read()) !== JSON.stringify(this.s)) this.violations.push(`${op} by ${actor} at ${ms}: a refused write moved the store's state`);
      }
    }
    if (adopt && reconcileBlockedParties(this.s) !== this.s) this.stats.reconcilesThatMovedState += 1;
    const before = this.history[this.history.length - 1];
    if (adopt && pure !== null && pure.ok) {
      this.s = pure.value.state;
      if (pure.value.world !== undefined) this.w = pure.value.world;
    }
    this.record(before, actor, op, body, adopt, ms);
    return { ok: adopt, data: adopt && pure !== null && pure.ok ? pure.value.data : null };
  }

  /** A social change made outside any operation (carried-in data), adopted as every adoption is: through the pair gate. */
  adopt(next: SocialState): void {
    const before = this.history[this.history.length - 1];
    this.w = noteAudienceChange(this.w, this.s, next);
    this.s = next;
    this.record(before, '', 'snapshot.read', {}, false, 0);
  }

  private record(before: Step, actor: string, op: SocialOperationId, body: Record<string, unknown>, ran: boolean, ms: number): void {
    const t = this.history.length;
    const stay = new Map<string, number | null>();
    for (const p of this.players) {
      const now = memberOf(this.w, p);
      const was = memberOf(before.w, p);
      // a join op that is not today's no-op (PUBLIC to the place the player is already in, WP:202) begins a new stay
      const place = typeof body.place === 'string' ? body.place : 'golden_arrival';
      const noop = op === 'world.join' && body.target === 'PUBLIC' && was !== undefined && was.startsWith(`pub_${place}_`);
      const joined = ran && op === 'world.join' && actor === p && !noop;
      const prev = before.stay.get(p) ?? null;
      stay.set(p, now === undefined ? null : was !== now || joined || prev === null ? t : prev);
      // a stored report: today's avatar replaced, stamped with this op's own time
      const a = this.w.avatars[p];
      if (ran && op === 'world.state' && actor === p && a !== undefined && a !== before.w.avatars[p] && a.reportedAtMs === REPLAY_T0 + ms) {
        const list = this.stored.get(p) ?? [];
        list.push({ t, at: a.reportedAtMs, context: a.contextId, fields: JSON.stringify([a.x, a.y, a.z, a.yaw, a.speed, a.motion]) });
        this.stored.set(p, list);
      }
    }
    this.history.push({ s: this.s, w: this.w, stay });
    // R28, brute force: every pair whose answer (without the context) changed has a touched end
    if (before.s !== this.s) {
      const touched = touchedPlayers(before.s, this.s);
      const ok = (s: SocialState, v: string, sub: string) => !blockedEither(s, v, sub) && !presenceHiddenFrom(s, v, sub);
      for (const v of this.players) for (const sub of this.players) {
        if (v !== sub && ok(before.s, v, sub) !== ok(this.s, v, sub) && !touched.has(v) && !touched.has(sub)) this.violations.push(`step ${t}: whether ${v} may see ${sub} changed, and neither was touched`);
      }
    }
  }

  /** NB, for one answer of V's op at the last step. */
  checkNoBackfill(viewer: string, answer: WorldView, nowMs: number): void {
    const q = this.history.length - 1;
    const hq = this.history[q];
    const json = JSON.stringify(answer);
    for (const k of ['"seq":', '"floors":', '"joinedSeq":', '"trails":']) if (json.includes(k)) this.violations.push(`q=${q}: ${viewer}'s answer carries ${k}`);
    // today's rule, at Σq: everything but the ring's two additions is the cursor-less view, byte for byte
    if (JSON.stringify(withoutRing(answer)) !== JSON.stringify(worldViewFor(hq.w, hq.s, viewer, nowMs))) this.violations.push(`q=${q}: ${viewer}'s answer is not today's view plus the ring`);
    if (answer.asOfMs === undefined) return;
    if (this.history[q - 1].w.trails?.[viewer] === undefined) this.stats.ringlessViewerAnswers += 1;
    const asOf = answer.asOfMs;
    for (const fig of answer.avatars) {
      const sub = fig.userId;
      for (const p of fig.trail ?? []) {
        this.stats.served += 1;
        if (Object.keys(p).sort().join(',') !== TRAIL_KEYS) this.violations.push(`q=${q}: a trail entry with keys ${Object.keys(p).sort().join(',')}`);
        // o_p: found by reportedAt_p = asOfMs_q - ageMs (exact); the latest such report stored up to q
        const reportedAt = asOf - p.ageMs;
        const r = [...(this.stored.get(sub) ?? [])].reverse().find((x) => x.at === reportedAt && x.t <= q);
        if (r === undefined) {
          this.violations.push(`q=${q}: ${viewer} served ${sub}@${reportedAt}, which no op stored`);
          continue;
        }
        if (r.fields !== JSON.stringify([p.x, p.y, p.z, p.yaw, p.speed, p.motion])) this.violations.push(`q=${q}: ${viewer} served ${sub}@${reportedAt} with other values than stored`);
        if (!(nowMs - MAX_AGE_MS < r.at && r.at < fig.reportedAtMs)) this.violations.push(`q=${q}: ${sub}@${reportedAt} outside (now - 2 s, the figure's report)`);
        const sv = this.history[r.t].stay.get(viewer);
        const ss = this.history[r.t].stay.get(sub);
        for (let t = r.t; t <= q; t += 1) {
          const h = this.history[t];
          if (!entitled(h.s, h.w, viewer, sub, r.context)) {
            this.violations.push(`q=${q}: ${viewer} served ${sub}@${reportedAt} stored at ${r.t}, but not entitled at ${t}`);
            break;
          }
          if (h.stay.get(viewer) !== sv || h.stay.get(sub) !== ss) {
            this.violations.push(`q=${q}: ${viewer} served ${sub}@${reportedAt} stored at ${r.t}, across a join, leave, move, removal or sweep at ${t}`);
            break;
          }
        }
      }
    }
  }

  /** Ent(V,.) and V's membership now: the NI premise's vector. */
  entVector(v: string): string {
    const c = memberOf(this.w, v);
    return JSON.stringify([c ?? null, this.players.map((x) => (x !== v && entitled(this.s, this.w, v, x, c) ? 1 : 0))]);
  }
}

/* --------------------------------------------------------------------------------------------- the histories (NB) */

export interface NbOptions {
  readonly ops: number;
  readonly makeStore: (initial: SocialState, players: readonly string[]) => Promise<StoreUnderTest & { readonly initial: SocialState }>;
  /** Pure-only runs may inject carried-in data in mid-history (a store reads it only at open, while the world is empty). */
  readonly midHistoryCarriedIn: boolean;
  /** At least one failed commit per history (the FK technique), when the store can delete a row. */
  readonly failedCommit: boolean;
  /**
   * Scripted openings on a share of the seeds, so the random histories reach the ruling's two back-fill shapes (v2 sections 2-3):
   * 'kick' -- a RING-LESS viewer's first party switches to one holding a PARTY-audience subject by a kick (P2-1; needs the carried-in
   * two-party data, so a store that opens on it, or the pure replay); 'all' adds the same switch by a third party's reconciling read,
   * and a reconciliation inside the viewer's OWN world.state that widens (P2-2) -- both need a block injected in mid-history (pure).
   */
  readonly openings: 'none' | 'kick' | 'all';
  readonly prefix?: string;
}

/** The carried-in data a store opens on: a player (b) listed in two parties -- a's first by insertion order, and c's, which holds d,
 *  whose presence audience is PARTY -- a persisting shape (nothing reconciles it); a blocked pair inside a shared party (f has
 *  blocked e, its leader: reconciled by the very first operation); and a party member with no user record. */
export function carriedIn(players: readonly string[]): SocialState {
  let s = emptySocialState();
  for (const id of players) s = ensureSocialUser(s, { userId: id, displayName: id, handle: `@${id}` }, at(0));
  const member = (userId: string, leader: boolean) => ({ userId, role: leader ? ('LEADER' as const) : ('MEMBER' as const), joinedAtIso: at(0), selfMuted: false });
  const party = (id: string, leader: string, others: string[]) => ({ partyId: id, name: id, leaderId: leader, members: [member(leader, true), ...others.map((o) => member(o, false))], privacy: 'INVITE_ONLY' as const, invitePermission: 'LEADER_ONLY' as const, createdAtIso: at(0), version: 1 });
  const [a, b, c, d, e, f] = players;
  const dUser = s.users[d];
  return {
    ...s,
    users: { ...s.users, [d]: { ...dUser, privacy: { ...dUser.privacy, presenceVisibility: 'PARTY' } } },
    parties: { pty_one: party('pty_one', a, [b]), pty_two: party('pty_two', c, [d, b, `${a}_ghost`]), pty_three: party('pty_three', e, [f]) },
    friendships: [{ userA: a, userB: b, sinceIso: at(0) }, { userA: c, userB: d, sinceIso: at(0) }],
    blocks: [{ blockerId: f, blockedId: e, sinceIso: at(0) }],
  };
}

export async function nbHistory(seed: number, opts: NbOptions, stats: ReplayStats, violations: string[]): Promise<void> {
  const rnd = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const prefix = opts.prefix ?? '';
  const P = Array.from({ length: 6 }, (_, i) => `usr_${prefix}p${i}`);
  const made = await opts.makeStore(carriedIn(P), P);
  const r = new Replay(P, made.initial, made, stats, violations);
  stats.histories += 1;
  for (const id of P) await r.run(id, 'presence.update_self', { connected: true }, 1);
  const opening = opts.openings === 'none' ? 0 : opts.openings === 'kick' ? (seed % 6 === 1 ? 1 : 0) : (seed % 6 >= 1 && seed % 6 <= 3 ? seed % 6 : 0);
  for (const id of P) await r.run(id, 'world.join', { target: 'PUBLIC', place: rnd() < 0.6 || opening > 0 ? 'alpha' : 'beta' }, 2);
  const lastAsOf = new Map<string, number>();
  const view = async (who: string, ms: number, sinceMs: string) => {
    const res = await r.run(who, 'world.state', { x: 1, y: 2, z: 1, yaw: 0, speed: 0, motion: 'IDLE', skinId: 'shadow_flame' }, ms, [], { sinceMs });
    if (!res.ok) return;
    stats.views += 1;
    const answer = res.data as WorldView;
    if (answer.asOfMs !== undefined) lastAsOf.set(who, answer.asOfMs);
    r.checkNoBackfill(who, answer, REPLAY_T0 + ms);
  };
  if (opening > 0) {
    // the carried-in shape: b (P[1]) is listed in a's party (P[0], first) and in c's (P[2]), which holds d (P[3], audience PARTY)
    const [a, b, , d, e] = P;
    if (opening === 3) await view(b, 1000, '0');   // b holds a cursor (and a ring) before the change in its own op
    for (const ms of [1100, 1200, 1300]) await r.run(d, 'world.state', { x: ms, y: ms, z: 1, yaw: 0, speed: 100, motion: 'RUN', skinId: 'shadow_flame' }, ms);
    if (opening === 1) await r.run(a, 'parties.remove_member', {}, 1350, ['pty_one', b]);   // the kick: b's first party is now c's
    else r.adopt({ ...r.s, blocks: [...r.s.blocks, { blockerId: b, blockedId: a, sinceIso: at(1340) }] });   // carried-in: b blocked a
    if (opening === 2) await r.run(e, 'snapshot.read', {}, 1350);   // a third party's read reconciles: b leaves a's party
    // b's view: under the reconciliation inside its OWN op (opening 3), or after the switch (1, 2)
    await view(b, 1400, opening === 3 ? String(lastAsOf.get(b) ?? 0) : '0');
  }
  let base = 1000 + (opening > 0 ? 500 : 0);
  const failAt = opts.failedCommit ? 5 + Math.floor(rnd() * (opts.ops - 10)) : -1;
  for (let step = 0; step < opts.ops; step += 1) {
    base += 40 + Math.floor(rnd() * 80);
    if (rnd() < 0.01) base += 16_000;   // a clock jump past the stale window: the next join sweeps
    const ms = base + Math.floor(rnd() * 300) - 150;   // request times out of order with execution
    const actor = pick(P);
    const other = pick(P.filter((p) => p !== actor));
    const w3 = pick(P.filter((p) => p !== actor && p !== other));
    const report = (who: string, query: Record<string, string> = {}) =>
      r.run(who, 'world.state', { x: Math.floor(rnd() * 1000), y: Math.floor(rnd() * 1000), z: 1, yaw: Math.floor(rnd() * 360), speed: 100, motion: pick(['RUN', 'WALK', 'JUMP', 'FALL']), skinId: 'shadow_flame' }, ms, [], query);
    if (step === failAt && made.deleteRow !== undefined && made.restoreRow !== undefined) {
      // THE FK TECHNIQUE: the target's row deleted behind the store; the actor's block of them is a durable write the database refuses
      // (a target who leads no party: social_parties.leader_id does not cascade, so PostgreSQL would refuse the row's deletion itself)
      const pair = P.flatMap((a) => P.map((b) => [a, b] as const)).find(([a, b]) => a !== b && Object.hasOwn(r.s.users, a) && Object.hasOwn(r.s.users, b) && !r.s.blocks.some((x) => x.blockerId === a && x.blockedId === b) && !Object.values(r.s.parties).some((x) => x.leaderId === b));
      if (pair !== undefined) {
        const [blocker, target] = pair;
        const failedBefore = stats.failedCommits;
        await made.deleteRow(target);
        const refused = await r.run(blocker, 'blocks.add', { targetId: target, confirmSharedParty: true }, ms);
        if (refused.ok || stats.failedCommits !== failedBefore + 1) violations.push(`seed ${seed}: the refused write was not refused, or not counted`);
        await made.restoreRow(target);
        if ((await r.run(blocker, 'blocks.add', { targetId: target, confirmSharedParty: true }, ms + 1)).ok) stats.retriesAdopted += 1;
        else violations.push(`seed ${seed}: the retry after the row was restored did not adopt`);
      }
      continue;
    }
    const roll = rnd();
    if (roll < 0.33) {
      await report(actor);
    } else if (roll < 0.55) {
      const kind = rnd();
      const last = lastAsOf.get(actor);
      const sinceMs = kind < 0.3 ? '0' : kind < 0.6 && last !== undefined ? String(last) : kind < 0.75 ? String(REPLAY_T0 + ms - Math.floor(rnd() * 3000)) : kind < 0.85 ? String(REPLAY_T0 + ms + 5000) : kind < 0.93 ? pick(['-5', '1.5', '1e3', 'abc']) : '';
      const res = await report(actor, sinceMs === '' ? {} : { sinceMs });
      if (res.ok) {
        stats.views += 1;
        const answer = res.data as WorldView;
        if (answer.asOfMs !== undefined) lastAsOf.set(actor, answer.asOfMs);
        r.checkNoBackfill(actor, answer, REPLAY_T0 + ms);
      }
    } else if (roll < 0.6) {
      const target = pick(['PUBLIC', 'PUBLIC', 'PRIVATE', 'FRIEND', 'INVITE', 'PARTY']);
      if (target === 'INVITE') {
        const inv = await r.run(other, 'world.invite', { toUserId: actor }, ms);
        if (inv.ok) await r.run(actor, 'world.join', { target: 'INVITE', inviteId: (inv.data as { inviteId: string }).inviteId }, ms);
      } else {
        await r.run(actor, 'world.join', target === 'PUBLIC' ? { target, place: pick(['alpha', 'beta']) } : target === 'PRIVATE' ? { target, name: 'Home' } : target === 'FRIEND' ? { target, userId: other } : { target }, ms);
      }
    } else if (roll < 0.62) {
      await r.run(actor, 'world.leave', {}, ms);
    } else if (roll < 0.66) {
      await r.run(actor, 'blocks.add', { targetId: other, confirmSharedParty: true }, ms);   // inside a private server: a removal
    } else if (roll < 0.69) {
      await r.run(actor, 'blocks.remove', {}, ms, [other]);
    } else if (roll < 0.73) {
      if ((await r.run(actor, 'requests.send', { toUserId: other }, ms)).ok) {
        const req = r.s.requests.find((x) => x.fromUserId === actor && x.toUserId === other && x.status === 'PENDING');
        if (req !== undefined) await r.run(other, 'requests.accept', {}, ms, [req.requestId]);
      }
    } else if (roll < 0.75) {
      await r.run(actor, 'friends.remove', {}, ms, [other]);
    } else if (roll < 0.82) {
      const mine = Object.values(r.s.parties).find((p) => p.members.some((m) => m.userId === actor));
      const k = rnd();
      if (mine === undefined) {
        if (k < 0.5) await r.run(actor, 'parties.create', { name: 'P' }, ms);
        else {
          const theirs = Object.values(r.s.parties).find((p) => p.members.some((m) => m.userId === other));
          if (theirs !== undefined) await r.run(actor, 'parties.join', {}, ms, [theirs.partyId]);
        }
      } else if (k < 0.25) await r.run(actor, 'parties.leave', {}, ms, [mine.partyId]);
      else if (k < 0.45 && mine.leaderId === actor) {
        const victim = mine.members.find((m) => m.userId !== actor);
        if (victim !== undefined) await r.run(actor, 'parties.remove_member', {}, ms, [mine.partyId, victim.userId]);   // a kick
      } else if (k < 0.6 && mine.leaderId === actor) await r.run(actor, 'parties.rules', { privacy: 'OPEN_TO_FRIENDS' }, ms, [mine.partyId]);
      else {
        const inv = await r.run(actor, 'parties.invite', { toUserId: other }, ms, [mine.partyId]);
        if (inv.ok) await r.run(other, 'party_invites.accept', {}, ms, [(inv.data as { inviteId: string }).inviteId]);
      }
    } else if (roll < 0.87) {
      await r.run(actor, 'privacy.update_self', { presenceVisibility: pick(['EVERYONE', 'FRIENDS', 'PARTY', 'NOBODY']) }, ms);
    } else if (roll < 0.9) {
      await r.run(actor, 'presence.update_self', { availability: pick(['AVAILABLE', 'APPEAR_OFFLINE']) }, ms);
    } else if (roll < 0.93) {
      // THE LEASE: a lapse ends presence through the sign-out path (endSocialPresence: presence false, then the leave); a call back
      // restores it ({connected:true}, RT:625-627)
      if (rnd() < 0.5) {
        await r.run(actor, 'presence.update_self', { connected: false }, ms);
        await r.run(actor, 'world.leave', {}, ms);
      } else {
        await r.run(actor, 'presence.update_self', { connected: true }, ms);
      }
    } else if (roll < 0.96) {
      // a THIRD party's read, which reconciles first
      const party = Object.values(r.s.parties)[0];
      if (rnd() < 0.5 || party === undefined) await r.run(w3, 'snapshot.read', {}, ms);
      else await r.run(w3, 'parties.read', {}, ms, [party.partyId]);
    } else if (opts.midHistoryCarriedIn) {
      const c = rnd();
      if (c < 0.25 && Object.hasOwn(r.s.users, actor)) r.adopt({ ...r.s, users: Object.fromEntries(Object.entries(r.s.users).filter(([id]) => id !== actor)) });   // a record removed
      else if (c < 0.4) {
        const back = ensureSocialUser(r.s, { userId: actor, displayName: actor, handle: `@${actor}` }, at(ms));   // ...and created again
        if (back !== r.s) r.adopt(back);
      } else if (c < 0.7) {
        const party = Object.values(r.s.parties).find((p) => !p.members.some((m) => m.userId === actor));   // listed in a second party
        if (party !== undefined) r.adopt({ ...r.s, parties: { ...r.s.parties, [party.partyId]: { ...party, members: [...party.members, { ...party.members[0], userId: actor, role: 'MEMBER' }] } } });
      } else r.adopt({ ...r.s, blocks: [...r.s.blocks, { blockerId: actor, blockedId: other, sinceIso: at(ms) }] });   // maybe inside a party
    } else {
      await r.run(w3, 'snapshot.read', {}, ms);
    }
  }
}

/* --------------------------------------------------------------------------------------------- the histories (NI) */

interface NiOp {
  readonly who: 'base' | 'third';
  readonly actor: string;
  readonly kind: string;
  readonly other: string;
  readonly ms: number;
  readonly pick: number;
}

export interface NiOptions {
  readonly ops: number;
  readonly makeStore: (initial: SocialState, players: readonly string[]) => Promise<StoreUnderTest & { readonly initial: SocialState }>;
  readonly prefix?: string;
}

/**
 * R27b: history H (the shared ops), and H' = H plus a THIRD party's ops -- a hidden player arriving, reporting, acting toward others
 * and leaving, and S acting toward W != V. Every op of H keeps its arrival time. The premise is CHECKED: in both histories, after
 * every shared op, Ent(V,.) and V's membership are the same, and no added op moves them; a candidate that breaks it is discarded and
 * counted. Otherwise V's answers in H and H' must be byte-identical.
 */
export async function niPair(seed: number, opts: NiOptions, stats: ReplayStats, violations: string[]): Promise<void> {
  const prefix = opts.prefix ?? '';
  const V = `usr_${prefix}v`;
  const H = `usr_${prefix}h`;
  const BASE = [1, 2, 3].map((i) => `usr_${prefix}q${i}`);
  const ALL = [V, ...BASE, H];
  // the op lists, fixed before either history runs (ids are resolved by meaning at execution time)
  const rnd = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const ops: NiOp[] = [];
  let base = 1000;
  for (let i = 0; i < opts.ops; i += 1) {
    base += 60 + Math.floor(rnd() * 60);
    if (rnd() < 0.45) {
      // the hidden player does anything; a subject S only acts toward some W != V (its own reports would legitimately move V's view)
      const s = pick(BASE);
      const hidden = rnd() < 0.6;
      ops.push({
        who: 'third',
        actor: hidden ? H : s,
        kind: hidden ? pick(['report', 'report', 'join', 'leave', 'block', 'unblock', 'friend', 'unfriend', 'party', 'read']) : pick(['block', 'unblock', 'friend', 'unfriend', 'party']),
        other: pick(BASE.filter((b) => b !== s)),
        ms: base - 5,
        pick: rnd(),
      });
    }
    const actor = pick([V, V, ...BASE]);
    ops.push({ who: 'base', actor, kind: pick(['view', 'view', 'report', 'report', 'join', 'block', 'unblock', 'privacy', 'availability', 'friend', 'read']), other: pick([V, ...BASE].filter((p) => p !== actor)), ms: base, pick: rnd() });
  }
  const runHistory = async (withThird: boolean) => {
    const local: string[] = [];
    let s = emptySocialState();
    for (const id of ALL) s = ensureSocialUser(s, { userId: id, displayName: id, handle: `@${id}` }, at(0));
    const made = await opts.makeStore(s, ALL);
    const r = new Replay(ALL, made.initial, made, stats, local);
    for (const id of ALL) await r.run(id, 'presence.update_self', { connected: true }, 1);
    await r.run(H, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }, 1);   // hidden from everyone, in both histories
    for (const id of [V, ...BASE]) await r.run(id, 'world.join', { target: 'PUBLIC', place: 'alpha' }, 2);
    const answers: string[] = [];
    const vectors: string[] = [];
    let premiseBroken = false;
    let since: number | undefined;
    for (const o of ops) {
      if (o.who === 'third' && !withThird) continue;
      const before = o.who === 'third' ? r.entVector(V) : '';
      const k = o.pick;
      const ms = o.ms;
      switch (o.kind) {
        case 'view': {
          const res = await r.run(V, 'world.state', { x: 1, y: Math.floor(k * 1000), z: 1, yaw: 0, speed: 0, motion: 'IDLE', skinId: 'shadow_flame' }, ms, [], { sinceMs: String(since ?? 0) });
          const answer = res.data as WorldView | null;
          if (answer?.asOfMs !== undefined) since = answer.asOfMs;
          answers.push(JSON.stringify([res.ok, res.data]));
          break;
        }
        case 'report':
          await r.run(o.actor, 'world.state', { x: Math.floor(k * 1000), y: Math.floor(k * 777), z: 1, yaw: 0, speed: 100, motion: 'RUN', skinId: 'shadow_flame' }, ms);
          break;
        case 'join':
          await r.run(o.actor, 'world.join', k < 0.5 ? { target: 'PUBLIC', place: k < 0.3 ? 'alpha' : 'beta' } : { target: 'PRIVATE', name: 'Den' }, ms);
          break;
        case 'leave':
          await r.run(o.actor, 'world.leave', {}, ms);
          break;
        case 'block':
          await r.run(o.actor, 'blocks.add', { targetId: o.other, confirmSharedParty: true }, ms);
          break;
        case 'unblock':
          await r.run(o.actor, 'blocks.remove', {}, ms, [o.other]);
          break;
        case 'friend':
          if ((await r.run(o.actor, 'requests.send', { toUserId: o.other }, ms)).ok) {
            const req = r.s.requests.find((x) => x.fromUserId === o.actor && x.toUserId === o.other && x.status === 'PENDING');
            if (req !== undefined) await r.run(o.other, 'requests.accept', {}, ms, [req.requestId]);
          }
          break;
        case 'unfriend':
          await r.run(o.actor, 'friends.remove', {}, ms, [o.other]);
          break;
        case 'party': {
          const mine = Object.values(r.s.parties).find((p) => p.members.some((m) => m.userId === o.actor));
          if (mine === undefined) await r.run(o.actor, 'parties.create', { name: 'P' }, ms);
          else {
            const inv = await r.run(o.actor, 'parties.invite', { toUserId: o.other }, ms, [mine.partyId]);
            if (inv.ok) await r.run(o.other, 'party_invites.accept', {}, ms, [(inv.data as { inviteId: string }).inviteId]);
          }
          break;
        }
        case 'privacy':
          await r.run(o.actor, 'privacy.update_self', { presenceVisibility: k < 0.5 ? 'EVERYONE' : k < 0.8 ? 'FRIENDS' : 'NOBODY' }, ms);
          break;
        case 'availability':
          await r.run(o.actor, 'presence.update_self', { availability: k < 0.8 ? 'AVAILABLE' : 'APPEAR_OFFLINE' }, ms);
          break;
        case 'read': {
          const res = await r.run(o.actor === V ? V : o.actor, o.actor === V ? 'world.read' : 'snapshot.read', {}, ms);
          if (o.actor === V) answers.push(JSON.stringify([res.ok, res.data]));
          break;
        }
      }
      if (o.who === 'third') {
        stats.thirdPartyOps += 1;
        if (r.entVector(V) !== before) premiseBroken = true;   // an added op moved Ent(V,.) or V's membership
      } else {
        vectors.push(r.entVector(V));
      }
    }
    violations.push(...local.map((v) => `seed ${seed} (third=${withThird}): ${v}`));
    return { answers, vectors, premiseBroken };
  };
  const h = await runHistory(false);
  const h2 = await runHistory(true);
  stats.histories += 2;
  if (h2.premiseBroken || JSON.stringify(h.vectors) !== JSON.stringify(h2.vectors)) {
    stats.discarded += 1;   // the premise does not hold for this candidate: not an NI case
    return;
  }
  stats.comparedAnswers += h.answers.length;
  if (JSON.stringify(h.answers) !== JSON.stringify(h2.answers)) {
    const i = h.answers.findIndex((a, k) => a !== h2.answers[k]);
    violations.push(`seed ${seed}: V's answer ${i} differs with the third party's ops`);
  }
}
