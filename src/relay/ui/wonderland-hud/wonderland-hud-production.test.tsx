/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import {
  WONDERLAND_USAGE_REPORT_SCHEMA_V1,
  emptyWonderlandUsageAuthority,
} from '../../mission/wonderland/wonderland-usage-authority';
import type { WonderlandUsageReport } from '../../mission/wonderland/wonderland-usage-authority';
import { RelayWorld } from '../relay-world';
import { WonderlandUsageHudView } from './WonderlandUsageHudView';
import { useWonderlandUsage } from './useWonderlandUsage';
import type { WonderlandUsageController } from './useWonderlandUsage';

/**
 * THE RULE: SIMULATED DATA NEVER LOADS ON NORMAL PRODUCTION NAVIGATION.
 *
 * The other usage bar already had this test (`usage-integration.test.tsx`
 * asserts an offline production render says UNAVAILABLE and carries no
 * simulated label). The Wonderland HUD sat on the same navigation path and was
 * handed a simulated fixture directly, so it had no such guard. This is that
 * guard, and it is the reason the fixture is no longer reachable from the app.
 */

const PROJECT = 'project-1';
const NOW = '2026-09-07T10:00:00.000Z';

afterEach(() => {
  cleanup();
});

describe('the HUD on the real Relay stage', () => {
  it('shows no simulated figure and no simulated label', () => {
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('SIMULATED');
    expect(body).toContain('NO USAGE AUTHORITY REPORTING');
  });

  it('says UNKNOWN rather than a number nobody reported', () => {
    // Unknown is not zero. A meter reading 0 would be a claim about a budget.
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    const body = document.body.textContent ?? '';
    expect(body).toContain('UNKNOWN');
    expect(body).not.toMatch(/\b0 ?\/ ?0\b/);
  });

  it('draws no meter at all on the arrival stage', () => {
    // Aquala has no capacity to report; a meter there would be furniture
    // pretending to be a reading.
    render(createElement(RelayWorld, { initialStage: 'aquala' as const }));
    expect(document.body.textContent ?? '').not.toContain('NO USAGE AUTHORITY REPORTING');
  });
});

/* ------------------------------------------------------------- the hook */

let controller: WonderlandUsageController;

function Harness(props: { readonly now: string }): JSX.Element {
  controller = useWonderlandUsage({ projectId: PROJECT, now: () => props.now });
  return createElement(WonderlandUsageHudView, {
    hud: controller.hud,
    status: controller.status,
    instanceId: 'test',
  });
}

/**
 * The two channels carry DIFFERENT figures on purpose.
 *
 * They are separate instruments with separate tier ladders, and a fixture that
 * gave them the same numbers would pass just as well against an implementation
 * that read one channel twice.
 */
const report = (overrides: Partial<WonderlandUsageReport> = {}): WonderlandUsageReport => {
  const compound = {
    current: 300,
    maximum: 500,
    reference: 500,
    tierId: 'tier-compound-1',
    tierLabel: 'Compound tier one',
    unitLabel: 'units',
  };
  const single = {
    current: 80,
    maximum: 100,
    reference: 400,
    tierId: 'tier-single-1',
    tierLabel: 'Single tier one',
    unitLabel: 'units',
  };
  return {
    schemaVersion: WONDERLAND_USAGE_REPORT_SCHEMA_V1,
    projectId: PROJECT,
    revision: 1,
    reportedAtIso: NOW,
    authorityId: 'authority-1',
    unavailableReason: null,
    compoundAgent: compound,
    singleAgent: single,
    ...overrides,
  };
};

