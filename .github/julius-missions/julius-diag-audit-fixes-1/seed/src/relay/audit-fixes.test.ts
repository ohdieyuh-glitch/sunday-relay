import { test } from 'node:test';
import assert from 'node:assert/strict';

import { projectReviewLedger, openBlockingFindings } from './mission/review-repair.ts';
import { detectNoProgress } from './recovery/detection.ts';
import { acquireResourceClaim } from './coordination/claims.ts';

/**
 * THREE LATENT DEFECTS FOUND BY AN AUDIT — THE SPECIFICATION.
 *
 * Each of the three modules below is real Relay code with a documented intent and a behaviour that does not match it. Each group of tests
 * pins the main behaviours of ONE fix; the acceptance criteria in the contract state the wider invariants in words. The modules do not
 * depend on one another, so the fixes are independent.
 *
 *   A. `projectReviewLedger` (mission/review-repair.ts). The file's header says a finding is resolved only by supporting evidence PLUS "a
 *      required re-review approval". The code computes ONE flag for the whole sequence ("is there any approved review after the first?") and
 *      uses it for every blocking finding wherever in the sequence it was raised, so an approval that came BEFORE a finding can resolve it,
 *      and the finding's `resolutionReviewId` is then computed from a search that finds nothing.
 *   B. `detectNoProgress` (recovery/detection.ts). It reports `identical-diff` / `identical-failure` / `identical-report` with a bare `===`,
 *      so two attempts that BOTH LACK a fingerprint are reported as having an identical one. The record then names evidence that does not exist.
 *   C. `acquireResourceClaim` (coordination/claims.ts). A task that already holds an active claim on a resource is handed it back as
 *      `idempotent` whatever mode it asks for, so a task holding a SHARED claim that asks for EXCLUSIVE is told it has exclusivity while other
 *      tasks may still share the resource. Its sibling `acquireFileClaim` already handles the mode.
 */

/* ----------------------------------------------------------------------------------------------------------------- A: the review ledger */

const NOW = '2026-10-19T00:00:00.000Z';
const finding = (id: string, severity = 'major') => ({ id, severity, title: `finding ${id}`, detail: `detail ${id}` });
const review = (verdict: 'approved' | 'changes_requested', findings: ReturnType<typeof finding>[] = []) => ({
  attempt: 1, verdict, reviewerAgentId: 'rev-1', requestedReviewerAgentId: 'rev-1', independent: true, provenance: 'adapter-reported' as const, findings,
});
const project = (reviews: ReturnType<typeof review>[], over: Record<string, unknown> = {}) => projectReviewLedger({
  missionId: 'm1', taskId: 't1', reviewerRunId: 'run1', missionRevision: 1, taskRevision: 0, workspaceRevision: 'w1',
  originalClaimedFiles: ['src/a.ts'], affectedCriterionIds: ['c1'], reviews, postRepairEvidenceIds: ['ev1'], repairDispatched: true,
  maxRepairIterations: 3, now: NOW, ...over,
} as never);

test('A: the ordinary two-review case is unchanged: a finding is resolved by the approving re-review after it', () => {
  const ledger = project([review('changes_requested', [finding('x')]), review('approved')]);
  assert.equal(ledger.findings.length, 1);
  const [f] = ledger.findings;
  assert.equal(f!.status, 'resolved');
  assert.equal(f!.resolutionReviewId, 'rvw_2');
  assert.equal(f!.resolvedAt, NOW);
  assert.deepEqual(f!.resolutionEvidenceIds, ['ev1']);
  assert.equal(ledger.repairs[0]!.status, 'resolved');
  assert.equal(openBlockingFindings(ledger.findings).length, 0);
});

test('A: a blocking finding raised AFTER the last approval is NOT resolved by an earlier approval', () => {
  const ledger = project([review('changes_requested', [finding('a')]), review('approved'), review('changes_requested', [finding('b')])]);
  const [first, second] = ledger.findings;
  assert.equal(first!.status, 'resolved');
  assert.equal(first!.resolutionReviewId, 'rvw_2');
  assert.equal(second!.status, 'in_repair', 'the third review reopened the work; the earlier approval cannot resolve its finding');
  assert.equal(second!.resolutionReviewId, null);
  assert.equal(second!.resolvedAt, null);
  assert.deepEqual(second!.resolutionEvidenceIds, []);
  assert.equal(openBlockingFindings(ledger.findings).length, 1);
});

test('A: the repair linked to an unresolved finding is not marked resolved either', () => {
  const ledger = project([review('changes_requested', [finding('a')]), review('approved'), review('changes_requested', [finding('b')])]);
  assert.equal(ledger.repairs.length, 2);
  assert.equal(ledger.repairs[0]!.status, 'resolved');
  assert.equal(ledger.repairs[1]!.status, 'claimed');
  assert.equal(ledger.repairs[1]!.resolvedAt, null);
  assert.deepEqual(ledger.repairs[1]!.evidenceIds, []);
});

