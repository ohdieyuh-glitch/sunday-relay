import { describe, expect, it } from 'vitest';

import {
  CAPSULE_T1,
  CAPSULE_T2,
  CAPSULE_T3,
  CAPSULE_T4,
  CLAUDE_ACTUAL,
  claudeImplementationInput,
  codexReviewInput,
  CODEX_ACTUAL,
  CODEX_REQUESTED,
  failedAttestation,
  finalReport,
  MOCK_WRAPPER_ACTUAL,
  observedOtherRuntimeAttestation,
  prepareFixture,
  runningFixture,
} from './capsule-fixtures';
import { deriveCostState } from './capsule-evidence';
import { evaluateReviewCredit } from './capsule-identity';
import {
  attachCostReceiptId,
  attachEvidenceId,
  attachLaunchAttestation,
  markCompleted,
  recordLaunchRequested,
} from './capsule-service';
import { capsuleCostState } from './capsule-types';

const running = () => runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);

describe('evidence references', () => {
  it('appends evidence ids in order and keeps them attributed to the capsule', () => {
    let capsule = running();
    for (const evidenceId of ['ev-diff-1', 'ev-tests-1']) {
      const result = attachEvidenceId(capsule, evidenceId, CAPSULE_T3);
      if (!result.ok) throw new Error(result.error.reason);
      capsule = result.value;
    }
    expect(capsule.evidenceIds).toEqual(['ev-diff-1', 'ev-tests-1']);
    expect(capsule.runId).toBe('run-claude-1');
    expect(capsule.capsuleId).toBe('cap-claude-impl');
  });

  it('rejects a duplicate evidence id and leaves the capsule unchanged', () => {
    const first = attachEvidenceId(running(), 'ev-diff-1', CAPSULE_T3);
    if (!first.ok) throw new Error('setup failed');
    const duplicate = attachEvidenceId(first.value, 'ev-diff-1', CAPSULE_T3);
    expect(!duplicate.ok && duplicate.error.code).toBe('DUPLICATE_EVIDENCE_REFERENCE');
    expect(first.value.evidenceIds).toEqual(['ev-diff-1']);
  });

  it('evidence cannot be attached to a terminal capsule', () => {
    const completed = markCompleted(running(), {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-claude'),
    });
    if (!completed.ok) throw new Error('setup failed');
    const result = attachEvidenceId(completed.value, 'ev-late', CAPSULE_T4);
    expect(!result.ok && result.error.code).toBe('TERMINAL_CAPSULE_IMMUTABLE');
  });
});

