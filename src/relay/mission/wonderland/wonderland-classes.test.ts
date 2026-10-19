import { describe, expect, it } from 'vitest';

import { RELAY_SKILLS } from '../skills/relay-skills';
import { WONDERLAND_ENGINEER_CLASSES } from './wonderland-contracts';
import {
  WONDERLAND_KNOWN_SKILL_IDS,
  projectWonderlandClassStandings,
  type WonderlandBadgeCandidate,
} from './wonderland-classes';

const badge = (
  overrides: Partial<WonderlandBadgeCandidate> = {},
): WonderlandBadgeCandidate => ({
  badgeId: 'badge_1',
  engineerClass: 'agentic_engineer',
  skillId: 'relay.repository.read',
  evidenceMissionId: 'mission_1',
  awardedAtIso: '2026-08-11T09:00:00.000Z',
  missionVerified: true,
  ...overrides,
});

describe('users are multi-class, structurally', () => {
  it('returns a standing for every class, always, in declaration order', () => {
    const { standings } = projectWonderlandClassStandings();
    expect(standings.map((standing) => standing.engineerClass)).toEqual([
      ...WONDERLAND_ENGINEER_CLASSES,
    ]);
    expect(standings).toHaveLength(7);
  });

  it('holds the seven declared archetypes and no eighth', () => {
    expect([...WONDERLAND_ENGINEER_CLASSES]).toEqual([
      'agentic_engineer',
      'ai_engineer',
      'forward_deployed_engineer',
      'software_engineer',
      'game_developer',
      'research_engineer',
      'systems_infrastructure_engineer',
    ]);
  });

  it('a single badge does not narrow the user to one class', () => {
    const { standings } = projectWonderlandClassStandings({
      badges: [badge({ engineerClass: 'game_developer' })],
    });
    expect(standings).toHaveLength(7);
    const game = standings.find((s) => s.engineerClass === 'game_developer');
    expect(game?.verifiedBadges).toHaveLength(1);
    // Every other class is still present, with an empty badge list rather than
    // being absent — there is no lock-in shape to read.
    expect(standings.filter((s) => s.verifiedBadges.length === 0)).toHaveLength(6);
  });

  it('exposes no primary-class field for a later feature to read', () => {
    const { standings } = projectWonderlandClassStandings({ badges: [badge()] });
    for (const key of Object.keys(standings[0])) {
      expect(key).not.toMatch(/primary|main|selected|active/i);
    }
  });
});

describe('a badge is verified mastery and a claim is a claim', () => {
  it('an unverified mission never becomes a badge', () => {
    const { standings } = projectWonderlandClassStandings({
      badges: [badge({ missionVerified: false })],
    });
    const agentic = standings.find((s) => s.engineerClass === 'agentic_engineer');
    expect(agentic?.verifiedBadges).toEqual([]);
    expect(agentic?.unverifiedClaimCount).toBe(1);
  });

  it('counts claims and badges in separate fields that cannot merge', () => {
    const { standings } = projectWonderlandClassStandings({
      badges: [
        badge({ badgeId: 'b1' }),
        badge({ badgeId: 'b2', missionVerified: false }),
        badge({ badgeId: 'b3', missionVerified: false }),
      ],
    });
    const agentic = standings.find((s) => s.engineerClass === 'agentic_engineer');
    expect(agentic?.verifiedBadges.map((b) => b.badgeId)).toEqual(['b1']);
    expect(agentic?.unverifiedClaimCount).toBe(2);
  });

  it('every awarded badge names the mission that earned it', () => {
    const { standings } = projectWonderlandClassStandings({ badges: [badge()] });
    const awarded = standings.flatMap((s) => s.verifiedBadges);
    expect(awarded).toHaveLength(1);
    expect(awarded[0].evidenceMissionId).toBe('mission_1');
    expect(awarded[0].evidenceMissionId.length).toBeGreaterThan(0);
  });
});

describe('a Skill Plugin is a real Relay capability', () => {
  it('derives the known set from Relay\'s own catalogue', () => {
    expect(WONDERLAND_KNOWN_SKILL_IDS.size).toBe(RELAY_SKILLS.length);
    for (const skill of RELAY_SKILLS) {
      expect(WONDERLAND_KNOWN_SKILL_IDS.has(skill.skillId)).toBe(true);
    }
  });

  it('keeps ids the catalogue knows', () => {
    const real = RELAY_SKILLS[0].skillId;
    const { standings, unknownSkillPluginIds } = projectWonderlandClassStandings({
      skillPluginIds: [real],
    });
    expect(unknownSkillPluginIds).toEqual([]);
    expect(standings[0].skillPluginIds).toEqual([real]);
  });

  it('drops an unknown id AND reports it', () => {
    // Silently dropping it is how a capability that resolves to nothing survives.
    const { standings, unknownSkillPluginIds } = projectWonderlandClassStandings({
      skillPluginIds: ['relay.repository.read', 'relay.deploy.production'],
    });
    expect(unknownSkillPluginIds).toEqual(['relay.deploy.production']);
    for (const standing of standings) {
      expect(standing.skillPluginIds).not.toContain('relay.deploy.production');
    }
  });
});
