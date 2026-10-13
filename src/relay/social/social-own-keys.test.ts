import { describe, expect, it } from 'vitest';
import { applySocialOperation } from './social-commands';
import { createSocialFixture, FIXTURE_NOW, FIXTURE_USERS as U } from './social-fixtures';
import { conversationById, hasUser, lffPostById, lffRequestById, messagesOf, userById, type SocialState } from './social-state';

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

  it('LFF: a planted name is no post and no request, by accessor and through every LFF operation that takes an id; the real ones resolve', () => {
    const call = (s: SocialState, actor: string, op: Parameters<typeof applySocialOperation>[1], ids: string[], body: Record<string, unknown> = {}) =>
      applySocialOperation(s, op, actor, { ids, body, query: {} }, FIXTURE_NOW);
    const made = call(createSocialFixture(), U.NOVA, 'lff.post.create', [], { category: 'TEAMS', title: 'Squad', openSlots: 1 });
    if (!made.ok) throw new Error(made.error.message);
    const postId = (made.value.data as { postId: string }).postId;
    const asked = call(made.value.state, U.KAI, 'lff.request.create', [postId]);
    if (!asked.ok) throw new Error(asked.error.message);
    const s = asked.value.state;
    const requestId = (asked.value.data as { requestId: string }).requestId;
    for (const key of PLANTED) {
      expect(lffPostById(s, key), key).toBeUndefined();
      expect(lffRequestById(s, key), key).toBeUndefined();
      const answers = [
        call(s, U.KAI, 'lff.post.get', [key]),
        call(s, U.NOVA, 'lff.post.edit', [key], { title: 'x' }),
        call(s, U.NOVA, 'lff.post.close', [key]),
        call(s, U.NOVA, 'lff.post.delete', [key]),
        call(s, U.NOVA, 'lff.requests.forPost', [key]),
        call(s, U.KAI, 'lff.request.create', [key]),
        call(s, U.KAI, 'lff.request.withdraw', [key]),
        call(s, U.NOVA, 'lff.request.accept', [key]),
        call(s, U.NOVA, 'lff.request.decline', [key]),
      ];
      expect(answers.map((r) => (r.ok ? 'ok' : r.error.code)), key).toEqual(Array(answers.length).fill('not-found'));
    }
    // the control: the real ids resolve, each to the very record the state holds, and the same operations reach them
    expect(lffPostById(s, postId)).toBe(s.lffPosts[0]);
    expect(lffRequestById(s, requestId)).toBe(s.lffRequests[0]);
    expect(call(s, U.KAI, 'lff.post.get', [postId]).ok).toBe(true);
    expect(call(s, U.NOVA, 'lff.request.accept', [requestId]).ok).toBe(true);
  });
});
