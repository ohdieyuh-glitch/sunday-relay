import { describe, expect, it } from 'vitest';

import {
  evaluateResearchIteration,
  fingerprintPlan,
  freezeResearchPlan,
  questionAnswered,
  type ResearchIterationInput,
  type ResearchPlan,
} from './research-loop';
import { normalizeObservation, type RawObservation } from '../../evidence';
import type { LiveReachAttempt } from '../../live-reach';

/**
 * RESEARCH LOOPS — the freeze, and the three honest outcomes.
 *
 * A loop that can edit its own success criteria will always succeed. So the
 * thing under test is mostly refusal: a round working to a different plan, or
 * drawing on a source the plan did not permit, or reviewed by whoever proposed
 * it, cannot be evaluated at all.
 *
 * And INCONCLUSIVE is a real answer. A round that neither confirmed nor
 * refuted is not a failure and not a pass; forcing it into either is how a
 * research loop becomes theatre.
 */

const ATTEMPT: LiveReachAttempt = {
  source: 'github',
  capability: 'read_item',
  requestedBackendId: 'relay_github_public',
  actualBackendId: 'relay_github_public',
  fallbackOccurred: false,
  startedAt: '2026-08-10T12:00:00.000Z',
  completedAt: '2026-08-10T12:00:01.000Z',
};

const evidence = (over: Partial<RawObservation> = {}, id = 'ev-1') =>
  normalizeObservation(id, {
    missionId: 'msn-1',
    projectId: 'rly-100',
    source: 'github',
    capability: 'read_item',
    reference: 'https://github.com/example/repo/releases/tag/v2.0.0',
    title: 'v2.0.0',
    author: 'example',
    publishedAt: '2026-08-10T11:30:00.000Z',
    retrievedAt: '2026-08-10T12:00:00.000Z',
    query: null,
    content: 'The legacy adapter has been removed.',
    sanitization: 'clean',
    injectionSignals: [],
    authority: 'primary',
    attempt: ATTEMPT,
    ...over,
  });

const PLAN: ResearchPlan = {
  planId: 'plan-1',
  question: 'Has the legacy adapter been removed?',
  criteria: [
    { id: 'c1', text: 'A primary source states the removal.', blocking: true, minimumAuthority: 'primary' },
  ],
  evaluatorId: 'reviewer-hermes',
  permittedSources: ['github'],
  requiresIndependentReview: true,
  maximumEvidenceAgeMinutes: null,
};

const frozen = freezeResearchPlan(PLAN, '2026-08-10T11:00:00.000Z');

const iteration = (over: Partial<ResearchIterationInput> = {}): ResearchIterationInput => ({
  frozen,
  planFingerprint: frozen.fingerprint,
  evidence: [evidence()],
  proposedBy: 'prompt-architect',
  reviewedBy: 'reviewer-hermes',
  claimedCriterionIds: ['c1'],
  ...over,
});

describe('the plan is frozen', () => {
  it('refuses a round evaluated against different criteria', () => {
    const edited = freezeResearchPlan({
      ...PLAN,
      criteria: [{ id: 'c1', text: 'Anyone says so.', blocking: true, minimumAuthority: 'community' }],
    }, '2026-08-10T11:00:00.000Z');

    const result = evaluateResearchIteration(iteration({ planFingerprint: edited.fingerprint }));
    expect(result.verdict).toBe('refused');
    expect(result.refusal).toBe('plan_changed');
    // Nothing is evaluated: a round working to another definition of success
    // has not produced a weak answer, it has produced an unreadable one.
    expect(result.criteria).toEqual([]);
  });

  it('refuses when the EVALUATOR was swapped, not only the criteria', () => {
    // Changing the judge mid-loop is the same defect as changing the bar.
    const swapped = freezeResearchPlan({ ...PLAN, evaluatorId: 'reviewer-codex' }, '2026-08-10T11:00:00.000Z');
    expect(swapped.fingerprint).not.toBe(frozen.fingerprint);
    expect(evaluateResearchIteration(iteration({ planFingerprint: swapped.fingerprint })).refusal)
      .toBe('plan_changed');
  });

  it('refuses when the independence requirement was relaxed', () => {
    const relaxed = freezeResearchPlan({ ...PLAN, requiresIndependentReview: false }, '2026-08-10T11:00:00.000Z');
    expect(relaxed.fingerprint).not.toBe(frozen.fingerprint);
  });

  it('does not change fingerprint when only the plan is renamed', () => {
    // A rename is not a change. A fingerprint that moved on one would refuse
    // honest loops and teach people to work around it.
    expect(fingerprintPlan({ ...PLAN, planId: 'plan-renamed' })).toBe(frozen.fingerprint);
  });

  it('does not change fingerprint when criteria are merely reordered', () => {
    const two: ResearchPlan = {
      ...PLAN,
      criteria: [
        { id: 'a', text: 'first', blocking: true, minimumAuthority: 'primary' },
        { id: 'b', text: 'second', blocking: false, minimumAuthority: 'secondary' },
      ],
    };
    const reordered: ResearchPlan = { ...two, criteria: [two.criteria[1]!, two.criteria[0]!] };
    expect(fingerprintPlan(reordered)).toBe(fingerprintPlan(two));
  });
});

