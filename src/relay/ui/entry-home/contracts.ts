/**
 * Relay Entry Home — public data contracts (frontend phase).
 *
 * The Entry Home is the FIRST in-product screen after switching from Sunday
 * Alcatraz into Sunday Relay, BEFORE Project Settings and BEFORE the Relay
 * execution console. Everything here is browser-safe typed state + callbacks:
 * no provider calls, no persistence, no credentials, no execution authority.
 * The UI is never the policy authority — it projects state it is given and
 * reports intent through callbacks.
 */

/* ----------------------------------------------------------------- states */

/** Project state before configuration. Never "ready to execute" here. */
export type EntryProductState = 'unconfigured' | 'draft';

export type HandoffNetworkState = 'standby' | 'online';

/** Home-screen dog states — pre-mission only. No working/execution states. */
export type HomeDogState = 'ready' | 'waiting' | 'wandering';

export type GuideStatus = 'idle' | 'listening' | 'drafting';

export type RelayEntitlement = 'free' | 'pro' | 'max';

/** Truthful connection statuses — never label an agent connected without a real adapter. */
export type AgentConnectionStatus =
  | 'connected'
  | 'available'
  | 'recommended'
  | 'sign_in_required'
  | 'simulation'
  | 'coming_later'
  | 'not_configured';

/** Home readiness. Execution readiness is decided ONLY after Project Settings. */
export type HomeReadiness =
  | 'idea_required'
  | 'project_brief_ready'
  | 'ready_for_project_settings';

/* ----------------------------------------------------------------- routes */

export type ProjectCategory =
  | 'product_feature'
  | 'interface'
  | 'new_application'
  | 'project_review'
  | 'bug_fix'
  | 'api_service'
  | 'authentication'
  | 'payments'
  | 'agent'
  | 'data_pipeline'
  | 'refactor'
  | 'performance'
  | 'project_memory'
  | 'internal_tool'
  | 'observability'
  | 'production_release';

export interface ProjectRouteDefinition {
  routeId: string;
  /** Display number, e.g. "01". */
  routeNumber: string;
  title: string;
  summary: string;
  category: ProjectCategory;
  /** Prefills the Project Objective when the route is selected. */
  objectiveTemplate: string;
  /** Monospaced route metadata shown on the selector plate. */
  meta: string;
  secondary?: boolean;
}

/* -------------------------------------------------------- recommendations */

export type WorkforceRole = 'prompt_architect' | 'coding_agent' | 'reviewer' | 'relay';

export interface WorkforceRoleRecommendation {
  role: WorkforceRole;
  agentName: string;
  description: string;
  responsibilities: string[];
  status: AgentConnectionStatus;
  /** Label on the handoff arrow leaving this role, e.g. "MISSION + RESEARCH + HANDOFF". */
  handoffLabel: string | null;
}

export interface WorkforceRecommendation {
  roles: WorkforceRoleRecommendation[];
  rationale: string;
}

/** Research preview — frontend configuration fields only. No research runs here. */
export interface ResearchRecommendation {
  /** Always 'not_configured' before Project Settings. */
  status: 'not_configured';
  description: string;
  topics: string[];
  sourceTypes: string[];
  knowledgeGaps: string[];
  updateSensitivity: 'low' | 'medium' | 'high';
  technologiesToMonitor: string[];
}

export interface EvidenceRecommendation {
  requirements: string[];
}

/* ---------------------------------------------------------- project brief */

export type RelayModeSuggestion = 'guided' | 'semi' | 'autonomous';

/**
 * The structured beginning prompt sent into Project Settings.
 * This is a PROJECT BRIEF DRAFT — never a Mission Contract. The Mission
 * Contract is created later by Relay and the Prompt Architect after Project
 * Settings is confirmed.
 */
export interface ProjectBriefDraft {
  workingTitle: string;
  projectType: string;
  category: ProjectCategory | null;
  problem: string;
  intendedUsers: string;
  desiredResult: string;
  coreFunctionality: string[];
  existingProject: boolean;
  technicalContext: string;
  preferredStack: string;
  visualDirection: string;
  constraints: string[];
  securitySensitivity: string;
  productionImpact: string;
  researchTopics: string[];
  unknowns: string[];
  knowledgeGaps: string[];
  suggestedPromptArchitect: string;
  suggestedCodingAgent: string;
  suggestedReviewer: string;
  suggestedMode: RelayModeSuggestion;
  evidenceRequirements: string[];
  completionCriteria: string[];
  openQuestions: string[];
}

