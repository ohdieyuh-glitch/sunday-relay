import { describe, expect, it } from 'vitest';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { partyInvitesFor } from './social-parties';
import { buildSocialView } from './social-preview';
import { partyOf, type SocialState } from './social-state';

/*
 * THE PRIVACY WALL, AS SECOND'S ADVERSARIAL R16 HARNESS FOUND IT (2026-10-04, stub identities on a throwaway database), and the
 * founder's rulings on it. One describe per defect; each case is the harness's reproduction, made pure.
 */

const NOW = '2026-10-04T05:00:00.000Z';

type Outcome = { ok: true; value: SocialCommandOutcome } | { ok: false; error: { code: string; message: string } };
function op(s: SocialState, actor: string, name: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown> = {}, ids: string[] = []): Outcome {
  return applySocialOperation(s, name, actor, { ids, body, query: {} }, NOW) as Outcome;
}
function must(s: SocialState, actor: string, name: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown> = {}, ids: string[] = []) {
  const r = op(s, actor, name, body, ids);
  if (!r.ok) throw new Error(`${name} by ${actor} refused: ${r.error.message}`);
  return r.value;
}
/** What a refusal looks like from the outside: its code and its words. */
const refusal = (r: Outcome) => (r.ok ? 'ACCEPTED' : `${r.error.code}: ${r.error.message}`);
const view = (s: SocialState, viewer: string) => buildSocialView(s, viewer, NOW, { developmentPreview: false });

describe('D1 / D7: a block revokes every pending party invite that would carry one of the pair to the other', () => {
  it('the invite between the pair dies with the block, in both directions, and is not usable after the unblock', () => {
    for (const [blocker, blocked] of [[U.NOVA, U.KAI], [U.KAI, U.NOVA]]) {
      let s = createSocialFixture();
      s = must(s, U.KAI, 'parties.create', { name: 'Builders' }).state;
      const pid = partyOf(s, U.KAI)!.partyId;
      const invited = must(s, U.KAI, 'parties.invite', { toUserId: U.NOVA }, [pid]);
      const inviteId = (invited.data as { inviteId: string }).inviteId;
      s = must(invited.state, blocker, 'blocks.add', { targetId: blocked }).state;
      expect(s.partyInvites.find((i) => i.inviteId === inviteId)?.status, `${blocker} blocks ${blocked}`).toBe('REVOKED');
      expect(partyInvitesFor(s, U.NOVA, NOW)).toEqual([]);
      expect(view(s, U.NOVA).partyInvites).toEqual([]);
      s = must(s, blocker, 'blocks.remove', {}, [blocked]).state;
      // the pre-block invite stays dead: accepting it reads like any invite that is no longer there
      expect(refusal(op(s, U.NOVA, 'party_invites.accept', {}, [inviteId]))).toBe('not-found: pending party invite not found');
      expect(partyOf(s, U.NOVA)).toBeUndefined();
    }
  });

  it('an invite INTO a party the other is in dies too (Orion invites Kai; Kai blocks Lyra, who is in Orion\'s party)', () => {
    let s = createSocialFixture();
    const arena = partyOf(s, U.ORION)!.partyId;
    s = must(s, U.ORION, 'parties.rules', { privacy: 'INVITE_ONLY' }, [arena]).state;
    const invited = must(s, U.ORION, 'parties.invite', { toUserId: U.KAI }, [arena]);
    const inviteId = (invited.data as { inviteId: string }).inviteId;
    s = must(invited.state, U.KAI, 'blocks.add', { targetId: U.LYRA }).state;
    expect(s.partyInvites.find((i) => i.inviteId === inviteId)?.status).toBe('REVOKED');
    // and the fixture's own pending invite (Rhea's Lab Crew to Kai) dies when Kai blocks Rhea
    const lab = createSocialFixture();
    const labInvite = lab.partyInvites.find((i) => i.toUserId === U.KAI && i.status === 'PENDING')!;
    expect(must(lab, U.KAI, 'blocks.add', { targetId: U.RHEA }).state.partyInvites.find((i) => i.inviteId === labInvite.inviteId)?.status).toBe('REVOKED');
  });

  it('control: a block between two OTHER people leaves an invite alone', () => {
    let s = createSocialFixture();
    const labInvite = s.partyInvites.find((i) => i.toUserId === U.KAI && i.status === 'PENDING')!;
    s = must(s, U.NOVA, 'blocks.add', { targetId: U.ORION }).state;
    expect(s.partyInvites.find((i) => i.inviteId === labInvite.inviteId)?.status).toBe('PENDING');
  });
});

