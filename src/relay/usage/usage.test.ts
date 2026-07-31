import { describe, expect, it } from 'vitest';
import {
  RELAY_USAGE_THRESHOLDS,
  type RelayUsageSnapshot,
} from './usage-contracts';
import {
  USAGE_OFFLINE_LABEL,
  USAGE_SIMULATED_LABEL,
  cubsClaimsLive,
  formatReset,
  projectUsageBar,
  projectUsageDetail,
} from './usage-projection';
import {
  EMPTY_USAGE_LATCH,
  deriveUsageThresholdEvents,
} from './usage-thresholds';
import { demoUsageSnapshot, offlineUsageSnapshot } from './usage-fixtures';

/**
 * Canonical usage domain — truthfulness of the snapshot projections and the
 * once-per-reset-window threshold derivation. Pure functions, injected time.
 */

const NOW = '2026-07-31T12:00:00.000Z';

function liveSnapshot(overrides: Partial<RelayUsageSnapshot> = {}): RelayUsageSnapshot {
  return {
    missionContracts: {
      used: 11,
      limit: 25,
      remaining: 14,
      resetAt: '2026-08-30T12:00:00.000Z',
      status: 'available',
    },
    fiveHour: { percentUsed: 38, resetAt: '2026-07-31T14:14:00.000Z', status: 'available' },
    weekly: { percentUsed: 62, resetAt: '2026-08-03T00:00:00.000Z', status: 'available' },
    cubs: {
      active: null,
      concurrentLimit: null,
      weeklyUsed: null,
      weeklyLimit: null,
      resetAt: null,
      status: 'not_enabled',
    },
    provenance: 'live',
    ...overrides,
  };
}

/* ------------------------------------------------------ canonical config */

describe('canonical thresholds', () => {
  it('holds the 70/90/100 percent ladder and 5/1/0 contract ladder in one place', () => {
    expect(RELAY_USAGE_THRESHOLDS.percentUsed.map((t) => t.percent)).toEqual([70, 90, 100]);
    expect(RELAY_USAGE_THRESHOLDS.percentUsed.map((t) => t.kind)).toEqual([
      'info', 'warning', 'critical',
    ]);
    expect(RELAY_USAGE_THRESHOLDS.contractsRemaining.map((t) => t.remaining)).toEqual([5, 1, 0]);
    expect(RELAY_USAGE_THRESHOLDS.contractsRemaining.map((t) => t.kind)).toEqual([
      'info', 'warning', 'critical',
    ]);
  });
});

/* ------------------------------------------------------------ bar view */

describe('projectUsageBar', () => {
  it('renders known live figures compactly', () => {
    const bar = projectUsageBar(liveSnapshot());
    expect(bar.summary).toBe('USAGE · 14 MISSIONS LEFT · 38% / 5H');
    expect(bar.ariaLabel).toContain('14 mission contracts remaining');
    expect(bar.ariaLabel).toContain('38 percent');
    expect(bar.tone).toBe('idle');
  });

  it('missing everything renders UNAVAILABLE — never a number, never 0%', () => {
    const bar = projectUsageBar(offlineUsageSnapshot());
    expect(bar.summary).toBe('USAGE · UNAVAILABLE');
    expect(bar.summary).not.toMatch(/\d/);
    expect(bar.tone).toBe('idle');
  });

  it('an updating source renders UPDATING, not 0%', () => {
    const snapshot = offlineUsageSnapshot();
    const bar = projectUsageBar({
      ...snapshot,
      fiveHour: { percentUsed: null, resetAt: null, status: 'updating' },
    });
    expect(bar.summary).toBe('USAGE · UPDATING');
    expect(bar.summary).not.toContain('0');
  });

  it('a simulated snapshot says DEMO', () => {
    const bar = projectUsageBar(demoUsageSnapshot({ stepIndex: 0, nowIso: NOW }));
    expect(bar.summary).toContain('USAGE · DEMO');
    expect(bar.tone).toBe('demo');
    expect(bar.ariaLabel).toContain('simulated');
  });

  it('tone escalates with the snapshot, from the canonical thresholds', () => {
    const warn = projectUsageBar(
      liveSnapshot({ fiveHour: { percentUsed: 72, resetAt: null, status: 'available' } }),
    );
    expect(warn.tone).toBe('warning');
    const critical = projectUsageBar(
      liveSnapshot({
        missionContracts: {
          used: 25, limit: 25, remaining: 0, resetAt: null, status: 'blocked',
        },
      }),
    );
    expect(critical.tone).toBe('critical');
  });
});

/* ---------------------------------------------------------- detail view */

