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
  SOCIAL_ACTIVITY_LABELS,
  type SocialActionAvailability,
  type SocialActivityType,
  type SocialLocation,
  type SocialOnlineState,
  type SocialPresenceHeadline,
  type SocialUserId,
  type UserPresenceView,
  type UserProfileView,
} from './social-contracts';
import {
  audienceAdmits,
  blockedEitherWay,
  friendIdsOf,
  partyOf,
  relationshipOf,
  sharePartyWith,
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
 * ONE PERSON AS ONE VIEWER MAY SEE THEM.
 *
 * The order of the checks is the policy:
 *   1. a block either way -> OFFLINE, nothing else, and the only actions left are the ones that manage the block itself;
 *   2. not connected, APPEAR_OFFLINE, or outside the presence audience -> OFFLINE with no activity or place;
 *   3. AWAY / BUSY are the person's own words and replace the activity headline (the activity may still be listed);
 *   4. activity, location and a private server are each gated by their own audience;
 *   5. the actions follow from what is now known, never from the raw record.
 */
export function resolvePresenceFor(state: SocialState, viewerId: SocialUserId, subjectId: SocialUserId): UserPresenceView | null {
  const subject = state.users[subjectId];
  if (subject === undefined) return null;
  const relationship = relationshipOf(state, viewerId, subjectId);

  if (relationship === 'BLOCKED' || relationship === 'BLOCKED_BY') {
    return {
      userId: subjectId,
      onlineState: 'OFFLINE',
      headline: 'OFFLINE',
      activityLabel: null,
      location: null,
      partyId: null,
      lastSeenAtIso: null,
      // The blocker can still unblock and report; the blocked can still report. Nobody can reach the other.
      can: { ...NOTHING, viewProfile: relationship === 'BLOCKED', block: false, report: true },
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
      // Last seen only for those who may see presence at all, so an APPEAR_OFFLINE person is not betrayed by a fresh time.
      lastSeenAtIso: seesPresence && presence.availability !== 'APPEAR_OFFLINE' ? presence.lastSeenAtIso : null,
      can: baseActions,
      restrictedReason: seesPresence ? 'OFFLINE' : privacy.presenceVisibility === 'FRIENDS' ? 'FRIENDS_ONLY' : 'PRIVATE',
    };
  }

  const onlineState: SocialOnlineState =
    presence.availability === 'AWAY' ? 'AWAY' : presence.availability === 'BUSY' ? 'BUSY' : 'ONLINE';
  const seesActivity = self || audienceAdmits(state, privacy.activityVisibility, viewerId, subjectId);
  const seesLocation = self || audienceAdmits(state, privacy.locationVisibility, viewerId, subjectId);
  const isPrivateServer = presence.location?.serverKind === 'PRIVATE_SERVER';
  const seesPrivateServer = self || audienceAdmits(state, privacy.privateServerVisibility, viewerId, subjectId);
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
  const partyVisible = party !== undefined && (self || sameParty || (friend && party.privacy === 'OPEN_TO_FRIENDS'));
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
  };
}

/* ------------------------------------------------------------ the profile */

/**
 * A PROFILE AS ONE VIEWER SEES IT. The public card is the owner's own showcase (already profile-safe by its types); the
 * presence, relationship, mutual friends and party status are this viewer's, through the same resolver as every list.
 */
export function resolveProfileFor(state: SocialState, viewerId: SocialUserId, subjectId: SocialUserId): UserProfileView | null {
  const subject = state.users[subjectId];
  const presence = resolvePresenceFor(state, viewerId, subjectId);
  // Somebody the subject has blocked does not get their profile at all, from any surface.
  if (subject === undefined || presence === null || !presence.can.viewProfile) return null;
  const relationship = relationshipOf(state, viewerId, subjectId);
  const blocked = blockedEitherWay(state, viewerId, subjectId);
  const mine = new Set(friendIdsOf(state, viewerId));
  const mutualFriendIds =
    blocked || viewerId === subjectId ? [] : friendIdsOf(state, subjectId).filter((id) => mine.has(id) && !blockedEitherWay(state, viewerId, id));
  const party = partyOf(state, subjectId);
  const partyKnown = presence.partyId !== null;
  return {
    profile: subject.profile,
    presence,
    relationship,
    mutualFriendIds,
    partyStatus: {
      inParty: partyKnown,
      memberCount: partyKnown && party !== undefined ? party.members.length : null,
      joinable: presence.can.joinParty,
    },
  };
}
