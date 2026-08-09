/**
 * ROLE SLOTS — permanent roles, swappable occupants.
 *
 * Pure domain. The browser, the CLI and the bridge read the same registry and
 * reach the same conclusions, and none of them can widen it.
 */

export {
  BILLING_PATHS, EXECUTION_ENVIRONMENTS, OCCUPANT_KINDS, ROLE_BINDING_REFUSALS, ROLE_SLOTS,
} from './role-slot-contracts';
export type {
  BillingPath, ExecutionEnvironment, OccupantKind, RoleBinding, RoleBindingProblem,
  RoleBindingRefusal, RoleOccupant, RoleSlot, RoleSlotBindingResult,
} from './role-slot-contracts';

export {
  DEVELOPMENT_DEFAULT_OCCUPANTS, ROLE_OCCUPANTS, findOccupant, occupantsForRole,
  registryIsComplete,
} from './role-slot-registry';

export {
  bindRoleSlots, occupantsAreIndependent, renderBindingLine, requestedOccupantId,
} from './role-slot-binding';
export type { ConfiguredNames, RoleSlotRequest } from './role-slot-binding';
