/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Economics re-export shim for the CLI.
 *
 * The CLI boundary test permits `'../mission'` (the barrel) but not a deep
 * `'../mission/economics'` path, so the shared economics core is surfaced
 * here. The modules themselves are byte-identical with the website copy.
 */
export {
  createCostReceipt, createAdjustment, markProvisional, finalizeReceipt,
  disputeReceipt, voidReceipt,
} from './economics/cost-receipt-service';
export { InMemoryCostReceiptRepository } from './economics/cost-receipt-repository';
export {
  createMissionBudget, createBudgetApproval, applyApprovedIncrease,
} from './economics/budget-types';
export { evaluateMissionBudget } from './economics/budget-evaluation';
export { aggregateMissionEconomics } from './economics/economics-aggregation';
export { projectMissionEconomics, amountLabel } from './economics/economics-projection';
export { formatMoney, money, moneyFromDecimalString } from './economics/money';
export type { RelayMoney } from './economics/money';
export type { RelayCostReceipt, RelayCostCategory } from './economics/cost-receipt-types';
export type { RelayMissionBudget } from './economics/budget-types';
export type { RelayBudgetEvaluation } from './economics/budget-evaluation';
export type { RelayMissionEconomics } from './economics/economics-aggregation';
export type { RelayMissionEconomicsProjection } from './economics/economics-projection';
