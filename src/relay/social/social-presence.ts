/**
 * WONDERLAND SOCIAL — THE ONE PRESENCE AUTHORITY.
 *
 * FOUNDER: "Create ONE canonical presence model. Do not have Friends, Messages, Profile and Party independently invent
 * activity strings. All social UI should consume the same presence authority." And: "Privacy and permissions must control
 * location/activity exposure … A blocked player must not continue receiving privileged presence/location information."
 *
 * So there are exactly two entry points:
 *   - `deriveActivity`     Wonderland's own signals (a mission running, a GVE battle, Julius at work, a private server)
 *                          become ONE activity, by ONE precedence order;
 *   - `resolvePresenceFor` one person's presence as ONE viewer may see it, every hidden field substituted here and nowhere
 *                          else, and the actions that viewer may take computed once.
 * Every social surface renders a `UserPresenceView` from the second and nothing else.
 */

import {
  PARTY_MAX_MEMBERS,
  RELAY_DOG_BASE_SKIN_ID,
  SOCIAL_ACTIVITY_LABELS,
  isRelayDogSkinId,
  type SocialActionAvailability,
  type SocialActivityType,
  type SocialLocation,
  type SocialOnlineState,
  type SocialPresenceHeadline,
  type SocialUserId,
  type UserPresenceView,
  type UserProfile,
  type UserProfileView,
} from './social-contracts';
import {
  audienceAdmits,
  blockedEitherWay,
  friendIdsOf,
  outsiderSeesParty,
  partyOf,
  partyRosterFor,
  relationshipOf,
  sharePartyWith,
  userById,
  type SocialState,
} from './social-state';

/* ---------------------------------------------------------- the activity */

/** What Wonderland knows about one connected person this moment. */
export interface WonderlandActivitySignals {
  readonly inGveBattle: boolean;
  readonly runningMission: boolean;
  readonly juliusWorking: boolean;
  /** The kind of thing they are creating, if they are in a creation surface. */
  readonly creating: 'SOFTWARE' | 'GAME' | 'CONTENT' | null;
  readonly inPrivateServer: boolean;
  readonly inParty: boolean;
  /** Moving around the world rather than standing at a surface. */
  readonly exploring: boolean;
}

/**
 * ONE ACTIVITY, BY ONE PRECEDENCE. The most specific, most "come and see" thing wins: a GVE battle over a mission, a
 * mission over Julius working in the background, active creation over exploring, and being in a party only when nothing
 * more specific is true -- the party is shown separately anyway.
 */
export function deriveActivity(signals: WonderlandActivitySignals): SocialActivityType {
  if (signals.inGveBattle) return 'IN_GVE';
  if (signals.runningMission) return 'RUNNING_MISSION';
  if (signals.creating === 'GAME') return 'DEVELOPING_GAME';
  if (signals.creating === 'SOFTWARE') return 'CREATING_SOFTWARE';
  if (signals.creating === 'CONTENT') return 'CREATING_CONTENT';
  if (signals.juliusWorking) return 'WORKING_WITH_JULIUS';
  if (signals.inPrivateServer) return 'IN_PRIVATE_SERVER';
  if (signals.exploring) return 'EXPLORING';
  if (signals.inParty) return 'IN_PARTY';
  return 'IDLE';
}

/** The founder's headline for an activity, when the viewer may see the activity. */
function headlineForActivity(activity: SocialActivityType): SocialPresenceHeadline {
  switch (activity) {
    case 'IN_GVE':
      return 'IN GVE';
    case 'RUNNING_MISSION':
      return 'IN MISSION';
    case 'CREATING_SOFTWARE':
    case 'DEVELOPING_GAME':
    case 'CREATING_CONTENT':
      return 'CREATING';
    case 'WORKING_WITH_JULIUS':
      return 'WORKING WITH JULIUS';
    case 'IN_PRIVATE_SERVER':
      return 'IN PRIVATE SERVER';
    case 'IN_PARTY':
      return 'IN PARTY';
    case 'EXPLORING':
    case 'IDLE':
      return 'IN WONDERLAND';
  }
}

/* ---------------------------------------------------------- the resolver */

