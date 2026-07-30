/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * CLI mission economics rendering.
 *
 * The CLI and the website render the SAME shared projection
 * (`projectMissionEconomics`), so the two surfaces cannot disagree about what
 * a mission cost, what remains, or what is unknown. Only the presentation
 * differs: the website styles it, this prints it.
 *
 * Nothing here computes money, converts a currency, calls a provider, or
 * prints a credential. A missing amount prints as a word, never as $0.00.
 */

import type {
  RelayBudgetEvaluation,
  RelayCostReceipt,
  RelayMissionEconomicsProjection,
} from '../mission';
import { formatMoney, MIXED_DATA_LABEL, SIMULATED_DATA_LABEL } from '../mission';

export interface EconomicsRenderOptions {
  /** Terminal width; the layout degrades gracefully when narrow. */
  width: number;
  plain: boolean;
}

const NARROW = 60;

/**
 * SIMULATED-DATA DISCLOSURE.
 *
 * Every mission-economics command in this build renders a deterministic
 * development fixture. Printing those figures without saying so presents
 * development data as a real user mission, so the banner is emitted from the
 * PROJECTION's own `dataSourceLabel` — derived from the receipts — and cannot
 * be dropped by a caller that forgets a flag.
 */
function disclosureLines(
  projection: RelayMissionEconomicsProjection,
  options: EconomicsRenderOptions,
): string[] {
  if (projection.dataSourceLabel === null) return [];
  const rule = '─'.repeat(Math.max(20, Math.min(options.width - 2, projection.dataSourceLabel.length + 4)));
  return [
    `  ${rule}`,
    ...wrap(projection.dataSourceLabel, options.width, '  '),
    ...(projection.dataSource === 'development_fixture'
      ? wrap(
        'No mission ran, no provider was called, and no money was spent. Relay has no live mission '
        + 'economics source configured in this build.',
        options.width,
        '  ',
      )
      : []),
    `  ${rule}`,
    '',
  ];
}

function line(label: string, value: string, options: EconomicsRenderOptions): string {
  if (options.width < NARROW) return `${label}:\n  ${value}`;
  const padding = Math.max(1, 22 - label.length);
  return `${label}${' '.repeat(padding)}${value}`;
}

/**
 * Wraps prose to the terminal width. Notices are full sentences and would
 * otherwise overflow a narrow terminal, which is exactly where an operator is
 * most likely to be reading them.
 */
function wrap(text: string, width: number, indent: string): string[] {
  const usable = Math.max(20, width - indent.length);
  const out: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/u)) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= usable) {
      current = `${current} ${word}`;
    } else {
      out.push(`${indent}${current}`);
      current = word;
    }
  }
  if (current.length > 0) out.push(`${indent}${current}`);
  return out;
}

/** MISSION ECONOMICS — the terminal equivalent of the website summary. */
export function renderMissionEconomics(
  projection: RelayMissionEconomicsProjection,
  options: EconomicsRenderOptions,
): string[] {
  const out: string[] = [];
  out.push('MISSION ECONOMICS');
  out.push(`  mission ${projection.missionId} · revision ${projection.missionRevision}`);
  out.push('');
  out.push(...disclosureLines(projection, options));
  out.push(`  ${projection.statusLabel.toUpperCase()}`);
  out.push('');

  for (const [label, value] of [
    ['Budget', projection.budgetLabel],
    ['Finalized actual', projection.finalizedActualLabel],
    ['Provisional', projection.provisionalActualLabel],
    ['Known pending', projection.pendingLabel],
    ['Projected total', projection.projectedTotalLabel],
    ['Remaining', projection.remainingLabel],
    ['Cost records', projection.completenessLabel],
    ['Verified mission cost', projection.verifiedMissionCostLabel],
  ] as const) {
    out.push(`  ${line(label, value, options)}`);
  }

  out.push('');
  out.push('  COST BREAKDOWN');
  for (const category of projection.categories) {
    out.push(`  ${line(`  ${category.label}`, `${category.actualLabel}  (${category.statusLabel})`, options)}`);
  }

  if (projection.safeNotices.length > 0) {
    out.push('');
    out.push('  NOTICES');
    for (const notice of projection.safeNotices) {
      out.push(...wrap(`· ${notice}`, options.width, '  '));
    }
  }

  return out;
}

