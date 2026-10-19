import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type { EventEnvelope, ReportEnvelope } from '../protocol/envelopes';
import type { ClaimId, EventId, IdFactory } from '../protocol/ids';
import type { VerificationRecord } from '../protocol/contracts';
import type { EventStorePort } from '../storage/interfaces';
import { appendEvent, listEvents } from './ledger';
import { projectLedger } from './projection';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';

/**
 * Claim promotion (PROTOCOL §3.1) — THE trust boundary. Every report ingest
 * records an unverified claim; ONLY these operations, driven by relay-core
 * decisions backed by Relay-produced verification, promote or reject it.
 * Schema-valid ≠ accepted; an agent report alone never changes canonical
 * state. Promotion advances the ledger version exactly once and is
 * idempotent per idempotencyKey.
 */

export interface RecordClaimInput {
  store: EventStorePort;
  ids: IdFactory;
  report: ReportEnvelope;
  at: string;
  correlationId?: string;
}

export function recordClaim(input: RecordClaimInput): RelayResult<{ claimId: ClaimId; event: EventEnvelope }> {
  const { store, ids, report, at, correlationId } = input;
  const claimId = ids.next('clm');
  const result = appendEvent(store, {
    eventId: ids.next('evt') as EventId,
    draft: {
      protocolVersion: report.protocolVersion,
      at,
      projectId: report.projectId,
      runId: report.runId,
      taskId: report.taskId,
      source: 'relay-core',
      kind: 'ledger.claim_recorded',
      provenance: report.provenance,
      classification: 'unverified-claim',
      safeSummary: `Recorded unverified ${report.reportType} claim from ${report.agentIdentity.displayName}.`,
      payload: { reportType: report.reportType, adapterId: report.agentIdentity.adapterId },
      correlationId,
      refs: { claimId, reportId: report.reportId },
    },
  });
  if (!result.ok) return result;
  return ok({ claimId, event: result.value });
}

function resolveClaim(store: EventStorePort, claimId: ClaimId) {
  const sourceEvent = store.findByClaimId(claimId);
  if (!sourceEvent) return null;
  const projection = projectLedger(listEvents(store, sourceEvent.projectId));
  const claim = projection.claims[claimId];
  return claim ? { projectId: sourceEvent.projectId, sourceEvent, claim } : null;
}

export interface PromoteClaimInput {
  store: EventStorePort;
  ids: IdFactory;
  claimId: ClaimId;
  at: string;
  /** Relay-produced verification supporting the promotion — never the
   * agent's own claimed results. */
  verification: VerificationRecord;
  provenance?: 'simulated' | 'live';
  idempotencyKey?: string;
  correlationId?: string;
}

export function promoteClaim(input: PromoteClaimInput): RelayResult<EventEnvelope> {
  const { store, ids, claimId, at, verification, idempotencyKey, correlationId } = input;
  const resolved = resolveClaim(store, claimId);
  if (!resolved) {
    return fail(relayError('claim-promotion', 'Claim not found — record it before promotion.', { entityIds: { claimId } }));
  }
  // Idempotent replay short-circuits BEFORE the already-resolved guard.
  if (idempotencyKey) {
    const existing = store.findByIdempotencyKey(resolved.projectId, idempotencyKey);
    if (existing && existing.kind === 'ledger.claim_promoted' && existing.refs?.claimId === claimId) {
      return ok(existing);
    }
  }
  if (resolved.claim.status !== 'recorded') {
    return fail(
      relayError('claim-promotion', `Claim is already ${resolved.claim.status} — promotion is exactly-once.`, {
        entityIds: { claimId },
      }),
    );
  }
  if (verification.outcome !== 'passed') {
    return fail(
      relayError('evidence-required', `Promotion requires passing verification; outcome was ${verification.outcome}.`, {
        entityIds: { claimId, verificationId: verification.verificationId },
      }),
    );
  }
  return appendEvent(store, {
    eventId: ids.next('evt') as EventId,
    idempotencyKey,
    draft: {
      protocolVersion: RELAY_PROTOCOL_VERSION,
      at,
      projectId: resolved.projectId,
      runId: verification.runId,
      taskId: verification.taskId,
      source: 'relay-core',
      kind: 'ledger.claim_promoted',
      provenance: input.provenance ?? 'simulated',
      classification: 'canonical',
      safeSummary: `Claim promoted to canonical: verification passed.`,
      payload: { verificationId: verification.verificationId, bundleId: verification.bundleId },
      correlationId,
      refs: { claimId, evidenceIds: [verification.bundleId] },
    },
  });
}

export interface RejectClaimInput {
  store: EventStorePort;
  ids: IdFactory;
  claimId: ClaimId;
  at: string;
  reason: string;
  correlationId?: string;
}

export function rejectClaim(input: RejectClaimInput): RelayResult<EventEnvelope> {
  const { store, ids, claimId, at, reason, correlationId } = input;
  const resolved = resolveClaim(store, claimId);
  if (!resolved) {
    return fail(relayError('claim-promotion', 'Claim not found.', { entityIds: { claimId } }));
  }
  if (resolved.claim.status !== 'recorded') {
    return fail(relayError('claim-promotion', `Claim is already ${resolved.claim.status}.`, { entityIds: { claimId } }));
  }
  return appendEvent(store, {
    eventId: ids.next('evt') as EventId,
    draft: {
      protocolVersion: RELAY_PROTOCOL_VERSION,
      at,
      projectId: resolved.projectId,
      source: 'relay-core',
      kind: 'ledger.claim_rejected',
      provenance: resolved.sourceEvent.provenance,
      classification: 'historical',
      safeSummary: `Claim rejected: ${reason}`,
      payload: { reason },
      correlationId,
      refs: { claimId },
    },
  });
}
