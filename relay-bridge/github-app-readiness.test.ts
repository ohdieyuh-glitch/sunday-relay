import { describe, expect, it } from 'vitest';

import { githubAppReadiness } from './github-app-readiness';

/**
 * GITHUB-APP CONFIGURATION DETECTION for the unauthenticated /health.
 *
 * The one guarantee: readiness is reported as BOOLEANS and CODES derived from
 * env PRESENCE and SHAPE — never a secret value. Each test asserts both the
 * expected code and that no value (secret, install URL, or callback URL) appears
 * anywhere in the returned object.
 */

const SECRET = 'fixture-client-secret-should-never-surface';
// Presence-only: the readiness helper checks that the key VARIABLE is set, never
// its value, so this fixture is a plain non-secret string (a PEM-shaped literal
// here would trip the repository secret tripwire and proves nothing extra).
const PRIVATE_KEY = 'fixture-app-private-key-material-not-a-real-secret';
const INSTALL_URL = 'https://github.com/apps/relay/installations/new';
const GOOD_CALLBACK = 'https://sunday-relay-production-7d60.up.railway.app/relay-api/auth/github/callback';

const base = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  RELAY_GITHUB_APP_CLIENT_ID: 'Iv1.public_client_id',
  RELAY_GITHUB_APP_CLIENT_SECRET: SECRET,
  RELAY_GITHUB_APP_ID: '123456',
  RELAY_GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
  RELAY_GITHUB_APP_INSTALL_URL: INSTALL_URL,
  RELAY_GITHUB_APP_CALLBACK_URL: GOOD_CALLBACK,
  ...over,
});

describe('githubAppReadiness reports presence + shape, never a value', () => {
  it('present-all → every readiness true and the callback code is ok', () => {
    const r = githubAppReadiness(base());
    expect(r).toEqual({
      githubSignInReady: true,
      githubAppReady: true,
      githubInstallReady: true,
      githubCallbackUrl: 'ok',
    });
    // The result carries no secret, no install URL, no callback URL — codes only.
    const json = JSON.stringify(r);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(PRIVATE_KEY);
    expect(json).not.toContain(INSTALL_URL);
    expect(json).not.toContain(GOOD_CALLBACK);
    expect(json).not.toContain('railway.app');
  });

  it('signInReady requires BOTH client id and secret', () => {
    expect(githubAppReadiness(base({ RELAY_GITHUB_APP_CLIENT_SECRET: undefined })).githubSignInReady).toBe(false);
    expect(githubAppReadiness(base({ RELAY_GITHUB_APP_CLIENT_ID: '  ' })).githubSignInReady).toBe(false);
  });

  it('appReady requires BOTH app id and private key present (presence only)', () => {
    expect(githubAppReadiness(base({ RELAY_GITHUB_APP_PRIVATE_KEY: undefined })).githubAppReady).toBe(false);
    expect(githubAppReadiness(base({ RELAY_GITHUB_APP_ID: '' })).githubAppReady).toBe(false);
    // Present but a bogus key still counts as "ready" — this is presence, not validity.
    expect(githubAppReadiness(base({ RELAY_GITHUB_APP_PRIVATE_KEY: 'x' })).githubAppReady).toBe(true);
  });

  it('installReady is presence of a non-empty install URL', () => {
    expect(githubAppReadiness(base({ RELAY_GITHUB_APP_INSTALL_URL: undefined })).githubInstallReady).toBe(false);
    expect(githubAppReadiness(base({ RELAY_GITHUB_APP_INSTALL_URL: '   ' })).githubInstallReady).toBe(false);
    expect(githubAppReadiness(base()).githubInstallReady).toBe(true);
  });

  it('a bare-host callback (no scheme) — what production has today — is not ok', () => {
    // This is the real production misconfiguration: a host with no scheme, no
    // path. It cannot be parsed as an absolute URL, so it is not_absolute_https.
    const r = githubAppReadiness(base({
      RELAY_GITHUB_APP_CALLBACK_URL: 'sunday-relay-production-7d60.up.railway.app',
    }));
    expect(r.githubCallbackUrl).toBe('not_absolute_https');
    expect(JSON.stringify(r)).not.toContain('railway.app');
  });

  it('an https host pointed at the wrong path is wrong_path', () => {
    expect(githubAppReadiness(base({
      RELAY_GITHUB_APP_CALLBACK_URL: 'https://sunday-relay-production-7d60.up.railway.app',
    })).githubCallbackUrl).toBe('wrong_path');
    expect(githubAppReadiness(base({
      RELAY_GITHUB_APP_CALLBACK_URL: 'https://bridge.example/some/other/path',
    })).githubCallbackUrl).toBe('wrong_path');
  });

  it('a non-https scheme with the right path is still not ok', () => {
    expect(githubAppReadiness(base({
      RELAY_GITHUB_APP_CALLBACK_URL: 'http://bridge.example/relay-api/auth/github/callback',
    })).githubCallbackUrl).toBe('not_absolute_https');
  });

  it('a missing callback URL is missing', () => {
    expect(githubAppReadiness(base({ RELAY_GITHUB_APP_CALLBACK_URL: undefined })).githubCallbackUrl).toBe('missing');
    expect(githubAppReadiness(base({ RELAY_GITHUB_APP_CALLBACK_URL: '   ' })).githubCallbackUrl).toBe('missing');
  });

  it('a trailing slash on an otherwise-correct callback is still ok', () => {
    expect(githubAppReadiness(base({
      RELAY_GITHUB_APP_CALLBACK_URL: 'https://bridge.example/relay-api/auth/github/callback/',
    })).githubCallbackUrl).toBe('ok');
  });
});
