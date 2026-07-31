import { describe, expect, it } from 'vitest';

/**
 * The required deterministic fixtures (A–O) driven END-TO-END through the
 * real receipt service, budget evaluator, aggregator, and shared projection.
 */

import { createInitialAqualaOutcomeStatus } from '../status/status-model';
import { evaluateMissionBudget } from './budget-evaluation';
import { aggregateMissionEconomics } from './economics-aggregation';
import { projectMissionEconomics } from './economics-projection';
import {
  approvalReceipts,
  authorizedFallbackReceipts,
  budget,
  ECON_T3,
  failedLaunchReceipts,
  FIXTURE_MISSION,
  FIXTURE_PROJECT,
  FIXTURE_REVISION,
  hardLimitReceipts,
  mixedCurrencyReceipts,
  receipt,
  retryReceipts,
  reviewAndRepairReceipts,
  underBudgetReceipts,
  unknownPendingReceipts,
  usd,
  verifiedMissionReceipts,
  warningReceipts,
} from './economics-fixtures';
import { createAdjustment, createCostReceipt, disputeReceipt } from './cost-receipt-service';
import { formatMoney } from './money';
import type { RelayCostReceipt } from './cost-receipt-types';

function economicsFor(
  receipts: readonly RelayCostReceipt[],
  options: {
    budget?: ReturnType<typeof budget> | null;
    proposedCost?: ReturnType<typeof usd> | null;
    proposedCostUnknown?: boolean;
    missionStatus?: ReturnType<typeof createInitialAqualaOutcomeStatus>;
    requiredCategories?: Parameters<typeof aggregateMissionEconomics>[0]['requiredCategories'];
  } = {},
) {
  const evaluation = evaluateMissionBudget({
    budget: options.budget === undefined ? budget() : options.budget,
    receipts,
    missionId: FIXTURE_MISSION,
    proposedCost: options.proposedCost ?? null,
    proposedCostUnknown: options.proposedCostUnknown,
  });
  const aggregate = aggregateMissionEconomics({
    projectId: FIXTURE_PROJECT,
    missionId: FIXTURE_MISSION,
    missionRevision: FIXTURE_REVISION,
    receipts,
    budgetEvaluation: evaluation,
    missionStatus: options.missionStatus,
    requiredCategories: options.requiredCategories,
    generatedAt: ECON_T3,
  });
  return { evaluation, aggregate, projection: projectMissionEconomics(aggregate) };
}

describe('fixture A — under-budget implementation', () => {
  it('totals exactly $2.15 and stays under budget', () => {
    const { evaluation, aggregate, projection } = economicsFor(underBudgetReceipts());

    expect(formatMoney(evaluation.finalizedActual!)).toBe('$2.15');
    expect(evaluation.status).toBe('under_budget');
    expect(evaluation.approvalRequired).toBe(false);
    expect(evaluation.hardLimitReached).toBe(false);
    expect(formatMoney(evaluation.remainingBudget!)).toBe('$7.85');

    expect(formatMoney(aggregate.actual.total!)).toBe('$2.15');
    expect(formatMoney(aggregate.actual.planning!)).toBe('$0.20');
    expect(formatMoney(aggregate.actual.model_inference!)).toBe('$0.80');
    expect(projection.statusLabel).toBe('Under budget');
    expect(projection.projectedTotalLabel).toBe('$2.15');
  });
});

describe('fixture B — warning threshold', () => {
  it('reaches the 80% warning at $8.25 without hitting the hard limit', () => {
    const { evaluation, projection } = economicsFor(warningReceipts());

    expect(formatMoney(evaluation.projectedTotal!)).toBe('$8.25');
    expect(evaluation.warningThresholdReached).toBe(true);
    expect(evaluation.hardLimitReached).toBe(false);
    expect(evaluation.status).toBe('warning');
    expect(formatMoney(evaluation.remainingBudget!)).toBe('$1.75');
    expect(projection.warning).toBe(true);
    expect(projection.statusLabel).toBe('Warning threshold reached');
  });
});

describe('fixture C — approval required', () => {
  it('requires approval at a projected $9.25 against a $9.00 threshold', () => {
    const { evaluation, projection } = economicsFor(approvalReceipts(), {
      budget: budget({ approvalThreshold: usd('9.00') }),
      proposedCost: usd('0.75'),
    });

    expect(formatMoney(evaluation.projectedTotal!)).toBe('$9.25');
    expect(evaluation.approvalRequired).toBe(true);
    expect(evaluation.status).toBe('approval_required');
    expect(projection.approvalRequired).toBe(true);
    // Nothing was spent by evaluating — the proposal is still a proposal.
    expect(formatMoney(evaluation.finalizedActual!)).toBe('$8.50');
  });
});

