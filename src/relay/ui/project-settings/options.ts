import type {
  AgentOption,
  BrainUpdatePolicy,
  CommandPolicy,
  CompletionRule,
  DependencyPolicy,
  DeployPolicy,
  DeploymentTarget,
  DestructivePolicy,
  DevicePriority,
  FileAccessPolicy,
  MemorySourceId,
  NetworkPolicy,
  NoProgressPolicy,
  ProjectSource,
  ProjectStage,
  ResearchMode,
  ReviewRequirement,
  ReviewerPolicy,
  ScopePreset,
  SettingsProjectType,
  SourcePolicy,
  StaleCheckPolicy,
  TargetPlatform,
} from './contracts';

/**
 * Selectable option catalogs for the click-first Project Settings. Every
 * label maps to a typed value; availability statuses are TRUTHFUL — only the
 * Claude Code local adapter is connected and only the Codex reviewer adapter
 * is available in this repository. No Gemini or Google models appear
 * anywhere. Deterministic data — no provider call, no personalization claim.
 */

export interface Choice<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
  recommended?: boolean;
  unavailable?: boolean;
}

/* ------------------------------------------------------------- agents */

export const AGENT_OPTIONS: AgentOption[] = [
  /* -------- Prompt Architects -------- */
  {
    id: 'architect-sunday-alcatraz',
    name: 'Sunday Alcatraz',
    provider: 'Sunday',
    role: 'prompt_architect',
    availability: 'recommended',
    description:
      'Plans the mission, continuously researches the project, expands the Project Brain, and prepares every Coding Agent handoff.',
    strengths: [
      'Mission planning',
      'Requirements',
      'Continuous project research',
      'Project Brain development',
      'Handoff generation',
      'Revision Contracts',
    ],
    recommended: true,
    recommendationReason:
      'This project needs continuous planning, research, and Coding Agent handoffs.',
  },
  {
    id: 'architect-claude',
    name: 'Claude',
    provider: 'Anthropic',
    role: 'prompt_architect',
    availability: 'sign_in_required',
    description: 'Deep project analysis, technical planning, and prompt preparation.',
    strengths: ['Deep project analysis', 'Technical planning', 'Prompt preparation'],
  },
  {
    id: 'architect-gpt',
    name: 'GPT',
    provider: 'OpenAI',
    role: 'prompt_architect',
    availability: 'api_connection_required',
    description: 'Planning, prompt generation, and project clarification.',
    strengths: ['Planning', 'Prompt generation', 'Project clarification'],
  },
  {
    id: 'architect-codex',
    name: 'Codex',
    provider: 'OpenAI',
    role: 'prompt_architect',
    availability: 'not_configured',
    description: 'Technical planning and repository-aware task preparation.',
    strengths: ['Technical planning', 'Repository-aware task preparation'],
  },
  {
    id: 'architect-kimi',
    name: 'Kimi',
    provider: 'Moonshot',
    role: 'prompt_architect',
    availability: 'api_connection_required',
    description: 'Long-context planning support.',
    strengths: ['Long-context analysis'],
  },
  {
    id: 'architect-glm',
    name: 'GLM',
    provider: 'Zhipu',
    role: 'prompt_architect',
    availability: 'api_connection_required',
    description: 'Planning support.',
    strengths: ['Planning'],
  },
  {
    id: 'architect-manual',
    name: 'Manual Architect',
    provider: 'You',
    role: 'prompt_architect',
    availability: 'available',
    description: 'The developer prepares and approves all agent instructions.',
    strengths: ['Full developer control'],
  },
  {
    id: 'architect-external',
    name: 'External Architect',
    provider: 'External',
    role: 'prompt_architect',
    availability: 'not_configured',
    description: 'An external planning system through a future integration.',
    strengths: ['Custom integration'],
  },

  /* -------- Coding Agents -------- */
  {
    id: 'coding-claude-code',
    name: 'Claude Code',
    provider: 'Anthropic',
    role: 'coding_agent',
    availability: 'connected',
    description: 'Repository implementation through the real local adapter.',
    strengths: ['Repository implementation', 'Architecture-aware changes', 'Tests', 'Bounded repairs'],
    recommended: true,
    recommendationReason: 'The project needs repository-wide implementation and testing.',
  },
  {
    id: 'coding-codex',
    name: 'Codex',
    provider: 'OpenAI',
    role: 'coding_agent',
    availability: 'not_configured',
    description:
      'Coding tasks, repository changes, and tests. Implementation availability is separate from the Codex Reviewer.',
    strengths: ['Coding tasks', 'Repository changes', 'Tests'],
  },
  {
    id: 'coding-hermes',
    name: 'Hermes',
    provider: 'Nous',
    role: 'coding_agent',
    availability: 'coming_later',
    description: 'Coming later — no adapter exists yet.',
    strengths: [],
  },
  {
    id: 'coding-openclaw',
    name: 'OpenClaw',
    provider: 'OpenClaw',
    role: 'coding_agent',
    availability: 'coming_later',
    description: 'Coming later — no adapter exists yet.',
    strengths: [],
  },
  {
    id: 'coding-ophiuchus',
    name: 'Ophiuchus',
    provider: 'Ophiuchus',
    role: 'coding_agent',
    availability: 'coming_later',
    description: 'Coming later — no adapter exists yet.',
    strengths: [],
  },
  {
    id: 'coding-manual',
    name: 'Manual Coding Agent',
    provider: 'You',
    role: 'coding_agent',
    availability: 'available',
    description: 'The developer or an external worker performs implementation.',
    strengths: ['Full developer control'],
  },

  /* -------- Reviewers -------- */
  {
    id: 'reviewer-none',
    name: 'No Reviewer',
    provider: 'Relay',
    role: 'reviewer',
    availability: 'available',
    description: 'Relay verification still runs, but no independent AI review is required.',
    strengths: [],
  },
  {
    id: 'reviewer-codex',
    name: 'Codex',
    provider: 'OpenAI',
    role: 'reviewer',
    availability: 'available',
    description: 'Independent read-only review with findings and approval or required repair.',
    strengths: ['Independent read-only review', 'Findings', 'Approval or required repair'],
    recommended: true,
    recommendationReason: 'A real Codex reviewer adapter exists and is independent from Claude Code.',
  },
  {
    id: 'reviewer-claude',
    name: 'Claude',
    provider: 'Anthropic',
    role: 'reviewer',
    availability: 'not_configured',
    description: 'Review by Claude — no reviewer adapter is configured yet.',
    strengths: ['Code review'],
  },
  {
    id: 'reviewer-gpt',
    name: 'GPT',
    provider: 'OpenAI',
    role: 'reviewer',
    availability: 'api_connection_required',
    description: 'Review by GPT through a future API connection.',
    strengths: ['Code review'],
  },
  {
    id: 'reviewer-kimi',
    name: 'Kimi',
    provider: 'Moonshot',
    role: 'reviewer',
    availability: 'api_connection_required',
    description: 'Review by Kimi through a future API connection.',
    strengths: ['Long-context review'],
  },
  {
    id: 'reviewer-glm',
    name: 'GLM',
    provider: 'Zhipu',
    role: 'reviewer',
    availability: 'api_connection_required',
    description: 'Review by GLM through a future API connection.',
    strengths: ['Code review'],
  },
  {
    id: 'reviewer-manual',
    name: 'Manual Reviewer',
    provider: 'You',
    role: 'reviewer',
    availability: 'available',
    description: 'The developer or a teammate reviews the held output.',
    strengths: ['Human judgment'],
  },
  {
    id: 'reviewer-security',
    name: 'Security Reviewer',
    provider: 'Relay',
    role: 'reviewer',
    availability: 'coming_later',
    description: 'Coming later — dedicated security review profile.',
    strengths: [],
  },
  {
    id: 'reviewer-specialist',
    name: 'Specialist Reviewer',
    provider: 'Relay',
    role: 'reviewer',
    availability: 'coming_later',
    description: 'Coming later — domain-specialist review profile.',
    strengths: [],
  },
];

