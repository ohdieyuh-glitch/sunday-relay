import { describe, expect, it } from 'vitest';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import { PARTY_MAX_MEMBERS } from './social-contracts';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { partyInvitesFor, partyViewFor, recentPlayersViewFor } from './social-parties';
import { resolvePresenceFor } from './social-presence';
import { buildSocialView } from './social-preview';
import { partyById, partyOf, seenOnlineBy, type SocialState } from './social-state';
import { ensureSocialUser } from './social-store';

/*
 * WL-351-02 (the independent review of #351, 10-13; HIGH for R16): the snapshot's `visibleParties` showed an outsider (a) members
 * hidden from them -- a member hidden from strangers was a stranger's roster entry, with id, role and live mute -- and (b) an
 * Appear-Offline player's open party, which told every friend they were online. M2 had narrowed only the EVENT audience; these
 * cases read the SNAPSHOT (and the presence, profile, read and join that must agree with it). Each red case has its control.
 */

const NOW = '2026-10-13T15:00:00.000Z';
const WREN = 'usr_wren';

type Outcome = { ok: true; value: SocialCommandOutcome } | { ok: false; error: { code: string; message: string } };
function op(s: SocialState, actor: string, name: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown> = {}, ids: string[] = []): Outcome {
  return applySocialOperation(s, name, actor, { ids, body, query: {} }, NOW) as Outcome;
}
function must(s: SocialState, actor: string, name: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown> = {}, ids: string[] = []) {
  const r = op(s, actor, name, body, ids);
  if (!r.ok) throw new Error(`${name} by ${actor} refused: ${r.error.message}`);
  return r.value;
}
const refusal = (r: Outcome) => (r.ok ? 'ACCEPTED' : `${r.error.code}: ${r.error.message}`);
const view = (s: SocialState, viewer: string) => buildSocialView(s, viewer, NOW, { developmentPreview: false });
const roster = (s: SocialState, viewer: string, partyId: string) =>
  view(s, viewer).visibleParties.find((p) => p.partyId === partyId)?.members.map((m) => m.userId).sort();
/** The id as a JSON string value, so `pty_3` never matches inside `pty_31`. */
const mentions = (value: unknown, id: string) => JSON.stringify(value).includes(JSON.stringify(id));

function befriend(s: SocialState, a: string, b: string): SocialState {
  const sent = must(s, a, 'requests.send', { toUserId: b }).state;
  const request = sent.requests.find((r) => r.fromUserId === a && r.toUserId === b && r.status === 'PENDING')!;
  return must(sent, b, 'requests.accept', {}, [request.requestId]).state;
}

/** Wren: a new player, connected, with the presence audience given (default EVERYONE). A stranger to Kai. */
function withWren(s: SocialState, presenceVisibility: 'EVERYONE' | 'FRIENDS' = 'EVERYONE'): SocialState {
  let next = ensureSocialUser(s, { userId: WREN, displayName: 'Wren', handle: '@wren' }, NOW);
  next = must(next, WREN, 'presence.update_self', { connected: true }).state;
  return must(next, WREN, 'privacy.update_self', { presenceVisibility }).state;
}

/** The fixture's Arena Run (Orion leads, Lyra) with Wren in it too, invited by her friend Orion. */
function arenaWithWren(presenceVisibility: 'EVERYONE' | 'FRIENDS'): { s: SocialState; arena: string } {
  let s = befriend(withWren(createSocialFixture(), presenceVisibility), U.ORION, WREN);
  const arena = partyOf(s, U.ORION)!.partyId;
  const invited = must(s, U.ORION, 'parties.invite', { toUserId: WREN }, [arena]);
  s = must(invited.state, WREN, 'party_invites.accept', {}, [(invited.data as { inviteId: string }).inviteId]).state;
  return { s, arena };
}

