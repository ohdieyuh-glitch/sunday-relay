import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';

import { RelayMissionEconomics } from './RelayMissionEconomics';
import {
  aggregateMissionEconomics,
  evaluateMissionBudget,
  projectMissionEconomics,
} from '../../mission/economics';
import {
  budget,
  ECON_T3,
  FIXTURE_MISSION,
  FIXTURE_PROJECT,
  FIXTURE_REVISION,
  hardLimitReceipts,
  underBudgetReceipts,
  unknownPendingReceipts,
  usd,
  warningReceipts,
} from '../../mission/economics/economics-fixtures';
import type { RelayCostReceipt } from '../../mission/economics';

function projectionFor(
  receipts: readonly RelayCostReceipt[],
  options: { budget?: ReturnType<typeof budget> | null; proposedCost?: ReturnType<typeof usd> } = {},
) {
  const evaluation = evaluateMissionBudget({
    budget: options.budget === undefined ? budget() : options.budget,
    receipts,
    missionId: FIXTURE_MISSION,
    proposedCost: options.proposedCost ?? null,
  });
  return projectMissionEconomics(
    aggregateMissionEconomics({
      projectId: FIXTURE_PROJECT,
      missionId: FIXTURE_MISSION,
      missionRevision: FIXTURE_REVISION,
      receipts,
      budgetEvaluation: evaluation,
      generatedAt: ECON_T3,
    }),
  );
}

const render = (receipts: readonly RelayCostReceipt[], options = {}) =>
  renderToStaticMarkup(
    createElement(RelayMissionEconomics, { economics: projectionFor(receipts, options) }),
  );

describe('mission economics surface', () => {
  it('renders every headline figure from the shared projection', () => {
    const html = render(underBudgetReceipts());
    expect(html).toContain('MISSION ECONOMICS');
    expect(html).toContain('Under budget');
    expect(html).toContain('$10.00'); // budget
    expect(html).toContain('$2.15'); // finalized actual
    expect(html).toContain('$7.85'); // remaining
    expect(html).toContain('Complete'); // completeness
  });

  it('renders the full cost breakdown', () => {
    const html = render(underBudgetReceipts());
    for (const label of [
      'Planning', 'Model', 'Agent execution', 'Tools', 'Workspace',
      'Testing', 'Build', 'Review', 'Repair', 'Retry', 'Infrastructure',
      'Human intervention',
    ]) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain('$0.80'); // model
    expect(html).toContain('$0.15'); // testing
  });

  it('NEVER renders a missing amount as $0.00', () => {
    const html = render([], { budget: null });
    expect(html).toContain('Not available');
    expect(html).toContain('Not configured');
    expect(html).not.toContain('$0.00');
  });

  it('shows unknown pending cost truthfully', () => {
    const html = render(unknownPendingReceipts());
    expect(html).toContain('unknown');
    expect(html).not.toContain('$0.00');
    expect(html).toContain('lower bound');
  });

  it('surfaces the warning state', () => {
    const html = render(warningReceipts());
    expect(html).toContain('Warning threshold reached');
    expect(html).toContain('rpw-economics--warning');
  });

  it('surfaces the approval state', () => {
    const html = render(warningReceipts(), {
      budget: budget({ approvalThreshold: usd('8.00') }),
    });
    expect(html).toContain('Approval required');
    expect(html).toContain('rpw-economics--approval');
  });

  it('surfaces the hard-limit state', () => {
    const html = render(hardLimitReceipts(), { proposedCost: usd('0.50') });
    expect(html).toContain('rpw-economics--hard-limit');
    expect(html).toMatch(/Hard limit reached|Budget exhausted/u);
  });

  it('renders the verified mission cost as unavailable until it is earned', () => {
    const html = render(underBudgetReceipts());
    expect(html).toContain('Verified mission cost');
    expect(html).toContain('Verified mission cost unavailable');
  });

  it('exposes optional actions only when handlers are supplied', () => {
    const withoutActions = render(underBudgetReceipts());
    expect(withoutActions).not.toContain('REQUEST BUDGET CHANGE');

    const withActions = renderToStaticMarkup(
      createElement(RelayMissionEconomics, {
        economics: projectionFor(underBudgetReceipts()),
        onRequestBudgetChange: () => {},
        onViewReceipts: () => {},
      }),
    );
    expect(withActions).toContain('VIEW RECEIPTS');
    expect(withActions).toContain('REQUEST BUDGET CHANGE');
  });

  it('is labelled for assistive technology and announces its status', () => {
    const html = render(underBudgetReceipts());
    expect(html).toContain('aria-label="Mission economics"');
    expect(html).toContain('role="status"');
  });

  it('never renders a credential', () => {
    const html = render(underBudgetReceipts());
    for (const pattern of [/\bsk-[A-Za-z0-9]{8,}/u, /Bearer\s+\S+/u, /-----BEGIN/u]) {
      expect(pattern.test(html)).toBe(false);
    }
  });
});

describe('mission economics styling', () => {
  const css = readFileSync('src/relay/ui/project-workspace/relay-project-workspace.css', 'utf8');

  it('cannot cause horizontal overflow', () => {
    expect(/\.rpw-economics\s*\{[^}]*overflow-x:\s*hidden/u.test(css)).toBe(true);
    expect(/\.rpw-economics\s*\{[^}]*max-width:\s*100%/u.test(css)).toBe(true);
  });

  it('keeps tap targets usable on mobile', () => {
    expect(/\.rpw-economics-action\s*\{[^}]*min-height:\s*44px/u.test(css)).toBe(true);
  });

  it('adds no external asset and no forbidden colour', () => {
    const block = css.slice(css.indexOf('.rpw-economics'));
    expect(/url\(/u.test(block)).toBe(false);
    expect(/#ffd700|#ffc107/iu.test(block)).toBe(false);
  });

  it('adapts to a wider viewport without a new layout system', () => {
    expect(/@media \(min-width: 720px\)[^}]*\{[\s\S]*?\.rpw-economics-categories/u.test(css)).toBe(true);
  });
});
