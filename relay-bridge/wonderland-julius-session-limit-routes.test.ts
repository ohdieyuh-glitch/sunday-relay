import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import {
  WONDERLAND_JULIUS_NOT_FOUND,
  WONDERLAND_JULIUS_SESSION_MAX_IN_FLIGHT,
  WONDERLAND_JULIUS_SESSION_RATE,
  WONDERLAND_JULIUS_TOO_MANY,
  createWonderlandJuliusSessionLimit,
  handleWonderlandJuliusRoute,
} from './wonderland-julius-routes';
import type {
  WonderlandJuliusReadScope,
  WonderlandJuliusRouteDeps,
  WonderlandJuliusSessionLimit,
  WonderlandJuliusWorld,
} from './wonderland-julius-routes';
import {
  WONDERLAND_JULIUS_WORLD_POOL_MAX,
  withWonderlandJuliusReadOnlyTransaction,
  wonderlandJuliusWorldPoolConfig,
} from './wonderland-julius-world';
import { NATIVE_WORLD_AUDIENCE, createBrowserSessionStore } from './browser-session/grants';
import type { BrowserSessionStore } from './browser-session/grants';
import { createSessionRateLimit } from './wonderland-social-routes';

/**
 * ONE SESSION CANNOT TAKE THE WORLD (row 12; internal engineering X1 for the independent reviewer's LOW JU-348-05).
 *
 * THE POOL HERE IS REAL: `pg`'s own Pool, built from the world pool's production configuration (max 4), over a
 * stand-in Client that connects at once and answers BEGIN / COMMIT / ROLLBACK. So the checkout queue, its FIFO order
 * and its bounded wait (`connectionTimeoutMillis`) are pg-pool's, not a model of them, and every read goes through
 * the world's real transaction wrapper (`withWonderlandJuliusReadOnlyTransaction`). Only the reads inside it are
 * in memory, and a player's reads can be HELD -- the slow store -- so their connection stays checked out.
 *
 * The wait is shortened to WAIT_MS for the suite; production waits WONDERLAND_JULIUS_WORLD_CONNECT_TIMEOUT_MS (5 s,
 * pinned by wonderland-julius-world.test.ts).
 */

const PROJECT = 'project-alpha';
const RUN = 'run-1';
const NOW = 1_757_289_600_000;
const WAIT_MS = 300;

/** A `pg` Client stand-in: connects at once, answers every statement with no rows. Enough for the transaction wrapper. */
class InstantClient extends EventEmitter {
  _queryable = true;
  _ending = false;
  connect(callback: (error?: Error) => void): void {
    setImmediate(() => callback());
  }
  isConnected(): boolean {
    return true;
  }
  query(): Promise<{ rows: never[]; rowCount: number }> {
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  end(callback?: () => void): Promise<void> {
    this._ending = true;
    if (callback !== undefined) setImmediate(callback);
    return Promise.resolve();
  }
}

/** The world over a REAL pg Pool (production max, a short wait); a held player's reads wait for `open()`. */
function heldPoolWorld() {
  const pool = new Pool({
    ...wonderlandJuliusWorldPoolConfig('postgres://world@127.0.0.1:9/never'),
    connectionTimeoutMillis: WAIT_MS,
    Client: InstantClient as never,
  });
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  const held = new Set<string>();
  const reachedBy = new Map<string, number>();
  let transactions = 0;
  const scope = (): WonderlandJuliusReadScope => ({
    membership: {
      lookup: async ({ playerId, projectId }) => {
        reachedBy.set(playerId, (reachedBy.get(playerId) ?? 0) + 1);
        if (held.has(playerId)) await gate;
        return { playerId, projectId, role: 'OWNER' };
      },
    },
    reader: {
      hydrate: async () => null,
      events: async ({ projectId, runId }) => (projectId === PROJECT && runId === RUN ? { rows: [], revision: 0 } : null),
    },
    results: { result: async () => null },
  });
  const world: WonderlandJuliusWorld = {
    read: (work) => withWonderlandJuliusReadOnlyTransaction(pool, () => {
      transactions += 1;
      return work(scope());
    }),
  };
  return {
    pool,
    world,
    hold: (playerId: string) => { held.add(playerId); },
    open: () => open(),
    reached: (playerId: string) => reachedBy.get(playerId) ?? 0,
    transactions: () => transactions,
    /** Connections checked out of the real pool right now. */
    checkedOut: () => pool.totalCount - pool.idleCount,
  };
}

function nativeSession(store: BrowserSessionStore, playerId: string, projectId = PROJECT): string {
  const grant = store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: NOW, scope: 'native_world', participantId: playerId, projectId });
  const redeemed = store.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: NATIVE_WORLD_AUDIENCE, now: NOW });
  if (!redeemed.ok) throw new Error('fixture could not redeem a native grant');
  return redeemed.session.token;
}

