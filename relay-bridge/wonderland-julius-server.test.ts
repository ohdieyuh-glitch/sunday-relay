import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBridgeServer } from './server';
import { NATIVE_WORLD_AUDIENCE, createBrowserSessionStore } from './browser-session/grants';
import type { BrowserSessionStore } from './browser-session/grants';
import { wonderlandJuliusDatabaseUrl, wonderlandJuliusWorld } from './wonderland-julius-world';
import type { WonderlandJuliusWorld } from './wonderland-julius-routes';
import { loadBridgeConfig } from './config';
import { betaWaveZeroState } from './beta-routes';
import { createBetaEnrolmentStore } from '../src/relay/persistence';
import { juliusRuntimeDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import type { JuliusMissionResultView } from '../src/relay/mission/julius/julius-runtime-api';

/**
 * THE WORLD ROUTES OVER THE REAL BRIDGE, WITH NO DATABASE.
 *
 * The route's own suite proves it answers 503 when its world is absent. This
 * proves the COMPOSITION ROOT still leaves it absent when there is nothing to
 * build it from -- which is the half that a wiring change breaks and the route's
 * own tests cannot see -- and that, wired, the whole cloud-side path answers a
 * player over real HTTP with every read inside one read-only transaction.
 *
 * The failure it exists to prevent: half-wiring. A bridge that could check
 * membership but not read, or read but not check membership, is a route with
 * one of its two guarantees, and the second is the one that matters.
 */

const ORIGIN = 'https://sunday-relay.vercel.app';
const OPERATOR = 'operator-secret-for-tests-0123456789abcdef';

const realFetch = globalThis.fetch.bind(globalThis);
const servers: Array<{ close: (cb: () => void) => void }> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function boot(databaseUrl: string | null, world: WonderlandJuliusWorld | null = null, sessions: BrowserSessionStore | null = null): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'relay-julius-world-'));
  roots.push(root);
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('RELAY_DATA_DIR', root);
  // The runtime reads JULIUS_DATABASE_URL first: blank it, so DATABASE_URL alone decides here.
  vi.stubEnv('JULIUS_DATABASE_URL', '');
  vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
  const server = createBridgeServer(
    loadBridgeConfig(process.env),
    {
      start: () => ({ state: 'ready' }) as never,
      get: () => ({ state: 'ready', missionId: 'm' }) as never,
      cancel: () => undefined,
      retry: () => undefined,
    } as never,
    null, null, null, null,
    () => false,
    createBetaEnrolmentStore({ root }),
    [{ wave: 'wave_0', state: betaWaveZeroState(process.env), seats: 100 }],
    // betaLimiter, liveReachService, repositoryStore, brainStore,
    // wonderlandBackend -- then the injected world, and the session store (null: the bridge builds its own).
    null, null, null, null, null, world, sessions,
  );
  servers.push(server as never);
  await new Promise<void>((r) =>
    (server as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
  const address = (server as never as { address: () => { port: number } | null }).address();
  return `http://127.0.0.1:${address === null ? 0 : address.port}`;
}

const get = (base: string, path: string, headers: Record<string, string> = {}) =>
  realFetch(`${base}${path}`, { headers: { Origin: ORIGIN, ...headers } });

/** A GET as the Unreal world sends it (WonderlandJuliusStream.cpp NewRequest): its session, and NO Origin. */
const getNative = (base: string, path: string, token: string) =>
  realFetch(`${base}${path}`, { headers: { Authorization: `Relay-Session ${token}` } });

/**
 * A real NATIVE world session, minted in the store the bridge is then booted with. The world routes are
 * native-only (internal review N5), and over HTTP only pairing mints one -- which needs a membership database --
 * so the store is the one the server is given, and the session is minted exactly as pairing mints it.
 */
function nativeSession(store: BrowserSessionStore, playerId = 'player-1', projectId = 'project-alpha'): string {
  const grant = store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: Date.now(), scope: 'native_world', participantId: playerId, projectId });
  const redeemed = store.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: NATIVE_WORLD_AUDIENCE, now: Date.now() });
  if (!redeemed.ok) throw new Error('fixture could not redeem a native grant');
  return redeemed.session.token;
}

