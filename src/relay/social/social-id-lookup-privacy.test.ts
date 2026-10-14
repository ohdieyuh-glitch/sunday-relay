import { describe, expect, it } from 'vitest';
import { applySocialOperation } from './social-commands';
import type { SocialAudience, SocialOperationId, SocialUserId, UserProfileView } from './social-contracts';
import { resolvePresenceFor } from './social-presence';
import { buildSocialView } from './social-preview';
import { emptySocialState, partyOf, type SocialState } from './social-state';
import { ensureSocialUser } from './social-store';

/*
 * OBS-1 (independent finding C14-WL3-12, founder ruling 2026-10-14): a player hidden from strangers -- whose presence audience leaves
 * the viewer out -- must not have their name, handle, avatar or Dog read by an unrelated stranger who merely knows their id. Option
 * (b), adopted: to a viewer OUTSIDE the subject's presence audience and with NO relationship, a lookup by id answers EXACTLY what a
 * lookup of a player who does not exist answers -- status, code, message and shape, field for field -- so "hidden" and "no such
 * player" cannot be told apart. The BLOCKED side sees the blocker as a stranger who shares nothing (founder, 10-04), so whatever a
 * hidden stranger's lookup answers, the blocked side's lookup of the blocker answers the same.
 *
 * Viewers WITH a relationship (a friend, a party member, a pending request either way, the blocker managing their own block) and
 * viewers INSIDE the presence audience see exactly what they saw before.
 */

const NOW = '2026-10-14T12:00:00.000Z';
const ADA = 'usr_ada'; // the subject
const BO = 'usr_bo'; // a stranger to everybody
const CY = 'usr_cy'; // Ada's friend
const DEE = 'usr_dee'; // in Ada's party, not her friend (Cy's friend)
const EVE = 'usr_eve'; // sent Ada a friend request (pending)
const FAY = 'usr_fay'; // Ada sent her a friend request (pending)
const GHOST = 'usr_ghost'; // nobody: no record exists

type Outcome = ReturnType<typeof applySocialOperation>;

function op(s: SocialState, actor: string, name: SocialOperationId, body: Record<string, unknown> = {}, ids: string[] = []): Outcome {
  return applySocialOperation(s, name, actor, { ids, body, query: {} }, NOW);
}
function must(s: SocialState, actor: string, name: SocialOperationId, body: Record<string, unknown> = {}, ids: string[] = []): SocialState {
  const r = op(s, actor, name, body, ids);
  if (!r.ok) throw new Error(`${name} by ${actor} refused: ${r.error.message}`);
  return r.value.state;
}
function befriend(s: SocialState, a: string, b: string): SocialState {
  const sent = must(s, a, 'requests.send', { toUserId: b });
  const req = sent.requests.find((r) => r.fromUserId === a && r.toUserId === b && r.status === 'PENDING')!;
  return must(sent, b, 'requests.accept', {}, [req.requestId]);
}

type SubjectState = 'online' | 'appear-offline' | 'signed-out';

/** The cast. Ada's presence audience and connection are the variables; every other relationship is fixed. */
function cast(presenceVisibility: SocialAudience, subject: SubjectState = 'online'): SocialState {
  let s = emptySocialState();
  for (const id of [ADA, BO, CY, DEE, EVE, FAY]) s = ensureSocialUser(s, { userId: id, displayName: id.slice(4).toUpperCase(), handle: `@${id.slice(4)}` }, NOW);
  // Ada's card carries something to show: a showcase companion, a worn skin
  s = {
    ...s,
    users: {
      ...s.users,
      [ADA]: {
        ...s.users[ADA],
        profile: {
          ...s.users[ADA].profile,
          relayDog: { ...s.users[ADA].profile.relayDog, skinId: 'baal' },
          showcaseCompanions: [{ companionId: 'cmp_ada_jhinn', ownerId: ADA, kind: 'JHINN_AGENT', displayName: 'Jhinn', primary: null, secondary: null }],
        },
      },
    },
  };
  for (const id of [ADA, BO, CY, DEE, EVE, FAY]) s = must(s, id, 'presence.update_self', { connected: true, availability: 'AVAILABLE' });
  s = befriend(s, ADA, CY);
  s = befriend(s, CY, DEE);
  s = must(s, CY, 'parties.create', { name: 'Crew' });
  const pid = partyOf(s, CY)!.partyId;
  for (const id of [ADA, DEE]) {
    const invited = op(s, CY, 'parties.invite', { toUserId: id }, [pid]);
    if (!invited.ok) throw new Error(invited.error.message);
    s = must(invited.value.state, id, 'party_invites.accept', {}, [(invited.value.data as { inviteId: string }).inviteId]);
  }
  s = must(s, EVE, 'requests.send', { toUserId: ADA });
  s = must(s, ADA, 'requests.send', { toUserId: FAY });
  s = must(s, ADA, 'privacy.update_self', { presenceVisibility });
  if (subject === 'appear-offline') s = must(s, ADA, 'presence.update_self', { availability: 'APPEAR_OFFLINE' });
  if (subject === 'signed-out') s = must(s, ADA, 'presence.update_self', { connected: false });
  return s;
}