const NOTHING: SocialActionAvailability = Object.freeze({
  viewProfile: false,
  message: false,
  inviteToParty: false,
  joinParty: false,
  inviteToServer: false,
  joinServer: false,
  sendFriendRequest: false,
  removeFriend: false,
  mute: false,
  block: false,
  report: false,
});

/**
 * A STRANGER WHO SHARES NOTHING: exactly what a viewer with no relationship sees of somebody whose every audience is NOBODY
 * (presence, messages, friend requests) -- OFFLINE, no last-seen, restricted as PRIVATE; the profile opens, nothing else is
 * offered but mute, block and report. It is how the BLOCKED side sees the blocker (founder, 10-04: nothing shown to the
 * blocked side names BLOCKED; the projection is an ordinary private stranger's, field for field).
 */
export function privateStrangerView(subjectId: SocialUserId): UserPresenceView {
  return {
    userId: subjectId,
    onlineState: 'OFFLINE',
    headline: 'OFFLINE',
    activityLabel: null,
    location: null,
    partyId: null,
    lastSeenAtIso: null,
    can: { ...NOTHING, viewProfile: true, mute: true, block: true, report: true },
    restrictedReason: 'PRIVATE',
  };
}

/** The owner of a private server context (world-presence.ts names it `priv_<ownerId>`), else null. */
function privateServerOwnerOf(serverId: string): SocialUserId | null {
  return serverId.startsWith('priv_') && serverId.length > 'priv_'.length ? serverId.slice('priv_'.length) : null;
}

/**
 * ONE PERSON AS ONE VIEWER MAY SEE THEM.
 *
 * The order of the checks is the policy:
 *   1. a block either way -> nothing live. The BLOCKER sees their own block (OFFLINE, BLOCKED, unblock/report: they manage it);
 *      the BLOCKED sees an ordinary private stranger (privateStrangerView) -- never a word that names the block;
 *   2. not connected, APPEAR_OFFLINE, or outside the presence audience -> OFFLINE with no activity or place;
 *   3. AWAY / BUSY are the person's own words and replace the activity headline (the activity may still be listed);
 *   4. activity, location and a private server are each gated by their own audience;
 *   5. the actions follow from what is now known, never from the raw record.
 */
