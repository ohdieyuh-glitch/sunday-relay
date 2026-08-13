import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginGitHubSignIn, completeGitHubSignIn, loadBridgeSession, clearBridgeSession,
  saveBridgeSession, beginRepositoryInstall, readInstallationFromReturn, registerRepository,
} from './bridge-session';

/** A signed-in control session, for the seams that require one. */
const saveBridgeSessionForTest = () =>
  saveBridgeSession({ token: 't', origin: '', expiresAt: '', scope: 'browser_control', participantId: 'ghu-4242' });

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

describe('connect-a-repository client seams', () => {
  it('reads the installation id the install redirect leaves, null otherwise', () => {
    expect(readInstallationFromReturn({ locationHash: '#relay_installation=55550001' })).toBe('55550001');
    expect(readInstallationFromReturn({ locationHash: '' })).toBeNull();
  });

  it('beginRepositoryInstall needs a session, then navigates to the install URL', async () => {
    const noSession = await beginRepositoryInstall({ bridgeUrl: BRIDGE, fetchImpl: (async () => { throw new Error('no'); }) as typeof fetch });
    expect(noSession.ok).toBe(false);

    saveBridgeSessionForTest();
    let navigatedTo: string | null = null;
    const r = await beginRepositoryInstall({
      bridgeUrl: BRIDGE,
      fetchImpl: (async () => jsonRes(true, { installUrl: 'https://github.com/apps/relay/installations/new?state=s' })) as typeof fetch,
      navigate: (u) => { navigatedTo = u; },
    });
    expect(r.ok).toBe(true);
    expect(navigatedTo).toContain('/installations/new');
  });

  it('registerRepository returns the key on success and the refusal message on failure', async () => {
    saveBridgeSessionForTest();
    const okReg = await registerRepository({
      draft: {}, bridgeUrl: BRIDGE, fetchImpl: (async () => jsonRes(true, { key: 'github:github.com/o/r' })) as typeof fetch,
    });
    expect(okReg).toMatchObject({ ok: true, key: 'github:github.com/o/r' });

    const refused = await registerRepository({
      draft: {}, bridgeUrl: BRIDGE,
      fetchImpl: (async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'You have not authorized that GitHub App installation.' } }) }) as unknown as Response) as typeof fetch,
    });
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain('not authorized');
  });
});
