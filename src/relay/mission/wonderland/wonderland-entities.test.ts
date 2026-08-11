import { describe, expect, it } from 'vitest';

import { WONDERLAND_PROJECT_CATEGORIES } from './wonderland-contracts';
import {
  WONDERLAND_CATEGORY_FORM,
  WONDERLAND_STAGE_THRESHOLDS,
  evidenceQualifiesForEvolution,
  isWonderlandProjectCategory,
  projectWonderlandEntity,
  wonderlandFormFor,
  type WonderlandMissionEvidence,
} from './wonderland-entities';

const verified = (missionId: string): WonderlandMissionEvidence => ({
  missionId,
  verdict: 'verified_complete',
  attested: true,
  reviewApproved: true,
  evidenceIds: [`ev_${missionId}`],
});

const verifiedRun = (count: number): WonderlandMissionEvidence[] =>
  Array.from({ length: count }, (_, index) => verified(`m${index}`));

/* --------------------------------------------------------------- the form */

describe('form follows category, and never repository size', () => {
  it('maps every category to a distinct declared form', () => {
    for (const category of WONDERLAND_PROJECT_CATEGORIES) {
      expect(WONDERLAND_CATEGORY_FORM[category], `${category} has no form`).toBeDefined();
    }
    const forms = Object.values(WONDERLAND_CATEGORY_FORM);
    expect(new Set(forms).size, 'two categories share a silhouette').toBe(forms.length);
  });

  it('gives the shooter a war creature and the database a vessel, not buildings', () => {
    expect(wonderlandFormFor('game_3d_shooter')).toBe('war_creature');
    expect(wonderlandFormFor('database_platform')).toBe('data_vessel');
    expect(wonderlandFormFor('ai_system')).toBe('mythic_organism');
    expect(wonderlandFormFor('devtool')).toBe('clockwork_entity');
    expect(wonderlandFormFor('cloud_system')).toBe('sky_carrier');
  });

  it('an unestablished category is fogged, never a default building', () => {
    expect(wonderlandFormFor(null)).toBe('fogged_unknown');
    expect(wonderlandFormFor('unknown')).toBe('fogged_unknown');
  });

  it('narrows an untrusted value without inventing a category', () => {
    expect(isWonderlandProjectCategory('devtool')).toBe(true);
    expect(isWonderlandProjectCategory('DEVTOOL')).toBe(false);
    expect(isWonderlandProjectCategory('crm')).toBe(false);
    expect(isWonderlandProjectCategory(undefined)).toBe(false);
  });
});

/* ---------------------------------------------------------- the evolution */

describe('only verified meaningful development evolves an entity', () => {
  it('five hundred unverified activities move nothing', () => {
    // The whole rule, in one assertion. Commit spam, unattested runs and
    // unapproved reviews all arrive as `unverifiedActivityCount`, which appears
    // nowhere in the stage arithmetic.
    const entity = projectWonderlandEntity({
      projectId: 'proj_1',
      category: 'devtool',
      observed: true,
      unverifiedActivityCount: 500,
    });
    expect(entity.stage).toBe(0);
    expect(entity.evolutionEvidenceCount).toBe(0);
    // The work is still SHOWN. It just does not count.
    expect(entity.unverifiedActivityCount).toBe(500);
    expect(entity.nextStageRequirement).toContain('Commits do not count');
  });

  it('rejects each way a mission can fall short, one at a time', () => {
    const cases: ReadonlyArray<readonly [string, WonderlandMissionEvidence]> = [
      ['an approved but unverified mission', { ...verified('m'), verdict: 'approved' }],
      ['a claimed-complete mission', { ...verified('m'), verdict: 'claimed_complete' }],
      ['an unattested execution', { ...verified('m'), attested: false }],
      ['a review that did not approve', { ...verified('m'), reviewApproved: false }],
      ['evidence that cites nothing', { ...verified('m'), evidenceIds: [] }],
    ];
    for (const [label, evidence] of cases) {
      expect(evidenceQualifiesForEvolution(evidence), label).toBe(false);
      const entity = projectWonderlandEntity({
        projectId: 'p', category: 'devtool', observed: true, missionEvidence: [evidence],
      });
      expect(entity.stage, label).toBe(0);
      expect(entity.evolutionEvidenceCount, label).toBe(0);
    }
  });

  it('accepts a mission that satisfies all four facts', () => {
    expect(evidenceQualifiesForEvolution(verified('m'))).toBe(true);
  });

  it('advances one stage per crossed threshold', () => {
    const stageFor = (count: number) =>
      projectWonderlandEntity({
        projectId: 'p', category: 'ai_system', observed: true,
        missionEvidence: verifiedRun(count),
      }).stage;

    expect(stageFor(0)).toBe(0);
    for (const [index, threshold] of WONDERLAND_STAGE_THRESHOLDS.entries()) {
      expect(stageFor(threshold), `at ${threshold} qualifying missions`).toBe(index + 1);
      if (threshold > 1) expect(stageFor(threshold - 1)).toBe(index);
    }
  });

  it('does not exceed the declared stages, and says the ladder ends', () => {
    const top = WONDERLAND_STAGE_THRESHOLDS.at(-1) as number;
    const entity = projectWonderlandEntity({
      projectId: 'p', category: 'devtool', observed: true,
      missionEvidence: verifiedRun(top + 50),
    });
    expect(entity.stage).toBe(WONDERLAND_STAGE_THRESHOLDS.length);
    expect(entity.nextStageRequirement).toContain('not built');
  });

  it('mixes qualifying and non-qualifying evidence without crediting the latter', () => {
    const entity = projectWonderlandEntity({
      projectId: 'p',
      category: 'cloud_system',
      observed: true,
      missionEvidence: [
        verified('a'),
        { ...verified('b'), attested: false },
        { ...verified('c'), evidenceIds: [] },
        verified('d'),
      ],
      unverifiedActivityCount: 12,
    });
    expect(entity.evolutionEvidenceCount).toBe(2);
    expect(entity.stage).toBe(1);
  });
});

describe('an unobserved project has no stage at all', () => {
  it('stage is absent, not zero, and the entity is fogged', () => {
    const entity = projectWonderlandEntity({ projectId: 'proj_1', observed: false });
    // Zero would be a measurement. Relay has not looked.
    expect(entity.stage).toBeNull();
    expect(entity.form).toBe('fogged_unknown');
    expect(entity.category).toBeNull();
    expect(entity.nextStageRequirement).toContain('no record of this project');
  });

  it('a watched project with nothing verified is stage 0 — a real measurement', () => {
    const entity = projectWonderlandEntity({
      projectId: 'proj_1', category: 'web_application', observed: true,
    });
    expect(entity.stage).toBe(0);
    expect(entity.form).toBe('glass_pavilion');
  });
});
