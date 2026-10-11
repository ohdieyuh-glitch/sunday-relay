import { describe, expect, it } from 'vitest';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { conversationById, hasUser, messagesOf, userById } from './social-state';

/*
 * OWN KEYS ONLY (MAIN JUJU's finding, CORE, 10-07): `users`, `conversations` and `messages` are plain objects, and a plain object
 * answers for keys it never stored. Each Object.prototype name below must read as "no such record"; the routes that take these
 * ids are planted with the same names in relay-bridge/wonderland-social-routes.test.ts.
 */
const PLANTED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

describe('10-07 own keys: a name the map never stored is no record', () => {
  it('hasUser, userById, conversationById and messagesOf answer "none" for every Object.prototype name', () => {
    const s = createSocialFixture();
    for (const key of PLANTED) {
      expect(hasUser(s, key), key).toBe(false);
      expect(userById(s, key), key).toBeUndefined();
      expect(conversationById(s, key), key).toBeUndefined();
      expect(messagesOf(s, key), key).toEqual([]);
    }
  });

  it('control: the real records still resolve, each to the very record the map holds', () => {
    const s = createSocialFixture();
    const dm = Object.values(s.conversations).find((c) => c.kind === 'DIRECT' && c.memberIds.includes(U.KAI) && c.memberIds.includes(U.NOVA))!;
    expect(hasUser(s, U.KAI)).toBe(true);
    expect(userById(s, U.KAI)).toBe(s.users[U.KAI]);
    expect(conversationById(s, dm.conversationId)).toBe(dm);
    expect(messagesOf(s, dm.conversationId)).toBe(s.messages[dm.conversationId]);
    expect(messagesOf(s, dm.conversationId).length).toBeGreaterThan(0);
  });
});
