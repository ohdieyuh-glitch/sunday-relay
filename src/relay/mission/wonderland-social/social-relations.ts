import {
  WONDERLAND_DEFAULT_VISIBILITY,
  wonderlandFriendKey,
  type WonderlandSocialState,
  type WonderlandSocialVisibility,
} from './social-contracts';

/**
 * WHO IS SOMEONE TO SOMEONE ELSE — the one relation every privacy rule reads.
 *
 *   SELF      the same player.
 *   BLOCKED   a block exists in EITHER direction. It outranks everything: a
 *             blocked pair is never a friend, never a party-mate, never
 *             visible, whatever else is true.
 *   FRIEND    an accepted friendship.
 *   PARTY     members of the same party. Joining a party is consent to be seen
 *             by it, so a party-mate is not a stranger.
 *   STRANGER  anyone else — including a private server's owner and its other
 *             members. Membership of somebody's server is not friendship, and a
 *             player hidden from strangers stays hidden from their host too
 *             (decision point recorded for SECOND Wonderland: OWNER_NOT_EXEMPT).
 */
export const WONDERLAND_SOCIAL_RELATIONS = ['SELF', 'BLOCKED', 'FRIEND', 'PARTY', 'STRANGER'] as const;
export type WonderlandSocialRelation = (typeof WONDERLAND_SOCIAL_RELATIONS)[number];

export function isWonderlandBlockedPair(state: WonderlandSocialState, a: string, b: string): boolean {
  return state.blocks.some((block) =>
    (block.blockerId === a && block.blockedId === b) || (block.blockerId === b && block.blockedId === a));
}

export function wonderlandVisibilityOf(state: WonderlandSocialState, playerId: string): WonderlandSocialVisibility {
  return state.settings[playerId]?.visibility ?? WONDERLAND_DEFAULT_VISIBILITY;
}

export function wonderlandRelationOf(state: WonderlandSocialState, viewerId: string, subjectId: string): WonderlandSocialRelation {
  if (viewerId === subjectId) return 'SELF';
  if (isWonderlandBlockedPair(state, viewerId, subjectId)) return 'BLOCKED';
  if (state.friendships.includes(wonderlandFriendKey(viewerId, subjectId))) return 'FRIEND';
  const sameParty = Object.values(state.parties).some((party) =>
    party.memberIds.includes(viewerId) && party.memberIds.includes(subjectId));
  return sameParty ? 'PARTY' : 'STRANGER';
}

/**
 * MAY THE VIEWER SEE THE SUBJECT AT ALL. Every projection asks this and only
 * this, so there is one place where "visible" is defined:
 * self, friends and party-mates always; strangers only when the subject is
 * visible to EVERYONE; a blocked pair never, in either direction.
 */
export function isWonderlandVisibleTo(state: WonderlandSocialState, viewerId: string, subjectId: string): boolean {
  switch (wonderlandRelationOf(state, viewerId, subjectId)) {
    case 'SELF':
    case 'FRIEND':
    case 'PARTY':
      return true;
    case 'BLOCKED':
      return false;
    case 'STRANGER':
      return wonderlandVisibilityOf(state, subjectId) === 'EVERYONE';
    default:
      return false;
  }
}
