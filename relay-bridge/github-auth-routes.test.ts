import { describe, expect, it } from 'vitest';

import {
  createInstallationGrants,
  createOAuthStateStore,
  createSignInClaimStore,
  handleGithubAuthRoute,
  isGithubAuthRoute,
  participantIdForIdentity,
  OAUTH_STATE_TTL_MS,
  type GithubAuthDeps,
} from './github-auth-routes';
import { createBrowserSessionStore } from './browser-session/grants';

/**
 * SIGN IN WITH GITHUB, at the route seam.
 *
 * The whole point of these routes is that a fresh user gets a session WITHOUT
 * the operator token — so the tests prove the two things that make that safe: a
 * forged or replayed `state` spends nothing (no code is ever exchanged), and the
 * session that IS minted carries the GitHub-verified identity as its
 * participant. GitHub itself is mocked; no network, no real secret.
 */

const CONFIG = { clientId: 'Iv1.public_id', clientSecret: 'fixture-secret-should-never-surface' };
const ORIGIN = 'https://sunday-relay.vercel.app';
const REDIRECT = 'https://bridge.example/relay-api/auth/github/callback';
const NOW = 5_000_000;

const INSTALL_BASE = 'https://github.com/apps/relay/installations/new';

function deps(over: Partial<GithubAuthDeps> = {}): GithubAuthDeps {
  return {
    oauthConfig: CONFIG,
    sessions: createBrowserSessionStore(),
    stateStore: createOAuthStateStore(),
    redirectUri: REDIRECT,
    sessionOrigin: ORIGIN,
    now: NOW,
    installStateStore: createOAuthStateStore(),
    installGrants: createInstallationGrants(),
    installBaseUrl: INSTALL_BASE,
    claimStore: createSignInClaimStore(),
    exchange: async () => ({ login: 'beta-user', id: 4242, type: 'User' }),
    ...over,
  };
}

const start = (d: GithubAuthDeps) =>
  handleGithubAuthRoute({ method: 'GET', path: '/auth/github/start', url: '/relay-api/auth/github/start' }, d);
const callback = (d: GithubAuthDeps, qs: string) =>
  handleGithubAuthRoute({ method: 'GET', path: '/auth/github/callback', url: `/relay-api/auth/github/callback?${qs}` }, d);
/** The callback now redirects with a one-time claim; pull it out of the fragment. */
const claimFromRedirect = (redirect: string | undefined): string =>
  decodeURIComponent(new URL(redirect ?? '').hash.replace('#relay_claim=', ''));
const redeemClaim = (d: GithubAuthDeps, claim: string) =>
  handleGithubAuthRoute({
    method: 'POST', path: '/auth/github/claim', url: '/relay-api/auth/github/claim',
    origin: ORIGIN, body: { claim },
  }, d);

describe('routing + participant encoding', () => {
  it('claims only the /auth/github/ prefix', () => {
    expect(isGithubAuthRoute('/auth/github/start')).toBe(true);
    expect(isGithubAuthRoute('/mission/start')).toBe(false);
  });
  it('encodes the STABLE numeric id, not the renameable login', () => {
    expect(participantIdForIdentity({ login: 'renamed', id: 4242, type: 'User' })).toBe('ghu-4242');
  });
});

describe('an unconfigured bridge admits no sign-in and fabricates no session', () => {
  for (const over of [{ oauthConfig: null }, { sessionOrigin: null }, { redirectUri: '' }] as Partial<GithubAuthDeps>[]) {
    it(`answers 503 when ${JSON.stringify(Object.keys(over))} is missing`, async () => {
      const r = await start(deps(over));
      expect(r?.status).toBe(503);
    });
  }
});