describe('WL-351-02 (b): an Appear-Offline leader\'s open party is in no outsider\'s snapshot', () => {
  it('the reviewer\'s repro: Nova, hidden, starts "Quiet"; her friends\' snapshots, reads and joins know nothing of it', () => {
    let s = createSocialFixture();
    s = must(s, U.NOVA, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }).state;
    s = must(s, U.NOVA, 'parties.create', { name: 'Quiet', privacy: 'OPEN_TO_FRIENDS' }).state;
    const quiet = partyOf(s, U.NOVA)!.partyId;
    for (const friend of [U.KAI, U.RHEA]) {
      const snapshot = view(s, friend);
      expect(snapshot.visibleParties.map((p) => p.name), friend).not.toContain('Quiet');
      expect(mentions(snapshot, quiet), `${friend}'s snapshot names the party`).toBe(false);
      expect(refusal(op(s, friend, 'parties.read', {}, [quiet])), friend).toBe(refusal(op(s, friend, 'parties.read', {}, ['pty_does_not_exist'])));
    }
    // nobody joins what they cannot see; the refusal is a missing party's (Kai is in no party, so the id is reached)
    expect(refusal(op(s, U.KAI, 'parties.join', {}, [quiet]))).toBe(refusal(op(s, U.KAI, 'parties.join', {}, ['pty_does_not_exist'])));
    // Nova herself still has her party
    expect(view(s, U.NOVA).party?.name).toBe('Quiet');
  });

  it('control: the same party started while AVAILABLE is listed to a friend, led by Nova, and the friend may join it', () => {
    const s = must(createSocialFixture(), U.NOVA, 'parties.create', { name: 'Loud', privacy: 'OPEN_TO_FRIENDS' }).state;
    const loud = partyOf(s, U.NOVA)!.partyId;
    const listed = view(s, U.KAI).visibleParties.find((p) => p.partyId === loud);
    expect(listed?.name).toBe('Loud');
    expect(listed?.leaderId).toBe(U.NOVA);
    expect(listed?.members.map((m) => m.userId)).toEqual([U.NOVA]);
    expect(op(s, U.KAI, 'parties.read', {}, [loud]).ok).toBe(true);
    expect(op(s, U.KAI, 'parties.join', {}, [loud]).ok).toBe(true);
  });

  it('a friend inside the party shows no party while the leader is hidden: presence, profile, read and join agree', () => {
    const fixture = createSocialFixture();
    const arena = partyOf(fixture, U.ORION)!.partyId;
    // control first: Orion visible, Lyra (Kai's friend, BUSY) shows the open party and offers the join
    expect(resolvePresenceFor(fixture, U.KAI, U.LYRA)?.partyId).toBe(arena);
    expect(resolvePresenceFor(fixture, U.KAI, U.LYRA)?.can.joinParty).toBe(true);
    expect(view(fixture, U.KAI).profiles[U.LYRA]?.partyStatus).toEqual({ inParty: true, memberCount: 2, joinable: true });

    const s = must(fixture, U.ORION, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }).state;
    const lyra = resolvePresenceFor(s, U.KAI, U.LYRA)!;
    expect(lyra.onlineState).toBe('BUSY'); // Lyra herself is still seen
    expect(lyra.partyId).toBeNull();
    expect(lyra.can.joinParty).toBe(false);
    const kai = view(s, U.KAI);
    expect(kai.profiles[U.LYRA]?.partyStatus).toEqual({ inParty: false, memberCount: null, joinable: false });
    expect(kai.visibleParties.map((p) => p.partyId)).not.toContain(arena);
    expect(mentions(kai, arena)).toBe(false);
    expect(partyViewFor(s, U.KAI, arena)).toBeNull();
    expect(refusal(op(s, U.KAI, 'parties.join', {}, [arena]))).toBe(refusal(op(s, U.KAI, 'parties.join', {}, ['pty_does_not_exist'])));
    // a MEMBER still sees the hidden leader: they share the party
    expect(view(s, U.LYRA).party?.leaderId).toBe(U.ORION);
    expect(view(s, U.LYRA).party?.members.map((m) => m.userId).sort()).toEqual([U.LYRA, U.ORION].sort());
  });

  it('Appear Offline reads exactly as a sign-out: an outsider\'s whole snapshot is byte-identical either way (leader, then member)', () => {
    const base = must(createSocialFixture(), U.NOVA, 'parties.create', { name: 'Quiet', privacy: 'OPEN_TO_FRIENDS' }).state;
    expect(view(base, U.KAI).visibleParties.map((p) => p.name)).toContain('Quiet'); // control: online, it is listed
    const cases: Array<[string, SocialState]> = [[U.NOVA, base], [U.LYRA, createSocialFixture()]];
    for (const [who, before] of cases) {
      const hidden = must(before, who, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }).state;
      const signedOut = must(before, who, 'presence.update_self', { connected: false }).state;
      for (const viewer of [U.KAI, U.RHEA]) {
        expect(JSON.stringify(view(hidden, viewer)), `${viewer} watching ${who}`).toBe(JSON.stringify(view(signedOut, viewer)));
      }
    }
  });
});

