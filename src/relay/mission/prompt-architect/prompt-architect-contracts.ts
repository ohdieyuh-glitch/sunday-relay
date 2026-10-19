/**
 * THE CANONICAL PROMPT ARCHITECT RUNTIME RECORD.
 *
 * Provider-neutral by construction: GPT via the OpenAI Responses API is the
 * first implementation, and the contract is named after the ROLE, never the
 * vendor. Pure domain — no SDK, no network, no clock — so the browser can
 * render a planning run it may never start.
 *
 * The rules every field exists to enforce:
 *  - requested and ACTUAL model are separate; the provider response is the
 *    only authority for what actually answered;
 *  - a plan is a PROPOSAL until a human approves it — assumptions stay
 *    assumptions, unresolved questions stay unresolved, and proposed
 *    architecture decisions are never recorded as accepted;
 *  - a refusal, a malformed structure or an incomplete response is never a
 *    completion;
 *  - unknown usage stays unknown, and cost stays Unknown until Relay has a
 *    pricing authority for the exact returned model.
 */

export const PROMPT_ARCHITECT_SCHEMA_V1 = 'relay-prompt-architect.v1' as const;
export const PROMPT_ARCHITECT_SCHEMA_VERSION = PROMPT_ARCHITECT_SCHEMA_V1;
export const SUPPORTED_PROMPT_ARCHITECT_VERSIONS = [PROMPT_ARCHITECT_SCHEMA_V1] as const;
export type PromptArchitectSchemaVersion = (typeof SUPPORTED_PROMPT_ARCHITECT_VERSIONS)[number];

/** Capabilities an architect runtime may advertise — only if proven. */
export const PROMPT_ARCHITECT_CAPABILITIES = [
  'supportsLiveExecution',
  'supportsStreaming',
  'supportsStructuredOutput',
  'supportsCancellation',
  'supportsTokenUsage',
  'supportsProjectContext',
  'supportsExternalResearch',
] as const;
export type PromptArchitectCapability = (typeof PROMPT_ARCHITECT_CAPABILITIES)[number];
export type PromptArchitectCapabilities = Readonly<Record<PromptArchitectCapability, boolean>>;

export const NO_ARCHITECT_CAPABILITIES: PromptArchitectCapabilities = Object.freeze({
  supportsLiveExecution: false,
  supportsStreaming: false,
  supportsStructuredOutput: false,
  supportsCancellation: false,
  supportsTokenUsage: false,
  supportsProjectContext: false,
  // NEVER true in this milestone: no approved research tool is connected.
  supportsExternalResearch: false,
});

export const ARCHITECT_CONNECTION_STATES = [
  'not_connected',
  'bridge_required',
  'preparing',
  'planning',
  'completed',
  'needs_input',
  'stopped',
  'refused',
  'disconnected',
  'blocked',
] as const;
export type ArchitectConnectionState = (typeof ARCHITECT_CONNECTION_STATES)[number];

/** How a run ended, when it ended badly. Each is distinct from completion. */
export const ARCHITECT_FAILURE_CLASSES = [
  'authentication_failed',
  'permission_denied',
  'model_unavailable',
  'rate_limited',
  'timeout',
  'malformed_output',
  'refused',
  'incomplete_response',
  'network_disconnected',
  'provider_error',
  'context_too_large',
] as const;
export type ArchitectFailureClass = (typeof ARCHITECT_FAILURE_CLASSES)[number];

export interface ArchitectIdentity {
  readonly role: 'prompt_architect';
  readonly requestedRuntime: string;
  /** Observed only after verified provider evidence. `null` = Unknown. */
  readonly actualRuntime: string | null;
  readonly provider: string;
  readonly adapterId: string;
  readonly requestedModel: string | null;
  /** THE PROVIDER RESPONSE IS THE AUTHORITY. Never read from config. */
  readonly actualModel: string | null;
  readonly executionMode: 'live' | 'simulated' | 'offline';
  /** Redacted provider response id — tail only. */
  readonly responseIdRedacted: string | null;
  readonly runId: string | null;
  /** True only once the provider request was verifiably created. */
  readonly launchVerified: boolean;
}

/** Usage exactly as the provider reported it. */
export interface ArchitectUsage {
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly totalTokens: number | null;
  /** Relay has no pricing authority yet, so cost is Unknown by contract. */
  readonly costKnown: false;
  readonly source: 'provider_reported' | 'unavailable';
}

