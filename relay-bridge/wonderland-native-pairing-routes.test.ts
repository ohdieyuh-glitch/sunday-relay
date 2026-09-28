import { describe, expect, it } from 'vitest';

import {
  browserSessionMayCall,
  createBrowserSessionStore,
  NATIVE_PAIRING_TTL_MS,
  NATIVE_SESSION_TTL_MS,
  NATIVE_WORLD_AUDIENCE,
  SESSION_TTL_MS,
  type BrowserSessionStore,
} from './browser-session/grants';
import {
  handleNativePairingRoute,
  type NativePairingDeps,
  type NativePairingRequest,
} from './wonderland-native-pairing-routes';
import {
  authorizeWonderlandJulius,
  type WonderlandJuliusRouteDeps,
  type WonderlandProjectMembershipSource,
} from './wonderland-julius-routes';
import { handleWonderlandRoute } from './wonderland-routes';

/**
 * NATIVE PAIRING, AGAINST THE REAL SESSION STORE.
 *
 * Every founder requirement for the native client has a test here, and every
 * refusal has a control beside it showing the same call succeeds when the one
 * thing under test is right -- so no refusal can pass because everything was
 * refused. The store is the real one: real hashes, real TTLs, real single use.
 *
 * Founder decision 2 (2026-09-27): the PAIRING CODE lives 5 minutes and dies on
 * redemption; the NATIVE SESSION lives 8 hours; both are bound to the player AND
 * the project the website paired for.
 */

const NOW = 1_790_000_000_000;
const WEB = 'https://sunday-relay.vercel.app';
const PLAYER = 'ghu-424242';
const PROJECT = 'project-alpha';
const OPERATOR = 'operator-token-never-a-player';

/** A signed-in player's CONTROL session, minted the way GitHub sign-in mints one. */
function signedIn(store: BrowserSessionStore, participantId = PLAYER): string {
  const minted = store.mintIdentitySession({ origin: WEB, now: NOW, participantId, scope: 'browser_control' });
  if (!minted.ok) throw new Error('fixture could not sign in');
  return minted.session.token;
}

/** Membership as a list of (player, project) pairs -- the world routes' own interface. */
const memberships = (...pairs: Array<[string, string]>): WonderlandProjectMembershipSource => ({
  lookup: async ({ playerId, projectId }) =>
    pairs.some(([p, q]) => p === playerId && q === projectId)
      ? ({ playerId, projectId, role: 'OWNER' } as never) : null,
});

const deps = (store: BrowserSessionStore,
  membership: WonderlandProjectMembershipSource | null = memberships([PLAYER, PROJECT])): NativePairingDeps =>
  ({ store, membership });

const req = (over: Partial<NativePairingRequest>): NativePairingRequest => ({
  method: 'POST',
  path: '/wonderland/native/pair',
  authorization: undefined,
  origin: undefined,
  body: undefined,
  now: NOW,
  operatorToken: OPERATOR,
  ...over,
});

const dataOf = (result: { body: unknown } | null) => (result?.body as { data: Record<string, string> }).data;
const kindOf = (result: { body: unknown } | null) => (result?.body as { error: { kind: string } }).error.kind;

/** Pair as the signed-in player for PROJECT, returning the code. */
async function pair(store: BrowserSessionStore, body: unknown = { projectId: PROJECT }): Promise<string> {
  const result = await handleNativePairingRoute(
    req({ authorization: `Relay-Session ${signedIn(store)}`, origin: WEB, body }), deps(store));
  expect(result?.status, JSON.stringify(result?.body)).toBe(200);
  return dataOf(result).code;
}

/** Redeem a code as the native client (no Origin), returning the result. */
const redeem = (store: BrowserSessionStore, code: unknown, over: Partial<NativePairingRequest> = {}) =>
  handleNativePairingRoute(req({ path: '/wonderland/native/session', body: { code }, ...over }), deps(store));