describe('projectUsageDetail', () => {
  it('offline: every section truthful, provenance disclosed, no invented zeros', () => {
    const view = projectUsageDetail(offlineUsageSnapshot(), NOW);
    expect(view.provenanceLabel).toBe(USAGE_OFFLINE_LABEL);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('0%');
    expect(serialized).toContain('Unavailable');
    const cubs = view.sections.find((s) => s.key === 'cubs');
    expect(cubs?.note).toBe('Relay Cubs are not enabled yet.');
    expect(cubs?.rows.map((r) => r.value)).toContain('Not enabled');
    const contracts = view.sections.find((s) => s.key === 'mission_contracts');
    expect(contracts?.meter).toBeNull();
    expect(contracts?.rows.some((r) => r.value === 'Unavailable')).toBe(true);
  });

  it('demo: SIMULATED disclosure plus the spec figures', () => {
    const view = projectUsageDetail(demoUsageSnapshot({ stepIndex: 0, nowIso: NOW }), NOW);
    expect(view.provenanceLabel).toBe(USAGE_SIMULATED_LABEL);
    const contracts = view.sections.find((s) => s.key === 'mission_contracts');
    expect(contracts?.rows.map((r) => r.value)).toContain('14 of 25 remaining');
    expect(contracts?.rows.map((r) => r.value)).toContain('Resets August 30');
    const fiveHour = view.sections.find((s) => s.key === 'five_hour');
    expect(fiveHour?.rows.map((r) => r.value)).toContain('34% used');
    expect(fiveHour?.rows.map((r) => r.value)).toContain('Resets in 2h 14m');
    expect(fiveHour?.meter?.text).toBe('34% used');
    // 2026-07-31 is a Friday; the simulated weekly window really does reset
    // Monday 00:00 UTC — the weekday comes from the data, not a hard-code.
    const weekly = view.sections.find((s) => s.key === 'weekly');
    expect(weekly?.rows.map((r) => r.value)).toContain('Resets Monday at 12:00 AM');
    const cubs = view.sections.find((s) => s.key === 'cubs');
    expect(cubs?.rows.map((r) => r.value)).toContain('1 of 2 concurrent');
    expect(cubs?.rows.map((r) => r.value)).toContain('3 of 10 runs');
  });

  it('meters always carry text, never percentage color alone', () => {
    const view = projectUsageDetail(liveSnapshot(), NOW);
    for (const section of view.sections) {
      if (section.meter !== null) {
        expect(section.meter.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('live provenance drops the banner — and only live', () => {
    expect(projectUsageDetail(liveSnapshot(), NOW).provenanceLabel).toBeNull();
  });

  it('cubs never claim to be live outside a simulated snapshot', () => {
    expect(cubsClaimsLive(offlineUsageSnapshot().cubs, 'offline')).toBe(false);
    const demo = demoUsageSnapshot({ stepIndex: 0, nowIso: NOW });
    expect(cubsClaimsLive(demo.cubs, demo.provenance)).toBe(false);
  });
});

/* ------------------------------------------------------------ formatting */

describe('formatReset', () => {
  it('formats minutes, hours, weekdays and dates from injected time', () => {
    expect(formatReset(null, NOW)).toBeNull();
    expect(formatReset('2026-07-31T12:00:30.000Z', NOW)).toBe('Resets in under a minute');
    expect(formatReset('2026-07-31T12:45:00.000Z', NOW)).toBe('Resets in 45m');
    expect(formatReset('2026-07-31T14:14:00.000Z', NOW)).toBe('Resets in 2h 14m');
    expect(formatReset('2026-08-03T00:00:00.000Z', NOW)).toBe('Resets Monday at 12:00 AM');
    expect(formatReset('2026-08-30T12:00:00.000Z', NOW)).toBe('Resets August 30');
    expect(formatReset('2026-07-31T11:00:00.000Z', NOW)).toBe('Reset due');
  });
});

/* ------------------------------------------------------------ thresholds */

describe('deriveUsageThresholdEvents', () => {
  const at = (percent: number, resetAt = '2026-07-31T14:14:00.000Z') =>
    liveSnapshot({ fiveHour: { percentUsed: percent, resetAt, status: 'available' } });

  it('unknown usage never notifies — missing is not zero and not a crossing', () => {
    const result = deriveUsageThresholdEvents(offlineUsageSnapshot(), EMPTY_USAGE_LATCH);
    expect(result.events).toEqual([]);
    expect(result.latch).toBe(EMPTY_USAGE_LATCH);
  });

  it('70% → one info; the same window never notifies twice', () => {
    const first = deriveUsageThresholdEvents(at(70), EMPTY_USAGE_LATCH);
    const fiveHour = first.events.filter((e) => e.section === 'five_hour');
    expect(fiveHour).toHaveLength(1);
    expect(fiveHour[0].kind).toBe('info');
    expect(fiveHour[0].body).toBe('You have used 70% of your five-hour allowance.');
    const second = deriveUsageThresholdEvents(at(70), first.latch);
    expect(second.events.filter((e) => e.section === 'five_hour')).toEqual([]);
  });

  it('90% → strong warning; 100% → critical limit-reached', () => {
    const seventy = deriveUsageThresholdEvents(at(70), EMPTY_USAGE_LATCH);
    const ninety = deriveUsageThresholdEvents(at(94), seventy.latch);
    const warning = ninety.events.filter((e) => e.section === 'five_hour');
    expect(warning).toHaveLength(1);
    expect(warning[0].kind).toBe('warning');
    const hundred = deriveUsageThresholdEvents(at(100), ninety.latch);
    const critical = hundred.events.filter((e) => e.section === 'five_hour');
    expect(critical).toHaveLength(1);
    expect(critical[0].kind).toBe('critical');
    expect(critical[0].title).toBe('Usage limit reached');
    expect(critical[0].body).toContain('unavailable until the allowance resets');
  });

  it('jumping straight past two thresholds yields ONE event — the severest', () => {
    const result = deriveUsageThresholdEvents(at(95), EMPTY_USAGE_LATCH);
    const fiveHour = result.events.filter((e) => e.section === 'five_hour');
    expect(fiveHour).toHaveLength(1);
    expect(fiveHour[0].kind).toBe('warning');
  });

  it('dropping below a threshold re-arms it; crossing again notifies again', () => {
    const up = deriveUsageThresholdEvents(at(72), EMPTY_USAGE_LATCH);
    expect(up.events.filter((e) => e.section === 'five_hour')).toHaveLength(1);
    const down = deriveUsageThresholdEvents(at(60), up.latch);
    expect(down.events.filter((e) => e.section === 'five_hour')).toEqual([]);
    const upAgain = deriveUsageThresholdEvents(at(75), down.latch);
    expect(upAgain.events.filter((e) => e.section === 'five_hour')).toHaveLength(1);
  });

  it('a new reset window notifies afresh — the key carries the window', () => {
    const first = deriveUsageThresholdEvents(at(72), EMPTY_USAGE_LATCH);
    const newWindow = deriveUsageThresholdEvents(
      at(72, '2026-07-31T19:14:00.000Z'),
      first.latch,
    );
    expect(newWindow.events.filter((e) => e.section === 'five_hour')).toHaveLength(1);
  });

  it('mission contract counts ladder: 5 info, 1 warning, 0 critical', () => {
    const remaining = (n: number) =>
      liveSnapshot({
        missionContracts: {
          used: 25 - n,
          limit: 25,
          remaining: n,
          resetAt: '2026-08-30T12:00:00.000Z',
          status: n === 0 ? 'blocked' : 'available',
        },
      });
    const five = deriveUsageThresholdEvents(remaining(5), EMPTY_USAGE_LATCH);
    const fiveEvents = five.events.filter((e) => e.section === 'mission_contracts');
    expect(fiveEvents).toHaveLength(1);
    expect(fiveEvents[0].kind).toBe('info');
    expect(fiveEvents[0].body).toBe('5 Mission Contracts remaining.');
    // 4 remaining is still inside the already-notified 5-threshold window.
    const four = deriveUsageThresholdEvents(remaining(4), five.latch);
    expect(four.events.filter((e) => e.section === 'mission_contracts')).toEqual([]);
    const one = deriveUsageThresholdEvents(remaining(1), four.latch);
    const oneEvents = one.events.filter((e) => e.section === 'mission_contracts');
    expect(oneEvents).toHaveLength(1);
    expect(oneEvents[0].kind).toBe('warning');
    expect(oneEvents[0].body).toBe('1 Mission Contract remaining.');
    const zero = deriveUsageThresholdEvents(remaining(0), one.latch);
    const zeroEvents = zero.events.filter((e) => e.section === 'mission_contracts');
    expect(zeroEvents).toHaveLength(1);
    expect(zeroEvents[0].kind).toBe('critical');
    expect(zeroEvents[0].title).toBe('Usage limit reached');
  });

  it('provenance is part of the key — a simulated crossing never latches a live one', () => {
    const simulated = deriveUsageThresholdEvents(
      { ...at(72), provenance: 'simulated' },
      EMPTY_USAGE_LATCH,
    );
    const live = deriveUsageThresholdEvents(at(72), simulated.latch);
    expect(live.events.filter((e) => e.section === 'five_hour')).toHaveLength(1);
  });
});

/* -------------------------------------------------------- demo fixture */

describe('demoUsageSnapshot', () => {
  it('is explicitly simulated and walks the warning ladder across the demo', () => {
    const start = demoUsageSnapshot({ stepIndex: 0, nowIso: NOW });
    expect(start.provenance).toBe('simulated');
    expect(start.fiveHour.percentUsed).toBe(34);
    expect(demoUsageSnapshot({ stepIndex: 6, nowIso: NOW }).fiveHour.percentUsed).toBe(70);
    expect(demoUsageSnapshot({ stepIndex: 10, nowIso: NOW }).fiveHour.percentUsed).toBe(94);
    expect(demoUsageSnapshot({ stepIndex: 12, nowIso: NOW }).fiveHour.percentUsed).toBe(100);
  });

  it('the offline snapshot carries no figures at all', () => {
    const snapshot = offlineUsageSnapshot();
    expect(snapshot.provenance).toBe('offline');
    expect(snapshot.missionContracts.remaining).toBeNull();
    expect(snapshot.fiveHour.percentUsed).toBeNull();
    expect(snapshot.weekly.percentUsed).toBeNull();
    expect(snapshot.cubs.status).toBe('not_enabled');
  });
});
