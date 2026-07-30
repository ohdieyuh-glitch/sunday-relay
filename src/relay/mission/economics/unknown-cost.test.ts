import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { evaluateMissionBudget } from './budget-evaluation';
import { aggregateMissionEconomics } from './economics-aggregation';
import { projectMissionEconomics, UNKNOWN_LABEL, AT_LEAST_PREFIX, AT_MOST_PREFIX } from './economics-projection';
import {
  budget,
  ECON_T3,
  FIXTURE_MISSION,
  FIXTURE_PROJECT,
  FIXTURE_REVISION,
  receipt,
  usd,
} from './economics-fixtures';
import { formatMoney } from './money';
import type { RelayCostReceipt } from './cost-receipt-types';
import { createCostReceipt } from './cost-receipt-service';
import { RelayMissionEconomics } from '../../ui/project-workspace/RelayMissionEconomics';
import { renderMissionBudget, renderMissionEconomics } from '../../cli/mission-economics';

/**
 * UNKNOWN PROVISIONAL COST (N-1).
 *
 * The defect: an unpriced PROVISIONAL receipt was dropped silently. It counts
 * toward the projection, but only unpriced PENDING receipts were tracked, so
 * the projected total quietly undercounted and the status still read "under
 * budget". Worse, the remaining budget was computed as
 *
 *     const spent = projectedTotal ?? zeroMoney(currency);
 *
 * so an entirely unknown spend reported the WHOLE limit as remaining — a
 * fabricated zero in the one number an operator acts on. Category limits did
 * the same thing: `spent === null` reported `remaining = limit`.
 *
 * These tests cover all five layers the finding names: the pure economics
 * domain, the website projection, the CLI output, hard-limit evaluation and
 * category-limit evaluation.
 */

const unpricedProvisional = (over: Partial<Parameters<typeof receipt>[0]> = {}) =>
  receipt({
    category: 'model_inference',
    costClass: 'actual',
    status: 'provisional',
    amount: null,
    source: 'adapter_observed',
    providerUsageReferenceId: undefined,
    finalizedAt: undefined,
    ...over,
  });

function evaluate(
  receipts: readonly RelayCostReceipt[],
  options: { budget?: ReturnType<typeof budget> | null } = {},
) {
  return evaluateMissionBudget({
    budget: options.budget === undefined ? budget() : options.budget,
    receipts,
    missionId: FIXTURE_MISSION,
  });
}

function projectionFor(
  receipts: readonly RelayCostReceipt[],
  options: { budget?: ReturnType<typeof budget> | null } = {},
) {
  const evaluation = evaluate(receipts, options);
  return {
    evaluation,
    projection: projectMissionEconomics(
      aggregateMissionEconomics({
        projectId: FIXTURE_PROJECT,
        missionId: FIXTURE_MISSION,
        missionRevision: FIXTURE_REVISION,
        receipts,
        budgetEvaluation: evaluation,
        generatedAt: ECON_T3,
      }),
    ),
  };
}

/* ------------------------------------------------- 1. pure domain */

describe('N-1 domain — an unpriced provisional receipt makes the projection incomplete', () => {
  it('is tracked, counted and disclosed', () => {
    const evaluation = evaluate([
      receipt({ receiptId: 'r-known', category: 'planning', amount: usd('1.00') }),
      unpricedProvisional({ receiptId: 'r-unpriced' }),
    ]);

    expect(evaluation.hasUnknownProvisionalCost).toBe(true);
    expect(evaluation.unpricedCountableReceipts).toBe(1);
    expect(evaluation.projectedTotalComplete).toBe(false);
    expect(evaluation.warnings.join(' ')).toMatch(/provisional receipt has no recorded amount/u);
  });

  it('never reports UNDER BUDGET on an incomplete total', () => {
    const evaluation = evaluate([
      receipt({ receiptId: 'r-known-2', category: 'planning', amount: usd('1.00') }),
      unpricedProvisional({ receiptId: 'r-unpriced-2' }),
    ]);
    expect(evaluation.status).toBe('unknown_due_to_missing_cost');
    expect(evaluation.status).not.toBe('under_budget');
  });

  it('the SAME ledger with the provisional receipt priced does report under budget', () => {
    const evaluation = evaluate([
      receipt({ receiptId: 'r-known-3', category: 'planning', amount: usd('1.00') }),
      unpricedProvisional({ receiptId: 'r-priced-3', amount: usd('0.50') }),
    ]);
    expect(evaluation.projectedTotalComplete).toBe(true);
    expect(evaluation.status).toBe('under_budget');
  });

  it('an unpriced FINALIZED actual cannot exist — the service refuses to create one', () => {
    // The strongest possible version of "no silent undercount": a finalized
    // receipt with no amount is rejected at creation, so the only unpriced
    // countable receipts are pending and provisional. The evaluator still
    // counts a finalized unpriced receipt defensively, in case a persisted
    // record is ever tampered with.
    const built = createCostReceipt({
      receiptId: 'r-final-unpriced',
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION,
      category: 'testing',
      costClass: 'actual',
      status: 'finalized',
      source: 'adapter_observed',
      amount: null,
      occurredAt: ECON_T3,
      recordedAt: ECON_T3,
      finalizedAt: ECON_T3,
    });
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error('an unpriced finalized receipt must be refused');
    expect(built.error.reason).toMatch(/finalized receipt must carry an amount/u);
  });
});