const HIDDEN: readonly SocialAudience[] = ['FRIENDS', 'PARTY', 'NOBODY'];
const SUBJECT_STATES: readonly SubjectState[] = ['online', 'appear-offline', 'signed-out'];
const BY_ID: readonly SocialOperationId[] = ['profile.read', 'showcase.read'];

describe('OBS-1: a hidden player looked up by id by a stranger answers exactly as a player who does not exist', () => {
  for (const audience of HIDDEN) {
    for (const subject of SUBJECT_STATES) {
      for (const read of BY_ID) {
        it(`${read}: presence ${audience}, subject ${subject} -- the stranger's answer deep-equals the nonexistent id's`, () => {
          const s = cast(audience, subject);
          const hidden = op(s, BO, read, {}, [ADA]);
          const nobody = op(s, BO, read, {}, [GHOST]);
          expect(nobody.ok, 'the control: a nonexistent id is refused').toBe(false);
          expect(hidden).toEqual(nobody);
          expect(JSON.stringify(hidden)).not.toMatch(/ADA|@ada|baal|Jhinn/);
        });
      }
    }
  }

  it('the stranger\'s presence view offers no profile to open, and still offers mute, block and report', () => {
    for (const audience of HIDDEN) {
      const view = resolvePresenceFor(cast(audience), BO, ADA)!;
      expect(view.can.viewProfile, audience).toBe(false);
      expect([view.can.mute, view.can.block, view.can.report], audience).toEqual([true, true, true]);
    }
  });

  it('mute, block and report stay reachable by id with no profile read first (the backend needs nothing else)', () => {
    for (const audience of HIDDEN) {
      const s = cast(audience);
      expect(op(s, BO, 'profile.read', {}, [ADA]).ok, `${audience}: the card is closed`).toBe(false);
      expect(op(s, BO, 'mutes.set', { targetId: ADA }).ok, `${audience}: mute`).toBe(true);
      expect(op(s, BO, 'reports.file', { reportedId: ADA, reason: 'OTHER' }).ok, `${audience}: report`).toBe(true);
      const blocked = op(s, BO, 'blocks.add', { targetId: ADA });
      expect(blocked.ok, `${audience}: block`).toBe(true);
      // and the blocker manages their block on the card, as before (unblock)
      if (blocked.ok) expect(op(blocked.value.state, BO, 'profile.read', {}, [ADA]).ok, `${audience}: the blocker's own card`).toBe(true);
    }
  });
});

describe('OBS-1 x the founder\'s 10-04 wall: the BLOCKED side reads the blocker exactly as a stranger who shares nothing', () => {
  for (const audience of ['EVERYONE', ...HIDDEN] as const) {
    for (const read of BY_ID) {
      it(`${read}: Ada (presence ${audience}) blocks Bo -- Bo's lookup deep-equals a nonexistent id's and a stranger's of Ada sharing nothing`, () => {
        const s = must(cast(audience), ADA, 'blocks.add', { targetId: BO });
        const blockedSide = op(s, BO, read, {}, [ADA]);
        const nobody = op(s, BO, read, {}, [GHOST]);
        // the stranger who shares nothing: the same subject, every audience NOBODY, read by somebody with no relationship
        const sharesNothing = must(cast('NOBODY'), ADA, 'privacy.update_self', { activityVisibility: 'NOBODY', locationVisibility: 'NOBODY', messagePolicy: 'NOBODY', friendRequestPolicy: 'NOBODY' });
        const stranger = op(sharesNothing, BO, read, {}, [ADA]);
        expect(blockedSide).toEqual(nobody);
        expect(blockedSide).toEqual(stranger);
        expect(JSON.stringify(blockedSide)).not.toMatch(/BLOCK|ADA|baal/);
      });
    }
  }

  it('the blocked side\'s presence view is the hidden stranger\'s privateStrangerView: no profile to open, mute/block/report kept', () => {
    const s = must(cast('EVERYONE'), ADA, 'blocks.add', { targetId: BO });
    const view = resolvePresenceFor(s, BO, ADA)!;
    expect(view.can.viewProfile).toBe(false);
    expect([view.can.mute, view.can.block, view.can.report]).toEqual([true, true, true]);
    expect(view.restrictedReason).toBe('PRIVATE');
  });
});

