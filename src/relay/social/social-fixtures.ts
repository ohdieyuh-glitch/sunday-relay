/**
 * WONDERLAND SOCIAL — synthetic users with deliberately conflicting states.
 *
 * FOR QA AND THE DEVELOPMENT PREVIEW ONLY. Every surface that shows these says DEVELOPMENT PREVIEW, as the Project Brain's
 * sample data does; none of this is a person. The cast is chosen so that every privacy and relationship rule has somebody
 * to bite on: a friend whose private server must stay hidden, a stranger whose activity must stay hidden, somebody who has
 * blocked the viewer, somebody appearing offline, an open party, a pending request, an unread conversation.
 *
 * Deterministic: built by the same pure commands the live system uses, from a fixed clock.
 */

import { defaultPrivacySettings, PENDING_PROGRESSION, type SocialPrivacySettings, type UserPresence, type UserProfile } from './social-contracts';
import { emptySocialState, type SocialState } from './social-state';
import { blockUser, sendFriendRequest, acceptFriendRequest } from './social-friends';
import { createParty, inviteToParty, acceptPartyInvite, setPartyRules } from './social-parties';
import { openDirectConversation, sendMessage } from './social-conversations';
import type { RelayResult } from '../protocol/errors';

export const FIXTURE_NOW = '2026-10-01T20:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(FIXTURE_NOW) + minutes * 60_000).toISOString();

export const FIXTURE_USERS = {
  KAI: 'usr_kai',
  NOVA: 'usr_nova',
  RHEA: 'usr_rhea',
  ORION: 'usr_orion',
  VEGA: 'usr_vega',
  MIRA: 'usr_mira',
  JUNO: 'usr_juno',
  SOL: 'usr_sol',
  LYRA: 'usr_lyra',
} as const;

const U = FIXTURE_USERS;

