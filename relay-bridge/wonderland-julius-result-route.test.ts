import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_WORLD_CALLER_TENANT,
  authorizeWonderlandJulius,
  handleWonderlandJuliusRoute,
  isWonderlandJuliusRoute,
  wonderlandJuliusResultsFrom,
} from './wonderland-julius-routes';
import type {
  WonderlandJuliusResultSource,
  WonderlandJuliusRouteDeps,
  WonderlandProjectMembershipSource,
} from './wonderland-julius-routes';
import { createBrowserSessionStore, NATIVE_WORLD_AUDIENCE } from './browser-session/grants';
import type { BrowserSessionStore } from './browser-session/grants';
import type { JuliusMissionResultView } from '../src/relay/mission/julius/julius-runtime-api';
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
  url: `${path}?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(RUN)}`,
  authorization: token === null ? undefined : `Relay-Session ${token}`,
  origin,
  now: NOW,
});

const deps = (store: BrowserSessionStore, over: Partial<WonderlandJuliusRouteDeps> = {}): WonderlandJuliusRouteDeps => ({
  sessions: store,
  reader: { hydrate: async () => null, events: async () => ({ rows: [], revision: 0 }) },
  membership: members({ [`${PLAYER}|${PROJECT}`]: 'OWNER' }),
  results: source().results,
  ...over,
});

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
    expect(answer).toEqual({ status: 403, body: { error: WONDERLAND_DENIAL_MESSAGE } });
    // CONTROL: the same row, the world's own question.
    expect(await authorizeWonderlandJulius(request(token, WEB, PROJECT, '/wonderland/julius/hydrate'), watcher))
      .toMatchObject({ ok: true, playerId: PLAYER });
  });

  it('TODAY, with the canonical table, a MEMBER row reads nothing: the product does not write that role yet', async () => {
    const store = createBrowserSessionStore();
    const answer = await handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store, {
      membership: members({ [`${PLAYER}|${PROJECT}`]: 'MEMBER' }),
    }));
    expect(answer?.status).toBe(403);
  });
});

describe('fail closed, and one answer for not-found and not-yours', () => {
  it('no result source is 503 -- the deployment cannot answer, which is not a denial', async () => {
    const store = createBrowserSessionStore();
    const answer = await handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store, { results: undefined }));
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

  it('no session is 401; a non-member is 403 with the one denial sentence', async () => {
    const store = createBrowserSessionStore();
    expect((await handleWonderlandJuliusRoute(request(null, WEB), deps(store)))?.status).toBe(401);
    const stranger = await handleWonderlandJuliusRoute(request(signedIn(store), WEB), deps(store, { membership: members({}) }));
    expect(stranger).toEqual({ status: 403, body: { error: WONDERLAND_DENIAL_MESSAGE } });
  });
});

describe('the native client reads the result of the ONE project it was paired for', () => {
  it('its own project: admitted; another project its player also belongs to: refused', async () => {
    const store = createBrowserSessionStore();
    const token = nativeFor(store, PROJECT);
    const both = members({ [`${PLAYER}|${PROJECT}`]: 'OWNER', [`${PLAYER}|project-beta`]: 'OWNER' });
    expect((await handleWonderlandJuliusRoute(request(token, undefined), deps(store, { membership: both })))?.status).toBe(200);
    const elsewhere = await handleWonderlandJuliusRoute(request(token, undefined, 'project-beta'), deps(store, { membership: both }));
    expect(elsewhere?.status).toBe(403);
  });
});

describe('wonderlandJuliusResultsFrom -- the read, through Julius\'s own API', () => {
  it('presents the world\'s named context, the authorised project, the player, and read scope only', async () => {
    const identities: unknown[] = [];
    const results = wonderlandJuliusResultsFrom({
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
      inspectResult: async () => ({ ok: false, reason, safeMessage: 'no' }),
    });
    expect(await refusing('run_not_found').result({ projectId: PROJECT, runId: RUN, actorId: PLAYER })).toBeNull();
    await expect(refusing('scope_missing').result({ projectId: PROJECT, runId: RUN, actorId: PLAYER })).rejects.toThrow(/scope_missing/);
  });
});
