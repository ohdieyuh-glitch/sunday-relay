/**
 * ROLE SLOTS — permanent roles, swappable occupants.
 *
 * Pure domain: no Node, no network, no clock. The bridge is the only consumer
 * today; the browser and the CLI can read it unchanged when they need it, and
 * none of the three can widen it. (Stated as capability rather than fact —
 * this module is not re-exported from the mission barrel, so no UI or CLI
 * import is even possible through the sanctioned path yet.)
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
