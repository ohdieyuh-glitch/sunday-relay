/**
 * Active Relay Project Workspace — public data contracts (frontend phase).
 *
 * The workspace is the main operating screen for a CONFIGURED project after
 * the developer intentionally starts it: Entry Home → Project Settings →
 * ACTIVE PROJECT WORKSPACE. This is the deployed BROWSER APPLICATION — not
 * the Relay CLI, not a raw terminal. Every value here is safe normalized
 * projection data that enters through props; the UI never launches agents,
 * never decides permissions or completion, never generates canonical events,
 * and never mutates Relay Core.
 */

/* ----------------------------------------------------------------- modes */

export type RelayWorkspaceMode = 'guided' | 'semi' | 'autonomous';

export type ProjectPhase =
  | 'plan'
  | 'research'
  | 'build'
  | 'verify'
  | 'review'
  | 'repair'
  | 'complete';

export type PhaseStepState =
  | 'complete'
  | 'active'
  | 'pending'
  | 'optional'
  | 'blocked'
  | 'locked';

/** Canonical Relay output/project states projected into the workspace. */
export type WorkspaceOutputState =
  | 'draft'
  | 'configured'
  | 'ready'
  | 'implementing'
  | 'held_for_inspection'
  | 'held_for_verification'
  | 'held_for_review'
  | 'revision_required'
  | 'repairing'
  | 'held_for_re_review'
  | 'waiting_for_user'
  | 'stopped_safely'
  | 'verified_complete';

export type HandoffNetworkState = 'standby' | 'online';

/* -------------------------------------------------------------- workforce */

export type ArchitectStatus = 'planning' | 'researching' | 'preparing_handoff' | 'waiting';

export type CodingAgentStatus = 'ready' | 'implementing' | 'verifying' | 'repairing' | 'waiting';

export type ReviewerStateKind =
  | 'not_configured'
  | 'not_required'
  | 'waiting'
  | 'reviewing'
  | 'changes_required'
  | 're_reviewing'
  | 'approved'
  | 'unavailable'
  | 'sign_in_required';

export interface WorkforceAssignment {
  promptArchitect: { name: string; status: ArchitectStatus };
  codingAgent: { name: string; status: CodingAgentStatus };
  reviewer: { name: string; state: ReviewerStateKind };
}

/* ------------------------------------------------------------ relay dog */

export type WorkspaceDogState =
  | 'wandering'
  | 'trotting'
  | 'running'
  | 'sprinting'
  | 'carrying_handoff'
  | 'researching'
  | 'verifying'
  | 'reviewing'
  | 'repairing'
  | 'waiting_for_user'
  | 'stopped_safely'
  | 'complete';

/* ----------------------------------------------------------- identifiers */

export interface WorkspaceProject {
  projectId: string;
  name: string;
  /** Route reference, e.g. "RLY / 001". */
  reference: string;
  projectType: string;
}

export interface WorkspaceMission {
  missionId: string;
  title: string;
  summary: string;
}

/* --------------------------------------------------------- conversation */

export interface ProjectMessage {
  messageId: string;
  author: 'developer' | 'relay';
  text: string;
  /** Absolute display time string — never computed live in the UI. */
  at: string;
  kind?: 'message' | 'summary' | 'approval_request';
  /** For approval_request messages: the decision id reported on approve/reject. */
  decisionId?: string;
  /** True for preview fixture content — rendered with a FIXTURE label. */
  fixture?: boolean;
}

/* ------------------------------------------------------------- terminal */

export type TerminalEventCategory =
  | 'relay'
  | 'prompt_architect'
  | 'research'
  | 'coding_agent'
  | 'workspace_inspection'
  | 'verification'
  | 'reviewer'
  | 'repair'
  | 'manual_task'
  | 'completion_engine'
  | 'security'
  | 'system';

/**
 * Truthfulness class — the terminal must never present an agent's statement
 * with the same visual weight as Relay's own evidence.
 */
export type EventTruthClass =
  | 'agent_claim'
  | 'relay_evidence'
  | 'review_verdict'
  | 'user_action_required'
  | 'system_notice';

