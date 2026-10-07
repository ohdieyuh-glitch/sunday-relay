import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_JULIUS_BILLING_MAX_PAGES,
  WONDERLAND_JULIUS_NOT_FOUND,
  WONDERLAND_WORLD_CALLER_TENANT,
  handleWonderlandJuliusRoute,
  isWonderlandJuliusRoute,
  wonderlandJuliusResultsFrom,
} from './wonderland-julius-routes';
import type {
  WonderlandJuliusReader,
  WonderlandJuliusResultSource,
  WonderlandJuliusRouteDeps,
  WonderlandProjectMembershipSource,
} from './wonderland-julius-routes';
import { createBrowserSessionStore, NATIVE_WORLD_AUDIENCE } from './browser-session/grants';
import type { BrowserSessionStore } from './browser-session/grants';
import type {
  JuliusApiIdentity,
  JuliusApiResult,
  JuliusMissionResultView,
  JuliusSlotView,
  JuliusTimelineEntry,
  JuliusTimelinePage,
} from '../src/relay/mission/julius/julius-runtime-api';
import { JULIUS_DEFAULT_ROLES } from '../src/relay/mission/julius/julius-runtime';
import type { WonderlandJuliusBillingRecord } from '../src/relay/mission/wonderland/wonderland-julius-result';
import {
  WONDERLAND_DENIAL_MESSAGE,
  WONDERLAND_UNAVAILABLE_MESSAGE,
} from '../src/relay/mission/wonderland/wonderland-authorization';

/**
 * GET /wonderland/julius/result -- THE USER RESULT, BEHIND THE WORLD'S OWN DOOR.
 *
 * Founder decision 5: members see a safe USER RESULT; exact cost is the OWNER's
 * and an authorised ADMIN's. The route asks the SAME membership row two
 * questions -- may this player read the result, and may they read its cost --
 * and every refusal here has a control that the same call succeeds when the one
 * thing under test is right.
 */

const NOW = 1_790_000_000_000;
const WEB = 'https://sunday-relay.vercel.app';
const PLAYER = 'ghu-424242';
const PROJECT = 'project-alpha';
const RUN = 'run:0001';

const resultView = (over: Partial<JuliusMissionResultView> = {}): JuliusMissionResultView => ({
  runId: RUN,
  missionId: 'mission:alpha',
  state: 'READY',
  verified: false,
  terminal: false,
  criteria: [{ criterionId: 'c-1', description: 'The mission is complete', requiredEvidenceTypes: [],
    satisfied: false, basis: 'COMPLETION', evidenceIds: [] }],
  deliverables: [],
  outstandingFindings: [],
  reviewDecisions: [],
  cost: { knownUsdMicros: 4_200, unknownComponents: 1, complete: false },
  failure: null,
  ...over,
});

/** A source that answers for RUN in PROJECT only, and records what it was asked. */
const source = (view: JuliusMissionResultView | null = resultView()) => {
  const asked: Array<{ projectId: string; runId: string; actorId: string }> = [];
  const results: WonderlandJuliusResultSource = {
    async result(input) {
      asked.push({ ...input });
      return input.projectId === PROJECT && input.runId === RUN ? view : null;
    },
  };
  return { results, asked };
};

/** Membership by (player, project) -> role. */
const members = (rows: Record<string, string>): WonderlandProjectMembershipSource => ({
  lookup: async ({ playerId, projectId }) => {
    const role = rows[`${playerId}|${projectId}`];
    return role === undefined ? null : { playerId, projectId, role };
  },
});

/** The table the product has DECIDED (decisions 4 and 5) but does not write yet -- injected, never the canonical one. */
const DECIDED = Object.freeze({
  OWNER: Object.freeze(['read_world_state', 'read_mission_result', 'read_mission_cost'] as const),
  ADMIN: Object.freeze(['read_world_state', 'read_mission_result', 'read_mission_cost'] as const),
  MEMBER: Object.freeze(['read_world_state', 'read_mission_result'] as const),
  WATCHER: Object.freeze(['read_world_state'] as const),
});

function signedIn(store: BrowserSessionStore): string {
  const minted = store.mintIdentitySession({ origin: WEB, now: NOW, participantId: PLAYER, scope: 'browser_control' });
  if (!minted.ok) throw new Error('fixture could not sign in');
  return minted.session.token;
}

function nativeFor(store: BrowserSessionStore, projectId: string): string {
  const grant = store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: NOW, scope: 'native_world', participantId: PLAYER, projectId });
  const redeemed = store.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: NATIVE_WORLD_AUDIENCE, now: NOW });
  if (!redeemed.ok) throw new Error('fixture could not redeem');
  return redeemed.session.token;
}

