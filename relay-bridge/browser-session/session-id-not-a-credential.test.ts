import { describe, expect, it } from 'vitest';
import { NATIVE_SOCIAL_AUDIENCE, createBrowserSessionStore } from './grants';
import { nativeSocialSessionDeps } from '../wonderland-social-routes';

/*
 * F3 (the Reviewer's 035 review): voice_puid_binding.session_id is stored in plaintext, "if that id can authenticate a session
 * (a cookie / bearer value), persisting it is a credential at rest". It cannot:
 *   - a session is found ONLY by its token, and the store keeps the token as sha256 (tokenHash), never as text (grants.ts);
 *   - the id is a separate random value (randomBytes(9)), not derived from the token;
 *   - every verifier and revoke take the TOKEN; the one lookup BY id (nativeSocialSessionIssuedAt) answers a timestamp.
 * What the voice route stores is the id the verifier hands back for a token, never the token.
 */

const T0 = Date.parse('2026-10-11T12:00:00.000Z');
const PLAYER = 'ghu-12345';

function minted() {
  const store = createBrowserSessionStore();
  const m = store.mintNativeSocialSession({ now: T0, participantId: PLAYER });
  if (!m.ok) throw new Error('not minted');
  return { store, sessionId: m.session.sessionId, token: m.session.token };
}

describe('F3: a session id (what voice_puid_binding.session_id stores) is not a credential', () => {
  it('the id presented as the token is refused by every verifier and by revoke; the token itself (CONTROL) passes', () => {
    const { store, sessionId, token } = minted();
    const now = T0 + 1;
    expect(sessionId).not.toBe(token);
    expect(store.verifyNativeSocialSession({ token: sessionId, now }).ok).toBe(false);
    expect(store.verifyNativeSession({ token: sessionId, now }).ok).toBe(false);
    expect(store.verifySession({ token: sessionId, origin: NATIVE_SOCIAL_AUDIENCE, now }).ok).toBe(false);
    expect(store.verifySession({ token: sessionId, origin: undefined, now }).ok).toBe(false);
    expect(store.revokeSession({ token: sessionId, now })).toBe(false);
    // CONTROL: the attempts changed nothing, and the session's own token still verifies
    expect(store.verifyNativeSocialSession({ token, now })).toEqual({ ok: true, sessionId, participantId: PLAYER, issuedAt: T0 });
    // the one lookup by id answers WHEN the session was issued: nothing that authenticates
    expect(store.nativeSocialSessionIssuedAt({ sessionId, now })).toBe(T0);
  });

  it('what the voice route receives to store is the id the verifier returned for a token, never the token', () => {
    const { store, sessionId, token } = minted();
    const deps = nativeSocialSessionDeps(store);
    const verified = deps.verifySession(token, T0 + 1);
    expect(verified?.sessionId).toBe(sessionId);
    expect(verified?.sessionId).not.toBe(token);
    expect(deps.verifySession(sessionId, T0 + 1)).toBeNull();
  });
});