/* ------------------------------------- 2. remaining is never a fake zero */

describe('N-1 domain — projectedTotal === null is never treated as zero money', () => {
  it('an entirely unpriced ledger leaves the remaining budget UNKNOWN, not the full limit', () => {
    const evaluation = evaluate([unpricedProvisional({ receiptId: 'r-all-unknown' })]);

    expect(evaluation.projectedTotal).toBeNull();
    expect(evaluation.remainingBudget, 'the whole limit must not be reported as remaining').toBeNull();
  });

  it('no receipts at all also leaves remaining UNKNOWN — "no record" is not "nothing spent"', () => {
    const evaluation = evaluate([]);
    expect(evaluation.projectedTotal).toBeNull();
    expect(evaluation.remainingBudget).toBeNull();
  });

  it('the configured limit is still reported, because it is a configured fact', () => {
    const evaluation = evaluate([unpricedProvisional({ receiptId: 'r-limit-known' })]);
    expect(evaluation.totalLimit).not.toBeNull();
    expect(formatMoney(evaluation.totalLimit!)).toBe('$10.00');
  });

  it('a fully priced ledger still computes an exact remaining budget', () => {
    const evaluation = evaluate([receipt({ receiptId: 'r-exact', category: 'planning', amount: usd('2.15') })]);
    expect(formatMoney(evaluation.remainingBudget!)).toBe('$7.85');
    expect(evaluation.projectedTotalComplete).toBe(true);
  });
});

/* ------------------------------------------- 3. hard-limit evaluation */

describe('N-1 hard limit — a fabricated zero is never compared against the limit', () => {
  it('an unknown spend does not read as "within limit"', () => {
    const { evaluation, projection } = projectionFor([unpricedProvisional({ receiptId: 'r-hl-1' })]);
    expect(evaluation.hardLimitReached).toBe(false); // unknown is not a breach…
    expect(evaluation.status).toBe('unknown_due_to_missing_cost'); // …but it is not safety either
    expect(projection.remainingLabel).toBe(UNKNOWN_LABEL);
    expect(projection.remainingLabel).not.toContain('$10.00');
  });

  it('a LOWER-BOUND total that already breaches the limit still blocks', () => {
    const { evaluation } = projectionFor([
      receipt({ receiptId: 'r-hl-big', category: 'agent_execution', amount: usd('12.00') }),
      unpricedProvisional({ receiptId: 'r-hl-unknown' }),
    ]);
    expect(evaluation.hardLimitReached, 'incomplete data must not make a breach survivable').toBe(true);
    expect(evaluation.blockingReasons.join(' ')).toMatch(/hard limit/u);
  });

  it('the remaining figure is labeled a BOUND when the total is incomplete', () => {
    const { projection } = projectionFor([
      receipt({ receiptId: 'r-hl-part', category: 'planning', amount: usd('1.00') }),
      unpricedProvisional({ receiptId: 'r-hl-part-unknown' }),
    ]);
    expect(projection.projectedTotalLabel).toBe(`${AT_LEAST_PREFIX} $1.00`);
    expect(projection.remainingLabel).toBe(`${AT_MOST_PREFIX} $9.00`);
  });
});

/* --------------------------------------- 4. category-limit evaluation */

