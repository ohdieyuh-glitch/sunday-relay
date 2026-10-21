import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createInMemorySocialStore } from '../social/social-store';
import { emptyStats, fakeFkPool, nbHistory, niPair, REPLAY_T0, type ReplayStats } from './world-trail-replay-harness';
import { openSocialPostgresStore } from './social-postgres';

/*
 * THE TRANSPORT RING'S RULED INVARIANTS (d63c15 P2-5; TRANSPORT_RING_DESIGN_T1_v2.md c72f1ea8 section 1.3), brute force, without a
 * database: through the in-memory store, the pure function, and the PostgreSQL store on a fake pool that refuses (23503) a write
 * naming a player whose row was deleted behind it. The real-PostgreSQL runs are world-trail-replay.real-postgres.test.ts.
 *
 * RING_REPLAY_SCALE (default 1) scales the seed counts down for the mutation runner's repeated runs; the design's sizes are scale 1.
 */

const SCALE = Math.max(0.01, Math.min(1, Number(process.env.RING_REPLAY_SCALE ?? '1') || 1));
const n = (count: number) => Math.max(5, Math.round(count * SCALE));
const iso = new Date(REPLAY_T0).toISOString();

const memory = async (initial: Parameters<typeof createInMemorySocialStore>[0]) => ({ store: createInMemorySocialStore(initial), initial: initial ?? (await createInMemorySocialStore().read()) });
const pure = async (initial: Parameters<typeof createInMemorySocialStore>[0]) => ({ store: null, initial: initial ?? (await createInMemorySocialStore().read()) });
const postgresOnFakePool = async (_initial: unknown, players: readonly string[]) => {
  const db = fakeFkPool();
  const store = await openSocialPostgresStore(db.pool);
  for (const id of players) await store.ensureUser({ userId: id, displayName: id, handle: `@${id}` }, iso);
  return { store, initial: await store.read(), deleteRow: db.deleteRow, restoreRow: db.restoreRow };
};

/** RING_REPLAY_STATS=<file>: each run's counters are appended there (the R27 / R27b statistics the reviewer asks for). */
const report = (name: string, stats: ReplayStats) => {
  const file = process.env.RING_REPLAY_STATS;
  if (file !== undefined && file !== '') appendFileSync(file, `${name} ${JSON.stringify(stats)}
`);
};

describe('R27 (NB) no back-fill, brute force against an oracle that reads only the adopted state', () => {
  it(`R27 in memory: ${n(2000)} seeded histories x 200 ops through the in-memory store, opened on carried-in data (two parties, a blocked pair inside a party, a ghost member)`, async () => {
    const stats = emptyStats();
    const violations: string[] = [];
    for (let seed = 1; seed <= n(2000) && violations.length < 5; seed += 1) await nbHistory(seed, { ops: 200, makeStore: memory, midHistoryCarriedIn: false, failedCommit: false, openings: 'kick' }, stats, violations);
    report('R27-memory', stats);
    expect(violations).toEqual([]);
    expect(stats.served).toBeGreaterThan(n(2000) * 5);
    expect(stats.storeAnswers).toBeGreaterThan(n(2000) * 200);
    expect(stats.ringlessViewerAnswers).toBeGreaterThan(0);
  }, 600_000);

  it(`R27 pure with carried-in data in mid-history: ${n(1000)} seeded histories x 200 ops; third parties' reads reconcile it`, async () => {
    const stats = emptyStats();
    const violations: string[] = [];
    for (let seed = 1; seed <= n(1000) && violations.length < 5; seed += 1) await nbHistory(100_000 + seed, { ops: 200, makeStore: pure, midHistoryCarriedIn: true, failedCommit: false, openings: 'all' }, stats, violations);
    report('R27-pure-midhistory', stats);
    expect(violations).toEqual([]);
    expect(stats.served).toBeGreaterThan(n(1000) * 5);
    expect(stats.reconcilesThatMovedState).toBeGreaterThan(0);
  }, 600_000);

  it(`R27 through the PostgreSQL store (fake pool): ${n(60)} seeded histories x 120 ops, each with a durable write refused (a row deleted behind the store) that adopts nothing, and its retry`, async () => {
    const stats = emptyStats();
    const violations: string[] = [];
    for (let seed = 1; seed <= n(60) && violations.length < 5; seed += 1) await nbHistory(200_000 + seed, { ops: 120, makeStore: postgresOnFakePool, midHistoryCarriedIn: false, failedCommit: true, openings: 'none' }, stats, violations);
    report('R27-postgres-fake', stats);
    expect(violations).toEqual([]);
    expect(stats.failedCommits).toBeGreaterThanOrEqual(n(60));
    expect(stats.retriesAdopted).toBeGreaterThanOrEqual(n(60));
    expect(stats.served).toBeGreaterThan(0);
  }, 600_000);
});

describe("R27b (NI) non-interference: a hidden third party's ops, and a subject's acts toward others, change nothing in V's answers", () => {
  it(`R27b in memory: ${n(1000)} seeds, with and without the third party, through the in-memory store; V's answers byte for byte`, async () => {
    const stats = emptyStats();
    const violations: string[] = [];
    for (let seed = 1; seed <= n(1000) && violations.length < 5; seed += 1) await niPair(seed, { ops: 120, makeStore: memory }, stats, violations);
    report('R27b-memory', stats);
    expect(violations).toEqual([]);
    expect(stats.comparedAnswers).toBeGreaterThan(n(1000) * 20);
    expect(stats.thirdPartyOps).toBeGreaterThan(n(1000) * 20);
    expect(stats.discarded).toBeLessThan(n(1000) / 2);
  }, 600_000);

  it(`R27b through the PostgreSQL store (fake pool): ${n(40)} seeds; V's answers byte for byte`, async () => {
    const stats = emptyStats();
    const violations: string[] = [];
    for (let seed = 1; seed <= n(40) && violations.length < 5; seed += 1) await niPair(300_000 + seed, { ops: 120, makeStore: postgresOnFakePool }, stats, violations);
    report('R27b-postgres-fake', stats);
    expect(violations).toEqual([]);
    expect(stats.comparedAnswers).toBeGreaterThan(n(40) * 20);
  }, 600_000);
});