describe('WL-351-02 (a): a member hidden from a viewer is in none of that viewer\'s rosters, counts or profiles', () => {
  // WL-358-01 (founder, 10-13) went further than WL-351-02 here: the party holding Wren is not shown to Kai at all (it was shown
  // with Orion and Lyra only, and Kai could open-join it and then see her), so nothing of it -- roster, count or card -- reaches him.
  it('Wren (presence FRIENDS) joins Arena Run: Kai, a stranger to her, sees no party at all -- no id, no count, no card', () => {
    const { s, arena } = arenaWithWren('FRIENDS');
    const kai = view(s, U.KAI);
    expect(roster(s, U.KAI, arena)).toBeUndefined();
    expect(mentions(kai, WREN)).toBe(false);
    expect(JSON.stringify(kai)).not.toContain('Wren');
    expect(kai.profiles[U.ORION]?.partyStatus).toEqual({ inParty: false, memberCount: null, joinable: false });
    expect(kai.profiles[U.LYRA]?.partyStatus).toEqual({ inParty: false, memberCount: null, joinable: false });
  });

  it('control: visible to everyone, Wren is in Kai\'s roster and count', () => {
    const { s, arena } = arenaWithWren('EVERYONE');
    expect(roster(s, U.KAI, arena)).toEqual([U.LYRA, U.ORION, WREN].sort());
    expect(view(s, U.KAI).profiles[U.ORION]?.partyStatus.memberCount).toBe(3);
    expect(view(s, U.KAI).profiles[WREN]).toBeDefined();
  });

  it('a FRIEND of Wren outside the party sees her by her rules; a MEMBER sees everybody, as before', () => {
    const { s, arena } = arenaWithWren('FRIENDS');
    const withNova = befriend(s, U.NOVA, WREN); // Nova: Wren's friend, a stranger to Orion and Lyra
    expect(roster(withNova, U.NOVA, arena)).toEqual([U.LYRA, U.ORION, WREN].sort());
    expect(view(s, U.LYRA).party?.members.map((m) => m.userId).sort()).toEqual([U.LYRA, U.ORION, WREN].sort());
  });

  it('an Appear-Offline member takes the party out of an outsider\'s view (WL-358-01), roster and count with it; a member still sees them', () => {
    const fixture = createSocialFixture();
    const arena = partyOf(fixture, U.ORION)!.partyId;
    expect(roster(fixture, U.KAI, arena)).toEqual([U.LYRA, U.ORION].sort()); // control
    const s = must(fixture, U.LYRA, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }).state;
    expect(roster(s, U.KAI, arena)).toBeUndefined();
    expect(view(s, U.KAI).profiles[U.ORION]?.partyStatus).toEqual({ inParty: false, memberCount: null, joinable: false });
    expect(refusal(op(s, U.KAI, 'parties.join', {}, [arena]))).toBe(refusal(op(s, U.KAI, 'parties.join', {}, ['pty_does_not_exist'])));
    expect(view(s, U.ORION).party?.members.map((m) => m.userId).sort()).toEqual([U.LYRA, U.ORION].sort());
  });

  it('a party shown only because of a friend who is hidden inside it is not shown at all', () => {
    // Wren (visible to everyone, a stranger to Kai) leads an open party; Nova (Kai's friend) joins it
    let s = befriend(withWren(createSocialFixture()), WREN, U.NOVA);
    s = must(s, WREN, 'parties.create', { name: 'Wren Crew', privacy: 'OPEN_TO_FRIENDS' }).state;
    const crew = partyOf(s, WREN)!.partyId;
    s = must(s, U.NOVA, 'parties.join', {}, [crew]).state;
    expect(roster(s, U.KAI, crew)).toEqual([U.NOVA, WREN].sort()); // control: through Nova, Kai sees it
    const hidden = must(s, U.NOVA, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }).state;
    expect(view(hidden, U.KAI).visibleParties.map((p) => p.partyId)).not.toContain(crew);
    expect(mentions(view(hidden, U.KAI), crew)).toBe(false);
  });
});