export const UNKNOWN_ARCHITECT_USAGE: ArchitectUsage = Object.freeze({
  inputTokens: null,
  cachedInputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  totalTokens: null,
  costKnown: false,
  source: 'unavailable',
});

/* ------------------------------------------------------ the plan itself */

/** An assumption stays labeled an assumption. It is never a requirement. */
export interface ArchitectAssumption {
  readonly id: string;
  readonly statement: string;
  readonly confidence: 'low' | 'medium' | 'high';
}

export interface ArchitectQuestion {
  readonly id: string;
  readonly question: string;
  readonly blocksImplementation: boolean;
}

export interface ArchitectRequirement {
  readonly id: string;
  readonly statement: string;
  readonly rationale: string;
}

/** A PROPOSED decision. `accepted` flips only through the approval authority. */
export interface ArchitectDecision {
  readonly id: string;
  readonly decision: string;
  readonly rationale: string;
  readonly alternativesConsidered: readonly string[];
  /** Always false as returned by the model. Approval is a separate act. */
  readonly accepted: false;
}

export interface ArchitectStep {
  readonly order: number;
  readonly description: string;
  readonly filesTouched: readonly string[];
}

export interface ArchitectRisk {
  readonly id: string;
  readonly risk: string;
  readonly mitigation: string;
  readonly severity: 'low' | 'medium' | 'high';
}

/**
 * The bounded handoff the architect PROPOSES for the Coding Agent. It can
 * never widen what the Mission Contract already allows: `boundHandoff`
 * intersects it against the contract before it is ever stored.
 */
export interface ArchitectHandoffProposal {
  readonly objective: string;
  readonly boundedTask: string;
  readonly acceptanceCriteria: readonly string[];
  readonly requiredTests: readonly string[];
  readonly allowedFileScope: readonly string[];
  readonly prohibitedActions: readonly string[];
  readonly grantedTools: readonly string[];
  readonly missionContractRef: string;
  readonly environmentRef: string | null;
  readonly expectedEvidence: readonly string[];
}

export interface ArchitectPlan {
  readonly objectiveSummary: string;
  readonly assumptions: readonly ArchitectAssumption[];
  readonly unresolvedQuestions: readonly ArchitectQuestion[];
  readonly requirements: readonly ArchitectRequirement[];
  readonly architectureDecisions: readonly ArchitectDecision[];
  readonly implementationSteps: readonly ArchitectStep[];
  readonly acceptanceCriteria: readonly string[];
  readonly testPlan: readonly string[];
  readonly risks: readonly ArchitectRisk[];
  readonly prohibitedActions: readonly string[];
  readonly handoff: ArchitectHandoffProposal;
  /** References only — the architect proposes, it never mutates. */
  readonly proposedContractAmendments: readonly string[];
  readonly contextRefs: readonly string[];
}

/** Approval is a separate act by the existing authority, never the model's. */
export const ARCHITECT_APPROVAL_STATES = [
  'not_requested', 'awaiting_approval', 'approved', 'changes_requested',
] as const;
export type ArchitectApprovalState = (typeof ARCHITECT_APPROVAL_STATES)[number];

export interface PromptArchitectRecord {
  readonly schemaVersion: PromptArchitectSchemaVersion;
  readonly missionId: string;
  readonly projectId: string;
  readonly identity: ArchitectIdentity;
  readonly capabilities: PromptArchitectCapabilities;
  readonly connectionState: ArchitectConnectionState;
  readonly missionContractRef: string;
  /** Which context blocks were included — ids, never their contents. */
  readonly contextRefs: readonly string[];
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /** Present only after STRICT schema validation succeeded. */
  readonly plan: ArchitectPlan | null;
  readonly approvalState: ArchitectApprovalState;
  readonly usage: ArchitectUsage;
  readonly cancellationRequested: boolean;
  readonly cancellationConfirmed: boolean;
  readonly failureClass: ArchitectFailureClass | null;
  /** Safe, redacted. Never a raw provider error with request details. */
  readonly failureMessage: string | null;
  readonly provenance: 'live' | 'simulated' | 'offline';
  readonly updatedAt: string;
  readonly checksum: string;
}

export type PromptArchitectRecordDraft = Omit<PromptArchitectRecord, 'checksum'>;

export const ACTIVE_ARCHITECT_STATES: readonly ArchitectConnectionState[] = [
  'preparing', 'planning',
];
export const BLOCKING_ARCHITECT_STATES: readonly ArchitectConnectionState[] = [
  'refused', 'disconnected', 'blocked',
];
