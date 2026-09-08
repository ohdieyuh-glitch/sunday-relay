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
  WonderlandProjectMembershipSource,
} from './wonderland-julius-routes';
import type { BrowserSessionStore } from './browser-session/grants';
import type { WonderlandLedgerRow } from '../src/relay/mission/wonderland/wonderland-ledger-adapter';
import {
  scopeWonderlandCard,
  wonderlandHydration,
} from '../src/relay/mission/wonderland/wonderland-hydration';
import type { WonderlandHydration } from '../src/relay/mission/wonderland/wonderland-hydration';
import { wonderlandRunSnapshot } from '../src/relay/mission/wonderland/wonderland-rehydration';
import { emptyJuliusActivity } from '../src/relay/mission/wonderland/wonderland-julius-activity';
import { noWonderlandBrainCitation } from '../src/relay/mission/wonderland/wonderland-brain-scope';
import {
  emptyWonderlandUsageAuthority,
  projectWonderlandUsageFromAuthority,
} from '../src/relay/mission/wonderland/wonderland-usage-authority';

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

const membership = (allow: boolean): WonderlandProjectMembershipSource => ({
  lookup: async ({ playerId, projectId }) =>
    allow ? { playerId, projectId, role: 'OWNER' } : null,
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

/** A real hydration, assembled the way the reader is expected to assemble one. */
const hydrationFor = (projectId = PROJECT, runId = RUN): WonderlandHydration => {
  const authority = projectWonderlandUsageFromAuthority(
    emptyWonderlandUsageAuthority({ projectId }),
    AT,
  );
  return wonderlandHydration({
    run: wonderlandRunSnapshot({
      projectId,
      runId,
      state: 'EXECUTING',
      revision: 7,
      atSequence: 120,
      observedAtIso: AT,
    }),
    usage: authority.hud,
    usageStatus: authority.status,
    activity: emptyJuliusActivity({ projectId, runId }),
    brain: noWonderlandBrainCitation({ projectId, runId }),
    card: scopeWonderlandCard({ cardRevision: 'card:v3' }),
    observedAtIso: AT,
  });
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
        lookup: async ({ playerId, projectId }) => {
          asked = true;
          return { playerId, projectId, role: 'OWNER' };
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
        lookup: async (input) => {
          asked.playerId = input.playerId;
          asked.projectId = input.projectId;
          return { playerId: input.playerId, projectId: input.projectId, role: 'OWNER' };
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

/* --------------------------------------------------- the attacks it stops */

describe('a run id is not a way to pick your own authorisation', () => {
  it('refuses a run belonging to another project, even for a real member', () => {
    // THE ATTACK THE ROUTE IS SHAPED AROUND. Name somebody else's run, be
    // authorised for a project you DO belong to, and read a run you do not.
    // The authorisation decides a project; the run must belong to THAT
    // project, never the other way round.
    return handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), {
      sessions: sessions('player-1'),
      // A reader that failed to filter — which is exactly the case this
      // check exists to survive.
      reader: reader([], hydrationFor('project-beta', 'run-elsewhere')),
      membership: membership(true),
    }).then((result) => {
      expect(result?.status).toBe(404);
      expect((result?.body as { error: string }).error).toBe('permission denied');
    });
  });

  it('never resolves a project FROM the run id', async () => {
    // Resolving a project from an attacker-supplied run would let somebody
    // name a run, have the server discover its project, and be authorised
    // against the project they just caused it to pick.
    const asked: string[] = [];
    await handleWonderlandJuliusRoute(
      {
        ...request('/wonderland/julius/hydrate'),
        url: `/wonderland/julius/hydrate?projectId=${PROJECT}&runId=run-belonging-to-someone-else`,
      },
      {
        sessions: sessions('player-1'),
        reader: reader([], hydrationFor()),
        membership: {
          lookup: async (input) => {
            asked.push(input.projectId);
            return { playerId: input.playerId, projectId: input.projectId, role: 'OWNER' };
          },
        },
      },
    );
    // Exactly one lookup, against the project in the query and nothing else.
    expect(asked).toEqual([PROJECT]);
  });

  it('gives a missing run and a forbidden run the same answer', async () => {
    // A 404 that appeared only for runs that do not exist would confirm the
    // existence of every run that does.
    const missing = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), {
      sessions: sessions('player-1'),
      reader: reader([], null),
      membership: membership(true),
    });
    const forbidden = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), {
      sessions: sessions('player-1'),
      reader: reader([], hydrationFor('project-beta')),
      membership: membership(true),
    });
    expect(missing?.status).toBe(forbidden?.status);
    expect(missing?.body).toEqual(forbidden?.body);
  });
});

