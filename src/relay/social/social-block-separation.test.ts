import { describe, expect, it } from 'vitest';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { blockUser } from './social-friends';
import { acceptPartyInvite, inviteToParty, partyViewFor, reconcileBlockedParties, voiceAudienceFor } from './social-parties';
import { resolveProfileFor } from './social-presence';
import { buildSocialView } from './social-preview';
import { hasBlocked, partyOf, type SocialState } from './social-state';
import { createLocalVoiceHarness } from './social-voice';

/*
 * F1, THE FOUNDER'S FINAL RULE (2026-10-02): "LEADER REMOVES, ELSE BLOCKER LEAVES", every shared-party block confirmed first,
 * behind an Xbox-style privacy wall. The founder's seven proofs, in order:
 *   1 the leader blocks a member -> confirm -> the blocked member is removed (the leader stays leader)
 *   2 a non-leader blocks a member -> confirm -> the blocker leaves (the blocked member stays)
 *   3 an unconfirmed request changes nothing
 *   4 neither side can infer the other's party membership
 *   5 voice is mutually suppressed
 *   6 a third member keeps the correct permitted view
 *   7 restart/reconnect preserves everything (the store's real-PostgreSQL suite and the durable two-client run carry the
 *     restart itself; here: a state carrying a block inside a party -- old data, a restore -- is walled, then reconciled)
 * The fixture's Arena Run: ORION leads, LYRA joined at -58; KAI (ORION's friend) is added as a third member.
 */

const NOW = '2026-10-02T21:00:00.000Z';

function apply(state: SocialState, actor: string, op: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown> = {}) {
  return applySocialOperation(state, op, actor, { ids: [], body, query: {} }, NOW);
}

function ok(state: SocialState, actor: string, op: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown> = {}) {
  const r = apply(state, actor, op, body);
  if (!r.ok) throw new Error(`${op} refused: ${r.error.message}`);
  return r.value as SocialCommandOutcome;
}

/** Arena Run with three members: ORION (leader), LYRA, KAI. */
function threeMemberArena() {
  const s = createSocialFixture();
  const pid = partyOf(s, U.ORION)?.partyId as string;
  const invited = inviteToParty(s, U.ORION, pid, U.KAI, NOW);
  if (!invited.ok) throw new Error(invited.error.message);
  const joined = acceptPartyInvite(invited.value.state, U.KAI, invited.value.inviteId, NOW);
  if (!joined.ok) throw new Error(joined.error.message);
  return { s: joined.value, pid };
}

const members = (s: SocialState, pid: string) => s.parties[pid].members.map((m) => m.userId).sort();