/* ======================================================= the store itself */

describe('the store: a native credential exists only as the founder described it', () => {
  const nativeGrant = (store: BrowserSessionStore, over: Record<string, unknown> = {}) =>
    store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: NOW, scope: 'native_world', participantId: PLAYER, projectId: PROJECT, ...over });

  it('a native grant must name a real, verified participant', () => {
    const store = createBrowserSessionStore();
    expect(() => nativeGrant(store, { participantId: null })).toThrow(/participant/);
    expect(() => nativeGrant(store, { participantId: 'not a valid id!' })).toThrow(/participant/);
    // Control: a valid participant is accepted.
    expect(() => nativeGrant(store)).not.toThrow();
  });

  it('a native grant must name the project it is for', () => {
    const store = createBrowserSessionStore();
    expect(() => nativeGrant(store, { projectId: null })).toThrow(/project/);
    expect(() => nativeGrant(store, { projectId: 'has spaces and ; semicolons' })).toThrow(/project/);
    // Control: the same grant with its project is accepted, and a browser grant never carries one.
    expect(nativeGrant(store).projectId).toBe(PROJECT);
    expect(store.createGrant({ origin: WEB, now: NOW, scope: 'browser_read_only', projectId: PROJECT } as never).projectId).toBeNull();
  });

  it('a native grant is bound to the native audience and never to a web origin', () => {
    const store = createBrowserSessionStore();
    expect(() => nativeGrant(store, { origin: WEB })).toThrow(/native audience/);
  });

  it('no native session can be minted directly, skipping the pairing', () => {
    const store = createBrowserSessionStore();
    expect(() => store.mintIdentitySession({ origin: WEB, now: NOW, participantId: PLAYER, scope: 'native_world' }))
      .toThrow(/pairing grant/);
  });

  it('THE COPY GUARD: a valid BROWSER session is not a native one', () => {
    const store = createBrowserSessionStore();
    const browserToken = signedIn(store);
    expect(store.verifyNativeSession({ token: browserToken, now: NOW })).toEqual({ ok: false, reason: 'not_native' });
    // Control: the very same token IS valid as what it actually is.
    expect(store.verifySession({ token: browserToken, origin: WEB, now: NOW }).ok).toBe(true);
  });

  it('a native session reaches NO browser route -- not even the read-only ones', () => {
    for (const [method, path] of [
      ['GET', '/reviewer/readiness'], ['GET', '/mission/m-1'], ['GET', '/missions'],
      ['POST', '/mission/start'], ['POST', '/mission/m-1/cancel'],
    ] as const) {
      expect(browserSessionMayCall(method, path, 'native_world'), `${method} ${path}`).toBe(false);
    }
    // Control: a control session may start a mission, so the false above is the scope, not the path.
    expect(browserSessionMayCall('POST', '/mission/start', 'browser_control')).toBe(true);
  });
});

/* ================================================== a player pairs a client */

