import { describe, expect, it } from 'vitest';

import {
  JULIUS_FINDING_MOVES, JULIUS_FINDING_MOVE_RESULTS, JULIUS_FINDING_STATES,
  foldJuliusFindings, juliusFindingIsOutstanding, juliusFindingLife, juliusFindingTransitionFacts, moveJuliusFinding,
  type JuliusFindingLife, type JuliusFindingMove,
} from './julius-finding-lifecycle';
import { JULIUS_REPAIR_ROUND_LIMITS, juliusRepairRoundDiff, renderJuliusRepairRoundDiff } from './julius-repair-round';
import { validateJuliusEvent } from './julius-events';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/** The finding's life and the repair-round comparison, without a runtime. */

const FINDING: JuliusReviewerFinding = {
  findingId: 'finding:evidence-1', runId: 'run-1', taskId: 'build-1', reviewerWorkerId: 'reviewer',
  severity: 'HIGH', category: 'missed_acceptance_criterion', claim: 'NULL renders as the literal word.',
  criterionId: 'AC-1', evidenceIds: ['evidence-1'], blocking: true, status: 'OPEN', createdAt: 't0',
};

const open = (): JuliusFindingLife => juliusFindingLife(FINDING, 'build-1:review');
const move = (life: JuliusFindingLife, kind: JuliusFindingMove, over: Record<string, string> = {}) =>
  moveJuliusFinding(life, {
    findingId: life.findingId, move: kind, at: 't1',
    reviewTaskId: 'repair:build-1:1:task:review', repairTaskId: 'repair:build-1:1:task', ...over,
  });
const moved = (life: JuliusFindingLife, kind: JuliusFindingMove, over: Record<string, string> = {}): JuliusFindingLife => {
  const outcome = move(life, kind, over);
  if (outcome.outcome !== 'MOVED') throw new Error(outcome.reasonCode);
  return outcome.life;
};

describe('a finding is recorded open, and only a reviewer ends it', () => {
  it('starts OPEN, about one task, with the review that raised it', () => {
    expect(open()).toMatchObject({
      findingId: 'finding:evidence-1', taskId: 'build-1', state: 'OPEN', originReviewTaskId: 'build-1:review',
      repairTaskIds: [], resolutionReviewTaskId: null, supersededByFindingId: null, lastMove: null,
    });
    expect(JULIUS_FINDING_STATES).toEqual(['OPEN', 'ADDRESSED', 'RESOLVED', 'SUPERSEDED']);
  });

  it('a repair addresses it and NEVER resolves it', () => {
    const addressed = moved(open(), 'REPAIR_SUCCEEDED');
    expect(addressed).toMatchObject({ state: 'ADDRESSED', repairTaskIds: ['repair:build-1:1:task'], resolutionReviewTaskId: null });
    // There is no move from a repair to RESOLVED at all: the table says so.
    expect(JULIUS_FINDING_MOVE_RESULTS.REPAIR_SUCCEEDED).toBe('ADDRESSED');
    expect(JULIUS_FINDING_MOVES.filter((kind) => JULIUS_FINDING_MOVE_RESULTS[kind] === 'RESOLVED')).toEqual(['REVIEWER_RESOLVED']);
  });

  it('a reviewer resolves, maintains or supersedes it, and each records what it needs', () => {
    const addressed = moved(open(), 'REPAIR_SUCCEEDED');
    expect(moved(addressed, 'REVIEWER_RESOLVED')).toMatchObject({ state: 'RESOLVED', resolutionReviewTaskId: 'repair:build-1:1:task:review' });
    expect(moved(addressed, 'REVIEWER_MAINTAINED')).toMatchObject({ state: 'OPEN', lastMove: 'REVIEWER_MAINTAINED' });
    expect(moved(addressed, 'REVIEWER_SUPERSEDED', { supersededByFindingId: 'finding:evidence-9' }))
      .toMatchObject({ state: 'SUPERSEDED', supersededByFindingId: 'finding:evidence-9' });
  });

  it.each([
    ['a repair with no task named', 'REPAIR_SUCCEEDED', { repairTaskId: '' }, 'finding_addressed_requires_repair'],
    ['a resolution with no review named', 'REVIEWER_RESOLVED', { reviewTaskId: '' }, 'finding_resolution_requires_review'],
    ['a supersession with no replacement', 'REVIEWER_SUPERSEDED', {}, 'finding_supersession_requires_replacement'],
    ['a supersession by itself', 'REVIEWER_SUPERSEDED', { supersededByFindingId: 'finding:evidence-1' }, 'finding_supersession_requires_replacement'],
  ] as const)('refuses %s', (_label, kind, over, reasonCode) => {
    expect(move(open(), kind, over as Record<string, string>)).toEqual({ outcome: 'REFUSED', reasonCode });
  });

  it('refuses a repeated move and anything at all after a terminal state', () => {
    expect(move(open(), 'REVIEWER_MAINTAINED')).toEqual({ outcome: 'REFUSED', reasonCode: 'finding_move_repeated' });
    const addressed = moved(open(), 'REPAIR_SUCCEEDED');
    expect(move(addressed, 'REPAIR_SUCCEEDED')).toEqual({ outcome: 'REFUSED', reasonCode: 'finding_move_repeated' });
    const resolved = moved(addressed, 'REVIEWER_RESOLVED');
    for (const kind of JULIUS_FINDING_MOVES) {
      expect(move(resolved, kind, { supersededByFindingId: 'finding:evidence-9' }).outcome, kind).toBe('REFUSED');
    }
    const superseded = moved(addressed, 'REVIEWER_SUPERSEDED', { supersededByFindingId: 'finding:evidence-9' });
    expect(move(superseded, 'REVIEWER_RESOLVED').outcome).toBe('REFUSED');
  });

  it('a second repair round addresses it again once a reviewer has reopened it', () => {
    const reopened = moved(moved(moved(open(), 'REPAIR_SUCCEEDED'), 'REVIEWER_MAINTAINED'), 'REPAIR_SUCCEEDED', { repairTaskId: 'repair:build-1:2:task' });
    expect(reopened.repairTaskIds).toEqual(['repair:build-1:1:task', 'repair:build-1:2:task']);
    expect(reopened.state).toBe('ADDRESSED');
  });

  it('is outstanding while it is open or merely addressed', () => {
    expect(juliusFindingIsOutstanding(open())).toBe(true);
    expect(juliusFindingIsOutstanding(moved(open(), 'REPAIR_SUCCEEDED'))).toBe(true);
    expect(juliusFindingIsOutstanding(moved(moved(open(), 'REPAIR_SUCCEEDED'), 'REVIEWER_RESOLVED'))).toBe(false);
    expect(juliusFindingIsOutstanding({ ...open(), blocking: false }), 'a warning is not outstanding work').toBe(false);
  });
});