export const AVAILABILITY_LABEL: Record<AgentOption['availability'], string> = {
  connected: 'CONNECTED',
  available: 'AVAILABLE',
  recommended: 'RECOMMENDED',
  sign_in_required: 'SIGN-IN REQUIRED',
  api_connection_required: 'API CONNECTION REQUIRED',
  not_configured: 'NOT CONFIGURED',
  simulation: 'SIMULATION',
  coming_later: 'COMING LATER',
  unavailable: 'UNAVAILABLE',
};

/** Selectable = the option can be chosen right now (may still warn). */
export const SELECTABLE_AVAILABILITY: ReadonlySet<AgentOption['availability']> = new Set([
  'connected',
  'available',
  'recommended',
  'sign_in_required',
  'api_connection_required',
]);

export const REVIEWER_POLICY_CHOICES: Choice<ReviewerPolicy>[] = [
  { value: 'never', label: 'NEVER' },
  { value: 'substantive', label: 'SUBSTANTIVE CHANGES', recommended: true },
  { value: 'security_sensitive', label: 'SECURITY-SENSITIVE WORK' },
  { value: 'every_mission', label: 'EVERY MISSION' },
];

/* ------------------------------------------------------------ project */

export const STAGE_CHOICES: Choice<ProjectStage>[] = [
  { value: 'idea', label: 'IDEA' },
  { value: 'prototype', label: 'PROTOTYPE' },
  { value: 'active_development', label: 'ACTIVE DEVELOPMENT' },
  { value: 'private_beta', label: 'PRIVATE BETA' },
  { value: 'public_beta', label: 'PUBLIC BETA' },
  { value: 'production', label: 'PRODUCTION' },
];