describe('POST /wonderland/native/pair -- only the signed-in player, for themselves, for one project', () => {
  it('refuses the operator credential: an operator is not a player', async () => {
    const store = createBrowserSessionStore();
    const result = await handleNativePairingRoute(req({ authorization: `Bearer ${OPERATOR}`, origin: WEB, body: { projectId: PROJECT } }), deps(store));
    expect(result?.status).toBe(403);
    expect(kindOf(result)).toBe('operator_is_not_a_player');
    expect(store.size.grants).toBe(0);
  });

  it('refuses a caller with no session', async () => {
    const store = createBrowserSessionStore();
    expect((await handleNativePairingRoute(req({ origin: WEB, body: { projectId: PROJECT } }), deps(store)))?.status).toBe(401);
  });

  it('refuses a read-only session, which names no player', async () => {
    const store = createBrowserSessionStore();
    const grant = store.createGrant({ origin: WEB, now: NOW, scope: 'browser_read_only' });
    const redeemed = store.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: WEB, now: NOW });
    if (!redeemed.ok) throw new Error('fixture');
    const result = await handleNativePairingRoute(
      req({ authorization: `Relay-Session ${redeemed.session.token}`, origin: WEB, body: { projectId: PROJECT } }), deps(store));
    expect(result?.status).toBe(401);
  });

  it('refuses an originless caller: a native client cannot pair another native client', async () => {
    const store = createBrowserSessionStore();
    const result = await handleNativePairingRoute(
      req({ authorization: `Relay-Session ${signedIn(store)}`, origin: undefined, body: { projectId: PROJECT } }), deps(store));
    expect(result?.status).toBe(401);
  });

  it('refuses a pairing that names no project, and mints nothing', async () => {
    const store = createBrowserSessionStore();
    const token = signedIn(store);
    for (const body of [undefined, {}, { projectId: '' }, { projectId: 'bad project; id' }]) {
      const result = await handleNativePairingRoute(req({ authorization: `Relay-Session ${token}`, origin: WEB, body }), deps(store));
      expect(result?.status, JSON.stringify(body)).toBe(400);
      expect(kindOf(result)).toBe('project_required');
    }
    expect(store.size.grants).toBe(0);
    // Control: the same player, naming the project, pairs.
    expect(await pair(store)).toMatch(/\./);
  });

  it('refuses a project the player does not belong to, and mints nothing', async () => {
    const store = createBrowserSessionStore();
    const result = await handleNativePairingRoute(
      req({ authorization: `Relay-Session ${signedIn(store)}`, origin: WEB, body: { projectId: 'project-beta' } }), deps(store));
    expect(result?.status).toBe(403);
    expect(kindOf(result)).toBe('not_a_project_member');
    expect(store.size.grants).toBe(0);
  });

  it('FAILS CLOSED without a membership source, and when membership cannot be read', async () => {
    const store = createBrowserSessionStore();
    const token = signedIn(store);
    const none = await handleNativePairingRoute(
      req({ authorization: `Relay-Session ${token}`, origin: WEB, body: { projectId: PROJECT } }), deps(store, null));
    expect(none?.status).toBe(503);
    const broken = await handleNativePairingRoute(
      req({ authorization: `Relay-Session ${token}`, origin: WEB, body: { projectId: PROJECT } }),
      deps(store, { lookup: async () => { throw new Error('database down'); } }));
    expect(broken?.status).toBe(503);
    expect(store.size.grants).toBe(0);
  });

  it('binds the code to the SESSION\'S player and the named project, ignoring any player in the body', async () => {
    const store = createBrowserSessionStore();
    const code = await pair(store, { projectId: PROJECT, participantId: 'ghu-attacker', player: 'ghu-attacker' });
    const redeemed = await redeem(store, code);
    expect(redeemed?.status).toBe(200);
    expect(dataOf(redeemed).participantId).toBe(PLAYER);
    expect(dataOf(redeemed).projectId).toBe(PROJECT);
  });

  it('never returns the operator credential or anything shaped like a provider key', async () => {
    const store = createBrowserSessionStore();
    const code = await pair(store);
    const redeemed = await redeem(store, code);
    const everything = JSON.stringify([code, redeemed?.body]);
    expect(everything).not.toContain(OPERATOR);
    expect(everything).not.toMatch(/sk-[A-Za-z0-9]{16,}|sk-ant-|xai-[A-Za-z0-9]{16,}/);
  });
});

/* ========================================== the native client redeems a code */

