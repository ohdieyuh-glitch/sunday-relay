import type { ProjectId, RunId, TaskId, WorkspaceRefId } from '../../protocol/ids';

/**
 * Codex Reviewer adapter contracts (Prompt 8.3) — module-local types for the
 * REAL local Codex independent-reviewer adapter. Nothing here calls a model;
 * these are the serializable records the adapter, doctor, and CLI exchange.
 *
 * Truthfulness invariant (mirrors the Claude adapter): this module
 * distinguishes INSTALLED from AUTHENTICATED and SUPPORTED from UNVERIFIED,
 * and never stores or prints credential material. The Reviewer is READ-ONLY:
 * it never edits, and its report is an unverified claim until Relay attests
 * and validates it.
 */

export type CapabilitySupport = 'available' | 'unavailable' | 'unverified';

/** The runtime automation strategy selected from the installed CLI. */
export type CodexRuntimeStrategy =
  | 'exec_structured_review'  // `codex exec` + --json + --output-schema (preferred)
  | 'native_review'           // `codex exec review` (less structured lifecycle)
  | 'unavailable';

export interface CodexReviewerCapabilityProfile {
  executablePath: string | null;
  version: string | null;
  nonInteractiveExecSupported: boolean;
  jsonEventsSupported: boolean;
  outputSchemaSupported: boolean;
  outputLastMessageSupported: boolean;
  exactResumeSupported: boolean;
  nativeReviewSupported: boolean;
  uncommittedReviewSupported: boolean;
  baseReviewSupported: boolean;
  commitReviewSupported: boolean;
  readOnlySandboxSupported: boolean;
  workspaceWriteSandboxSupported: boolean;
  ignoreUserConfigSupported: boolean;
  ignoreRulesSupported: boolean;
  strictConfigSupported: boolean;
  cancellationSupported: boolean;
  /** Coarse readiness — NEVER an email, token, org, or plan invoice. */
  authenticationStatus: CodexAuthStatus;
  selectedRuntimeStrategy: CodexRuntimeStrategy;
  probedAt: string;
  provenance: 'live';
}

/** Safe authentication classification — NEVER tokens, emails, or org names. */
export type CodexAuthStatus =
  | 'ready'          // logged in via the local Codex login (approved profile)
  | 'not_ready'      // executable present but not signed in
  | 'api_key'        // an explicit provider key env source is present — DISALLOWED
  | 'unverified'     // could not determine (no executable, or ambiguous)
  ;

export interface CodexAuthClassification {
  executablePresent: boolean;
  loggedIn: boolean;
  status: CodexAuthStatus;
  /** True only for the local login while signed in and no API-key source. */
  approvedForLiveReview: boolean;
  /** Coarse label only ('chatgpt'/'api'/'unknown') — never billing/account. */
  methodLabel: string;
  classifiedAt: string;
}

/** The only Relay auth profile Prompt 8.3 permits for the Codex reviewer. */
export const CODEX_AUTH_PROFILE = 'codex_local_login' as const;

/* --------------------------- configuration risk -------------------------- */

export type CodexConfigRisk = 'clean' | 'review_required';

/** Structural inspection of a workspace's Codex/agent configuration — never
 * the file contents, only what exists. Repository review instructions may
 * provide task context but MUST NOT override the Relay Reviewer Contract, so
 * their presence is surfaced and (when supported) isolated with
 * --ignore-user-config / --ignore-rules. */
export interface CodexConfigAssessment {
  hasAgentsMd: boolean;
  hasCodexInstructions: boolean;
  hasCodexConfigDir: boolean;
  hasExecpolicyRules: boolean;
  hasHooks: boolean;
  hasPlugins: boolean;
  hasMcpConfig: boolean;
  hasCustomProvider: boolean;
  hasCustomBaseUrl: boolean;
  hasNetworkPermission: boolean;
  hasAdditionalWritableDirs: boolean;
  /** Structural findings only — never file contents. */
  findings: string[];
  risk: CodexConfigRisk;
  assessedAt: string;
}

/* --------------------------- live limits ---------------------------- */

export interface CodexReviewerLimits {
  maxRuntimeMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxNormalizedEvents: number;
  maxFindings: number;
  maxFindingDescriptionChars: number;
  maxEvidencePerFinding: number;
  maxLiveCallsPerRun: number;
  expectedLiveCalls: number;
}

export const DEFAULT_REVIEWER_LIMITS: CodexReviewerLimits = {
  maxRuntimeMs: 6 * 60_000,
  maxStdoutBytes: 1024 * 1024,
  maxStderrBytes: 256 * 1024,
  maxNormalizedEvents: 500,
  maxFindings: 20,
  maxFindingDescriptionChars: 2_000,
  maxEvidencePerFinding: 12,
  maxLiveCallsPerRun: 2,
  expectedLiveCalls: 1,
};

/* --------------------------- session record ------------------------- */

export type CodexSessionStatus = 'created' | 'resumed' | 'completed' | 'failed' | 'cancelled';

/** Stores the Codex session/thread UUID + association ONLY — never auth
 * tokens. Volatile (in-memory) like all Relay storage this phase, so
 * exact-session re-review is a current-process capability only. */
export interface CodexSessionRecord {
  codexSessionId: string;
  adapterId: string;
  reviewId: string;
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  workspaceId: WorkspaceRefId;
  attempt: number;
  createdAt: string;
  lastResumedAt?: string;
  status: CodexSessionStatus;
  provenance: 'live';
}

/* --------------------------- review report -------------------------- */

/** The exact marker the reviewer must emit around its structured report when
 * output-schema support is unavailable (and always as a fallback). */
export const REVIEW_REPORT_MARKER = 'RELAY_REVIEW_REPORT_V1' as const;

export type ReviewReportVerdict = 'approved' | 'changes_required' | 'blocked' | 'needs_human';
export type ReviewFindingSeverity = 'informational' | 'low' | 'medium' | 'high' | 'critical';

export interface ReviewReportFinding {
  severity: ReviewFindingSeverity;
  title: string;
  description: string;
  evidence: string[];
  affectedFiles: string[];
  affectedCriterionIds: string[];
  requiredAction: string;
  blocking: boolean;
}

/** The validated RELAY_REVIEW_REPORT_V1 claim — still a CLAIM until Relay
 * attests the execution and accepts the verdict. */
export interface RelayReviewReport {
  reviewId: string;
  missionId: string;
  taskId: string;
  reviewedMissionRevision: number;
  reviewedTaskRevision: number;
  reviewedWorkspaceRevision: string;
  reviewerRole: string;
  verdict: ReviewReportVerdict;
  summary: string;
  findings: ReviewReportFinding[];
  evidenceReviewed: string[];
  limitations: string[];
}