const request = (token: string | null, origin: string | undefined, projectId = PROJECT, path = '/wonderland/julius/result') => ({
  method: 'GET',
  path,
  url: `${path}?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(RUN)}${path.endsWith('/events') ? '&mode=page' : ''}`,
  authorization: token === null ? undefined : `Relay-Session ${token}`,
  origin,
  now: NOW,
});

/** An empty run for the world's own two routes: it exists, and nothing has happened in it yet. */
const EMPTY_RUN: WonderlandJuliusReader = { hydrate: async () => null, events: async () => ({ rows: [], revision: 1 }) };

/**
 * The route's dependencies, with the three reads composed into the world port the
 * way production composes them: one scope per request (the read-only transaction
 * is wonderland-julius-world.ts's, and proven there).
 */
const deps = (store: BrowserSessionStore, over: Partial<WonderlandJuliusRouteDeps> & {
  readonly membership?: WonderlandProjectMembershipSource;
  readonly results?: WonderlandJuliusResultSource;
  readonly reader?: WonderlandJuliusReader;
} = {}): WonderlandJuliusRouteDeps => {
  const { membership, results, reader, ...rest } = over;
  const scope = {
    membership: membership ?? members({ [`${PLAYER}|${PROJECT}`]: 'OWNER' }),
    results: results ?? source().results,
    reader: reader ?? EMPTY_RUN,
  };
  return { sessions: store, world: { read: async (work) => work(scope) }, ...rest };
};

const dataOf = (answer: { body: unknown } | null) => (answer?.body as { data: Record<string, unknown> }).data;

describe('the route', () => {
  it('is one of the world routes, and GET only', async () => {
    expect(isWonderlandJuliusRoute('/wonderland/julius/result')).toBe(true);
    const store = createBrowserSessionStore();
    expect(await handleWonderlandJuliusRoute({ ...request(signedIn(store), WEB), method: 'POST' }, deps(store))).toBeNull();
  });

  it('the OWNER reads the user result, with its exact cost, and tokens UNKNOWN', async () => {
    const store = createBrowserSessionStore();
    const answer = await handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store));
    expect(answer?.status).toBe(200);
    expect(dataOf(answer)).toMatchObject({
      runId: RUN, juliusState: 'READY', taskState: 'Queued', verified: false, terminal: false, tokens: 'UNKNOWN',
      cost: { visible: true, knownUsdMicros: 4_200, unknownComponents: 1, complete: false },
    });
  });

  it('asks Julius for the AUTHORISED project and run, as the player -- never anything the caller did not name', async () => {
    const store = createBrowserSessionStore();
    const { results, asked } = source();
    await handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store, { results }));
    expect(asked).toEqual([{ projectId: PROJECT, runId: RUN, actorId: PLAYER }]);
  });
});

describe('COST is the owner\'s and an admin\'s, never an ordinary member\'s (founder decision 5)', () => {
  const as = async (role: string) => {
    const store = createBrowserSessionStore();
    return handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store, {
      membership: members({ [`${PLAYER}|${PROJECT}`]: role }), roleCapabilities: DECIDED,
    }));
  };

  it('a MEMBER reads the result WITHOUT its cost -- not zero, not a floor, absent', async () => {
    const answer = await as('MEMBER');
    expect(answer?.status).toBe(200);
    expect(dataOf(answer).cost).toEqual({ visible: false });
    expect(JSON.stringify(answer?.body)).not.toContain('4200');
  });

  it('CONTROL: an OWNER and an ADMIN, by the same table, see it', async () => {
    for (const role of ['OWNER', 'ADMIN']) {
      expect(dataOf(await as(role)).cost, role).toMatchObject({ visible: true, knownUsdMicros: 4_200 });
    }
  });

  it('a role that may watch the world but not read results is refused the result -- and still admitted to the world', async () => {
    const store = createBrowserSessionStore();
    const token = signedIn(store);
    const watcher = deps(store, { membership: members({ [`${PLAYER}|${PROJECT}`]: 'WATCHER' }), roleCapabilities: DECIDED });
    const answer = await handleWonderlandJuliusRoute(request(token, WEB), watcher);
    expect(answer).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
    // CONTROL: the same row, the world's own question.
    expect((await handleWonderlandJuliusRoute(request(token, WEB, PROJECT, '/wonderland/julius/events'), watcher))?.status).toBe(200);
  });

  it('TODAY, with the canonical table, a MEMBER row reads nothing: the product does not write that role yet', async () => {
    const store = createBrowserSessionStore();
    const answer = await handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store, {
      membership: members({ [`${PLAYER}|${PROJECT}`]: 'MEMBER' }),
    }));
    expect(answer).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
  });
});