describe('POST /wonderland/native/session -- single use, five minutes, native only', () => {
  it('a web page cannot redeem a native code, even the right one', async () => {
    const store = createBrowserSessionStore();
    const code = await pair(store);
    const fromPage = await redeem(store, code, { origin: WEB });
    expect(fromPage?.status).toBe(403);
    expect(kindOf(fromPage)).toBe('native_client_only');
    // Control: the same code, from the native client, works -- the page was refused
    // for being a page, and the refusal did not burn the code.
    expect((await redeem(store, code))?.status).toBe(200);
  });

  it('the native client receives its own native_world session for the player and the project', async () => {
    const store = createBrowserSessionStore();
    const data = dataOf(await redeem(store, await pair(store)));
    expect(data.audience).toBe(NATIVE_WORLD_AUDIENCE);
    expect(store.verifyNativeSession({ token: data.token, now: NOW }))
      .toMatchObject({ ok: true, participantId: PLAYER, projectId: PROJECT });
  });

  it('a code works once: a second redemption fails closed', async () => {
    const store = createBrowserSessionStore();
    const code = await pair(store);
    expect((await redeem(store, code))?.status).toBe(200);
    const again = await redeem(store, code);
    expect(again?.status).toBe(401);
    expect(kindOf(again)).toBe('pairing_failed');
  });

  it('A CODE LIVES FIVE MINUTES: still good just inside them, dead just after', async () => {
    const store = createBrowserSessionStore();
    expect(NATIVE_PAIRING_TTL_MS).toBe(5 * 60_000);
    const late = await redeem(store, await pair(store), { now: NOW + NATIVE_PAIRING_TTL_MS + 1 });
    expect(late?.status).toBe(401);
    expect(kindOf(late)).toBe('pairing_failed');
    // Control: at 4 min 59 s a fresh code still redeems -- longer than the browser's two-minute grant.
    expect((await redeem(store, await pair(store), { now: NOW + NATIVE_PAIRING_TTL_MS - 1_000 }))?.status).toBe(200);
  });

  it('A NATIVE SESSION LIVES EIGHT HOURS -- and a browser session still lives thirty minutes', async () => {
    const store = createBrowserSessionStore();
    expect(NATIVE_SESSION_TTL_MS).toBe(8 * 60 * 60_000);
    const { token } = dataOf(await redeem(store, await pair(store)));
    expect(store.verifyNativeSession({ token, now: NOW + NATIVE_SESSION_TTL_MS - 1_000 }).ok).toBe(true);
    expect(store.verifyNativeSession({ token, now: NOW + NATIVE_SESSION_TTL_MS + 1 }))
      .toEqual({ ok: false, reason: 'expired' });
    // Control: nothing about the browser's lifetime moved.
    const browserToken = signedIn(store);
    expect(store.verifySession({ token: browserToken, origin: WEB, now: NOW + SESSION_TTL_MS - 1_000 }).ok).toBe(true);
    expect(store.verifySession({ token: browserToken, origin: WEB, now: NOW + SESSION_TTL_MS + 1 }).ok).toBe(false);
  });

  it('every wrong code fails the SAME way, so a probe learns nothing', async () => {
    const store = createBrowserSessionStore();
    const code = await pair(store);
    const [grantId, secret] = code.split('.');
    const answers = [
      await redeem(store, `${grantId}.${'A'.repeat(secret.length)}`),   // wrong secret
      await redeem(store, `${'B'.repeat(grantId.length)}.${secret}`),   // unknown grant
      await redeem(store, 'not-a-code'),                                // malformed
      await redeem(store, 42),                                          // not even a string
    ];
    for (const answer of answers) {
      expect(answer?.status).toBe(401);
      expect(answer?.body).toEqual(answers[0]?.body);
    }
    // Control: after all that probing, the real code still works.
    expect((await redeem(store, code))?.status).toBe(200);
  });
});

/* ======================================================= signing a client out */