describe('the loop stays inside its permissions', () => {
  it('refuses evidence from a source the plan did not permit', () => {
    const result = evaluateResearchIteration(iteration({
      evidence: [evidence({ source: 'web' }, 'ev-web')],
    }));
    expect(result.verdict).toBe('refused');
    expect(result.refusal).toBe('source_not_permitted');
    expect(result.detail).toContain('web');
  });

  it('permits any source when the plan names none', () => {
    const open = freezeResearchPlan({ ...PLAN, permittedSources: [] }, '2026-08-10T11:00:00.000Z');
    const result = evaluateResearchIteration(iteration({
      frozen: open,
      planFingerprint: open.fingerprint,
      evidence: [evidence({ source: 'web', authority: 'primary' }, 'ev-web')],
    }));
    expect(result.refusal).toBeNull();
  });
});

describe('review independence is enforced by the plan, not ad hoc', () => {
  it('refuses when the proposer reviewed their own round', () => {
    const result = evaluateResearchIteration(iteration({
      proposedBy: 'prompt-architect', reviewedBy: 'prompt-architect',
    }));
    expect(result.refusal).toBe('reviewer_not_independent');
    expect(result.detail).toContain('both proposed and reviewed');
  });

  it('refuses when no reviewer is recorded at all', () => {
    const result = evaluateResearchIteration(iteration({ reviewedBy: null }));
    expect(result.refusal).toBe('reviewer_not_independent');
  });

  it('allows an unreviewed round only when the plan never required review', () => {
    const relaxed = freezeResearchPlan({ ...PLAN, requiresIndependentReview: false }, '2026-08-10T11:00:00.000Z');
    const result = evaluateResearchIteration(iteration({
      frozen: relaxed, planFingerprint: relaxed.fingerprint, reviewedBy: null,
    }));
    expect(result.refusal).toBeNull();
  });
});

describe('the three outcomes', () => {
  it('keeps a round whose blocking criteria are met by qualifying evidence', () => {
    const result = evaluateResearchIteration(iteration());
    expect(result.verdict).toBe('kept');
    expect(questionAnswered(result)).toBe(true);
    expect(result.criteria[0]?.satisfiedBy).toContain('ev-1');
  });

  it('is INCONCLUSIVE when nothing qualified, rather than a failure', () => {
    // Community discussion cannot satisfy a criterion that demands a primary
    // source, however much of it there is.
    const result = evaluateResearchIteration(iteration({
      evidence: [evidence({ authority: 'community' }, 'ev-forum')],
    }));
    expect(result.verdict).toBe('inconclusive');
    expect(questionAnswered(result)).toBe(false);
    expect(result.detail).toContain('neither satisfied nor contradicted');
  });

  it('reverts when something was satisfied and a blocking criterion was not', () => {
    const twoCriteria = freezeResearchPlan({
      ...PLAN,
      criteria: [
        { id: 'c1', text: 'Primary source states removal.', blocking: true, minimumAuthority: 'primary' },
        { id: 'c2', text: 'Someone mentions it.', blocking: false, minimumAuthority: 'community' },
      ],
    }, '2026-08-10T11:00:00.000Z');
    const result = evaluateResearchIteration({
      frozen: twoCriteria,
      planFingerprint: twoCriteria.fingerprint,
      evidence: [evidence({ authority: 'community' }, 'ev-forum')],
      proposedBy: 'prompt-architect',
      reviewedBy: 'reviewer-hermes',
      claimedCriterionIds: ['c1', 'c2'],
    });
    expect(result.verdict).toBe('reverted');
    expect(result.openReasons.join(' ')).toContain('c1');
  });

  it('refuses a round that gathered nothing', () => {
    const result = evaluateResearchIteration(iteration({ evidence: [] }));
    expect(result.refusal).toBe('no_evidence');
  });

  it('does not credit a criterion the round never claimed', () => {
    const result = evaluateResearchIteration(iteration({ claimedCriterionIds: [] }));
    expect(result.criteria[0]?.satisfied).toBe(false);
    expect(result.criteria[0]?.reason).toContain('did not claim');
  });
});

describe('freshness requirements are real requirements', () => {
  const fresh = freezeResearchPlan({ ...PLAN, maximumEvidenceAgeMinutes: 60 }, '2026-08-10T11:00:00.000Z');

  it('accepts evidence inside the window', () => {
    const result = evaluateResearchIteration(iteration({
      frozen: fresh, planFingerprint: fresh.fingerprint,
    }));
    expect(result.verdict).toBe('kept');
  });

  it('rejects evidence older than the window', () => {
    const result = evaluateResearchIteration(iteration({
      frozen: fresh,
      planFingerprint: fresh.fingerprint,
      evidence: [evidence({ publishedAt: '2026-08-09T12:00:00.000Z' }, 'ev-old')],
    }));
    expect(result.verdict).toBe('inconclusive');
  });

  it('does not let UNKNOWN age satisfy an age requirement', () => {
    // A plan demanding evidence younger than an hour is not satisfied by
    // evidence of unknown date, however recently it was fetched.
    const result = evaluateResearchIteration(iteration({
      frozen: fresh,
      planFingerprint: fresh.fingerprint,
      evidence: [evidence({ publishedAt: null }, 'ev-undated')],
    }));
    expect(result.verdict).toBe('inconclusive');
    expect(result.criteria[0]?.reason).toContain('freshness');
  });
});