export const SOURCE_CHOICES: Choice<ProjectSource>[] = [
  { value: 'new_project', label: 'NEW PROJECT' },
  { value: 'connect_repository', label: 'CONNECT REPOSITORY' },
  { value: 'import_context', label: 'IMPORT PROJECT CONTEXT' },
  { value: 'continue_relay_project', label: 'CONTINUE RELAY PROJECT' },
];

export const PROJECT_TYPE_CHOICES: Choice<SettingsProjectType>[] = [
  { value: 'web_app', label: 'Web application' },
  { value: 'mobile_app', label: 'Mobile application' },
  { value: 'desktop_app', label: 'Desktop application' },
  { value: 'api', label: 'API' },
  { value: 'backend_service', label: 'Backend service' },
  { value: 'ai_product', label: 'AI product' },
  { value: 'ai_agent', label: 'AI agent' },
  { value: 'developer_tool', label: 'Developer tool' },
  { value: 'browser_extension', label: 'Browser extension' },
  { value: 'data_pipeline', label: 'Data pipeline' },
  { value: 'internal_tool', label: 'Internal tool' },
  { value: 'library_sdk', label: 'Library or SDK' },
  { value: 'automation', label: 'Automation' },
  { value: 'security_system', label: 'Security system' },
  { value: 'existing_improvement', label: 'Existing project improvement' },
];

/* ----------------------------------------------------------- platform */

export const PLATFORM_CHOICES: Choice<TargetPlatform>[] = [
  { value: 'web', label: 'Web' },
  { value: 'ios', label: 'iOS' },
  { value: 'android', label: 'Android' },
  { value: 'macos', label: 'macOS' },
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
  { value: 'browser_extension', label: 'Browser extension' },
  { value: 'server', label: 'Server' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'local_only', label: 'Local only' },
  { value: 'multi_platform', label: 'Multi-platform' },
];

export const DEVICE_PRIORITY_CHOICES: Choice<DevicePriority>[] = [
  { value: 'mobile_first', label: 'MOBILE FIRST' },
  { value: 'desktop_first', label: 'DESKTOP FIRST' },
  { value: 'equal', label: 'EQUAL PRIORITY' },
  { value: 'terminal_first', label: 'TERMINAL FIRST' },
  { value: 'api_only', label: 'API ONLY' },
];

export const DEPLOYMENT_TARGET_CHOICES: Choice<DeploymentTarget>[] = [
  { value: 'none', label: 'NO DEPLOYMENT' },
  { value: 'preview_only', label: 'PREVIEW ONLY' },
  { value: 'private_env', label: 'PRIVATE ENVIRONMENT' },
  { value: 'staging', label: 'STAGING' },
  { value: 'production', label: 'PRODUCTION' },
  { value: 'undecided', label: 'NOT DECIDED' },
];