export function resolvePresenceFor(state: SocialState, viewerId: SocialUserId, subjectId: SocialUserId): UserPresenceView | null {
  const subject = userById(state, subjectId);
  if (subject === undefined) return null;
  const relationship = relationshipOf(state, viewerId, subjectId);

  if (relationship === 'BLOCKED_BY') return privateStrangerView(subjectId);
  if (relationship === 'BLOCKED') {
    return {
      userId: subjectId,
      onlineState: 'OFFLINE',
      headline: 'OFFLINE',
      activityLabel: null,
      location: null,
      partyId: null,
      lastSeenAtIso: null,
      // The blocker can still open the card to unblock, and report. Nobody can reach the other.
      can: { ...NOTHING, viewProfile: true, block: false, report: true },
      restrictedReason: 'BLOCKED',
    };
  }

  const { presence, privacy } = subject;
  const self = relationship === 'SELF';
  const friend = relationship === 'FRIEND';
  const seesPresence = self || audienceAdmits(state, privacy.presenceVisibility, viewerId, subjectId);
  const online = presence.connected && (self || presence.availability !== 'APPEAR_OFFLINE') && seesPresence;

  const baseActions: SocialActionAvailability = {
    viewProfile: true,
    message: !self && audienceAdmits(state, privacy.messagePolicy, viewerId, subjectId),
    inviteToParty: false,
    joinParty: false,
    inviteToServer: false,
    joinServer: false,
    sendFriendRequest: !self && relationship === 'NONE' && privacy.friendRequestPolicy === 'EVERYONE',
    removeFriend: friend,
    mute: !self,
    block: !self,
    report: !self,
  };

  if (!online) {
    return {
      userId: subjectId,
      onlineState: 'OFFLINE',
      headline: 'OFFLINE',
      activityLabel: null,
      location: null,
      partyId: null,
      // Last seen only for those who may see presence at all. An APPEAR_OFFLINE person's last-seen FROZE when they went hidden
      // (updateOwnPresence), so they read exactly as somebody who signed out then: a null here, for them alone, had told every
      // friend "online and hiding from you" (the privacy attacker's M1, 10-07).
      lastSeenAtIso: seesPresence ? presence.lastSeenAtIso : null,
      can: baseActions,
      restrictedReason: seesPresence ? 'OFFLINE' : privacy.presenceVisibility === 'FRIENDS' ? 'FRIENDS_ONLY' : 'PRIVATE',
      // the player's own choice, to them alone
      ...(self ? { availability: presence.availability } : {}),
    };
  }

  const onlineState: SocialOnlineState =
    presence.availability === 'AWAY' ? 'AWAY' : presence.availability === 'BUSY' ? 'BUSY' : 'ONLINE';
  const seesActivity = self || audienceAdmits(state, privacy.activityVisibility, viewerId, subjectId);
  const seesLocation = self || audienceAdmits(state, privacy.locationVisibility, viewerId, subjectId);
  const isPrivateServer = presence.location?.serverKind === 'PRIVATE_SERVER';
  // THE SERVER'S OWNER BEHIND THE VIEWER'S WALL (Second's R16 review, 10-04): a friend in a private server carries that server's
  // id (priv_<ownerId>) and name in their location, so a viewer walled from the OWNER would learn, through the friend, that the
  // owner is online and with whom. The friend's sharing choice never opens a wall it is not part of (as a friend's party holding
  // a walled member is hidden, below).
  const privateOwner = isPrivateServer ? privateServerOwnerOf(presence.location?.serverId ?? '') : null;
  const ownerWalled = privateOwner !== null && privateOwner !== viewerId && blockedEitherWay(state, viewerId, privateOwner);
  const seesPrivateServer = self || (!ownerWalled && audienceAdmits(state, privacy.privateServerVisibility, viewerId, subjectId));
  const location: SocialLocation | null =
    presence.location !== null && seesLocation && (!isPrivateServer || seesPrivateServer) ? presence.location : null;

  // A private-server ACTIVITY would name what the location rule just hid, so it is withheld with it.
  const activityHidden = !seesActivity || (presence.activity === 'IN_PRIVATE_SERVER' && !seesPrivateServer);
  const activityLabel = activityHidden
    ? null
    : presence.activityDetail !== null
      ? `${SOCIAL_ACTIVITY_LABELS[presence.activity]} · ${presence.activityDetail}`
      : SOCIAL_ACTIVITY_LABELS[presence.activity];
  const headline: SocialPresenceHeadline =
    onlineState === 'AWAY' ? 'AWAY' : onlineState === 'BUSY' ? 'BUSY' : activityHidden ? 'ONLINE' : headlineForActivity(presence.activity);

  const party = partyOf(state, subjectId);
  const viewerParty = partyOf(state, viewerId);
  const sameParty = sharePartyWith(state, viewerId, subjectId);
  // THE BLOCK WALL REACHES THROUGH A FRIEND (F1, 2026-10-02): a friend's party that holds somebody blocked either way with
  // the viewer is not shown at all -- no id, no member count, no join -- or the friend's presence would tell the viewer
  // that the party they were removed from (or left) still exists, and who is likely still in it. And a friend's party is shown
  // only as the snapshot lists it (WL-351-02, outsiderSeesParty): never while it is full or any member -- the leader or another
  // (WL-358-01) -- is hidden from the viewer, appears offline or is signed out, or this friend's card would say the party the
  // viewer can neither see nor join is there.
  const partyVisible = party !== undefined && (self || sameParty || (friend && outsiderSeesParty(state, viewerId, party)));
  const partyHasRoom = party !== undefined && party.members.length < PARTY_MAX_MEMBERS;
  const viewerMayInvite =
    viewerParty !== undefined &&
    (viewerParty.invitePermission === 'ANY_MEMBER' || viewerParty.leaderId === viewerId) &&
    viewerParty.members.length < PARTY_MAX_MEMBERS;

  const can: SocialActionAvailability = {
    ...baseActions,
    inviteToParty: !self && !sameParty && friend && viewerMayInvite && party === undefined,
    joinParty: !self && !sameParty && friend && partyVisible && party?.privacy === 'OPEN_TO_FRIENDS' && partyHasRoom && viewerParty === undefined,
    inviteToServer: !self && friend,
    joinServer:
      !self &&
      location !== null &&
      audienceAdmits(state, privacy.serverJoinPolicy, viewerId, subjectId) &&
      (!isPrivateServer || seesPrivateServer),
  };

  return {
    userId: subjectId,
    onlineState,
    headline,
    activityLabel,
    location,
    partyId: partyVisible ? (party?.partyId ?? null) : null,
    lastSeenAtIso: presence.lastSeenAtIso,
    can,
    restrictedReason: activityHidden || (presence.location !== null && location === null) ? (friend ? 'PRIVATE' : 'FRIENDS_ONLY') : null,
    // the player's own choice, to them alone: SELF is exempt from APPEAR_OFFLINE above, so onlineState cannot say it
    ...(self ? { availability: presence.availability } : {}),
  };
}

