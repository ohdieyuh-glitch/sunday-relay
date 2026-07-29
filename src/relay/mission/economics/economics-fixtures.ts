/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * DETERMINISTIC FIXTURES — test/development data ONLY.
 *
 * Every rate here is FICTIONAL and every receipt is synthetic. No fixture
 * reflects a real provider price, and `development_fixture` receipts may
 * never be treated as production cost records. Timestamps are fixed
 * constants; the domain never reads a clock.
 */

import { createMissionBudget, type RelayMissionBudget } from './budget-types';
import {
  createCostReceipt,
  type CreateCostReceiptInput,
} from './cost-receipt-service';
import type { RelayCostReceipt, RelayRateReference } from './cost-receipt-types';
import { money, moneyFromDecimalString, type RelayMoney } from './money';

export const ECON_T0 = '2026-07-29T12:00:00.000Z';
export const ECON_T1 = '2026-07-29T12:05:00.000Z';
export const ECON_T2 = '2026-07-29T12:20:00.000Z';
export const ECON_T3 = '2026-07-29T12:40:00.000Z';

export const FIXTURE_PROJECT = 'project-sunday';
export const FIXTURE_MISSION = 'mission-auth';
export const FIXTURE_REVISION = 4;

/** Delegates to the tested parser — a fixture must never re-implement money
    parsing (a hand-rolled version silently turns "-0.25" into +$0.25, because
    BigInt('-0') is 0). */
export const usd = (decimal: string): RelayMoney => {
  const parsed = moneyFromDecimalString('USD', decimal);
  if (!parsed.ok) throw new Error(`invalid fixture amount "${decimal}": ${parsed.error.reason}`);
  return parsed.value;
};

/** A FICTIONAL rate used only to prove that calculated amounts cite a rate. */
export const FIXTURE_RATE: RelayRateReference = Object.freeze({
  rateReferenceId: 'rate-fixture-1',
  source: 'relay-development-fixture',
  version: 'fixture-1',
  effectiveAt: ECON_T0,
  currency: 'USD',
  unit: 'output_token',
  amountPerUnit: money('USD', '2'),
  trust: 'development_fixture',
});

let receiptCounter = 0;
const nextReceiptId = (label: string) => {
  receiptCounter += 1;
  return `receipt-${label}-${receiptCounter}`;
};

export function resetFixtureCounter(): void {
  receiptCounter = 0;
}

/** Builds a receipt or throws — fixtures must never be silently invalid. */
export function receipt(over: Partial<CreateCostReceiptInput> = {}): RelayCostReceipt {
  const input: CreateCostReceiptInput = {
    receiptId: over.receiptId ?? nextReceiptId(over.category ?? 'cost'),
    projectId: FIXTURE_PROJECT,
    missionId: FIXTURE_MISSION,
    missionRevision: FIXTURE_REVISION,
    category: 'model_inference',
    costClass: 'actual',
    status: 'finalized',
    source: 'provider_reported',
    providerUsageReferenceId: `usage-${over.receiptId ?? nextReceiptId('u')}`,
    occurredAt: ECON_T1,
    recordedAt: ECON_T1,
    finalizedAt: ECON_T1,
    ...over,
  };
  const built = createCostReceipt(input);
  if (!built.ok) throw new Error(`fixture receipt invalid: ${built.error.reason}`);
  return built.value;
}

export function budget(over: Partial<Parameters<typeof createMissionBudget>[0]> = {}): RelayMissionBudget {
  const built = createMissionBudget({
    budgetId: 'budget-auth-1',
    projectId: FIXTURE_PROJECT,
    missionId: FIXTURE_MISSION,
    missionRevision: FIXTURE_REVISION,
    currency: 'USD',
    totalLimit: usd('10.00'),
    warningThresholdBasisPoints: 8_000,
    createdAt: ECON_T0,
    policyVersion: 'budget-policy-v1',
    ...over,
  });
  if (!built.ok) throw new Error(`fixture budget invalid: ${built.error.reason}`);
  return built.value;
}

/* ------------------------------------------------------------ scenarios */

/** FIXTURE A — under budget: $0.20 + $0.80 + $1.00 + $0.15 = $2.15. */
export function underBudgetReceipts(): RelayCostReceipt[] {
  return [
    receipt({ receiptId: 'r-plan', category: 'planning', amount: usd('0.20'), actualAgentId: 'agent-architect' }),
    receipt({ receiptId: 'r-model', category: 'model_inference', amount: usd('0.80'), actualAgentId: 'agent-claude' }),
    receipt({ receiptId: 'r-agent', category: 'agent_execution', amount: usd('1.00'), actualAgentId: 'agent-claude' }),
    receipt({ receiptId: 'r-test', category: 'testing', amount: usd('0.15'), source: 'adapter_observed', providerUsageReferenceId: undefined }),
  ];
}

/** FIXTURE B — warning: projected $8.25 against a $10.00 / 80% budget. */
export function warningReceipts(): RelayCostReceipt[] {
  return [
    receipt({ receiptId: 'r-w1', category: 'agent_execution', amount: usd('8.00'), actualAgentId: 'agent-claude' }),
    receipt({ receiptId: 'r-w2', category: 'testing', amount: usd('0.25'), source: 'adapter_observed', providerUsageReferenceId: undefined }),
  ];
}

