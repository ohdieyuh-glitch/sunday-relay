/**
 * THE CANONICAL REVIEWER HARNESS ADAPTER CONTRACT.
 *
 * A Reviewer Relay Dog is five separate things — Harness, Model, Mission
 * Contract, Environment, Tools — and this contract exists mainly to keep the
 * first two APART. "<harness> with <model>" is two facts, each independently
 * verifiable, and Relay may claim neither until it has evidence for it.
 *
 * Provider-neutral by construction: no product, protocol, language or runtime
 * is named anywhere in this module. Every harness — remote protocol or local
 * binary — fills in the same fields, and the CATALOG is the only place a
 * product name is allowed to appear.
 *
 * It OWNS nothing that already has an authority. Findings remain
 * `RelayFinding`, reviews remain `RelayReview`, independence remains
 * `reviewerIsIndependent`, release remains the release authority. The harness
 * PROPOSES; Relay validates, stores and decides.
 */

export const REVIEWER_HARNESS_SCHEMA_V1 = 'relay-reviewer-harness.v1' as const;
export const REVIEWER_HARNESS_SCHEMA_VERSION = REVIEWER_HARNESS_SCHEMA_V1;
export const SUPPORTED_REVIEWER_HARNESS_VERSIONS = [REVIEWER_HARNESS_SCHEMA_V1] as const;
export type ReviewerHarnessSchemaVersion = (typeof SUPPORTED_REVIEWER_HARNESS_VERSIONS)[number];

/* --------------------------------------------------------- capabilities */

export const REVIEWER_HARNESS_CAPABILITIES = [
  'supportsLiveExecution',
  'supportsStreaming',
  'supportsCancellation',
  'supportsStructuredFindings',
  'supportsEvidenceReferences',
  'supportsUsageReporting',
  'supportsSessionRecovery',
  'supportsReadOnlyExecution',
  'supportsSubagents',
  'supportsParallelSubagents',
  'supportsActualIdentity',
  'supportsModelIdentity',
  'supportsLocalExecution',
  'supportsRemoteExecution',
  'supportsACP',
] as const;
export type ReviewerHarnessCapability = (typeof REVIEWER_HARNESS_CAPABILITIES)[number];
export type ReviewerHarnessCapabilities = Readonly<Record<ReviewerHarnessCapability, boolean>>;

/** Nothing is advertised until an adapter proves it. */
export const NO_HARNESS_CAPABILITIES: ReviewerHarnessCapabilities = Object.freeze(
  Object.fromEntries(REVIEWER_HARNESS_CAPABILITIES.map((c) => [c, false])) as
    Record<ReviewerHarnessCapability, boolean>,
);

/* ------------------------------------------------------------- identity */

/**
 * HARNESS AND MODEL ARE SEPARATE FIELDS.
 *
 * A harness is the program that conducts the review; a model is what (if
 * anything) it reasons with. Some harnesses have no model at all. Combining
 * them into one string is how "<harness> + <model> Connected" gets displayed
 * when neither fact was actually checked.
 */
export interface ReviewerHarnessIdentity {
  readonly role: 'reviewer';
  readonly requestedHarness: string;
  /** Observed only after a verified launch. `null` renders as Unknown. */
  readonly actualHarness: string | null;
  readonly harnessVersion: string | null;
  readonly harnessAdapterId: string;
  readonly requestedModel: string | null;
  /** Reported by the harness itself. Never inferred from configuration. */
  readonly actualModel: string | null;
  /** The model's provider, when a model is involved at all. */
  readonly provider: string | null;
  readonly executionMode: 'live' | 'simulated' | 'offline';
  readonly runId: string | null;
  /** Redacted tail only — never a full external session identifier. */
  readonly sessionRefRedacted: string | null;
  readonly launchVerified: boolean;
}

export const HARNESS_CONNECTION_STATES = [
  'not_connected',
  'not_installed',
  'coming_soon',
  'bridge_required',
  'preparing',
  'reviewing',
  'completed',
  'blocked',
  'stopped',
  'disconnected',
  'needs_inspection',
] as const;
export type HarnessConnectionState = (typeof HARNESS_CONNECTION_STATES)[number];

/* --------------------------------------------------------- independence */

/**
 * The identity evidence the independence authority needs. Every field may be
 * `null`, and `null` means UNKNOWN — which is never the same as independent.
 */
export interface ReviewerIdentityEvidence {
  readonly agentId: string | null;
  readonly adapterId: string | null;
  readonly sessionId: string | null;
  readonly independenceGroup: string | null;
  readonly model: string | null;
  readonly provider: string | null;
  readonly humanId: string | null;
}

export const INDEPENDENCE_VERDICTS = ['independent', 'not_independent', 'unknown'] as const;
export type IndependenceVerdict = (typeof INDEPENDENCE_VERDICTS)[number];

