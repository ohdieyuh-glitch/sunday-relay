/**
 * Project Settings — public data contracts (frontend phase).
 *
 * The click-first project configurator between the Relay Entry Home and the
 * Active Project Workspace. A normal Relay project is configured entirely by
 * clicking — selectable rows, radio groups, segmented controls, chips,
 * toggles, steppers, presets. Freeform typing appears ONLY behind explicit
 * CUSTOM choices. Every selectable setting carries a typed value; labels are
 * never policy identifiers. The UI is never the policy authority.
 */

/* ------------------------------------------------------------- agents */

export type AgentAvailability =
  | 'connected'
  | 'available'
  | 'recommended'
  | 'sign_in_required'
  | 'api_connection_required'
  | 'not_configured'
  | 'simulation'
  | 'coming_later'
  | 'unavailable';

export type WorkforceRole = 'prompt_architect' | 'coding_agent' | 'reviewer';

export interface AgentOption {
  id: string;
  name: string;
  provider: string;
  role: WorkforceRole;
  availability: AgentAvailability;
  description: string;
  strengths: string[];
  planRequirement?: 'free' | 'pro' | 'max';
  recommended?: boolean;
  recommendationReason?: string;
  /** Agent ids this option is independent from (same-provider pairs are not). */
  independentFrom?: string[];
}

export type ReviewerPolicy = 'never' | 'substantive' | 'security_sensitive' | 'every_mission';

export interface RelayWorkforceSelection {
  promptArchitectId: string | null;
  codingAgentId: string | null;
  reviewerId: string | null;
  reviewerPolicy: ReviewerPolicy;
}

/* ----------------------------------------------------- project basics */

export type ProjectStage =
  | 'idea'
  | 'prototype'
  | 'active_development'
  | 'private_beta'
  | 'public_beta'
  | 'production';

export type ProjectSource =
  | 'new_project'
  | 'connect_repository'
  | 'import_context'
  | 'continue_relay_project';

export type SettingsProjectType =
  | 'web_app'
  | 'mobile_app'
  | 'desktop_app'
  | 'api'
  | 'backend_service'
  | 'ai_product'
  | 'ai_agent'
  | 'developer_tool'
  | 'browser_extension'
  | 'data_pipeline'
  | 'internal_tool'
  | 'library_sdk'
  | 'automation'
  | 'security_system'
  | 'existing_improvement';

export type TargetPlatform =
  | 'web'
  | 'ios'
  | 'android'
  | 'macos'
  | 'windows'
  | 'linux'
  | 'browser_extension'
  | 'server'
  | 'cloud'
  | 'local_only'
  | 'multi_platform';

export type DevicePriority = 'mobile_first' | 'desktop_first' | 'equal' | 'terminal_first' | 'api_only';

export type DeploymentTarget = 'none' | 'preview_only' | 'private_env' | 'staging' | 'production' | 'undecided';

/** Technology selection per category; ids come from the options module. */
export interface TechnologySelection {
  frontend: string | null;
  backend: string | null;
  database: string | null;
  hosting: string | null;
  testing: string | null;
}

/* --------------------------------------------------------------- mode */

export type RelayModeChoice = 'guided' | 'semi' | 'autonomous';

/* ------------------------------------------------------------ research */

export type ResearchMode = 'off' | 'on_demand' | 'periodic' | 'continuous_within_limits';
export type SourcePolicy = 'official_only' | 'official_plus_credible' | 'broad_with_citations' | 'approval_required';
export type BrainUpdatePolicy = 'ask_every' | 'auto_verified_facts' | 'summaries_only' | 'never_auto';
export type StaleCheckPolicy = 'every_mission' | 'weekly' | 'monthly' | 'on_request';

export interface ResearchSettings {
  mode: ResearchMode;
  topics: string[];
  sourcePolicy: SourcePolicy;
  brainUpdate: BrainUpdatePolicy;
  staleCheck: StaleCheckPolicy;
}

/* -------------------------------------------------------------- memory */

export type MemorySourceId =
  | 'repository'
  | 'project_brief'
  | 'project_settings'
  | 'uploaded_files'
  | 'project_brain'
  | 'sunday_alcatraz'
  | 'project_notes'
  | 'obsidian'
  | 'openknowledge'
  | 'previous_missions';

/* --------------------------------------------------------------- scope */

export type ScopePreset = 'narrow_feature' | 'module' | 'application' | 'full_repository' | 'custom';
export type FileAccessPolicy = 'claimed_files' | 'claimed_directories' | 'repo_read' | 'repo_edit' | 'ask_expansion';