function profile(userId: string, displayName: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId,
    displayName,
    handle: `@${displayName.toLowerCase()}`,
    avatarRef: `generated:${userId}`,
    nationId: null,
    clanName: null,
    progression: PENDING_PROGRESSION,
    primaryAgent: {
      agentId: `agt_${userId}_julius`,
      ownerId: userId,
      kind: 'JULIUS',
      displayName: 'Julius',
      systemLabel: 'Julius 3.3 · Compound AI Agent',
      emblemId: 'julius-rings',
      ratings: [],
    },
    relayDog: { skinId: 'relay_og', primary: null, secondary: null, flame: null, appearanceTier: null },
    activeCompanion: {
      companionId: `cmp_${userId}_llm`,
      ownerId: userId,
      kind: 'LLM_COMPANION',
      displayName: 'LLM Companion',
      primary: null,
      secondary: null,
    },
    showcaseAgents: [],
    showcaseCompanions: [],
    stats: [],
    memberSinceIso: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function presence(userId: string, overrides: Partial<UserPresence> = {}): UserPresence {
  return {
    userId,
    connected: true,
    availability: 'AVAILABLE',
    activity: 'EXPLORING',
    activityDetail: null,
    location: { serverId: 'srv_golden_arrival', serverKind: 'PUBLIC_WORLD', serverName: 'Golden Arrival', placeLabel: 'Tower Lane', nationId: null },
    partyId: null,
    lastSeenAtIso: FIXTURE_NOW,
    updatedAtIso: FIXTURE_NOW,
    ...overrides,
  };
}

const privacy = (userId: string, overrides: Partial<SocialPrivacySettings> = {}): SocialPrivacySettings => ({ ...defaultPrivacySettings(userId), ...overrides });

function must<T>(result: RelayResult<T>): T {
  if (!result.ok) throw new Error(`fixture step failed: ${result.error.message}`);
  return result.value;
}

/** The cast, seen from KAI. */
export function createSocialFixture(): SocialState {
  let s = emptySocialState();
  const add = (p: UserProfile, pr: UserPresence, pv: SocialPrivacySettings) => {
    s = { ...s, users: { ...s.users, [p.userId]: { profile: p, presence: pr, privacy: pv } } };
  };
  add(
    profile(U.KAI, 'Kai', {
      nationId: 'TARTARUS',
      relayDog: { skinId: 'jack_flame', primary: null, secondary: '#2A6BFF', flame: null, appearanceTier: null },
      showcaseAgents: [
        { agentId: 'agt_kai_forge', ownerId: U.KAI, kind: 'IMPORTED', displayName: 'Forge', systemLabel: 'Imported agentic system', emblemId: 'imported-generic', ratings: [{ mode: 'GOAL', rating: 1612, deviation: 140, battleCount: 4, provisional: true }] },
      ],
      showcaseCompanions: [{ companionId: 'cmp_kai_jhinn', ownerId: U.KAI, kind: 'JHINN_AGENT', displayName: 'Jhinn', primary: null, secondary: '#5CDBFF' }],
    }),
    presence(U.KAI, { activity: 'WORKING_WITH_JULIUS' }),
    privacy(U.KAI),
  );
  add(profile(U.NOVA, 'Nova', { relayDog: { skinId: 'celestial_light', primary: null, secondary: null, flame: null, appearanceTier: 'heart' } }), presence(U.NOVA, { activity: 'CREATING_SOFTWARE', activityDetail: 'Weather dashboard' }), privacy(U.NOVA));
  add(
    profile(U.RHEA, 'Rhea', { relayDog: { skinId: 'baal', primary: null, secondary: null, flame: '#7FD4FF', appearanceTier: null } }),
    presence(U.RHEA, { activity: 'IN_PRIVATE_SERVER', location: { serverId: 'srv_rhea_lab', serverKind: 'PRIVATE_SERVER', serverName: "Rhea's Lab", placeLabel: null, nationId: 'ICARUS' } }),
    privacy(U.RHEA, { privateServerVisibility: 'NOBODY' }),
  );
  add(
    profile(U.ORION, 'Orion', { relayDog: { skinId: 'skeleton_flame', primary: null, secondary: null, flame: null, appearanceTier: null } }),
    presence(U.ORION, { activity: 'IN_GVE', activityDetail: 'Tower Lane arena', location: { serverId: 'srv_gve_7', serverKind: 'GVE_ARENA', serverName: 'GVE Arena 7', placeLabel: null, nationId: null } }),
    privacy(U.ORION, { activityVisibility: 'EVERYONE', locationVisibility: 'EVERYONE' }),
  );
  add(profile(U.VEGA, 'Vega'), presence(U.VEGA, { activity: 'DEVELOPING_GAME' }), privacy(U.VEGA));
  add(profile(U.MIRA, 'Mira'), presence(U.MIRA, { activity: 'RUNNING_MISSION' }), privacy(U.MIRA, { activityVisibility: 'EVERYONE', locationVisibility: 'EVERYONE' }));
  add(profile(U.JUNO, 'Juno'), presence(U.JUNO, { connected: false, location: null, lastSeenAtIso: at(-180) }), privacy(U.JUNO));
  add(profile(U.SOL, 'Sol'), presence(U.SOL, { availability: 'APPEAR_OFFLINE', activity: 'EXPLORING' }), privacy(U.SOL));
  add(profile(U.LYRA, 'Lyra'), presence(U.LYRA, { availability: 'BUSY', activity: 'CREATING_CONTENT' }), privacy(U.LYRA));

  // Friendships of KAI: Nova, Rhea, Orion, Juno, Sol, Lyra. And Orion–Lyra, Nova–Rhea (mutual friends).
  const befriend = (a: string, b: string, minute: number) => {
    s = must(sendFriendRequest(s, a, b, at(minute)));
    const req = s.requests.find((r) => r.fromUserId === a && r.toUserId === b && r.status === 'PENDING');
    if (req) s = must(acceptFriendRequest(s, b, req.requestId, at(minute)));
  };
  [U.NOVA, U.RHEA, U.ORION, U.JUNO, U.SOL, U.LYRA].forEach((u, i) => befriend(U.KAI, u, -600 + i));
  befriend(U.ORION, U.LYRA, -500);
  befriend(U.NOVA, U.RHEA, -499);
  befriend(U.MIRA, U.KAI, -498);

  // A stranger's pending request to KAI.
  s = must(sendFriendRequest(s, U.VEGA, U.KAI, at(-30)));
  // MIRA, once a friend, has blocked KAI.
  s = must(blockUser(s, U.MIRA, U.KAI, at(-20)));

  // ORION leads an open party with LYRA.
  const party = must(createParty(s, U.ORION, { name: 'Arena Run' }, at(-60)));
  s = must(setPartyRules(party.state, U.ORION, party.partyId, { privacy: 'OPEN_TO_FRIENDS' }));
  const invite = must(inviteToParty(s, U.ORION, party.partyId, U.LYRA, at(-59)));
  s = must(acceptPartyInvite(invite.state, U.LYRA, invite.inviteId, at(-58)));

  // RHEA's invite-only party has invited KAI (pending): the Parties tab's inbox has something in it.
  const lab = must(createParty(s, U.RHEA, { name: 'Lab Crew' }, at(-40)));
  s = must(inviteToParty(lab.state, U.RHEA, lab.partyId, U.KAI, at(-5))).state;

  // KAI and NOVA have been talking; two of Nova's messages are unread.
  const dm = must(openDirectConversation(s, U.KAI, U.NOVA, at(-15)));
  s = must(sendMessage(dm.state, U.KAI, dm.conversationId, { body: 'Want to see the weather dashboard run?' }, at(-15)));
  s = must(sendMessage(s, U.NOVA, dm.conversationId, { body: 'Yes! Pushing the build now.' }, at(-10)));
  s = must(sendMessage(s, U.NOVA, dm.conversationId, { body: 'Running in Golden Arrival.' }, at(-9)));
  return s;
}
