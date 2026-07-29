/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Mission budget model (PURE types + construction).
 *
 * A budget is a promise Relay keeps BEFORE spending, not a number reported
 * afterwards. Two distinctions carry the whole design:
 *
 *   - a WARNING threshold is not a hard limit, and an APPROVAL threshold is
 *     neither. They are three separate decisions with three separate effects;
 *   - "no total limit configured" is `not_configured`, which is disclosed —
 *     it never silently means "unlimited".
 *
 * Thresholds are basis points (10,000 = 100%) computed with exact integer
 * maths, never floating-point percentages.
 */

import {
  economicsError,
  economicsFail,
  economicsOk,
  type EconomicsResult,
} from './economics-errors';
import { compareMoney, isNegative, type RelayMoney } from './money';
import type { RelayCostCategory } from './cost-receipt-types';

export const RELAY_BUDGET_STATUSES = [
  'not_configured',
  'under_budget',
  'warning',
  'approval_required',
  'hard_limit_reached',
  'exhausted',
  'suspended',
] as const;
export type RelayBudgetStatus = (typeof RELAY_BUDGET_STATUSES)[number];

export const BASIS_POINTS_SCALE = 10_000;

export interface RelayMissionBudget {
  readonly budgetId: string;

  readonly projectId: string;
  readonly missionId: string;
  readonly missionRevision: number;

  readonly currency: string;

  /** null = not configured. Disclosed as such, never treated as unlimited. */
  readonly totalLimit: RelayMoney | null;
  readonly hardLimitEnabled: boolean;

  readonly warningThresholdBasisPoints: number;
  readonly approvalThreshold: RelayMoney | null;

  readonly categoryLimits: Readonly<Partial<Record<RelayCostCategory, RelayMoney>>>;

  readonly repairCycleLimit?: number;
  readonly retryLimit?: number;
  readonly runtimeLimitMs?: number;

  readonly status: RelayBudgetStatus;

  readonly createdAt: string;
  readonly updatedAt: string;

  readonly policyVersion: string;

  /** Approved increases, in order. History is never rewritten. */
  readonly approvedIncreaseIds: readonly string[];
}