describe('WL-351-02: blocks keep their party rules, and the snapshot holds nothing across them', () => {
  it('Kai joins Arena Run; a block either way with the leader puts him out (the leader removes / the blocker leaves) and the party is gone from his view', () => {
    for (const [blocker, blocked] of [[U.ORION, U.KAI], [U.KAI, U.ORION]]) {
      let s = createSocialFixture();
      const arena = partyOf(s, U.ORION)!.partyId;
      s = must(s, U.KAI, 'parties.join', {}, [arena]).state;
      s = must(s, blocker, 'blocks.add', { targetId: blocked, confirmSharedParty: true }).state;
      expect(partyOf(s, U.KAI), `${blocker} blocks ${blocked}`).toBeUndefined();
      expect(partyById(s, arena)?.leaderId).toBe(U.ORION);
      const kai = view(s, U.KAI);
      expect(kai.party).toBeNull();
      expect(kai.visibleParties.map((p) => p.partyId)).not.toContain(arena);
      expect(mentions(kai.visibleParties, arena)).toBe(false);
      expect(mentions(view(s, U.ORION).party, U.KAI)).toBe(false);
      // the third member keeps the leader
      expect(view(s, U.LYRA).party?.members.map((m) => m.userId).sort()).toEqual([U.LYRA, U.ORION].sort());
    }
  });

  it('an outsider walled from any member, either way, sees no party; without the block, it does', () => {
    const fixture = createSocialFixture();
    const arena = partyOf(fixture, U.ORION)!.partyId;
    expect(roster(fixture, U.KAI, arena)).toEqual([U.LYRA, U.ORION].sort()); // control
    for (const [blocker, blocked] of [[U.KAI, U.LYRA], [U.LYRA, U.KAI]]) {
      const s = must(fixture, blocker, 'blocks.add', { targetId: blocked }).state;
      expect(view(s, U.KAI).visibleParties.map((p) => p.partyId), `${blocker} blocks ${blocked}`).not.toContain(arena);
      expect(view(s, U.KAI).profiles[U.ORION]?.partyStatus).toEqual({ inParty: false, memberCount: null, joinable: false });
    }
  });
});

