import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { budgetStatusFromEvaluation, evaluateMissionBudget } from './budget-evaluation';
import { aggregateMissionEconomics } from './economics-aggregation';
import { projectMissionEconomics, UNKNOWN_LABEL, AT_LEAST_PREFIX, AT_MOST_PREFIX } from './economics-projection';
import {
  budget,
  ECON_T3,
  FIXTURE_MISSION,
  FIXTURE_PROJECT,
  FIXTURE_REVISION,
  mixedCurrencyReceipts,
  receipt,
  usd,
  warningReceipts,
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

/** Wide enough that the CLI prints label and value on ONE line, so a test can
    assert the pairing rather than the mere presence of two words. */
const PLAIN_WIDE = { width: 100, plain: true };

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

    // This test was NAMED for a rendered phrase and rendered nothing, so the
    // terminal printed `Hard limit  within limit` over this exact ledger and
    // nothing failed. It asserts the rendered line now.
    const text = renderMissionBudget(projection, evaluation, PLAIN_WIDE).join('\n');
    expect(text, 'the terminal must not claim a limit it never compared against').not.toMatch(/within limit/iu);
    expect(text).toMatch(/Hard limit\s+UNKNOWN/u);
    expect(text).toMatch(/Warning threshold\s+UNKNOWN/u);
    expect(text, 'unknown is not a breach either').not.toContain('REACHED — blocked');
  });

  it('a PARTIALLY priced ledger says the total is incomplete, not that it is within limit', () => {
    const { evaluation, projection } = projectionFor([
      receipt({ receiptId: 'r-hl-part-a', category: 'planning', amount: usd('1.00') }),
      unpricedProvisional({ receiptId: 'r-hl-part-b' }),
    ]);
    expect(evaluation.projectedTotal, 'a lower bound exists here').not.toBeNull();
    expect(evaluation.projectedTotalComplete).toBe(false);

    const text = renderMissionBudget(projection, evaluation, PLAIN_WIDE).join('\n');
    expect(text).toMatch(/Hard limit\s+UNKNOWN — the total is incomplete/u);
    expect(text).not.toMatch(/within limit/iu);
  });

  it('an EMPTY ledger has nothing to compare — "no record" is not "within limit"', () => {
    // projectedTotalComplete is vacuously true with no receipts, so the
    // completeness flag alone would have kept the old claim.
    const { evaluation, projection } = projectionFor([]);
    expect(evaluation.projectedTotal).toBeNull();
    expect(evaluation.projectedTotalComplete).toBe(true);

    const text = renderMissionBudget(projection, evaluation, PLAIN_WIDE).join('\n');
    expect(text).toMatch(/Hard limit\s+UNKNOWN — no cost total recorded/u);
    expect(text).not.toMatch(/within limit/iu);
  });

  it('a fully priced ledger still earns the words — they are not simply deleted', () => {
    const { evaluation, projection } = projectionFor([
      receipt({ receiptId: 'r-hl-priced', category: 'planning', amount: usd('2.15') }),
    ]);
    expect(evaluation.projectedTotalComplete).toBe(true);
    const text = renderMissionBudget(projection, evaluation, PLAIN_WIDE).join('\n');
    expect(text).toMatch(/Hard limit\s+within limit/u);
    expect(text).toMatch(/Warning threshold\s+not reached/u);
  });

  it('a real breach still prints REACHED — blocked, incomplete data or not', () => {
    const { evaluation, projection } = projectionFor([
      receipt({ receiptId: 'r-hl-breach', category: 'agent_execution', amount: usd('12.00') }),
      unpricedProvisional({ receiptId: 'r-hl-breach-unknown' }),
    ]);
    expect(evaluation.hardLimitReached).toBe(true);
    const text = renderMissionBudget(projection, evaluation, PLAIN_WIDE).join('\n');
    expect(text).toContain('REACHED — blocked');
    expect(text).not.toMatch(/within limit/iu);
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

  /* The per-category CLI line carried the same claim as the hard-limit line:
     `limitReached ? 'REACHED' : 'within limit'` reported a full allowance as
     intact for a category whose spend was a lower bound, or absent. */

  it('the CLI does not print "within limit" for a category whose receipt is unpriced', () => {
    const { evaluation, projection } = projectionFor([unpricedProvisional({ receiptId: 'r-cat-cli-1' })], {
      budget: withCategoryLimit,
    });
    const text = renderMissionBudget(projection, evaluation, PLAIN_WIDE).join('\n');
    expect(text).toMatch(/model_inference limit\s+UNKNOWN — an unpriced receipt in this category/u);
    expect(text).not.toMatch(/within limit/iu);
  });

  it('the CLI does not print "within limit" for a category with no cost recorded at all', () => {
    const { evaluation, projection } = projectionFor(
      [receipt({ receiptId: 'r-cat-cli-2', category: 'planning', amount: usd('0.10') })],
      { budget: withCategoryLimit },
    );
    const text = renderMissionBudget(projection, evaluation, PLAIN_WIDE).join('\n');
    expect(text).toMatch(/model_inference limit\s+UNKNOWN — no cost recorded in this category/u);
  });

  it('a priced category still prints within limit, and a breached one still prints REACHED', () => {
    const priced = projectionFor(
      [receipt({ receiptId: 'r-cat-cli-3', category: 'model_inference', amount: usd('0.75') })],
      { budget: withCategoryLimit },
    );
    expect(renderMissionBudget(priced.projection, priced.evaluation, PLAIN_WIDE).join('\n'))
      .toMatch(/model_inference limit\s+within limit/u);

    const breached = projectionFor(
      [receipt({ receiptId: 'r-cat-cli-4', category: 'model_inference', amount: usd('2.50') })],
      { budget: withCategoryLimit },
    );
    const text = renderMissionBudget(breached.projection, breached.evaluation, PLAIN_WIDE).join('\n');
    expect(text).toMatch(/model_inference limit\s+REACHED/u);
    // The TOTAL limit is a separate figure and is genuinely not breached by
    // $2.50 of $10.00, so its line still reads "within limit" — the category
    // breach is reported on its own line and in BLOCKING, not by softening a
    // different limit's state.
    expect(text).toMatch(/Hard limit\s+within limit/u);
    expect(text).toContain('the model_inference category limit has been reached');
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

/* ------------------------------------- 7. the STORED status (LOW-4) */

/**
 * `budgetStatusFromEvaluation` derives the status to STORE on the budget
 * record. It used to map both unknown-shaped evaluation statuses to
 *
 *     evaluation.warningThresholdReached ? 'warning' : 'under_budget'
 *
 * and `warningThresholdReached` is false in both of them — the
 * currency-conflict evaluation hardcodes it, and the evaluator returns
 * `warning` before it can reach the unknown-cost branch. So an unknown ALWAYS
 * became a stored "under budget": the same fabrication as N-1, one layer
 * further on. `RelayBudgetStatus` carries no truthful "unknown", so the
 * function now returns `null` — no reading is derivable — and the caller must
 * keep the budget's own stored status rather than invent one.
 */
describe('LOW-4 stored status — an unknown never becomes "under budget"', () => {
  const unknownEvaluation = () =>
    evaluate([
      receipt({ receiptId: 'r-store-known', category: 'planning', amount: usd('1.00') }),
      unpricedProvisional({ receiptId: 'r-store-unpriced' }),
    ]);

  it('missing cost data derives NO stored status — least of all under_budget', () => {
    const evaluation = unknownEvaluation();
    expect(evaluation.status).toBe('unknown_due_to_missing_cost');
    expect(budgetStatusFromEvaluation(evaluation)).not.toBe('under_budget');
    expect(budgetStatusFromEvaluation(evaluation)).toBeNull();
  });

  it('the old ternary could never have saved it — warningThresholdReached is false here', () => {
    // Proves the repaired branch was not merely rare: `warning` was
    // unreachable, so `under_budget` was the ONLY value the old mapping
    // produced for an unknown.
    expect(unknownEvaluation().warningThresholdReached).toBe(false);
    expect(evaluateMissionBudget({ budget: budget(), receipts: mixedCurrencyReceipts(), missionId: FIXTURE_MISSION })
      .warningThresholdReached).toBe(false);
  });

  it('a currency conflict derives no stored status either — two currencies are not a reading', () => {
    const evaluation = evaluateMissionBudget({
      budget: budget(),
      receipts: mixedCurrencyReceipts(),
      missionId: FIXTURE_MISSION,
    });
    expect(evaluation.status).toBe('currency_conflict');
    expect(budgetStatusFromEvaluation(evaluation)).toBeNull();
  });

  it('a KNOWN, non-breaching ledger still stores under_budget', () => {
    const evaluation = evaluate([receipt({ receiptId: 'r-store-ok', category: 'planning', amount: usd('2.15') })]);
    expect(evaluation.projectedTotalComplete).toBe(true);
    expect(budgetStatusFromEvaluation(evaluation)).toBe('under_budget');
  });

  it('a known ledger at the warning threshold still stores warning', () => {
    const evaluation = evaluate(warningReceipts());
    expect(evaluation.warningThresholdReached).toBe(true);
    expect(budgetStatusFromEvaluation(evaluation)).toBe('warning');
  });

  it('a known BREACHING ledger still stores the limit status it earned', () => {
    const overTotal = evaluate([receipt({ receiptId: 'r-store-over', category: 'agent_execution', amount: usd('12.00') })]);
    expect(overTotal.hardLimitReached).toBe(true);
    expect(budgetStatusFromEvaluation(overTotal)).toBe('exhausted');

    const overCategory = evaluate(
      [receipt({ receiptId: 'r-store-cat', category: 'model_inference', amount: usd('2.50') })],
      { budget: budget({ categoryLimits: { model_inference: usd('2.00') } }) },
    );
    expect(budgetStatusFromEvaluation(overCategory)).toBe('hard_limit_reached');
  });

  it('no budget at all stores not_configured — never a reading of a limit that does not exist', () => {
    expect(budgetStatusFromEvaluation(evaluate([], { budget: null }))).toBe('not_configured');
  });

  it('neither surface changed: an unknown ledger still renders UNKNOWN, on both', () => {
    // The stored status is a persistence concern. What an operator READS comes
    // from the evaluation status, and this repair must not have moved it.
    const { evaluation, projection } = projectionFor([unpricedProvisional({ receiptId: 'r-store-render' })]);
    const html = renderToStaticMarkup(createElement(RelayMissionEconomics, { economics: projection }));
    const WIDE = { width: 100, plain: true };
    const cliEconomics = renderMissionEconomics(projection, WIDE).join('\n');
    const cliBudget = renderMissionBudget(projection, evaluation, WIDE).join('\n');

    expect(projection.statusLabel).toMatch(/^Unknown/u);
    expect(html).toContain(projection.statusLabel);
    expect(cliEconomics.toUpperCase()).toContain(projection.statusLabel.toUpperCase());
    for (const text of [html, cliEconomics, cliBudget]) expect(text).not.toMatch(/under budget/iu);
  });
});

/* ------------------------- 8. the EMPTY ledger (vacuous completeness) */

/**
 * An EMPTY ledger — a budget configured, ZERO receipts — was reported as a
 * positive `under_budget` claim.
 *
 * `projectedTotalComplete` is computed as `unpricedCountable.length === 0`, so
 * with no receipts at all it is VACUOUSLY true: there is nothing unpriced
 * because there is nothing. {@link deriveStatus} then fell through its unknown
 * branch and returned `under_budget`, while `projectedTotal` was `null` — a
 * claim that the mission is within a limit Relay never compared anything
 * against.
 *
 * The render layer already told the truth about this ledger: the CLI's MISSION
 * BUDGET block printed `Projected total Unknown` and `Hard limit UNKNOWN — no
 * cost total recorded` for the very same evaluation whose status banner read
 * "Under budget". Completeness is not existence, so `deriveStatus` now requires
 * the projected total to EXIST before `under_budget` can be earned.
 *
 * Precedence is unchanged and deliberately so: hard limit, category limit,
 * approval and warning are all still decided BEFORE the unknown branch. An
 * incomplete total may never soften a breach into an unknown.
 */
describe('EMPTY LEDGER — a configured budget with no receipts is not "under budget"', () => {
  const WIDE = { width: 100, plain: true };

  it('a configured budget with ZERO receipts is unknown, not under budget', () => {
    const evaluation = evaluate([]);

    // The vacuous flag that carried the old claim is still vacuously true —
    // this test pins that the STATUS no longer rests on it.
    expect(evaluation.projectedTotalComplete, 'completeness is vacuous with no receipts').toBe(true);
    expect(evaluation.projectedTotal, 'there is no total to compare against').toBeNull();

    expect(evaluation.status).toBe('unknown_due_to_missing_cost');
    expect(evaluation.status, 'an empty ledger is not evidence of being within budget').not.toBe('under_budget');
  });

  it('the same empty ledger derives NO stored status', () => {
    expect(budgetStatusFromEvaluation(evaluate([]))).toBeNull();
    expect(budgetStatusFromEvaluation(evaluate([]))).not.toBe('under_budget');
  });

  it('an empty ledger renders UNKNOWN on both surfaces, and the two CLI blocks agree', () => {
    const { evaluation, projection } = projectionFor([]);
    const html = renderToStaticMarkup(createElement(RelayMissionEconomics, { economics: projection }));
    const cliEconomics = renderMissionEconomics(projection, WIDE).join('\n');
    const cliBudget = renderMissionBudget(projection, evaluation, WIDE).join('\n');

    // The MISSION BUDGET block always said this much.
    expect(cliBudget).toMatch(/Projected total\s+Unknown/u);
    expect(cliBudget).toMatch(/Hard limit\s+UNKNOWN — no cost total recorded/u);

    // Now the status banner, the website and the stored status say it too.
    expect(projection.statusLabel).toMatch(/^Unknown/u);
    expect(html).toContain(projection.statusLabel);
    expect(cliEconomics.toUpperCase()).toContain(projection.statusLabel.toUpperCase());
    for (const text of [html, cliEconomics, cliBudget]) {
      expect(text, 'no surface may claim a budget reading it never computed').not.toMatch(/under budget/iu);
    }
  });

  it('a configured budget with ALL receipts priced still reports under budget', () => {
    const evaluation = evaluate([
      receipt({ receiptId: 'r-empty-priced-a', category: 'planning', amount: usd('0.20') }),
      receipt({ receiptId: 'r-empty-priced-b', category: 'model_inference', amount: usd('1.95') }),
    ]);
    expect(evaluation.projectedTotal).not.toBeNull();
    expect(formatMoney(evaluation.projectedTotal!)).toBe('$2.15');
    expect(evaluation.status).toBe('under_budget');
    expect(budgetStatusFromEvaluation(evaluation)).toBe('under_budget');
  });

  it('an unpriced receipt still yields unknown — existing behaviour, still pinned', () => {
    const evaluation = evaluate([
      receipt({ receiptId: 'r-empty-mix', category: 'planning', amount: usd('1.00') }),
      unpricedProvisional({ receiptId: 'r-empty-mix-unpriced' }),
    ]);
    expect(evaluation.projectedTotalComplete).toBe(false);
    expect(evaluation.status).toBe('unknown_due_to_missing_cost');
  });

  it('ORDERING — a lower-bound total that breaches the hard limit still BLOCKS', () => {
    // The unknown branch must never be reached here. Incomplete cost data may
    // not soften a breach into an "unknown".
    const evaluation = evaluate([
      receipt({ receiptId: 'r-empty-breach', category: 'agent_execution', amount: usd('12.00') }),
      unpricedProvisional({ receiptId: 'r-empty-breach-unknown' }),
    ]);
    expect(evaluation.projectedTotalComplete).toBe(false);
    expect(evaluation.hardLimitReached).toBe(true);
    expect(evaluation.status, 'a breach outranks an unknown').toBe('exhausted');
    expect(evaluation.blockingReasons.join(' ')).toMatch(/hard limit/u);
  });

  it('ORDERING — a category limit reached still outranks an unknown total', () => {
    const evaluation = evaluate(
      [
        receipt({ receiptId: 'r-empty-cat', category: 'model_inference', amount: usd('2.50') }),
        unpricedProvisional({ receiptId: 'r-empty-cat-unknown', category: 'planning' }),
      ],
      { budget: budget({ categoryLimits: { model_inference: usd('2.00') } }) },
    );
    expect(evaluation.projectedTotalComplete).toBe(false);
    expect(evaluation.categoryEvaluations.find((c) => c.category === 'model_inference')!.limitReached).toBe(true);
    expect(evaluation.status).toBe('hard_limit_reached');
    expect(budgetStatusFromEvaluation(evaluation)).toBe('hard_limit_reached');
  });

  it('ORDERING — approval and warning are still decided before the unknown branch', () => {
    const approval = evaluateMissionBudget({
      budget: budget({ approvalThreshold: usd('8.00') }),
      receipts: [
        receipt({ receiptId: 'r-empty-approval', category: 'agent_execution', amount: usd('8.50') }),
        unpricedProvisional({ receiptId: 'r-empty-approval-unknown' }),
      ],
      missionId: FIXTURE_MISSION,
    });
    expect(approval.projectedTotalComplete).toBe(false);
    expect(approval.status).toBe('approval_required');

    const warning = evaluate([
      ...warningReceipts(),
      unpricedProvisional({ receiptId: 'r-empty-warning-unknown' }),
    ]);
    expect(warning.projectedTotalComplete).toBe(false);
    expect(warning.warningThresholdReached).toBe(true);
    expect(warning.status).toBe('warning');
  });

  it('NO BUDGET is still not_configured — an absent budget never becomes an unknown', () => {
    const noBudget = evaluate([], { budget: null });
    expect(noBudget.status).toBe('not_configured');
    expect(budgetStatusFromEvaluation(noBudget)).toBe('not_configured');

    // A budget record that exists but configures no total limit is the same
    // fact: nothing was configured, so there is nothing to be unknown about.
    const noLimit = evaluate([], { budget: budget({ totalLimit: null }) });
    expect(noLimit.status).toBe('not_configured');
    expect(budgetStatusFromEvaluation(noLimit)).toBe('not_configured');
  });

  it('an empty ledger under a budget with NO total limit stays not_configured, receipts or not', () => {
    const priced = evaluate(
      [receipt({ receiptId: 'r-empty-nolimit', category: 'planning', amount: usd('1.00') })],
      { budget: budget({ totalLimit: null }) },
    );
    expect(priced.status).toBe('not_configured');
  });
});
