/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Deterministic IN-MEMORY cost receipt repository — clearly labeled: this is
 * NOT a database and NOT production persistence. No production receipt is
 * written anywhere by this milestone.
 *
 * Append-and-replace-through-validated-operations only: there is no delete
 * API, no arbitrary mutation API, and every read returns a deep-frozen clone,
 * so stored state can never be reached through a returned reference. A
 * finalized, disputed, or voided receipt stays inspectable forever.
 */

import {
  economicsError,
  economicsFail,
  economicsOk,
  type EconomicsResult,
} from './economics-errors';
import type {
  RelayCostCategory,
  RelayCostReceipt,
  RelayReceiptStatus,
} from './cost-receipt-types';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const frozenClone = <T>(value: T): T => deepFreeze(deepClone(value));

export class InMemoryCostReceiptRepository {
  private readonly receipts = new Map<string, RelayCostReceipt>();
  /** Guards against billing the same provider charge twice. */
  private readonly providerUsageRefs = new Map<string, string>();

  create(receipt: RelayCostReceipt): EconomicsResult<RelayCostReceipt> {
    if (this.receipts.has(receipt.receiptId)) {
      return economicsFail(
        economicsError(
          'DUPLICATE_RECEIPT_ID',
          `receipt ${receipt.receiptId} already exists — receipt ids are unique`,
          'inspect the existing receipt, or record under a fresh id',
          { receiptId: receipt.receiptId, missionId: receipt.missionId },
        ),
      );
    }
    if (receipt.providerUsageReferenceId) {
      const existing = this.providerUsageRefs.get(receipt.providerUsageReferenceId);
      // An adjustment legitimately references the same provider usage as the
      // charge it corrects; a second CHARGE for it would be double billing.
      if (existing && receipt.category !== 'adjustment') {
        return economicsFail(
          economicsError(
            'DUPLICATE_PROVIDER_USAGE_REFERENCE',
            `provider usage ${receipt.providerUsageReferenceId} is already billed by receipt ${existing}`,
            'inspect the existing receipt; record a correction as an adjustment instead',
            {
              receiptId: receipt.receiptId,
              missionId: receipt.missionId,
              expected: 'an unbilled provider usage reference',
              actual: receipt.providerUsageReferenceId,
            },
          ),
        );
      }
      if (!existing) this.providerUsageRefs.set(receipt.providerUsageReferenceId, receipt.receiptId);
    }
    this.receipts.set(receipt.receiptId, deepClone(receipt));
    return economicsOk(frozenClone(receipt));
  }

  get(receiptId: string): RelayCostReceipt | null {
    const stored = this.receipts.get(receiptId);
    return stored ? frozenClone(stored) : null;
  }

  /**
   * Replaces a receipt with the result of a validated lifecycle operation.
   * Identity and attribution are fixed — only lifecycle state may change.
   */
  replace(next: RelayCostReceipt): EconomicsResult<RelayCostReceipt> {
    const stored = this.receipts.get(next.receiptId);
    if (!stored) {
      return economicsFail(
        economicsError(
          'RECEIPT_NOT_FOUND',
          `receipt ${next.receiptId} does not exist`,
          'create the receipt before updating it',
          { receiptId: next.receiptId, missionId: next.missionId },
        ),
      );
    }
    const drift = attributionDrift(stored, next);
    if (drift) {
      return economicsFail(
        economicsError(
          'COST_ATTRIBUTION_INVALID',
          `${drift.field} is fixed when a receipt is created and cannot change (${drift.expected} → ${drift.actual})`,
          'record a new receipt instead of re-attributing an existing one',
          {
            receiptId: next.receiptId,
            missionId: stored.missionId,
            field: drift.field,
            expected: drift.expected,
            actual: drift.actual,
          },
        ),
      );
    }
    this.receipts.set(next.receiptId, deepClone(next));
    return economicsOk(frozenClone(next));
  }

  /* ------------------------------------------------------------ listing */

  private list(predicate: (receipt: RelayCostReceipt) => boolean): RelayCostReceipt[] {
    return [...this.receipts.values()].filter(predicate).map((r) => frozenClone(r));
  }

  listByProject(projectId: string): RelayCostReceipt[] {
    return this.list((r) => r.projectId === projectId);
  }
  listByMission(missionId: string): RelayCostReceipt[] {
    return this.list((r) => r.missionId === missionId);
  }
  listByTask(taskId: string): RelayCostReceipt[] {
    return this.list((r) => r.taskId === taskId);
  }
  listByRun(runId: string): RelayCostReceipt[] {
    return this.list((r) => r.runId === runId);
  }
  listByCapsule(capsuleId: string): RelayCostReceipt[] {
    return this.list((r) => r.capsuleId === capsuleId);
  }
  /** Costs the agent ACTUALLY incurred — never what was merely requested. */
  listByActualAgent(agentId: string): RelayCostReceipt[] {
    return this.list((r) => r.actualAgentId === agentId);
  }
  listByPspVersion(pspVersionId: string): RelayCostReceipt[] {
    return this.list((r) => r.pspVersionId === pspVersionId);
  }
  listByCategory(category: RelayCostCategory): RelayCostReceipt[] {
    return this.list((r) => r.category === category);
  }
  listByStatus(status: RelayReceiptStatus): RelayCostReceipt[] {
    return this.list((r) => r.status === status);
  }

  count(): number {
    return this.receipts.size;
  }
}

interface AttributionDrift {
  field: string;
  expected: string;
  actual: string;
}

/** Fields fixed at creation. A receipt never migrates to another mission,
    revision, run, or agent. */
export function attributionDrift(
  stored: RelayCostReceipt,
  next: RelayCostReceipt,
): AttributionDrift | null {
  const checks: Array<[string, unknown, unknown]> = [
    ['projectId', stored.projectId, next.projectId],
    ['missionId', stored.missionId, next.missionId],
    ['missionRevision', stored.missionRevision, next.missionRevision],
    ['taskId', stored.taskId, next.taskId],
    ['runId', stored.runId, next.runId],
    ['capsuleId', stored.capsuleId, next.capsuleId],
    ['actualAgentId', stored.actualAgentId, next.actualAgentId],
    ['requestedAgentId', stored.requestedAgentId, next.requestedAgentId],
    ['pspVersionId', stored.pspVersionId, next.pspVersionId],
    ['category', stored.category, next.category],
    ['costClass', stored.costClass, next.costClass],
    ['recordedAt', stored.recordedAt, next.recordedAt],
  ];
  for (const [field, expected, actual] of checks) {
    if (expected !== actual) {
      return { field, expected: String(expected), actual: String(actual) };
    }
  }
  return null;
}
