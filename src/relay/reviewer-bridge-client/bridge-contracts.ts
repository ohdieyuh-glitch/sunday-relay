import type {
  HarnessRuntimeEvidence, ReviewerHarnessView,
} from '../mission/reviewer-harness';

/**
 * THE REVIEWER BRIDGE CLIENT CONTRACT.
 *
 * A thin, environment-neutral description of the Relay Bridge's Reviewer HTTP
 * boundary. It exists so the CLI can reach the server-side Hermes adapter
 * WITHOUT importing it: the CLI import allowlist forbids `relay-bridge`
 * internals, and correctly so — a process adapter, a provider client and a
 * credential have no business inside a terminal client.
 *
 * IT DECIDES NOTHING. This layer moves bytes and classifies transport
 * failures. Whether a run is approved, whether a finding is valid, whether the
 * Reviewer was independent, whether a model identity can be trusted and
 * whether a verdict authorizes release all remain server and domain
 * decisions, projected through the canonical Reviewer types re-exported here
 * rather than redefined.
 */

/* ------------------------------------------------------------ the error */

/**
 * Every way a Reviewer bridge call can fail, as a CLOSED set. A caller
 * switches on `kind` rather than matching on message text, and the message is
 * always safe to print — no token, no header, no provider body, no stack.
 */
export const BRIDGE_ERROR_KINDS = [
  'configuration_missing',
  'invalid_bridge_url',
  'insecure_remote_url',
  'unreachable',
  'timeout',
  'authentication_failed',
  'authorization_required',
  'mission_not_found',
  'run_not_found',
  'duplicate_run',
  'reviewer_not_ready',
  'harness_not_installed',
  'credentials_missing',
  'model_unverified',
  'budget_blocked',
  'validation_failed',
  'run_disconnected',
  'server_failure',
  'invalid_response',
] as const;
export type BridgeErrorKind = (typeof BRIDGE_ERROR_KINDS)[number];

export interface BridgeError {
  readonly kind: BridgeErrorKind;
  /** Always safe to print verbatim. */
  readonly message: string;
  /** Present only for HTTP-level failures. */
  readonly status?: number;
}

export type BridgeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BridgeError };

/**
 * Which failures a human can fix by configuring something, versus which mean
 * the Reviewer itself failed. The CLI maps these to different exit codes so a
 * script can tell "you have not set this up" from "the review went wrong".
 */
export const CONFIGURATION_ERROR_KINDS: readonly BridgeErrorKind[] = Object.freeze([
  'configuration_missing', 'invalid_bridge_url', 'insecure_remote_url',
  'authentication_failed', 'authorization_required',
]);

export function isConfigurationError(error: BridgeError): boolean {
  return CONFIGURATION_ERROR_KINDS.includes(error.kind);
}

/* ------------------------------------------------------- the operations */

/** Readiness, exactly as the pure domain models it. Never re-derived here. */
export interface ReviewerReadinessResponse {
  readonly harness: string;
  readonly evidence: HarnessRuntimeEvidence;
}

/**
 * A connection test is a PREFLIGHT, and is recorded as one. It reports what
 * the server proved and never creates a run, a verdict or a usage record.
 */
export interface ReviewerConnectionTestResponse {
  readonly harness: string;
  readonly evidence: HarnessRuntimeEvidence;
  /** Whether the server actually contacted the provider for this test. */
  readonly providerRequestMade: boolean;
  readonly requestedModel: string | null;
  /** Only ever set from server proof. `null` renders as Unknown. */
  readonly verifiedModelId: string | null;
  readonly provider: string | null;
  readonly checkedAt: string | null;
  /** `false` plus a reason is a truthful outcome, not an error. */
  readonly connected: boolean;
  readonly reason: string | null;
}

