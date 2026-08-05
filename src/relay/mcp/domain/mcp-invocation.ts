/**
 * MCP INVOCATION AND AUDIT RECORDS (PURE).
 *
 * THE INVARIANT: an invocation that timed out, was cancelled, or whose server
 * process crashed CANNOT be recorded as completed. Not "should not" — cannot.
 * `settleInvocation` is the only constructor of a terminal invocation record,
 * and it refuses to produce `completed` for any state or failure category that
 * forbids it (§24 scenarios 14–16). A rule enforced in one function is a rule;
 * a rule enforced by convention at eleven call sites is a wish.
 *
 * WHAT AN AUDIT RECORD DELIBERATELY DOES NOT CONTAIN. Everything here is
 * mission evidence, so it goes to the Trace Ledger and Execution Capsules,
 * which are append-only. That makes every field a permanent decision:
 *
 *   arguments        NOT stored. A `safeArgumentSummary` (shape and sizes) and
 *                    an `argumentFingerprint` (digest) are, because approval
 *                    scoping needs to know "the same arguments" without
 *                    retaining a repository path, a query, or a message body
 *                    forever.
 *   result           NOT stored. A `safeResultSummary` and evidence REFERENCES
 *                    are. §13 is explicit: raw unrestricted results never enter
 *                    the permanent ledger.
 *   credentials      Never present in any form, including inside arguments —
 *                    redaction runs before the summary is built.
 *
 * The argument fingerprint is what makes "approval does not widen silently"
 * (§12) mechanically checkable: an approval binds to a fingerprint, so
 * approving a write to one path cannot authorize a write to another.
 */

import type {
  McpApprovalRecordId, McpAuditRecordId, McpCapabilitySnapshotId, McpConnectionId, McpInvocationId,
} from '../../protocol/ids';
import { fingerprintValue, type McpCapabilityFingerprint } from './mcp-fingerprint';
import { forbidsSuccess, type McpFailure } from './mcp-failure';
import type { McpCapabilityKind } from './mcp-capabilities';

export const MCP_INVOCATION_STATES = [
  'requested',
  'policy_evaluating',
  'awaiting_approval',
  'denied',
  'dispatched',
  'completed',
  'failed',
  'timed_out',
  'cancelled',
] as const;
export type McpInvocationState = (typeof MCP_INVOCATION_STATES)[number];

/** States in which the operation definitively did not do what was asked. */
export const MCP_UNSUCCESSFUL_STATES: readonly McpInvocationState[] = Object.freeze([
  'denied', 'failed', 'timed_out', 'cancelled',
]);

/** The agent-facing request. `arguments` is UNTRUSTED and never persisted. */
export interface McpInvocationRequest {
  readonly invocationId: McpInvocationId;
  readonly connectionId: McpConnectionId;
  readonly capabilityKind: McpCapabilityKind;
  /** Tool name, resource URI, or prompt name. */
  readonly capabilityName: string;
  readonly arguments: Record<string, unknown>;
  readonly requestedAt: string;
  /** Bounded wait. The gateway enforces it; it is never unlimited. */
  readonly timeoutMs: number;
}

/**
 * A structural description of the arguments, safe to keep forever.
 *
 * Values are described, never included: `{path: "src/x.ts"}` becomes
 * `{path: "string(9)"}`. That is enough to review "what shape of call was
 * this?" and to spot a call whose argument set changed, without turning the
 * ledger into a transcript of every path, query and message body an agent ever
 * sent.
 */
export type McpSafeArgumentSummary = Readonly<Record<string, string>>;

export function summarizeArguments(args: Record<string, unknown>): McpSafeArgumentSummary {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    summary[key] = describeValue(value, 0);
  }
  return Object.freeze(summary);
}

function describeValue(value: unknown, depth: number): string {
  if (value === null) return 'null';
  if (depth > 4) return 'nested';
  switch (typeof value) {
    case 'string': return `string(${value.length})`;
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'object': {
      if (Array.isArray(value)) return `array(${value.length})`;
      return `object(${Object.keys(value as Record<string, unknown>).length})`;
    }
    default: return typeof value;
  }
}

/**
 * The digest an approval binds to. Computed over the ACTUAL argument values,
 * so two calls are "the same call" only when their arguments match exactly —
 * this is what stops an approval for `read(a.txt)` covering `read(b.txt)`.
 * The digest is one-way; it identifies without disclosing.
 */
export const argumentFingerprint = (
  capabilityName: string,
  args: Record<string, unknown>,
): McpCapabilityFingerprint => fingerprintValue('mcp.arguments', { capabilityName, args });

/** A bounded, redacted description of what came back. */
export interface McpSafeResultSummary {
  readonly contentBlocks: number;
  readonly totalBytes: number;
  readonly mimeTypes: readonly string[];
  readonly truncated: boolean;
  readonly redactionsApplied: number;
  readonly injectionSignals: readonly string[];
  readonly isError: boolean;
}

