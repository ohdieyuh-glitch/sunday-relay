import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_JULIUS_NOT_FOUND,
  WONDERLAND_JULIUS_PAGE_LIMIT,
  handleWonderlandJuliusRoute,
  identifyWonderlandJuliusCaller,
  isWonderlandJuliusRoute,
  readWonderlandJuliusQuery,
  serveWonderlandJuliusPage,
} from './wonderland-julius-routes';
import type {
  WonderlandJuliusReader,
  WonderlandJuliusResultSource,
  WonderlandJuliusRouteDeps,
  WonderlandJuliusWorld,
  WonderlandProjectMembershipSource,
} from './wonderland-julius-routes';
import { NATIVE_SESSION_TTL_MS, NATIVE_WORLD_AUDIENCE, createBrowserSessionStore } from './browser-session/grants';
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
import { WONDERLAND_UNAVAILABLE_MESSAGE } from '../src/relay/mission/wonderland/wonderland-authorization';

/**
 * THE JULIUS WORLD ROUTES (row 12, R3').
 *
 * Carried from relay/wonderland-julius-integration 35917fda and adapted to the
 * row-12 design: every refusal a caller can provoke by naming something it may
 * not read is the SAME 404 (the branch answered 403 for some of them, which is a
 * membership oracle beside a 404 for an absent run); every read happens inside
 * the world port's one read-only transaction; `/events` serves pages only; and
 * only the native client -- a native_world session, NO Origin -- is admitted
 * (internal review N5: the branch's browser door is gone).
 */

const PROJECT = 'project-alpha';
const RUN = 'run-1';
const AT = '2026-09-08T00:00:00.000Z';
const NOW = 1_757_289_600_000;
const WEB = 'https://sunday-relay.vercel.app';
const OPERATOR = 'operator-secret-for-tests-0123456789abcdef';

/**
 * A session store that admits one NATIVE player, paired for `projectId` -- the shape `verifyNativeSession` answers.
 * A session naming no player is no native session (createGrant refuses to mint one). The routes are native-only
 * (internal review N5), so the browser door's own check, `verifySession`, must never be asked.
 */
