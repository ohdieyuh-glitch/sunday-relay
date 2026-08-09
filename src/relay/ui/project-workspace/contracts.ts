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

import type { EventTruthClass, TerminalEventCategory } from '../../mission/wire-contracts';
import type { RelayAgentOperatingProjection } from '../../mission';
import type { RelayBackdropId } from '../relay-stage';
import type { RelayBrainDocument, RelayOperationsView } from '../../shared/llmops';
import type { RelayWorkforceSelection, WorkforceRole } from '../project-settings';
import type { DeploymentKind } from './role-occupant-map';
import type { ChakraTier } from '../../shared/relay-chakra';

/* ----------------------------------------------------------------- modes */

export type RelayWorkspaceMode = 'guided' | 'semi' | 'autonomous' | 'demo_simulation';

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
  | 'verified_complete'
  | 'demo_verified_complete';

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
  /** The coding agent is actively implementing (Milestone 4.5 motion). */
  | 'implementing'
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

/** The event category and truth class are DOMAIN vocabulary, not workspace
    presentation: `RelayEvent` on the wire is described by the same two unions,
    so they are declared in `mission/wire-contracts` and re-exported here. The
    re-export keeps every existing `from './contracts'` import site working. */
export type { EventTruthClass, TerminalEventCategory } from '../../mission/wire-contracts';

export interface WorkspaceTerminalEvent {
  eventId: string;
  /** ISO timestamp; rendered as HH:MM:SS. */
  at: string;
  category: TerminalEventCategory;
  truth: EventTruthClass;
  headline: string;
  detail?: string;
  /** Safe right-aligned operation summary for Terminal Mode, e.g.
      "MODIFY src/lib/relay-store.ts" or "RUN required tests". Never a raw
      command line, never output. */
  meta?: string;
  /** Step finished — Terminal Mode renders the green ✓ COMPLETE treatment.
      Truthfulness is unchanged: an agent's "done" is still its claim. */
  done?: boolean;
  /** True for preview fixture content. */
  fixture?: boolean;
  /** True only for the isolated browser Demo Simulation projection. */
  simulated?: boolean;
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
  /** Enabled in Project Settings; nothing runs until the first mission. */
  | 'configured'
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
  /**
   * The four canonical operating components per Relay Dog — Runtime, Mission
   * Contract, Environment, Tools — already projected.
   *
   * A PROP, not something this screen builds. All execution state enters
   * through props, and an operating profile is execution state: which runtime
   * is attached and which contract governs it are facts about a run, not
   * decorations a panel may invent. A configured project that has not started
   * a mission passes nothing, and the inspector correctly shows nothing —
   * a placeholder mission is not a mission.
   */
  operatingProfiles?: readonly RelayAgentOperatingProjection[];
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
  /**
   * The refreshed Project Brain document. Absent means no generator has run;
   * the panel says that rather than drawing an empty document.
   */
  projectBrainDocument?: RelayBrainDocument;
  /**
   * The operational half of the Project Brain. OPTIONAL, and its absence is
   * rendered as "no operations source is wired" rather than as zeroes — a
   * deployment that measures nothing and a project that reported nothing are
   * different facts and the panel says which one it is.
   */
  operationsView?: RelayOperationsView;
  completionState: CompletionState;
  /** Whether research automation was enabled in Project Settings. */
  researchEnabled: boolean;
  /** Whether a repair cycle has occurred this mission. */
  repairUsed: boolean;
  /** Claude Code — Coding Agent terminal view. Absent for fixtures and for
      any project with no real coding execution; the component then renders
      its own honest empty state. */
  codingTerminal?: import('./coding-terminal').CodingTerminalView;
  /** Truthful role / runtime / billing rows. Absent in fixture showcases. */
  roleBilling?: import('./coding-terminal').RoleBillingRow[];
  terminalOpen: boolean;
  /** Mobile full-screen terminal presentation. */
  terminalFullScreen?: boolean;
  reducedMotion?: boolean;
  /**
   * Which stage backdrop the user selected.
   *
   * A string rather than the union, deliberately: it arrives from stored
   * preference and may name a scene THIS BUILD DOES NOT HAVE. `resolveBackdrop`
   * turns an unknown id into `none` rather than into a substitute, because a
   * preference from an older build is a fact about that build and not an
   * instruction to show something else.
   */
  stageBackdrop?: string;
  /**
   * Told when the user picks a scene. OPTIONAL, and its absence does not
   * disable the picker: selection works either way and simply does not survive
   * a reload. Reporting a choice and storing one are different jobs, and the
   * workspace only does the first.
   *
   * SUPPLYING THIS MAKES `stageBackdrop` THE ONLY SOURCE OF TRUTH, and so
   * obliges the host to supply it and to echo back what it stored. The local
   * state stands down precisely so a write the host REJECTS is not drawn as
   * though it had been kept — the cost being that a host passing this handler
   * with no `stageBackdrop`, or one that never echoes, ships radios that
   * visibly refuse to move. Two optional props whose COMBINATION is the
   * contract; the type cannot express it, so this does, and a test pins it.
   */
  onSelectStageBackdrop?: (id: RelayBackdropId) => void;
  /**
   * An EXPLICIT viewport width for the Relay Stage, overriding measurement.
   *
   * The stage itself measures nothing — it is a pure projection of what someone
   * else observed, the same discipline this surface uses for a clock. The
   * observing is the WORKSPACE's job (`use-viewport-width.ts`), so absent means
   * "measure it", not "assume a desktop". A test or a non-browser host passes
   * this to state the width it means; only when there is no window at all does
   * a desktop width stand in.
   */
  viewportWidthPx?: number;
  /** Optional demo mission playback control, rendered above the console.
      Absent in fixtures and the honest configured state. */
  missionPlayback?: import('react').ReactNode;