/* ------------------------------------------------------------ the profile */

/**
 * A PROFILE AS ONE VIEWER SEES IT. The public card is the owner's own showcase (already profile-safe by its types); the
 * presence, relationship, mutual friends and party status are this viewer's, through the same resolver as every list.
 *
 * THE BLOCKED SIDE OPENS THE BLOCKER'S PROFILE EXACTLY AS A STRANGER WHO SHARES NOTHING (founder, 10-04: "the same as a stranger
 * who doesn't share -- pick the stranger answer and use it for both"): the public card, presence privateStrangerView,
 * relationship NONE, no mutual friends, no party. Mutual friends are therefore shown to nobody with no relationship: for a
 * stranger they would be a live window onto the subject's friend list, and showing them to strangers but not to the blocked
 * side would itself name the block.
 */
export function resolveProfileFor(state: SocialState, viewerId: SocialUserId, subjectId: SocialUserId): UserProfileView | null {
  const subject = userById(state, subjectId);
  const presence = resolvePresenceFor(state, viewerId, subjectId);
  if (subject === undefined || presence === null || !presence.can.viewProfile) return null;
  const actual = relationshipOf(state, viewerId, subjectId);
  const relationship = actual === 'BLOCKED_BY' ? 'NONE' : actual;
  const blocked = blockedEitherWay(state, viewerId, subjectId);
  // THE WORN SKIN (BF-2) follows the player's presence audience: it is recorded from their world reports, so its changes are a
  // sign they are playing. Outside that audience, or blocked either way, the card shows the base form -- what every card showed
  // before the skin was recorded -- so the blocked side still sees exactly a stranger who shares nothing.
  const seesWornSkin = viewerId === subjectId || (!blocked && audienceAdmits(state, subject.privacy.presenceVisibility, viewerId, subjectId));
  const profile = profileWithSkinFor(subject.profile, seesWornSkin);
  const mine = new Set(friendIdsOf(state, viewerId));
  const mutualFriendIds =
    blocked || viewerId === subjectId || relationship === 'NONE'
      ? []
      : friendIdsOf(state, subjectId).filter((id) => mine.has(id) && !blockedEitherWay(state, viewerId, id));
  const party = partyOf(state, subjectId);
  const partyKnown = presence.partyId !== null;
  // A count is a roster: members behind the viewer's wall are not in it; an outsider has a count only for a party they see
  // whole (WL-358-01: every member seen online), the same roster the party view shows them (partyRosterFor).
  const visibleMembers = party === undefined ? 0 : partyRosterFor(state, viewerId, party).length;
  return {
    profile,
    presence,
    relationship,
    mutualFriendIds,
    partyStatus: {
      inParty: partyKnown,
      memberCount: partyKnown && party !== undefined ? visibleMembers : null,
      joinable: presence.can.joinParty,
    },
  };
}

/**
 * The card with the Dog's skin this viewer may see: the stored skin when they may see it and it is a canonical one, else the base
 * form. A stored id outside the registry (a row written behind the store's back) is never served. Only the skin id is replaced.
 */
function profileWithSkinFor(profile: UserProfile, seesWornSkin: boolean): UserProfile {
  const stored = profile.relayDog.skinId;
  const skinId = seesWornSkin && isRelayDogSkinId(stored) ? stored : RELAY_DOG_BASE_SKIN_ID;
  return skinId === stored ? profile : { ...profile, relayDog: { ...profile.relayDog, skinId } };
}
