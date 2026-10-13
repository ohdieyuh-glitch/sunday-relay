/**
 * Type declarations for the approval-gate registration (V6 G-1). Authored as plain `.mjs` because the contract
 * checker runs with `node` and no build step; the checker and its test import the SAME module.
 */

/** The approval gate each mission namespace is registered for. Empty: no mission is registered. */
export declare const MISSION_APPROVAL_GATES: Readonly<Record<string, readonly unknown[]>>;

/** Problems with a contract's `approvalGates` clause against its namespace's registration; [] when they match. */
export declare function approvalGateProblems(
  namespace: string | null,
  clause: unknown,
  grants?: Readonly<Record<string, readonly unknown[]>>,
): string[];