describe('POST /wonderland/native/revoke', () => {
  it('the native client can end its own session, after which it is refused', async () => {
    const store = createBrowserSessionStore();
    const { token } = dataOf(await redeem(store, await pair(store)));
    const revoked = await handleNativePairingRoute(
      req({ path: '/wonderland/native/revoke', authorization: `Relay-Session ${token}` }), deps(store));
    expect(revoked?.status).toBe(200);
    expect(store.verifyNativeSession({ token, now: NOW }).ok).toBe(false);
  });

  it('a web page cannot revoke on the native client\'s behalf', async () => {
    const store = createBrowserSessionStore();
    const { token } = dataOf(await redeem(store, await pair(store)));
    const fromPage = await handleNativePairingRoute(
      req({ path: '/wonderland/native/revoke', authorization: `Relay-Session ${token}`, origin: WEB }), deps(store));
    expect(fromPage?.status).toBe(403);
    expect(store.verifyNativeSession({ token, now: NOW }).ok).toBe(true);
  });
});

/* ===================================== the world routes, where it is all for */

describe('the Julius world stream accepts a native client, and only as itself, for its own project', () => {
  const world = (store: BrowserSessionStore): WonderlandJuliusRouteDeps => ({
    sessions: store,
    membership: {
      lookup: async ({ playerId, projectId }: { playerId: string; projectId: string }) =>
        ({ playerId, projectId, role: 'OWNER' }),
    },
    reader: { hydrate: async () => null, events: async () => ({ rows: [], revision: 0 }) },
  } as unknown as WonderlandJuliusRouteDeps);
  const worldRequest = (token: string, origin: string | undefined, projectId = PROJECT) => ({
    method: 'GET',
    path: '/wonderland/julius/hydrate',
    url: `/wonderland/julius/hydrate?projectId=${projectId}&runId=run-1`,
    authorization: `Relay-Session ${token}`,
    origin,
    now: NOW,
  });

  it('a native session, from the native client, is the player it was paired for', async () => {
    const store = createBrowserSessionStore();
    const { token } = dataOf(await redeem(store, await pair(store)));
    const result = await authorizeWonderlandJulius(worldRequest(token, undefined), world(store));
    expect(result).toMatchObject({ ok: true, playerId: PLAYER });
  });

  it('a native session is refused for ANOTHER project -- even one its player belongs to', async () => {
    const store = createBrowserSessionStore();
    const { token } = dataOf(await redeem(store, await pair(store)));
    // The fake membership admits every project, so this refusal is the session's binding and nothing else.
    const elsewhere = await authorizeWonderlandJulius(worldRequest(token, undefined, 'project-beta'), world(store));
    expect(elsewhere).toMatchObject({ ok: false, status: 403 });
    // Control: its own project is admitted.
    expect(await authorizeWonderlandJulius(worldRequest(token, undefined), world(store))).toMatchObject({ ok: true });
  });

  it('a BROWSER session copied into a native client is refused -- no cookie copying', async () => {
    const store = createBrowserSessionStore();
    const browserToken = signedIn(store);
    const copied = await authorizeWonderlandJulius(worldRequest(browserToken, undefined), world(store));
    expect(copied).toMatchObject({ ok: false, status: 401 });
    // Control: the same token from its own website is admitted.
    const fromSite = await authorizeWonderlandJulius(worldRequest(browserToken, WEB), world(store));
    expect(fromSite).toMatchObject({ ok: true, playerId: PLAYER });
  });

  it('a native session presented from a web page is refused', async () => {
    const store = createBrowserSessionStore();
    const { token } = dataOf(await redeem(store, await pair(store)));
    const fromPage = await authorizeWonderlandJulius(worldRequest(token, WEB), world(store));
    expect(fromPage).toMatchObject({ ok: false, status: 401 });
  });

  it('the battle and presence routes refuse a native session -- they write', async () => {
    const store = createBrowserSessionStore();
    const { token } = dataOf(await redeem(store, await pair(store)));
    const result = await handleWonderlandRoute({
      method: 'POST', path: '/wonderland/presence/join', url: '/wonderland/presence/join',
      authorization: `Relay-Session ${token}`, origin: undefined, body: { projectId: PROJECT }, now: NOW,
    } as never, { sessions: store, backend: {} as never } as never);
    expect(result?.status).toBe(403);
  });
});