describe('the hook that feeds it', () => {
  it('starts at not-reported, which is the honest state of this build', () => {
    render(createElement(Harness, { now: NOW }));
    expect(controller.status.reading).toBe('not_reported');
    expect(controller.status.revision).toBe(0);
    // `simulated` is a DO-NOT-TRUST flag (`provenance !== 'live'`), not a claim
    // that anything was fabricated — so an unreported meter carries it, and the
    // HUD prints the reading label rather than the word SIMULATED because a
    // status was supplied. Both halves matter: the flag stays conservative and
    // the surface still says the true reason there is nothing to show.
    expect(controller.hud.compoundAgent.simulated).toBe(true);
    expect(controller.hud.compoundAgent.capacityUnits.known).toBe(false);
    expect(controller.hud.compoundAgent.capacityUnits.value).toBeNull();
  });

  it('shows real figures once an authority actually reports', () => {
    render(createElement(Harness, { now: NOW }));
    act(() => {
      controller.report(report());
    });
    expect(controller.status.reading).toBe('known');
    expect(controller.status.authorityId).toBe('authority-1');
    // The meter drains: 300 of 500 left is 200 spent.
    expect(controller.hud.compoundAgent.usedUnits.value).toBe(200);
    expect(controller.hud.compoundAgent.capacityUnits.value).toBe(500);
    expect(controller.hud.compoundAgent.simulated).toBe(false);
    // The readout shows what is LEFT over the ceiling, in the authority's own
    // unit word — 300 of 500, not the 200 spent. The bar and the number must
    // measure the same thing.
    expect(screen.getByText('300 / 500 units')).toBeTruthy();
    expect(screen.getByText('80 / 100 units')).toBeTruthy();
    // Per-channel ceilings: the single agent's own ladder tops out at 400, so
    // its full tier draws as a quarter arc rather than being squashed against
    // the compound agent's 500.
    expect(controller.hud.singleAgent.capacityUnits.value).toBe(100);
    expect(controller.hud.singleAgent.referenceCapacityUnits.value).toBe(400);
  });

  it('runs the authority`s refusals, because there is no path around them', () => {
    // This is the real reason the fixture could not stay: a surface that can
    // put figures on screen without passing through `applyWonderlandUsageReport`
    // has a second, unguarded way in.
    render(createElement(Harness, { now: NOW }));

    act(() => {
      controller.report(report({ projectId: 'project-other', current: 1 } as never));
    });
    expect(controller.status.foreignProjectReportsRejected).toBe(1);
    expect(controller.status.reading).toBe('not_reported');

    act(() => {
      controller.report(report({ schemaVersion: 'wrong' as never }));
    });
    expect(controller.status.malformedReportsRejected).toBe(1);
    expect(controller.status.reading).toBe('not_reported');
  });

  it('refuses a revision that has already been superseded', () => {
    render(createElement(Harness, { now: NOW }));
    act(() => {
      controller.report(report({ revision: 4 }));
    });
    act(() => {
      controller.report(
        report({ revision: 2, compoundAgent: { ...report().compoundAgent, current: 9 } }),
      );
    });
    expect(controller.status.staleRevisionsRejected).toBe(1);
    expect(controller.status.revision).toBe(4);
  });

  it('goes stale on the clock, and says the figures are last-reported', () => {
    const { rerender } = render(createElement(Harness, { now: NOW }));
    act(() => {
      controller.report(report());
    });
    expect(controller.status.reading).toBe('known');

    rerender(createElement(Harness, { now: '2026-09-07T18:00:00.000Z' }));
    expect(controller.status.reading).toBe('stale');
    expect(screen.getByText(/STALE · LAST REPORTED FIGURES/)).toBeTruthy();
  });

  it('reports an authority that is present and cannot supply figures', () => {
    render(createElement(Harness, { now: NOW }));
    act(() => {
      controller.report(report({ unavailableReason: 'The metering service is down.' }));
    });
    expect(controller.status.reading).toBe('unavailable');
    expect(screen.getByText('The metering service is down.')).toBeTruthy();
    expect(document.body.textContent ?? '').toContain('UNKNOWN');
  });

  it('never fabricates: an empty authority projects the same shape as a full one', () => {
    const empty = emptyWonderlandUsageAuthority({ projectId: PROJECT });
    expect(empty.report).toBeNull();
    render(createElement(Harness, { now: NOW }));
    // Every figure is the carrier, not a bare number, so an absent value is an
    // explicit `known: false` with a reason — never a 0 the HUD would draw.
    for (const meter of [controller.hud.compoundAgent, controller.hud.singleAgent]) {
      for (const figure of [meter.capacityUnits, meter.usedUnits]) {
        expect(figure.known).toBe(false);
        expect(figure.value).toBeNull();
        expect(figure.reason).toBe('not_observed');
      }
    }
  });
});
