import { describe, expect, it } from 'vitest';

import { JULIUS_REVIEW_STAGES, reviewChargeFor, reviewStageOf } from './julius-review-stage';

describe('DEFECT 2 — the review stage is canonical task metadata', () => {
  it('reads every stage from the review task type', () => {
    expect(reviewStageOf('review:plan')).toBe('plan');
    expect(reviewStageOf('review:build')).toBe('build');
    expect(reviewStageOf('review:repair:plan')).toBe('repair:plan');
    expect(reviewStageOf('review:repair:build')).toBe('repair:build');
  });

  it('refuses to guess: a non-review type, a task id, or an unknown stage is null', () => {
    expect(reviewStageOf('build')).toBeNull();
    expect(reviewStageOf('plan-1:review')).toBeNull();
    expect(reviewStageOf('run:526ca97da0e94b6223a5320a:plan:review')).toBeNull();
    expect(reviewStageOf('review:audit')).toBeNull();
    expect(reviewStageOf('review:repair:repair:build')).toBeNull();
    expect(reviewStageOf('')).toBeNull();
  });
});

describe('the charge for each stage', () => {
  it('a PLAN review judges the plan and must not demand an implementation', () => {
    const charge = reviewChargeFor('plan');
    expect(charge.subject).toBe('PLAN');
    expect(charge.repair).toBe(false);
    expect(charge.requires).toEqual(['plan']);
    for (const absent of ['completed edits', 'a unified diff', 'changed file contents', 'executed test output']) {
      expect(charge.mustNotDemand).toContain(absent);
    }
    const text = charge.judges.join(' ');
    for (const topic of ['objective', 'acceptance criterion', 'scope', 'constraints', 'required implementation', 'verification strategy', 'risks', 'handoff']) {
      expect(text.toLowerCase(), topic).toContain(topic);
    }
  });

  it('a BUILD review judges the implementation and requires the plan and the diff', () => {
    const charge = reviewChargeFor('build');
    expect(charge.subject).toBe('IMPLEMENTATION');
    expect(charge.requires).toEqual(['plan', 'diff']);
    expect(charge.mustNotDemand).toEqual([]);
    expect(charge.judges.join(' ').toLowerCase()).toContain('diff');
  });

  it('a REPAIR review adds resolution of every prior finding, but never REQUIRES one', () => {
    // Julius admits a repair round on the subject's own FAILED evidence as
    // well as on a reviewer finding, and such a round has no findings by
    // construction — so requiring them would refuse a review of a repair that
    // was scheduled exactly as designed.
    for (const stage of ['repair:plan', 'repair:build'] as const) {
      const charge = reviewChargeFor(stage);
      expect(charge.repair).toBe(true);
      expect(charge.requires).not.toContain('priorFindings');
      expect(charge.judges.at(-1)?.toLowerCase()).toContain('prior blocking finding');
    }
    expect(reviewChargeFor('repair:plan').requires).toEqual(['plan']);
    expect(reviewChargeFor('repair:build').requires).toEqual(['plan', 'diff']);
    expect(reviewChargeFor('repair:plan').subject).toBe('PLAN');
    expect(reviewChargeFor('repair:build').subject).toBe('IMPLEMENTATION');
  });

  it('every declared stage has a charge, and the charges are frozen', () => {
    for (const stage of JULIUS_REVIEW_STAGES) {
      const charge = reviewChargeFor(stage);
      expect(charge.stage).toBe(stage);
      expect(Object.isFrozen(charge)).toBe(true);
      expect(Object.isFrozen(charge.judges)).toBe(true);
    }
  });
});
