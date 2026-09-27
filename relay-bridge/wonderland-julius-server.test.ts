import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBridgeServer, wonderlandJuliusDatabaseUrl, wonderlandJuliusWorld } from './server';
import type { WonderlandJuliusWorld } from './server';
import { loadBridgeConfig } from './config';
import { betaWaveZeroState } from './beta-routes';
import { createBetaEnrolmentStore } from '../src/relay/persistence';
import { juliusRuntimeDatabaseUrl } from '../src/relay/persistence/julius-test-database';

/**
 * THE WORLD ROUTES OVER THE REAL BRIDGE, WITH NO DATABASE.
 *
 * The route's own suite proves it answers 503 when its two dependencies are
 * absent. This proves the COMPOSITION ROOT still leaves them absent when there
 * is nothing to build them from — which is the half that a wiring change breaks
 * and the route's own tests cannot see.
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

async function boot(databaseUrl: string | null, world: WonderlandJuliusWorld | null = null): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'relay-julius-world-'));
  roots.push(root);
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('RELAY_DATA_DIR', root);
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
    // wonderlandBackend — then the injected world.
    null, null, null, null, null, world,
  );
  servers.push(server as never);
  await new Promise<void>((r) =>
    (server as never as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
  const address = (server as never as { address: () => { port: number } | null }).address();
  return `http://127.0.0.1:${address === null ? 0 : address.port}`;
}

const get = (base: string, path: string, headers: Record<string, string> = {}) =>
  realFetch(`${base}${path}`, { headers: { Origin: ORIGIN, ...headers } });

const QUERY = 'projectId=project-alpha&runId=run-1';

/**
 * A real browser session, minted the way production does: the operator pairs a
 * grant bound to a player, the browser redeems it from the approved origin.
 *
 * Needed because the routes check the SESSION before they check whether this
 * deployment can answer at all — deliberately, so that session and origin
 * validation stay independent of the membership authority. Without a real
 * session every request stops at 401 and the branches past it are unreachable
 * from here.
 */
