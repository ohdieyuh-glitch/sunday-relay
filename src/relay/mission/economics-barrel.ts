/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 5
 * Economics re-export shim for the CLI.
 *
 * There is ONE canonical Mission Economics implementation, in
 * `src/relay/mission/economics/`. This file is a THIN RE-EXPORT of it and
 * contains no logic of its own: the CLI boundary test permits `'../mission'`
 * (the barrel) but not a deep `'../mission/economics'` path, so the shared
 * core is surfaced here for the terminal surface to import.
 *
 * It is NOT a second copy. The earlier "byte-identical duplication" wording
 * described a transitional state, when the website and the CLI lived in two
 * repositories and the economics core was mirrored between them. Both
 * surfaces now import the same modules from the same tree, and there is
 * nothing to keep in sync.
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
export {
  projectMissionEconomics, amountLabel, boundedLabel,
  UNKNOWN_LABEL, NOT_AVAILABLE_LABEL, PENDING_LABEL, NOT_CONFIGURED_LABEL,
  AT_LEAST_PREFIX, AT_MOST_PREFIX,
  SIMULATED_DATA_LABEL, MIXED_DATA_LABEL, NO_DATA_LABEL,
} from './economics/economics-projection';
export { formatMoney, money, moneyFromDecimalString } from './economics/money';
export type { RelayMoney } from './economics/money';
export type { RelayCostReceipt, RelayCostCategory } from './economics/cost-receipt-types';
export type { RelayMissionBudget } from './economics/budget-types';
export type { RelayBudgetEvaluation } from './economics/budget-evaluation';
export type { RelayMissionEconomics, RelayEconomicsDataSource } from './economics/economics-aggregation';
export type { RelayMissionEconomicsProjection } from './economics/economics-projection';