describe('WL-351-02 r2 (MAIN\'s ruling, 10-13): a FULL party is not shown to an outsider at all', () => {
  /**
   * Arena Run (Orion leads, Lyra) plus `hidden` players, each Orion's friend and a stranger to Kai, with the presence audience given:
   * FRIENDS (the default here) hides them from Kai, EVERYONE shows them to him.
   */
  function arenaWithHidden(hidden: number, presenceVisibility: 'FRIENDS' | 'EVERYONE' = 'FRIENDS'): { s: SocialState; arena: string; ids: string[] } {
    let s = createSocialFixture();
    const arena = partyOf(s, U.ORION)!.partyId;
    const ids: string[] = [];
    for (let i = 1; i <= hidden; i += 1) {
      const id = `usr_hidden${i}`;
      s = ensureSocialUser(s, { userId: id, displayName: `Hidden${i}`, handle: `@hidden${i}` }, NOW);
      s = must(s, id, 'presence.update_self', { connected: true }).state;
      s = must(s, id, 'privacy.update_self', { presenceVisibility }).state;
      s = befriend(s, U.ORION, id);
      const invited = must(s, U.ORION, 'parties.invite', { toUserId: id }, [arena]);
      s = must(invited.state, id, 'party_invites.accept', {}, [(invited.data as { inviteId: string }).inviteId]).state;
      ids.push(id);
    }
    return { s, arena, ids };
  }

  it('full only through members hidden from Kai: absent from his snapshot, presence, profile, read and join; whole for every member', () => {
    const { s, arena, ids } = arenaWithHidden(PARTY_MAX_MEMBERS - 2);
    expect(partyById(s, arena)?.members.length).toBe(PARTY_MAX_MEMBERS);
    const kai = view(s, U.KAI);
    expect(kai.visibleParties.map((p) => p.partyId)).not.toContain(arena);
    expect(mentions(kai, arena)).toBe(false);
    for (const id of ids) expect(mentions(kai, id), id).toBe(false);
    expect(resolvePresenceFor(s, U.KAI, U.LYRA)?.partyId).toBeNull();
    expect(kai.profiles[U.ORION]?.partyStatus).toEqual({ inParty: false, memberCount: null, joinable: false });
    expect(refusal(op(s, U.KAI, 'parties.read', {}, [arena]))).toBe(refusal(op(s, U.KAI, 'parties.read', {}, ['pty_does_not_exist'])));
    expect(refusal(op(s, U.KAI, 'parties.join', {}, [arena]))).toBe(refusal(op(s, U.KAI, 'parties.join', {}, ['pty_does_not_exist'])));
    for (const member of [U.ORION, U.LYRA, ...ids]) {
      expect(view(s, member).party?.members.length, member).toBe(PARTY_MAX_MEMBERS);
    }
  });

  it('full with every member seen by Kai: still absent from his snapshot, profile, read and join (r2 holds on its own)', () => {
    const { s, arena } = arenaWithHidden(PARTY_MAX_MEMBERS - 2, 'EVERYONE');
    expect(partyById(s, arena)?.members.length).toBe(PARTY_MAX_MEMBERS);
    expect(view(s, U.KAI).visibleParties.map((p) => p.partyId)).not.toContain(arena);
    expect(view(s, U.KAI).profiles[U.ORION]?.partyStatus).toEqual({ inParty: false, memberCount: null, joinable: false });
    expect(refusal(op(s, U.KAI, 'parties.read', {}, [arena]))).toBe(refusal(op(s, U.KAI, 'parties.read', {}, ['pty_does_not_exist'])));
    expect(refusal(op(s, U.KAI, 'parties.join', {}, [arena]))).toBe(refusal(op(s, U.KAI, 'parties.join', {}, ['pty_does_not_exist'])));
  });

  it('control: one fewer (room left), every member seen by Kai: he sees the party whole, count 7, joinable', () => {
    const { s, arena, ids } = arenaWithHidden(PARTY_MAX_MEMBERS - 3, 'EVERYONE');
    expect(partyById(s, arena)?.members.length).toBe(PARTY_MAX_MEMBERS - 1);
    expect(roster(s, U.KAI, arena)).toEqual([U.LYRA, U.ORION, ...ids].sort());
    expect(view(s, U.KAI).profiles[U.ORION]?.partyStatus).toEqual({ inParty: true, memberCount: PARTY_MAX_MEMBERS - 1, joinable: true });
    expect(op(s, U.KAI, 'parties.join', {}, [arena]).ok).toBe(true);
  });

  it('room left but members hidden from Kai: absent too (WL-358-01), where WL-351-02 alone showed him Orion and Lyra, count 2, joinable', () => {
    const { s, arena, ids } = arenaWithHidden(PARTY_MAX_MEMBERS - 3);
    expect(partyById(s, arena)?.members.length).toBe(PARTY_MAX_MEMBERS - 1);
    expect(roster(s, U.KAI, arena)).toBeUndefined();
    for (const id of ids) expect(mentions(view(s, U.KAI), id), id).toBe(false);
    expect(mentions(view(s, U.KAI), arena)).toBe(false);
    expect(view(s, U.KAI).profiles[U.ORION]?.partyStatus).toEqual({ inParty: false, memberCount: null, joinable: false });
    expect(refusal(op(s, U.KAI, 'parties.join', {}, [arena]))).toBe(refusal(op(s, U.KAI, 'parties.join', {}, ['pty_does_not_exist'])));
  });
});

