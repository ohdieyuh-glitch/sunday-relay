import type { EventEnvelope } from '../protocol/envelopes';
import type { LedgerVersion } from '../protocol/ids';

/**
 * Current-state projection (PROTOCOL §2.2): a pure, deterministic reduction
 * over the event sequence. Canonical sections move ONLY on canonical /
 * verified-evidence events emitted by relay-core decisions — recording an
 * unverified claim never touches them. Replay(events) always reproduces the
 * same projection.
 */

export interface ClaimProjection {
  claimId: string;
  reportId?: string;
  status: 'recorded' | 'promoted' | 'rejected';
  recordedAtSequence: number;
  resolvedAtSequence?: number;
}

export interface LedgerProjection {
  ledgerVersion: LedgerVersion;
  /** Canonical section — only canonical/verified-evidence events move it. */
  canonical: {
    objective?: string;
    acceptedBlueprintId?: string;
    decisions: string[];
    promotedClaimIds: string[];
    verifiedEvidenceRefs: string[];
    completedRunIds: string[];
  };
  /** Historical/derived sections. */
  claims: Record<string, ClaimProjection>;
  taskStatuses: Record<string, string>;
  runStatuses: Record<string, string>;
  openQuestionIds: string[];
  failureIds: string[];
}

const emptyProjection = (): LedgerProjection => ({
  ledgerVersion: 0 as LedgerVersion,
  canonical: {
    decisions: [],
    promotedClaimIds: [],
    verifiedEvidenceRefs: [],
    completedRunIds: [],
  },
  claims: {},
  taskStatuses: {},
  runStatuses: {},
  openQuestionIds: [],
  failureIds: [],
});

export function projectLedger(events: readonly EventEnvelope[]): LedgerProjection {
  const p = emptyProjection();
  for (const event of events) {
    p.ledgerVersion = event.sequence as LedgerVersion;
    const payload = event.payload as Record<string, unknown>;
    switch (event.kind) {
      case 'run.created':
        if (event.runId) p.runStatuses[event.runId] = 'created';
        if (typeof payload.objective === 'string' && event.classification === 'canonical') {
          p.canonical.objective = payload.objective;
        }
        break;
      case 'run.started':
      case 'run.resumed':
        if (event.runId) p.runStatuses[event.runId] = 'active';
        break;
      case 'run.paused':
        if (event.runId) p.runStatuses[event.runId] = 'paused';
        break;
      case 'run.checkpoint_required':
        if (event.runId) p.runStatuses[event.runId] = 'checkpoint_required';
        break;
      case 'run.cancelled':
        if (event.runId) p.runStatuses[event.runId] = 'cancelled';
        break;
      case 'run.failed':
        if (event.runId) p.runStatuses[event.runId] = 'failed';
        break;
      case 'run.completed':
        if (event.runId) {
          p.runStatuses[event.runId] = 'completed';
          if (event.classification === 'canonical') p.canonical.completedRunIds.push(event.runId);
        }
        break;
      case 'architect.blueprint_accepted':
        if (event.classification === 'canonical' && event.refs?.blueprintId) {
          p.canonical.acceptedBlueprintId = event.refs.blueprintId;
        }
        break;
      case 'ledger.claim_recorded': {
        const claimId = event.refs?.claimId;
        if (claimId) {
          p.claims[claimId] = {
            claimId,
            reportId: event.refs?.reportId,
            status: 'recorded',
            recordedAtSequence: event.sequence,
          };
        }
        break;
      }
      case 'ledger.claim_promoted': {
        const claimId = event.refs?.claimId;
        if (claimId && p.claims[claimId]) {
          p.claims[claimId] = { ...p.claims[claimId], status: 'promoted', resolvedAtSequence: event.sequence };
          p.canonical.promotedClaimIds.push(claimId);
          for (const evd of event.refs?.evidenceIds ?? []) p.canonical.verifiedEvidenceRefs.push(evd);
        }
        break;
      }
      case 'ledger.claim_rejected': {
        const claimId = event.refs?.claimId;
        if (claimId && p.claims[claimId]) {
          p.claims[claimId] = { ...p.claims[claimId], status: 'rejected', resolvedAtSequence: event.sequence };
        }
        break;
      }
      case 'task.created':
      case 'task.state_changed':
        if (event.taskId && typeof payload.status === 'string') p.taskStatuses[event.taskId] = payload.status;
        break;
      default:
        break; // historical/derived kinds carry no projection updates yet
    }
  }
  return p;
}
