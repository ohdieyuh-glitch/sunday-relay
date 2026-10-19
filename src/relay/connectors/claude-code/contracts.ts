import type { ProjectId, RunId, TaskId, WorkspaceRefId } from '../../protocol/ids';

/**
 * Claude Code adapter contracts (Prompt 8) — module-local types for the
 * REAL local Claude Code coding-agent adapter. Nothing here calls a model;
 * these are the serializable records the adapter, doctor, and CLI exchange.
 *
 * Truthfulness invariant: this module distinguishes INSTALLED from
 * AUTHENTICATED and SUPPORTED from UNVERIFIED, and never stores or prints
 * credential material.
 */

export type CapabilitySupport = 'available' | 'unavailable' | 'unverified';

export interface ClaudeCodeCapabilityProfile {
  executablePath: string | null;
  version: string | null;
  nonInteractiveSupported: boolean;
  streamJsonSupported: boolean;
  explicitResumeSupported: boolean;
  /** This CLI has no --max-turns flag; bounded by runtime/output/call-count. */
  maxTurnsSupported: boolean;
  allowedToolsSupported: boolean;
  disallowedToolsSupported: boolean;
  toolsRestrictionSupported: boolean;
  permissionModeSupported: boolean;
  systemPromptSupported: boolean;
  appendSystemPromptSupported: boolean;
  structuredSchemaSupported: boolean;
  mcpIsolationSupported: CapabilitySupport;
  settingsIsolationSupported: CapabilitySupport;
  cancellationSupported: boolean;
  probedAt: string;
  provenance: 'live';
}

/** Safe authentication classification — NEVER tokens, emails, or org names. */
export type AuthSourceClass =
  | 'local_subscription'   // claude.ai OAuth (first-party) — the approved profile
  | 'api_key'              // ANTHROPIC_API_KEY / auth token — DISALLOWED here
  | 'bedrock' | 'vertex' | 'gateway'
  | 'not_logged_in'
  | 'unknown';

export interface ClaudeAuthClassification {
  loggedIn: boolean;
  sourceClass: AuthSourceClass;
  /** True only for local_subscription while logged in. */
  approvedForLiveRun: boolean;
  /** Present only as a coarse label ('max'/'pro'/'unknown') — never billing. */
  subscriptionLabel: string;
  classifiedAt: string;
}

/** The only Relay auth profile Prompt 8 permits. */
export const CLAUDE_AUTH_PROFILE = 'claude_local_subscription' as const;

/* --------------------------- settings risk -------------------------- */

export type SettingsRisk = 'clean' | 'review_required';

export interface ProjectSettingsAssessment {
  hasClaudeMd: boolean;
  hasProjectSettings: boolean;
  hasLocalSettings: boolean;
  hasMcpConfig: boolean;
  hasHooks: boolean;
  /** Structural findings only — never the file contents. */
  findings: string[];
  risk: SettingsRisk;
  assessedAt: string;
}

/* --------------------------- tool policy ---------------------------- */

export interface ClaudeToolPolicy {
  /** Built-in tools made available (--tools). No Bash for the safe fixture. */
  availableTools: string[];
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode: 'acceptEdits' | 'plan';
  /** True when path-scoped Edit rules could be compiled AND relied upon.
   * On this CLI version we treat edit path-scoping as advisory and rely on
   * the post-execution workspace inspection gate. */
  editPathScopingEnforced: boolean;
}

/* --------------------------- live limits ---------------------------- */

export interface ClaudeLiveLimits {
  maxTurns: number | null;   // null = CLI does not support turn capping
  maxRuntimeMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxNormalizedEvents: number;
  maxAutomaticRepairs: 0 | 1;
  maxLiveCallsPerRun: number;
}

export const DEFAULT_LIVE_LIMITS: ClaudeLiveLimits = {
  maxTurns: null,
  maxRuntimeMs: 6 * 60_000,
  maxStdoutBytes: 1024 * 1024,
  maxStderrBytes: 256 * 1024,
  maxNormalizedEvents: 500,
  maxAutomaticRepairs: 1,
  maxLiveCallsPerRun: 2,
};

/* --------------------------- session record ------------------------- */

export type ClaudeSessionStatus = 'created' | 'resumed' | 'completed' | 'failed' | 'cancelled';

/** Stores the Claude session UUID + association ONLY — never auth tokens.
 * Volatile (in-memory) like all Relay storage this phase. */
export interface ClaudeSessionRecord {
  claudeSessionId: string;
  adapterId: string;
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  workspaceId: WorkspaceRefId;
  attempt: number;
  createdAt: string;
  lastResumedAt?: string;
  status: ClaudeSessionStatus;
  provenance: 'live';
}

/* --------------------------- usage record --------------------------- */

export type UsageClass = 'provider-reported' | 'subscription-associated' | 'estimated' | 'unavailable';

export interface ClaudeUsageRecord {
  turns: number | null;
  durationMs: number | null;
  apiDurationMs: number | null;
  /** Provider-REPORTED cost, if present — NOT an invoice, NOT billed truth. */
  reportedCostUsd: number | null;
  model: string | null;
  claudeSessionId: string | null;
  resultStatus: string | null;
  usageClass: UsageClass;
}