type Route = 'hydrate' | 'events' | 'result';

/** One request as the Unreal client sends it: its session, NO Origin. `query` replaces the default one when given. */
const ask = (token: string | null, deps: WonderlandJuliusRouteDeps, route: Route = 'events', query?: string, origin?: string) => {
  const q = query ?? `projectId=${PROJECT}&runId=${RUN}&cursor=0`;
  return handleWonderlandJuliusRoute({
    method: 'GET',
    path: `/wonderland/julius/${route}`,
    url: `/wonderland/julius/${route}?${route === 'events' ? 'mode=page&' : ''}${q}`,
    authorization: token === null ? undefined : `Relay-Session ${token}`,
    origin,
    now: NOW,
  }, deps);
};

/** Resolve once `predicate` holds; fail loudly rather than hang. */
async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const bridgeLimit = (): WonderlandJuliusSessionLimit => createWonderlandJuliusSessionLimit({
  maxInFlight: WONDERLAND_JULIUS_SESSION_MAX_IN_FLIGHT,
  rate: createSessionRateLimit(WONDERLAND_JULIUS_SESSION_RATE.limit, WONDERLAND_JULIUS_SESSION_RATE.windowMs),
});

const TOO_MANY_AFTER = (seconds: number) => ({ status: 429, body: WONDERLAND_JULIUS_TOO_MANY, headers: { 'retry-after': String(seconds) } });

describe('one session cannot take the world pool (JU-348-05), over a REAL pg Pool', () => {
  it('the pool under test is the production one: max = WONDERLAND_JULIUS_WORLD_POOL_MAX (4)', async () => {
    const world = heldPoolWorld();
    try {
      expect(world.pool.options.max).toBe(WONDERLAND_JULIUS_WORLD_POOL_MAX);
      expect(WONDERLAND_JULIUS_WORLD_POOL_MAX).toBe(4);
    } finally {
      await world.pool.end();
    }
  });

  it('CONTROL -- WITHOUT a limit, ONE session firing 6 reads holds all 4 connections and ANOTHER session is starved: 503 after the wait', async () => {
    const store = createBrowserSessionStore();
    const flooder = nativeSession(store, 'player-a');
    const other = nativeSession(store, 'player-b');
    const world = heldPoolWorld();
    world.hold('player-a');
    const deps: WonderlandJuliusRouteDeps = { sessions: store, world: world.world };
    try {
      const flood = Array.from({ length: 6 }, () => ask(flooder, deps));
      await until(() => world.reached('player-a') === 4, 'the flood to hold all four connections');
      expect(world.checkedOut()).toBe(4);
      const started = Date.now();
      const answer = await ask(other, deps);
      // STARVED: it waited the pool's whole bound for a connection one session was holding, and got none.
      expect(answer?.status).toBe(503);
      expect(Date.now() - started).toBeGreaterThanOrEqual(WAIT_MS - 25);
      expect(world.reached('player-b')).toBe(0);
      world.open();
      const statuses = (await Promise.all(flood)).map((one) => one?.status);
      expect(statuses.filter((status) => status === 200)).toHaveLength(4);
      expect(statuses.filter((status) => status === 503)).toHaveLength(2);
    } finally {
      world.open();
      await world.pool.end();
    }
  });

  it('WITH the bridge\'s limit, the same flood holds only 2 connections, the rest are 429 at once, and the other session is SERVED while the flood still holds', async () => {
    const store = createBrowserSessionStore();
    const flooder = nativeSession(store, 'player-a');
    const other = nativeSession(store, 'player-b');
    const world = heldPoolWorld();
    world.hold('player-a');
    const deps: WonderlandJuliusRouteDeps = { sessions: store, world: world.world, sessionLimit: bridgeLimit() };
    try {
      const flood = Array.from({ length: 6 }, () => ask(flooder, deps));
      await until(() => world.reached('player-a') >= 2, 'the flood to reach the store');
      const answer = await ask(other, deps);
      expect(answer?.status).toBe(200);
      // The flood still holds -- the other session did not wait for it -- and it never held more than its share.
      expect(world.reached('player-a')).toBe(WONDERLAND_JULIUS_SESSION_MAX_IN_FLIGHT);
      world.open();
      const answers = await Promise.all(flood);
      expect(answers.map((one) => one?.status).sort()).toEqual([200, 200, 429, 429, 429, 429]);
      for (const refused of answers.filter((one) => one?.status === 429)) expect(refused).toEqual(TOO_MANY_AFTER(1));
      // A refused request opened no transaction: 2 for the flood, 1 for the other session.
      expect(world.transactions()).toBe(3);
    } finally {
      world.open();
      await world.pool.end();
    }
  });

  it('MANY sessions together can still fill the pool -- and a newcomer then waits a BOUNDED time, gets 503, and is served once a slot frees', async () => {
    const store = createBrowserSessionStore();
    const a = nativeSession(store, 'player-a');
    const b = nativeSession(store, 'player-b');
    const newcomer = nativeSession(store, 'player-c');
    const world = heldPoolWorld();
    world.hold('player-a');
    world.hold('player-b');
    const deps: WonderlandJuliusRouteDeps = { sessions: store, world: world.world, sessionLimit: bridgeLimit() };
    try {
      const holding = [ask(a, deps), ask(a, deps), ask(b, deps), ask(b, deps)];
      await until(() => world.checkedOut() === 4, 'two sessions to fill the pool');
      const started = Date.now();
      const first = await ask(newcomer, deps);
      const waited = Date.now() - started;
      // Not starved forever: the pool's own bound, then the world's ordinary "cannot answer now".
      expect(first?.status).toBe(503);
      expect(waited).toBeGreaterThanOrEqual(WAIT_MS - 25);
      expect(waited).toBeLessThan(WAIT_MS * 10);
      world.open();
      expect((await Promise.all(holding)).map((one) => one?.status)).toEqual([200, 200, 200, 200]);
      // ...and the newcomer's 503 gave its slot back: asked again, it is served.
      expect((await ask(newcomer, deps))?.status).toBe(200);
    } finally {
      world.open();
      await world.pool.end();
    }
  });
});