describe('GET /auth/github/start issues a single-use state and the authorize URL', () => {
  it('returns an authorize URL carrying the public client id + state, never the secret', async () => {
    const d = deps();
    const r = await start(d);
    expect(r?.status).toBe(200);
    const data = (r?.body as { data: { authorizeUrl: string; state: string } }).data;
    expect(data.authorizeUrl).toContain('client_id=Iv1.public_id');
    expect(data.authorizeUrl).toContain(`state=${data.state}`);
    expect(JSON.stringify(r?.body)).not.toContain(CONFIG.clientSecret);
    expect(d.stateStore.size).toBe(1);
  });
});

describe('GET /auth/github/callback mints a session from the verified identity', () => {
  it('redirects with a one-time claim (never the token), redeemable for the session', async () => {
    const d = deps();
    const s = await start(d);
    const state = (s?.body as { data: { state: string } }).data.state;

    // The callback redirects the browser back to the frontend — the token is NOT
    // in the URL, only a one-time claim in the fragment.
    const r = await callback(d, `code=abc&state=${state}`);
    expect(r?.status).toBe(302);
    expect(r?.redirect).toContain(`${ORIGIN}/#relay_claim=`);
    const claim = claimFromRedirect(r?.redirect);
    expect(JSON.stringify(r)).not.toContain('Relay-Session');

    // Exchange the claim for the session over POST (the token rides only here).
    const c = await redeemClaim(d, claim);
    expect(c?.status).toBe(200);
    const data = (c?.body as { data: { sessionToken: string; participantId: string; login: string; scope: string } }).data;
    expect(data.scope).toBe('browser_control');
    expect(data.participantId).toBe('ghu-4242');
    expect(data.login).toBe('beta-user');

    // The token really works: it verifies as a control session for that participant.
    const verified = d.sessions.verifySession({ token: data.sessionToken, origin: ORIGIN, now: NOW + 1 });
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.participantId).toBe('ghu-4242');
    // The claim is single-use: a second redemption fails.
    expect((await redeemClaim(d, claim))?.status).toBe(401);
    // The state was single-use: it is gone.
    expect(d.stateStore.size).toBe(0);
  });

  it('REFUSES a forged state and never exchanges a code (spends nothing)', async () => {
    let exchanged = false;
    const d = deps({ exchange: async () => { exchanged = true; return { login: 'x', id: 1, type: 'User' }; } });
    const r = await callback(d, 'code=abc&state=not-a-real-state');
    expect(r?.status).toBe(401);
    expect(exchanged).toBe(false); // the CSRF gate fired before any exchange
    expect(d.sessions.size.sessions).toBe(0);
  });

  it('REFUSES a replayed state: the second callback with the same state fails', async () => {
    const d = deps();
    const s = await start(d);
    const state = (s?.body as { data: { state: string } }).data.state;
    const first = await callback(d, `code=abc&state=${state}`);
    expect(first?.status).toBe(302);
    const second = await callback(d, `code=def&state=${state}`);
    expect(second?.status).toBe(401);
  });

  it('refuses a callback missing code or state before touching the state store', async () => {
    const d = deps();
    expect((await callback(d, 'state=x'))?.status).toBe(400);
    expect((await callback(d, 'code=x'))?.status).toBe(400);
  });

  it('a GitHub exchange failure is a 401 and mints no session', async () => {
    const d = deps({ exchange: async () => ({ __error: 'GitHub refused the OAuth token exchange (HTTP 401).' }) });
    const s = await start(d);
    const state = (s?.body as { data: { state: string } }).data.state;
    const r = await callback(d, `code=bad&state=${state}`);
    expect(r?.status).toBe(401);
    expect((r?.body as { kind: string }).kind).toBe('github_exchange_failed');
    expect(d.sessions.size.sessions).toBe(0);
  });
});