export interface McpInvocationResult {
  readonly invocationId: McpInvocationId;
  readonly state: McpInvocationState;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly summary: McpSafeResultSummary | null;
  /** Ids of stored evidence; never the evidence content itself. */
  readonly evidenceReferences: readonly string[];
  readonly failure: McpFailure | null;
  /** Sanitized, size-bounded payload handed to the agent — not persisted. */
  readonly agentFacingContent: readonly McpSanitizedContentBlock[];
}

export interface McpSanitizedContentBlock {
  readonly type: 'text' | 'reference' | 'refused';
  readonly text: string;
  /** Provenance travels WITH the content, so an agent can never be handed
   * external text that looks like it came from Relay. */
  readonly sourceServerName: string;
  readonly capabilityFingerprint: McpCapabilityFingerprint;
  readonly retrievedAt: string;
  readonly injectionSignals: readonly string[];
}

/**
 * THE ONLY WAY TO PRODUCE A TERMINAL INVOCATION RESULT.
 *
 * `intendedState` is what the caller believes happened. When a failure is
 * present whose category forbids success, the intent is OVERRIDDEN rather than
 * trusted — so a transport that returns both a partial result and a timeout
 * cannot have the partial result recorded as a completion.
 */
export function settleInvocation(input: {
  readonly invocationId: McpInvocationId;
  readonly intendedState: McpInvocationState;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly summary: McpSafeResultSummary | null;
  readonly evidenceReferences?: readonly string[];
  readonly failure: McpFailure | null;
  readonly agentFacingContent?: readonly McpSanitizedContentBlock[];
}): McpInvocationResult {
  // A FAILURE ALWAYS DERIVES ITS OWN TERMINAL STATE. The caller's intent is
  // not consulted when a failure is present — not even to choose between two
  // unsuccessful states. Letting the caller pass `failed` alongside a
  // `timed_out` failure is how a timeout becomes indistinguishable from a
  // server error in the ledger, which is the exact distinction §7 and §24
  // require Relay to keep. `forbidsSuccess` remains the belt to this braces:
  // it asserts the derived state can never be `completed`.
  let state = input.intendedState;
  if (input.failure !== null) {
    state = stateForFailure(input.failure);
    // Belt to the braces: `stateForFailure` never returns `completed`, and this
    // asserts it rather than assuming it. A future category mapped carelessly
    // would otherwise be the one line that turns a failure into a success.
    if (state === 'completed' || forbidsSuccess(input.failure.category)) {
      state = state === 'completed' ? 'failed' : state;
    }
  }
  return {
    invocationId: input.invocationId,
    state,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    // A non-completed invocation carries no result summary. Keeping one would
    // let a reader treat "we saw 4 KB before the timeout" as an outcome.
    summary: state === 'completed' ? input.summary : null,
    evidenceReferences: input.evidenceReferences ?? [],
    failure: input.failure,
    agentFacingContent: state === 'completed' ? (input.agentFacingContent ?? []) : [],
  };
}

export function stateForFailure(failure: McpFailure): McpInvocationState {
  switch (failure.category) {
    case 'timed_out': return 'timed_out';
    case 'cancelled': return 'cancelled';
    case 'permission_denied': return 'denied';
    case 'approval_required':
    case 'approval_expired':
    case 'approval_exhausted': return 'awaiting_approval';
    default: return 'failed';
  }
}

/* ------------------------------------------------------------------ *
 * Audit record — the permanent, safe evidence of one invocation.
 * ------------------------------------------------------------------ */

export interface McpAuditRecord {
  readonly auditRecordId: McpAuditRecordId;
  readonly invocationId: McpInvocationId;

  /* who */
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly missionId: string | null;
  /** The PSP Agent this execution was authorized under, when applicable. */
  readonly pspAgentFingerprint: string | null;
  readonly actualAgentId: string;
  readonly agentRole: string;

  /* what */
  readonly connectionId: McpConnectionId;
  readonly serverName: string;
  readonly serverTrust: string;
  readonly capabilitySnapshotId: McpCapabilitySnapshotId;
  readonly capabilityFingerprint: McpCapabilityFingerprint;
  readonly capabilityKind: McpCapabilityKind;
  readonly capabilityName: string;
  readonly safeArgumentSummary: McpSafeArgumentSummary;
  readonly argumentFingerprint: McpCapabilityFingerprint;

  /* policy */
  readonly riskClass: string;
  readonly permissionDecision: string;
  readonly permissionReason: string;
  readonly approvalRecordId: McpApprovalRecordId | null;

  /* when */
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;

  /* outcome */
  readonly invocationState: McpInvocationState;
  readonly cancelled: boolean;
  readonly timedOut: boolean;
  readonly safeResultSummary: McpSafeResultSummary | null;
  readonly evidenceReferences: readonly string[];
  readonly failureCategory: string | null;

  /* transport evidence */
  readonly transport: string;
  readonly negotiatedProtocolVersion: string | null;
}
