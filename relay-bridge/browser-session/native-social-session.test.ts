import { describe, expect, it } from 'vitest';
import {
  NATIVE_SESSION_TTL_MS,
  NATIVE_SOCIAL_AUDIENCE,
  NATIVE_WORLD_AUDIENCE,
  browserSessionMayCall,
  createBrowserSessionStore,
} from './grants';

/*
 * THE DESKTOP CLIENT'S SOCIAL SESSION (R16). One player, no project, one capability, and one door: it must be invisible to
 * every browser verifier, refused by the Julius world stream's verifier, and the only thing the social verifier accepts.
 */

const T0 = Date.parse('2026-10-03T12:00:00.000Z');
const PLAYER = 'ghu-12345';
const WEB = 'https://wonderland.example';

function nativeWorldToken(store: ReturnType<typeof createBrowserSessionStore>): string {
  const grant = store.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: T0, scope: 'native_world', participantId: PLAYER, projectId: 'proj_1' });
  const redeemed = store.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: NATIVE_WORLD_AUDIENCE, now: T0 });
  if (!redeemed.ok) throw new Error('native world grant did not redeem');
  return redeemed.session.token;
}

describe('a native social session', () => {
  it('is minted for a valid player only, bound to the social audience, with no project and the native lifetime', () => {
    const store = createBrowserSessionStore();
    expect(store.mintNativeSocialSession({ now: T0, participantId: '' })).toEqual({ ok: false, reason: 'invalid_participant' });
    expect(store.mintNativeSocialSession({ now: T0, participantId: '../x' })).toEqual({ ok: false, reason: 'invalid_participant' });
    const minted = store.mintNativeSocialSession({ now: T0, participantId: PLAYER });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.session.scope).toBe('native_social');
    expect(minted.session.origin).toBe(NATIVE_SOCIAL_AUDIENCE);
    expect(minted.session.projectId).toBeNull();
    expect(minted.session.participantId).toBe(PLAYER);
    expect(minted.session.expiresAt).toBe(T0 + NATIVE_SESSION_TTL_MS);
    expect(store.verifyNativeSocialSession({ token: minted.session.token, now: T0 + 1 })).toEqual({
      ok: true, sessionId: minted.session.sessionId, participantId: PLAYER,
    });
  });

  it('expires, and is dead once revoked', () => {
    const store = createBrowserSessionStore();
    const minted = store.mintNativeSocialSession({ now: T0, participantId: PLAYER });
    if (!minted.ok) throw new Error('mint');
    expect(store.verifyNativeSocialSession({ token: minted.session.token, now: T0 + NATIVE_SESSION_TTL_MS })).toEqual({ ok: false, reason: 'expired' });
    const second = store.mintNativeSocialSession({ now: T0, participantId: PLAYER });
    if (!second.ok) throw new Error('mint');
    expect(store.revokeSession({ token: second.session.token, now: T0 + 5 })).toBe(true);
    expect(store.verifyNativeSocialSession({ token: second.session.token, now: T0 + 6 }).ok).toBe(false);
  });

  it('reaches NO browser verifier: verifySession refuses it with or without an Origin', () => {
    const store = createBrowserSessionStore();
    const minted = store.mintNativeSocialSession({ now: T0, participantId: PLAYER });
    if (!minted.ok) throw new Error('mint');
    expect(store.verifySession({ token: minted.session.token, origin: undefined, now: T0 + 1 }).ok).toBe(false);
    expect(store.verifySession({ token: minted.session.token, origin: WEB, now: T0 + 1 }).ok).toBe(false);
    expect(store.verifySession({ token: minted.session.token, origin: NATIVE_SOCIAL_AUDIENCE, now: T0 + 1 }).ok).toBe(false);
    for (const [method, path] of [['GET', '/reviewer/readiness'], ['GET', '/missions'], ['POST', '/mission/start']] as const) {
      expect(browserSessionMayCall(method, path, 'native_social'), path).toBe(false);
    }
  });

  it('can never read the Julius world stream: verifyNativeSession refuses it', () => {
    const store = createBrowserSessionStore();
    const minted = store.mintNativeSocialSession({ now: T0, participantId: PLAYER });
    if (!minted.ok) throw new Error('mint');
    expect(store.verifyNativeSession({ token: minted.session.token, now: T0 + 1 })).toEqual({ ok: false, reason: 'not_native' });
  });

  it('THE COPY GUARD, the other way: a browser control session and a native WORLD session are refused by the social verifier', () => {
    const store = createBrowserSessionStore();
    const browser = store.mintIdentitySession({ origin: WEB, now: T0, participantId: PLAYER, scope: 'browser_control' });
    if (!browser.ok) throw new Error('browser mint');
    expect(store.verifyNativeSocialSession({ token: browser.session.token, now: T0 + 1 })).toEqual({ ok: false, reason: 'not_native_social' });
    expect(store.verifyNativeSocialSession({ token: nativeWorldToken(store), now: T0 + 1 })).toEqual({ ok: false, reason: 'not_native_social' });
    expect(store.verifyNativeSocialSession({ token: 'not-a-token', now: T0 + 1 })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('has no other way in: no grant and no identity session can be made with the social scope', () => {
    const store = createBrowserSessionStore();
    expect(() => store.createGrant({ origin: NATIVE_SOCIAL_AUDIENCE, now: T0, scope: 'native_social', participantId: PLAYER })).toThrow();
    expect(() => store.mintIdentitySession({ origin: NATIVE_SOCIAL_AUDIENCE, now: T0, participantId: PLAYER, scope: 'native_social' })).toThrow();
  });
});