describe('OBS-1 changes nothing for a viewer with a relationship, or inside the presence audience', () => {
  const card = (s: SocialState, viewer: string) => {
    const r = op(s, viewer, 'profile.read', {}, [ADA]);
    if (!r.ok) throw new Error(`${viewer} could not open Ada's card: ${r.error.message}`);
    return r.value.data as UserProfileView;
  };

  for (const audience of HIDDEN) {
    it(`presence ${audience}: friend, party member, pending request either way -- the card opens with the name, handle and avatar`, () => {
      const s = cast(audience);
      for (const [viewer, relationship] of [[CY, 'FRIEND'], [DEE, 'NONE'], [EVE, 'REQUEST_SENT'], [FAY, 'REQUEST_RECEIVED']] as const) {
        const view = card(s, viewer);
        expect([view.profile.displayName, view.profile.handle, view.profile.avatarRef], viewer).toEqual(['ADA', '@ada', `generated:${ADA}`]);
        expect(view.relationship, viewer).toBe(relationship);
        expect(view.presence.can.viewProfile, viewer).toBe(true);
        const showcase = op(s, viewer, 'showcase.read', {}, [ADA]);
        expect(showcase.ok && (showcase.value.data as { showcaseCompanions: unknown[] }).showcaseCompanions.length, viewer).toBe(1);
      }
    });
  }

  it('a party member inside a PARTY audience sees Ada online, her skin included (inside the audience: unchanged)', () => {
    const view = card(cast('PARTY'), DEE);
    expect(view.presence.onlineState).toBe('ONLINE');
    expect(view.profile.relayDog.skinId).toBe('baal');
  });

  it('the blocker still opens the card of the person they blocked, hidden or not (to manage the block)', () => {
    for (const audience of ['EVERYONE', ...HIDDEN] as const) {
      // Bo hides himself, and Ada blocks him: Ada keeps his card, as BLOCKED
      const s = must(must(cast('EVERYONE'), BO, 'privacy.update_self', { presenceVisibility: audience }), ADA, 'blocks.add', { targetId: BO });
      const r = op(s, ADA, 'profile.read', {}, [BO]);
      expect(r.ok && (r.value.data as UserProfileView).relationship, audience).toBe('BLOCKED');
      expect(buildSocialView(s, ADA, NOW, { developmentPreview: false }).profiles[BO]?.relationship, audience).toBe('BLOCKED');
    }
  });

  it('the snapshot\'s profiles keep every related person (friend, party member, requests either way)', () => {
    for (const audience of HIDDEN) {
      const s = cast(audience);
      for (const viewer of [CY, DEE, EVE, FAY]) {
        expect(buildSocialView(s, viewer, NOW, { developmentPreview: false }).profiles[ADA]?.profile.displayName, `${audience} ${viewer}`).toBe('ADA');
      }
    }
  });
});

describe('OBS-1: a PUBLIC player (presence EVERYONE) is still visible to strangers, and appearing offline reads as signing out', () => {
  it('a stranger opens the public card, profile and showcase', () => {
    const s = cast('EVERYONE');
    const r = op(s, BO, 'profile.read', {}, [ADA]);
    expect(r.ok && (r.value.data as UserProfileView).profile.displayName).toBe('ADA');
    expect(r.ok && (r.value.data as UserProfileView).presence.can.viewProfile).toBe(true);
    const showcase = op(s, BO, 'showcase.read', {}, [ADA]);
    expect(showcase.ok).toBe(true);
  });

  it('the stranger\'s card of an Appear-Offline public player equals the card of one who signed out (the rule keys on the audience only)', () => {
    const strip = (o: Outcome) => (o.ok ? { ...(o.value.data as UserProfileView), presence: { ...(o.value.data as UserProfileView).presence, lastSeenAtIso: null } } : o);
    const hiding = op(cast('EVERYONE', 'appear-offline'), BO, 'profile.read', {}, [ADA]);
    const gone = op(cast('EVERYONE', 'signed-out'), BO, 'profile.read', {}, [ADA]);
    expect(hiding.ok && gone.ok).toBe(true);
    expect(strip(hiding)).toEqual(strip(gone));
  });
});

describe('OBS-1, every viewer x every subject: a card is served exactly when the viewer is related or inside the presence audience', () => {
  it('holds across the whole cast for every presence audience', () => {
    for (const audience of ['EVERYONE', ...HIDDEN] as const) {
      const s = cast(audience);
      const ids: SocialUserId[] = [ADA, BO, CY, DEE, EVE, FAY];
      for (const viewer of ids) {
        for (const subject of ids) {
          const r = op(s, viewer, 'profile.read', {}, [subject]);
          const nobody = op(s, viewer, 'profile.read', {}, [GHOST]);
          const subjectAudience = s.users[subject].privacy.presenceVisibility;
          const related =
            viewer === subject ||
            s.friendships.some((f) => (f.userA === viewer && f.userB === subject) || (f.userA === subject && f.userB === viewer)) ||
            s.requests.some((q) => q.status === 'PENDING' && ((q.fromUserId === viewer && q.toUserId === subject) || (q.fromUserId === subject && q.toUserId === viewer))) ||
            (partyOf(s, viewer) !== undefined && partyOf(s, viewer) === partyOf(s, subject));
          const inAudience = subjectAudience === 'EVERYONE';
          if (related || inAudience) expect(r.ok, `${viewer} -> ${subject} (${audience})`).toBe(true);
          else expect(r, `${viewer} -> ${subject} (${audience})`).toEqual(nobody);
        }
      }
    }
  });
});
