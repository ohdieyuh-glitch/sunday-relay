import { describe, expect, it } from 'vitest';
import {
  NATIVE_SOCIAL_CAPABILITY,
  SOCIAL_OPERATIONS,
  bindSocialActor,
  nativeSocialMayCall,
  type NativeSocialSessionFacts,
} from './wonderland-social-scope';

const SOCIAL: NativeSocialSessionFacts = { scope: 'native_world', participantId: 'usr_kai', capabilities: ['world_stream', NATIVE_SOCIAL_CAPABILITY] };
const WORLD_ONLY: NativeSocialSessionFacts = { scope: 'native_world', participantId: 'usr_kai', capabilities: ['world_stream'] };
const BROWSER: NativeSocialSessionFacts = { scope: 'browser_control', participantId: 'usr_kai', capabilities: [NATIVE_SOCIAL_CAPABILITY] };
const UNBOUND: NativeSocialSessionFacts = { scope: 'native_world', participantId: null, capabilities: [NATIVE_SOCIAL_CAPABILITY] };

/** One concrete path per operation, ids filled in. */
const sample = (pattern: RegExp): string =>
  pattern.source
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\[A-Za-z0-9_-\]\{1,80\}/g, 'abc_1')
    .replace(/\\\//g, '/');

describe('the social capability admits exactly its table', () => {
  it('admits every operation, by its own method, for a paired desktop session holding `social`', () => {
    for (const op of SOCIAL_OPERATIONS) {
      expect(nativeSocialMayCall(op.method, sample(op.pattern), SOCIAL)?.id, op.id).toBe(op.id);
    }
  });

  it('refuses the same calls to today\'s world-only native session, to browser sessions, and to an unbound session', () => {
    for (const op of SOCIAL_OPERATIONS) {
      const path = sample(op.pattern);
      expect(nativeSocialMayCall(op.method, path, WORLD_ONLY)).toBeNull();
      expect(nativeSocialMayCall(op.method, path, BROWSER)).toBeNull();
      expect(nativeSocialMayCall(op.method, path, UNBOUND)).toBeNull();
    }
  });

  it('never reaches anything outside /wonderland/social', () => {
    const outside = [
      ['GET', '/wonderland/events'],
      ['POST', '/wonderland/presence/join'],
      ['POST', '/wonderland/presence/heartbeat'],
      ['POST', '/wonderland/challenges'],
      ['GET', '/wonderland/battles/b1/result'],
      ['POST', '/wonderland/battles/b1/swarm'],
      ['GET', '/wonderland/projects/p1/brain'],
      ['POST', '/relay-api/mission/start'],
      ['GET', '/relay-api/missions'],
      ['POST', '/relay-api/architect/verify'],
      ['GET', '/health'],
      ['GET', '/wonderland/social'],
      ['GET', '/wonderland/socialx/friends'],
    ] as const;
    for (const [method, path] of outside) expect(nativeSocialMayCall(method, path, SOCIAL), path).toBeNull();
  });

  it('refuses the wrong method, traversal, encoding and doubled slashes', () => {
    expect(nativeSocialMayCall('POST', '/wonderland/social/friends', SOCIAL)).toBeNull();
    expect(nativeSocialMayCall('DELETE', '/wonderland/social/friends/usr_x/remove', SOCIAL)).toBeNull();
    expect(nativeSocialMayCall('GET', '/wonderland/social/profiles/../../projects/p1/brain', SOCIAL)).toBeNull();
    expect(nativeSocialMayCall('GET', '/wonderland/social/profiles/usr%2F..%2Fbrain', SOCIAL)).toBeNull();
    expect(nativeSocialMayCall('GET', '/wonderland/social//friends', SOCIAL)).toBeNull();
    expect(nativeSocialMayCall('GET', '/wonderland/social/profiles/a/b', SOCIAL)).toBeNull();
  });

  it('distinguishes reading from writing the same resource by method', () => {
    expect(nativeSocialMayCall('GET', '/wonderland/social/presence', SOCIAL)?.id).toBe('presence.read');
    expect(nativeSocialMayCall('POST', '/wonderland/social/presence', SOCIAL)?.id).toBe('presence.update_self');
    expect(SOCIAL_OPERATIONS.filter((o) => o.writes).every((o) => o.method === 'POST')).toBe(true);
  });
});

describe('the actor is always the paired player', () => {
  it('binds the session\'s player and refuses a body that names anybody else as the actor', () => {
    expect(bindSocialActor(SOCIAL, { toUserId: 'usr_nova' })).toEqual({ ok: true, actorId: 'usr_kai' });
    expect(bindSocialActor(SOCIAL, { actorId: 'usr_kai', body: 'hi' })).toEqual({ ok: true, actorId: 'usr_kai' });
    for (const field of ['actorId', 'fromUserId', 'senderId', 'muterId', 'blockerId', 'reporterId', 'ownerId', 'inviterId']) {
      expect(bindSocialActor(SOCIAL, { [field]: 'usr_mallory' }).ok, field).toBe(false);
    }
    expect(bindSocialActor(UNBOUND, {}).ok).toBe(false);
  });
});
