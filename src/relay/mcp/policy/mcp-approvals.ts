/**
 * MCP APPROVAL BROKER (PURE).
 *
 * THE PROPERTY THIS FILE EXISTS TO GUARANTEE: **an approval never widens.**
 *
 * §12 lists the ways approvals silently widen in practice, and every one of
 * them is a field on `McpApprovalRecord` that `approvalCovers` compares:
 *
 *   read Repository A ⇏ Repository B      → `argumentFingerprint`
 *   create a branch ⇏ merge               → `capabilityName`
 *   query a database ⇏ mutate it          → `riskClass` AND `capabilityName`
 *   write one path ⇏ every path           → `argumentFingerprint`
 *   invoke one tool ⇏ the whole server    → `capabilityName`, not server id
 *   run once ⇏ unlimited recurrence       → `maximumInvocations` / `usageCount`
 *
 * `approvalCovers` returns a REASON on every refusal, so the CLI and the
 * website can tell an operator which dimension failed rather than "not
 * approved". An approval system whose refusals are opaque gets bypassed by
 * whoever is on call at 2am.
 *
 * THE ARGUMENT FINGERPRINT IS THE HARD PART, and it is deliberately strict:
 * an approval is bound to the EXACT arguments it was shown. Change one
 * character of a path and the approval no longer applies. That is correct even
 * though it is inconvenient — a human approved a specific action, and a system
 * that reuses that consent for a similar-looking action has forged it.
 * `allow_for_mission` exists as the deliberate, scoped relaxation: it drops the
 * argument binding for one named capability within one mission, which is a
 * decision a human makes explicitly, once, with that consequence stated.
 *
 * NOTHING HERE READS A CLOCK. `now` is always passed in — the same convention
 * as the rest of the Relay domain, so expiry is testable without waiting.
 */

import type { McpApprovalRecordId, McpApprovalRequestId } from '../../protocol/ids';
import type { McpCapabilityFingerprint } from '../domain/mcp-fingerprint';
import type { McpCapabilityKind } from '../domain/mcp-capabilities';
import type { McpRiskClass } from './mcp-risk';

export const MCP_APPROVAL_POLICIES = [
  /** Every matching invocation is permitted until expiry/revocation. */
  'always_allow',
  /** Permitted for one mission, for one named capability, any arguments. */
  'allow_for_mission',
  /** Exactly one invocation, with exactly these arguments. */
  'allow_once',
  /** No standing approval; a human is asked every time. */
  'ask_every_time',
  /** Explicitly refused. Recorded so the refusal is evidence, not silence. */
  'deny',
] as const;
export type McpApprovalPolicy = (typeof MCP_APPROVAL_POLICIES)[number];

export const MCP_APPROVAL_STATES = ['pending', 'granted', 'denied', 'expired', 'exhausted', 'revoked'] as const;
export type McpApprovalState = (typeof MCP_APPROVAL_STATES)[number];

/** What the human is shown before deciding. Every field is safe to display. */
export interface McpApprovalRequest {
  readonly approvalRequestId: McpApprovalRequestId;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly missionId: string | null;
  readonly actualAgentId: string;
  readonly agentRole: string;
  readonly serverName: string;
  readonly serverTrust: string;
  readonly capabilitySnapshotFingerprint: McpCapabilityFingerprint;
  readonly capabilityKind: McpCapabilityKind;
  readonly capabilityName: string;
  readonly argumentFingerprint: McpCapabilityFingerprint;
  /** Shape-only description — never the argument values. */
  readonly safeArgumentSummary: Readonly<Record<string, string>>;
  readonly riskClass: McpRiskClass;
  /** Why Relay classified it this way — the human sees the reasoning. */
  readonly riskEvidence: readonly string[];
  readonly requestedAt: string;
}

export interface McpApprovalRecord {
  readonly approvalRecordId: McpApprovalRecordId;
  readonly approvalRequestId: McpApprovalRequestId;
  readonly policy: McpApprovalPolicy;
  readonly state: McpApprovalState;

  /** The AUTHENTICATED HUMAN who decided. Never an agent, never a service. */
  readonly decidedByHumanId: string;
  readonly decidedAt: string;

  /* the exact scope the consent covers */
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly missionId: string | null;
  readonly actualAgentId: string;
  readonly agentRole: string;
  readonly serverName: string;
  readonly capabilitySnapshotFingerprint: McpCapabilityFingerprint;
  readonly capabilityKind: McpCapabilityKind;
  readonly capabilityName: string;
  readonly argumentFingerprint: McpCapabilityFingerprint;
  readonly riskClass: McpRiskClass;

  readonly expiresAt: string | null;
  readonly maximumInvocations: number;
  readonly usageCount: number;
  readonly revokedAt: string | null;
}

export interface McpApprovalCheckInput {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly missionId: string | null;
  readonly actualAgentId: string;
  readonly agentRole: string;
  readonly serverName: string;
  readonly capabilitySnapshotFingerprint: McpCapabilityFingerprint;
  readonly capabilityKind: McpCapabilityKind;
  readonly capabilityName: string;
  readonly argumentFingerprint: McpCapabilityFingerprint;
  readonly riskClass: McpRiskClass;
  readonly now: string;
}

export type McpApprovalVerdict =
  | { readonly covered: true; readonly record: McpApprovalRecord }
  | { readonly covered: false; readonly reason: string; readonly state: McpApprovalState | 'absent' };