describe('the life is a fold over the rows', () => {
  const rows = [
    { type: 'finding.recorded', facts: { findingId: FINDING.findingId, reviewTaskId: 'build-1:review' } },
    { type: 'finding.transitioned', facts: juliusFindingTransitionFacts({ findingId: FINDING.findingId, move: 'REPAIR_SUCCEEDED', at: 't1', repairTaskId: 'repair:build-1:1:task' }) },
    { type: 'finding.transitioned', facts: juliusFindingTransitionFacts({ findingId: FINDING.findingId, move: 'REVIEWER_RESOLVED', at: 't2', reviewTaskId: 'repair:build-1:1:task:review' }) },
  ];

  it('reaches the state the moves reach, and carries the origin review', () => {
    const [life] = foldJuliusFindings([FINDING], rows);
    expect(life).toMatchObject({
      state: 'RESOLVED', originReviewTaskId: 'build-1:review',
      repairTaskIds: ['repair:build-1:1:task'], resolutionReviewTaskId: 'repair:build-1:1:task:review',
    });
  });

  it('ignores a replayed row, a row for a finding nobody recorded, and a move that is not legal now', () => {
    const noisy = [
      ...rows, ...rows,
      { type: 'finding.transitioned', facts: juliusFindingTransitionFacts({ findingId: 'finding:nobody', move: 'REVIEWER_RESOLVED', at: 't', reviewTaskId: 'r' }) },
      { type: 'finding.transitioned', facts: juliusFindingTransitionFacts({ findingId: FINDING.findingId, move: 'REVIEWER_MAINTAINED', at: 't3', reviewTaskId: 'r' }) },
    ];
    expect(foldJuliusFindings([FINDING], noisy)).toEqual(foldJuliusFindings([FINDING], rows));
  });

  it('survives a JSON round trip, as an evidence bundle carries it', () => {
    expect(foldJuliusFindings([FINDING], JSON.parse(JSON.stringify(rows)))).toEqual(foldJuliusFindings([FINDING], rows));
  });

  it('a finding with no rows at all is simply open', () => {
    expect(foldJuliusFindings([FINDING], [])[0]).toMatchObject({ state: 'OPEN', originReviewTaskId: null });
  });
});

