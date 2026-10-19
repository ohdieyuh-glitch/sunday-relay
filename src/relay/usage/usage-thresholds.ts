import {
  RELAY_USAGE_THRESHOLDS,
  type RelayMissionContractUsage,
  type RelayUsageSnapshot,
  type RelayUsageWarningKind,
  type RelayUsageWindow,
} from './usage-contracts';

/**
 * THRESHOLD CROSSING DERIVATION — pure, deterministic, once per reset window.
 *
 * The latch is the memory of which (section, threshold, reset-window) keys
 * already produced a notification. Callers persist it (the application shell
 * keeps it across refreshes), pass it back in, and get a new latch out:
 *
 *  - a threshold notifies when usage is at/over it and its key is unlatched;
 *  - the SAME key never notifies twice — refreshes and route changes cannot
 *    fabricate a crossing because the latch already holds the key;
 *  - dropping back below a threshold UNLATCHES it, so crossing again may
 *    truthfully notify again;
 *  - a new reset window changes `resetAt`, which changes every key, so the
 *    next window starts clean without any timer logic here.
 *
 * Only one event fires per section per derivation — the most severe newly
 * crossed threshold — so recovering from a missed 70% straight to 95% yields
 * one strong warning, not a backlog.
 */

export interface RelayUsageLatch {
  readonly keys: readonly string[];
}

export const EMPTY_USAGE_LATCH: RelayUsageLatch = Object.freeze({
  keys: Object.freeze([]) as readonly string[],
});

export interface RelayUsageThresholdEvent {
  /** Stable dedupe key: section|threshold|reset-window|provenance. */
  readonly key: string;
  readonly section: 'mission_contracts' | 'five_hour' | 'weekly';
  readonly kind: RelayUsageWarningKind;
  readonly title: string;
  readonly body: string;
}

const SECTION_TITLE: Record<'five_hour' | 'weekly', string> = {
  five_hour: 'Five-hour usage',
  weekly: 'Weekly usage',
};
const SECTION_PHRASE: Record<'five_hour' | 'weekly', string> = {
  five_hour: 'five-hour allowance',
  weekly: 'weekly allowance',
};

function windowKey(
  section: 'five_hour' | 'weekly',
  percent: number,
  usageWindow: RelayUsageWindow,
  provenance: string,
): string {
  return `${section}|${percent}|${usageWindow.resetAt ?? 'no-reset'}|${provenance}`;
}

function contractsKey(
  remaining: number,
  contracts: RelayMissionContractUsage,
  provenance: string,
): string {
  return `mission_contracts|${remaining}|${contracts.resetAt ?? 'no-reset'}|${provenance}`;
}

export function deriveUsageThresholdEvents(
  snapshot: RelayUsageSnapshot,
  latch: RelayUsageLatch,
): { events: readonly RelayUsageThresholdEvent[]; latch: RelayUsageLatch } {
  const previous = new Set(latch.keys);
  const next = new Set<string>();
  const events: RelayUsageThresholdEvent[] = [];

  for (const section of ['five_hour', 'weekly'] as const) {
    const usageWindow = section === 'five_hour' ? snapshot.fiveHour : snapshot.weekly;
    if (usageWindow.percentUsed === null) continue; // unknown usage never notifies
    let candidate: RelayUsageThresholdEvent | null = null;
    for (const threshold of RELAY_USAGE_THRESHOLDS.percentUsed) {
      if (usageWindow.percentUsed < threshold.percent) continue; // below → unlatched
      const key = windowKey(section, threshold.percent, usageWindow, snapshot.provenance);
      const alreadyNotified = previous.has(key);
      next.add(key);
      if (!alreadyNotified) {
        candidate = {
          key,
          section,
          kind: threshold.kind,
          title:
            threshold.percent >= 100 ? 'Usage limit reached' : SECTION_TITLE[section],
          body:
            threshold.percent >= 100
              ? `Your ${SECTION_PHRASE[section]} is fully used. New managed missions are unavailable until the allowance resets.`
              : `You have used ${usageWindow.percentUsed}% of your ${SECTION_PHRASE[section]}.`,
        };
      }
    }
    if (candidate !== null) events.push(candidate); // most severe newly crossed
  }

  const contracts = snapshot.missionContracts;
  if (contracts.remaining !== null) {
    let candidate: RelayUsageThresholdEvent | null = null;
    // Walk from mildest (5) to most severe (0); the last unlatched hit wins.
    for (const threshold of [...RELAY_USAGE_THRESHOLDS.contractsRemaining].sort(
      (a, b) => b.remaining - a.remaining,
    )) {
      if (contracts.remaining > threshold.remaining) continue;
      const key = contractsKey(threshold.remaining, contracts, snapshot.provenance);
      const alreadyNotified = previous.has(key);
      next.add(key);
      if (!alreadyNotified) {
        candidate = {
          key,
          section: 'mission_contracts',
          kind: threshold.kind,
          title:
            threshold.remaining === 0 ? 'Usage limit reached' : 'Mission Contracts',
          body:
            threshold.remaining === 0
              ? 'No Mission Contracts remain. New managed missions are unavailable until the allowance resets.'
              : `${contracts.remaining} Mission Contract${contracts.remaining === 1 ? '' : 's'} remaining.`,
        };
      }
    }
    if (candidate !== null) events.push(candidate);
  }

  // The latch keeps ONLY currently-applicable keys: dropping below a
  // threshold (or entering a new reset window) removes its key, which is
  // exactly what re-arms it.
  const changed =
    next.size !== previous.size || [...next].some((key) => !previous.has(key));
  return {
    events,
    latch: changed ? { keys: Object.freeze([...next].sort()) } : latch,
  };
}