/**
 * Does this ONE approval record cover this ONE request?
 *
 * Every early return names the dimension that failed. The order runs from
 * "this consent is not alive" through "this consent is about something else"
 * to "this consent has been spent", because that is the order an operator
 * reads them in.
 */
export function approvalCovers(
  record: McpApprovalRecord,
  input: McpApprovalCheckInput,
): McpApprovalVerdict {
  const no = (reason: string, state: McpApprovalState): McpApprovalVerdict =>
    ({ covered: false, reason, state });

  if (record.policy === 'deny') return no('a human explicitly refused this operation', 'denied');
  if (record.policy === 'ask_every_time') {
    return no('this operation is configured to ask every time — no standing approval applies', 'pending');
  }
  if (record.state !== 'granted') return no(`the approval is ${record.state}, not granted`, record.state);
  if (record.revokedAt !== null) return no('the approval was revoked', 'revoked');
  if (record.expiresAt !== null && Date.parse(record.expiresAt) <= Date.parse(input.now)) {
    return no('the approval has expired', 'expired');
  }
  if (record.usageCount >= record.maximumInvocations) {
    return no(
      `the approval permitted ${record.maximumInvocations} invocation(s) and has been used ${record.usageCount} time(s)`,
      'exhausted',
    );
  }

  /* --- scope identity --- */
  if (record.accountId !== input.accountId) return no('the approval belongs to a different account', 'granted');
  if (record.workspaceId !== input.workspaceId) return no('the approval belongs to a different workspace', 'granted');
  if (record.projectId !== null && record.projectId !== input.projectId) {
    return no('the approval is scoped to a different project', 'granted');
  }
  if (record.actualAgentId !== input.actualAgentId) {
    return no('the approval was granted to a different agent', 'granted');
  }
  if (record.agentRole !== input.agentRole) {
    return no('the approval was granted for a different agent role', 'granted');
  }
  if (record.serverName !== input.serverName) {
    return no('the approval was granted for a different MCP server', 'granted');
  }

  /* --- the capability snapshot the human actually saw --- */
  if (record.capabilitySnapshotFingerprint !== input.capabilitySnapshotFingerprint) {
    return no(
      "the server's capability surface changed after this approval was granted — a new approval is required",
      'granted',
    );
  }

  /* --- the exact operation --- */
  if (record.capabilityKind !== input.capabilityKind) {
    return no('the approval covers a different kind of capability', 'granted');
  }
  if (record.capabilityName !== input.capabilityName) {
    return no(`the approval covers "${record.capabilityName}", not "${input.capabilityName}"`, 'granted');
  }

  /* --- risk may not have grown since consent --- */
  if (record.riskClass !== input.riskClass) {
    return no(
      `the approval was granted for a ${record.riskClass} operation; this one classifies as ${input.riskClass}`,
      'granted',
    );
  }

  /* --- mission scoping --- */
  if (record.policy === 'allow_for_mission') {
    if (record.missionId === null || record.missionId !== input.missionId) {
      return no('the mission-scoped approval belongs to a different mission', 'granted');
    }
    // Deliberately NOT comparing arguments: that is what mission scoping means.
    return { covered: true, record };
  }

  /* --- argument binding for always_allow and allow_once --- */
  if (record.argumentFingerprint !== input.argumentFingerprint) {
    return no('the approval was granted for different arguments', 'granted');
  }
  if (record.policy === 'allow_once' && record.usageCount >= 1) {
    return no('a single-use approval has already been used', 'exhausted');
  }

  return { covered: true, record };
}

/** Finds the first covering approval, or explains why none did. */
export function findCoveringApproval(
  records: readonly McpApprovalRecord[],
  input: McpApprovalCheckInput,
): McpApprovalVerdict {
  if (records.length === 0) {
    return { covered: false, reason: 'no human approval exists for this operation', state: 'absent' };
  }
  let lastReason: McpApprovalVerdict = {
    covered: false, reason: 'no human approval exists for this operation', state: 'absent',
  };
  for (const record of records) {
    const verdict = approvalCovers(record, input);
    if (verdict.covered) return verdict;
    lastReason = verdict;
    // An explicit denial is final: it must not be overtaken by a later,
    // broader grant sitting further down the list.
    if (verdict.state === 'denied') return verdict;
  }
  return lastReason;
}

/**
 * Consumes one use. Returns a NEW record — records are immutable, so an
 * in-flight evaluation can never observe a half-updated approval, and the
 * previous state stays available as evidence.
 */
export function consumeApproval(record: McpApprovalRecord): McpApprovalRecord {
  const usageCount = record.usageCount + 1;
  return {
    ...record,
    usageCount,
    state: usageCount >= record.maximumInvocations ? 'exhausted' : record.state,
  };
}

export function revokeApproval(record: McpApprovalRecord, at: string): McpApprovalRecord {
  return { ...record, state: 'revoked', revokedAt: at };
}

/**
 * The default invocation ceiling per policy. `always_allow` is deliberately
 * bounded rather than infinite: an approval that can be used an unlimited
 * number of times is indistinguishable from turning the check off, and a
 * high-but-finite ceiling still produces an `exhausted` state that a human
 * sees and can renew.
 */
export const DEFAULT_MAXIMUM_INVOCATIONS: Readonly<Record<McpApprovalPolicy, number>> = Object.freeze({
  always_allow: 1000,
  allow_for_mission: 100,
  allow_once: 1,
  ask_every_time: 0,
  deny: 0,
});
