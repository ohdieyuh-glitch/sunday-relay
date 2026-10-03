import { describe, expect, it } from 'vitest';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { blockUser } from './social-friends';
import { acceptPartyInvite, inviteToParty, partyViewFor } from './social-parties';
import { buildSocialView } from './social-preview';
import { partyOf, type SocialState } from './social-state';

/*
 * THE BLOCK FLOOR (F1, CORE's review of the durable two-client run, 2026-10-02). A block does not break a shared party
 * (leaving is the member's own act), so the party is where a block could still leak: before this, the blocked player kept
 * the blocker in their roster -- id, role and live microphone state -- and every self-mute or role change of the blocker
 * reached them as an event. Now: neither appears in the other's party view, and no update one causes reaches the other.
 * A third member still sees and hears from both.
 */

const NOW = '2026-10-02T20:00:00.000Z';

function run(state: SocialState, actor: string, op: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown> = {}, ids: string[] = []) {
  const r = applySocialOperation(state, op, actor, { ids, body, query: {} }, NOW);
  if (!r.ok) throw new Error(`${op} refused: ${r.error.message}`);
  return r.value as SocialCommandOutcome;
}

/** The fixture's Arena Run (ORION leads, LYRA is in it) with KAI (ORION's friend) as a third member, then LYRA blocks ORION. */
function arenaRunWithABlock() {
  let s = createSocialFixture();
  const pid = partyOf(s, U.ORION)?.partyId;
  if (pid === undefined) throw new Error('the fixture has no Arena Run');
  const invited = inviteToParty(s, U.ORION, pid, U.KAI, NOW);
  if (!invited.ok) throw new Error(`invite: ${invited.error.message}`);
  const joined = acceptPartyInvite(invited.value.state, U.KAI, invited.value.inviteId, NOW);
  if (!joined.ok) throw new Error(`accept: ${joined.error.message}`);
  s = joined.value;
  // The domain block alone, WITHOUT the separation blocks.add now performs (social-block-separation.test.ts): a state
  // with a block inside a shared party -- data from before the founder's rule, or any future path -- still leaks nothing.
  const blocked = blockUser(s, U.LYRA, U.ORION, NOW);
  if (!blocked.ok) throw new Error(`block: ${blocked.error.message}`);
  s = blocked.value;
  return { s, pid };
}

describe('the block floor in a shared party', () => {
  it('a block inside a shared party (no separation) leaves neither in the other\'s roster', () => {
    const { s, pid } = arenaRunWithABlock();
    expect(s.parties[pid].members.map((m) => m.userId).sort()).toEqual([U.LYRA, U.ORION, U.KAI].sort());
    const orionSees = partyViewFor(s, U.ORION, pid);
    const lyraSees = partyViewFor(s, U.LYRA, pid);
    expect(orionSees?.members.map((m) => m.userId).sort()).toEqual([U.ORION, U.KAI].sort());
    expect(lyraSees?.members.map((m) => m.userId).sort()).toEqual([U.LYRA, U.KAI].sort());
    // the leader is the blocked one: LYRA is not even told who leads
    expect(lyraSees?.leaderId).toBe('');
    expect(orionSees?.leaderId).toBe(U.ORION);
    expect(orionSees?.viewerIsLeader).toBe(true);
  });

  it('a third member still sees both', () => {
    const { s, pid } = arenaRunWithABlock();
    expect(partyViewFor(s, U.KAI, pid)?.members.map((m) => m.userId).sort()).toEqual([U.LYRA, U.ORION, U.KAI].sort());
    expect(partyViewFor(s, U.KAI, pid)?.leaderId).toBe(U.ORION);
  });

  it("the blocked player's whole snapshot party holds nothing of the blocker, and the blocker's nothing of them", () => {
    const { s } = arenaRunWithABlock();
    const orion = buildSocialView(s, U.ORION, NOW, { developmentPreview: false });
    const lyra = buildSocialView(s, U.LYRA, NOW, { developmentPreview: false });
    expect(JSON.stringify(orion.party)).not.toContain(U.LYRA);
    expect(JSON.stringify(lyra.party)).not.toContain(U.ORION);
  });

  it('the wall first, then reconciliation: the next operation separates the pair by the founder\'s rule, and neither hears the other', () => {
    const { s, pid } = arenaRunWithABlock();
    // LYRA (a member) blocked ORION (the leader) inside the party; the next operation by anyone reconciles first:
    // not the leader, so LYRA leaves -- ORION is not kicked by a member's block
    const orionRenames = run(s, U.ORION, 'parties.rules', { name: 'Arena Run II' }, [pid]);
    expect(partyOf(orionRenames.state, U.LYRA)).toBeUndefined();
    expect(orionRenames.state.parties[pid].leaderId).toBe(U.ORION);
    expect(orionRenames.state.parties[pid].members.map((m) => m.userId).sort()).toEqual([U.KAI, U.ORION].sort());
    // the update ORION caused reaches the party that remains, never LYRA
    expect([...orionRenames.audience].sort()).toEqual([U.KAI, U.ORION].sort());
    // and nothing LYRA does reaches ORION
    const lyraUpdates = run(orionRenames.state, U.LYRA, 'presence.update_self', { availability: 'BUSY' });
    expect(lyraUpdates.audience).not.toContain(U.ORION);
  });

  it('without a block nothing is filtered', () => {
    const s = createSocialFixture();
    const pid = partyOf(s, U.ORION)?.partyId as string;
    const mutes = run(s, U.LYRA, 'parties.self_mute', { muted: true });
    expect([...mutes.audience].sort()).toEqual([U.LYRA, U.ORION].sort());
    expect(partyViewFor(s, U.LYRA, pid)?.members.map((m) => m.userId).sort()).toEqual([U.LYRA, U.ORION].sort());
  });
});