export interface WorkspaceTerminalEvent {
  eventId: string;
  /** ISO timestamp; rendered as HH:MM:SS. */
  at: string;
  category: TerminalEventCategory;
  truth: EventTruthClass;
  headline: string;
  detail?: string;
  /** True for preview fixture content. */
  fixture?: boolean;
}

/* ----------------------------------------------------------- manual task */

export interface ManualTask {
  taskId: string;
  /** Short reference, e.g. "MT-1". */
  reference: string;
  title: string;
  /** What Relay needs. */
  need: string;
  /** Why Relay stopped. */
  reason: string;
  /** What the developer must do. */
  requiredAction: string;
  /** What Relay will do afterward. */
  afterward: string;
  /** Whether the mission remains safe while blocked. */
  safeState: 'stopped_safely' | 'waiting';
  status: 'open' | 'approved' | 'rejected';
}

/* ------------------------------------------------------ review + repair */

export type FindingSeverity = 'low' | 'normal' | 'high' | 'blocking';

export interface ReviewFinding {
  findingId: string;
  severity: FindingSeverity;
  title: string;
  /** Acceptance criterion the finding affects. */
  criterion: string;
  evidenceSummary: string;
  requiredAction: string;
  status: 'open' | 'validated' | 'repaired' | 'closed';
}

export interface RepairTask {
  repairId: string;
  findingId: string;
  assignedTo: string;
  authorizedFiles: string[];
  status: 'created' | 'in_progress' | 'submitted' | 'verified';
  verification: 'pending' | 'passed' | 'failed';
}

/* ---------------------------------------------------------- verification */

export interface VerificationCheck {
  label: string;
  status: 'passed' | 'failed' | 'pending' | 'not_run';
}

export interface VerificationSummary {
  checks: VerificationCheck[];
  /** Truthful headline, e.g. "Required tests passed." Never fabricated. */
  headline: string | null;
}

/* -------------------------------------------------- research + brain */

export type ResearchStatusKind =
  | 'not_configured'
  | 'monitoring'
  | 'researching'
  | 'awaiting_approval';

export interface ResearchState {
  status: ResearchStatusKind;
  approvedTopics: string[];
  /** Safe activity note, e.g. "Authentication library guidance may be outdated." */
  note: string | null;
}

export interface ProjectBrainState {
  entries: number;
  lastUpdate: string | null;
  pendingApprovals: number;
}

/* ------------------------------------------------------------ completion */

export interface CompletionState {
  verdict: 'not_complete' | 'verified_complete';
  /** Evidence lines shown ONLY with a verified_complete verdict. */
  evidence: string[];
}

/* ------------------------------------------------------- component props */

export interface RelayProjectWorkspaceProps {
  project: WorkspaceProject;
  mission: WorkspaceMission;
  workforce: WorkforceAssignment;
  mode: RelayWorkspaceMode;
  phase: ProjectPhase;
  outputState: WorkspaceOutputState;
  dogState: WorkspaceDogState;
  handoffNetworkState: HandoffNetworkState;
  projectMessages: ProjectMessage[];
  terminalEvents: WorkspaceTerminalEvent[];
  manualTasks: ManualTask[];
  verificationSummary: VerificationSummary;
  reviewerState: ReviewerStateKind;
  findings: ReviewFinding[];
  repairs: RepairTask[];
  researchState: ResearchState;
  projectBrainState: ProjectBrainState;
  completionState: CompletionState;
  /** Whether research automation was enabled in Project Settings. */
  researchEnabled: boolean;
  /** Whether a repair cycle has occurred this mission. */
  repairUsed: boolean;
  terminalOpen: boolean;
  /** Mobile full-screen terminal presentation. */
  terminalFullScreen?: boolean;
  reducedMotion?: boolean;

  onSendProjectMessage: (text: string) => void;
  onApproveDecision: (decisionId: string) => void;
  onRejectDecision: (decisionId: string) => void;
  onOpenTerminal: () => void;
  onCloseTerminal: () => void;
  onOpenProjectSettings: () => void;
  onOpenManualTask: (taskId: string) => void;
  onApproveManualTask: (taskId: string) => void;
  onRejectManualTask: (taskId: string) => void;
  onRequestResearch: (topic: string) => void;
  onOpenFinding: (findingId: string) => void;
  onOpenRepair: (repairId: string) => void;
  onReturnHome: () => void;
}