/* ------------------------------------------------- uniformity: a 429 is no oracle */

/** An in-memory world counting the transactions it opens; `members` decides membership; it can be made to fail. */
function countingWorld(options: { readonly members?: readonly string[]; readonly fail?: () => boolean } = {}) {
  let opened = 0;
  const world: WonderlandJuliusWorld = {
    read: async (work) => {
      opened += 1;
      if (options.fail?.() === true) throw Object.assign(new Error('store down'), { code: '08006' });
      return work({
        membership: {
          lookup: async ({ playerId, projectId }) =>
            (options.members ?? ['player-a']).includes(playerId) ? { playerId, projectId, role: 'OWNER' } : null,
        },
        reader: {
          hydrate: async () => null,
          events: async ({ projectId, runId }) => (projectId === PROJECT && runId === RUN ? { rows: [], revision: 0 } : null),
        },
        results: { result: async () => null },
      });
    },
  };
  return { world, opened: () => opened };
}

/** What a caller can ask: its own run, an absent run, another project's, a malformed query, a malformed cursor. */
const ASKS: ReadonlyArray<readonly [string, string]> = [
  ['its own run', `projectId=${PROJECT}&runId=${RUN}&cursor=0`],
  ['an absent run', `projectId=${PROJECT}&runId=run:ffffffff&cursor=0`],
  ['another project\'s run', `projectId=project-beta&runId=${RUN}&cursor=0`],
  ['no run at all', `projectId=${PROJECT}&cursor=0`],
  ['a cursor that is no position', `projectId=${PROJECT}&runId=${RUN}&cursor=0x10`],
];