const sessions = (participantId: string | null, ok = true, projectId = PROJECT): BrowserSessionStore =>
  ({
    verifyNativeSession: () => {
      if (!ok) return { ok: false, reason: 'expired' };
      return participantId === null
        ? { ok: false, reason: 'not_native' }
        : { ok: true, participantId, sessionId: 'world-session-1', projectId };
    },
    verifySession: () => { throw new Error('the browser door is gone, yet verifySession was asked'); },
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

/** A reader over fixed rows for RUN in PROJECT; any other (project, run) is absent, as the SQL makes it. */
const reader = (
  rows: readonly WonderlandLedgerRow[] = [],
  hydration: WonderlandHydration | null = null,
): WonderlandJuliusReader & { readonly calls: { events: number; asked: Array<{ projectId: string; runId: string }> } } => {
  const calls = { events: 0, asked: [] as Array<{ projectId: string; runId: string }> };
  return {
    calls,
    hydrate: async (input) => {
      calls.asked.push({ projectId: input.projectId, runId: input.runId });
      return hydration;
    },
    events: async (input) => {
      calls.events += 1;
      calls.asked.push({ projectId: input.projectId, runId: input.runId });
      if (input.projectId !== PROJECT) return null;
      return {
        rows: rows.filter((r) => r.sequence > input.afterSequence).slice(0, input.limit),
        revision: 7,
      };
    },
  };
};

const NO_RESULTS: WonderlandJuliusResultSource = { result: async () => null };

/** The world port over in-memory reads, with a count of the transactions it was asked to open. */
const worldOf = (parts: {
  readonly reader?: WonderlandJuliusReader;
  readonly membership?: WonderlandProjectMembershipSource;
  readonly results?: WonderlandJuliusResultSource;
}): WonderlandJuliusWorld & { readonly opened: () => number } => {
  let opened = 0;
  return {
    opened: () => opened,
    read: async (work) => {
      opened += 1;
      return work({
        reader: parts.reader ?? reader(),
        membership: parts.membership ?? membership(true),
        results: parts.results ?? NO_RESULTS,
      });
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

/** A request as the native client makes it: a session, and NO Origin. */
const request = (path: string, query = `projectId=${PROJECT}&runId=${RUN}${path.endsWith('/events') ? '&mode=page' : ''}`) => ({
  method: 'GET',
  path,
  url: `${path}?${query}`,
  authorization: 'Relay-Session tok' as string | undefined,
  origin: undefined as string | undefined,
  now: NOW,
});

const deps = (over: Partial<WonderlandJuliusRouteDeps> & { readonly parts?: Parameters<typeof worldOf>[0] } = {}): WonderlandJuliusRouteDeps => ({
  sessions: sessions('player-1'),
  world: worldOf(over.parts ?? {}),
  ...over,
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
      mode: null,
    });
  });

  it('refuses a cursor that is not a position rather than clamping it', () => {
    // Clamping a bad cursor to 0 would silently replay a run from the start,
    // which for a world mid-mission is worse than an error.
    for (const cursor of ['-1', 'abc', '1.5', 'NaN', '', '9007199254740993']) {
      expect(readWonderlandJuliusQuery(`/x?projectId=${PROJECT}&runId=${RUN}&cursor=${cursor}`), cursor).toBeNull();
    }
    expect(readWonderlandJuliusQuery(`/x?projectId=${PROJECT}&runId=${RUN}&cursor=42`)?.cursor).toBe(42);
  });

  it('accepts only a PLAIN DECIMAL cursor in the safe-integer range -- no hex, exponent, sign or leading zero (review N4)', async () => {
    // `Number()` read all of these as positions: 0x10 as 16, 1e3 as 1000, +5 as 5. The client writes a plain
    // non-negative decimal (RunQuery, WonderlandJuliusStream.cpp), so anything else is not a cursor.
    for (const cursor of ['0x10', '1e3', '+5', '%2B5', '-1', '01', '00', '5.0', '%205', '5%20', '0b1', '9007199254740992', '99999999999999999999']) {
      expect(readWonderlandJuliusQuery(`/x?projectId=${PROJECT}&runId=${RUN}&cursor=${cursor}`), cursor).toBeNull();
    }
    // CONTROL: the plain decimals the client writes, up to the largest safe integer.
    for (const [cursor, position] of [['0', 0], ['7', 7], ['42', 42], ['9007199254740991', Number.MAX_SAFE_INTEGER]] as const) {
      expect(readWonderlandJuliusQuery(`/x?projectId=${PROJECT}&runId=${RUN}&cursor=${cursor}`)?.cursor, cursor).toBe(position);
    }
    // And through the route: an identified caller's hex cursor is the 400, and opens nothing.
    const world = worldOf({});
    const answer = await handleWonderlandJuliusRoute(request('/wonderland/julius/events', `projectId=${PROJECT}&runId=${RUN}&mode=page&cursor=0x10`), deps({ world }));
    expect(answer?.status).toBe(400);
    expect(world.opened()).toBe(0);
  });

  it('reads the run id the client sends RAW, colon and all, and the url-encoded spelling the same', () => {
    // The Unreal client sends `runId=run:<hex>` unencoded (RunQuery, WonderlandJuliusStream.cpp).
    expect(readWonderlandJuliusQuery(`/x?projectId=${PROJECT}&runId=run:0a1b&cursor=0`)?.runId).toBe('run:0a1b');
    expect(readWonderlandJuliusQuery(`/x?projectId=${PROJECT}&runId=run%3A0a1b&cursor=0`)?.runId).toBe('run:0a1b');
  });

  it('claims only its own three paths', () => {
    expect(isWonderlandJuliusRoute('/wonderland/julius/hydrate')).toBe(true);
    expect(isWonderlandJuliusRoute('/wonderland/julius/events')).toBe(true);
    expect(isWonderlandJuliusRoute('/wonderland/julius/result')).toBe(true);
    expect(isWonderlandJuliusRoute('/wonderland/julius/missions')).toBe(false);
    expect(isWonderlandJuliusRoute('/wonderland/events')).toBe(false);
    expect(isWonderlandJuliusRoute('/wonderland/presence/join')).toBe(false);
    expect(isWonderlandJuliusRoute('/wonderland/julius/constructor')).toBe(false);
  });

  it('serves /events one PAGE per request: without mode=page it opens nothing and reads nothing', async () => {
    const world = worldOf({});
    for (const query of [`projectId=${PROJECT}&runId=${RUN}`, `projectId=${PROJECT}&runId=${RUN}&mode=stream`]) {
      const answer = await handleWonderlandJuliusRoute(request('/wonderland/julius/events', query), deps({ world }));
      expect(answer?.status, query).toBe(400);
    }
    expect(world.opened()).toBe(0);
  });
});

/* ------------------------------------------------------ the authorisation */

describe('a route that will not open without its authorisation', () => {
  it('refuses with 503 when no world is configured -- after the session, and never as a denial', async () => {
    // THE TEST THIS FILE EXISTS FOR. Not a 404 -- the request was fine and this
    // deployment cannot answer it, and reporting it as a permission problem
    // would send somebody hunting permissions that were never the issue.
    for (const world of [undefined, null]) {
      const answer = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), { sessions: sessions('player-1'), world });
      expect(answer).toEqual({ status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } });
    }
  });

  it('says WHY in the operator\'s log -- world_not_configured, never a store failure -- on every route (internal review A2)', async () => {
    // The 503 alone could not tell the guard was there: without it, `world.read` on null throws inside the route's
    // own try, and the catch ALSO answers 503 (store_unavailable). So the guard is pinned by the line it writes.
    for (const world of [undefined, null]) {
      for (const route of ['hydrate', 'events', 'result'] as const) {
        const lines: string[] = [];
        const answer = await handleWonderlandJuliusRoute(request(`/wonderland/julius/${route}`), {
          sessions: sessions('player-1'), world, log: (line) => lines.push(line),
        });
        expect(answer, `${route} ${String(world)}`).toEqual({ status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } });
        expect(lines, `${route} ${String(world)}`).toEqual([`wonderland julius ${route}: 503 world_not_configured player=player-1 project=${PROJECT} run=${RUN}`]);
      }
    }
  });

  it('never reaches the membership check -- or opens a transaction -- without a session', async () => {
    let asked = false;
    const world = worldOf({
      membership: {
        lookup: async ({ playerId, projectId }) => {
          asked = true;
          return { playerId, projectId, role: 'OWNER' };
        },
      },
    });
    const anonymous = await handleWonderlandJuliusRoute({ ...request('/wonderland/julius/events'), authorization: undefined }, deps({ world }));
    expect(anonymous?.status).toBe(401);
    const expired = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({ world, sessions: sessions('player-1', false) }));
    expect(expired?.status).toBe(401);
    // A valid session that is not a native world session (one naming no player) is the wrong kind of session: the one 404.
    const nobody = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({ world, sessions: sessions(null) }));
    expect(nobody).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
    expect(asked).toBe(false);
    expect(world.opened()).toBe(0);
  });

  it('refuses a player who is not a member of the project -- the one 404', async () => {
    const answer = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({
      parts: { reader: reader(), membership: membership(false) },
    }));
    expect(answer).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
  });

  it('asks membership about the project in the QUERY, for the sessionholder', async () => {
    // A membership check against the wrong project would authorise the wrong
    // read, and one against the wrong player would authorise the wrong person.
    const asked: { playerId?: string; projectId?: string } = {};
    await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({
      sessions: sessions('player-7'),
      parts: {
        membership: {
          lookup: async (input) => {
            asked.playerId = input.playerId;
            asked.projectId = input.projectId;
            return { playerId: input.playerId, projectId: input.projectId, role: 'OWNER' };
          },
        },
      },
    }));
    expect(asked).toEqual({ playerId: 'player-7', projectId: PROJECT });
  });

  it('reads exactly the project and run that were asked for, and nothing else', async () => {
    const source = reader();
    const answer = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({ parts: { reader: source } }));
    expect(answer?.status).toBe(200);
    expect(source.calls.asked).toEqual([{ projectId: PROJECT, runId: RUN }]);
  });

  it('refuses an identified caller\'s bad query with 400, and opens nothing for it', async () => {
    const world = worldOf({});
    const answer = await handleWonderlandJuliusRoute(
      { ...request('/wonderland/julius/events'), url: '/wonderland/julius/events' },
      deps({ world }),
    );
    expect(answer?.status).toBe(400);
    expect(world.opened()).toBe(0);
  });

  it('identifies the caller FIRST: an anonymous malformed request is 401, an identified one 400 (review N1)', async () => {
    const world = worldOf({});
    const malformed = [
      '/wonderland/julius/events',
      `/wonderland/julius/events?projectId=${PROJECT}&mode=page`,
      `/wonderland/julius/events?runId=${RUN}&mode=page`,
      `/wonderland/julius/events?projectId=${PROJECT}&runId=${RUN}&cursor=-1&mode=page`,
      `/wonderland/julius/events?projectId=${PROJECT}&runId=${RUN}`,
    ];
    for (const url of malformed) {
      const asked = (over: Partial<ReturnType<typeof request>>, from: WonderlandJuliusRouteDeps) =>
        handleWonderlandJuliusRoute({ ...request('/wonderland/julius/events'), url, ...over }, from);
      // NOT IDENTIFIED -- no session, or a lapsed one: the query is not even read. 401, as R3 says.
      expect((await asked({ authorization: undefined }, deps({ world })))?.status, `anonymous ${url}`).toBe(401);
      expect((await asked({}, deps({ world, sessions: sessions('player-1', false) })))?.status, `expired ${url}`).toBe(401);
      // IDENTIFIED: now the query is answered.
      expect((await asked({}, deps({ world })))?.status, `identified ${url}`).toBe(400);
      // REFUSED FOR WHO IT IS: the one 404, whatever it asked -- the operator, and a browser (an Origin).
      expect(await asked({ authorization: `Bearer ${OPERATOR}` }, deps({ world, operatorToken: OPERATOR })), `operator ${url}`)
        .toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
      expect(await asked({ origin: WEB }, deps({ world })), `browser ${url}`).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
    }
    expect(world.opened()).toBe(0);
  });

  it('answers an identifier that cannot name anything as absent, and opens nothing for it', async () => {
    const world = worldOf({});
    for (const query of [
      `projectId=${encodeURIComponent('project alpha')}&runId=${RUN}`,
      `projectId=${PROJECT}&runId=${encodeURIComponent('run 1; DROP')}`,
      `projectId=${PROJECT}&runId=${'r'.repeat(129)}`,
    ]) {
      const answer = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate', query), deps({ world }));
      expect(answer, query).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
    }
    expect(world.opened()).toBe(0);
  });
});

