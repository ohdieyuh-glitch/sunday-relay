/**
 * REVIEWER BRIDGE CLIENT — the CLI's only legal path to the server-side
 * Reviewer. It holds no process adapter, no provider client and no credential
 * beyond the bridge token it is handed, and it decides nothing the domain or
 * the server already decides.
 */
export { BRIDGE_ERROR_KINDS, CONFIGURATION_ERROR_KINDS, isConfigurationError } from './bridge-contracts';
export type {
  BridgeError, BridgeErrorKind, BridgeResult, RetryReviewerRequest, RetryReviewerResponse,
  ReviewerBridgeClient, ReviewerConnectionTestResponse, ReviewerFindingSummary,
  ReviewerInspectResponse, ReviewerReadinessResponse, ReviewerRunLimitsRequest,
  ReviewerStatusResponse, StartReviewerRequest, StartReviewerResponse, StopReviewerResponse,
} from './bridge-contracts';
export {
  BRIDGE_API_BASE, BRIDGE_TOKEN_ENV, BRIDGE_URL_ENV, DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS, isLoopbackHost, redactBridgeSecrets, resolveBridgeTarget, resolveBridgeToken,
} from './bridge-target';
export type { BridgeTarget } from './bridge-target';
export { createReviewerBridgeClient } from './bridge-client';
export type { ReviewerBridgeClientOptions } from './bridge-client';