export interface ScopeSettings {
  preset: ScopePreset;
  protectedAreas: string[];
  fileAccess: FileAccessPolicy;
  /** Populated only through the focused CUSTOM path selector. */
  customPaths: string[];
}

/* ---------------------------------------------------------- permissions */

export type DependencyPolicy = 'blocked' | 'ask_first' | 'approved_scope';
export type CommandPolicy = 'tests_only' | 'safe_dev' | 'approved_list' | 'ask_each';
export type NetworkPolicy = 'blocked' | 'research_only' | 'approved_services' | 'ask_first';
export type DeployPolicy = 'blocked' | 'preview_only' | 'staging' | 'production_with_approval';
export type DestructivePolicy = 'blocked' | 'manual_approval';

export interface PermissionSettings {
  dependencies: DependencyPolicy;
  commands: CommandPolicy;
  network: NetworkPolicy;
  deployment: DeployPolicy;
  destructive: DestructivePolicy;
}

/* --------------------------------------------------------- verification */

export type ReviewRequirement = 'none' | 'independent' | 'security' | 'manual_founder';
export type CompletionRule = 'strict' | 'balanced' | 'custom';

export interface VerificationSettings {
  tests: string[];
  inspections: string[];
  review: ReviewRequirement;
  completionRule: CompletionRule;
}

/* -------------------------------------------------------------- limits */

export type NoProgressPolicy = 'stop_immediately' | 'one_stalled' | 'two_stalled';

export interface LimitSettings {
  runtimeMinutes: number;
  agentCalls: number;
  spendUsd: number;
  reviewCycles: number;
  repairCycles: number;
  noProgress: NoProgressPolicy;
}

/* -------------------------------------------------------- notifications */

export interface NotificationSettings {
  events: string[];
  channels: string[];
}

/* ------------------------------------------------------ the full draft */

export interface ProjectSettingsDraft {
  projectName: string | null;
  stage: ProjectStage;
  source: ProjectSource | null;
  projectTypes: SettingsProjectType[];
  platforms: TargetPlatform[];
  devicePriority: DevicePriority;
  deploymentTarget: DeploymentTarget;
  technology: TechnologySelection;
  workforce: RelayWorkforceSelection;
  mode: RelayModeChoice;
  research: ResearchSettings;
  memorySources: MemorySourceId[];
  scope: ScopeSettings;
  permissions: PermissionSettings;
  verification: VerificationSettings;
  limits: LimitSettings;
  notifications: NotificationSettings;
}

/* ---------------------------------------------------------- validation */

export interface SettingsWarning {
  id: string;
  message: string;
}

export interface SettingsValidation {
  /** Missing required configuration — START PROJECT stays disabled. */
  blockers: SettingsWarning[];
  /** Surfaced but non-blocking. */
  warnings: SettingsWarning[];
  reviewerIndependent: boolean;
}

/* ------------------------------------------------------------ sections */

export type SettingsSectionId =
  | 'project'
  | 'project_type'
  | 'platform'
  | 'technology'
  | 'workforce'
  | 'mode'
  | 'research'
  | 'memory'
  | 'scope'
  | 'permissions'
  | 'verification'
  | 'limits'
  | 'notifications'
  | 'mcp'
  | 'review';

export interface RelayProjectSettingsProps {
  /** The beginning prompt from the Relay Entry Home (prefills the draft). */
  brief: import('../entry-home/contracts').ProjectBriefDraft | null;
  agentOptions: AgentOption[];
  entitlement: 'free' | 'pro' | 'max';
  initialDraft?: ProjectSettingsDraft;
  /**
   * MCP host state for section 14.
   *
   * OPTIONAL, AND ITS ABSENCE IS NOT AN EMPTY LIST. A host that has no MCP
   * surface omits this and the section says so; it never renders an empty
   * connection list, which would claim Relay inspected the workspace. It is
   * NOT part of `ProjectSettingsDraft`: connections are workspace state a host
   * reads, not a project setting this screen edits, and putting them in the
   * draft would make them savable and startable configuration they are not.
   */
  mcp?: import('../mcp').RelayMcpSettingsState;
  onSaveDraft: (draft: ProjectSettingsDraft) => void;
  onStartProject: (draft: ProjectSettingsDraft) => void;
  onConnectRepository: () => void;
  onBack: () => void;
  /**
   * What the single exit says, so it can tell the truth about where it goes.
   *
   * It was the literal "← RELAY HOME" inside the component. Settings is
   * reachable from the Entry Home AND from inside a project, and with one
   * hard-coded label the project case offered a founder exactly one exit,
   * named after the homepage. Defaults to the original text, so every existing
   * caller is unchanged.
   */
  backLabel?: string;
}
