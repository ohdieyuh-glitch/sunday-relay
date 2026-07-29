/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * Stored trace event → Milestone 3 `TraceReference` (PURE).
 *
 * This is the join Milestone 3 was built to wait for. Its capsule-side
 * factory deliberately refuses to mint `verified` references, because when it
 * was written nothing hash-chained anything. Now something does — but the
 * upgrade is still EARNED, not assumed:
 *
 *   - an event that merely exists in the ledger maps to `trusted_source`;
 *   - `verified` requires the WHOLE chain to have been verified, up to and
 *     including that event's sequence;
 *   - an agent-authored claim stays `unverified` no matter how good the chain
 *     is — a perfect hash over a self-report is still a self-report.
 *
 * Milestone 3 is not modified: this adapter constructs the reference shape
 * directly from a chain-verified event, and the capsule module keeps its
 * conservative behaviour for references it mints itself.
 */

import type {
  TraceReference,
  TraceReferenceIntegrity,
  TraceReferenceSource,
} from '../execution-capsules/capsule-trace-reference';
import type { AqualaTraceIntegrityReport } from './trace-integrity';
import type { AqualaTraceEvent, AqualaTraceSourceTrust } from './trace-types';

/** Trace source-trust → the capsule reference `source` vocabulary. */
function mapSource(event: AqualaTraceEvent): TraceReferenceSource {
  if (event.actorType === 'agent' || event.actorType === 'reviewer' || event.sourceTrust === 'claim') {
    return 'agent_report';
  }
  if (event.actorType === 'adapter') return 'adapter';
  switch (event.eventFamily) {
    case 'workspace':
    case 'file':
      return 'workspace_monitor';
    case 'permission':
      return 'permission_service';
    case 'review':
    case 'finding':
      return 'review_service';
    case 'approval':
      return 'approval_service';
    case 'economics':
      return 'cost_service';
    default:
      return 'relay_supervisor';
  }
}

export interface TraceReferenceAdapterOptions {
  /** The integrity report the caller obtained for this trace, if any. */
  integrity?: AqualaTraceIntegrityReport;
  /** Optional explicit reference id; defaults to the event id. */
  referenceId?: string;
}

/**
 * Converts a STORED event into a capsule `TraceReference`. Integrity is
 * derived, never supplied.
 */
export function traceEventToReference(
  event: AqualaTraceEvent,
  options: TraceReferenceAdapterOptions = {},
): TraceReference {
  const source = mapSource(event);
  const integrity = deriveReferenceIntegrity(event, source, options.integrity);

  return Object.freeze({
    referenceId: options.referenceId ?? event.eventId,
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    actorId: event.actorId,
    source,
    integrity,
    metadata: Object.freeze({
      traceId: event.traceId,
      sequence: event.sequence,
      sourceTrust: event.sourceTrust,
      eventHash: event.eventHash,
    }),
  });
}

/**
 * `unverified` for agent claims, `verified` only when a full-chain
 * verification covered this event's sequence, `trusted_source` otherwise.
 */
export function deriveReferenceIntegrity(
  event: AqualaTraceEvent,
  source: TraceReferenceSource,
  integrityReport?: AqualaTraceIntegrityReport,
): TraceReferenceIntegrity {
  if (source === 'agent_report' || event.sourceTrust === 'claim') return 'unverified';

  const chainVerified =
    integrityReport?.valid === true &&
    integrityReport.traceId === event.traceId &&
    integrityReport.verifiedThroughSequence >= event.sequence;

  return chainVerified ? 'verified' : 'trusted_source';
}

/** The capsule-facing integrity status for a whole trace. */
export function traceIntegrityToCapsuleStatus(
  report: AqualaTraceIntegrityReport | undefined,
): 'not_evaluated' | 'pending' | 'verified' | 'failed' {
  if (!report) return 'not_evaluated';
  return report.valid ? 'verified' : 'failed';
}

/** Convenience: the trust level an event carries, for callers that only need
    to distinguish claims from supervisory observations. */
export function eventIsSelfReport(event: AqualaTraceEvent): boolean {
  const trust: AqualaTraceSourceTrust = event.sourceTrust;
  return trust === 'claim';
}