/* ---------------------------------------------------------- technology */

export interface TechCategory {
  key: keyof import('./contracts').TechnologySelection;
  label: string;
  choices: Choice[];
}

const relayRecommends = (hint: string): Choice => ({
  value: 'relay_recommends',
  label: 'Relay recommends',
  hint,
  recommended: true,
});

export const TECH_CATEGORIES: TechCategory[] = [
  {
    key: 'frontend',
    label: 'FRONTEND',
    choices: [
      { value: 'react', label: 'React' },
      { value: 'nextjs', label: 'Next.js' },
      { value: 'vue', label: 'Vue' },
      { value: 'svelte', label: 'Svelte' },
      { value: 'vanilla', label: 'Vanilla web' },
      { value: 'existing_stack', label: 'Existing project stack' },
      relayRecommends('Relay picks with the Prompt Architect during planning.'),
    ],
  },
  {
    key: 'backend',
    label: 'BACKEND',
    choices: [
      { value: 'node', label: 'Node.js' },
      { value: 'python', label: 'Python' },
      { value: 'go', label: 'Go' },
      { value: 'rust', label: 'Rust' },
      { value: 'existing_stack', label: 'Existing project stack' },
      { value: 'no_backend', label: 'No backend' },
      relayRecommends('Relay picks with the Prompt Architect during planning.'),
    ],
  },
  {
    key: 'database',
    label: 'DATABASE',
    choices: [
      { value: 'supabase', label: 'Supabase' },
      { value: 'postgresql', label: 'PostgreSQL' },
      { value: 'sqlite', label: 'SQLite' },
      { value: 'mongodb', label: 'MongoDB' },
      { value: 'existing_database', label: 'Existing database' },
      { value: 'no_database', label: 'No database' },
      relayRecommends('Relay picks with the Prompt Architect during planning.'),
    ],
  },
  {
    key: 'hosting',
    label: 'HOSTING',
    choices: [
      { value: 'vercel', label: 'Vercel' },
      { value: 'railway', label: 'Railway' },
      { value: 'supabase', label: 'Supabase' },
      { value: 'aws', label: 'AWS' },
      { value: 'local_only', label: 'Local only' },
      { value: 'existing_host', label: 'Existing host' },
      { value: 'no_deployment', label: 'No deployment' },
      relayRecommends('Relay picks with the Prompt Architect during planning.'),
    ],
  },
  {
    key: 'testing',
    label: 'TESTING',
    choices: [
      { value: 'node_test', label: 'Node test runner' },
      { value: 'vitest', label: 'Vitest' },
      { value: 'jest', label: 'Jest' },
      { value: 'playwright', label: 'Playwright' },
      { value: 'existing_suite', label: 'Existing project suite' },
      relayRecommends('Relay picks with the Prompt Architect during planning.'),
    ],
  },
];

/* ------------------------------------------------------------ research */

export const RESEARCH_MODE_CHOICES: Choice<ResearchMode>[] = [
  { value: 'off', label: 'OFF' },
  { value: 'on_demand', label: 'ON DEMAND' },
  { value: 'periodic', label: 'PERIODIC' },
  { value: 'continuous_within_limits', label: 'CONTINUOUS WITHIN LIMITS' },
];

export const RESEARCH_TOPIC_CHOICES: Choice[] = [
  'Technology stack',
  'Libraries and APIs',
  'Security guidance',
  'Product domain',
  'Competitors',
  'User needs',
  'Regulations',
  'Performance',
  'Accessibility',
  'Design patterns',
  'Deployment',
  'Costs',
  'Model providers',
  'Project-specific risks',
].map((label) => ({ value: label.toLowerCase().replace(/[^a-z]+/g, '_'), label }));

export const SOURCE_POLICY_CHOICES: Choice<SourcePolicy>[] = [
  { value: 'official_only', label: 'Official sources only' },
  { value: 'official_plus_credible', label: 'Official plus credible technical sources', recommended: true },
  { value: 'broad_with_citations', label: 'Broad research with citations' },
  { value: 'approval_required', label: 'Developer approval before adding knowledge' },
];