const QUERY = 'projectId=project-alpha&runId=run-1';
/** The query each route is sent with: the events route serves pages only. */
const queryFor = (route: string) => (route === 'events' ? `${QUERY}&mode=page` : QUERY);
const ROUTES = ['hydrate', 'events', 'result'] as const;

/**
 * A real BROWSER session, minted the way production does: the operator pairs a
 * grant bound to a player, the browser redeems it from the approved origin.
 *
 * The world routes no longer admit one (native-only, internal review N5); it is
 * kept to prove that a non-GET with a signed-in browser still reaches the
 * Wonderland family exactly as before, and that a browser is refused.
 */
async function pairSession(base: string, playerId: string): Promise<string> {
  const minted = await realFetch(`${base}/relay-api/browser/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${OPERATOR}` },
    // `control` is the only browser scope that binds a PLAYER to the grant, and
    // the world routes need a player -- a read-only session carries no
    // participant id, and is the wrong kind of session for them.
    body: JSON.stringify({ origin: ORIGIN, scope: 'control', participantId: playerId }),
  });
  const grant = (await minted.json()).data as { grantId: string; grantSecret: string };
  const exchanged = await realFetch(`${base}/relay-api/browser/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(grant),
  });
  return ((await exchanged.json()).data as { sessionToken: string }).sessionToken;
}

describe('an authenticated world request on an unconfigured bridge', () => {
  for (const route of ROUTES) {
    it(`answers 503 on /wonderland/julius/${route}, not a denial`, async () => {
      // THE FAIL-CLOSED PROPERTY, reached with a real session so it is the
      // deployment being refused rather than the caller. 503 and not 404: the
      // request may have been perfectly authorised and this deployment could
      // not check, and reporting that as a denial sends an operator hunting
      // permissions that were never the issue.
      const store = createBrowserSessionStore();
      const base = await boot(null, null, store);
      const res = await getNative(base, `/relay-api/wonderland/julius/${route}?${queryFor(route)}`, nativeSession(store));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).not.toBe('permission denied');
      expect(JSON.stringify(body)).not.toContain('project-alpha');
    }, 30_000);
  }

  it('says WHY it is 503 in the operator\'s log -- world_not_configured -- with no database, and with a URL that would weaken the world pool (internal review A2)', async () => {
    // The composition root's guard (resolveJuliusWorld: no pool, no world) is what this pins. Without it the route is
    // handed a world over NO pool; its read throws inside the route's own try, and the catch ALSO answers 503 -- as
    // store_unavailable. The status cannot tell the two apart; the line the route writes can.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const url of [null, 'postgres://127.0.0.1:1/never?options=-c%20default_transaction_read_only%3Doff']) {
        warn.mockClear();
        const store = createBrowserSessionStore();
        const base = await boot(url, null, store);
        for (const route of ROUTES) {
          const res = await getNative(base, `/relay-api/wonderland/julius/${route}?${queryFor(route)}`, nativeSession(store));
          expect(res.status, `${route} ${String(url)}`).toBe(503);
        }
        const lines = warn.mock.calls.map((call) => String(call[0]));
        expect(lines.filter((line) => line.includes('wonderland julius')), String(url)).toEqual(ROUTES.map((route) =>
          `[relay-bridge] wonderland julius ${route}: 503 world_not_configured player=player-1 project=project-alpha run=run-1`));
        expect(lines.join('\n'), String(url)).not.toContain('store_unavailable');
        if (url !== null) {
          // The refused URL is named by its KEY, once per attempt to build the pool -- never by its value.
          expect(lines.filter((line) => line.includes('julius world pool refused'))[0])
            .toBe('[relay-bridge] julius world pool refused: the database URL sets options, which would replace the world\'s read-only session settings');
          expect(lines.join('\n')).not.toContain('127.0.0.1:1');
        }
      }
    } finally {
      warn.mockRestore();
    }
  }, 30_000);

  it('does not open up merely because a database exists', async () => {
    // With DATABASE_URL set, the world is built and the route reaches its
    // read-only transaction -- against a database that cannot be reached. That
    // is an authority that could not answer, which is 503 and never a grant.
    const store = createBrowserSessionStore();
    const base = await boot('postgres://127.0.0.1:1/never', null, store);
    const res = await getNative(base, `/relay-api/wonderland/julius/events?${queryFor('events')}`, nativeSession(store));
    expect(res.status).toBe(503);
    expect((await res.json()).error).not.toBe('permission denied');
  }, 30_000);
});

describe('the world routes over the real bridge', () => {
  for (const route of ROUTES) {
    it(`dispatches /wonderland/julius/${route} in front of the battle routes`, async () => {
      // `isWonderlandRoute` claims the whole `/wonderland/` prefix, so these
      // are dispatched ahead of it. A regression that reordered them would
      // answer the family's own refusal instead of reaching the route at all.
      const base = await boot(null);
      const res = await get(base, `/relay-api/wonderland/julius/${route}?${queryFor(route)}`);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }, 30_000);
  }

  it('routes GET only: any other method on these paths reaches the Wonderland family exactly as before', async () => {
    // What main answered before the routes existed, unchanged: the family's
    // 401 for no session, and its own 404 for a path it does not serve.
    const base = await boot(null);
    const token = await pairSession(base, 'player-1');
    for (const route of ROUTES) {
      const anonymous = await realFetch(`${base}/relay-api/wonderland/julius/${route}?${queryFor(route)}`, {
        method: 'POST', headers: { Origin: ORIGIN, 'content-type': 'application/json' }, body: '{}',
      });
      expect(anonymous.status, route).toBe(401);
      const signedIn = await realFetch(`${base}/relay-api/wonderland/julius/${route}?${queryFor(route)}`, {
        method: 'POST', headers: { Origin: ORIGIN, 'content-type': 'application/json', Authorization: `Relay-Session ${token}` }, body: '{}',
      });
      expect(signedIn.status, route).toBe(404);
      expect(await signedIn.json(), route).toEqual({ error: 'Wonderland route not found' });
    }
  }, 30_000);

  it('identifies the caller before it reads the query: anonymous and malformed is 401, identified and malformed 400 (review N1)', async () => {
    const store = createBrowserSessionStore();
    const base = await boot('postgres://127.0.0.1:1/never', null, store);
    const anonymous = await get(base, '/relay-api/wonderland/julius/events?projectId=&runId=&mode=page');
    expect(anonymous.status).toBe(401);
    const identified = await getNative(base, '/relay-api/wonderland/julius/events?projectId=&runId=&mode=page', nativeSession(store));
    expect(identified.status).toBe(400);
  }, 30_000);

  it('validates the session INDEPENDENTLY of whether an authority exists', async () => {
    // The property: session and origin checking does not depend on the
    // membership authority being configured. An unauthenticated caller gets the
    // same 401 whether or not this deployment could have answered -- so the
    // response never reveals which deployments are wired for world reads.
    for (const url of [null, 'postgres://127.0.0.1:1/never']) {
      const base = await boot(url);
      const res = await get(base, `/relay-api/wonderland/julius/events?${queryFor('events')}`);
      expect(res.status, `DATABASE_URL ${url === null ? 'absent' : 'present'}`).toBe(401);
      expect(await res.text()).not.toContain('permission denied');
    }
  }, 30_000);

  it('the operator credential is not a player: the one 404, configured or not', async () => {
    for (const url of [null, 'postgres://127.0.0.1:1/never']) {
      const base = await boot(url);
      for (const route of ROUTES) {
        for (const origin of [undefined, ORIGIN]) {
          const res = await realFetch(`${base}/relay-api/wonderland/julius/${route}?${queryFor(route)}`, {
            headers: { Authorization: `Bearer ${OPERATOR}`, ...(origin === undefined ? {} : { Origin: origin }) },
          });
          expect(res.status, `${route} ${String(origin)}`).toBe(404);
          expect(await res.json()).toEqual({ error: 'permission denied' });
        }
      }
    }
  }, 30_000);

  it('issues no query for a request it refuses first', async () => {
    // `new Pool` does not connect -- `pg` connects on the first query -- and the
    // route refuses an unauthenticated caller before it opens its transaction.
    // So a connection string pointing nowhere still answers immediately; if any
    // read happened first, this would stall on a refused TCP connect or come
    // back 503.
    const base = await boot('postgres://127.0.0.1:1/never');
    const started = Date.now();
    const res = await get(base, `/relay-api/wonderland/julius/events?${queryFor('events')}`);
    expect(res.status).toBe(401);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 30_000);

  it('says nothing about the project or the run in any refusal', async () => {
    // Whatever the reason, the body must not confirm that this project or this
    // run exists -- the routes are not a membership oracle and not an existence
    // one either.
    for (const url of [null, 'postgres://127.0.0.1:1/never']) {
      const base = await boot(url);
      for (const route of ROUTES) {
        const body = await (await get(base, `/relay-api/wonderland/julius/${route}?${queryFor(route)}`)).text();
        expect(body).not.toContain('project-alpha');
        expect(body).not.toContain('run-1');
      }
    }
  }, 30_000);
});

describe('which deployments can serve a world at all', () => {
  it('treats a blank DATABASE_URL exactly as an absent one', () => {
    // Otherwise a deployment that set the variable and left it empty would get
    // a pool, and the honest "this deployment is not configured" would become a
    // connection error on first use.
    for (const blank of [undefined, '', '   ', '\t\n']) {
      expect(wonderlandJuliusDatabaseUrl({ DATABASE_URL: blank })).toBeNull();
    }
  });

  it('carries a real URL through unchanged', () => {
    const url = 'postgres://host:5432/db';
    expect(wonderlandJuliusDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  });

  it('reads nothing but the two variables the Julius runtime reads', () => {
    expect(wonderlandJuliusDatabaseUrl({ PGHOST: 'host', PGDATABASE: 'db' })).toBeNull();
  });

  it('reads the runs WHERE JULIUS WRITES THEM, even when the two variables differ', () => {
    // The split this guards: the runtime reads JULIUS_DATABASE_URL first. A world
    // reader that read DATABASE_URL alone would follow runs in one database while
    // Julius created them in another -- every hydrate a run_not_found, or another
    // database's runs on screen.
    const julius = 'postgres://host:5432/julius_runtime';
    const other = 'postgres://elsewhere:5432/something_else';
    expect(wonderlandJuliusDatabaseUrl({ JULIUS_DATABASE_URL: julius, DATABASE_URL: other })).toBe(julius);
    for (const env of [
      { JULIUS_DATABASE_URL: julius, DATABASE_URL: other },
      { JULIUS_DATABASE_URL: '  ', DATABASE_URL: other },
      { DATABASE_URL: other },
      { JULIUS_DATABASE_URL: julius },
      {},
    ]) {
      expect(wonderlandJuliusDatabaseUrl(env)).toBe(juliusRuntimeDatabaseUrl(env));
    }
  });
});

/* ----------------------------------------------- a pool that answers like pg */

interface FakeRows {
  readonly run?: Record<string, unknown> | null;
  readonly events?: readonly Record<string, unknown>[];
  readonly member?: boolean;
  readonly citation?: Record<string, unknown> | null;
}

/**
 * A pool whose clients answer the world's statements the way Postgres would,
 * and record every statement and every connection. A statement arrives as text
 * (the transaction's own BEGIN / COMMIT) or as a query config (every read: the
 * world's facade sends each one on the extended protocol, review M1).
 */
function fakePool(rows: FakeRows) {
  const statements: string[] = [];
  let connections = 0;
  let released = 0;
  const answer = async (input: string | { readonly text: string }) => {
    const sql = typeof input === 'string' ? input : input.text;
    statements.push(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes('project_members')) {
      return { rows: rows.member === false ? [] : [{ role: 'OWNER' }], rowCount: 1 };
    }
    // THE CITATION READ IS MATCHED FIRST, and by a table nothing else names.
    // It JOINs `julius_runs r` and it uses a LEFT JOIN LATERAL, so both of
    // the broader matchers below would swallow it -- and answering the wrong
    // statement proves something about a statement nobody issued.
    if (sql.includes('julius_context_snapshots')) {
      const citation = rows.citation ?? null;
      return { rows: citation === null ? [] : [citation], rowCount: citation === null ? 0 : 1 };
    }
    if (sql.includes('LEFT JOIN LATERAL')) {
      // The run drives the page: no run row, no rows at all; a run with an empty page, one row of nulls.
      if (rows.run === null || rows.run === undefined) return { rows: [], rowCount: 0 };
      const events = rows.events ?? [];
      return { rows: events.length > 0 ? events : [{ revision: rows.run.version, event_id: null, stream_id: null, project_id: null, sequence: null, event_type: null, payload: null, occurred_at: null }], rowCount: 1 };
    }
    if (sql.includes('julius_runs r')) {
      return { rows: rows.run === null || rows.run === undefined ? [] : [rows.run], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = {
    connect: async () => {
      connections += 1;
      return { query: answer, release: () => { released += 1; } };
    },
  };
  return { pool, statements, connections: () => connections, released: () => released };
}

describe('the world reads, in one read-only transaction per request', () => {
  it('composes membership, the reader AND Julius\'s result -- never one without the others', async () => {
    // The half-wired state this forbids is invisible from outside: a bridge
    // with membership and no reader answers 503 exactly like an unwired one, so
    // no request can tell them apart -- and that is the state somebody later
    // "fixes" by relaxing the reader check instead of supplying a reader.
    const fake = fakePool({ run: null });
    const keys = await wonderlandJuliusWorld(fake.pool as never).read(async (scope) => Object.keys(scope).sort());
    expect(keys).toEqual(['membership', 'reader', 'results']);
  });

  it('gives all of them the SAME connection, inside one READ ONLY transaction', async () => {
    // A membership answer and the read it authorises must come from one
    // database and one snapshot. Two pools would be two connection strings
    // waiting to disagree; two transactions, two moments.
    const fake = fakePool({ run: null });
    await wonderlandJuliusWorld(fake.pool as never).read(async (scope) => {
      await scope.membership.lookup({ playerId: 'p', projectId: 'q' });
      await scope.reader.events({ projectId: 'q', runId: 'r', afterSequence: 0, limit: 1 });
    });
    expect(fake.connections()).toBe(1);
    expect(fake.released()).toBe(1);
    expect(fake.statements.length).toBe(4);
    expect(fake.statements[0]).toMatch(/^BEGIN\b.*\bREAD ONLY\b/u);
    expect(fake.statements[1]).toContain('project_members');
    expect(fake.statements[2]).toContain('julius_runs');
    expect(fake.statements[3]).toBe('COMMIT');
  });
});

/* ------------------------------------------ the whole route, over HTTP */

const worldOver = (rows: FakeRows, result?: JuliusMissionResultView) => {
  const fake = fakePool(rows);
  const world = wonderlandJuliusWorld(fake.pool as never, result === undefined ? {} : {
    // Julius's own API, answering one run: what the result route reads through.
    composeApi: () => ({
      inspectResult: async (_identity, runId) => (runId === result.runId
        ? { ok: true as const, value: result }
        : { ok: false as const, reason: 'run_not_found' as const, safeMessage: 'No such run in this project.' }),
      inspectSlots: async () => ({ ok: true as const, value: [] }),
      timeline: async (_identity, runId) => ({ ok: true as const, value: { runId, entries: [], nextCursor: 0, gapDetected: false, hasMore: false } }),
    }),
  });
  return { world, fake };
};

const RUN_ROW = {
  state: 'EXECUTING', version: '7', mission_id: 'mission-1', card_revision: 'card:v3',
  at_sequence: '42', active_tasks: '1', pending_approvals: '1',
  // ONE OPEN GATE, the shape `json_agg` really hands back. A person is being
  // waited on, and the count beside it agrees because both come from the same
  // statement.
  open_gates: [{
    gate_id: 'appr-1', task_id: 'task-1', operation: 'MUTATE_FILESYSTEM',
    reason_code: 'CARD_APPROVAL_REQUIRED', requested_at: '2026-09-08T00:00:00.000Z',
  }],
  observed_at: '2026-09-08T00:00:00.000Z',
};

/** One context compilation, spelled the way `pg` hands the columns over. */
const CITATION_ROW = {
  task_id: 'task-1', project_brain_revision: '12', content_hash: 'sha256:6f1e',
  character_count: '4096', redaction_count: '2', truncated: true,
  created_at: '2026-09-08T00:00:00.000Z',
  kinds: ['DECISION', 'FINDING', 'DECISION', 'RESEARCH_NOTE'],
};

describe('a fully wired bridge serves a world', () => {
  it('hydrates a member, end to end over HTTP', async () => {
    // THE WHOLE CLOUD-SIDE PATH IN ONE PROCESS: a real browser session, the real
    // server, the real authorisation, the real reader inside the real read-only
    // transaction, over real HTTP. Only the database is a stub, and it answers
    // the shapes `pg` actually returns.
    const { world, fake } = worldOver({ run: RUN_ROW, citation: CITATION_ROW });
    const store = createBrowserSessionStore();
    const base = await boot(null, world, store);
    const token = nativeSession(store);
    const res = await getNative(base, `/relay-api/wonderland/julius/hydrate?${QUERY}`, token);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    const hydration = body.data as {
      run: { revision: number; atSequence: number; state: string; pendingApprovals: number | null };
      card: { hasCodingAgent: boolean | null; swarmEligible: boolean | null };
      visualState: string;
      terminal: boolean;
      brain: { entryCount: number; contentHash: string; kindCounts: Record<string, number> };
      humanGates: { gateId: string; operation: string; taskId: string | null }[];
    };
    expect(hydration.run.revision).toBe(7);
    expect(hydration.run.atSequence).toBe(42);
    expect(hydration.run.state).toBe('EXECUTING');

    // THE DRAWABLE STATE CROSSES, so a world hydrating cold has something to
    // draw without mapping thirteen kernel words itself.
    expect(hydration.visualState).toBe('coding');
    expect(hydration.terminal).toBe(false);

    // THE CITATION IS REAL over HTTP: counts about a retrieval, and the kernel
    // kind with no bucket counted in the total and nowhere else.
    expect(hydration.brain.contentHash).toBe('sha256:6f1e');
    expect(hydration.brain.entryCount).toBe(4);
    expect(hydration.brain.kindCounts.DECISION).toBe(2);
    expect(Object.values(hydration.brain.kindCounts).reduce((a, b) => a + b, 0)).toBe(3);

    // AND WHAT A PERSON IS BEING WAITED ON FOR, beside the count that agrees
    // with it because both were read in one statement.
    expect(hydration.run.pendingApprovals).toBe(1);
    expect(hydration.humanGates.length).toBe(1);
    expect(hydration.humanGates[0].operation).toBe('MUTATE_FILESYSTEM');
    expect(hydration.humanGates[0].taskId).toBe('task-1');

    // Unknown crosses the wire AS unknown.
    expect(hydration.card.hasCodingAgent).toBeNull();
    expect(hydration.card.swarmEligible).toBeNull();

    // And nothing about a provider survives the trip.
    const serialised = JSON.stringify(body).toLowerCase();
    for (const name of ['gpt', 'claude', 'openai', 'anthropic']) {
      expect(serialised).not.toContain(name);
    }
    // Nor a sentence, from the citation or from the gate.
    expect(serialised).not.toContain('safe_content');
    expect(serialised).not.toContain('saferationale');

    // EVERY STATEMENT INSIDE ONE READ-ONLY TRANSACTION, and nothing that writes.
    expect(fake.statements[0]).toMatch(/^BEGIN\b.*\bREAD ONLY\b/u);
    expect(fake.statements.at(-1)).toBe('COMMIT');
    for (const statement of fake.statements.slice(1, -1)) expect(statement).toMatch(/^\s*(SELECT|WITH)\b/iu);
  }, 30_000);

  it('refuses a signed-in BROWSER over real HTTP -- from its own Origin or with none -- the one 404, on every route (review N5)', async () => {
    // The world routes are native-only: the branch's browser door is gone. A browser_control session is the
    // website's credential, bound to no project, and no world route admits it.
    const { world, fake } = worldOver({ run: RUN_ROW, citation: CITATION_ROW });
    const base = await boot(null, world);
    const token = await pairSession(base, 'player-1');
    for (const route of ROUTES) {
      const fromItsOrigin = await get(base, `/relay-api/wonderland/julius/${route}?${queryFor(route)}`, { Authorization: `Relay-Session ${token}` });
      expect(fromItsOrigin.status, route).toBe(404);
      expect(await fromItsOrigin.json(), route).toEqual({ error: 'permission denied' });
      const withoutOrigin = await getNative(base, `/relay-api/wonderland/julius/${route}?${queryFor(route)}`, token);
      expect(withoutOrigin.status, route).toBe(404);
    }
    // Refused before any read: not one transaction was opened.
    expect(fake.connections()).toBe(0);
  }, 30_000);

  it('admits the native client only WITHOUT an Origin: the same native token WITH one is the one 404, on every route (internal review A3)', async () => {
    // Every other HTTP test either sends a native token with no Origin or a browser token. This is the native token
    // itself, sent once as the Unreal client sends it and once with the bridge's own approved Origin added.
    const view: JuliusMissionResultView = {
      runId: 'run-1', missionId: 'mission-1', state: 'EXECUTING', verified: false, terminal: false,
      criteria: [], deliverables: [], outstandingFindings: [], reviewDecisions: [],
      cost: { knownUsdMicros: 0, unknownComponents: 0, complete: true }, failure: null,
    };
    const { world, fake } = worldOver({ run: RUN_ROW, citation: CITATION_ROW }, view);
    const store = createBrowserSessionStore();
    const base = await boot(null, world, store);
    const token = nativeSession(store);
    for (const route of ROUTES) {
      const before = fake.connections();
      const withOrigin = await get(base, `/relay-api/wonderland/julius/${route}?${queryFor(route)}`, { Authorization: `Relay-Session ${token}` });
      expect(withOrigin.status, route).toBe(404);
      expect(await withOrigin.json(), route).toEqual({ error: 'permission denied' });
      expect(withOrigin.headers.get('cache-control'), route).toBe('no-store');
      // Refused on the header alone: no transaction was opened for it.
      expect(fake.connections(), route).toBe(before);
      // An Origin the bridge does not approve never reaches a route at all -- the bridge's origin gate, unchanged.
      const unapproved = await realFetch(`${base}/relay-api/wonderland/julius/${route}?${queryFor(route)}`, {
        headers: { Origin: 'https://evil.example', Authorization: `Relay-Session ${token}` },
      });
      expect(unapproved.status, route).toBe(403);
      expect(fake.connections(), route).toBe(before);
      // CONTROL: the SAME token with NO Origin, as the Unreal client sends it, is served -- in one transaction.
      const native = await getNative(base, `/relay-api/wonderland/julius/${route}?${queryFor(route)}`, token);
      expect(native.status, route).toBe(200);
      expect(fake.connections(), route).toBe(before + 1);
    }
  }, 30_000);

  it('refuses a member of ANOTHER project without saying so -- the one 404', async () => {
    const { world } = worldOver({ run: RUN_ROW, member: false });
    const store = createBrowserSessionStore();
    const base = await boot(null, world, store);
    const token = nativeSession(store);
    const res = await getNative(base, `/relay-api/wonderland/julius/hydrate?${QUERY}`, token);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('permission denied');
  }, 30_000);

  it('gives a member a run that does not exist the same answer as a forbidden one, on every route', async () => {
    const { world } = worldOver({ run: null });
    const store = createBrowserSessionStore();
    const base = await boot(null, world, store);
    const token = nativeSession(store);
    for (const route of ['hydrate', 'events'] as const) {
      const res = await getNative(base, `/relay-api/wonderland/julius/${route}?${queryFor(route)}`, token);
      expect(res.status, route).toBe(404);
      expect(await res.json(), route).toEqual({ error: 'permission denied' });
    }
  }, 30_000);

  it('serves the tail from the cursor the caller asked for, as one page', async () => {
    const { world } = worldOver({
      run: RUN_ROW,
      events: [{
        revision: '7', event_id: 'event-43', stream_id: 'run-1', project_id: 'project-alpha',
        sequence: '43', event_type: 'julius.run.transitioned',
        occurred_at: '2026-09-08T00:00:00.000Z',
        payload: {
          schemaVersion: 'relay-julius-event.v1', eventId: 'event-43', streamId: 'run-1',
          projectId: 'project-alpha', occurredAt: '2026-09-08T00:00:00.000Z',
          payload: { runId: 'run-1', to: 'REVIEWING' },
        },
      }],
    });
    const store = createBrowserSessionStore();
    const base = await boot(null, world, store);
    const token = nativeSession(store);
    const res = await getNative(base, `/relay-api/wonderland/julius/events?${QUERY}&cursor=42&mode=page`, token);
    expect(res.status).toBe(200);
    const page = (await res.json()).data as { deliveries: Array<{ envelope: { sequence: number; state: string } }>; nextCursor: number };
    // REVIEWING is the kernel's word; `independent_review` is the world's. The
    // envelope reached the wire already translated, carrying its sequence.
    expect(page.deliveries.map((delivery) => [delivery.envelope.sequence, delivery.envelope.state])).toEqual([[43, 'independent_review']]);
    expect(page.nextCursor).toBe(43);
    const serialised = JSON.stringify(page).toLowerCase();
    for (const name of ['gpt', 'claude', 'openai', 'anthropic']) {
      expect(serialised).not.toContain(name);
    }
  }, 30_000);

  it('serves the result to the project owner, through Julius\'s own API, over HTTP', async () => {
    const view: JuliusMissionResultView = {
      runId: 'run-1', missionId: 'mission-1', state: 'COMPLETED', verified: true, terminal: true,
      criteria: [{ criterionId: 'c-1', description: 'The page renders', requiredEvidenceTypes: ['TEST'], satisfied: true, basis: 'EVIDENCE', evidenceIds: ['ev-1'] }],
      deliverables: [], outstandingFindings: [], reviewDecisions: [{ taskId: 't-1', action: 'ACCEPT', reasonCode: 'MISSION_VERIFIED' }],
      cost: { knownUsdMicros: 1_500, unknownComponents: 0, complete: true }, failure: null,
    };
    const { world } = worldOver({ run: RUN_ROW }, view);
    const store = createBrowserSessionStore();
    const base = await boot(null, world, store);
    const token = nativeSession(store);
    const res = await getNative(base, `/relay-api/wonderland/julius/result?${QUERY}`, token);
    expect(res.status).toBe(200);
    const data = (await res.json()).data as Record<string, unknown>;
    expect(data).toMatchObject({
      schemaVersion: 'relay-wonderland-julius-result.v1', runId: 'run-1', juliusState: 'COMPLETED', verified: true, terminal: true,
      cost: { visible: true, knownUsdMicros: 1_500, unknownComponents: 0, complete: true },
    });
    // CONTROL: another run of the same project is the one 404, through the same door.
    const other = await getNative(base, '/relay-api/wonderland/julius/result?projectId=project-alpha&runId=run-2', token);
    expect(other.status).toBe(404);
  }, 30_000);
});
