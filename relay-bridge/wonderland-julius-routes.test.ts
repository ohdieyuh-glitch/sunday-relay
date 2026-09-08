import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_JULIUS_PAGE_LIMIT,
  authorizeWonderlandJulius,
  handleWonderlandJuliusRoute,
  isWonderlandJuliusRoute,
  readWonderlandJuliusQuery,
  serveWonderlandJuliusPage,
} from './wonderland-julius-routes';
import type {
  WonderlandJuliusReader,
  WonderlandProjectMembership,
} from './wonderland-julius-routes';
import type { BrowserSessionStore } from './browser-session/grants';
import type { WonderlandLedgerRow } from '../src/relay/mission/wonderland/wonderland-ledger-adapter';
import type { WonderlandHydration } from '../src/relay/mission/wonderland/wonderland-hydration';

/**
 * THE JULIUS WORLD ROUTES.
 *
 * The security shape is the split the header describes: the browser session
 * this bridge issues names a PLAYER and an origin and NOT a project, so
 * authorising a project read needs a membership port that does not exist yet.
 * These tests exist to hold the line that its absence closes the route rather
 * than opening it — a route that worked wherever nobody had wired its
 * authorisation is the worst failure mode available.
 */

const PROJECT = 'project-alpha';
const RUN = 'run-1';
const AT = '2026-09-08T00:00:00.000Z';
const NOW = 1_757_289_600_000;

const sessions = (participantId: string | null, ok = true): BrowserSessionStore =>
  ({
    verifySession: () => ({ ok, participantId, sessionId: 'world-session-1' }),
  }) as unknown as BrowserSessionStore;

const membership = (allow: boolean): WonderlandProjectMembership => ({
  mayReadProject: async () => allow,
});

const row = (sequence: number, type: string, inner: Record<string, unknown> = {}): WonderlandLedgerRow => ({
  eventId: `event-${sequence}`,
  streamId: RUN,
  projectId: PROJECT,
  sequence,
  eventType: `julius.${type}`,
  occurredAt: AT,
  payload: {
    schemaVersion: 'relay-julius-event.v1',
    eventId: `event-${sequence}`,
    streamId: RUN,
    projectId: PROJECT,
    occurredAt: AT,
    payload: { runId: RUN, ...inner },
  },
});

const reader = (
  rows: readonly WonderlandLedgerRow[] = [],
  hydration: WonderlandHydration | null = null,
): WonderlandJuliusReader & { readonly calls: { events: number } } => {
  const calls = { events: 0 };
  return {
    calls,
    hydrate: async () => hydration,
    events: async (input) => {
      calls.events += 1;
      return {
        rows: rows.filter((r) => r.sequence > input.afterSequence).slice(0, input.limit),
        revision: 7,
      };
    },
  };
};

const request = (path: string, query = `projectId=${PROJECT}&runId=${RUN}`) => ({
  method: 'GET',
  path,
  url: `${path}?${query}`,
  authorization: 'Relay-Session tok',
  origin: 'https://sunday-relay.vercel.app',
  now: NOW,
});

/* ---------------------------------------------------------- the query */

describe('the query a world sends', () => {
  it('requires both a project and a run', () => {
    expect(readWonderlandJuliusQuery('/x?runId=run-1')).toBeNull();
    expect(readWonderlandJuliusQuery(`/x?projectId=${PROJECT}`)).toBeNull();
    expect(readWonderlandJuliusQuery('/x?projectId=&runId=run-1')).toBeNull();
    expect(readWonderlandJuliusQuery(`/x?projectId=${PROJECT}&runId=${RUN}`)).toEqual({
      projectId: PROJECT,
      runId: RUN,
      cursor: 0,
    });
  });

  it('refuses a cursor that is not a position rather than clamping it', () => {
    // Clamping a bad cursor to 0 would silently replay a run from the start,
    // which for a world mid-mission is worse than an error.
    for (const cursor of ['-1', 'abc', '1.5', 'NaN']) {
      expect(readWonderlandJuliusQuery(`/x?projectId=${PROJECT}&runId=${RUN}&cursor=${cursor}`)).toBeNull();
    }
    expect(readWonderlandJuliusQuery(`/x?projectId=${PROJECT}&runId=${RUN}&cursor=42`)?.cursor).toBe(42);
  });

  it('claims only its own two paths', () => {
    expect(isWonderlandJuliusRoute('/wonderland/julius/hydrate')).toBe(true);
    expect(isWonderlandJuliusRoute('/wonderland/julius/events')).toBe(true);
    expect(isWonderlandJuliusRoute('/wonderland/events')).toBe(false);
    expect(isWonderlandJuliusRoute('/wonderland/presence/join')).toBe(false);
  });
});

/* ------------------------------------------------------ the authorisation */