/** MISSION BUDGET — the budget half, with the same semantics as the website. */
export function renderMissionBudget(
  projection: RelayMissionEconomicsProjection,
  evaluation: RelayBudgetEvaluation,
  options: EconomicsRenderOptions,
): string[] {
  const out: string[] = [];
  out.push('MISSION BUDGET');
  out.push(`  mission ${projection.missionId} · revision ${projection.missionRevision}`);
  out.push('');
  out.push(...disclosureLines(projection, options));
  out.push(`  ${line('Budget', projection.budgetLabel, options)}`);
  out.push(`  ${line('Projected total', projection.projectedTotalLabel, options)}`);
  out.push(`  ${line('Remaining', projection.remainingLabel, options)}`);
  out.push(`  ${line('Warning threshold', projection.warning ? 'REACHED' : 'not reached', options)}`);
  out.push(`  ${line('Approval', projection.approvalRequired ? 'REQUIRED' : 'not required', options)}`);
  out.push(`  ${line('Hard limit', projection.hardLimitReached ? 'REACHED — blocked' : 'within limit', options)}`);
  out.push(`  ${line('Repair cycles used', String(evaluation.repairCyclesUsed), options)}`);
  out.push(`  ${line('Retries used', String(evaluation.retriesUsed), options)}`);

  for (const category of evaluation.categoryEvaluations) {
    out.push(
      `  ${line(`  ${category.category} limit`, category.limitReached ? 'REACHED' : 'within limit', options)}`,
    );
  }

  if (evaluation.blockingReasons.length > 0) {
    out.push('');
    out.push('  BLOCKING');
    for (const reason of evaluation.blockingReasons) {
      out.push(...wrap(`· ${reason}`, options.width, '  '));
    }
  }

  out.push('');
  out.push(...wrap('To change the budget, use the validated change_budget command.', options.width, '  '));
  out.push(...wrap('Budget state is never edited directly from the terminal.', options.width, '  '));
  return out;
}

/**
 * MISSION RECEIPTS — safe summaries only. Receipt metadata is already
 * redacted at creation; this prints identity, category, and amount, and never
 * the metadata blob.
 */
