import { describe, expect, it } from 'vitest';

import {
  buildAuthorizeUrl,
  exchangeCodeForUser,
  githubOAuthConfigFromEnv,
} from './github-oauth';

/**
 * SIGN IN WITH GITHUB. The client secret and the user access token are used to
 * verify the identity and NEVER surfaced; only the public login/id leave.
 * Secrets here are fixtures.
 */

const CONFIG = { clientId: 'Iv1.public_client_id', clientSecret: 'fixture-client-secret-xyz' };

describe('buildAuthorizeUrl carries only the public client id + state, never the secret', () => {
  it('points at GitHub authorize with client_id, redirect_uri, state', () => {
    const url = buildAuthorizeUrl({ config: CONFIG, redirectUri: 'https://relay/cb', state: 's123' });
    expect(url).toContain('/login/oauth/authorize');
    expect(url).toContain('client_id=Iv1.public_client_id');
    expect(url).toContain('state=s123');
    expect(url).not.toContain(CONFIG.clientSecret);
  });
});

describe('exchangeCodeForUser returns the public identity and leaks no secret', () => {
  const stubFetch = (cap: { tokenBody?: unknown; userAuth?: string }) =>
    (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      if (url.includes('/login/oauth/access_token')) {
        cap.tokenBody = init?.body ? JSON.parse(init.body) : undefined;
        return { ok: true, status: 200, json: async () => ({ access_token: 'ghu_user_access_token', token_type: 'bearer' }) };
      }
      // /user
      cap.userAuth = init?.headers?.Authorization;
      return { ok: true, status: 200, json: async () => ({ login: 'beta-user', id: 4242, type: 'User' }) };
    }) as never;

  it('exchanges the code and reads /user, sending the secret only to GitHub token endpoint', async () => {
    const cap: { tokenBody?: { client_secret?: string; code?: string }; userAuth?: string } = {};
    const r = await exchangeCodeForUser({
      config: CONFIG, code: 'abc', redirectUri: 'https://relay/cb', fetchImpl: stubFetch(cap),
    });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.login).toBe('beta-user'); expect(r.value.id).toBe(4242); }
    // The token exchange carried the secret+code to GitHub; the identity call used a Bearer user token, not the secret.
    expect(cap.tokenBody?.client_secret).toBe(CONFIG.clientSecret);
    expect(cap.tokenBody?.code).toBe('abc');
    expect(cap.userAuth).toMatch(/^Bearer ghu_/);
  });

  it('an empty code is refused before any request', async () => {
    const r = await exchangeCodeForUser({ config: CONFIG, code: '  ', redirectUri: 'x', fetchImpl: (async () => { throw new Error('should not be called'); }) as never });
    expect(r.ok).toBe(false);
  });

  it('a GitHub refusal returns an error carrying neither the secret nor a token', async () => {
    const badFetch = (async () => ({ ok: false, status: 401, json: async () => ({ error: 'bad_verification_code', access_token: 'ghu_should_not_appear' }) })) as never;
    const r = await exchangeCodeForUser({ config: CONFIG, code: 'abc', redirectUri: 'x', fetchImpl: badFetch });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).not.toContain(CONFIG.clientSecret);
      expect(r.error.message).not.toContain('ghu_');
      expect(r.error.message).toContain('401');
    }
  });

  it('a token response with no access_token is refused (no user is signed in)', async () => {
    const noToken = (async (url: string) => url.includes('access_token')
      ? { ok: true, status: 200, json: async () => ({ error: 'bad_verification_code' }) }
      : { ok: true, status: 200, json: async () => ({ login: 'x', id: 1 }) }) as never;
    const r = await exchangeCodeForUser({ config: CONFIG, code: 'abc', redirectUri: 'x', fetchImpl: noToken });
    expect(r.ok).toBe(false);
  });
});

describe('githubOAuthConfigFromEnv', () => {
  it('reads client id + secret from env, null when unset', () => {
    expect(githubOAuthConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    const c = githubOAuthConfigFromEnv({ RELAY_GITHUB_APP_CLIENT_ID: 'Iv1.x', RELAY_GITHUB_APP_CLIENT_SECRET: 'sek' } as NodeJS.ProcessEnv);
    expect(c?.clientId).toBe('Iv1.x');
  });
});