describe('seenOnlineBy is the presence authority\'s own "online"', () => {
  it('for every viewer and subject, in states with Appear Offline, a FRIENDS audience, a sign-out and a block, it equals resolvePresenceFor', () => {
    const base = createSocialFixture();
    const states: SocialState[] = [
      base,
      must(base, U.NOVA, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }).state,
      must(base, U.ORION, 'privacy.update_self', { presenceVisibility: 'FRIENDS' }).state,
      must(base, U.LYRA, 'privacy.update_self', { presenceVisibility: 'PARTY' }).state,
      must(base, U.LYRA, 'presence.update_self', { connected: false }).state,
      must(base, U.KAI, 'blocks.add', { targetId: U.ORION }).state,
    ];
    let compared = 0;
    for (const s of states) {
      for (const viewer of Object.keys(s.users)) {
        for (const subject of Object.keys(s.users)) {
          expect(seenOnlineBy(s, viewer, subject), `${viewer} -> ${subject}`).toBe(resolvePresenceFor(s, viewer, subject)!.onlineState !== 'OFFLINE');
          compared += 1;
        }
      }
    }
    expect(compared).toBe(states.length * 81);
  });
});

/*
 * WL-358-01 = "Block open-join" (FOUNDER RULING, 2026-10-13T15:52:09Z, R16 acceptance checklist APPENDIX 5): a viewer may NOT
 * open-join an OPEN_TO_FRIENDS party that contains a member hidden from that viewer, the same way a party holding a blocked member
 * is invisible to them. Invites still work. The refusal is the uniform missing party's, and every outsider surface agrees with it
 * (a party they cannot join is not shown to them as there): the snapshot, parties.read, a friend's presence partyId and
 * can.joinParty, the profile partyStatus, a Recent Players label. Each red case has its control (the same join, nobody hidden).
 */