export const BRAIN_UPDATE_CHOICES: Choice<BrainUpdatePolicy>[] = [
  { value: 'ask_every', label: 'Ask before every update', recommended: true },
  { value: 'auto_verified_facts', label: 'Auto-add verified technical facts' },
  { value: 'summaries_only', label: 'Add summaries only' },
  { value: 'never_auto', label: 'Never update automatically' },
];

export const STALE_CHECK_CHOICES: Choice<StaleCheckPolicy>[] = [
  { value: 'every_mission', label: 'Check before every mission' },
  { value: 'weekly', label: 'Check weekly', recommended: true },
  { value: 'monthly', label: 'Check monthly' },
  { value: 'on_request', label: 'Only when requested' },
];

/* -------------------------------------------------------------- memory */

export const MEMORY_SOURCE_CHOICES: Array<Choice<MemorySourceId> & { status: string }> = [
  { value: 'repository', label: 'Repository context', status: 'AVAILABLE' },
  { value: 'project_brief', label: 'Project Brief', status: 'AVAILABLE' },
  { value: 'project_settings', label: 'Project Settings', status: 'AVAILABLE' },
  { value: 'uploaded_files', label: 'Uploaded files', status: 'AVAILABLE' },
  { value: 'project_brain', label: 'Relay Project Brain', status: 'AVAILABLE' },
  { value: 'sunday_alcatraz', label: 'Sunday Alcatraz context', status: 'AVAILABLE' },
  { value: 'project_notes', label: 'Project notes', status: 'AVAILABLE' },
  { value: 'obsidian', label: 'Obsidian', status: 'NOT CONFIGURED', unavailable: true },
  { value: 'openknowledge', label: 'OpenKnowledge', status: 'COMING LATER', unavailable: true },
  { value: 'previous_missions', label: 'Previous missions', status: 'AVAILABLE' },
];

/* --------------------------------------------------------------- scope */

export const SCOPE_PRESET_CHOICES: Choice<ScopePreset>[] = [
  { value: 'narrow_feature', label: 'NARROW FEATURE' },
  { value: 'module', label: 'MODULE' },
  { value: 'application', label: 'APPLICATION' },
  { value: 'full_repository', label: 'FULL REPOSITORY' },
  { value: 'custom', label: 'CUSTOM' },
];

export const PROTECTED_AREA_CHOICES: Choice[] = [
  'Authentication',
  'Billing',
  'Production configuration',
  'Deployment',
  'Secrets',
  'Database migrations',
  'Infrastructure',
  'Package manifests',
  'Lockfiles',
  'CI/CD',
  'Git metadata',
  'User data',
].map((label) => ({ value: label.toLowerCase().replace(/[^a-z]+/g, '_'), label }));

export const FILE_ACCESS_CHOICES: Choice<FileAccessPolicy>[] = [
  { value: 'claimed_files', label: 'Claimed files only', recommended: true },
  { value: 'claimed_directories', label: 'Claimed directories' },
  { value: 'repo_read', label: 'Repository-wide read' },
  { value: 'repo_edit', label: 'Repository-wide edit' },
  { value: 'ask_expansion', label: 'Ask before expansion' },
];

/* ---------------------------------------------------------- permissions */

export const DEPENDENCY_CHOICES: Choice<DependencyPolicy>[] = [
  { value: 'blocked', label: 'BLOCKED' },
  { value: 'ask_first', label: 'ASK FIRST', recommended: true },
  { value: 'approved_scope', label: 'ALLOWED IN APPROVED SCOPE' },
];

export const COMMAND_CHOICES: Choice<CommandPolicy>[] = [
  { value: 'tests_only', label: 'TESTS ONLY' },
  { value: 'safe_dev', label: 'SAFE DEVELOPMENT COMMANDS', recommended: true },
  { value: 'approved_list', label: 'APPROVED COMMAND LIST' },
  { value: 'ask_each', label: 'ASK EACH TIME' },
];