/* --------------------------------------------------------- recent projects */

export type RecentProjectState =
  | 'draft'
  | 'ready'
  | 'in_progress'
  | 'researching'
  | 'waiting_for_user'
  | 'review_required'
  | 'revision_required'
  | 'stopped_safely'
  | 'verified_complete';

export type RecentResearchStatus =
  | 'not_configured'
  | 'monitoring'
  | 'researching'
  | 'awaiting_approval';

export interface RecentProjectSummary {
  projectId: string;
  name: string;
  projectType: string;
  /** Absolute display string, e.g. "2026-07-21 18:40 UTC". Never computed live. */
  lastActivity: string;
  mode: RelayModeSuggestion;
  state: RecentProjectState;
  workforce: {
    promptArchitect: string;
    codingAgent: string;
    reviewer: string | null;
  };
  researchStatus: RecentResearchStatus;
}

/* -------------------------------------------------------------- guide chat */

export interface GuideMessage {
  messageId: string;
  author: 'developer' | 'relay';
  text: string;
  /** Absolute display time string; the UI never invents timestamps. */
  at: string;
  /** True for preview fixture content — rendered with a FIXTURE label. */
  fixture?: boolean;
}

/* -------------------------------------------------- connection status map */

export interface ConnectionStatuses {
  promptArchitect: AgentConnectionStatus;
  codingAgent: AgentConnectionStatus;
  reviewer: AgentConnectionStatus;
}

/* ------------------------------------------------------- component props */

export interface RelayGuideChatProps {
  messages: GuideMessage[];
  status: GuideStatus;
  suggestedQuestions: string[];
  projectBriefDraft: ProjectBriefDraft | null;
  onSendMessage: (text: string) => void;
  onSelectSuggestedQuestion: (question: string) => void;
  onUpdateProjectBriefDraft: (patch: Partial<ProjectBriefDraft>) => void;
  onCopyProjectBrief: (formatted: string) => void;
  onClearProjectBrief: () => void;
  onContinueToProjectSettings: (draft: ProjectBriefDraft) => void;
}

export interface RelayEntryHomeProps {
  productState: EntryProductState;
  currentProject: null;
  recentProjects: RecentProjectSummary[];
  projectIdeaDraft: string;
  projectBriefDraft: ProjectBriefDraft | null;
  selectedRoute: ProjectRouteDefinition | null;
  /** Optional since the founder simplification — workforce/research moved to
      Project Settings; the deterministic logic remains for hosts that need it. */
  workforceRecommendation?: WorkforceRecommendation;
  researchRecommendation?: ResearchRecommendation;
  evidenceRecommendation?: EvidenceRecommendation;
  guideMessages: GuideMessage[];
  guideStatus: GuideStatus;
  suggestedQuestions: string[];
  dogState: HomeDogState;
  handoffNetworkState: HandoffNetworkState;
  entitlement: RelayEntitlement;
  connectionStatuses: ConnectionStatuses;
  reducedMotion?: boolean;

  /** Navigate to the Sunday Alcatraz SIBLING PRODUCT. Optional on purpose:
   * Alcatraz is a separate Aquala product with its own deployment, and this
   * repository serves Relay itself at `/`. When no Alcatraz URL is configured
   * the control must present itself as unavailable rather than link to a
   * route that does not exist here. */
  onReturnToSunday?: () => void;
  /** Why the sibling-product control is unavailable, shown to the user when
   * `onReturnToSunday` is absent. */
  siblingProductUnavailableReason?: string;
  onSelectProjectRoute: (route: ProjectRouteDefinition) => void;
  onUpdateProjectIdea: (text: string) => void;
  onBuildProjectBrief: (objective: string) => void;
  onConnectExistingProject: () => void;
  onAskRelay: (text: string) => void;
  onSelectSuggestedQuestion: (question: string) => void;
  onUpdateProjectBriefDraft: (patch: Partial<ProjectBriefDraft>) => void;
  onCopyProjectBrief: (formatted: string) => void;
  onClearProjectBrief: () => void;
  onContinueToProjectSettings: (draft: ProjectBriefDraft) => void;
  onOpenRecentProject: (projectId: string) => void;
  onOpenProjectSettings: () => void;
  onOpenTerminal: () => void;
}