describe('N-1 category limits — an unpriced category never reports a full allowance', () => {
  const withCategoryLimit = budget({ categoryLimits: { model_inference: usd('2.00') } });

  it('a category whose only receipt is unpriced does NOT report the whole limit as remaining', () => {
    const { evaluation } = projectionFor([unpricedProvisional({ receiptId: 'r-cat-1' })], {
      budget: withCategoryLimit,
    });
    const category = evaluation.categoryEvaluations.find((c) => c.category === 'model_inference')!;
    expect(category.spent).toBeNull();
    expect(category.remaining, 'the full category limit must not be reported as remaining').toBeNull();
    expect(category.hasUnknownCost).toBe(true);
  });

  it('discloses the unpriced category in the warnings and the notices', () => {
    const { evaluation, projection } = projectionFor([unpricedProvisional({ receiptId: 'r-cat-2' })], {
      budget: withCategoryLimit,
    });
    expect(evaluation.warnings.join(' ')).toMatch(/model_inference category has at least one unpriced receipt/u);
    expect(projection.safeNotices.join(' ')).toMatch(/Model category has an unpriced receipt/u);
  });

  it('a priced category still computes an exact remaining allowance', () => {
    const { evaluation } = projectionFor(
      [receipt({ receiptId: 'r-cat-3', category: 'model_inference', amount: usd('0.75') })],
      { budget: withCategoryLimit },
    );
    const category = evaluation.categoryEvaluations.find((c) => c.category === 'model_inference')!;
    expect(formatMoney(category.spent!)).toBe('$0.75');
    expect(formatMoney(category.remaining!)).toBe('$1.25');
    expect(category.hasUnknownCost).toBe(false);
  });

  it('a category with NO receipts reports no spend and no remaining', () => {
    const { evaluation } = projectionFor(
      [receipt({ receiptId: 'r-cat-4', category: 'planning', amount: usd('0.10') })],
      { budget: withCategoryLimit },
    );
    const category = evaluation.categoryEvaluations.find((c) => c.category === 'model_inference')!;
    expect(category.spent).toBeNull();
    expect(category.remaining).toBeNull();
  });
});

/* ------------------------------------------------ 5. website projection */

describe('N-1 website — missing cost renders a word, never $0.00', () => {
  const render = (receipts: readonly RelayCostReceipt[], options: Parameters<typeof projectionFor>[1] = {}) =>
    renderToStaticMarkup(
      createElement(RelayMissionEconomics, { economics: projectionFor(receipts, options).projection }),
    );

  it('an unpriced ledger never renders a zero amount anywhere', () => {
    const html = render([unpricedProvisional({ receiptId: 'r-web-1' })]);
    expect(html).not.toContain('$0.00');
    expect(html).toContain(UNKNOWN_LABEL);
  });

  it('the configured budget is still shown — only the unknowns are unknown', () => {
    const html = render([unpricedProvisional({ receiptId: 'r-web-2' })]);
    expect(html).toContain('$10.00');
  });

  it('the provisional line says "+ unknown" rather than a bare amount', () => {
    const { projection } = projectionFor([
      unpricedProvisional({ receiptId: 'r-web-3a', amount: usd('0.40') }),
      unpricedProvisional({ receiptId: 'r-web-3b' }),
    ]);
    expect(projection.provisionalActualLabel).toBe('$0.40 + unknown');
  });

  it('the notice explaining the incomplete total is rendered', () => {
    const html = render([unpricedProvisional({ receiptId: 'r-web-4' })]);
    expect(html).toMatch(/provisional receipt has no recorded amount/u);
  });
});

/* ------------------------------------------------------ 6. CLI output */

describe('N-1 CLI — the terminal states exactly what the website states', () => {
  const WIDE = { width: 100, plain: true };

  it('prints Unknown, not $0.00, for an unpriced ledger', () => {
    const { evaluation, projection } = projectionFor([unpricedProvisional({ receiptId: 'r-cli-1' })]);
    const economics = renderMissionEconomics(projection, WIDE).join('\n');
    const budgetLines = renderMissionBudget(projection, evaluation, WIDE).join('\n');

    for (const text of [economics, budgetLines]) {
      expect(text).not.toContain('$0.00');
      expect(text).toContain(UNKNOWN_LABEL);
    }
  });

  it('prints the bound prefixes when the total is incomplete', () => {
    const { evaluation, projection } = projectionFor([
      receipt({ receiptId: 'r-cli-2', category: 'planning', amount: usd('1.00') }),
      unpricedProvisional({ receiptId: 'r-cli-2b' }),
    ]);
    const text = renderMissionBudget(projection, evaluation, WIDE).join('\n');
    expect(text).toContain(`${AT_LEAST_PREFIX} $1.00`);
    expect(text).toContain(`${AT_MOST_PREFIX} $9.00`);
  });

  it('the CLI and the website render the SAME labels — one projection, two renderers', () => {
    const { projection } = projectionFor([unpricedProvisional({ receiptId: 'r-cli-3' })]);
    const cli = renderMissionEconomics(projection, WIDE).join('\n');
    const html = renderToStaticMarkup(createElement(RelayMissionEconomics, { economics: projection }));
    for (const label of [projection.projectedTotalLabel, projection.remainingLabel]) {
      expect(cli, `CLI is missing "${label}"`).toContain(label);
      expect(html, `website is missing "${label}"`).toContain(label);
    }
    // The CLI upper-cases the status banner; the WORDS must still be the same.
    expect(cli.toUpperCase()).toContain(projection.statusLabel.toUpperCase());
    expect(html).toContain(projection.statusLabel);
  });
});