describe('fail closed, and one answer for not-found and not-yours', () => {
  it('no world is 503 -- the deployment cannot answer, which is not a denial', async () => {
    const store = createBrowserSessionStore();
    const answer = await handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store, { world: null }));
    expect(answer).toEqual({ status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } });
  });

  it('a source that cannot answer is 503, never an empty result', async () => {
    const store = createBrowserSessionStore();
    const answer = await handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store, {
      results: { result: async () => { throw new Error('database down'); } },
    }));
    expect(answer).toEqual({ status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } });
  });

  it('no such run is the same 404 as a run answered for someone else', async () => {
    const store = createBrowserSessionStore();
    const token = signedIn(store);
    const missing = await handleWonderlandJuliusRoute(request(token, WEB), deps(store, { results: source(null).results }));
    const foreign = await handleWonderlandJuliusRoute(request(token, WEB), deps(store, {
      results: source(resultView({ runId: 'run:someone-else' })).results,
    }));
    expect(missing).toEqual({ status: 404, body: { error: WONDERLAND_DENIAL_MESSAGE } });
    expect(foreign).toEqual(missing);
  });

  it('no session is 401; a non-member is the SAME 404 as an absent run, with the one denial sentence', async () => {
    const store = createBrowserSessionStore();
    expect((await handleWonderlandJuliusRoute(request(null, WEB), deps(store)))?.status).toBe(401);
    const stranger = await handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store, { membership: members({}) }));
    expect(stranger).toEqual({ status: 404, body: { error: WONDERLAND_DENIAL_MESSAGE } });
    const missing = await handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store, { results: source(null).results }));
    expect(JSON.stringify(stranger?.body)).toBe(JSON.stringify(missing?.body));
  });
});

