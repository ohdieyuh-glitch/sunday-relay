/**
 * CANONICAL RELAY USAGE DOMAIN — snapshot contract, pure projections,
 * threshold derivation and labeled fixtures. Consumed by the website usage
 * surfaces; owns no execution, no accounting ledger, no network.
 */
export {
  RELAY_CUBS_STATUSES,
  RELAY_USAGE_PROVENANCES,
  RELAY_USAGE_STATUSES,
  RELAY_USAGE_THRESHOLDS,
  RELAY_USAGE_WARNING_KINDS,
} from './usage-contracts';
export type {
  RelayCubsStatus,
  RelayCubsUsage,
  RelayMissionContractUsage,
  RelayUsageProvenance,
  RelayUsageSnapshot,
  RelayUsageStatus,
  RelayUsageWarningKind,
  RelayUsageWindow,
} from './usage-contracts';
export {
  USAGE_OFFLINE_LABEL,
  USAGE_SIMULATED_LABEL,
  cubsClaimsLive,
  formatReset,
  projectUsageBar,
  projectUsageDetail,
} from './usage-projection';
export type {
  RelayUsageBarView,
  RelayUsageDetailRow,
  RelayUsageDetailSection,
  RelayUsageDetailView,
  RelayUsageMeterView,
} from './usage-projection';
export {
  EMPTY_USAGE_LATCH,
  deriveUsageThresholdEvents,
} from './usage-thresholds';
export type {
  RelayUsageLatch,
  RelayUsageThresholdEvent,
} from './usage-thresholds';
export {
  DEMO_CONTRACTS_LIMIT,
  DEMO_CONTRACTS_USED,
  DEMO_FIVE_HOUR_START_PERCENT,
  DEMO_FIVE_HOUR_STEP_PERCENT,
  DEMO_WEEKLY_PERCENT,
  demoUsageSnapshot,
  offlineUsageSnapshot,
} from './usage-fixtures';