describe('F1: leader removes, else blocker leaves', () => {
  it('1. the leader blocks a member: after the confirmation the blocked member is removed and the leader stays leader', () => {
    const { s, pid } = threeMemberArena();
    const out = ok(s, U.ORION, 'blocks.add', { targetId: U.LYRA, confirmSharedParty: true });
    expect(hasBlocked(out.state, U.ORION, U.LYRA)).toBe(true);
    expect(partyOf(out.state, U.LYRA)).toBeUndefined();
    expect(out.state.parties[pid].leaderId).toBe(U.ORION);
    expect(members(out.state, pid)).toEqual([U.KAI, U.ORION].sort());
    // the remaining party is told, and so is the removed player -- the ordinary kick (founder, 10-04), never a block
    expect([...out.audience].sort()).toEqual([U.KAI, U.LYRA, U.ORION].sort());
    expect(out.eventOp).toBe('parties.remove_member');
  });

  it('2. a non-leader blocks a member: after the confirmation the BLOCKER leaves and the blocked member stays', () => {
    const { s, pid } = threeMemberArena();
    const out = ok(s, U.KAI, 'blocks.add', { targetId: U.LYRA, confirmSharedParty: true });
    expect(hasBlocked(out.state, U.KAI, U.LYRA)).toBe(true);
    expect(partyOf(out.state, U.KAI)).toBeUndefined();
    expect(members(out.state, pid)).toEqual([U.LYRA, U.ORION].sort());
    expect(out.state.parties[pid].leaderId).toBe(U.ORION);
  });

  it('2b. a member blocking the LEADER leaves; an ordinary member can never kick by blocking', () => {
    const { s, pid } = threeMemberArena();
    const out = ok(s, U.LYRA, 'blocks.add', { targetId: U.ORION, confirmSharedParty: true });
    expect(partyOf(out.state, U.LYRA)).toBeUndefined();
    expect(out.state.parties[pid].leaderId).toBe(U.ORION);
    expect(members(out.state, pid)).toEqual([U.KAI, U.ORION].sort());
  });

  it("3. an unconfirmed request changes nothing, and says what will happen in the founder's words", () => {
    const { s, pid } = threeMemberArena();
    const asLeader = apply(s, U.ORION, 'blocks.add', { targetId: U.LYRA });
    const asMember = apply(s, U.KAI, 'blocks.add', { targetId: U.LYRA });
    expect(asLeader.ok).toBe(false);
    expect(asMember.ok).toBe(false);
    if (asLeader.ok || asMember.ok) return;
    expect(asLeader.error.message).toContain('Blocking Lyra will also remove them from your party.');
    expect(asMember.error.message).toContain('Blocking Lyra will cause you to leave this party.');
    // nothing committed: no block, the same party, the same friendships
    expect(hasBlocked(s, U.ORION, U.LYRA)).toBe(false);
    expect(hasBlocked(s, U.KAI, U.LYRA)).toBe(false);
    expect(members(s, pid)).toEqual([U.KAI, U.LYRA, U.ORION].sort());
  });

  it("4. neither side can infer the other's party membership: no party view, no party status, OFFLINE, nothing in the snapshot", () => {
    const { s, pid } = threeMemberArena();
    const out = ok(s, U.ORION, 'blocks.add', { targetId: U.LYRA, confirmSharedParty: true });
    // LYRA is out of ORION's party; she cannot see it, and ORION's profile tells her nothing: she opens it exactly as a
    // stranger who shares nothing (founder, 10-04) -- no relationship, no party, no mutual friends, no word of a block
    expect(partyViewFor(out.state, U.LYRA, pid)).toBeNull();
    const lyraSeesOrion = resolveProfileFor(out.state, U.LYRA, U.ORION);
    expect(lyraSeesOrion?.relationship).toBe('NONE');
    expect(lyraSeesOrion?.partyStatus).toEqual({ inParty: false, memberCount: null, joinable: false });
    expect(lyraSeesOrion?.mutualFriendIds).toEqual([]);
    expect(JSON.stringify(lyraSeesOrion)).not.toMatch(/BLOCKED/);
    // ORION, the blocker, sees LYRA's profile as BLOCKED, OFFLINE, with no party status
    const orionSeesLyra = resolveProfileFor(out.state, U.ORION, U.LYRA);
    expect(orionSeesLyra?.relationship).toBe('BLOCKED');
    expect(orionSeesLyra?.presence.onlineState).toBe('OFFLINE');
    expect(orionSeesLyra?.partyStatus.inParty).toBe(false);
    expect(orionSeesLyra?.partyStatus.memberCount).toBeNull();
    // whole snapshots
    expect(JSON.stringify(buildSocialView(out.state, U.ORION, NOW, { developmentPreview: false }).party)).not.toContain(U.LYRA);
    expect(JSON.stringify(buildSocialView(out.state, U.LYRA, NOW, { developmentPreview: false }))).not.toContain(pid);
  });

  it('5. voice is mutually suppressed: neither is in the other\'s voice audience, and a provider cannot add them', () => {
    // a state where the pair still share the party (old data / a restore), before reconciliation: the wall holds first
    const { s, pid } = threeMemberArena();
    const blocked = blockUser(s, U.LYRA, U.ORION, NOW);
    if (!blocked.ok) throw new Error(blocked.error.message);
    const walled = blocked.value;
    expect(voiceAudienceFor(walled, U.ORION, pid).sort()).toEqual([U.KAI, U.ORION].sort());
    expect(voiceAudienceFor(walled, U.LYRA, pid).sort()).toEqual([U.KAI, U.LYRA].sort());
    expect(voiceAudienceFor(walled, U.KAI, pid).sort()).toEqual([U.KAI, U.LYRA, U.ORION].sort());
    // the voice roster is built from the walled party view, and the transport cannot put the blocked player into it
    const orionView = partyViewFor(walled, U.ORION, pid);
    const harness = createLocalVoiceHarness(U.ORION);
    harness.connect(pid, orionView?.members.map((m) => m.userId) ?? []);
    harness.emit({ kind: 'connected' });
    harness.emit({ kind: 'member-joined', userId: U.LYRA });
    harness.emit({ kind: 'speaking', userId: U.LYRA, speaking: true });
    harness.emit({ kind: 'member-joined', userId: U.KAI });
    const ids = harness.getState().participants.map((p) => p.userId);
    expect(ids).not.toContain(U.LYRA);
    expect(ids).toContain(U.KAI);
  });

  it('6. a third member keeps the normal permitted view of the party that remains', () => {
    const { s, pid } = threeMemberArena();
    const out = ok(s, U.KAI, 'blocks.add', { targetId: U.LYRA, confirmSharedParty: true });
    // KAI left; ORION (the third party to this block) still sees LYRA in his party, as before
    expect(partyViewFor(out.state, U.ORION, pid)?.members.map((m) => m.userId).sort()).toEqual([U.LYRA, U.ORION].sort());
    const muted = ok(out.state, U.LYRA, 'parties.self_mute', { muted: true });
    expect(muted.audience).toContain(U.ORION);
    expect(muted.audience).not.toContain(U.KAI);
    expect(partyViewFor(muted.state, U.ORION, pid)?.members.find((m) => m.userId === U.LYRA)?.selfMuted).toBe(true);
  });

  it('7. a block carried inside a shared party (old data, a restore) is walled, then reconciled by the same rule', () => {
    const { s, pid } = threeMemberArena();
    // the LEADER's block, carried in without the separation
    const carried = blockUser(s, U.ORION, U.LYRA, NOW);
    if (!carried.ok) throw new Error(carried.error.message);
    // walled before anything runs
    expect(partyViewFor(carried.value, U.LYRA, pid)?.members.some((m) => m.userId === U.ORION)).toBe(false);
    expect(partyViewFor(carried.value, U.LYRA, pid)?.leaderId).toBe('');
    // reconciled: the leader's rule removes the blocked member
    const reconciled = reconcileBlockedParties(carried.value);
    expect(partyOf(reconciled, U.LYRA)).toBeUndefined();
    expect(reconciled.parties[pid].leaderId).toBe(U.ORION);
    // and any operation reconciles first, so the stored state the store writes back is the separated one
    const next = ok(carried.value, U.KAI, 'presence.update_self', { availability: 'BUSY' });
    expect(partyOf(next.state, U.LYRA)).toBeUndefined();
    expect(hasBlocked(next.state, U.ORION, U.LYRA)).toBe(true);
  });

  it('a block with no shared party needs no confirmation and touches no party', () => {
    const s = createSocialFixture();
    const parties = JSON.stringify(s.parties);
    const out = ok(s, U.KAI, 'blocks.add', { targetId: U.NOVA });
    expect(hasBlocked(out.state, U.KAI, U.NOVA)).toBe(true);
    expect(JSON.stringify(out.state.parties)).toBe(parties);
    expect(out.audience).toEqual([U.KAI]);
  });
});
