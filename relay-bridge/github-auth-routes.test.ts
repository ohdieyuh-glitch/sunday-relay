import { describe, expect, it } from 'vitest';

import {
  createOAuthStateStore,
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

function deps(over: Partial<GithubAuthDeps> = {}): GithubAuthDeps {
  return {
    oauthConfig: CONFIG,
    sessions: createBrowserSessionStore(),
    stateStore: createOAuthStateStore(),
    redirectUri: REDIRECT,
    sessionOrigin: ORIGIN,
    now: NOW,
    exchange: async () => ({ login: 'beta-user', id: 4242, type: 'User' }),
    ...over,
  };
}

const start = (d: GithubAuthDeps) =>
  handleGithubAuthRoute({ method: 'GET', path: '/auth/github/start', url: '/relay-api/auth/github/start' }, d);
const callback = (d: GithubAuthDeps, qs: string) =>
  handleGithubAuthRoute({ method: 'GET', path: '/auth/github/callback', url: `/relay-api/auth/github/callback?${qs}` }, d);

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
  it('exchanges the code and mints a control session whose participant IS the identity', async () => {
    const d = deps();
    const s = await start(d);
    const state = (s?.body as { data: { state: string } }).data.state;

    const r = await callback(d, `code=abc&state=${state}`);
    expect(r?.status).toBe(200);
    const data = (r?.body as { data: { sessionToken: string; participantId: string; login: string; scope: string } }).data;
    expect(data.scope).toBe('browser_control');
    expect(data.participantId).toBe('ghu-4242');
    expect(data.login).toBe('beta-user');

    // The token really works: it verifies as a control session for that participant.
    const verified = d.sessions.verifySession({ token: data.sessionToken, origin: ORIGIN, now: NOW + 1 });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.scope).toBe('browser_control');
      expect(verified.participantId).toBe('ghu-4242');
    }
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
    expect(first?.status).toBe(200);
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

describe('the OAuth state store is single-use and expiring', () => {
  it('consumes a state exactly once', () => {
    const store = createOAuthStateStore();
    const state = store.issue(NOW);
    expect(store.consume(state, NOW + 1)).toBe(true);
    expect(store.consume(state, NOW + 2)).toBe(false);
  });
  it('refuses an expired state', () => {
    const store = createOAuthStateStore();
    const state = store.issue(NOW);
    expect(store.consume(state, NOW + OAUTH_STATE_TTL_MS + 1)).toBe(false);
  });
  it('refuses a state it never issued', () => {
    expect(createOAuthStateStore().consume('never-issued', NOW)).toBe(false);
  });
});