export interface CreateMissionBudgetInput {
  budgetId: string;
  projectId: string;
  missionId: string;
  missionRevision: number;
  currency: string;
  totalLimit?: RelayMoney | null;
  hardLimitEnabled?: boolean;
  warningThresholdBasisPoints?: number;
  approvalThreshold?: RelayMoney | null;
  categoryLimits?: Partial<Record<RelayCostCategory, RelayMoney>>;
  repairCycleLimit?: number;
  retryLimit?: number;
  runtimeLimitMs?: number;
  createdAt: string;
  policyVersion: string;
  approvedIncreaseIds?: readonly string[];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

export function createMissionBudget(
  input: CreateMissionBudgetInput,
): EconomicsResult<RelayMissionBudget> {
  const fail = (
    code: Parameters<typeof economicsError>[0],
    reason: string,
    action: string,
    extra: Record<string, unknown> = {},
  ) =>
    economicsFail<RelayMissionBudget>(
      economicsError(code, reason, action, {
        budgetId: input.budgetId,
        missionId: input.missionId,
        missionRevision: input.missionRevision,
        ...extra,
      }),
    );

  if (!input.budgetId?.trim() || !input.projectId?.trim() || !input.missionId?.trim()) {
    return fail(
      'MISSION_BUDGET_NOT_FOUND',
      'a budget requires budget, project, and mission identity',
      'supply every identity field',
      { field: 'identity' },
    );
  }
  if (!Number.isInteger(input.missionRevision) || input.missionRevision <= 0) {
    return fail(
      'STALE_MISSION_BUDGET_REVISION',
      'mission revision must be a positive integer',
      'supply the mission revision this budget governs',
      { field: 'missionRevision', actual: String(input.missionRevision) },
    );
  }

  const currency = input.currency?.trim().toUpperCase() ?? '';
  if (!/^[A-Z]{3}$/u.test(currency)) {
    return fail(
      'MONEY_INVALID_CURRENCY',
      `"${input.currency}" is not an ISO-style currency code`,
      'supply a three-letter currency code',
      { field: 'currency', actual: String(input.currency) },
    );
  }

  const warningThresholdBasisPoints = input.warningThresholdBasisPoints ?? 8_000;
  if (
    !Number.isInteger(warningThresholdBasisPoints) ||
    warningThresholdBasisPoints < 0 ||
    warningThresholdBasisPoints > BASIS_POINTS_SCALE
  ) {
    return fail(
      'INVALID_WARNING_THRESHOLD',
      `${warningThresholdBasisPoints} is not a valid warning threshold (0–10000 basis points)`,
      'express the threshold in basis points, where 10000 is 100%',
      {
        field: 'warningThresholdBasisPoints',
        expected: '0..10000',
        actual: String(warningThresholdBasisPoints),
      },
    );
  }

  const totalLimit = input.totalLimit ?? null;
  if (totalLimit) {
    if (totalLimit.currency !== currency) {
      return fail(
        'MONEY_CURRENCY_MISMATCH',
        `the total limit is in ${totalLimit.currency} but the budget currency is ${currency}`,
        'record the limit in the budget currency',
        { field: 'totalLimit' },
      );
    }
    if (isNegative(totalLimit)) {
      return fail('INVALID_CATEGORY_LIMIT', 'a total limit cannot be negative', 'supply a non-negative limit', {
        field: 'totalLimit',
      });
    }
  }

  const approvalThreshold = input.approvalThreshold ?? null;
  if (approvalThreshold) {
    if (approvalThreshold.currency !== currency) {
      return fail(
        'MONEY_CURRENCY_MISMATCH',
        `the approval threshold is in ${approvalThreshold.currency} but the budget currency is ${currency}`,
        'record the threshold in the budget currency',
        { field: 'approvalThreshold' },
      );
    }
    if (isNegative(approvalThreshold)) {
      return fail(
        'INVALID_APPROVAL_THRESHOLD',
        'an approval threshold cannot be negative',
        'supply a non-negative threshold',
        { field: 'approvalThreshold' },
      );
    }
    if (totalLimit) {
      const comparison = compareMoney(approvalThreshold, totalLimit);
      if (comparison.ok && comparison.value > 0) {
        return fail(
          'INVALID_APPROVAL_THRESHOLD',
          'an approval threshold above the total limit could never be reached before the limit itself',
          'set the approval threshold at or below the total limit',
          { field: 'approvalThreshold' },
        );
      }
    }
  }

  const categoryLimits: Partial<Record<RelayCostCategory, RelayMoney>> = {};
  for (const [category, limit] of Object.entries(input.categoryLimits ?? {})) {
    if (!limit) continue;
    if (limit.currency !== currency) {
      return fail(
        'MONEY_CURRENCY_MISMATCH',
        `the ${category} limit is in ${limit.currency} but the budget currency is ${currency}`,
        'record every category limit in the budget currency',
        { field: `categoryLimits.${category}`, category },
      );
    }
    if (isNegative(limit)) {
      return fail(
        'INVALID_CATEGORY_LIMIT',
        `the ${category} limit cannot be negative`,
        'supply a non-negative category limit',
        { field: `categoryLimits.${category}`, category },
      );
    }
    if (totalLimit) {
      const comparison = compareMoney(limit, totalLimit);
      if (comparison.ok && comparison.value > 0) {
        return fail(
          'INVALID_CATEGORY_LIMIT',
          `the ${category} limit exceeds the mission total limit`,
          'keep every category limit at or below the total limit',
          { field: `categoryLimits.${category}`, category },
        );
      }
    }
    categoryLimits[category as RelayCostCategory] = limit;
  }

  for (const [field, value] of [
    ['repairCycleLimit', input.repairCycleLimit],
    ['retryLimit', input.retryLimit],
    ['runtimeLimitMs', input.runtimeLimitMs],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      return fail(
        'INVALID_CATEGORY_LIMIT',
        `${field} must be a non-negative integer`,
        `supply a valid ${field}`,
        { field, actual: String(value) },
      );
    }
  }

  return economicsOk(
    deepFreeze({
      budgetId: input.budgetId,
      projectId: input.projectId,
      missionId: input.missionId,
      missionRevision: input.missionRevision,
      currency,
      totalLimit,
      hardLimitEnabled: input.hardLimitEnabled ?? true,
      warningThresholdBasisPoints,
      approvalThreshold,
      categoryLimits,
      ...(input.repairCycleLimit !== undefined ? { repairCycleLimit: input.repairCycleLimit } : {}),
      ...(input.retryLimit !== undefined ? { retryLimit: input.retryLimit } : {}),
      ...(input.runtimeLimitMs !== undefined ? { runtimeLimitMs: input.runtimeLimitMs } : {}),
      status: totalLimit === null ? 'not_configured' : 'under_budget',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      policyVersion: input.policyVersion,
      approvedIncreaseIds: [...(input.approvedIncreaseIds ?? [])],
    }),
  );
}

/* ------------------------------------------------------ budget approval */

export interface RelayBudgetApproval {
  readonly approvalId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly missionRevision: number;
  readonly budgetId: string;
  readonly previousLimit: RelayMoney | null;
  readonly approvedLimit: RelayMoney;
  readonly reason: string;
  readonly requestedByActorId: string;
  readonly approvedByActorId: string;
  readonly requestedAt: string;
  readonly approvedAt: string;
  readonly commandId: string;
  readonly policyVersion: string;
}

/** Actor ids an agent uses. An agent may never approve its own budget. */
const AGENT_ACTOR_PREFIXES = ['agent-', 'adapter-'];

export function createBudgetApproval(
  input: Omit<RelayBudgetApproval, 'previousLimit'> & { previousLimit?: RelayMoney | null },
): EconomicsResult<RelayBudgetApproval> {
  if (AGENT_ACTOR_PREFIXES.some((prefix) => input.approvedByActorId.startsWith(prefix))) {
    return economicsFail(
      economicsError(
        'BUDGET_APPROVAL_REQUIRED',
        `${input.approvedByActorId} is an agent and cannot approve a budget increase`,
        'route the approval to an authorized human approver',
        {
          budgetId: input.budgetId,
          missionId: input.missionId,
          missionRevision: input.missionRevision,
          field: 'approvedByActorId',
          actual: input.approvedByActorId,
          humanApprovalRequired: true,
        },
      ),
    );
  }
  if (!input.reason?.trim()) {
    return economicsFail(
      economicsError(
        'BUDGET_APPROVAL_REQUIRED',
        'a budget approval must record why the increase was granted',
        'supply an approval reason',
        { budgetId: input.budgetId, missionId: input.missionId, field: 'reason' },
      ),
    );
  }
  return economicsOk(deepFreeze({ ...input, previousLimit: input.previousLimit ?? null }));
}

/**
 * Applies an approved increase, producing a NEW budget record. The prior
 * limit stays visible through the approval history — a limit is never
 * rewritten invisibly.
 */
export function applyApprovedIncrease(
  budget: RelayMissionBudget,
  approval: RelayBudgetApproval,
  at: string,
): EconomicsResult<RelayMissionBudget> {
  if (approval.budgetId !== budget.budgetId) {
    return economicsFail(
      economicsError(
        'STALE_MISSION_BUDGET_REVISION',
        'the approval belongs to a different budget',
        'obtain an approval for the current budget',
        { budgetId: budget.budgetId, missionId: budget.missionId, expected: budget.budgetId, actual: approval.budgetId },
      ),
    );
  }
  if (approval.missionRevision !== budget.missionRevision) {
    return economicsFail(
      economicsError(
        'STALE_MISSION_BUDGET_REVISION',
        `the approval was granted for mission revision ${approval.missionRevision}, but the budget governs ${budget.missionRevision}`,
        're-request approval against the current mission revision',
        {
          budgetId: budget.budgetId,
          missionId: budget.missionId,
          expected: String(budget.missionRevision),
          actual: String(approval.missionRevision),
          humanApprovalRequired: true,
        },
      ),
    );
  }
  if (approval.policyVersion !== budget.policyVersion) {
    return economicsFail(
      economicsError(
        'STALE_MISSION_BUDGET_REVISION',
        'the approval references a different budget policy version',
        're-request approval against the current policy version',
        {
          budgetId: budget.budgetId,
          missionId: budget.missionId,
          expected: budget.policyVersion,
          actual: approval.policyVersion,
        },
      ),
    );
  }
  if (budget.approvedIncreaseIds.includes(approval.approvalId)) {
    return economicsFail(
      economicsError(
        'BUDGET_APPROVAL_REQUIRED',
        `approval ${approval.approvalId} has already been applied`,
        'obtain a fresh approval for any further increase',
        { budgetId: budget.budgetId, missionId: budget.missionId, actual: approval.approvalId },
      ),
    );
  }
  if (approval.approvedLimit.currency !== budget.currency) {
    return economicsFail(
      economicsError(
        'MONEY_CURRENCY_MISMATCH',
        'the approved limit is in a different currency from the budget',
        'approve a limit in the budget currency',
        { budgetId: budget.budgetId, missionId: budget.missionId },
      ),
    );
  }

  return economicsOk(
    deepFreeze({
      ...budget,
      totalLimit: approval.approvedLimit,
      status: 'under_budget' as RelayBudgetStatus,
      updatedAt: at,
      approvedIncreaseIds: [...budget.approvedIncreaseIds, approval.approvalId],
    }),
  );
}
