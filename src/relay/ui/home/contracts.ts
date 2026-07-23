export type RelayHomeMode = 'guided' | 'semi' | 'autonomous';
export type RelayEntitlement = 'free' | 'pro' | 'max';
export type RelayDogState = 'ready' | 'wandering' | 'waiting';
export type RelayTerminalState = 'idle' | 'active' | 'waiting' | 'failure';
export type ProjectKind = 'new' | 'existing';

export type AvailabilityStatus =
  | 'recommended'
  | 'connected'
  | 'available'
  | 'sign-in-required'
  | 'simulation'
  | 'pro'
  | 'max'
  | 'coming-later'
  | 'not-configured';

export interface AgentConnectionStatuses {
  architect: Record<string, AvailabilityStatus>;
  coding: Record<string, AvailabilityStatus>;
  reviewer: Record<string, AvailabilityStatus>;
}

export interface RelayProjectDraft {
  name: string;
  description: string;
  objective: string;
  kind: ProjectKind;
  category: string;
  source: string;
  filesInScope: string;
  filesOutOfScope: string;
  protectedAreas: string;
  productionPresent: boolean;
  deploymentAllowed: boolean;
  destructiveActionsAllowed: boolean;
  dependencyInstallationAllowed: boolean;
  architect: string;
  codingAgent: string;
  reviewer: string;
  reviewerRequired: boolean;
  mode: RelayHomeMode | '';
  approvedTools: string;
  approvedServices: string;
  approvedSessions: string;
  runtimeLimitMinutes: number;
  spendingLimitUsd: number;
  consentExpiration: string;
  memory: string[];
  requiredTests: boolean;
  requiredBuild: boolean;
  requiredIndependentReview: boolean;
  requiredSecurityReview: boolean;
  requiredManualApproval: boolean;
  evidenceRequired: string;
  completionRule: string;
  maximumAgentCalls: number;
  maximumReviewCycles: number;
  maximumRepairCycles: number;
  stopOnNoProgress: boolean;
  notifications: string[];
  boundariesConfirmed: boolean;
}

export type RecentProjectState =
  | 'READY'
  | 'IN PROGRESS'
  | 'WAITING FOR USER'
  | 'REVIEW REQUIRED'
  | 'STOPPED SAFELY'
  | 'VERIFIED COMPLETE';

export interface RelayRecentProject {
  id: string;
  name: string;
  lastActivity: string;
  state: RecentProjectState;
  activeAgents: string[];
  mode: RelayHomeMode;
  completionStatus: string;
}

export interface RelayHomePageProps {
  projectDraft: RelayProjectDraft;
  recentProjects: RelayRecentProject[];
  entitlement: RelayEntitlement;
  connectionStatuses: AgentConnectionStatuses;
  dogState: RelayDogState;
  terminalState: RelayTerminalState;
  onCreateProject: (draft: RelayProjectDraft) => void;
  onConnectProject: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenProjectSettings: () => void;
  onOpenTerminal: () => void;
  onUpdateProjectDraft: (draft: RelayProjectDraft) => void;
  onApplyRecommendation: (draft: RelayProjectDraft) => void;
  onSaveProjectSettings?: (draft: RelayProjectDraft) => void;
  onCancelProjectSettings?: () => void;
}

export interface ProjectRoute {
  id: string;
  number: string;
  title: string;
  description: string;
  objective: string;
  category: string;
  evidence: string;
  codingAgent?: string;
  reviewer?: string;
}
