/**
 * CANONICAL RELAY USAGE SNAPSHOT — the single domain contract every website
 * usage surface reads (Usage Bar, usage detail panel, usage notifications).
 *
 * PURE data. No React, no browser APIs, no clock reads — time is always an
 * injected ISO string, exactly like the mission-economics modules. This is a
 * DERIVED snapshot of usage state, not a second accounting authority: mission
 * economics remains the per-mission cost authority, entitlement remains the
 * capability authority, and nothing here executes or meters anything.
 *
 * TRUTHFULNESS RULES (the same rules mission economics already enforces):
 *  - A missing value is `null`, and `null` NEVER renders as 0 or 0%.
 *  - Provenance is part of the snapshot itself, so a simulated snapshot is
 *    self-disclosing — there is no forgettable boolean beside the data.
 *  - Relay Cubs do not exist yet, so a truthful non-demo snapshot can only
 *    say `not_enabled` / `unavailable` about them.
 */

/** Where a snapshot's figures come from. Part of the data, never a UI flag. */
export const RELAY_USAGE_PROVENANCES = ['live', 'offline', 'simulated'] as const;
export type RelayUsageProvenance = (typeof RELAY_USAGE_PROVENANCES)[number];

export const RELAY_USAGE_STATUSES = [
  'available',
  'limited',
  'blocked',
  'updating',
  'unavailable',
] as const;
export type RelayUsageStatus = (typeof RELAY_USAGE_STATUSES)[number];

/** Cubs add `not_enabled`: the truthful state while Cubs are not a feature. */
export const RELAY_CUBS_STATUSES = [
  'available',
  'limited',
  'blocked',
  'not_enabled',
  'updating',
  'unavailable',
] as const;
export type RelayCubsStatus = (typeof RELAY_CUBS_STATUSES)[number];

/** Mission Contract allowance for the current billing period. */
export interface RelayMissionContractUsage {
  readonly used: number | null;
  readonly limit: number | null;
  readonly remaining: number | null;
  /** ISO timestamp the allowance resets, when known. */
  readonly resetAt: string | null;
  readonly status: RelayUsageStatus;
}

/**
 * A rolling usage window (five-hour or weekly). `percentUsed` is a whole
 * integer 0–100; fractional precision would imply an exactness the source
 * does not provide.
 */
export interface RelayUsageWindow {
  readonly percentUsed: number | null;
  readonly resetAt: string | null;
  readonly status: RelayUsageStatus;
}

/** Relay Cubs usage. Interface prepared; the feature does not exist yet. */
export interface RelayCubsUsage {
  readonly active: number | null;
  readonly concurrentLimit: number | null;
  readonly weeklyUsed: number | null;
  readonly weeklyLimit: number | null;
  readonly resetAt: string | null;
  readonly status: RelayCubsStatus;
}

export interface RelayUsageSnapshot {
  readonly missionContracts: RelayMissionContractUsage;
  readonly fiveHour: RelayUsageWindow;
  readonly weekly: RelayUsageWindow;
  readonly cubs: RelayCubsUsage;
  readonly provenance: RelayUsageProvenance;
}

/** Severity vocabulary shared by usage warnings and the notification layer. */
export const RELAY_USAGE_WARNING_KINDS = ['info', 'warning', 'critical'] as const;
export type RelayUsageWarningKind = (typeof RELAY_USAGE_WARNING_KINDS)[number];

/**
 * THE CANONICAL WARNING THRESHOLDS — the one place these numbers exist.
 * UI components never compare percentages themselves; they render what
 * `deriveUsageThresholdEvents` derives from this table.
 */
export const RELAY_USAGE_THRESHOLDS = Object.freeze({
  /** Rolling-window thresholds, in whole percent used. */
  percentUsed: Object.freeze([
    Object.freeze({ percent: 70, kind: 'info' as RelayUsageWarningKind }),
    Object.freeze({ percent: 90, kind: 'warning' as RelayUsageWarningKind }),
    Object.freeze({ percent: 100, kind: 'critical' as RelayUsageWarningKind }),
  ]),
  /** Mission Contract count thresholds, in contracts remaining. */
  contractsRemaining: Object.freeze([
    Object.freeze({ remaining: 5, kind: 'info' as RelayUsageWarningKind }),
    Object.freeze({ remaining: 1, kind: 'warning' as RelayUsageWarningKind }),
    Object.freeze({ remaining: 0, kind: 'critical' as RelayUsageWarningKind }),
  ]),
});