export interface IndependenceAssessment {
  readonly verdict: IndependenceVerdict;
  /** Each reason names the exact fact that decided it. */
  readonly reasons: readonly string[];
  /** Provider diversity is a FACT, not a synonym for independence. */
  readonly providerDiversity: 'different' | 'same' | 'unknown';
}

/* ------------------------------------------------------------- proposal */

/** What a harness may PROPOSE. Relay decides what it means. */
export const PROPOSED_VERDICTS = ['passed', 'blocked', 'needs_changes', 'inconclusive'] as const;
export type ProposedVerdict = (typeof PROPOSED_VERDICTS)[number];

/**
 * A finding as PROPOSED by a harness — deliberately not `RelayFinding`.
 * Relay validates this and mints the canonical finding itself, so a harness
 * can never author a stored finding directly.
 */
export interface ProposedFinding {
  readonly proposedId: string;
  readonly severity: 'critical' | 'high' | 'major' | 'minor';
  readonly title: string;
  readonly description: string;
  readonly affectedFiles: readonly string[];
  /** References into existing evidence — never copied evidence bodies. */
  readonly evidenceRefs: readonly string[];
  readonly reproduction: string | null;
  readonly impact: string;
  readonly recommendedRepair: string;
  readonly blocking: boolean;
}

export interface ProposedReviewResult {
  readonly verdict: ProposedVerdict;
  readonly summary: string;
  readonly findings: readonly ProposedFinding[];
  /** Evidence the harness says it actually inspected. */
  readonly inspectedEvidenceRefs: readonly string[];
}

/* ----------------------------------------------------------------- usage */

/**
 * Not every harness bills tokens, and not every harness bills at all. Each
 * dimension is independently known-or-unknown so a harness with wall-clock
 * usage and no model cannot be forced to invent token counts.
 */
export interface ReviewerHarnessUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  /** Harness execution time, for harnesses that are not token-billed. */
  readonly executionMs: number | null;
  readonly costMicros: string | null;
  readonly currency: string | null;
  readonly source: 'harness_reported' | 'unavailable';
}

export const UNKNOWN_HARNESS_USAGE: ReviewerHarnessUsage = Object.freeze({
  inputTokens: null, outputTokens: null, totalTokens: null, executionMs: null,
  costMicros: null, currency: null, source: 'unavailable',
});

/* ------------------------------------------------------------- the record */

export interface ReviewerHarnessRecord {
  readonly schemaVersion: ReviewerHarnessSchemaVersion;
  readonly missionId: string;
  readonly projectId: string;
  readonly identity: ReviewerHarnessIdentity;
  readonly capabilities: ReviewerHarnessCapabilities;
  readonly connectionState: HarnessConnectionState;
  readonly missionContractRef: string;
  readonly reviewTargetRef: string | null;
  readonly baseRevision: string | null;
  readonly headRevision: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /** Canonical finding ids Relay minted after validation. References only. */
  readonly findingRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  /** What the harness said. */
  readonly proposedVerdict: ProposedVerdict | null;
  /**
   * What Relay concluded. `null` until Relay validated the proposal — a
   * completed harness run is not, by itself, a passed review.
   */
  readonly validatedVerdict: 'approved' | 'changes_requested' | null;
  readonly independence: IndependenceAssessment;
  readonly usage: ReviewerHarnessUsage;
  readonly cancellationRequested: boolean;
  readonly cancellationConfirmed: boolean;
  readonly disconnectionReason: string | null;
  readonly blockedReason: string | null;
  readonly provenance: 'live' | 'simulated' | 'offline';
  readonly updatedAt: string;
  readonly checksum: string;
}

export type ReviewerHarnessRecordDraft = Omit<ReviewerHarnessRecord, 'checksum'>;

export const ACTIVE_HARNESS_STATES: readonly HarnessConnectionState[] = ['preparing', 'reviewing'];
export const BLOCKING_HARNESS_STATES: readonly HarnessConnectionState[] = [
  'blocked', 'disconnected', 'needs_inspection',
];

/* -------------------------------------------------------- reviewer tools */

/** The complete Reviewer tool vocabulary. The Reviewer is READ-ONLY. */
export const REVIEWER_TOOLS = [
  'read_diff', 'read_files', 'inspect_tests', 'inspect_trace', 'inspect_capsules',
  'inspect_mission_contract', 'inspect_worktree', 'create_findings',
  'classify_severity', 'propose_verdict',
] as const;
export type ReviewerTool = (typeof REVIEWER_TOOLS)[number];

/**
 * Tools a Reviewer may NEVER hold. `grantReviewerTools` drops anything not
 * in `REVIEWER_TOOLS`, so this list is documentation plus a test target
 * rather than the enforcement itself — enforcement is the allowlist.
 */
export const FORBIDDEN_REVIEWER_TOOLS: readonly string[] = [
  'edit_files', 'write_files', 'run_commands', 'deploy', 'merge', 'push',
  'change_billing', 'change_credentials', 'grant_permissions',
  'modify_mission_contract', 'erase_findings', 'authorize_release',
];