describe('WL-358-01 (founder, 10-13): no open-join into a party holding a member hidden from the joiner', () => {
  const MISSING_PARTY = 'not-found: party not found';

  it('Wren, hidden from Kai (presence FRIENDS, a stranger to him), is in Arena Run: his join and read are a missing party\'s, and no surface shows the party', () => {
    const { s, arena } = arenaWithWren('FRIENDS');
    expect(refusal(op(s, U.KAI, 'parties.join', {}, ['pty_does_not_exist']))).toBe(MISSING_PARTY);
    expect(refusal(op(s, U.KAI, 'parties.join', {}, [arena]))).toBe(MISSING_PARTY);
    expect(refusal(op(s, U.KAI, 'parties.read', {}, [arena]))).toBe(refusal(op(s, U.KAI, 'parties.read', {}, ['pty_does_not_exist'])));
    expect(partyViewFor(s, U.KAI, arena)).toBeNull();
    const kai = view(s, U.KAI);
    expect(kai.visibleParties.map((p) => p.partyId)).not.toContain(arena);
    expect(mentions(kai, arena)).toBe(false);
    expect(mentions(kai, WREN)).toBe(false);
    for (const friend of [U.ORION, U.LYRA]) {
      const presence = resolvePresenceFor(s, U.KAI, friend)!;
      expect(presence.onlineState, friend).not.toBe('OFFLINE'); // the friend is still seen: only the party is not
      expect(presence.partyId, friend).toBeNull();
      expect(presence.can.joinParty, friend).toBe(false);
      expect(kai.profiles[friend]?.partyStatus, friend).toEqual({ inParty: false, memberCount: null, joinable: false });
    }
  });

  it('control: Wren visible to everyone, the same party is listed whole to Kai on every surface, and the same join succeeds', () => {
    const { s, arena } = arenaWithWren('EVERYONE');
    expect(roster(s, U.KAI, arena)).toEqual([U.LYRA, U.ORION, WREN].sort());
    expect(op(s, U.KAI, 'parties.read', {}, [arena]).ok).toBe(true);
    for (const friend of [U.ORION, U.LYRA]) {
      expect(resolvePresenceFor(s, U.KAI, friend)?.partyId, friend).toBe(arena);
      expect(resolvePresenceFor(s, U.KAI, friend)?.can.joinParty, friend).toBe(true);
      expect(view(s, U.KAI).profiles[friend]?.partyStatus, friend).toEqual({ inParty: true, memberCount: 3, joinable: true });
    }
    const joined = must(s, U.KAI, 'parties.join', {}, [arena]).state;
    expect(partyOf(joined, U.KAI)?.partyId).toBe(arena);
  });

  it('a member who appears offline closes the open-join exactly as one who signs out: the same refusal, a byte-identical outsider snapshot', () => {
    const { s: everyone, arena } = arenaWithWren('EVERYONE');
    expect(op(everyone, U.KAI, 'parties.join', {}, [arena]).ok).toBe(true); // control: Wren seen online, Kai may join
    const hidden = must(everyone, WREN, 'presence.update_self', { availability: 'APPEAR_OFFLINE' }).state;
    const signedOut = must(everyone, WREN, 'presence.update_self', { connected: false }).state;
    for (const s of [hidden, signedOut]) {
      expect(refusal(op(s, U.KAI, 'parties.join', {}, [arena]))).toBe(MISSING_PARTY);
      expect(view(s, U.KAI).visibleParties.map((p) => p.partyId)).not.toContain(arena);
    }
    for (const viewer of [U.KAI, U.RHEA, U.NOVA]) {
      expect(JSON.stringify(view(hidden, viewer)), viewer).toBe(JSON.stringify(view(signedOut, viewer)));
    }
  });

  it('invites still work: Orion invites Kai into the party Wren is hidden in; Kai accepts and, a member now, sees it whole', () => {
    const { s, arena } = arenaWithWren('FRIENDS');
    expect(refusal(op(s, U.KAI, 'parties.join', {}, [arena]))).toBe(MISSING_PARTY);
    const invited = must(s, U.ORION, 'parties.invite', { toUserId: U.KAI }, [arena]);
    const inviteId = (invited.data as { inviteId: string }).inviteId;
    const joined = must(invited.state, U.KAI, 'party_invites.accept', {}, [inviteId]).state;
    expect(partyOf(joined, U.KAI)?.partyId).toBe(arena);
    expect(view(joined, U.KAI).party?.members.map((m) => m.userId).sort()).toEqual([U.KAI, U.LYRA, U.ORION, WREN].sort());
  });

  it('a Recent Players label names the party only while Kai may join it: Wren hidden -> the neutral "Party"; visible -> its name', () => {
    for (const [audience, label] of [['FRIENDS', 'Party'], ['EVERYONE', 'Arena Run']] as const) {
      let s = createSocialFixture();
      const arena = partyOf(s, U.ORION)!.partyId;
      s = must(s, U.KAI, 'parties.join', {}, [arena]).state; // Kai meets Orion and Lyra in the arena, then leaves
      s = must(s, U.KAI, 'parties.leave', {}, [arena]).state;
      s = befriend(withWren(s, audience), U.ORION, WREN);
      const invited = must(s, U.ORION, 'parties.invite', { toUserId: WREN }, [arena]);
      s = must(invited.state, WREN, 'party_invites.accept', {}, [(invited.data as { inviteId: string }).inviteId]).state;
      const labels = recentPlayersViewFor(s, U.KAI).filter((e) => e.userId === U.ORION || e.userId === U.LYRA).map((e) => e.contextLabel);
      expect(labels, audience).toEqual([label, label]);
    }
  });
});

