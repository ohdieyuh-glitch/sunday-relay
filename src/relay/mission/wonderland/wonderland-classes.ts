/**
 * SUNDAY RELAY — WONDERLAND: SKILLS AND CLASSES (FOUNDATION ONLY).
 *
 * Seven engineer classes: Agentic, AI, Forward-Deployed, Software, Game
 * Developer, Research, Systems/Infrastructure. Users are MULTI-CLASS and never
 * locked to one archetype, and that is structural here rather than a policy:
 * `projectWonderlandClassStandings` returns a standing for every class, always,
 * and there is no "primary class" field anywhere for a later feature to start
 * reading.
 *
 * A BADGE IS VERIFIED MASTERY. Every badge names the mission that earned it and
 * cannot be constructed without one. Claimed-but-unverified work is counted in a
 * SEPARATE field, so no aggregation can quietly merge the two — the count and the
 * badge list never share a container.
 *
 * A SKILL PLUGIN IS A REAL RELAY CAPABILITY. `skillPluginIds` are ids from
 * `mission/skills`, validated against that catalogue. An unrecognised id is
 * dropped and reported, because a class advertising a capability Relay cannot run
 * is the same failure as a mission claiming a test that never ran.
 *
 * WHAT IS NOT BUILT, and is documented as planned in docs/relay/WONDERLAND.md:
 * levelling curves, XP, prestige, class-gated content, badge artwork, trading.
 * None of it appears in these types.
 *
 * PURE. No clock: `awardedAtIso` arrives on the badge that already happened.
 */

import { RELAY_SKILLS } from '../skills/relay-skills';
import {
  WONDERLAND_ENGINEER_CLASSES,
  type WonderlandBadge,
  type WonderlandClassStanding,
  type WonderlandEngineerClass,
} from './wonderland-contracts';

/** Every skill id Relay actually ships, derived from the catalogue. */
export const WONDERLAND_KNOWN_SKILL_IDS: ReadonlySet<string> = new Set(
  RELAY_SKILLS.map((skill) => skill.skillId),
);

/**
 * A badge candidate. `evidenceMissionId` is required by the type, so a badge
 * without a mission behind it is unrepresentable rather than filtered.
 */
export interface WonderlandBadgeCandidate {
  readonly badgeId: string;
  readonly engineerClass: WonderlandEngineerClass;
  readonly skillId: string;
  readonly evidenceMissionId: string;
  readonly awardedAtIso: string;
  /**
   * Whether the earning mission reached verified completion. A badge is
   * VERIFIED mastery, so `false` here means this is a claim and it is counted as
   * one instead of being awarded.
   */
  readonly missionVerified: boolean;
}

export interface WonderlandClassInput {
  readonly badges?: readonly WonderlandBadgeCandidate[];
  /** Skill ids the user's Agent has been granted. Validated, not trusted. */
  readonly skillPluginIds?: readonly string[];
}

export interface WonderlandClassProjection {
  /** One standing per class, in declaration order. Always all seven. */
  readonly standings: readonly WonderlandClassStanding[];
  /**
   * Skill ids that named nothing in Relay's catalogue. Reported rather than
   * silently dropped — an id that resolves to no capability is a defect
   * somewhere upstream, and hiding it is how it survives.
   */
  readonly unknownSkillPluginIds: readonly string[];
}

/**
 * Project standings for all seven classes.
 *
 * The badge/claim split is the assertion worth reading: a candidate whose
 * mission is not verified never enters `verifiedBadges`. It increments
 * `unverifiedClaimCount`, which no code path can turn into a badge because the
 * two fields have different types and the badge type demands a mission id that
 * the counter does not carry.
 */
export function projectWonderlandClassStandings(
  input: WonderlandClassInput = {},
): WonderlandClassProjection {
  const candidates = input.badges ?? [];
  const requested = input.skillPluginIds ?? [];
  const knownSkills = requested.filter((id) => WONDERLAND_KNOWN_SKILL_IDS.has(id));
  const unknownSkillPluginIds = requested.filter((id) => !WONDERLAND_KNOWN_SKILL_IDS.has(id));

  const standings: WonderlandClassStanding[] = WONDERLAND_ENGINEER_CLASSES.map(
    (engineerClass) => {
      const mine = candidates.filter((candidate) => candidate.engineerClass === engineerClass);
      const verifiedBadges: WonderlandBadge[] = mine
        .filter((candidate) => candidate.missionVerified)
        .map((candidate) => ({
          badgeId: candidate.badgeId,
          engineerClass: candidate.engineerClass,
          skillId: candidate.skillId,
          evidenceMissionId: candidate.evidenceMissionId,
          awardedAtIso: candidate.awardedAtIso,
        }));
      return {
        engineerClass,
        verifiedBadges,
        unverifiedClaimCount: mine.length - verifiedBadges.length,
        skillPluginIds: knownSkills,
      };
    },
  );

  return { standings, unknownSkillPluginIds };
}