describe('fixture D — hard limit', () => {
  it('blocks a repair that would exceed the limit and changes no receipt', () => {
    const receipts = hardLimitReceipts();
    const before = JSON.stringify(receipts);
    const { evaluation, projection } = economicsFor(receipts, { proposedCost: usd('0.50') });

    expect(formatMoney(evaluation.projectedTotal!)).toBe('$10.30');
    expect(evaluation.hardLimitReached).toBe(true);
    expect(['hard_limit_reached', 'exhausted']).toContain(evaluation.status);
    expect(evaluation.blockingReasons.length).toBeGreaterThan(0);
    expect(projection.hardLimitReached).toBe(true);
    expect(JSON.stringify(receipts)).toBe(before);
  });

  it('an advisory limit warns instead of blocking', () => {
    const { evaluation } = economicsFor(hardLimitReceipts(), {
      budget: budget({ hardLimitEnabled: false }),
      proposedCost: usd('0.50'),
    });
    expect(evaluation.hardLimitReached).toBe(false);
    expect(evaluation.warnings.join(' ')).toMatch(/advisory/u);
  });
});

describe('fixture E — unknown pending cost', () => {
  it('keeps unknown unknown and never renders $0.00', () => {
    const { evaluation, projection } = economicsFor(unknownPendingReceipts());

    expect(evaluation.hasUnknownPendingCost).toBe(true);
    expect(evaluation.status).toBe('unknown_due_to_missing_cost');
    expect(projection.pendingLabel).toContain('unknown');
    expect(projection.pendingLabel).not.toContain('$0.00');
    expect(projection.safeNotices.join(' ')).toMatch(/lower bound/u);
  });

  it('policy decides whether an unpriced proposal needs approval', () => {
    const requireApproval = evaluateMissionBudget({
      budget: budget(),
      receipts: [],
      missionId: FIXTURE_MISSION,
      proposedCostUnknown: true,
      unknownCostPolicy: 'require_approval',
    });
    expect(requireApproval.approvalRequired).toBe(true);

    const denied = evaluateMissionBudget({
      budget: budget(),
      receipts: [],
      missionId: FIXTURE_MISSION,
      proposedCostUnknown: true,
      unknownCostPolicy: 'deny',
    });
    expect(denied.blockingReasons.length).toBeGreaterThan(0);
    expect(denied.errors.some((e) => e.code === 'UNKNOWN_PROPOSED_COST')).toBe(true);

    const allowed = evaluateMissionBudget({
      budget: budget(),
      receipts: [],
      missionId: FIXTURE_MISSION,
      proposedCostUnknown: true,
      unknownCostPolicy: 'allow',
    });
    expect(allowed.approvalRequired).toBe(false);
  });
});

describe('fixture F — review and repair costs', () => {
  it('keeps every category separate with no double counting', () => {
    const { aggregate } = economicsFor(reviewAndRepairReceipts());

    expect(formatMoney(aggregate.actual.agent_execution!)).toBe('$1.00');
    expect(formatMoney(aggregate.actual.review!)).toBe('$0.75'); // 0.40 + 0.35
    expect(formatMoney(aggregate.actual.repair!)).toBe('$0.60');
    expect(formatMoney(aggregate.actual.total!)).toBe('$2.35');
    // The verified reviewer is the agent that actually reviewed.
    const reviewReceipts = reviewAndRepairReceipts().filter((r) => r.category === 'review');
    for (const r of reviewReceipts) expect(r.actualAgentId).toBe('agent-codex');
  });
});