describe('review credit and evidence attribution', () => {
  it('a verified reviewer capsule links its findings to the reviewer run', () => {
    const reviewer = runningFixture(codexReviewInput(), CODEX_ACTUAL);
    const withFinding = attachEvidenceId(reviewer, 'finding-auth-1', CAPSULE_T3);
    expect(withFinding.ok).toBe(true);
    if (!withFinding.ok) return;
    expect(withFinding.value.taskId).toBe('task-auth-review');
    expect(withFinding.value.runId).toBe('run-codex-1');
    const credit = evaluateReviewCredit(withFinding.value.identity, 'review');
    expect(credit.eligible).toBe(true);
    expect(credit.creditedAgentId).toBe('agent-codex');
  });

  it('a repair capsule keeps its evidence attributable to the repair run', () => {
    const repair = attachEvidenceId(running(), 'ev-repair-diff', CAPSULE_T3);
    expect(repair.ok).toBe(true);
    if (!repair.ok) return;
    expect(repair.value.binding.responsibility).toBe('repair');
    expect(repair.value.evidenceIds).toContain('ev-repair-diff');
  });

  it('evidence from an unverified launch is never credited to the requested agent', () => {
    const prepared = prepareFixture(codexReviewInput());
    const starting = recordLaunchRequested(prepared, CAPSULE_T1);
    if (!starting.ok) throw new Error('setup failed');
    const failed = attachLaunchAttestation(starting.value, {
      attestation: failedAttestation('cap-codex-review', CODEX_REQUESTED, 'binary not found'),
      at: CAPSULE_T2,
    });
    if (!failed.ok) throw new Error('setup failed');
    const withEvidence = attachEvidenceId(failed.value, 'ev-orphan', CAPSULE_T3);
    expect(withEvidence.ok).toBe(true);
    if (!withEvidence.ok) return;
    // The evidence exists on the capsule, but no reviewer credit follows.
    expect(evaluateReviewCredit(withEvidence.value.identity, 'review').eligible).toBe(false);
  });

  it('wrapper output can never be credited as the requested reviewer', () => {
    const prepared = prepareFixture(codexReviewInput());
    const starting = recordLaunchRequested(prepared, CAPSULE_T1);
    if (!starting.ok) throw new Error('setup failed');
    const wrapper = attachLaunchAttestation(starting.value, {
      attestation: observedOtherRuntimeAttestation('cap-codex-review', CODEX_REQUESTED, MOCK_WRAPPER_ACTUAL),
      actualAgent: MOCK_WRAPPER_ACTUAL,
      at: CAPSULE_T2,
    });
    if (!wrapper.ok) throw new Error('setup failed');
    const credit = evaluateReviewCredit(wrapper.value.identity, 'review');
    expect(credit.eligible).toBe(false);
    expect(credit.creditedAgentId).toBeUndefined();
  });

  it('a completed review capsule does not itself set mission verification', () => {
    const reviewer = runningFixture(codexReviewInput(), CODEX_ACTUAL);
    const completed = markCompleted(reviewer, {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-codex', { reportFormat: 'relay-review-report/1' }),
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    // The capsule carries no verification/outcome/release field at all — the
    // only status it owns is its own process status.
    expect(Object.keys(completed.value)).not.toContain('verificationStatus');
    expect(Object.keys(completed.value)).not.toContain('outcomeStatus');
    expect(Object.keys(completed.value)).not.toContain('releaseStatus');
    expect(completed.value.status).toBe('completed');
  });
});

describe('cost receipt references', () => {
  it('missing cost data stays PENDING — never $0', () => {
    const capsule = running();
    expect(capsule.costReceiptIds).toEqual([]);
    expect(capsuleCostState(capsule)).toBe('pending');
    expect(deriveCostState([])).toBe('pending');
    // No total, no estimate, no zero anywhere on the record.
    expect(JSON.stringify(capsule)).not.toContain('costUsd');
    expect(JSON.stringify(capsule)).not.toContain('totalUsd');
  });

  it('appends receipt ids and rejects duplicates', () => {
    const first = attachCostReceiptId(running(), 'receipt-1', CAPSULE_T4);
    if (!first.ok) throw new Error('setup failed');
    expect(capsuleCostState(first.value)).toBe('receipts_attached');
    const duplicate = attachCostReceiptId(first.value, 'receipt-1', CAPSULE_T4);
    expect(!duplicate.ok && duplicate.error.code).toBe('DUPLICATE_COST_RECEIPT_REFERENCE');
    expect(first.value.costReceiptIds).toEqual(['receipt-1']);
  });

  it('receipts may still be reconciled AFTER a run ends (economics arrives later)', () => {
    const completed = markCompleted(running(), {
      at: CAPSULE_T4,
      finalReport: finalReport('agent-claude'),
    });
    if (!completed.ok) throw new Error('setup failed');
    const reconciled = attachCostReceiptId(completed.value, 'receipt-post-run', CAPSULE_T4);
    expect(reconciled.ok).toBe(true);
    if (!reconciled.ok) return;
    expect(reconciled.value.status).toBe('completed');
    expect(reconciled.value.costReceiptIds).toEqual(['receipt-post-run']);
  });

  it('the capsule performs no pricing lookup and no aggregation', () => {
    const withReceipts = attachCostReceiptId(running(), 'receipt-a', CAPSULE_T4);
    if (!withReceipts.ok) throw new Error('setup failed');
    const both = attachCostReceiptId(withReceipts.value, 'receipt-b', CAPSULE_T4);
    if (!both.ok) throw new Error('setup failed');
    // Only ids — no amounts, no sums, no currency.
    expect(both.value.costReceiptIds).toEqual(['receipt-a', 'receipt-b']);
    expect(capsuleCostState(both.value)).toBe('receipts_attached');
  });
});