test('A: several changes_requested reviews before one approval: every earlier finding is resolved by THAT approval', () => {
  const ledger = project([review('changes_requested', [finding('a')]), review('changes_requested', [finding('b')]), review('approved')]);
  assert.deepEqual(ledger.findings.map((f) => [f.status, f.resolutionReviewId]), [['resolved', 'rvw_3'], ['resolved', 'rvw_3']]);
});

test('A: with two approvals, each finding names the FIRST approval after the review that raised it', () => {
  const ledger = project([
    review('changes_requested', [finding('a')]), review('approved'), review('changes_requested', [finding('b')]), review('approved'),
  ]);
  assert.deepEqual(ledger.findings.map((f) => [f.status, f.resolutionReviewId]), [['resolved', 'rvw_2'], ['resolved', 'rvw_4']]);
});

test('A: no approval after a finding, no repair dispatched, or no post-repair evidence: nothing is resolved, and no resolution id is ever invented', () => {
  for (const over of [{ repairDispatched: false }, { postRepairEvidenceIds: [] }]) {
    const ledger = project([review('changes_requested', [finding('a')]), review('approved')], over);
    assert.equal(ledger.findings[0]!.status, 'in_repair');
    assert.equal(ledger.findings[0]!.resolutionReviewId, null);
  }
  const noApproval = project([review('changes_requested', [finding('a')]), review('changes_requested', [finding('b')])]);
  assert.deepEqual(noApproval.findings.map((f) => [f.status, f.resolutionReviewId]), [['in_repair', null], ['in_repair', null]]);
  for (const f of project([review('changes_requested', [finding('a')]), review('approved')]).findings) assert.notEqual(f.resolutionReviewId, 'rvw_0');
});

test('A: minor findings and ids are unchanged', () => {
  const ledger = project([review('changes_requested', [finding('a', 'minor'), finding('b')]), review('approved')]);
  assert.deepEqual(ledger.findings.map((f) => [f.findingId, f.blocking, f.status, f.repairTaskId]), [
    ['F-1', false, 'open', null], ['F-2', true, 'resolved', 'R-1'],
  ]);
  assert.deepEqual(ledger.reviews.map((r) => r.reviewId), ['rvw_1', 'rvw_2']);
  assert.equal(ledger.repairIterationsUsed, 1);
  assert.equal(ledger.limitExceeded, false);
});

/* ------------------------------------------------------------------------------------------------------------- B: no-progress signals */

const attempt = (over: Record<string, unknown> = {}) => ({ evidenceIds: [], blockingFindingIds: [], ...over });

test('B: two attempts that both LACK a diff fingerprint but share a failure fingerprint report ONLY identical-failure', () => {
  const result = detectNoProgress(attempt({ failureFingerprint: 'ff_1' }) as never, attempt({ failureFingerprint: 'ff_1' }) as never);
  assert.equal(result.outcome, 'no_progress');
  assert.deepEqual(result.signals, ['identical-failure']);
});

test('B: every identical signal needs the fingerprint to be PRESENT and equal on both attempts', () => {
  const diffOnly = detectNoProgress(attempt({ diffFingerprint: 'd1' }) as never, attempt({ diffFingerprint: 'd1' }) as never);
  assert.deepEqual(diffOnly.signals, ['identical-diff']);
  const reportOnly = detectNoProgress(attempt({ reportPayloadFingerprint: 'r1' }) as never, attempt({ reportPayloadFingerprint: 'r1' }) as never);
  assert.deepEqual(reportOnly.signals, ['identical-report']);
  const all = detectNoProgress(
    attempt({ diffFingerprint: 'd', failureFingerprint: 'f', reportPayloadFingerprint: 'r' }) as never,
    attempt({ diffFingerprint: 'd', failureFingerprint: 'f', reportPayloadFingerprint: 'r', onlyUnsupportedClaims: true }) as never,
  );
  assert.deepEqual(all.signals, ['identical-diff', 'identical-failure', 'identical-report', 'only-unsupported-claims']);
});

test('B: a fingerprint present on one attempt and absent on the other is not an identical signal, and the other outcomes are unchanged', () => {
  const half = detectNoProgress(attempt({ diffFingerprint: 'd1', failureFingerprint: 'f' }) as never, attempt({ failureFingerprint: 'f' }) as never);
  assert.deepEqual(half.signals, ['identical-failure']);
  assert.equal(detectNoProgress(null, attempt() as never).outcome, 'insufficient_data');
  assert.equal(detectNoProgress(attempt() as never, attempt() as never).outcome, 'insufficient_data');
  const progress = detectNoProgress(attempt({ diffFingerprint: 'd1' }) as never, attempt({ diffFingerprint: 'd2' }) as never);
  assert.equal(progress.outcome, 'progress');
  assert.deepEqual(progress.signals, ['new-diff']);
});

/* -------------------------------------------------------------------------------------------------------------------- C: resource claims */