/* ---------------------------------------------------- who may call: R3 */

describe('ONE door, the native client\'s: every browser is refused, and the operator is not a player (review N5)', () => {
  const nativeFor = (store: BrowserSessionStore, projectId = PROJECT): string => {
    const grant = store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: NOW, scope: 'native_world', participantId: 'player-1', projectId });
    const redeemed = store.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: NATIVE_WORLD_AUDIENCE, now: NOW });
    if (!redeemed.ok) throw new Error('fixture could not redeem');
    return redeemed.session.token;
  };
  const browserFor = (store: BrowserSessionStore): string => {
    const minted = store.mintIdentitySession({ origin: WEB, now: NOW, participantId: 'player-1', scope: 'browser_control' });
    if (!minted.ok) throw new Error('fixture could not sign in');
    return minted.session.token;
  };
  const ask = (store: BrowserSessionStore, auth: string | undefined, origin: string | undefined, over: { now?: number; projectId?: string } = {}) =>
    handleWonderlandJuliusRoute({
      ...request('/wonderland/julius/hydrate', `projectId=${over.projectId ?? PROJECT}&runId=${RUN}`),
      authorization: auth,
      origin,
      now: over.now ?? NOW,
    }, { sessions: store, operatorToken: OPERATOR, world: worldOf({ reader: reader([], hydrationFor()) }) });

  it('CONTROL: the native client -- a native_world session and NO Origin -- is admitted', async () => {
    const store = createBrowserSessionStore();
    expect((await ask(store, `Relay-Session ${nativeFor(store)}`, undefined))?.status).toBe(200);
  });

  it('a signed-in BROWSER session, from its own approved Origin, is the one 404: the browser door is gone', async () => {
    const store = createBrowserSessionStore();
    expect(await ask(store, `Relay-Session ${browserFor(store)}`, WEB)).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
  });

  it('a BROWSER session with no Origin is the wrong kind of session: the one 404', async () => {
    const store = createBrowserSessionStore();
    expect(await ask(store, `Relay-Session ${browserFor(store)}`, undefined)).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
  });

  it('a request CARRYING AN ORIGIN is the one 404 whatever it holds -- a valid native session too -- and no session is looked up', async () => {
    const store = createBrowserSessionStore();
    const valid = nativeFor(store);
    const lapsed = nativeFor(store);
    let lookedUp = 0;
    const counting: BrowserSessionStore = {
      ...store,
      verifyNativeSession: (input) => { lookedUp += 1; return store.verifyNativeSession(input); },
      verifySession: (input) => { lookedUp += 1; return store.verifySession(input); },
    };
    const askWith = (auth: string, origin: string, now = NOW) => handleWonderlandJuliusRoute({
      ...request('/wonderland/julius/hydrate', `projectId=${PROJECT}&runId=${RUN}`), authorization: auth, origin, now,
    }, { sessions: counting, world: worldOf({ reader: reader([], hydrationFor()) }) });
    for (const origin of [WEB, 'https://evil.example', 'null', '']) {
      expect(await askWith(`Relay-Session ${valid}`, origin), `valid native, Origin ${JSON.stringify(origin)}`)
        .toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
      // Not 401 for a lapsed or unknown token either: with an Origin, the token is never asked about.
      expect(await askWith(`Relay-Session ${lapsed}`, origin, NOW + NATIVE_SESSION_TTL_MS))
        .toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
      expect(await askWith('Relay-Session never-issued', origin)).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
    }
    expect(lookedUp).toBe(0);
    // An Origin with NO credential is still anonymous: 401, the client pairs again (R3).
    expect((await handleWonderlandJuliusRoute({ ...request('/wonderland/julius/hydrate'), authorization: undefined, origin: WEB },
      { sessions: counting, world: worldOf({}) }))?.status).toBe(401);
    // CONTROL: the same valid token without the Origin is admitted, so the 404s above are the Origin's.
    expect((await ask(store, `Relay-Session ${valid}`, undefined))?.status).toBe(200);
  });

  it('a browser session from ANOTHER origin is the one 404, not a sign-in prompt', async () => {
    const store = createBrowserSessionStore();
    expect(await ask(store, `Relay-Session ${browserFor(store)}`, 'https://evil.example')).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
  });

  it('the OPERATOR bearer token is not a player: the one 404, and no transaction is opened for it', async () => {
    const store = createBrowserSessionStore();
    const world = worldOf({ reader: reader([], hydrationFor()) });
    for (const origin of [undefined, WEB]) {
      const answer = await handleWonderlandJuliusRoute(
        { ...request('/wonderland/julius/result'), authorization: `Bearer ${OPERATOR}`, origin },
        { sessions: store, operatorToken: OPERATOR, world },
      );
      expect(answer).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
    }
    expect(world.opened()).toBe(0);
    // CONTROL: a bearer that is NOT the operator credential is no session at all -- 401, not the 404.
    expect((await ask(store, 'Bearer not-the-operator-credential', undefined))?.status).toBe(401);
  });

  it('an EXPIRED native session is 401 -- the client pairs again -- and so is a REVOKED one', async () => {
    const store = createBrowserSessionStore();
    const token = nativeFor(store);
    expect((await ask(store, `Relay-Session ${token}`, undefined, { now: NOW + NATIVE_SESSION_TTL_MS - 1 }))?.status).toBe(200);
    expect(await ask(store, `Relay-Session ${token}`, undefined, { now: NOW + NATIVE_SESSION_TTL_MS }))
      .toEqual({ status: 401, body: { error: 'authenticated player identity required' } });
    const revoked = nativeFor(store);
    store.revokeSession({ token: revoked, now: NOW });
    expect((await ask(store, `Relay-Session ${revoked}`, undefined))?.status).toBe(401);
    expect((await ask(store, 'Relay-Session never-issued', undefined))?.status).toBe(401);
  });

  it('a native session asking for a project it was NOT paired for is the one 404, before membership is asked', async () => {
    const store = createBrowserSessionStore();
    let asked = 0;
    const answer = await handleWonderlandJuliusRoute({
      ...request('/wonderland/julius/hydrate', `projectId=project-beta&runId=${RUN}`),
      authorization: `Relay-Session ${nativeFor(store)}`,
      origin: undefined,
    }, {
      sessions: store,
      world: worldOf({ membership: { lookup: async ({ playerId, projectId }) => { asked += 1; return { playerId, projectId, role: 'OWNER' }; } } }),
    });
    expect(answer).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
    expect(asked).toBe(0);
  });

  it('identifies the caller from the credential alone', () => {
    const store = createBrowserSessionStore();
    expect(identifyWonderlandJuliusCaller({ authorization: `Relay-Session ${nativeFor(store)}`, origin: undefined, now: NOW }, { sessions: store }))
      .toMatchObject({ ok: true, playerId: 'player-1', boundProjectId: PROJECT });
    expect(identifyWonderlandJuliusCaller({ authorization: `Relay-Session ${browserFor(store)}`, origin: WEB, now: NOW }, { sessions: store }))
      .toEqual({ ok: false, status: 404, reason: 'a_browser_has_no_door' });
    expect(identifyWonderlandJuliusCaller({ authorization: `Relay-Session ${browserFor(store)}`, origin: undefined, now: NOW }, { sessions: store }))
      .toEqual({ ok: false, status: 404, reason: 'not_a_native_session' });
    expect(identifyWonderlandJuliusCaller({ authorization: undefined, origin: undefined, now: NOW }, { sessions: store }))
      .toEqual({ ok: false, status: 401, reason: 'no_session' });
  });
});