export const NETWORK_CHOICES: Choice<NetworkPolicy>[] = [
  { value: 'blocked', label: 'BLOCKED' },
  { value: 'research_only', label: 'RESEARCH ONLY' },
  { value: 'approved_services', label: 'APPROVED SERVICES' },
  { value: 'ask_first', label: 'ASK FIRST', recommended: true },
];

export const DEPLOY_CHOICES: Choice<DeployPolicy>[] = [
  { value: 'blocked', label: 'BLOCKED', recommended: true },
  { value: 'preview_only', label: 'PREVIEW ONLY' },
  { value: 'staging', label: 'STAGING' },
  { value: 'production_with_approval', label: 'PRODUCTION WITH APPROVAL' },
];

export const DESTRUCTIVE_CHOICES: Choice<DestructivePolicy>[] = [
  { value: 'blocked', label: 'BLOCKED', recommended: true },
  { value: 'manual_approval', label: 'MANUAL APPROVAL REQUIRED' },
];

/* --------------------------------------------------------- verification */

export const TEST_CHOICES: Choice[] = [
  'Existing test suite',
  'Unit tests',
  'Integration tests',
  'End-to-end tests',
  'Accessibility tests',
  'Security tests',
  'Typecheck',
  'Build',
  'Lint',
  'Manual verification',
].map((label) => ({ value: label.toLowerCase().replace(/[^a-z]+/g, '_'), label }));

export const INSPECTION_CHOICES: Choice[] = [
  'Claimed-file check',
  'Protected-path check',
  'Source-worktree protection',
  'Dependency-change check',
  'Secret scan',
  'Diff review',
].map((label) => ({ value: label.toLowerCase().replace(/[^a-z]+/g, '_'), label }));

export const REVIEW_REQUIREMENT_CHOICES: Choice<ReviewRequirement>[] = [
  { value: 'none', label: 'No independent review' },
  { value: 'independent', label: 'Independent Reviewer', recommended: true },
  { value: 'security', label: 'Security review' },
  { value: 'manual_founder', label: 'Manual founder approval' },
];

export const COMPLETION_RULE_CHOICES: Choice<CompletionRule>[] = [
  {
    value: 'strict',
    label: 'STRICT',
    hint: 'All blocking criteria, required tests, required evidence, and required reviews must pass.',
    recommended: true,
  },
  { value: 'balanced', label: 'BALANCED', hint: 'Required tests and configured review must pass.' },
  { value: 'custom', label: 'CUSTOM', hint: 'Choose exactly which gates apply.' },
];

/* -------------------------------------------------------------- limits */

export const RUNTIME_PRESETS = [15, 30, 60, 120];
export const CALL_PRESETS = [2, 4, 8, 12];
export const SPEND_PRESETS = [0, 1, 5, 10];
export const REVIEW_CYCLE_PRESETS = [0, 1, 2];
export const REPAIR_CYCLE_PRESETS = [0, 1, 2];

export const NO_PROGRESS_CHOICES: Choice<NoProgressPolicy>[] = [
  { value: 'stop_immediately', label: 'STOP IMMEDIATELY' },
  { value: 'one_stalled', label: '1 STALLED ATTEMPT', recommended: true },
  { value: 'two_stalled', label: '2 STALLED ATTEMPTS' },
];

/* -------------------------------------------------------- notifications */

export const NOTIFY_EVENT_CHOICES: Choice[] = [
  'Relay needs the developer',
  'Research finds an important change',
  'Project Brain update awaits approval',
  'Coding Agent submits work',
  'Relay verification fails',
  'Reviewer finds a blocker',
  'Repair is required',
  'Spending reaches a threshold',
  'Mission stops safely',
  'Mission is verified complete',
].map((label) => ({ value: label.toLowerCase().replace(/[^a-z]+/g, '_'), label }));

export const NOTIFY_CHANNEL_CHOICES: Array<Choice & { status: string }> = [
  { value: 'in_app', label: 'In-app', status: 'AVAILABLE' },
  { value: 'email', label: 'Email', status: 'NOT CONFIGURED', unavailable: true },
  { value: 'mobile_push', label: 'Mobile push', status: 'COMING LATER', unavailable: true },
  { value: 'terminal', label: 'Terminal notification', status: 'AVAILABLE' },
];