describe('the native client reads the result of the ONE project it was paired for', () => {
  it('its own project: admitted; another project its player also belongs to: the one 404', async () => {
    const store = createBrowserSessionStore();
    const token = nativeFor(store, PROJECT);
    const both = members({ [`${PLAYER}|${PROJECT}`]: 'OWNER', [`${PLAYER}|project-beta`]: 'OWNER' });
    expect((await handleWonderlandJuliusRoute(request(token, undefined), deps(store, { membership: both })))?.status).toBe(200);
    const elsewhere = await handleWonderlandJuliusRoute(request(token, undefined, 'project-beta'), deps(store, { membership: both }));
    expect(elsewhere).toEqual({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
  });
});

describe('wonderlandJuliusResultsFrom -- the read, through Julius\'s own API', () => {
  it('presents the world\'s named context, the authorised project, the player, and read scope only', async () => {
    const identities: unknown[] = [];
    const results = wonderlandJuliusResultsFrom({
      ...julius(),
      inspectResult: async (identity, runId) => {
        identities.push({ identity, runId });
        return { ok: true, value: resultView() };
      },
    });
    expect(await results.result({ projectId: PROJECT, runId: RUN, actorId: PLAYER })).toMatchObject({ runId: RUN });
    expect(identities).toEqual([{
      identity: { tenantId: WONDERLAND_WORLD_CALLER_TENANT, projectId: PROJECT, actorId: PLAYER, scopes: ['run:read'] },
      runId: RUN,
    }]);
  });

  it('run_not_found is null; any other refusal THROWS, so the route says 503 rather than "no result"', async () => {
    const refusing = (reason: 'run_not_found' | 'scope_missing') => wonderlandJuliusResultsFrom({
      ...julius(),
      inspectResult: async () => ({ ok: false, reason, safeMessage: 'no' }),
    });
    expect(await refusing('run_not_found').result({ projectId: PROJECT, runId: RUN, actorId: PLAYER })).toBeNull();
    await expect(refusing('scope_missing').result({ projectId: PROJECT, runId: RUN, actorId: PLAYER })).rejects.toThrow(/scope_missing/);
  });
});

/* ------------------------------------------------ billing provenance (P10) */

const THREE_SLOTS: readonly JuliusSlotView[] = JULIUS_DEFAULT_ROLES.map((role) => ({
  role, workerId: null, providerId: null, requestedModel: null, servedModel: null,
  state: 'IDLE' as const, dispatches: 1, lastSequence: null,
  knownUsdMicros: 0, unknownCostComponents: 0, costComplete: true, lastFailureClass: null, findingsRaised: 0,
}));

const entry = (sequence: number, type: string, facts: JuliusTimelineEntry['facts'] = {}): JuliusTimelineEntry => ({
  eventId: `event-${sequence}`, sequence, type, taskId: `task-${sequence}`, workerId: null,
  occurredAt: '2026-09-28T12:00:00.000Z', facts,
});

/** Julius's three reads, answering from fixed pages; records every call so paging and identity can be checked. */
function julius(pages: ReadonlyArray<{ readonly entries: readonly JuliusTimelineEntry[]; readonly hasMore: boolean; readonly gapDetected?: boolean; readonly nextCursor?: number }> = [
  { entries: [], hasMore: false },
]) {
  const calls: Array<{ read: string; identity: JuliusApiIdentity; sinceSequence?: number }> = [];
  return {
    calls,
    inspectResult: async (): Promise<JuliusApiResult<JuliusMissionResultView>> => ({ ok: true, value: resultView() }),
    inspectSlots: async (identity: JuliusApiIdentity): Promise<JuliusApiResult<readonly JuliusSlotView[]>> => {
      calls.push({ read: 'slots', identity });
      return { ok: true, value: THREE_SLOTS };
    },
    timeline: async (identity: JuliusApiIdentity, _runId: string, sinceSequence = 0): Promise<JuliusApiResult<JuliusTimelinePage>> => {
      calls.push({ read: 'timeline', identity, sinceSequence });
      const index = calls.filter((call) => call.read === 'timeline').length - 1;
      const page = pages[Math.min(index, pages.length - 1)];
      return { ok: true, value: {
        runId: RUN, entries: page.entries, hasMore: page.hasMore, gapDetected: page.gapDetected ?? false,
        nextCursor: page.nextCursor ?? page.entries.at(-1)?.sequence ?? sinceSequence,
      } };
    },
  };
}

describe('BILLING is read for the owner only, and read whole', () => {
  const billingSource = (billing: WonderlandJuliusResultSource['billing']) => {
    const asked: string[] = [];
    const results: WonderlandJuliusResultSource = {
      result: async (input) => (input.projectId === PROJECT && input.runId === RUN ? resultView() : null),
      ...(billing === undefined ? {} : {
        billing: async (input) => { asked.push(`${input.projectId}|${input.runId}|${input.actorId}`); return billing(input); },
      }),
    };
    return { results, asked };
  };
  const P10: WonderlandJuliusBillingRecord = {
    slots: THREE_SLOTS,
    settlements: [
      entry(1, 'budget.settled', { role: 'PROMPT_ARCHITECT', costBasis: 'PROVIDER_REPORTED', usdMicros: 12_345, billingPath: 'API_BILLED', released: false }),
      entry(2, 'budget.settled', { role: 'CODING_AGENT', costBasis: 'NOT_APPLICABLE', usdMicros: null, billingPath: 'SUBSCRIPTION', executionUsdMicros: 608_861, released: false }),
      entry(3, 'budget.settled', { role: 'INDEPENDENT_REVIEWER', costBasis: 'PROVIDER_REPORTED', usdMicros: 2_100, billingPath: 'API_BILLED', released: false }),
    ],
    whole: true,
  };
  const as = async (role: string, results: WonderlandJuliusResultSource) => {
    const store = createBrowserSessionStore();
    return handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store, {
      membership: members({ [`${PLAYER}|${PROJECT}`]: role }), roleCapabilities: DECIDED, results,
    }));
  };

  it('the OWNER reads who paid for each role -- asked for the authorised project, run and player', async () => {
    const { results, asked } = billingSource(async () => P10);
    const answer = await as('OWNER', results);
    expect(answer?.status).toBe(200);
    expect(asked).toEqual([`${PROJECT}|${RUN}|${PLAYER}`]);
    expect((dataOf(answer).cost as { billing: unknown }).billing).toEqual([
      { role: 'PROMPT_ARCHITECT', billingPath: 'API_BILLED', apiSpendUsdMicros: 12_345, unestablishedComponents: 0 },
      { role: 'CODING_AGENT', billingPath: 'SUBSCRIPTION', apiSpendUsdMicros: null, unestablishedComponents: 0 },
      { role: 'INDEPENDENT_REVIEWER', billingPath: 'API_BILLED', apiSpendUsdMicros: 2_100, unestablishedComponents: 0 },
    ]);
    expect(JSON.stringify(answer?.body)).not.toContain('608861');
  });

  it('a MEMBER\'s request never even READS the billing, and its cost is exactly { visible: false }', async () => {
    const { results, asked } = billingSource(async () => P10);
    const answer = await as('MEMBER', results);
    expect(answer?.status).toBe(200);
    expect(asked).toEqual([]);
    expect(dataOf(answer).cost).toEqual({ visible: false });
    for (const word of ['API_BILLED', 'SUBSCRIPTION', 'billing', '12345']) expect(JSON.stringify(answer?.body), word).not.toContain(word);
  });

  it('a billing read that cannot answer is 503 -- never a guessed path', async () => {
    const { results } = billingSource(async () => { throw new Error('timeline down'); });
    expect(await as('OWNER', results)).toEqual({ status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } });
  });

  it('a source with no billing read still answers: every role UNKNOWN, never guessed', async () => {
    const { results } = billingSource(undefined);
    const answer = await as('OWNER', results);
    expect(answer?.status).toBe(200);
    const billing = (dataOf(answer).cost as { billing: Array<{ billingPath: string; apiSpendUsdMicros: unknown }> }).billing;
    expect(billing.map((item) => item.billingPath)).toEqual(['UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
    expect(billing.every((item) => item.apiSpendUsdMicros === null)).toBe(true);
  });
});

describe('wonderlandJuliusResultsFrom -- the billing read, through Julius\'s own API', () => {
  const ask = { projectId: PROJECT, runId: RUN, actorId: PLAYER };

  it('walks EVERY page, keeps only the settlements, and asks as the world with read scope only', async () => {
    const api = julius([
      { entries: [entry(1, 'worker.dispatched'), entry(2, 'budget.settled', { role: 'CODING_AGENT' })], hasMore: true },
      { entries: [entry(3, 'budget.reserved'), entry(4, 'budget.settled', { role: 'PROMPT_ARCHITECT' })], hasMore: false },
    ]);
    const billing = await wonderlandJuliusResultsFrom(api).billing?.(ask);
    expect(billing?.whole).toBe(true);
    expect(billing?.slots).toEqual(THREE_SLOTS);
    expect(billing?.settlements.map((item) => item.sequence)).toEqual([2, 4]);
    expect(api.calls.filter((call) => call.read === 'timeline').map((call) => call.sinceSequence)).toEqual([0, 2]);
    for (const call of api.calls) {
      expect(call.identity).toEqual({ tenantId: WONDERLAND_WORLD_CALLER_TENANT, projectId: PROJECT, actorId: PLAYER, scopes: ['run:read'] });
    }
  });

  it('a gap Julius reports makes the record NOT whole', async () => {
    const billing = await wonderlandJuliusResultsFrom(julius([
      { entries: [entry(5, 'budget.settled', { role: 'CODING_AGENT' })], hasMore: false, gapDetected: true },
    ])).billing?.(ask);
    expect(billing?.whole).toBe(false);
  });

  it('a cursor that does not move, or a walk past the page ceiling, stops and is NOT whole -- never an endless read', async () => {
    const stuck = await wonderlandJuliusResultsFrom(julius([{ entries: [], hasMore: true, nextCursor: 0 }])).billing?.(ask);
    expect(stuck?.whole).toBe(false);
    let next = 0;
    const endless = julius([{ entries: [], hasMore: true }]);
    const walking = { ...endless, timeline: async (identity: JuliusApiIdentity, runId: string, since = 0) => {
      const answer = await endless.timeline(identity, runId, since);
      next += 1;
      return answer.ok ? { ok: true as const, value: { ...answer.value, nextCursor: next } } : answer;
    } };
    const capped = await wonderlandJuliusResultsFrom(walking).billing?.(ask);
    expect(capped?.whole).toBe(false);
    expect(endless.calls.filter((call) => call.read === 'timeline')).toHaveLength(WONDERLAND_JULIUS_BILLING_MAX_PAGES);
  });

  it('run_not_found is null; any other refusal THROWS, from either read', async () => {
    const api = julius();
    const notFound = { ...api, inspectSlots: async (): Promise<JuliusApiResult<readonly JuliusSlotView[]>> => ({ ok: false, reason: 'run_not_found', safeMessage: 'no' }) };
    expect(await wonderlandJuliusResultsFrom(notFound).billing?.(ask)).toBeNull();
    const refused = { ...api, timeline: async (): Promise<JuliusApiResult<JuliusTimelinePage>> => ({ ok: false, reason: 'scope_missing', safeMessage: 'no' }) };
    await expect(wonderlandJuliusResultsFrom(refused).billing?.(ask)).rejects.toThrow(/scope_missing/);
  });
});