/* --------------------------------------------------- the attacks it stops */

describe('a run id is not a way to pick your own authorisation', () => {
  it('refuses a run belonging to another project, even for a real member', async () => {
    // THE ATTACK THE ROUTE IS SHAPED AROUND. Name somebody else's run, be
    // authorised for a project you DO belong to, and read a run you do not.
    // The authorisation decides a project; the run must belong to THAT
    // project, never the other way round.
    const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), deps({
      // A reader that failed to filter -- which is exactly the case this
      // check exists to survive.
      parts: { reader: reader([], hydrationFor('project-beta', 'run-elsewhere')) },
    }));
    expect(result).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
  });

  it('refuses a hydration of ANOTHER run of the right project, which the client would refuse anyway', async () => {
    const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), deps({
      parts: { reader: reader([], hydrationFor(PROJECT, 'run-2')) },
    }));
    expect(result).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
  });

  it('never resolves a project FROM the run id', async () => {
    // Resolving a project from an attacker-supplied run would let somebody
    // name a run, have the server discover its project, and be authorised
    // against the project they just caused it to pick.
    const asked: string[] = [];
    await handleWonderlandJuliusRoute(
      request('/wonderland/julius/hydrate', `projectId=${PROJECT}&runId=run-belonging-to-someone-else`),
      deps({
        parts: {
          reader: reader([], hydrationFor()),
          membership: {
            lookup: async (input) => {
              asked.push(input.projectId);
              return { playerId: input.playerId, projectId: input.projectId, role: 'OWNER' };
            },
          },
        },
      }),
    );
    // Exactly one lookup, against the project in the query and nothing else.
    expect(asked).toEqual([PROJECT]);
  });

  it('gives a missing run, a foreign run and a non-member the same answer, byte for byte', async () => {
    // A 404 that appeared only for runs that do not exist would confirm the
    // existence of every run that does; a 403 for a non-member would confirm
    // the project.
    const missing = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), deps({ parts: { reader: reader([], null) } }));
    const forbidden = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), deps({ parts: { reader: reader([], hydrationFor('project-beta')) } }));
    const stranger = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), deps({ parts: { membership: membership(false) } }));
    // The page route, for a project the session IS paired for and that has no such run (the reader answers null).
    const absentPage = await handleWonderlandJuliusRoute(request('/wonderland/julius/events', `projectId=project-beta&runId=${RUN}&mode=page`),
      deps({ sessions: sessions('player-1', true, 'project-beta') }));
    for (const answer of [missing, forbidden, stranger, absentPage]) {
      expect(answer?.status).toBe(404);
      expect(JSON.stringify(answer?.body)).toBe(JSON.stringify(missing?.body));
    }
  });
});