describe('D2 / ruling (a): nobody is invited or joins across a wall, and the refusal is the ordinary one', () => {
  it('an invite to somebody walled from ANY member is refused exactly like an invite to a stranger', () => {
    let s = createSocialFixture();
    const arena = partyOf(s, U.ORION)!.partyId; // Orion leads, Lyra is in it
    s = must(s, U.LYRA, 'blocks.add', { targetId: U.KAI }).state; // Lyra blocks Kai; Orion and Kai stay friends
    const acrossTheWall = op(s, U.ORION, 'parties.invite', { toUserId: U.KAI }, [arena]);
    const toAStranger = op(s, U.ORION, 'parties.invite', { toUserId: U.VEGA }, [arena]);
    expect(acrossTheWall.ok).toBe(false);
    expect(refusal(acrossTheWall)).toBe(refusal(toAStranger));
    expect(refusal(acrossTheWall)).toBe('permission-denied: this person cannot be invited');
    // and the inviter's own block reads the same
    const blockedPair = must(createSocialFixture(), U.KAI, 'blocks.add', { targetId: U.NOVA }).state;
    const kaiParty = must(blockedPair, U.KAI, 'parties.create', {}).state;
    expect(refusal(op(kaiParty, U.KAI, 'parties.invite', { toUserId: U.NOVA }, [partyOf(kaiParty, U.KAI)!.partyId]))).toBe(refusal(toAStranger));
  });

  it('joining a party behind your wall reads exactly like joining a party that does not exist', () => {
    let s = createSocialFixture();
    const arena = partyOf(s, U.ORION)!.partyId; // OPEN_TO_FRIENDS
    s = must(s, U.KAI, 'parties.join', {}, [arena]).state; // Mira blocked Kai; Kai is now in the arena
    s = must(s, U.MIRA, 'requests.send', { toUserId: U.LYRA }).state;
    s = must(s, U.LYRA, 'requests.accept', {}, [s.requests.find((r) => r.fromUserId === U.MIRA && r.status === 'PENDING')!.requestId]).state;
    const walled = op(s, U.MIRA, 'parties.join', {}, [arena]);
    expect(walled.ok).toBe(false);
    expect(refusal(walled)).toBe(refusal(op(s, U.MIRA, 'parties.join', {}, ['pty_does_not_exist'])));
  });

  it('an invite a later join brought behind the invitee\'s wall is not shown, and accepting it reads like one that is gone', () => {
    let s = createSocialFixture();
    s = must(s, U.NOVA, 'blocks.add', { targetId: U.JUNO }).state;
    s = must(s, U.KAI, 'parties.create', { name: 'Builders' }).state;
    const pid = partyOf(s, U.KAI)!.partyId;
    const toNova = must(s, U.KAI, 'parties.invite', { toUserId: U.NOVA }, [pid]);
    s = toNova.state;
    const novaInvite = (toNova.data as { inviteId: string }).inviteId;
    const toJuno = must(s, U.KAI, 'parties.invite', { toUserId: U.JUNO }, [pid]);
    s = must(toJuno.state, U.JUNO, 'party_invites.accept', {}, [(toJuno.data as { inviteId: string }).inviteId]).state;
    expect(partyInvitesFor(s, U.NOVA, NOW)).toEqual([]);
    expect(JSON.stringify(view(s, U.NOVA))).not.toContain('Builders');
    expect(refusal(op(s, U.NOVA, 'party_invites.accept', {}, [novaInvite]))).toBe(refusal(op(s, U.NOVA, 'party_invites.accept', {}, ['pinv_gone'])));
    expect(partyOf(s, U.NOVA)).toBeUndefined();
  });
});
