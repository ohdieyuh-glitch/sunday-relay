import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { openWfsMemoryStore } from '../src/relay/wonderfs/wonderfs-memory-store';
import { createBrowserSessionStore, NATIVE_SESSION_TTL_MS, NATIVE_SOCIAL_AUDIENCE, NATIVE_WORLD_AUDIENCE } from './browser-session/grants';
import { wonderfsGate, wonderfsHumanPrincipal, wonderfsSessionVerifier } from './wonderfs-gate';
import { answerWonderfs } from './wonderfs-routes';

/**
 * T-SESSION-REF (contract r1.4 §19.m1): a player's provenance `session_id` is a `session_ref` -- 128 random bits minted WITH the
 * session and kept beside it. It is not the token, not the hash the session is looked up by, not the session id, derivable from
 * none of them, and it authenticates NOTHING anywhere. WonderFS's principal carries exactly it.
 * CONTROL: a store that recorded the lookup hash (or the token, or the id) as the ref is caught by `derivedFrom` below.
 */

const T0 = Date.parse('2026-10-12T12:00:00.000Z');
const PLAYER = 'ghu-4242';

/** Every way a ref could have been computed from a session's secrets: the CONTROL's detector. */
function derivedFrom(ref: string, token: string, sessionId: string): boolean {
  const digest = createHash('sha256').update(token, 'utf8').digest();
  const candidates = [token, sessionId, digest.toString('hex'), digest.toString('base64'), digest.toString('base64url'), digest.toString('hex').slice(0, 32)];
  return candidates.some((c) => c === ref || c.includes(ref) || ref.includes(c));
}

function minted() {
  const sessions = createBrowserSessionStore();
  const m = sessions.mintNativeSocialSession({ now: T0, participantId: PLAYER });
  if (!m.ok) throw new Error('not minted');
  const ref = sessions.nativeSocialSessionRef({ sessionId: m.session.sessionId, now: T0 + 1 });
  if (ref === null) throw new Error('no session ref');
  return { sessions, token: m.session.token, sessionId: m.session.sessionId, ref };
}

describe('T-SESSION-REF: the session_ref authenticates nothing and is derived from nothing', () => {
  it('128 random bits, apart from the token, its lookup hash and the session id; CONTROL: the detector catches a ref computed from the token', () => {
    const { token, sessionId, ref } = minted();
    expect(ref).toMatch(/^[0-9a-f]{32}$/u);
    expect(derivedFrom(ref, token, sessionId)).toBe(false);
    const lookupHash = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(derivedFrom(lookupHash, token, sessionId), 'CONTROL: a store recording the lookup hash is caught').toBe(true);
    expect(derivedFrom(lookupHash.slice(0, 32), token, sessionId), 'CONTROL: or a prefix of it').toBe(true);
    // two sessions of one player: two refs
    const sessions = createBrowserSessionStore();
    const a = sessions.mintNativeSocialSession({ now: T0, participantId: PLAYER });
    const b = sessions.mintNativeSocialSession({ now: T0, participantId: PLAYER });
    if (!a.ok || !b.ok) throw new Error('not minted');
    expect(sessions.nativeSocialSessionRef({ sessionId: a.session.sessionId, now: T0 })).not.toBe(sessions.nativeSocialSessionRef({ sessionId: b.session.sessionId, now: T0 }));
  });

  it('the ref presented as a credential is refused by EVERY verifier, by revoke and by the WonderFS route; CONTROL: the token itself is accepted', async () => {
    const { sessions, token, ref } = minted();
    const now = T0 + 2;
    expect(sessions.verifyNativeSocialSession({ token: ref, now }).ok).toBe(false);
    expect(sessions.verifyNativeSession({ token: ref, now }).ok).toBe(false);
    expect(sessions.verifySession({ token: ref, origin: undefined, now }).ok).toBe(false);
    expect(sessions.verifySession({ token: ref, origin: NATIVE_SOCIAL_AUDIENCE, now }).ok).toBe(false);
    expect(sessions.revokeSession({ token: ref, now })).toBe(false);
    expect(wonderfsSessionVerifier(sessions)(ref, now)).toBeNull();
    const store = openWfsMemoryStore();
    const deps = { verifySession: wonderfsSessionVerifier(sessions), store, budgets: null };
    const request = (credential: string) => ({ method: 'GET', url: '/wonderfs/v1/projects', authorization: `Relay-Session ${credential}`, origin: undefined, clientBuild: undefined, range: undefined, now });
    const asRef = await answerWonderfs(request(ref), deps);
    expect([asRef?.status, JSON.parse(asRef?.body.toString('utf8') ?? '{}').error.kind]).toEqual([401, 'session_required']);
    const asToken = await answerWonderfs(request(token), deps);
    expect(asToken?.status, 'CONTROL: the token').toBe(200);
  });

  it('WonderFS\'s principal carries the ref as its session id -- never the token, the hash or the id -- and the build only in its shape', async () => {
    const { sessions, token, sessionId, ref } = minted();
    const store = openWfsMemoryStore();
    const gate = await wonderfsGate(
      { method: 'GET', url: '/wonderfs/v1/projects', authorization: `Relay-Session ${token}`, origin: undefined, clientBuild: 'WL-0.9.3+r12', range: undefined, now: T0 + 3 },
      { verifySession: wonderfsSessionVerifier(sessions), store, budgets: null },
    );
    if (!gate.ok) throw new Error(`refused: ${gate.answer.status}`);
    expect(gate.admitted.principal).toEqual({ kind: 'human', id: PLAYER, onBehalfOf: null, grantId: null, sessionId: ref, clientBuild: 'WL-0.9.3+r12', tool: 'wonderland-client', missionId: null, attemptId: null });
    expect(derivedFrom(gate.admitted.principal.sessionId as string, token, sessionId)).toBe(false);
    const facts = { sessionId, participantId: PLAYER, sessionRef: ref, capabilities: ['wonderfs'] };
    expect(wonderfsHumanPrincipal(facts, 'bad build with spaces').clientBuild, 'a build outside its shape is unknown').toBeNull();
    expect(wonderfsHumanPrincipal(facts, undefined).clientBuild).toBeNull();
  });

  it('only a LIVE native social session has a ref: a browser or world session, a revoked or expired one, has none', () => {
    const { sessions, token, sessionId } = minted();
    const browser = sessions.mintIdentitySession({ origin: 'https://sunday-relay.vercel.app', now: T0, participantId: PLAYER });
    if (!browser.ok) throw new Error('not minted');
    expect(sessions.nativeSocialSessionRef({ sessionId: browser.session.sessionId, now: T0 + 1 })).toBeNull();
    const g = sessions.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: T0, scope: 'native_world', participantId: PLAYER, projectId: 'prj-1' });
    const world = sessions.consumeGrant({ grantId: g.grantId, secret: g.secret, origin: NATIVE_WORLD_AUDIENCE, now: T0 });
    if (!world.ok) throw new Error('not minted');
    expect(sessions.nativeSocialSessionRef({ sessionId: world.session.sessionId, now: T0 + 1 })).toBeNull();
    expect(sessions.nativeSocialSessionRef({ sessionId, now: T0 + NATIVE_SESSION_TTL_MS }), 'expired').toBeNull();
    expect(sessions.nativeSocialSessionRef({ sessionId, now: T0 + 1 }), 'CONTROL: live').not.toBeNull();
    expect(sessions.revokeSession({ token, now: T0 + 2 })).toBe(true);
    expect(sessions.nativeSocialSessionRef({ sessionId, now: T0 + 3 }), 'revoked').toBeNull();
  });
});