describe('membership is asked per request, never cached into the session', () => {
  it('stops reading the moment a membership is revoked', async () => {
    // A session issued while somebody was a member must not keep working.
    let member = true;
    const world = worldOf({
      reader: reader([row(1, 'run.transitioned', { to: 'EXECUTING' })], hydrationFor()),
      membership: {
        lookup: async ({ playerId, projectId }) => (member ? { playerId, projectId, role: 'OWNER' } : null),
      },
    });

    const before = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({ world }));
    expect(before?.status).toBe(200);

    member = false;
    const after = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({ world }));
    expect(after).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
  });

  it('re-authorises when the same player, paired for a DIFFERENT project, asks about it', async () => {
    // A native session is bound to one project, so reading another takes a second pairing -- and that is a NEW
    // request to authorise, not a continuation of one already granted. The player is the same, and that carries
    // no permission across a project boundary.
    const asked: string[] = [];
    const world = worldOf({
      reader: reader([row(1, 'run.transitioned', { to: 'EXECUTING' })], hydrationFor()),
      membership: {
        lookup: async ({ playerId, projectId }) => {
          asked.push(projectId);
          return projectId === PROJECT ? { playerId, projectId, role: 'OWNER' } : null;
        },
      },
    });

    const first = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({ world }));
    expect(first?.status).toBe(200);

    const switched = await handleWonderlandJuliusRoute(
      request('/wonderland/julius/events', `projectId=project-beta&runId=${RUN}&mode=page`),
      deps({ world, sessions: sessions('player-1', true, 'project-beta') }),
    );
    expect(switched).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });

    // Asked about the project in each QUERY, in order -- never once about the
    // first and then assumed for the second.
    expect(asked).toEqual([PROJECT, 'project-beta']);
  });

  it('scopes the read to the project each request named, with nothing carried over', async () => {
    // The positive half: a project a member is entitled to read succeeds, and
    // what is read is scoped to THAT project. A grant that still named the
    // first would send the second project's reader the wrong filter.
    const source = reader();
    const world = worldOf({ reader: source });
    await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({ world }));
    await handleWonderlandJuliusRoute(request('/wonderland/julius/events', 'projectId=project-beta&runId=run-9&mode=page'),
      deps({ world, sessions: sessions('player-1', true, 'project-beta') }));
    expect(source.calls.asked).toEqual([{ projectId: PROJECT, runId: RUN }, { projectId: 'project-beta', runId: 'run-9' }]);
  });

  it('asks the membership port once for every request, and never fewer -- each in its own transaction', async () => {
    // Memoising a decision per session is the shortcut this forbids: it would
    // make revocation and a project switch both invisible.
    let calls = 0;
    const world = worldOf({
      membership: {
        lookup: async ({ playerId, projectId }) => {
          calls += 1;
          return { playerId, projectId, role: 'OWNER' };
        },
      },
    });
    for (let i = 0; i < 3; i += 1) {
      await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({ world }));
    }
    expect(calls).toBe(3);
    expect(world.opened()).toBe(3);
  });

  it('denies a role the build does not recognise', async () => {
    // The column has no CHECK constraint. A role the product starts writing
    // before the capability table learns about it grants nothing.
    const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({
      parts: { membership: { lookup: async ({ playerId, projectId }) => ({ playerId, projectId, role: 'VIEWER' }) } },
    }));
    expect(result).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
  });

  it('answers 503 when the membership store cannot be reached, or the world cannot open', async () => {
    // NOT a denial. The request may have been perfectly authorised and the
    // deployment could not check; calling that a denial sends an operator
    // hunting permissions that were never the issue.
    const unreachable = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({
      parts: { membership: { lookup: async () => { throw new Error('connection refused'); } } },
    }));
    expect(unreachable).toEqual({ status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } });
    const unopened = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({
      world: { read: async () => { throw Object.assign(new Error('too many clients'), { code: '53300' }); } },
    }));
    expect(unopened).toEqual({ status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } });
  });

  it('answers 503 when a READ fails, never an empty page or a missing run', async () => {
    const broken: WonderlandJuliusReader = {
      hydrate: async () => { throw new Error('the database went away'); },
      events: async () => { throw new Error('the database went away'); },
    };
    for (const path of ['/wonderland/julius/hydrate', '/wonderland/julius/events']) {
      expect(await handleWonderlandJuliusRoute(request(path), deps({ parts: { reader: broken } })), path)
        .toEqual({ status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } });
    }
  });

  it('reports every decision to the operator hook, granted or not', async () => {
    const decisions: string[] = [];
    for (const allowed of [true, false]) {
      await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({
        parts: { membership: membership(allowed) },
        onAuthorization: (decision) => decisions.push(decision.verdict),
      }));
    }
    expect(decisions).toEqual(['granted', 'not_a_member']);
  });

  it('keeps the operator’s reason out of every response body -- and in the log, as a word and ids only', async () => {
    const lines: string[] = [];
    for (const source of [
      { lookup: async () => null },
      { lookup: async ({ playerId, projectId }: { playerId: string; projectId: string }) => ({ playerId, projectId, role: 'GUEST' }) },
    ]) {
      const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({
        parts: { membership: source as never },
        log: (line) => lines.push(line),
      }));
      const body = JSON.stringify(result?.body);
      expect(body).toBe(JSON.stringify({ error: 'permission denied' }));
      expect(body).not.toContain('member');
      expect(body).not.toContain('role');
      expect(body).not.toContain(PROJECT);
    }
    expect(lines).toEqual([
      `wonderland julius events: 404 not_a_member player=player-1 project=${PROJECT} run=${RUN}`,
      `wonderland julius events: 404 unrecognised_role player=player-1 project=${PROJECT} run=${RUN}`,
    ]);
  });

  it('logs a store failure by its SQLSTATE only -- never the driver message, which can quote a value', async () => {
    const lines: string[] = [];
    await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), deps({
      world: { read: async () => { throw Object.assign(new Error('value "hunter2" violates something'), { code: '25006' }); } },
      log: (line) => lines.push(line),
    }));
    expect(lines).toEqual([`wonderland julius hydrate: 503 store_unavailable sqlstate=25006 player=player-1 project=${PROJECT} run=${RUN}`]);
    expect(lines.join('\n')).not.toContain('hunter2');
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
    expect(page?.deliveries.length).toBe(1);
    expect(page?.nextCursor).toBe(1);
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
    expect(page?.deliveries.length).toBe(1);
    expect(page?.nextCursor).toBe(3);
    expect(page?.summary.silent).toBe(2);
  });

  it('leaves the cursor where it was when the run has nothing new', async () => {
    const page = await serveWonderlandJuliusPage(grant, 40, {
      reader: reader([row(1, 'run.transitioned', { to: 'EXECUTING' })]),
      worldSessionId: null,
    });
    expect(page?.deliveries).toEqual([]);
    expect(page?.nextCursor).toBe(40);
  });

  it('reads from the cursor and bounds the page', async () => {
    const rows = Array.from({ length: 900 }, (_, index) =>
      row(index + 1, 'run.transitioned', { to: index % 2 === 0 ? 'PLANNING' : 'EXECUTING' }),
    );
    const page = await serveWonderlandJuliusPage(grant, 10, {
      reader: reader(rows),
      worldSessionId: null,
    });
    expect(page?.nextCursor).toBe(10 + WONDERLAND_JULIUS_PAGE_LIMIT);
  });

  it('is null -- not an empty page -- for a run the project does not have', async () => {
    expect(await serveWonderlandJuliusPage({ projectId: 'project-beta', runId: RUN }, 0, { reader: reader(), worldSessionId: null })).toBeNull();
  });
});

