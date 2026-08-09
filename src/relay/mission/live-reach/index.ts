/**
 * LIVE REACH — the barrel.
 *
 * Pure domain: no Node, no network, no clock. The browser and the CLI both
 * read it and reach the same conclusions about the same record.
 */
export {
  ACTION_OUTCOMES,
  BACKEND_PROBE_RESULTS,
  LIVE_REACH_ACTION_CAPABILITIES,
  LIVE_REACH_READ_CAPABILITIES,
  LIVE_REACH_READINESS,
  LIVE_REACH_READINESS_LABEL,
  LIVE_REACH_REFUSALS,
  LIVE_REACH_SOURCES,
  isActionCapability,
  mayFallBackAfter,
} from './live-reach-contracts';
export type {
  ActionOutcome,
  BackendProbe,
  BackendProbeResult,
  LiveReachAttempt,
  LiveReachBackend,
  LiveReachCapability,
  LiveReachReadCapability,
  LiveReachActionCapability,
  LiveReachReadiness,
  LiveReachRefusal,
  LiveReachSource,
  LiveReachSourceDefinition,
} from './live-reach-contracts';
export {
  LIVE_REACH_REGISTRY,
  allSources,
  backendCandidates,
  findSource,
  isLiveReachSource,
  reachableSources,
  resolveReadiness,
  supportedActionCapabilities,
  supportedCapabilities,
} from './live-reach-registry';
export {
  EMPTY_LIVE_REACH_SETTINGS,
  acknowledgeGlobalNotice,
  acknowledgeSourceNotice,
  capabilityState,
  defaultEnabled,
  disableAllSources,
  evaluateLiveReach,
  setCapability,
  setGroup,
  shouldShowGlobalNotice,
  shouldShowSourceNotice,
} from './live-reach-permissions';
export type {
  CapabilityState,
  LiveReachDecision,
  LiveReachRequest,
  LiveReachSettings,
  LiveReachSourceSettings,
} from './live-reach-permissions';