describe('the repair-round comparison is bounded and structural', () => {
  const lives = [moved(open(), 'REPAIR_SUCCEEDED')];
  const evidence = [
    { taskId: 'build-1', type: 'TEST', status: 'FAILED', safeSummary: 'render_null fails' },
    { taskId: 'repair:build-1:1:task', type: 'TEST', status: 'PASSED', safeSummary: 'render_null passes' },
    { taskId: 'other-1', type: 'TEST', status: 'PASSED', safeSummary: 'not this unit' },
  ];
  const diff = juliusRepairRoundDiff({
    repairTaskId: 'repair:build-1:1:task', repairedTaskId: 'build-1', round: 1,
    findings: lives, evidence, repairSummary: 'Rendered NULL as an empty field.',
  });

  it('shows both rounds, computes what moved, and excludes other work', () => {
    expect(diff.before.map((item) => item.safeSummary)).toEqual(['render_null fails']);
    expect(diff.after.map((item) => item.safeSummary)).toEqual(['render_null passes']);
    expect(diff.gainedTypes).toEqual(['TEST:PASSED']);
    expect(diff.lostTypes).toEqual(['TEST:FAILED']);
    expect(JSON.stringify(diff)).not.toContain('not this unit');
  });

  it('names each finding by the identity the reviewer must answer with', () => {
    const text = renderJuliusRepairRoundDiff(diff);
    expect(text).toContain('finding:evidence-1');
    expect(text).toContain('[ADDRESSED, HIGH, missed_acceptance_criterion, criterion AC-1]');
    expect(text).toContain('A finding you do not answer stays exactly as it is.');
  });

  it('is a comparison, not a transcript: everything is capped', () => {
    const many = juliusRepairRoundDiff({
      repairTaskId: 'repair:build-1:1:task', repairedTaskId: 'build-1', round: 2,
      findings: Array.from({ length: 40 }, (_, index) => ({ ...lives[0]!, findingId: `finding:${index}`, claim: 'c'.repeat(900) })),
      evidence: Array.from({ length: 60 }, (_, index) => ({ taskId: index % 2 === 0 ? 'build-1' : 'repair:build-1:1:task', type: 'TEST', status: 'PASSED', safeSummary: 's'.repeat(900) })),
      repairSummary: 'r'.repeat(900),
    });
    expect(many.findings).toHaveLength(JULIUS_REPAIR_ROUND_LIMITS.findings);
    expect(many.before.length).toBeLessThanOrEqual(JULIUS_REPAIR_ROUND_LIMITS.evidencePerRound);
    expect(many.after.length).toBeLessThanOrEqual(JULIUS_REPAIR_ROUND_LIMITS.evidencePerRound);
    expect(many.findings.every((finding) => finding.claim.length <= JULIUS_REPAIR_ROUND_LIMITS.claimChars)).toBe(true);
    expect(many.repairSummary!.length).toBeLessThanOrEqual(JULIUS_REPAIR_ROUND_LIMITS.summaryChars);
    expect(renderJuliusRepairRoundDiff(many).length).toBeLessThanOrEqual(JULIUS_REPAIR_ROUND_LIMITS.totalChars);
  });

  it('says plainly when a round was admitted on failed evidence rather than on a finding', () => {
    const none = juliusRepairRoundDiff({ repairTaskId: 'r', repairedTaskId: 'build-1', round: 1, findings: [], evidence });
    expect(renderJuliusRepairRoundDiff(none)).toContain('admitted on failed evidence rather than on a finding');
  });

  it('every transition row fits the event validator', () => {
    const facts = juliusFindingTransitionFacts({
      findingId: `finding:${'f'.repeat(180)}`, move: 'REVIEWER_SUPERSEDED', at: '2026-09-16T00:00:00.000Z',
      reviewTaskId: `review:${'r'.repeat(180)}`, repairTaskId: `repair:${'p'.repeat(180)}`, supersededByFindingId: `finding:${'g'.repeat(180)}`,
    });
    expect(() => validateJuliusEvent({
      eventId: 'e', runId: 'r', projectId: 'p', type: 'finding.transitioned', taskId: null, workerId: null,
      correlationId: 'c', causationId: null, occurredAt: 't', facts: { ...facts, owner: 'o' },
    })).not.toThrow();
  });
});