/* ------------------------------------------------------------ dispatch */

describe('the handler', () => {
  it('ignores paths and methods that are not its own -- only GET is routed', async () => {
    const world = worldOf({});
    expect(await handleWonderlandJuliusRoute(request('/wonderland/events'), deps({ world }))).toBeNull();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      for (const path of ['/wonderland/julius/hydrate', '/wonderland/julius/events', '/wonderland/julius/result']) {
        expect(await handleWonderlandJuliusRoute({ ...request(path), method }, deps({ world })), `${method} ${path}`).toBeNull();
      }
    }
    expect(world.opened()).toBe(0);
  });

  it('serves a hydration when the run exists', async () => {
    const hydration = hydrationFor();
    const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), deps({ parts: { reader: reader([], hydration) } }));
    expect(result?.status).toBe(200);
    expect((result?.body as { data: unknown }).data).toBe(hydration);
  });

  it('says 404 for a run this project does not have', async () => {
    const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/hydrate'), deps({ parts: { reader: reader([], null) } }));
    expect(result).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
  });

  it('does not read a single row before authorising', async () => {
    const source = reader([row(1, 'run.transitioned', { to: 'EXECUTING' })]);
    await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({
      parts: { reader: source, membership: membership(false) },
    }));
    expect(source.calls.events).toBe(0);
  });

  it('returns one page as a body: deliveries and the position it ended at', async () => {
    const result = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({
      parts: { reader: reader([row(1, 'run.transitioned', { to: 'EXECUTING' })]) },
    }));
    expect(result?.status).toBe(200);
    const data = (result?.body as { data: { deliveries: unknown[]; nextCursor: number } }).data;
    expect(data.deliveries.length).toBe(1);
    expect(data.nextCursor).toBe(1);
  });

  it('resumes from the cursor the client sends -- the next page starts after it, and nothing is served twice', async () => {
    const rows = [1, 2, 3, 4].map((sequence) => row(sequence, 'run.transitioned', { to: sequence % 2 === 0 ? 'REVIEWING' : 'EXECUTING' }));
    const world = worldOf({ reader: reader(rows) });
    const sequencesOf = (answer: unknown) =>
      ((answer as { body: { data: { deliveries: Array<{ envelope: { sequence: number } }> } } }).body.data.deliveries)
        .map((delivery) => delivery.envelope.sequence);
    const first = await handleWonderlandJuliusRoute(request('/wonderland/julius/events', `projectId=${PROJECT}&runId=${RUN}&mode=page&cursor=0`), deps({ world }));
    const resumed = await handleWonderlandJuliusRoute(request('/wonderland/julius/events', `projectId=${PROJECT}&runId=${RUN}&mode=page&cursor=2`), deps({ world }));
    expect(sequencesOf(first)).toEqual([1, 2, 3, 4]);
    expect(sequencesOf(resumed)).toEqual([3, 4]);
    expect((resumed as { body: { data: { nextCursor: number } } }).body.data.nextCursor).toBe(4);
  });
});

