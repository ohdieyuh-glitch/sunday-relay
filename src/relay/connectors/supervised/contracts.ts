import type { RelayExecutionAttestation, RelayFinding, RelayRepair } from '../../mission/contracts';
import type { OutputVisibility } from '../../mission/entitlement';
import type { EvidenceRecord, FinalAuditReport } from '../../protocol/contracts';
import type { EventDraft } from '../../protocol/envelopes';
import type { ClaudeCodeCapabilityProfile, ClaudeLiveLimits } from '../claude-code/contracts';
import type { CodexReviewerCapabilityProfile, CodexReviewerLimits } from '../codex-reviewer/contracts';
import type { IdFactory } from '../../protocol/ids';

/**
 * Supervised live workflow contracts (Prompt 8.4). Types for the full
 * Claude-implements → Relay-verifies → Codex-reviews → (conditional bounded
 * repair → re-verify → exact-session re-review) → verified-complete loop.
 *
 * Permanent prohibitions (enforced structurally and boundary-tested): the
 * workflow NEVER plants a defect, injects a fault, mutates implementation
 * code to force a review failure, forces a changes_required verdict,
 * manufactures a finding, or instructs any agent to make a mistake. The
 * review verdict is always the reviewer's genuine parsed report; PATH A
 * (genuine approval) and PATH B (genuine finding → bounded repair →
 * re-review) are both first-class outcomes.
 */

/** How the workflow reached its terminal state. */
export type SupervisedWorkflowPath =
  | 'approved_first_review'    // PATH A: genuine approval on the first review
  | 'repaired_after_re_review' // PATH B: genuine finding → repair → approving re-review
  | 'stopped';                 // any honest non-complete stop (output held)

export interface SupervisedAgentOptions<Caps, Limits> {
  executablePath: string;
  capabilities: Caps;
  limits?: Limits;
}

/** Durable-persistence boundaries the supervised runner records (Prompt
 * 8.5). Call-budget consumption is carried by the *_authorized boundaries,
 * recorded BEFORE the corresponding provider launch so a crash can never
 * produce an unaccounted call. */
export type SupervisedPersistenceBoundary =
  | 'run_initialized'
  | 'workspace_created'
  | 'provider_launch_authorized'
  | 'implementer_initialization_verified'
  | 'implementer_report_received'
  | 'workspace_inspected'
  | 'verification_completed'
  | 'reviewer_initialization_verified'
  | 'review_received'
  | 'finding_created'
  | 'repair_created'
  | 'session_resume_authorized'
  | 'repair_received'
  | 're_verification_completed'
  | 're_review_received'
  | 'completion_evaluated'
  | 'verified_complete'
  | 'stopped_safely'
  | 'cleanup_completed';

/** Persistence port the runner calls at each boundary. Implementations live
 * OUTSIDE this module (the persistence bridge); payloads are sanitized by
 * the persistence layer before any write. A throwing hook aborts the run —
 * persistence integrity failures are never silently ignored. */
export interface SupervisedPersistenceHooks {
  record(boundary: SupervisedPersistenceBoundary, payload: Record<string, unknown>): void;
}

export interface SupervisedProofOptions {
  claude: SupervisedAgentOptions<ClaudeCodeCapabilityProfile, ClaudeLiveLimits>;
  codex: SupervisedAgentOptions<CodexReviewerCapabilityProfile, CodexReviewerLimits>;
  now: () => string;
  ids: IdFactory;
  baseEnv?: Record<string, string | undefined>;
  /** Optional durable-persistence hooks (Prompt 8.5). When absent the run is
   * volatile exactly as in Prompt 8.4. */
  persistence?: SupervisedPersistenceHooks;
}

export interface SupervisedProofResult {
  lines: string[];
  exitCode: number;
  path: SupervisedWorkflowPath;
  stopReason: string | null;

  /* --- implementation (live Claude) --- */
  claudeSessionCaptured: string | null;
  claudeResumeConfirmed: boolean;
  claudeInvocations: number;
  implementationReportAttempts: number[];
  filesChanged: string[];
  protectedChanges: string[];
  inspectionAssessments: string[];
  implementerAttestation: RelayExecutionAttestation | null;

  /* --- Relay-controlled verification --- */
  verificationRuns: number;
  verificationsPassed: boolean[];
  postRepairEvidenceIds: string[];
  sourceUnchanged: boolean;

  /* --- independent review (live Codex) --- */
  reviewId: string;
  codexSessionCaptured: string | null;
  codexResumeConfirmed: boolean;
  codexInvocations: number;
  /** The GENUINE verdicts as parsed from the reviewer reports, in order. */
  reviewVerdicts: string[];
  reviewerFileChanges: string[];
  reviewerIndependent: boolean;
  reviewerAttestations: RelayExecutionAttestation[];

  /* --- finding / repair ledger (Relay-owned) --- */
  findings: RelayFinding[];
  repairs: RelayRepair[];
  blockingFindingsOpen: number;
  repairDispatched: boolean;
  outputVisibility: OutputVisibility;

  /* --- completion --- */
  completionOutcome: string;
  audit: FinalAuditReport | null;
  events: EventDraft[];
  evidence: EvidenceRecord[];
}

/** The single supported live fixture name (the genuine safe-edit task —
 * reused from the Claude adapter; it contains NO seeded defect). */
export const SUPERVISED_FIXTURE = 'safe-edit' as const;
