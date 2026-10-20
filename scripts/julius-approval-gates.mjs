/**
 * V6 G-1: APPROVAL GATES ARE REGISTERED HERE, PER MISSION, OR A CONTRACT MAY NOT DECLARE ONE.
 *
 * A Mission Contract may carry an `approvalGates` clause (`relay-bridge/julius/mission-contract.ts`): the
 * dispatches its C.A.R.D. holds for a person. The live entrypoint seals whatever clause a contract carries, which
 * proves the clause is WELL FORMED. It cannot prove the clause is the one this mission was REVIEWED with: a
 * contract could otherwise pick its own gate, or quietly drop one, by editing its own file. So the gate is
 * pre-registered here, against the mission's own accounting namespace, beside the spend ceilings and the
 * research grants of `julius-live-contract-check.mjs`, and the clause must EQUAL the registration:
 *
 *   - a clause with no registration is refused (a contract cannot grant itself a gate);
 *   - a registration whose contract lacks the clause is refused (a registered gate cannot be dropped);
 *   - a clause that differs from its registration in anything (id, roles, task types, reason, count) is refused.
 *
 * THE TABLE IS EMPTY. No mission has been registered for an approval gate. Registering one is a deliberate,
 * reviewed edit that names the mission and its exact gate; `scripts/julius-approval-gate-grant.test.ts` holds a
 * tripwire on the list of names.
 *
 * Pure: no filesystem, no process, no network. `julius-live-contract-check.mjs` and the test import the SAME
 * function, so the rule the checker applies and the rule the test pins cannot be computed two ways.
 */

export const MISSION_APPROVAL_GATES = Object.freeze({});

/** JSON with every object's keys sorted: the comparison does not depend on how a contract orders its keys. */
const stable = (value) => (value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`);

/**
 * Problems with a contract's `approvalGates` clause against the registration for its namespace; [] when it
 * matches (or when neither exists). `clause` is the contract's raw value, `undefined` when it has none.
 */
export function approvalGateProblems(namespace, clause, grants = MISSION_APPROVAL_GATES) {
  const grant = typeof namespace === 'string' && Object.hasOwn(grants, namespace) ? grants[namespace] : undefined;
  if (clause === undefined && grant === undefined) return [];
  if (grant === undefined) {
    return [`approvalGates is declared but no approval gate is registered for ${namespace ?? 'a mission with no declared namespace'}; a contract cannot grant itself a gate it was not registered for`];
  }
  if (clause === undefined) {
    return [`the registered approval gate for ${namespace} is missing from the contract; a registered gate cannot be dropped by leaving the clause out`];
  }
  if (stable(clause) !== stable(grant)) {
    return [`approvalGates does not equal the gate registered for ${namespace}; the clause must be exactly the reviewed registration`];
  }
  return [];
}