describe('membership is asked per request, never cached into the session', () => {
  it('stops reading the moment a membership is revoked', async () => {
    // A session issued while somebody was a member must not keep working.
    let member = true;
    const deps = {
      sessions: sessions('player-1'),
      reader: reader([row(1, 'run.transitioned', { to: 'EXECUTING' })], hydrationFor()),
      membership: {
        lookup: async ({ playerId, projectId }: { playerId: string; projectId: string }) =>
          member ? { playerId, projectId, role: 'OWNER' } : null,
      },
    };

    const before = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps);
    expect(before?.status).toBe(200);

    member = false;
    const after = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps);
    expect(after?.status).toBe(403);
  });

  it('re-authorises when the same session names a DIFFERENT project', async () => {
    // A project switch mid-stream is a NEW request to authorise, not a
    // continuation of one already granted. The session is the same, the origin
    // is the same, the player is the same — and none of that carries a
    // permission across a project boundary.
    const asked: string[] = [];
    const deps = {
      sessions: sessions('player-1'),
      reader: reader([row(1, 'run.transitioned', { to: 'EXECUTING' })], hydrationFor()),
      membership: {
        lookup: async ({ playerId, projectId }: { playerId: string; projectId: string }) => {
          asked.push(projectId);
          return projectId === PROJECT ? { playerId, projectId, role: 'OWNER' } : null;
        },
      },
    };

    const first = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps);
    expect(first?.status).toBe(200);

    const switched = await handleWonderlandJuliusRoute(
      request('/wonderland/julius/events', `projectId=project-beta&runId=${RUN}`),
      deps,
    );
    expect(switched?.status).toBe(403);
    expect((switched?.body as { error: string }).error).toBe('permission denied');

    // Asked about the project in each QUERY, in order — never once about the
    // first and then assumed for the second.
    expect(asked).toEqual([PROJECT, 'project-beta']);
  });

  it('scopes the grant to the project each request named, with nothing carried over', async () => {
    // The positive half: a switch a member is entitled to make succeeds, and
    // what comes back is scoped to the NEW project. A grant that still named
    // the first would send the second project's reader the wrong filter.
    const deps = {
      sessions: sessions('player-1'),
      reader: reader(),
      membership: membership(true),
    };

    const first = await authorizeWonderlandJulius(request('/wonderland/julius/events'), deps);
    const second = await authorizeWonderlandJulius(
      request('/wonderland/julius/events', `projectId=project-beta&runId=run-9`),
      deps,
    );

    expect(first.ok && first.grant).toEqual({ projectId: PROJECT, runId: RUN });
    expect(second.ok && second.grant).toEqual({ projectId: 'project-beta', runId: 'run-9' });
  });

  it('asks the membership port once for every request, and never fewer', async () => {
    // Memoising a decision per session is the shortcut this forbids: it would
    // make revocation and a project switch both invisible.
    let calls = 0;
    const deps = {
      sessions: sessions('player-1'),
      reader: reader(),
      membership: {
        lookup: async ({ playerId, projectId }: { playerId: string; projectId: string }) => {
          calls += 1;
          return { playerId, projectId, role: 'OWNER' };
        },
      },
    };
    for (let i = 0; i < 3; i += 1) {
      await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps);
    }
    expect(calls).toBe(3);
  });

  it('denies a role the build does not recognise', async () => {
    // The column has no CHECK constraint. A role the product starts writing
    // before the capability table learns about it grants nothing.
    const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), {
      sessions: sessions('player-1'),
      reader: reader(),
      membership: {
        lookup: async ({ playerId, projectId }) => ({ playerId, projectId, role: 'VIEWER' }),
      },
    });
    expect(result?.status).toBe(403);
    expect((result?.body as { error: string }).error).toBe('permission denied');
  });

  it('answers 503 when the membership store cannot be reached', async () => {
    // NOT 403. The request may have been perfectly authorised and the
    // deployment could not check; calling that a denial sends an operator
    // hunting permissions that were never the issue.
    const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), {
      sessions: sessions('player-1'),
      reader: reader(),
      membership: {
        lookup: async () => {
          throw new Error('connection refused');
        },
      },
    });
    expect(result?.status).toBe(503);
    expect((result?.body as { error: string }).error).not.toBe('permission denied');
  });

  it('reports every decision to the operator hook, granted or not', async () => {
    const decisions: string[] = [];
    for (const allowed of [true, false]) {
      await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), {
        sessions: sessions('player-1'),
        reader: reader(),
        membership: membership(allowed),
        onAuthorization: (decision) => decisions.push(decision.verdict),
      });
    }
    expect(decisions).toEqual(['granted', 'not_a_member']);
  });

  it('keeps the operator’s reason out of every response body', async () => {
    for (const source of [
      { lookup: async () => null },
      { lookup: async ({ playerId, projectId }: { playerId: string; projectId: string }) => ({ playerId, projectId, role: 'GUEST' }) },
    ]) {
      const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), {
        sessions: sessions('player-1'),
        reader: reader(),
        membership: source as never,
      });
      const body = JSON.stringify(result?.body);
      expect(body).toBe(JSON.stringify({ error: 'permission denied' }));
      expect(body).not.toContain('member');
      expect(body).not.toContain('role');
      expect(body).not.toContain(PROJECT);
    }
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
    const hydration = hydrationFor();
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