async function pairSession(base: string, playerId: string): Promise<string> {
  const minted = await realFetch(`${base}/relay-api/browser/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${OPERATOR}` },
    // `control` is the only scope that binds a PLAYER to the grant, and the
    // world routes need a player — a read-only session carries no participant
    // id, so `verified.participantId` is null and the route stops at 401.
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
  for (const route of ['hydrate', 'events']) {
    it(`answers 503 on /wonderland/julius/${route}, not a denial`, async () => {
      // THE FAIL-CLOSED PROPERTY, reached with a real session so it is the
      // deployment being refused rather than the caller. 503 and not 403: the
      // request may have been perfectly authorised and this deployment could
      // not check, and reporting that as a denial sends an operator hunting
      // permissions that were never the issue.
      const base = await boot(null);
      const token = await pairSession(base, 'player-1');
      const res = await get(base, `/relay-api/wonderland/julius/${route}?${QUERY}`, {
        Authorization: `Relay-Session ${token}`,
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).not.toBe('permission denied');
      expect(JSON.stringify(body)).not.toContain('project-alpha');
    }, 30_000);
  }

  it('does not open up merely because a database exists', async () => {
    // With DATABASE_URL set, both dependencies are built and the route reaches
    // its membership lookup — against a database that cannot be reached. That
    // is an authority that could not answer, which is 503 and never a grant.
    const base = await boot('postgres://nobody@127.0.0.1:1/never');
    const token = await pairSession(base, 'player-1');
    const res = await get(base, `/relay-api/wonderland/julius/events?${QUERY}`, {
      Authorization: `Relay-Session ${token}`,
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).not.toBe('permission denied');
  }, 30_000);
});

describe('the world routes over the real bridge', () => {
  for (const route of ['hydrate', 'events']) {
    it(`dispatches /wonderland/julius/${route} in front of the battle routes`, async () => {
      // `isWonderlandRoute` claims the whole `/wonderland/` prefix, so these
      // are dispatched ahead of it. A regression that reordered them would 404
      // here instead of reaching the route at all.
      const base = await boot(null);
      const res = await get(base, `/relay-api/wonderland/julius/${route}?${QUERY}`);
      expect(res.status).not.toBe(404);
    }, 30_000);
  }

  it('refuses a bad query before it looks at anything else', async () => {
    const base = await boot('postgres://nobody@127.0.0.1:1/never');
    const res = await get(base, '/relay-api/wonderland/julius/events?projectId=&runId=');
    expect(res.status).toBe(400);
  }, 30_000);

  it('validates the session INDEPENDENTLY of whether an authority exists', async () => {
    // The property: session and origin checking does not depend on the
    // membership authority being configured. An unauthenticated caller gets the
    // same 401 whether or not this deployment could have answered — so the
    // response never reveals which deployments are wired for world reads.
    //
    // The 503-for-a-VALID-session half is proven in the route's own suite,
    // where a session store can be stubbed. Minting a real one here would mean
    // driving the whole pairing flow to assert a branch already covered.
    for (const url of [null, 'postgres://nobody@127.0.0.1:1/never']) {
      const base = await boot(url);
      const res = await get(base, `/relay-api/wonderland/julius/events?${QUERY}`);
      expect(res.status, `DATABASE_URL ${url === null ? 'absent' : 'present'}`).toBe(401);
      expect(await res.text()).not.toContain('permission denied');
    }
  }, 30_000);

  it('issues no query for a request it refuses first', async () => {
    // `new Pool` does not connect — `pg` connects on the first QUERY — and the
    // route refuses an unauthenticated caller before it asks the membership
    // port anything. So a connection string pointing nowhere still answers
    // immediately; if any read happened first, this would stall on a refused
    // TCP connect or come back 503.
    const base = await boot('postgres://nobody@127.0.0.1:1/never');
    const started = Date.now();
    const res = await get(base, `/relay-api/wonderland/julius/events?${QUERY}`);
    expect(res.status).toBe(401);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 30_000);

  it('says nothing about the project or the run in any refusal', async () => {
    // Whatever the reason, the body must not confirm that this project or this
    // run exists — the routes are not a membership oracle and not an existence
    // one either.
    for (const url of [null, 'postgres://nobody@127.0.0.1:1/never']) {
      const base = await boot(url);
      for (const route of ['hydrate', 'events']) {
        const body = await (await get(base, `/relay-api/wonderland/julius/${route}?${QUERY}`)).text();
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
    const url = 'postgres://user@host:5432/db';
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
    const julius = 'postgres://julius@host:5432/julius_runtime';
    const other = 'postgres://someone@host:5432/something_else';
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

describe('the world routes get both dependencies or neither', () => {
  it('builds a reader AND a membership source, never one of them', () => {
    // The half-wired state this forbids is invisible from outside: a bridge
    // with membership and no reader answers 503 exactly like an unwired one, so
    // no request can tell them apart — and that is the state somebody later
    // "fixes" by relaxing the reader check instead of supplying a reader.
    const world = wonderlandJuliusWorld({} as never);
    expect(Object.keys(world).sort()).toEqual(['membership', 'reader']);
    expect(typeof world.reader.hydrate).toBe('function');
    expect(typeof world.reader.events).toBe('function');
    expect(typeof world.membership.lookup).toBe('function');
  });

  it('gives both of them the SAME pool', async () => {
    // A membership answer and the read it authorises must come from one
    // database. Two pools would be two connection strings waiting to disagree.
    const issued: string[] = [];
    const pool = {
      query: async (sql: string) => {
        issued.push(sql);
        return { rows: [], rowCount: 0 };
      },
    };
    const world = wonderlandJuliusWorld(pool as never);
    await world.membership.lookup({ playerId: 'p', projectId: 'q' });
    await world.reader.events({ projectId: 'q', runId: 'r', afterSequence: 0, limit: 1 });
    expect(issued.length).toBe(2);
    expect(issued[0]).toContain('project_members');
    expect(issued[1]).toContain('julius_runs');
  });
});

/* ------------------------------------------ the whole route, over HTTP */

/** A pool that answers the reader's two statements the way Postgres would. */
const worldOver = (rows: {
  readonly run?: Record<string, unknown> | null;
  readonly events?: readonly Record<string, unknown>[];
  readonly member?: boolean;
  readonly citation?: Record<string, unknown> | null;
}): WonderlandJuliusWorld => {
  const pool = {
    query: async (sql: string) => {
      if (sql.includes('project_members')) {
        return { rows: rows.member === false ? [] : [{ role: 'OWNER' }], rowCount: 1 };
      }
      // THE CITATION READ IS MATCHED FIRST, and by a table nothing else names.
      // It JOINs `julius_runs r` and it uses a LEFT JOIN LATERAL, so both of
      // the broader matchers below would swallow it — and answering the wrong
      // statement proves something about a statement nobody issued.
      if (sql.includes('julius_context_snapshots')) {
        const citation = rows.citation ?? null;
        return { rows: citation === null ? [] : [citation], rowCount: citation === null ? 0 : 1 };
      }
      if (sql.includes('LEFT JOIN LATERAL')) return { rows: rows.events ?? [], rowCount: 0 };
      if (sql.includes('julius_runs r')) {
        return { rows: rows.run === null || rows.run === undefined ? [] : [rows.run], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return wonderlandJuliusWorld(pool as never);
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
    // THE FIRST PROOF OF THE WHOLE CLOUD-SIDE PATH IN ONE PROCESS: a real
    // browser session, the real server, the real authorisation, the real
    // reader, over real HTTP. Only the database is a stub, and it answers the
    // shapes `pg` actually returns.
    const base = await boot(null, worldOver({ run: RUN_ROW, citation: CITATION_ROW }));
    const token = await pairSession(base, 'player-1');
    const res = await get(base, `/relay-api/wonderland/julius/hydrate?${QUERY}`, {
      Authorization: `Relay-Session ${token}`,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const hydration = (body.data ?? body) as {
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

    // Unknown crosses the wire AS unknown. JSON has null, and this is the whole
    // reason the contract stopped using a bare boolean — for the role slots and
    // now for swarm eligibility beside them.
    expect(hydration.card.hasCodingAgent).toBeNull();
    expect(hydration.card.swarmEligible).toBeNull();

    // And nothing about a provider survives the trip.
    const serialised = JSON.stringify(body).toLowerCase();
    for (const name of ['gpt', 'claude', 'openai', 'anthropic']) {
      expect(serialised).not.toContain(name);
    }
    // Nor a sentence, from the citation or from the gate. Both tables hold one
    // and neither column is in either SELECT.
    expect(serialised).not.toContain('safe_content');
    expect(serialised).not.toContain('saferationale');
  }, 30_000);

  it('refuses a member of ANOTHER project without saying so', async () => {
    const base = await boot(null, worldOver({ run: RUN_ROW, member: false }));
    const token = await pairSession(base, 'player-1');
    const res = await get(base, `/relay-api/wonderland/julius/hydrate?${QUERY}`, {
      Authorization: `Relay-Session ${token}`,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('permission denied');
  }, 30_000);

  it('gives a member a run that does not exist the same answer as a forbidden one', async () => {
    const base = await boot(null, worldOver({ run: null }));
    const token = await pairSession(base, 'player-1');
    const res = await get(base, `/relay-api/wonderland/julius/hydrate?${QUERY}`, {
      Authorization: `Relay-Session ${token}`,
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('permission denied');
  }, 30_000);

  it('streams the tail from the cursor the caller asked for', async () => {
    // `/events` is an SSE STREAM, not a body — it stays open for the live tail
    // after the replay. So this reads the first chunk and hangs up, which is
    // also what a reconnecting world does.
    const base = await boot(null, worldOver({
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
    }));
    const token = await pairSession(base, 'player-1');
    const control = new AbortController();
    const res = await realFetch(`${base}/relay-api/wonderland/julius/events?${QUERY}&cursor=42`, {
      headers: { Origin: ORIGIN, Authorization: `Relay-Session ${token}` },
      signal: control.signal,
    });
    expect(res.status).toBe(200);

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value ?? new Uint8Array());
    control.abort();
    await reader.cancel().catch(() => undefined);

    // REVIEWING is the kernel's word; `independent_review` is the world's. The
    // envelope reached the wire already translated, carrying its sequence.
    expect(chunk).toContain('independent_review');
    expect(chunk).toContain('43');
    // And the provider sweep holds on the streaming path too.
    for (const name of ['gpt', 'claude', 'openai', 'anthropic']) {
      expect(chunk.toLowerCase()).not.toContain(name);
    }
  }, 30_000);
});
