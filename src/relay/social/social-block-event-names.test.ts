import { describe, expect, it } from 'vitest';
import { applySocialOperation } from './social-commands';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { acceptPartyInvite, inviteToParty } from './social-parties';
import { partyOf, type SocialState } from './social-state';
import { createInMemorySocialStore } from './social-store';

/*
 * NOTHING NAMES A BLOCK (the founder's wall; CORE's R16 step 12 "nothing leaks the block"; Second's W1). A confirmed block
 * inside a shared party separates the pair (F1), and the REMAINING members are told -- but as the party change it made, a
 * member removed or a member who left, never as `blocks.add`: that name, at the moment somebody leaves, would tell a third
 * member that a block happened and who made it. The blocked player is told the SAME ordinary change (founder, 10-04): removed
 * by the leader's block, the kick everybody removed gets (parties.remove_member); left behind by a blocker, the leave everybody
 * left behind gets (parties.leave). Silence there was itself the tell.
 */

const NOW = '2026-10-02T21:00:00.000Z';

/** Arena Run with three members: ORION (leader), LYRA, KAI. */
function threeMemberArena(): SocialState {
  const s = createSocialFixture();
  const pid = partyOf(s, U.ORION)?.partyId as string;
  const invited = inviteToParty(s, U.ORION, pid, U.KAI, NOW);
  if (!invited.ok) throw new Error(invited.error.message);
  const joined = acceptPartyInvite(invited.value.state, U.KAI, invited.value.inviteId, NOW);
  if (!joined.ok) throw new Error(joined.error.message);
  return joined.value;
}

const block = (s: SocialState, actor: string, target: string, confirm = true) =>
  applySocialOperation(s, 'blocks.add', actor, { ids: [], body: { targetId: target, ...(confirm ? { confirmSharedParty: true } : {}) }, query: {} }, NOW, undefined as never);

describe('a block that separates a party is told as the party change', () => {
  for (const [label, actor, target, told, op] of [
    ['the leader blocks a member: everybody, the removed member too, is told a member was removed', U.ORION, U.LYRA, [U.ORION, U.KAI, U.LYRA], 'parties.remove_member'],
    ['a member blocks a member: everybody, the blocked member too, is told a member left', U.KAI, U.LYRA, [U.KAI, U.ORION, U.LYRA], 'parties.leave'],
    ['a member blocks the leader: everybody, the blocked leader too, is told a member left', U.LYRA, U.ORION, [U.LYRA, U.KAI, U.ORION], 'parties.leave'],
  ] as const) {
    it(label, () => {
      const out = block(threeMemberArena(), actor, target);
      if (!out.ok) throw new Error(out.error.message);
      expect(out.value.eventOp).toBe(op);
      expect([...out.value.audience].sort()).toEqual([...told].sort());
      expect(out.value.eventOp).not.toBe('blocks.add');
    });
  }

  it('a block outside any shared party keeps its own name, told to the blocker alone', () => {
    const out = block(createSocialFixture(), U.KAI, U.VEGA, false);
    if (!out.ok) throw new Error(out.error.message);
    expect(out.value.eventOp).toBeUndefined();
    expect([...out.value.audience]).toEqual([U.KAI]);
  });
});

describe('the store writes the told name', () => {
  it('the third member and the blocked leader both hear that a member left, never a block', async () => {
    const store = createInMemorySocialStore();
    const run = async (op: Parameters<typeof store.apply>[0], actor: string, ids: string[], body: Record<string, unknown>) => {
      const result = await store.apply(op, actor, { ids, body, query: {} }, NOW);
      if (!result.ok) throw new Error(`${op} by ${actor}: ${result.error.message}`);
      return result.value as Record<string, unknown> | null;
    };
    for (const id of [U.ORION, U.LYRA, U.KAI]) await store.ensureUser({ userId: id, displayName: id, handle: `@${id}` }, NOW);
    // ORION befriends both, then leads a party of three -- through the store's own operations
    for (const friend of [U.LYRA, U.KAI]) {
      await run('requests.send', U.ORION, [], { toUserId: friend });
      const request = (await store.read()).requests.find((r) => r.toUserId === friend);
      await run('requests.accept', friend, [request?.requestId ?? ''], {});
    }
    await run('parties.create', U.ORION, [], { name: 'Arena Run' });
    const pid = partyOf(await store.read(), U.ORION)?.partyId ?? '';
    for (const member of [U.LYRA, U.KAI]) {
      const invite = await run('parties.invite', U.ORION, [pid], { toUserId: member });
      await run('party_invites.accept', member, [String(invite?.inviteId ?? '')], {});
    }
    expect(partyOf(await store.read(), U.KAI)?.members.length).toBe(3);
    const kaiBefore = (await store.eventsFor(U.KAI, 0, 1000)).latest;
    const orionBefore = (await store.eventsFor(U.ORION, 0, 1000)).latest;
    // LYRA blocks the leader ORION: she leaves; KAI and ORION (the blocked player) are told a member left, as for any leave
    await run('blocks.add', U.LYRA, [], { targetId: U.ORION, confirmSharedParty: true });
    expect((await store.eventsFor(U.KAI, kaiBefore, 1000)).events.map((e) => e.op)).toEqual(['parties.leave']);
    expect((await store.eventsFor(U.ORION, orionBefore, 1000)).events.map((e) => e.op)).toEqual(['parties.leave']);
  });
});