describe('the OAuth state store is single-use, expiring, and may carry a participant', () => {
  it('consumes a state exactly once', () => {
    const store = createOAuthStateStore();
    const state = store.issue(NOW);
    expect(store.consume(state, NOW + 1).found).toBe(true);
    expect(store.consume(state, NOW + 2).found).toBe(false);
  });
  it('recovers a bound participant exactly once', () => {
    const store = createOAuthStateStore();
    const state = store.issue(NOW, 'ghu-77');
    const c = store.consume(state, NOW + 1);
    expect(c.found).toBe(true);
    if (c.found) expect(c.participant).toBe('ghu-77');
    expect(store.consume(state, NOW + 2).found).toBe(false);
  });
  it('refuses an expired state', () => {
    const store = createOAuthStateStore();
    const state = store.issue(NOW, 'ghu-1');
    expect(store.consume(state, NOW + OAUTH_STATE_TTL_MS + 1).found).toBe(false);
  });
  it('refuses a state it never issued', () => {
    expect(createOAuthStateStore().consume('never-issued', NOW).found).toBe(false);
  });
});

describe('the app-installation flow proves who controls an installation', () => {
  const installStart = (d: GithubAuthDeps, headers: { authorization?: string; origin?: string } = {}) =>
    handleGithubAuthRoute({
      method: 'POST', path: '/auth/github/install/start', url: '/relay-api/auth/github/install/start',
      authorization: headers.authorization, origin: headers.origin,
    }, d);
  const installCallback = (d: GithubAuthDeps, qs: string) =>
    handleGithubAuthRoute({ method: 'GET', path: '/auth/github/install/callback', url: `/relay-api/auth/github/install/callback?${qs}` }, d);

  function signedInSession(d: GithubAuthDeps): string {
    const minted = d.sessions.mintIdentitySession({ origin: ORIGIN, now: NOW, participantId: 'ghu-4242' });
    if (!minted.ok) throw new Error('mint failed');
    return minted.session.token;
  }

  it('install/start requires a signed-in control session', async () => {
    const d = deps();
    expect((await installStart(d))?.status).toBe(401);
    const token = signedInSession(d);
    const r = await installStart(d, { authorization: `Relay-Session ${token}`, origin: ORIGIN });
    expect(r?.status).toBe(200);
    const data = (r?.body as { data: { installUrl: string; state: string } }).data;
    expect(data.installUrl).toContain(INSTALL_BASE);
    expect(data.installUrl).toContain(`state=${data.state}`);
  });

  it('install/start answers 503 when installation is unconfigured', async () => {
    const d = deps({ installBaseUrl: null });
    const token = signedInSession(d);
    const r = await installStart(d, { authorization: `Relay-Session ${token}`, origin: ORIGIN });
    expect(r?.status).toBe(503);
  });

  it('a proven install records the (participant, installationId) grant', async () => {
    const d = deps();
    const token = signedInSession(d);
    const started = await installStart(d, { authorization: `Relay-Session ${token}`, origin: ORIGIN });
    const state = (started?.body as { data: { state: string } }).data.state;

    expect(d.installGrants.granted('ghu-4242', '55550001')).toBe(false);
    const cb = await installCallback(d, `installation_id=55550001&state=${state}`);
    expect(cb?.status).toBe(200);
    expect(d.installGrants.granted('ghu-4242', '55550001')).toBe(true);
    // Bound to the participant who STARTED it, not to whoever hit the callback.
    expect((cb?.body as { data: { participantId: string } }).data.participantId).toBe('ghu-4242');
  });

  it('a forged install state records nothing', async () => {
    const d = deps();
    const cb = await installCallback(d, 'installation_id=55550001&state=forged');
    expect(cb?.status).toBe(401);
    expect(d.installGrants.size).toBe(0);
  });

  it('a non-numeric installation_id is refused', async () => {
    const d = deps();
    const token = signedInSession(d);
    const started = await installStart(d, { authorization: `Relay-Session ${token}`, origin: ORIGIN });
    const state = (started?.body as { data: { state: string } }).data.state;
    const cb = await installCallback(d, `installation_id=not-a-number&state=${state}`);
    expect(cb?.status).toBe(400);
  });
});