describe('a 429 says nothing about what was asked (the JU-348 uniformity, kept)', () => {
  it('OVER THE RATE: every route, every ask -- own, absent, foreign, malformed -- gets the byte-identical 429, and no transaction opens', async () => {
    const store = createBrowserSessionStore();
    const token = nativeSession(store, 'player-a');
    const counting = countingWorld();
    // The session is over its rate: the window says when it may ask again (4.2 s, said as 5).
    const limit = createWonderlandJuliusSessionLimit({ maxInFlight: 2, rate: () => ({ ok: false, retryAfterMs: 4_200 }) });
    const lines: string[] = [];
    const deps: WonderlandJuliusRouteDeps = { sessions: store, world: counting.world, sessionLimit: limit, log: (line) => lines.push(line) };
    const seen = new Set<string>();
    for (const route of ['hydrate', 'events', 'result'] as const) {
      for (const [, query] of ASKS) seen.add(JSON.stringify(await ask(token, deps, route, query)));
    }
    expect([...seen]).toEqual([JSON.stringify(TOO_MANY_AFTER(5))]);
    expect(counting.opened()).toBe(0);
    // NOT LOGGED, as the social routes' 429s are not: a session asking too fast would otherwise write the log for it.
    expect(lines).toEqual([]);
  });

  it('OVER THE IN-FLIGHT BOUND: the same -- one byte-identical 429 for every ask while the session\'s two slots are held', async () => {
    const store = createBrowserSessionStore();
    const token = nativeSession(store, 'player-a');
    const counting = countingWorld();
    const limit = bridgeLimit();
    const deps: WonderlandJuliusRouteDeps = { sessions: store, world: counting.world, sessionLimit: limit };
    // The session's two slots, held by the bridge for two requests still being answered.
    const sessionId = store.verifyNativeSession({ token, now: NOW });
    if (!sessionId.ok) throw new Error('fixture session did not verify');
    const one = limit.admit(sessionId.sessionId, NOW);
    const two = limit.admit(sessionId.sessionId, NOW);
    if (!one.ok || !two.ok) throw new Error('fixture: the two slots should be free');
    const seen = new Set<string>();
    for (const route of ['hydrate', 'events', 'result'] as const) {
      for (const [, query] of ASKS) seen.add(JSON.stringify(await ask(token, deps, route, query)));
    }
    expect([...seen]).toEqual([JSON.stringify(TOO_MANY_AFTER(1))]);
    expect(counting.opened()).toBe(0);
    one.release();
    two.release();
  });

  it('CONTROL -- under the limit the same asks get their usual answers (200 / 400 / the one 404), and the 404s stay byte-identical', async () => {
    const store = createBrowserSessionStore();
    const member = nativeSession(store, 'player-a');
    const stranger = nativeSession(store, 'player-z');
    const counting = countingWorld();
    const deps: WonderlandJuliusRouteDeps = { sessions: store, world: counting.world, sessionLimit: bridgeLimit() };
    // ONE AT A TIME, as the client asks: five at once would be over the in-flight bound, and rightly refused.
    const answers: Array<Awaited<ReturnType<typeof ask>>> = [];
    for (const [, query] of ASKS) answers.push(await ask(member, deps, 'events', query));
    expect(answers.map((one) => one?.status)).toEqual([200, 404, 404, 400, 400]);
    const notMember = await ask(stranger, deps);
    expect(notMember?.status).toBe(404);
    const notFound = new Set([answers[1], answers[2], notMember].map((one) => JSON.stringify(one)));
    expect([...notFound]).toEqual([JSON.stringify({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND })]);
  });

  it('the limit is asked only for an identified native session: no session is 401, an Origin or the operator is the one 404 -- as before, the limit untouched', async () => {
    const store = createBrowserSessionStore();
    const token = nativeSession(store, 'player-a');
    let asked = 0;
    const limit = createWonderlandJuliusSessionLimit({ maxInFlight: 1, rate: () => { asked += 1; return { ok: false, retryAfterMs: 1_000 }; } });
    const operator = 'operator-secret-for-tests-0123456789abcdef';
    const deps: WonderlandJuliusRouteDeps = { sessions: store, world: countingWorld().world, sessionLimit: limit, operatorToken: operator };
    expect((await ask(null, deps))?.status).toBe(401);
    expect(await ask(token, deps, 'events', undefined, 'https://sunday-relay.vercel.app')).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
    const asOperator = await handleWonderlandJuliusRoute({
      method: 'GET', path: '/wonderland/julius/events', url: `/wonderland/julius/events?mode=page&projectId=${PROJECT}&runId=${RUN}`,
      authorization: `Bearer ${operator}`, origin: undefined, now: NOW,
    }, deps);
    expect(asOperator).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
    expect(asked).toBe(0);
  });

  it('a slot is given back after EVERY outcome -- 200, 400, the one 404, and 503 when the store fails -- so a session never locks itself out', async () => {
    const store = createBrowserSessionStore();
    const token = nativeSession(store, 'player-a');
    let failing = false;
    const counting = countingWorld({ fail: () => failing });
    // ONE slot: any outcome that kept it would refuse the next request with 429.
    const limit = createWonderlandJuliusSessionLimit({ maxInFlight: 1, rate: () => ({ ok: true }) });
    const deps: WonderlandJuliusRouteDeps = { sessions: store, world: counting.world, sessionLimit: limit };
    const outcomes: Array<number | undefined> = [];
    for (const [, query] of ASKS) outcomes.push((await ask(token, deps, 'events', query))?.status);
    outcomes.push((await ask(token, { ...deps, world: null }))?.status);
    failing = true;
    outcomes.push((await ask(token, deps))?.status);
    failing = false;
    outcomes.push((await ask(token, deps))?.status);
    expect(outcomes).toEqual([200, 404, 404, 400, 400, 503, 503, 200]);
  });
});
