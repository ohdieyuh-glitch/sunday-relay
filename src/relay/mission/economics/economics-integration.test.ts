import { describe, expect, it } from 'vitest';

/**
 * Trace, capsule, and command-protocol integration. Economics reads those
 * domains through their public boundaries and writes to none of them.
 */

import {
  RELAY_ECONOMICS_TRACE_EVENT_TYPES,
  adaptAdjustmentRecorded,
  adaptBudgetApprovalRequired,
  adaptBudgetCreated,
  adaptBudgetHardLimitReached,
  adaptBudgetIncreaseApproved,
  adaptBudgetWarningReached,
  adaptEconomicsRecalculated,
  adaptReceiptCreated,
  adaptReceiptDisputed,
  adaptReceiptFinalized,
  adaptReceiptVoided,
  adaptVerifiedMissionCost,
  buildBudgetChangePreview,
  capsuleReceiptIds,
} from './economics-trace-adapter';
import { evaluateMissionBudget } from './budget-evaluation';
import { aggregateMissionEconomics } from './economics-aggregation';
import { applyApprovedIncrease, createBudgetApproval } from './budget-types';
import { createAdjustment, disputeReceipt, voidReceipt } from './cost-receipt-service';
import {
  budget,
  ECON_T2,
  ECON_T3,
  FIXTURE_MISSION,
  FIXTURE_PROJECT,
  FIXTURE_REVISION,
  hardLimitReceipts,
  receipt,
  secretShapedReceiptMetadata,
  underBudgetReceipts,
  usd,
  verifiedMissionReceipts,
  warningReceipts,
} from './economics-fixtures';
import { amountLabel } from './economics-projection';
import { createInitialAqualaOutcomeStatus } from '../status/status-model';
import { isKnownTraceEventType, familyForEventType } from '../trace/trace-event-types';
import { appendTraceEvent, createTrace } from '../trace/trace-ledger';
import { InMemoryTraceRepository } from '../trace/trace-repository';
import { verifyTraceIntegrity } from '../trace/trace-integrity';
import { attachCostReceiptId } from '../execution-capsules/capsule-service';
import {
  CAPSULE_T4,
  CLAUDE_ACTUAL,
  claudeImplementationInput,
  runningFixture,
} from '../execution-capsules/capsule-fixtures';

const traceOptions = (eventId: string) => ({
  traceId: 'trace-econ-1',
  eventId,
  occurredAt: ECON_T3,
});

function evaluationFor(receipts = underBudgetReceipts(), over = {}) {
  return evaluateMissionBudget({
    budget: budget(over),
    receipts,
    missionId: FIXTURE_MISSION,
  });
}

describe('economics trace event types', () => {
  it('registers all twelve economics event types in the Milestone 4 registry', () => {
    expect(RELAY_ECONOMICS_TRACE_EVENT_TYPES).toHaveLength(12);
    for (const eventType of RELAY_ECONOMICS_TRACE_EVENT_TYPES) {
      expect(isKnownTraceEventType(eventType), eventType).toBe(true);
      expect(['economics', 'approval']).toContain(familyForEventType(eventType));
    }
  });
});