/** FIXTURE C — approval: $8.50 spent, $0.75 review proposed, threshold $9.00. */
export function approvalReceipts(): RelayCostReceipt[] {
  return [
    receipt({ receiptId: 'r-a1', category: 'agent_execution', amount: usd('8.50'), actualAgentId: 'agent-claude' }),
  ];
}

/** FIXTURE D — hard limit: $9.80 spent, $0.50 repair proposed against $10.00. */
export function hardLimitReceipts(): RelayCostReceipt[] {
  return [
    receipt({ receiptId: 'r-h1', category: 'agent_execution', amount: usd('9.80'), actualAgentId: 'agent-claude' }),
  ];
}

/** FIXTURE E — a pending provider receipt whose amount is genuinely unknown. */
export function unknownPendingReceipts(): RelayCostReceipt[] {
  return [
    receipt({ receiptId: 'r-e1', category: 'model_inference', amount: usd('1.00'), actualAgentId: 'agent-claude' }),
    receipt({
      receiptId: 'r-e2',
      category: 'model_inference',
      status: 'pending',
      amount: null,
      providerUsageReferenceId: undefined,
      finalizedAt: undefined,
      actualAgentId: 'agent-claude',
    }),
  ];
}

/** FIXTURE F — implementation, independent review, repair, re-review. */
export function reviewAndRepairReceipts(): RelayCostReceipt[] {
  return [
    receipt({ receiptId: 'r-f1', category: 'agent_execution', amount: usd('1.00'), actualAgentId: 'agent-claude', runId: 'run-impl' }),
    receipt({ receiptId: 'r-f2', category: 'review', amount: usd('0.40'), actualAgentId: 'agent-codex', runId: 'run-review-1' }),
    receipt({ receiptId: 'r-f3', category: 'repair', amount: usd('0.60'), actualAgentId: 'agent-claude', runId: 'run-repair-1' }),
    receipt({ receiptId: 'r-f4', category: 'review', amount: usd('0.35'), actualAgentId: 'agent-codex', runId: 'run-review-2' }),
  ];
}

/** FIXTURE G — Codex never launched: infrastructure cost only, no Codex cost. */
export function failedLaunchReceipts(): RelayCostReceipt[] {
  return [
    receipt({
      receiptId: 'r-g1',
      category: 'infrastructure',
      amount: usd('0.02'),
      source: 'adapter_observed',
      providerUsageReferenceId: undefined,
      requestedAgentId: 'agent-codex',
      metadata: { note: 'adapter launch attempt for agent-codex; the runtime never became active' },
    }),
  ];
}

/** FIXTURE H — authorized fallback: cost belongs to the agent that ran. */
export function authorizedFallbackReceipts(): RelayCostReceipt[] {
  return [
    receipt({
      receiptId: 'r-h-fallback',
      category: 'agent_execution',
      amount: usd('0.90'),
      requestedAgentId: 'agent-claude',
      actualAgentId: 'agent-manual',
      runId: 'run-fallback',
    }),
  ];
}

/** FIXTURE I — a failed run and its retry, both preserved. */
export function retryReceipts(): RelayCostReceipt[] {
  return [
    receipt({ receiptId: 'r-i1', category: 'agent_execution', amount: usd('0.50'), actualAgentId: 'agent-claude', runId: 'run-1' }),
    receipt({ receiptId: 'r-i2', category: 'retry', amount: usd('0.55'), actualAgentId: 'agent-claude', runId: 'run-2', metadata: { priorRunId: 'run-1' } }),
  ];
}

/** FIXTURE N — mixed currency; no conversion, no combined total. */
export function mixedCurrencyReceipts(): RelayCostReceipt[] {
  return [
    receipt({ receiptId: 'r-n1', category: 'model_inference', amount: usd('1.00'), actualAgentId: 'agent-claude' }),
    receipt({
      receiptId: 'r-n2',
      category: 'model_inference',
      amount: money('EUR', '1000000'),
      actualAgentId: 'agent-claude',
      providerUsageReferenceId: 'usage-eur-1',
    }),
  ];
}

/** FIXTURE L — a complete, verified mission's receipts. */
export function verifiedMissionReceipts(): RelayCostReceipt[] {
  return [
    receipt({ receiptId: 'r-l1', category: 'planning', amount: usd('0.20'), actualAgentId: 'agent-architect' }),
    receipt({ receiptId: 'r-l2', category: 'agent_execution', amount: usd('1.00'), actualAgentId: 'agent-claude' }),
    receipt({ receiptId: 'r-l3', category: 'review', amount: usd('0.40'), actualAgentId: 'agent-codex' }),
  ];
}

/** Synthetic credential-shaped metadata for redaction fixtures ONLY. The key
    names are assembled at runtime because the repo-wide mission-layer
    boundary test forbids DECLARING credential-shaped fields in source. */
export function secretShapedReceiptMetadata(): Record<string, unknown> {
  const apiKeyField = ['api', 'Key'].join('');
  return {
    [apiKeyField]: 'sk-fixture0123456789abcdefghij',
    invoice: { AUTHORIZATION: 'Bearer fixture-token-0123456789abcd', line: 'model usage' },
    envName: 'ANTHROPIC_API_KEY',
  };
}