describe('fixture G — failed agent launch', () => {
  it('records adapter infrastructure cost and NO Codex execution cost', () => {
    const receipts = failedLaunchReceipts();
    const { aggregate } = economicsFor(receipts);

    expect(formatMoney(aggregate.actual.infrastructure!)).toBe('$0.02');
    expect(aggregate.actual.agent_execution ?? null).toBeNull();
    expect(receipts.every((r) => r.actualAgentId === undefined)).toBe(true);
    expect(receipts[0].requestedAgentId).toBe('agent-codex');
  });

  it('refuses to attribute execution cost to an agent that never launched', () => {
    // Deliberately attributes agent execution to a merely-requested agent.
    const result = createCostReceipt({
      receiptId: 'r-bad',
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION,
      category: 'agent_execution',
      costClass: 'actual',
      status: 'finalized',
      source: 'adapter_observed',
      amount: usd('1.00'),
      requestedAgentId: 'agent-codex',
      occurredAt: ECON_T3,
      recordedAt: ECON_T3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNVERIFIED_AGENT_COST_ATTRIBUTION');
    expect(result.error.reason).toMatch(/never verifiably launched/u);
  });
});

describe('fixture H — authorized fallback', () => {
  it('attributes cost to the agent that actually ran, keeping the request visible', () => {
    const receipts = authorizedFallbackReceipts();
    expect(receipts[0].requestedAgentId).toBe('agent-claude');
    expect(receipts[0].actualAgentId).toBe('agent-manual');

    const { aggregate } = economicsFor(receipts);
    expect(formatMoney(aggregate.actual.agent_execution!)).toBe('$0.90');
  });
});

describe('fixture I — retry', () => {
  it('preserves the original run cost and books the retry separately', () => {
    const { aggregate, evaluation } = economicsFor(retryReceipts());

    expect(formatMoney(aggregate.actual.agent_execution!)).toBe('$0.50');
    expect(formatMoney(aggregate.actual.retry!)).toBe('$0.55');
    expect(formatMoney(aggregate.actual.total!)).toBe('$1.05');
    expect(evaluation.retriesUsed).toBe(1);
  });

  it('enforces a retry limit', () => {
    const { evaluation } = economicsFor(retryReceipts(), {
      budget: budget({ retryLimit: 1 }),
    });
    expect(evaluation.errors.some((e) => e.code === 'RETRY_LIMIT_REACHED')).toBe(true);
    expect(evaluation.blockingReasons.join(' ')).toMatch(/retry limit/u);
  });
});

describe('fixture J — disputed receipt', () => {
  it('stays inspectable, is held out of the total, and marks completeness disputed', () => {
    const base = receipt({ receiptId: 'r-j1', category: 'model_inference', amount: usd('3.00'), actualAgentId: 'agent-claude' });
    const disputed = disputeReceipt(base, 'provider billed an unrecognized session');
    expect(disputed.ok).toBe(true);
    if (!disputed.ok) return;

    const { aggregate, evaluation, projection } = economicsFor([disputed.value]);
    expect(disputed.value.status).toBe('disputed');
    expect(evaluation.finalizedActual).toBeNull(); // held out, not counted
    expect(aggregate.completeness).toBe('disputed');
    expect(aggregate.receiptCounts.disputed).toBe(1);
    expect(projection.completenessLabel).toBe('Disputed');
    expect(projection.safeNotices.join(' ')).toMatch(/disputed/u);
  });
});

describe('fixture K — adjustment', () => {
  it('leaves the original at $2.00 and applies a -$0.25 credit exactly once', () => {
    const original = receipt({ receiptId: 'r-k1', category: 'model_inference', amount: usd('2.00'), actualAgentId: 'agent-claude' });
    const adjustment = createAdjustment({
      receiptId: 'r-k1-adj',
      original,
      amount: usd('-0.25'),
      reason: 'provider credit for a duplicated charge',
      occurredAt: ECON_T3,
      recordedAt: ECON_T3,
    });
    expect(adjustment.ok).toBe(true);
    if (!adjustment.ok) return;

    expect(formatMoney(original.amount!)).toBe('$2.00');
    expect(adjustment.value.adjustmentOfReceiptId).toBe('r-k1');

    const { aggregate } = economicsFor([original, adjustment.value]);
    expect(formatMoney(aggregate.actual.model_inference!)).toBe('$2.00');
    expect(formatMoney(aggregate.actual.adjustments!)).toBe('-$0.25');
    expect(formatMoney(aggregate.actual.total!)).toBe('$1.75');
  });

  it('refuses a credit larger than the original charge', () => {
    const original = receipt({ receiptId: 'r-k2', category: 'model_inference', amount: usd('1.00'), actualAgentId: 'agent-claude' });
    const result = createAdjustment({
      receiptId: 'r-k2-adj',
      original,
      amount: usd('-5.00'),
      reason: 'over-credit',
      occurredAt: ECON_T3,
      recordedAt: ECON_T3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ADJUSTMENT_EXCEEDS_ALLOWED_AMOUNT');
  });
});

describe('fixture L — verified mission cost', () => {
  it('calculates the cost only when outcome AND verification are satisfied', () => {
    const verified = {
      ...createInitialAqualaOutcomeStatus(),
      executionStatus: 'completed' as const,
      outcomeStatus: 'satisfied' as const,
      verificationStatus: 'verified' as const,
    };
    const { aggregate, projection } = economicsFor(verifiedMissionReceipts(), {
      missionStatus: verified,
      requiredCategories: ['planning', 'agent_execution', 'review'],
    });

    expect(aggregate.completeness).toBe('complete');
    expect(formatMoney(aggregate.verifiedMissionCost!)).toBe('$1.60');
    expect(projection.verifiedMissionCostLabel).toBe('$1.60');
  });
});

describe('fixture M — completed but unverified', () => {
  it('leaves the verified mission cost unavailable', () => {
    const completedOnly = {
      ...createInitialAqualaOutcomeStatus(),
      executionStatus: 'completed' as const,
    };
    const { aggregate, projection } = economicsFor(verifiedMissionReceipts(), {
      missionStatus: completedOnly,
    });

    expect(aggregate.verifiedMissionCost).toBeNull();
    expect(aggregate.verifiedMissionCostReason).toMatch(/not satisfied/u);
    expect(projection.verifiedMissionCostLabel).toBe('Not available');
  });

  it.each([
    ['violated outcome', { outcomeStatus: 'violated' as const, verificationStatus: 'verified' as const }],
    ['changes required', { outcomeStatus: 'satisfied' as const, verificationStatus: 'changes_required' as const }],
    ['approved but not verified', { outcomeStatus: 'satisfied' as const, verificationStatus: 'approved' as const }],
  ])('%s also leaves it unavailable', (_label, over) => {
    const { aggregate } = economicsFor(verifiedMissionReceipts(), {
      missionStatus: { ...createInitialAqualaOutcomeStatus(), ...over },
    });
    expect(aggregate.verifiedMissionCost).toBeNull();
  });

  it('incomplete costs block it even when the mission verified', () => {
    const pending = receipt({
      receiptId: 'r-m-pending',
      category: 'model_inference',
      status: 'pending',
      amount: null,
      providerUsageReferenceId: undefined,
      finalizedAt: undefined,
      actualAgentId: 'agent-claude',
    });
    const { aggregate } = economicsFor([...verifiedMissionReceipts(), pending], {
      missionStatus: {
        ...createInitialAqualaOutcomeStatus(),
        outcomeStatus: 'satisfied',
        verificationStatus: 'verified',
      },
    });
    expect(aggregate.completeness).toBe('partial');
    expect(aggregate.verifiedMissionCost).toBeNull();
    expect(aggregate.verifiedMissionCostReason).toMatch(/incomplete/u);
  });

  it('failed trace integrity blocks it', () => {
    const evaluation = evaluateMissionBudget({
      budget: budget(),
      receipts: verifiedMissionReceipts(),
      missionId: FIXTURE_MISSION,
    });
    const aggregate = aggregateMissionEconomics({
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
      traceIntegrityVerified: false,
      generatedAt: ECON_T3,
    });
    expect(aggregate.verifiedMissionCost).toBeNull();
    expect(aggregate.verifiedMissionCostReason).toMatch(/trace integrity/u);
  });
});

describe('fixture N — mixed currency', () => {
  it('refuses to combine currencies and produces no total', () => {
    const { evaluation, aggregate, projection } = economicsFor(mixedCurrencyReceipts());

    expect(evaluation.status).toBe('currency_conflict');
    expect(evaluation.projectedTotal).toBeNull();
    expect(evaluation.currency).toBeNull();
    expect(aggregate.completeness).toBe('currency_conflict');
    expect(aggregate.actual.total).toBeNull();
    expect(aggregate.verifiedMissionCost).toBeNull();
    expect(projection.statusLabel).toMatch(/Currency conflict/u);
    expect(projection.safeNotices.join(' ')).toMatch(/no conversion/u);
  });
});

describe('fixture O — the projection both surfaces render', () => {
  it('is deterministic, and never renders a missing amount as money', () => {
    const first = economicsFor(underBudgetReceipts()).projection;
    const second = economicsFor(underBudgetReceipts()).projection;
    expect(first).toEqual(second);

    const empty = economicsFor([], { budget: null }).projection;
    expect(empty.finalizedActualLabel).toBe('Not available');
    expect(empty.projectedTotalLabel).toBe('Unknown');
    expect(empty.budgetLabel).toBe('Not configured');
    expect(JSON.stringify(empty)).not.toContain('$0.00');
    expect(empty.safeNotices.join(' ')).toMatch(/not the same as unlimited/u);
  });

  it('carries every category with an honest per-category status', () => {
    const { projection } = economicsFor(underBudgetReceipts());
    const model = projection.categories.find((c) => c.category === 'model_inference');
    expect(model?.actualLabel).toBe('$0.80');
    expect(model?.statusLabel).toBe('Recorded');

    const workspace = projection.categories.find((c) => c.category === 'workspace');
    expect(workspace?.actualLabel).toBe('Not available');
    expect(workspace?.statusLabel).toBe('Not available');
  });
});