export interface StartReviewerRequest {
  readonly missionId: string;
  /** The exact review generation this run is authorized against. */
  readonly reviewGeneration: string;
  readonly requestedHarness: string;
  /** `null` means "use the server-approved configured model", never "pick one". */
  readonly requestedModel: string | null;
  readonly idempotencyKey: string;
  /** Explicit authorization. The server re-checks; this is not the authority. */
  readonly authorized: true;
  readonly limits: ReviewerRunLimitsRequest;
}

export interface ReviewerRunLimitsRequest {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly maxTurns: number;
  readonly maxPromptBytes: number;
}

/**
 * Accepting a start is NOT completing a review. `accepted` says the server
 * took the request; the run's own state says what happened.
 */
export interface StartReviewerResponse {
  readonly runId: string;
  readonly accepted: boolean;
  readonly state: string;
  readonly missionId: string;
  readonly reviewGeneration: string;
  readonly requestedHarness: string;
  readonly requestedModel: string | null;
  readonly idempotencyKey: string;
  /** True when this key already mapped to a run — one run, not two. */
  readonly deduplicated: boolean;
  readonly limits: ReviewerRunLimitsRequest;
}

/** The canonical projection, plus the run identity the CLI addresses it by. */
export interface ReviewerStatusResponse {
  readonly missionId: string;
  readonly runId: string | null;
  readonly view: ReviewerHarnessView;
  readonly evidence: HarnessRuntimeEvidence | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly limits: ReviewerRunLimitsRequest | null;
  readonly failureClassification: string | null;
}

export interface ReviewerInspectResponse extends ReviewerStatusResponse {
  readonly findings: readonly ReviewerFindingSummary[];
  readonly proposedVerdict: string | null;
  readonly validatedVerdict: string | null;
  readonly independenceLabel: string;
  readonly independenceReasons: readonly string[];
  readonly toolUseEvidence: readonly string[];
  readonly stopReason: string | null;
}

/** A finding as the SERVER validated it. The client never validates one. */
export interface ReviewerFindingSummary {
  readonly findingId: string;
  readonly severity: string;
  readonly title: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly blocking: boolean;
}

export interface StopReviewerResponse {
  readonly missionId: string;
  readonly runId: string | null;
  readonly cancellationRequested: boolean;
  /** A request is not a confirmation. */
  readonly cancellationConfirmed: boolean;
  readonly state: string;
  readonly findingsPreserved: number;
  readonly message: string;
}

export interface RetryReviewerRequest {
  readonly missionId: string;
  readonly priorRunId: string;
  readonly idempotencyKey: string;
  readonly authorized: true;
}

export interface RetryReviewerResponse {
  readonly missionId: string;
  readonly priorRunId: string;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly state: string;
  /** Carried forward, never discarded by a retry. */
  readonly preservedFindings: number;
  readonly requestedHarness: string;
  readonly requestedModel: string | null;
}

/** A one-time browser pairing grant, minted by an authenticated operator. */
export interface PairingGrantResponse {
  readonly grantId: string;
  /** Shown once. Never stored by Relay and never recoverable. */
  readonly grantSecret: string;
  readonly origin: string;
  readonly expiresAt: string;
  readonly expiresInSeconds: number;
}

/** The operations. Nothing else reaches the bridge from a CLI. */
export interface ReviewerBridgeClient {
  createBrowserPairing(origin: string): Promise<BridgeResult<PairingGrantResponse>>;
  getReviewerReadiness(): Promise<BridgeResult<ReviewerReadinessResponse>>;
  testReviewerConnection(): Promise<BridgeResult<ReviewerConnectionTestResponse>>;
  startReviewerRun(request: StartReviewerRequest): Promise<BridgeResult<StartReviewerResponse>>;
  getReviewerStatus(missionId: string): Promise<BridgeResult<ReviewerStatusResponse>>;
  inspectReviewerRun(missionId: string): Promise<BridgeResult<ReviewerInspectResponse>>;
  stopReviewerRun(missionId: string): Promise<BridgeResult<StopReviewerResponse>>;
  retryReviewerRun(request: RetryReviewerRequest): Promise<BridgeResult<RetryReviewerResponse>>;
}