const ids = () => { let n = 0; return { next: (prefix: string) => `${prefix}_${++n}` } as never; };
const claim = (over: Record<string, unknown>) => ({
  claimId: 'clm_x', taskId: 't1', resource: 'db', mode: 'shared', claimedAt: '2026-10-19T00:00:00.000Z', expiresAt: '2026-10-19T01:00:00.000Z', status: 'active', ...over,
});
const acquire = (mode: 'exclusive' | 'shared', existing: unknown[], taskId = 't1') => acquireResourceClaim({
  taskId: taskId as never, resource: 'db', mode, existing: existing as never, ids: ids(), now: '2026-10-19T00:30:00.000Z', leaseMs: 60_000,
});

test('C: a task holding a SHARED claim that asks for EXCLUSIVE with no other holder gets a NEW exclusive claim, not its shared one back', () => {
  const result = acquire('exclusive', [claim({ claimId: 'clm_own', mode: 'shared' })]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.idempotent, false);
  assert.equal(result.value.claim.mode, 'exclusive');
  assert.notEqual(result.value.claim.claimId, 'clm_own');
  assert.equal(result.value.claim.taskId, 't1');
});

test('C: the same upgrade while another task shares the resource FAILS and names the other holder', () => {
  const result = acquire('exclusive', [claim({ claimId: 'clm_own', mode: 'shared' }), claim({ claimId: 'clm_other', taskId: 't2', mode: 'shared' })]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'duplicate-task');
  assert.ok((result.error.details ?? []).some((d) => d.includes('t2')), 'the holder is named');
});

test('C: a claim that already satisfies the request is returned as idempotent (same mode, or exclusive when shared is asked)', () => {
  const same = acquire('shared', [claim({ claimId: 'clm_own', mode: 'shared' })]);
  assert.equal(same.ok && same.value.idempotent, true);
  assert.equal(same.ok && same.value.claim.claimId, 'clm_own');
  const stronger = acquire('shared', [claim({ claimId: 'clm_own', mode: 'exclusive' })]);
  assert.equal(stronger.ok && stronger.value.idempotent, true);
  assert.equal(stronger.ok && stronger.value.claim.claimId, 'clm_own');
});

test('C: an expired or released claim of the same task is ignored, other resources are unaffected, and shared claims coexist', () => {
  const expired = acquire('exclusive', [claim({ mode: 'shared', expiresAt: '2026-10-19T00:10:00.000Z' })]);
  assert.equal(expired.ok && expired.value.idempotent, false);
  const released = acquire('exclusive', [claim({ mode: 'shared', status: 'released' })]);
  assert.equal(released.ok && released.value.idempotent, false);
  const otherResource = acquire('exclusive', [claim({ taskId: 't2', resource: 'cache', mode: 'exclusive' })]);
  assert.equal(otherResource.ok, true);
  const coexist = acquire('shared', [claim({ taskId: 't2', mode: 'shared' })]);
  assert.equal(coexist.ok && coexist.value.idempotent, false);
  assert.equal(coexist.ok && coexist.value.claim.mode, 'shared');
});

test('C: when the task holds BOTH a shared and an exclusive claim, an exclusive request returns the EXCLUSIVE one, in either list order', () => {
  for (const existing of [
    [claim({ claimId: 'clm_s', mode: 'shared' }), claim({ claimId: 'clm_e', mode: 'exclusive' })],
    [claim({ claimId: 'clm_e', mode: 'exclusive' }), claim({ claimId: 'clm_s', mode: 'shared' })],
  ]) {
    const result = acquire('exclusive', existing);
    assert.equal(result.ok && result.value.idempotent, true);
    assert.equal(result.ok && result.value.claim.claimId, 'clm_e');
  }
});

test('C: a shared request with two satisfying own claims returns the FIRST of them in list order, whichever mode that one has', () => {
  const sharedFirst = acquire('shared', [claim({ claimId: 'clm_s', mode: 'shared' }), claim({ claimId: 'clm_e', mode: 'exclusive' })]);
  assert.equal(sharedFirst.ok && sharedFirst.value.idempotent, true);
  assert.equal(sharedFirst.ok && sharedFirst.value.claim.claimId, 'clm_s');
  const exclusiveFirst = acquire('shared', [claim({ claimId: 'clm_e', mode: 'exclusive' }), claim({ claimId: 'clm_s', mode: 'shared' })]);
  assert.equal(exclusiveFirst.ok && exclusiveFirst.value.idempotent, true);
  assert.equal(exclusiveFirst.ok && exclusiveFirst.value.claim.claimId, 'clm_e', 'an exclusive claim satisfies a shared request, and it comes first');
});

test('B: attempts that are comparable but share no fingerprint and show no progress are still no_progress, with an EMPTY signal list (unchanged outcome)', () => {
  const result = detectNoProgress(attempt({ reportPayloadFingerprint: 'r1' }) as never, attempt({ reportPayloadFingerprint: 'r2' }) as never);
  assert.equal(result.outcome, 'no_progress');
  assert.deepEqual(result.signals, []);
  assert.equal(result.safeSummary, 'No material change: .');
});
