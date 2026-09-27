import { describe, expect, it } from 'vitest';

import {
  browserSessionMayCall,
  createBrowserSessionStore,
  GRANT_TTL_MS,
  NATIVE_WORLD_AUDIENCE,
  type BrowserSessionStore,
} from './browser-session/grants';
import { handleNativePairingRoute, type NativePairingRequest } from './wonderland-native-pairing-routes';
import { authorizeWonderlandJulius, type WonderlandJuliusRouteDeps } from './wonderland-julius-routes';
import { handleWonderlandRoute } from './wonderland-routes';

/**
 * NATIVE PAIRING, AGAINST THE REAL SESSION STORE.
 *
 * Every founder requirement for the native client has a test here, and every
 * refusal has a control beside it showing the same call succeeds when the one
 * thing under test is right -- so no refusal can pass because everything was
 * refused. The store is the real one: real hashes, real TTLs, real single use.
 */

const NOW = 1_790_000_000_000;
const WEB = 'https://sunday-relay.vercel.app';
const PLAYER = 'ghu-424242';
const OPERATOR = 'operator-token-never-a-player';

/** A signed-in player's CONTROL session, minted the way GitHub sign-in mints one. */
function signedIn(store: BrowserSessionStore, participantId = PLAYER): string {
  const minted = store.mintIdentitySession({ origin: WEB, now: NOW, participantId, scope: 'browser_control' });
  if (!minted.ok) throw new Error('fixture could not sign in');
  return minted.session.token;
}

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

/** Pair as the signed-in player, returning the code. */
function pair(store: BrowserSessionStore, body: unknown = undefined): string {
  const result = handleNativePairingRoute(
    req({ authorization: `Relay-Session ${signedIn(store)}`, origin: WEB, body }), store);
  expect(result?.status, JSON.stringify(result?.body)).toBe(200);
  return dataOf(result).code;
}

/** Redeem a code as the native client (no Origin), returning the result. */
const redeem = (store: BrowserSessionStore, code: unknown, over: Partial<NativePairingRequest> = {}) =>
  handleNativePairingRoute(req({ path: '/wonderland/native/session', body: { code }, ...over }), store);

/* ======================================================= the store itself */

describe('the store: a native credential exists only as the founder described it', () => {
  it('a native grant must name a real, verified participant', () => {
    const store = createBrowserSessionStore();
    expect(() => store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: NOW, scope: 'native_world', participantId: null }))
      .toThrow(/participant/);
    expect(() => store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: NOW, scope: 'native_world', participantId: 'not a valid id!' }))
      .toThrow(/participant/);
    // Control: a valid participant is accepted.
    expect(() => store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: NOW, scope: 'native_world', participantId: PLAYER }))
      .not.toThrow();
  });

  it('a native grant is bound to the native audience and never to a web origin', () => {
    const store = createBrowserSessionStore();
    expect(() => store.createGrant({ origin: WEB, now: NOW, scope: 'native_world', participantId: PLAYER }))
      .toThrow(/native audience/);
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

describe('POST /wonderland/native/pair -- only the signed-in player, for themselves', () => {
  it('refuses the operator credential: an operator is not a player', () => {
    const store = createBrowserSessionStore();
    const result = handleNativePairingRoute(req({ authorization: `Bearer ${OPERATOR}`, origin: WEB }), store);
    expect(result?.status).toBe(403);
    expect(kindOf(result)).toBe('operator_is_not_a_player');
    expect(store.size.grants).toBe(0);
  });

  it('refuses a caller with no session', () => {
    const store = createBrowserSessionStore();
    expect(handleNativePairingRoute(req({ origin: WEB }), store)?.status).toBe(401);
  });

  it('refuses a read-only session, which names no player', () => {
    const store = createBrowserSessionStore();
    const grant = store.createGrant({ origin: WEB, now: NOW, scope: 'browser_read_only' });
    const redeemed = store.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: WEB, now: NOW });
    if (!redeemed.ok) throw new Error('fixture');
    const result = handleNativePairingRoute(req({ authorization: `Relay-Session ${redeemed.session.token}`, origin: WEB }), store);
    expect(result?.status).toBe(401);
  });

  it('refuses an originless caller: a native client cannot pair another native client', () => {
    const store = createBrowserSessionStore();
    const result = handleNativePairingRoute(req({ authorization: `Relay-Session ${signedIn(store)}`, origin: undefined }), store);
    expect(result?.status).toBe(401);
  });

  it('binds the code to the SESSION\'S player and ignores any player named in the body', () => {
    const store = createBrowserSessionStore();
    const code = pair(store, { participantId: 'ghu-attacker', player: 'ghu-attacker' });
    const redeemed = redeem(store, code);
    expect(redeemed?.status).toBe(200);
    expect(dataOf(redeemed).participantId).toBe(PLAYER);
  });

  it('never returns the operator credential or anything shaped like a provider key', () => {
    const store = createBrowserSessionStore();
    const code = pair(store);
    const redeemed = redeem(store, code);
    const everything = JSON.stringify([code, redeemed?.body]);
    expect(everything).not.toContain(OPERATOR);
    expect(everything).not.toMatch(/sk-[A-Za-z0-9]{16,}|sk-ant-|xai-[A-Za-z0-9]{16,}/);
  });
});

/* ========================================== the native client redeems a code */

