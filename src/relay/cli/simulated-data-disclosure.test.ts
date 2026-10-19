import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import {
  buildMissionEconomicsFixture,
  renderMissionBudget,
  renderMissionEconomics,
  renderMissionReceipts,
} from './mission-economics';
import { runCli } from './main';
import { RelayMissionEconomics } from '../ui/project-workspace/RelayMissionEconomics';
import {
  MIXED_DATA_LABEL,
  SIMULATED_DATA_LABEL,
  aggregateMissionEconomics,
  evaluateMissionBudget,
  projectMissionEconomics,
} from '../mission';
import type { CliIo } from './main';

/**
 * SIMULATED CLI DISCLOSURE (N-5).
 *
 * `relay mission economics`, `relay mission budget` and `relay mission
 * receipts` render a deterministic DEVELOPMENT FIXTURE: no mission ran, no
 * provider was called and no money was spent. They printed those figures with
 * no disclosure at all, so the output read as a real user mission — and the
 * fixture even claimed `provider_reported` provenance, which is a fabricated
 * source for synthetic data.
 *
 * The repair puts the disclosure in the DATA. Fixture receipts declare
 * `source: 'development_fixture'`, the shared projection derives
 * `dataSource`/`dataSourceLabel` from them, and both surfaces render that
 * label — so it cannot be dropped by a caller that forgets a flag.
 */

const WIDE = { width: 100, plain: true };

function fakeIo(): { io: CliIo; lines: string[] } {
  const lines: string[] = [];
  const io: CliIo = {
    out: (line: string) => lines.push(line),
    env: { PATH: process.env.PATH },
    isTTY: false,
  };
  return { io, lines };
}

/* ------------------------------------------------- the fixture is honest */

describe('N-5 — the development fixture declares itself', () => {
  it('every fixture receipt carries source "development_fixture"', () => {
    const { receipts } = buildMissionEconomicsFixture();
    expect(receipts.length).toBeGreaterThan(0);
    for (const receipt of receipts) {
      expect(receipt.source, `${receipt.receiptId} must not claim a real provider source`).toBe(
        'development_fixture',
      );
    }
  });

  it('no fixture receipt claims a provider usage reference it does not have', () => {
    for (const receipt of buildMissionEconomicsFixture().receipts) {
      expect(receipt.providerUsageReferenceId, receipt.receiptId).toBeUndefined();
    }
  });

  it('the shared projection derives the disclosure from the receipts', () => {
    const { projection } = buildMissionEconomicsFixture();
    expect(projection.dataSource).toBe('development_fixture');
    expect(projection.dataSourceLabel).toBe(SIMULATED_DATA_LABEL);
  });

  it('the label names all three required words', () => {
    for (const phrase of ['SIMULATED DATA', 'DEVELOPMENT FIXTURE', 'NOT LIVE MISSION DATA']) {
      expect(SIMULATED_DATA_LABEL).toContain(phrase);
    }
  });
});

/* ------------------------------------------------------ CLI renderers */

describe('N-5 — every mission-economics renderer discloses the fixture', () => {
  const { projection, evaluation, receipts } = buildMissionEconomicsFixture();

  const surfaces: Array<[string, string[]]> = [
    ['relay mission economics', renderMissionEconomics(projection, WIDE)],
    ['relay mission budget', renderMissionBudget(projection, evaluation, WIDE)],
    ['relay mission receipts', renderMissionReceipts(receipts, WIDE)],
  ];

  for (const [command, lines] of surfaces) {
    it(`${command} states SIMULATED DATA — DEVELOPMENT FIXTURE — NOT LIVE MISSION DATA`, () => {
      const text = lines.join('\n');
      expect(text).toContain('SIMULATED DATA');
      expect(text).toContain('DEVELOPMENT FIXTURE');
      expect(text).toContain('NOT LIVE MISSION DATA');
    });

    it(`${command} shows the disclosure BEFORE any figure`, () => {
      const text = lines.join('\n');
      const disclosureAt = text.indexOf('SIMULATED DATA');
      const firstAmountAt = text.search(/\$\d/u);
      expect(disclosureAt).toBeGreaterThan(-1);
      if (firstAmountAt >= 0) {
        expect(disclosureAt, 'the operator must know what they are reading first').toBeLessThan(firstAmountAt);
      }
    });
  }

  it('the economics output also says no live mission data source is configured', () => {
    // Wrapped to the terminal width, so compare on normalised whitespace.
    const text = renderMissionEconomics(projection, WIDE).join(' ').replace(/\s+/gu, ' ');
    expect(text).toMatch(/no live mission economics source configured in this build/iu);
    expect(text).toMatch(/no mission ran, no provider was called, and no money was spent/iu);
  });

  it('the disclosure survives a narrow terminal', () => {
    const text = renderMissionEconomics(projection, { width: 40, plain: true }).join('\n');
    expect(text).toContain('SIMULATED DATA');
  });
});