describe('trace drafts', () => {
  const sample = () => receipt({ receiptId: 'r-trace', amount: usd('1.00'), actualAgentId: 'agent-claude' });

  it.each([
    ['created', adaptReceiptCreated, 'cost_receipt_created'],
    ['finalized', adaptReceiptFinalized, 'cost_receipt_finalized'],
    ['disputed', adaptReceiptDisputed, 'cost_receipt_disputed'],
    ['voided', adaptReceiptVoided, 'cost_receipt_voided'],
    ['adjustment', adaptAdjustmentRecorded, 'cost_adjustment_recorded'],
  ] as const)('builds a receipt-%s draft', (_label, adapt, eventType) => {
    const draft = adapt(sample(), traceOptions(`evt-${eventType}`));
    expect(draft.eventType).toBe(eventType);
    expect(draft.eventFamily).toBe('economics');
    expect(draft.missionRevision).toBe(FIXTURE_REVISION);
    expect(draft.metadata.receiptId).toBe('r-trace');
    expect(draft.metadata.amountMicros).toBe('1000000');
    expect(draft.metadata.currency).toBe('USD');
  });

  it('builds budget drafts carrying status and limits, not credentials', () => {
    const b = budget();
    const evaluation = evaluationFor(warningReceipts());

    const created = adaptBudgetCreated(b, traceOptions('evt-bc'));
    expect(created.eventType).toBe('mission_budget_created');
    expect(created.metadata.budgetId).toBe('budget-auth-1');
    expect(created.metadata.totalLimit).toBe('10000000');

    const warning = adaptBudgetWarningReached(b, evaluation, traceOptions('evt-bw'));
    expect(warning.eventType).toBe('mission_budget_warning_reached');
    expect(warning.metadata.projectedTotal).toBe('8250000');

    const approval = adaptBudgetApprovalRequired(b, evaluation, traceOptions('evt-ba'));
    expect(approval.eventType).toBe('mission_budget_approval_required');
    expect(approval.eventFamily).toBe('economics');

    const hard = adaptBudgetHardLimitReached(b, evaluationFor(hardLimitReceipts()), traceOptions('evt-bh'));
    expect(hard.eventType).toBe('mission_budget_hard_limit_reached');
  });

  it('builds an approved-increase draft naming requester and approver', () => {
    const b = budget();
    const approval = createBudgetApproval({
      approvalId: 'approval-1',
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION,
      budgetId: b.budgetId,
      previousLimit: b.totalLimit,
      approvedLimit: usd('20.00'),
      reason: 'the repair pass needs headroom',
      requestedByActorId: 'agent-claude',
      approvedByActorId: 'user-founder',
      requestedAt: ECON_T2,
      approvedAt: ECON_T3,
      commandId: 'cmd-budget-1',
      policyVersion: b.policyVersion,
    });
    if (!approval.ok) throw new Error(approval.error.reason);

    const draft = adaptBudgetIncreaseApproved(b, approval.value, traceOptions('evt-bi'));
    expect(draft.eventType).toBe('mission_budget_increase_approved');
    expect(draft.metadata.approvalId).toBe('approval-1');
    expect(draft.metadata.previousLimit).toBe('10000000');
    expect(draft.metadata.approvedLimit).toBe('20000000');
    expect(draft.metadata.approvedByActorId).toBe('user-founder');
  });

  it('emits a verified-mission-cost draft ONLY when the cost was earned', () => {
    const evaluation = evaluationFor(verifiedMissionReceipts());
    const unverified = aggregateMissionEconomics({
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION,
      receipts: verifiedMissionReceipts(),
      budgetEvaluation: evaluation,
      missionStatus: createInitialAqualaOutcomeStatus(),
      generatedAt: ECON_T3,
    });
    expect(adaptVerifiedMissionCost(unverified, traceOptions('evt-v1'))).toBeNull();

    const verified = aggregateMissionEconomics({
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION,
      receipts: verifiedMissionReceipts(),
      budgetEvaluation: evaluation,
      missionStatus: {
        ...createInitialAqualaOutcomeStatus(),
        outcomeStatus: 'satisfied',
        verificationStatus: 'verified',
      },
      generatedAt: ECON_T3,
    });
    const draft = adaptVerifiedMissionCost(verified, traceOptions('evt-v2'));
    expect(draft?.eventType).toBe('verified_mission_cost_calculated');
    expect(draft?.sourceTrust).toBe('verified');
    expect(draft?.metadata.amountMicros).toBe('1600000');
  });

  it('builds an economics-recalculated draft with counts and completeness', () => {
    const evaluation = evaluationFor();
    const economics = aggregateMissionEconomics({
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION,
      receipts: underBudgetReceipts(),
      budgetEvaluation: evaluation,
      generatedAt: ECON_T3,
    });
    const draft = adaptEconomicsRecalculated(economics, traceOptions('evt-recalc'));
    expect(draft.eventType).toBe('mission_economics_recalculated');
    expect(draft.metadata.actualTotal).toBe('2150000');
    expect(draft.metadata.completeness).toBe('complete');
  });

  it('a receipt draft carries NO credential, even when the receipt metadata had one', () => {
    const withSecrets = receipt({
      receiptId: 'r-secret',
      amount: usd('1.00'),
      actualAgentId: 'agent-claude',
      metadata: secretShapedReceiptMetadata(),
    });
    const draft = adaptReceiptCreated(withSecrets, traceOptions('evt-secret'));
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain('sk-fixture0123456789abcdefghij');
    expect(serialized).not.toContain('fixture-token-0123456789abcd');
    // The adapter carries only safe, structured fields — not raw metadata.
    expect(draft.metadata.invoice).toBeUndefined();
  });

  it('appends cleanly through the real ledger and verifies', () => {
    const repository = new InMemoryTraceRepository();
    const created = createTrace(repository, {
      traceId: 'trace-econ-1',
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      createdByActorId: 'relay-trace-service',
      createdAt: ECON_T2,
      genesisEventId: 'evt-genesis',
      retentionClassification: 'standard',
      sourceProduct: 'sunday_relay',
      sourceService: 'relay-trace-service',
    });
    if (!created.ok) throw new Error(created.error.reason);

    const appended = appendTraceEvent(repository, {
      traceId: 'trace-econ-1',
      draft: adaptReceiptFinalized(
        receipt({ receiptId: 'r-ledger', amount: usd('1.00'), actualAgentId: 'agent-claude' }),
        traceOptions('evt-ledger'),
      ),
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.value.sequence).toBe(2);
    expect(
      verifyTraceIntegrity(created.value.manifest, repository.listEvents('trace-econ-1')).valid,
    ).toBe(true);
  });
});

describe('capsule integration', () => {
  it('links receipt IDs only — never a receipt payload', () => {
    const capsuleReceipts = [
      receipt({ receiptId: 'r-cap-1', amount: usd('1.00'), actualAgentId: 'agent-claude', capsuleId: 'cap-claude-impl' }),
      receipt({ receiptId: 'r-cap-2', amount: usd('0.20'), actualAgentId: 'agent-claude', capsuleId: 'cap-claude-impl' }),
      receipt({ receiptId: 'r-other', amount: usd('0.10'), actualAgentId: 'agent-codex', capsuleId: 'cap-codex-review' }),
    ];
    const ids = capsuleReceiptIds(capsuleReceipts, 'cap-claude-impl');
    expect(ids).toEqual(['r-cap-1', 'r-cap-2']);

    const capsule = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    let next = capsule;
    for (const id of ids) {
      const attached = attachCostReceiptId(next, id, CAPSULE_T4);
      expect(attached.ok).toBe(true);
      if (!attached.ok) return;
      next = attached.value;
    }
    expect(next.costReceiptIds).toEqual(['r-cap-1', 'r-cap-2']);
    // Only ids — no amounts leaked into the capsule.
    expect(JSON.stringify(next)).not.toContain('amountMicros');
  });

  it('a duplicate link is rejected by the capsule service', () => {
    const capsule = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const first = attachCostReceiptId(capsule, 'r-dup', CAPSULE_T4);
    if (!first.ok) throw new Error('setup failed');
    const again = attachCostReceiptId(first.value, 'r-dup', CAPSULE_T4);
    expect(!again.ok && again.error.code).toBe('DUPLICATE_COST_RECEIPT_REFERENCE');
  });

  it('attaching cost changes no identity, verification, or release fact', () => {
    const capsule = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const attached = attachCostReceiptId(capsule, 'r-cost', CAPSULE_T4);
    if (!attached.ok) throw new Error('setup failed');
    expect(attached.value.identity).toEqual(capsule.identity);
    expect(attached.value.status).toBe(capsule.status);
    expect(attached.value.binding).toEqual(capsule.binding);
    expect(attached.value.finalReport).toEqual(capsule.finalReport);
  });
});

describe('command protocol integration', () => {
  it('supplies a truthful budget-change preview', () => {
    const evaluation = evaluateMissionBudget({
      budget: budget({ approvalThreshold: usd('9.00') }),
      receipts: warningReceipts(),
      missionId: FIXTURE_MISSION,
      proposedCost: usd('1.00'),
    });
    const preview = buildBudgetChangePreview(evaluation, (v) => amountLabel(v));

    expect(preview.currentFinalizedSpend).toBe('$8.25');
    expect(preview.proposedEstimatedCost).toBe('$1.00');
    expect(preview.projectedTotal).toBe('$9.25');
    expect(preview.approvalStatus).toBe('Approval required');
    expect(preview.unknownCostWarning).toBeNull();
  });

  it('never claims an exact projection when a required input is unknown', () => {
    const unknownPending = receipt({
      receiptId: 'r-unknown',
      status: 'pending',
      amount: null,
      providerUsageReferenceId: undefined,
      finalizedAt: undefined,
      actualAgentId: 'agent-claude',
    });
    const evaluation = evaluateMissionBudget({
      budget: budget(),
      receipts: [unknownPending],
      missionId: FIXTURE_MISSION,
    });
    const preview = buildBudgetChangePreview(evaluation, (v) => amountLabel(v));
    expect(preview.projectedTotal).toMatch(/lower bound/u);
    expect(preview.unknownCostWarning).toBeTruthy();
  });
});

describe('budget approval boundary', () => {
  it('an agent may never approve its own budget increase', () => {
    const result = createBudgetApproval({
      approvalId: 'approval-agent',
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION,
      budgetId: 'budget-auth-1',
      previousLimit: usd('10.00'),
      approvedLimit: usd('50.00'),
      reason: 'I need more budget',
      requestedByActorId: 'agent-claude',
      approvedByActorId: 'agent-claude',
      requestedAt: ECON_T2,
      approvedAt: ECON_T3,
      commandId: 'cmd-1',
      policyVersion: 'budget-policy-v1',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BUDGET_APPROVAL_REQUIRED');
    expect(result.error.humanApprovalRequired).toBe(true);
  });

  it('a stale approval cannot modify a newer budget, and history is preserved', () => {
    const b = budget();
    const stale = createBudgetApproval({
      approvalId: 'approval-stale',
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION - 1,
      budgetId: b.budgetId,
      previousLimit: b.totalLimit,
      approvedLimit: usd('20.00'),
      reason: 'approved against an older revision',
      requestedByActorId: 'user-founder',
      approvedByActorId: 'user-founder',
      requestedAt: ECON_T2,
      approvedAt: ECON_T3,
      commandId: 'cmd-1',
      policyVersion: b.policyVersion,
    });
    if (!stale.ok) throw new Error('setup failed');

    const applied = applyApprovedIncrease(b, stale.value, ECON_T3);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.error.code).toBe('STALE_MISSION_BUDGET_REVISION');
    expect(b.totalLimit?.amountMicros).toBe('10000000');
  });

  it('a valid approval raises the limit and records the increase in history', () => {
    const b = budget();
    const approval = createBudgetApproval({
      approvalId: 'approval-ok',
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION,
      budgetId: b.budgetId,
      previousLimit: b.totalLimit,
      approvedLimit: usd('20.00'),
      reason: 'the repair pass needs headroom',
      requestedByActorId: 'agent-claude',
      approvedByActorId: 'user-founder',
      requestedAt: ECON_T2,
      approvedAt: ECON_T3,
      commandId: 'cmd-1',
      policyVersion: b.policyVersion,
    });
    if (!approval.ok) throw new Error('setup failed');

    const applied = applyApprovedIncrease(b, approval.value, ECON_T3);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.totalLimit?.amountMicros).toBe('20000000');
    expect(applied.value.approvedIncreaseIds).toEqual(['approval-ok']);
    // The original record is untouched.
    expect(b.totalLimit?.amountMicros).toBe('10000000');
    expect(b.approvedIncreaseIds).toEqual([]);

    // The same approval cannot be applied twice.
    const again = applyApprovedIncrease(applied.value, approval.value, ECON_T3);
    expect(again.ok).toBe(false);
  });

  it('a decrease below finalized spend is refused by the evaluator contract', () => {
    // $2.15 is already finalized; a $1.00 limit would be dishonest.
    const lowered = budget({ totalLimit: usd('1.00') });
    const evaluation = evaluateMissionBudget({
      budget: lowered,
      receipts: underBudgetReceipts(),
      missionId: FIXTURE_MISSION,
    });
    expect(evaluation.hardLimitReached).toBe(true);
    expect(evaluation.blockingReasons.length).toBeGreaterThan(0);
  });
});

describe('domain purity', () => {
  it('voiding and disputing never mutate the original receipt', () => {
    const original = receipt({ receiptId: 'r-pure', amount: usd('1.00'), actualAgentId: 'agent-claude' });
    const snapshot = JSON.stringify(original);
    voidReceipt(original, 'duplicate');
    disputeReceipt(original, 'checking');
    createAdjustment({
      receiptId: 'r-pure-adj',
      original,
      amount: usd('-0.10'),
      reason: 'credit',
      occurredAt: ECON_T3,
      recordedAt: ECON_T3,
    });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('evaluation and aggregation never mutate their inputs', () => {
    const receipts = underBudgetReceipts();
    const b = budget();
    const snapshot = [JSON.stringify(receipts), JSON.stringify(b)];
    const evaluation = evaluateMissionBudget({ budget: b, receipts, missionId: FIXTURE_MISSION });
    aggregateMissionEconomics({
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION,
      receipts,
      budgetEvaluation: evaluation,
      generatedAt: ECON_T3,
    });
    expect([JSON.stringify(receipts), JSON.stringify(b)]).toEqual(snapshot);
  });
});