  onSendProjectMessage: (text: string) => void;
  onApproveDecision: (decisionId: string) => void;
  onRejectDecision: (decisionId: string) => void;
  onOpenTerminal: () => void;
  onCloseTerminal: () => void;
  onOpenProjectSettings: () => void;
  /**
   * Open the Project Brain's own view.
   *
   * OPTIONAL, and its absence is honest rather than inert: a host that does
   * not implement the view gets a Brain that is present and not clickable,
   * instead of a control that appears to open something and does nothing.
   */
  onOpenProjectBrain?: () => void;
  /**
   * The project's workforce selection — the SAME record Project Settings
   * writes. Present means the strip's three role cells become controls;
   * absent means this workspace reports the stack and cannot change it, which
   * is what it did before, and the cells stay text rather than becoming
   * controls that do nothing.
   */
  workforceSelection?: RelayWorkforceSelection;
  /**
   * Change who holds a role, through the project's real configuration.
   * Absent for the same reason as above.
   */
  onSelectRoleOccupant?: (role: WorkforceRole, agentId: string) => void;
  /**
   * Which machine this workspace is talking to.
   *
   * An INPUT. A browser cannot tell a container from a laptop, and an occupant
   * that can only run on one of them is the difference between "not set up
   * yet" and "never, on this host" — so this is supplied rather than inferred.
   * Absent, or `null`, means no bridge is connected and the answer is UNKNOWN
   * rather than "founder machine".
   */
  deployment?: DeploymentKind;
  /**
   * The Relay Dog's progression tier, shared with the Project Brain above it
   * so the two read as one system. `null` — the default — renders both exactly
   * as shipped, because Relay awards no levels.
   */
  chakraTier?: ChakraTier | null;
  /**
   * Store a tier choice. Absent means this surface cannot remember one, and
   * the picker renders read-only rather than accepting a choice it will drop.
   */
  onSelectChakraTier?: (tier: ChakraTier | null) => void;
  onOpenManualTask: (taskId: string) => void;
  onApproveManualTask: (taskId: string) => void;
  onRejectManualTask: (taskId: string) => void;
  onRequestResearch: (topic: string) => void;
  onOpenFinding: (findingId: string) => void;
  onOpenRepair: (repairId: string) => void;
  onReturnHome: () => void;
}