/* ------------------------------------------- a page is the asked run's */

describe('a page is the asked run\'s, row by row (internal review A1)', () => {
  // The reader keys its page by (project, run) in SQL (reader-postgres pins `r.project_id=$2`). The route does not
  // take that on trust, as hydrate does not: a reader that answers with ONE row of another project -- or of another
  // run -- makes the whole page the one 404, never a 200 carrying a foreign position and a count of refusals.
  const STRAYS = [
    ['another project', { projectId: 'project-beta' }],
    ['another run of this project', { streamId: 'run-2' }],
    ['another project and run', { projectId: 'project-beta', streamId: 'run-2' }],
  ] as const;

  /** A reader that LIES: asked for RUN in PROJECT, it answers with the run's rows plus one stray, at `at`. */
  const lying = (stray: Partial<WonderlandLedgerRow>, at: number): WonderlandJuliusReader & { readonly asked: () => number } => {
    let asked = 0;
    return {
      asked: () => asked,
      hydrate: async () => null,
      events: async () => {
        asked += 1;
        const rows: WonderlandLedgerRow[] = [1, 2, 3].map((sequence) => row(sequence, 'run.transitioned', { to: sequence % 2 === 0 ? 'REVIEWING' : 'EXECUTING' }));
        rows.splice(at, 0, { ...row(9, 'run.transitioned', { to: 'REVIEWING' }), ...stray });
        return { rows, revision: 7 };
      },
    };
  };

  it('answers the one 404 -- byte for byte -- when the reader slips in a row of another project or run, wherever it sits', async () => {
    for (const [label, stray] of STRAYS) {
      for (const at of [0, 2, 3]) {
        const lines: string[] = [];
        const source = lying(stray, at);
        const answer = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({
          parts: { reader: source },
          log: (line) => lines.push(line),
        }));
        expect(source.asked(), `${label} @${at}`).toBe(1);
        expect(answer, `${label} @${at}`).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
        expect(answer?.body, `${label} @${at}`).toBe(WONDERLAND_JULIUS_NOT_FOUND);
        expect(JSON.stringify(answer?.body), `${label} @${at}`).not.toMatch(/nextCursor|deliveries|summary|project-beta|run-2/u);
        expect(lines, `${label} @${at}`).toEqual([`wonderland julius events: 404 no_such_run player=player-1 project=${PROJECT} run=${RUN}`]);
      }
    }
  });

  it('and the page function itself serves nothing for such a page', async () => {
    for (const [label, stray] of STRAYS) {
      expect(await serveWonderlandJuliusPage({ projectId: PROJECT, runId: RUN }, 0, { reader: lying(stray, 1), worldSessionId: null }), label).toBeNull();
    }
  });

  it('CONTROL: the same reader with the stray row spelled as the asked run\'s serves the whole page', async () => {
    const answer = await handleWonderlandJuliusRoute(request('/wonderland/julius/events'), deps({
      parts: { reader: lying({ projectId: PROJECT, streamId: RUN }, 3) },
    }));
    expect(answer?.status).toBe(200);
    const data = (answer?.body as { data: { deliveries: unknown[]; nextCursor: number; summary: Record<string, number> } }).data;
    expect(data.deliveries.length).toBe(4);
    expect(data.nextCursor).toBe(9);
    expect(data.summary.unauthorized_project).toBe(0);
    expect(data.summary.unauthorized_run).toBe(0);
  });
});