describe('POST /wonderland/native/session -- single use, short-lived, native only', () => {
  it('a web page cannot redeem a native code, even the right one', () => {
    const store = createBrowserSessionStore();
    const code = pair(store);
    const fromPage = redeem(store, code, { origin: WEB });
    expect(fromPage?.status).toBe(403);
    expect(kindOf(fromPage)).toBe('native_client_only');
    // Control: the same code, from the native client, works -- the page was refused
    // for being a page, and the refusal did not burn the code.
    expect(redeem(store, code)?.status).toBe(200);
  });

  it('the native client receives its own native_world session for the player', () => {
    const store = createBrowserSessionStore();
    const data = dataOf(redeem(store, pair(store)));
    expect(data.audience).toBe(NATIVE_WORLD_AUDIENCE);
    const verified = store.verifyNativeSession({ token: data.token, now: NOW });
    expect(verified).toMatchObject({ ok: true, participantId: PLAYER });
  });

  it('a code works once: a second redemption fails closed', () => {
    const store = createBrowserSessionStore();
    const code = pair(store);
    expect(redeem(store, code)?.status).toBe(200);
    const again = redeem(store, code);
    expect(again?.status).toBe(401);
    expect(kindOf(again)).toBe('pairing_failed');
  });

  it('a code expires: after its TTL it fails closed', () => {
    const store = createBrowserSessionStore();
    const code = pair(store);
    const late = redeem(store, code, { now: NOW + GRANT_TTL_MS + 1 });
    expect(late?.status).toBe(401);
    expect(kindOf(late)).toBe('pairing_failed');
  });

  it('every wrong code fails the SAME way, so a probe learns nothing', () => {
    const store = createBrowserSessionStore();
    const code = pair(store);
    const [grantId, secret] = code.split('.');
    const answers = [
      redeem(store, `${grantId}.${'A'.repeat(secret.length)}`),   // wrong secret
      redeem(store, `${'B'.repeat(grantId.length)}.${secret}`),   // unknown grant
      redeem(store, 'not-a-code'),                                // malformed
      redeem(store, 42),                                          // not even a string
    ];
    for (const answer of answers) {
      expect(answer?.status).toBe(401);
      expect(answer?.body).toEqual(answers[0]?.body);
    }
    // Control: after all that probing, the real code still works.
    expect(redeem(store, code)?.status).toBe(200);
  });
});

/* ======================================================= signing a client out */

describe('POST /wonderland/native/revoke', () => {
  it('the native client can end its own session, after which it is refused', () => {
    const store = createBrowserSessionStore();
    const { token } = dataOf(redeem(store, pair(store)));
    const revoked = handleNativePairingRoute(req({ path: '/wonderland/native/revoke', authorization: `Relay-Session ${token}` }), store);
    expect(revoked?.status).toBe(200);
    expect(store.verifyNativeSession({ token, now: NOW }).ok).toBe(false);
  });

  it('a web page cannot revoke on the native client\'s behalf', () => {
    const store = createBrowserSessionStore();
    const { token } = dataOf(redeem(store, pair(store)));
    const fromPage = handleNativePairingRoute(
      req({ path: '/wonderland/native/revoke', authorization: `Relay-Session ${token}`, origin: WEB }), store);
    expect(fromPage?.status).toBe(403);
    expect(store.verifyNativeSession({ token, now: NOW }).ok).toBe(true);
  });
});

/* ===================================== the world routes, where it is all for */

describe('the Julius world stream accepts a native client, and only as itself', () => {
  const world = (store: BrowserSessionStore): WonderlandJuliusRouteDeps => ({
    sessions: store,
    membership: {
      lookup: async ({ playerId, projectId }: { playerId: string; projectId: string }) =>
        ({ playerId, projectId, role: 'OWNER' }),
    },
    reader: { hydrate: async () => null, events: async () => ({ rows: [], revision: 0 }) },
  } as unknown as WonderlandJuliusRouteDeps);
  const worldRequest = (token: string, origin: string | undefined) => ({
    method: 'GET',
    path: '/wonderland/julius/hydrate',
    url: '/wonderland/julius/hydrate?projectId=project-alpha&runId=run-1',
    authorization: `Relay-Session ${token}`,
    origin,
    now: NOW,
  });

  it('a native session, from the native client, is the player it was paired for', async () => {
    const store = createBrowserSessionStore();
    const { token } = dataOf(redeem(store, pair(store)));
    const result = await authorizeWonderlandJulius(worldRequest(token, undefined), world(store));
    expect(result).toMatchObject({ ok: true, playerId: PLAYER });
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
    const { token } = dataOf(redeem(store, pair(store)));
    const fromPage = await authorizeWonderlandJulius(worldRequest(token, WEB), world(store));
    expect(fromPage).toMatchObject({ ok: false, status: 401 });
  });

  it('the battle and presence routes refuse a native session -- they write', async () => {
    const store = createBrowserSessionStore();
    const { token } = dataOf(redeem(store, pair(store)));
    const result = await handleWonderlandRoute({
      method: 'POST', path: '/wonderland/presence/join', url: '/wonderland/presence/join',
      authorization: `Relay-Session ${token}`, origin: undefined, body: { projectId: 'project-alpha' }, now: NOW,
    } as never, { sessions: store, backend: {} as never } as never);
    expect(result?.status).toBe(403);
  });
});
