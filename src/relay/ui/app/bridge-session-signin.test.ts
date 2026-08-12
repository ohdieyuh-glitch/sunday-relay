import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginGitHubSignIn, completeGitHubSignIn, loadBridgeSession, clearBridgeSession,
} from './bridge-session';

/**
 * SIGN IN WITH GITHUB, on the browser side. The two guarantees under test: begin
 * only ever navigates to the bridge's public authorize URL, and complete reads a
 * ONE-TIME CLAIM from the URL (never a token), exchanges it over POST, saves the
 * session, and strips the claim. A load with no claim is an ordinary load, not a
 * failed sign-in.
 */

const BRIDGE = 'https://bridge.example';
afterEach(() => { clearBridgeSession(); vi.restoreAllMocks(); });

const jsonRes = (ok: boolean, data: unknown) =>
  ({ ok, status: ok ? 200 : 401, json: async () => ({ data }) }) as unknown as Response;

describe('beginGitHubSignIn', () => {
  it('navigates to the authorize URL the bridge returns', async () => {
    let navigatedTo: string | null = null;
    const r = await beginGitHubSignIn({
      bridgeUrl: BRIDGE,
      fetchImpl: (async () => jsonRes(true, { authorizeUrl: 'https://github.com/login/oauth/authorize?x=1' })) as typeof fetch,
      navigate: (u) => { navigatedTo = u; },
    });
    expect(r.ok).toBe(true);
    expect(navigatedTo).toBe('https://github.com/login/oauth/authorize?x=1');
  });

  it('reports unavailable when no bridge is configured', async () => {
    const r = await beginGitHubSignIn({ bridgeUrl: null });
    expect(r.ok).toBe(false);
  });

  it('reports unavailable when the bridge has no sign-in', async () => {
    const r = await beginGitHubSignIn({
      bridgeUrl: BRIDGE, fetchImpl: (async () => jsonRes(false, {})) as typeof fetch, navigate: () => {},
    });
    expect(r.ok).toBe(false);
  });
});

describe('completeGitHubSignIn', () => {
  it('exchanges a one-time claim for the session, saves it, and strips the claim', async () => {
    let posted: { url: string; body: string } | null = null;
    let cleared = false;
    const r = await completeGitHubSignIn({
      locationHash: '#relay_claim=the-claim-code',
      bridgeUrl: BRIDGE,
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        posted = { url: String(url), body: String(init?.body) };
        return jsonRes(true, { sessionToken: 'sess-tok', scope: 'browser_control', participantId: 'ghu-4242', expiresAt: '2026-08-12T13:00:00.000Z' });
      }) as typeof fetch,
      clearClaim: () => { cleared = true; },
    });
    expect(r.signedIn).toBe(true);
    // The claim went in the POST body, to the claim endpoint.
    expect(posted!.url).toContain('/relay-api/auth/github/claim');
    expect(posted!.body).toContain('the-claim-code');
    // The session was saved and the claim stripped from the URL.
    expect(loadBridgeSession()?.token).toBe('sess-tok');
    expect(loadBridgeSession()?.participantId).toBe('ghu-4242');
    expect(cleared).toBe(true);
  });

  it('is a no-op (not an error) when the URL carries no claim', async () => {
    const r = await completeGitHubSignIn({ locationHash: '', bridgeUrl: BRIDGE, fetchImpl: (async () => { throw new Error('should not fetch'); }) as typeof fetch });
    expect(r.signedIn).toBe(false);
    expect(r.message).toBeNull();
    expect(loadBridgeSession()).toBeNull();
  });

  it('reports a used/expired claim without saving a session', async () => {
    const r = await completeGitHubSignIn({
      locationHash: '#relay_claim=stale', bridgeUrl: BRIDGE,
      fetchImpl: (async () => jsonRes(false, {})) as typeof fetch, clearClaim: () => {},
    });
    expect(r.signedIn).toBe(false);
    expect(r.message).toContain('sign in again');
    expect(loadBridgeSession()).toBeNull();
  });
});
