import type { RelayUsageSnapshot } from './usage-contracts';

/**
 * USAGE SNAPSHOT FIXTURES.
 *
 * `offlineUsageSnapshot` is the ONLY snapshot ordinary production navigation
 * may load while no live usage source exists: everything unavailable, Cubs
 * truthfully not enabled, provenance 'offline'. It contains no figures at
 * all, so it cannot fabricate customer usage.
 *
 * `demoUsageSnapshot` is the explicitly SIMULATED snapshot for the Demo
 * Simulation: provenance 'simulated' makes every surface that renders it
 * carry the simulated-usage disclosure. It is reachable ONLY through the
 * Demo Simulation controls — never loaded by normal navigation.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function offlineUsageSnapshot(): RelayUsageSnapshot {
  return {
    missionContracts: {
      used: null,
      limit: null,
      remaining: null,
      resetAt: null,
      status: 'unavailable',
    },
    fiveHour: { percentUsed: null, resetAt: null, status: 'unavailable' },
    weekly: { percentUsed: null, resetAt: null, status: 'unavailable' },
    cubs: {
      active: null,
      concurrentLimit: null,
      weeklyUsed: null,
      weeklyLimit: null,
      resetAt: null,
      status: 'not_enabled',
    },
    provenance: 'offline',
  };
}

/** Deterministic demo values: contracts fixed, five-hour usage grows with the
    demo script so the 70% / 90% / 100% warning ladder is actually shown. */
export const DEMO_CONTRACTS_LIMIT = 25;
export const DEMO_CONTRACTS_USED = 11;
export const DEMO_FIVE_HOUR_START_PERCENT = 34;
export const DEMO_FIVE_HOUR_STEP_PERCENT = 6;
export const DEMO_WEEKLY_PERCENT = 62;

function nextUtcMondayMidnight(nowMs: number): string {
  const now = new Date(nowMs);
  const day = now.getUTCDay(); // 0 Sunday … 6 Saturday
  const daysUntilMonday = ((8 - day) % 7) || 7;
  const monday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysUntilMonday,
  );
  return new Date(monday).toISOString();
}

export function demoUsageSnapshot(input: {
  stepIndex: number;
  nowIso: string;
}): RelayUsageSnapshot {
  const nowMs = Date.parse(input.nowIso);
  const base = Number.isFinite(nowMs) ? nowMs : 0;
  const fiveHourPercent = Math.min(
    DEMO_FIVE_HOUR_START_PERCENT + Math.max(0, input.stepIndex) * DEMO_FIVE_HOUR_STEP_PERCENT,
    100,
  );
  const weeklyReset = nextUtcMondayMidnight(base);
  return {
    missionContracts: {
      used: DEMO_CONTRACTS_USED,
      limit: DEMO_CONTRACTS_LIMIT,
      remaining: DEMO_CONTRACTS_LIMIT - DEMO_CONTRACTS_USED,
      resetAt: new Date(base + 30 * DAY_MS).toISOString(),
      status: 'available',
    },
    fiveHour: {
      percentUsed: fiveHourPercent,
      // The spec's example window: resets in 2h 14m.
      resetAt: new Date(base + 2 * HOUR_MS + 14 * 60_000).toISOString(),
      status: fiveHourPercent >= 100 ? 'blocked' : 'available',
    },
    weekly: {
      percentUsed: DEMO_WEEKLY_PERCENT,
      resetAt: weeklyReset,
      status: 'available',
    },
    cubs: {
      active: 1,
      concurrentLimit: 2,
      weeklyUsed: 3,
      weeklyLimit: 10,
      resetAt: weeklyReset,
      status: 'available',
    },
    provenance: 'simulated',
  };
}