/*
 * WL-358-02 = "Generic message" (FOUNDER RULING, same record): accepting an invite to a party that has filled answers the generic
 * "You can't join this party right now" -- no count implied -- in the shape of every other generic party refusal (not-found, the
 * HTTP 404 of a missing party or a missing invite). The invite stays pending: "right now", so it is accepted once there is room.
 */
describe('WL-358-02 (founder, 10-13): accepting an invite to a party that has filled answers a generic refusal, no count implied', () => {
  const GENERIC = "You can't join this party right now";

  /** Orion invites Kai into Arena Run (Orion, Lyra) while it has room; then `more` of Orion's friends join it by invite. */
  function invitedThenFilled(more: number): { s: SocialState; arena: string; inviteId: string } {
    let s = createSocialFixture();
    const arena = partyOf(s, U.ORION)!.partyId;
    const invited = must(s, U.ORION, 'parties.invite', { toUserId: U.KAI }, [arena]);
    const inviteId = (invited.data as { inviteId: string }).inviteId;
    s = invited.state;
    for (let i = 1; i <= more; i += 1) {
      const id = `usr_filler${i}`;
      s = ensureSocialUser(s, { userId: id, displayName: `Filler${i}`, handle: `@filler${i}` }, NOW);
      s = must(s, id, 'presence.update_self', { connected: true }).state;
      s = befriend(s, U.ORION, id);
      const next = must(s, U.ORION, 'parties.invite', { toUserId: id }, [arena]);
      s = must(next.state, id, 'party_invites.accept', {}, [(next.data as { inviteId: string }).inviteId]).state;
    }
    return { s, arena, inviteId };
  }

  it('full: Kai is told exactly the generic words as a not-found, nothing names a count, he joins nothing and the invite stays pending', () => {
    const { s, arena, inviteId } = invitedThenFilled(PARTY_MAX_MEMBERS - 2);
    expect(partyById(s, arena)?.members.length).toBe(PARTY_MAX_MEMBERS);
    const answer = op(s, U.KAI, 'party_invites.accept', {}, [inviteId]);
    expect(refusal(answer)).toBe(`not-found: ${GENERIC}`);
    expect(refusal(answer)).not.toMatch(/\d|full|member|count|capacity/i);
    // the same code as the generic refusals around it: a missing invite, a missing party
    expect(refusal(op(s, U.KAI, 'party_invites.accept', {}, ['pinv_does_not_exist']))).toMatch(/^not-found: /);
    expect(refusal(op(s, U.KAI, 'parties.join', {}, [arena]))).toBe('not-found: party not found');
    expect(partyOf(s, U.KAI)).toBeUndefined();
    expect(partyInvitesFor(s, U.KAI, NOW).map((i) => i.inviteId)).toContain(inviteId);
  });

  it('control: one fewer (room left), the same invite is accepted', () => {
    const { s, arena, inviteId } = invitedThenFilled(PARTY_MAX_MEMBERS - 3);
    expect(partyById(s, arena)?.members.length).toBe(PARTY_MAX_MEMBERS - 1);
    const joined = must(s, U.KAI, 'party_invites.accept', {}, [inviteId]).state;
    expect(partyOf(joined, U.KAI)?.partyId).toBe(arena);
  });

  it('"right now": once a member leaves the full party, the same pending invite is accepted', () => {
    const { s, arena, inviteId } = invitedThenFilled(PARTY_MAX_MEMBERS - 2);
    expect(op(s, U.KAI, 'party_invites.accept', {}, [inviteId]).ok).toBe(false);
    const roomAgain = must(s, 'usr_filler1', 'parties.leave', {}, [arena]).state;
    const joined = must(roomAgain, U.KAI, 'party_invites.accept', {}, [inviteId]).state;
    expect(partyOf(joined, U.KAI)?.partyId).toBe(arena);
  });
});