export function renderMissionReceipts(
  receipts: readonly RelayCostReceipt[],
  options: EconomicsRenderOptions,
): string[] {
  const out: string[] = [];
  out.push('MISSION COST RECEIPTS');
  // The disclosure is derived from the receipts themselves — the same rule the
  // shared projection applies — so this listing cannot present a development
  // fixture as a real user mission.
  const fixtures = receipts.filter((r) => r.source === 'development_fixture').length;
  if (fixtures > 0) {
    const label = fixtures === receipts.length ? SIMULATED_DATA_LABEL : MIXED_DATA_LABEL;
    const rule = '─'.repeat(Math.max(20, Math.min(options.width - 2, label.length + 4)));
    out.push(`  ${rule}`);
    out.push(...wrap(label, options.width, '  '));
    out.push(`  ${rule}`);
  }
  if (receipts.length === 0) {
    out.push(...wrap('No cost receipts recorded. This is not the same as $0.00 spent.', options.width, '  '));
    return out;
  }

  for (const receipt of receipts) {
    const amount = receipt.amount ? formatMoney(receipt.amount) : 'Unknown';
    out.push('');
    out.push(`  ${receipt.receiptId}`);
    out.push(`  ${line('  category', receipt.category, options)}`);
    out.push(`  ${line('  class / status', `${receipt.costClass} / ${receipt.status}`, options)}`);
    out.push(`  ${line('  source', receipt.source, options)}`);
    out.push(`  ${line('  amount', amount, options)}`);
    out.push(`  ${line('  mission revision', String(receipt.missionRevision), options)}`);
    if (receipt.runId) out.push(`  ${line('  run', receipt.runId, options)}`);
    if (receipt.capsuleId) out.push(`  ${line('  capsule', receipt.capsuleId, options)}`);
    // Cost follows the agent that ACTUALLY ran; a merely-requested agent is
    // shown as requested, never billed.
    if (receipt.actualAgentId) out.push(`  ${line('  actual agent', receipt.actualAgentId, options)}`);
    if (receipt.requestedAgentId && !receipt.actualAgentId) {
      out.push(`  ${line('  requested agent', `${receipt.requestedAgentId} (never launched — no execution cost)`, options)}`);
    }
    if (receipt.adjustmentOfReceiptId) {
      out.push(`  ${line('  adjusts', receipt.adjustmentOfReceiptId, options)}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------- fixture */

import {
  aggregateMissionEconomics,
  createCostReceipt,
  createMissionBudget,
  evaluateMissionBudget,
  moneyFromDecimalString,
  projectMissionEconomics,
} from '../mission';

const FIXTURE_PROJECT = 'project-sunday';
const FIXTURE_MISSION = 'mission-auth';
const FIXTURE_REVISION = 4;
const FIXTURE_AT = '2026-07-29T12:40:00.000Z';

const amount = (decimal: string) => {
  const parsed = moneyFromDecimalString('USD', decimal);
  if (!parsed.ok) throw new Error(parsed.error.reason);
  return parsed.value;
};

/**
 * The deterministic development fixture the CLI reads today — the same
 * scenario the website fixture uses, so both surfaces can be compared
 * directly. Real missions supply their own receipts and budget through the
 * identical shared core; none of the semantics change when they do.
 */
export function buildMissionEconomicsFixture() {
  const spec = [
    { receiptId: 'r-plan', category: 'planning' as const, decimal: '0.20', agent: 'agent-architect' },
    { receiptId: 'r-model', category: 'model_inference' as const, decimal: '0.80', agent: 'agent-claude' },
    { receiptId: 'r-agent', category: 'agent_execution' as const, decimal: '1.00', agent: 'agent-claude' },
    { receiptId: 'r-test', category: 'testing' as const, decimal: '0.15', agent: undefined },
  ];

  const receipts: RelayCostReceipt[] = [];
  for (const entry of spec) {
    const built = createCostReceipt({
      receiptId: entry.receiptId,
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION,
      category: entry.category,
      costClass: 'actual',
      status: 'finalized',
      // DEVELOPMENT FIXTURE, declared as one. Claiming `provider_reported`
      // here would have been a fabricated provenance in synthetic data, and it
      // is what let the CLI present this ledger as a real mission.
      source: 'development_fixture',
      ...(entry.agent ? { actualAgentId: entry.agent } : {}),
      amount: amount(entry.decimal),
      occurredAt: FIXTURE_AT,
      recordedAt: FIXTURE_AT,
      finalizedAt: FIXTURE_AT,
    });
    if (!built.ok) throw new Error(`fixture receipt invalid: ${built.error.reason}`);
    receipts.push(built.value);
  }

  const budget = createMissionBudget({
    budgetId: 'budget-auth-1',
    projectId: FIXTURE_PROJECT,
    missionId: FIXTURE_MISSION,
    missionRevision: FIXTURE_REVISION,
    currency: 'USD',
    totalLimit: amount('10.00'),
    warningThresholdBasisPoints: 8_000,
    createdAt: FIXTURE_AT,
    policyVersion: 'budget-policy-v1',
  });
  if (!budget.ok) throw new Error(`fixture budget invalid: ${budget.error.reason}`);

  const evaluation = evaluateMissionBudget({
    budget: budget.value,
    receipts,
    missionId: FIXTURE_MISSION,
  });
  const economics = aggregateMissionEconomics({
    projectId: FIXTURE_PROJECT,
    missionId: FIXTURE_MISSION,
    missionRevision: FIXTURE_REVISION,
    receipts,
    budgetEvaluation: evaluation,
    generatedAt: FIXTURE_AT,
  });

  return { receipts, evaluation, projection: projectMissionEconomics(economics) };
}
