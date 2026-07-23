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

export interface SupervisedProofOptions {
  claude: SupervisedAgentOptions<ClaudeCodeCapabilityProfile, ClaudeLiveLimits>;
  codex: SupervisedAgentOptions<CodexReviewerCapabilityProfile, CodexReviewerLimits>;
  now: () => string;
  ids: IdFactory;
  baseEnv?: Record<string, string | undefined>;
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