/* ------------------------------------------------------ end-to-end CLI */

describe('N-5 — the real commands disclose it', () => {
  for (const action of ['economics', 'budget', 'receipts']) {
    it(`\`relay mission ${action}\` prints the disclosure`, async () => {
      const { io, lines } = fakeIo();
      const code = await runCli(['mission', action], io);
      const text = lines.join('\n');
      expect(code).toBe(0);
      expect(text).toContain('SIMULATED DATA');
      expect(text).toContain('NOT LIVE MISSION DATA');
    });
  }

  it('no provider, network or payment call is made', async () => {
    const { io, lines } = fakeIo();
    await runCli(['mission', 'economics'], io);
    const text = lines.join('\n');
    expect(text).not.toMatch(/https?:\/\//u);
    expect(text).not.toMatch(/api[._-]?key|authorization|bearer/iu);
  });
});

/* -------------------------------------------------- website/CLI parity */

describe('N-5 — the website states exactly what the CLI states', () => {
  it('renders the same disclosure label', () => {
    const { projection } = buildMissionEconomicsFixture();
    const html = renderToStaticMarkup(createElement(RelayMissionEconomics, { economics: projection }));
    expect(html).toContain(SIMULATED_DATA_LABEL);
    expect(renderMissionEconomics(projection, WIDE).join('\n')).toContain(SIMULATED_DATA_LABEL);
  });

  it('LIVE data carries no banner on either surface', () => {
    // The same fixture scenario with genuinely live-sourced receipts must
    // produce no disclosure at all — otherwise the banner would be decorative
    // rather than meaningful.
    const { receipts } = buildMissionEconomicsFixture();
    const live = receipts.map((r) => ({ ...r, source: 'adapter_observed' as const }));
    const evaluation = evaluateMissionBudget({ budget: null, receipts: live, missionId: 'mission-live' });
    const projection = projectMissionEconomics(
      aggregateMissionEconomics({
        projectId: 'project-live',
        missionId: 'mission-live',
        missionRevision: 1,
        receipts: live,
        budgetEvaluation: evaluation,
        generatedAt: '2026-07-30T00:00:00.000Z',
      }),
    );
    expect(projection.dataSource).toBe('live_mission');
    expect(projection.dataSourceLabel).toBeNull();

    const html = renderToStaticMarkup(createElement(RelayMissionEconomics, { economics: projection }));
    expect(html).not.toContain('SIMULATED DATA');
    expect(renderMissionEconomics(projection, WIDE).join('\n')).not.toContain('SIMULATED DATA');
  });

  it('a PARTLY simulated ledger says so rather than picking a side', () => {
    const { receipts } = buildMissionEconomicsFixture();
    const mixed = receipts.map((r, index) =>
      index === 0 ? { ...r, source: 'adapter_observed' as const } : r,
    );
    const evaluation = evaluateMissionBudget({ budget: null, receipts: mixed, missionId: 'mission-mixed' });
    const projection = projectMissionEconomics(
      aggregateMissionEconomics({
        projectId: 'project-mixed',
        missionId: 'mission-mixed',
        missionRevision: 1,
        receipts: mixed,
        budgetEvaluation: evaluation,
        generatedAt: '2026-07-30T00:00:00.000Z',
      }),
    );
    expect(projection.dataSource).toBe('mixed');
    expect(projection.dataSourceLabel).toBe(MIXED_DATA_LABEL);
    expect(renderMissionEconomics(projection, WIDE).join('\n')).toContain('PARTLY SIMULATED');
    expect(renderMissionReceipts(mixed, WIDE).join('\n')).toContain('PARTLY SIMULATED');
  });
});