describe('a route that will not open without its authorisation', () => {
  it('refuses with 503 when no membership port is configured', async () => {
    // THE TEST THIS FILE EXISTS FOR. Not 403 — the request was fine and this
    // deployment cannot answer it, and reporting it as a permission problem
    // would send somebody hunting permissions that were never the issue.
    const result = await authorizeWonderlandJulius(request('/wonderland/julius/events'), {
      sessions: sessions('player-1'),
      reader: reader(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(503);
  });

  it('refuses with 503 when no reader is configured either', async () => {
    const result = await authorizeWonderlandJulius(request('/wonderland/julius/events'), {
      sessions: sessions('player-1'),
      membership: membership(true),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(503);
  });

  it('never reaches the membership check without a session', async () => {
    let asked = false;
    const result = await authorizeWonderlandJulius(request('/wonderland/julius/events'), {
      sessions: sessions(null),
      reader: reader(),
      membership: {
        mayReadProject: async () => {
          asked = true;
          return true;
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(401);
    expect(asked).toBe(false);
  });

  it('refuses a player who is not a member of the project', async () => {
    const result = await authorizeWonderlandJulius(request('/wonderland/julius/events'), {
      sessions: sessions('player-1'),
      reader: reader(),
      membership: membership(false),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });

  it('asks membership about the project in the QUERY, for the sessionholder', async () => {
    // A membership check against the wrong project would authorise the wrong
    // read, and one against the wrong player would authorise the wrong person.
    const asked: { playerId?: string; projectId?: string } = {};
    await authorizeWonderlandJulius(request('/wonderland/julius/events'), {
      sessions: sessions('player-7'),
      reader: reader(),
      membership: {
        mayReadProject: async (input) => {
          asked.playerId = input.playerId;
          asked.projectId = input.projectId;
          return true;
        },
      },
    });
    expect(asked).toEqual({ playerId: 'player-7', projectId: PROJECT });
  });

  it('grants exactly the project and run that were asked for', async () => {
    const result = await authorizeWonderlandJulius(request('/wonderland/julius/events'), {
      sessions: sessions('player-1'),
      reader: reader(),
      membership: membership(true),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grant).toEqual({ projectId: PROJECT, runId: RUN });
  });

  it('refuses a bad query before anything else', async () => {
    const result = await authorizeWonderlandJulius(
      { ...request('/wonderland/julius/events'), url: '/wonderland/julius/events' },
      { sessions: sessions('player-1'), reader: reader(), membership: membership(true) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });
});

/* -------------------------------------------------------------- the page */

describe('serving the tail', () => {
  const grant = { projectId: PROJECT, runId: RUN };

  it('ingests what it reads and hands back deliveries', async () => {
    const page = await serveWonderlandJuliusPage(grant, 0, {
      reader: reader([row(1, 'run.transitioned', { to: 'EXECUTING' })]),
      worldSessionId: 'world-session-1',
    });
    expect(page.deliveries.length).toBe(1);
    expect(page.nextCursor).toBe(1);
  });

  it('advances the cursor past rows it REFUSED, not only applied ones', async () => {
    // A refused row is still a row this client has seen. Resuming from the last
    // APPLIED sequence would serve the refusals again on every reconnect, for
    // ever, and a run whose next event is silent would never advance at all.
    const page = await serveWonderlandJuliusPage(grant, 0, {
      reader: reader([
        row(1, 'run.transitioned', { to: 'EXECUTING' }),
        row(2, 'budget.reserved'),
        row(3, 'context.compiled'),
      ]),
      worldSessionId: null,
    });
    expect(page.deliveries.length).toBe(1);
    expect(page.nextCursor).toBe(3);
    expect(page.summary.silent).toBe(2);
  });

  it('leaves the cursor where it was when the run has nothing new', async () => {
    const page = await serveWonderlandJuliusPage(grant, 40, {
      reader: reader([row(1, 'run.transitioned', { to: 'EXECUTING' })]),
      worldSessionId: null,
    });
    expect(page.deliveries).toEqual([]);
    expect(page.nextCursor).toBe(40);
  });

  it('reads from the cursor and bounds the page', async () => {
    const rows = Array.from({ length: 900 }, (_, index) =>
      row(index + 1, 'run.transitioned', { to: index % 2 === 0 ? 'PLANNING' : 'EXECUTING' }),
    );
    const page = await serveWonderlandJuliusPage(grant, 10, {
      reader: reader(rows),
      worldSessionId: null,
    });
    expect(page.nextCursor).toBe(10 + WONDERLAND_JULIUS_PAGE_LIMIT);
  });
});

/* ------------------------------------------------------------ dispatch */

describe('the handler', () => {
  it('ignores paths and methods that are not its own', async () => {
    const deps = { sessions: sessions('player-1'), reader: reader(), membership: membership(true) };
    expect(await handleWonderlandJuliusRoute(request('/wonderland/events'), deps)).toBeNull();
    expect(
      await handleWonderlandJuliusRoute(
        { ...request('/wonderland/julius/events'), method: 'POST' },
        deps,
      ),
    ).toBeNull();
  });

  it('serves a hydration when the run exists', async () => {
    const hydration = { schemaVersion: 'relay-wonderland-hydration.v1' } as WonderlandHydration;
    const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), {
      sessions: sessions('player-1'),
      reader: reader([], hydration),
      membership: membership(true),
    });
    expect(result?.status).toBe(200);
    expect((result?.body as { data: unknown }).data).toBe(hydration);
  });

  it('says 404 for a run this project does not have', async () => {
    const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), {
      sessions: sessions('player-1'),
      reader: reader([], null),
      membership: membership(true),
    });
    expect(result?.status).toBe(404);
  });

  it('does not read a single row before authorising', async () => {
    const source = reader([row(1, 'run.transitioned', { to: 'EXECUTING' })]);
    await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), {
      sessions: sessions('player-1'),
      reader: source,
      membership: membership(false),
    });
    expect(source.calls.events).toBe(0);
  });

  it('returns one page as a body when there is no stream to write to', async () => {
    const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), {
      sessions: sessions('player-1'),
      reader: reader([row(1, 'run.transitioned', { to: 'EXECUTING' })]),
      membership: membership(true),
    });
    expect(result?.status).toBe(200);
    const data = (result?.body as { data: { deliveries: unknown[] } }).data;
    expect(data.deliveries.length).toBe(1);
  });
});
