/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Evidence and cost-receipt REFERENCES (PURE).
 *
 * The capsule stores IDS, never evidence bodies: the canonical evidence store
 * (`EvidenceRecord`/`EvidenceBundle`, src/relay/protocol/contracts.ts) and the
 * future Cost Receipt ledger (Milestone 5 — Mission Economics) own the
 * records themselves. Two invariants matter here:
 *
 *   - evidence stays ATTRIBUTABLE to the run that produced it, and evidence
 *     from an unverified external launch can never be credited to the agent
 *     Relay merely REQUESTED;
 *   - missing cost data stays MISSING. A run with no receipt is `pending`,
 *     never $0 — this module performs no pricing lookup, no aggregation, and
 *     no estimation.
 */

import { capsuleError, capsuleFail, capsuleOk, type CapsuleResult } from './capsule-errors';

/** Append an id to a capsule-scoped list, rejecting duplicates. */
function appendUnique(
  existing: readonly string[],
  id: string,
  duplicate: () => CapsuleResult<readonly string[]>,
): CapsuleResult<readonly string[]> {
  if (existing.includes(id)) return duplicate();
  return capsuleOk(Object.freeze([...existing, id]));
}

export function appendEvidenceId(
  evidenceIds: readonly string[],
  evidenceId: string,
  capsuleId: string,
): CapsuleResult<readonly string[]> {
  return appendUnique(evidenceIds, evidenceId, () =>
    capsuleFail(
      capsuleError(
        'DUPLICATE_EVIDENCE_REFERENCE',
        `evidence ${evidenceId} is already attached to this capsule`,
        'attach a distinct evidence record, or inspect the existing reference',
        { capsuleId, field: 'evidenceIds', actual: evidenceId },
      ),
    ),
  );
}

export function appendCostReceiptId(
  costReceiptIds: readonly string[],
  costReceiptId: string,
  capsuleId: string,
): CapsuleResult<readonly string[]> {
  return appendUnique(costReceiptIds, costReceiptId, () =>
    capsuleFail(
      capsuleError(
        'DUPLICATE_COST_RECEIPT_REFERENCE',
        `cost receipt ${costReceiptId} is already attached to this capsule`,
        'attach a distinct receipt, or inspect the existing reference',
        { capsuleId, field: 'costReceiptIds', actual: costReceiptId },
      ),
    ),
  );
}

export type CapsuleCostState = 'pending' | 'receipts_attached';

/**
 * Cost is a PRESENCE fact in this milestone, never an amount: with no
 * receipts the state is `pending` — explicitly unknown, never zero. Totals
 * and pricing arrive with Mission Economics (Milestone 5).
 */
export function deriveCostState(costReceiptIds: readonly string[]): CapsuleCostState {
  return costReceiptIds.length === 0 ? 'pending' : 'receipts_attached';
}
