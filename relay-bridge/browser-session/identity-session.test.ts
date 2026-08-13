import { describe, expect, it } from 'vitest';

import {
  createBrowserSessionStore, isValidParticipantId, SESSION_TTL_MS,
} from './grants';

/**
 * SIGN IN WITH GITHUB, at the store seam.
 *
 * `mintIdentitySession` is the one way a control session is born without the
 * operator token. It is safe only because the caller proved the identity out of
 * band (a GitHub OAuth exchange). These tests hold that seam to the SAME
 * guarantees a paired session has — hashed, origin-bound, revocable — and prove
 * the one guard that makes it trustworthy: a control session is refused unless
 * it names a well-formed, verified participant. Remove that guard and the
 * "invalid participant is refused, and no session is created" tests fall.
 */

const ORIGIN = 'https://sunday-relay.vercel.app';
const EVIL = 'https://evil.example';
const NOW = 1_000_000;

describe('mintIdentitySession mints a real control session from a verified identity', () => {
  it('round-trips: the session verifies and carries the verified participant', () => {
    const store = createBrowserSessionStore();
    const minted = store.mintIdentitySession({ origin: ORIGIN, now: NOW, participantId: 'ghu-4242' });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.session.scope).toBe('browser_control');
    expect(minted.session.participantId).toBe('ghu-4242');
    expect(minted.session.expiresAt).toBe(NOW + SESSION_TTL_MS);

    const verified = store.verifySession({ token: minted.session.token, origin: ORIGIN, now: NOW + 1 });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.scope).toBe('browser_control');
      expect(verified.participantId).toBe('ghu-4242');
    }
  });

  it('is origin-bound: the same token from another origin is refused', () => {
    const store = createBrowserSessionStore();
    const minted = store.mintIdentitySession({ origin: ORIGIN, now: NOW, participantId: 'ghu-4242' });
    if (!minted.ok) throw new Error('mint failed');
    const wrongOrigin = store.verifySession({ token: minted.session.token, origin: EVIL, now: NOW + 1 });
    expect(wrongOrigin.ok).toBe(false);
  });

  it('is revocable, like any session', () => {
    const store = createBrowserSessionStore();
    const minted = store.mintIdentitySession({ origin: ORIGIN, now: NOW, participantId: 'ghu-4242' });
    if (!minted.ok) throw new Error('mint failed');
    expect(store.revokeSession({ token: minted.session.token, now: NOW + 2 })).toBe(true);
    expect(store.verifySession({ token: minted.session.token, origin: ORIGIN, now: NOW + 3 }).ok).toBe(false);
  });

  it('stores only a hash: a token that was never minted never verifies', () => {
    const store = createBrowserSessionStore();
    store.mintIdentitySession({ origin: ORIGIN, now: NOW, participantId: 'ghu-4242' });
    expect(store.verifySession({ token: 'not-the-real-token', origin: ORIGIN, now: NOW + 1 }).ok).toBe(false);
  });

  it('expires on the same clock as a paired session', () => {
    const store = createBrowserSessionStore();
    const minted = store.mintIdentitySession({ origin: ORIGIN, now: NOW, participantId: 'ghu-4242' });
    if (!minted.ok) throw new Error('mint failed');
    const afterExpiry = store.verifySession({ token: minted.session.token, origin: ORIGIN, now: NOW + SESSION_TTL_MS + 1 });
    expect(afterExpiry.ok).toBe(false);
  });
});

describe('a control identity session is refused without a well-formed verified participant', () => {
  // The guard proof: each of these must refuse AND leave no session behind — a
  // session that acts as nobody, or as an unbounded string, is the exact thing
  // this path removes. If the store stopped validating, these would create a
  // session and the size assertion would fail.
  for (const bad of ['', '   ', 'gh:4242', '-leading-hyphen', 'a'.repeat(65), 'has space']) {
    it(`refuses participant ${JSON.stringify(bad)} and creates no session`, () => {
      const store = createBrowserSessionStore();
      const minted = store.mintIdentitySession({ origin: ORIGIN, now: NOW, participantId: bad });
      expect(minted.ok).toBe(false);
      if (!minted.ok) expect(minted.reason).toBe('invalid_participant');
      expect(store.size.sessions).toBe(0);
    });
  }

  it('a read-only identity session carries no participant and is allowed', () => {
    const store = createBrowserSessionStore();
    const minted = store.mintIdentitySession({ origin: ORIGIN, now: NOW, participantId: '', scope: 'browser_read_only' });
    expect(minted.ok).toBe(true);
    if (minted.ok) expect(minted.session.participantId).toBeNull();
  });
});

describe('isValidParticipantId is the one shared shape', () => {
  it('accepts a GitHub-user encoding and rejects colons, spaces and overlong ids', () => {
    expect(isValidParticipantId('ghu-4242')).toBe(true);
    expect(isValidParticipantId('beta-seat-01')).toBe(true);
    expect(isValidParticipantId('gh:4242')).toBe(false);
    expect(isValidParticipantId('has space')).toBe(false);
    expect(isValidParticipantId('a'.repeat(65))).toBe(false);
    expect(isValidParticipantId(42)).toBe(false);
  });
});
