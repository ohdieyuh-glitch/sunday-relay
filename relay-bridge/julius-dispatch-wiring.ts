import { createJ1LiveDispatchWithPins, type J1Env, type J1WiringDeps, type J1WiringResult } from './julius-dispatch-wiring-core';

export type { J1Env, J1WiringDeps, J1WiringResult } from './julius-dispatch-wiring-core';

/**
 * THE PRODUCTION FACTORY. It takes NO pin override: the contract and checker pins are the constants below, there is no parameter,
 * environment variable or NODE_ENV switch that changes them. A pin change is a code edit, which is reviewed. DEFAULT OFF and FAIL-CLOSED
 * (see the core for the reason codes). Test doubles live in `julius-dispatch-wiring-testkit.ts`, which nothing here imports.
 */

/** The reviewer-frozen pins. The environment must EQUAL these. */
export const J1_PINNED_CONTRACT_SHA256 = 'bfa90f50f70916ff52180a94537f243300da8dcc51ee06d3952b0f18876226aa';
export const J1_PINNED_CHECKER_SHA256 = '1d1dc64ff9cf8f1f4133bbe22a65c483a9ad343a3ef4c2ee898709549b46f5dd';

export function createJ1LiveDispatchFromEnv(env: J1Env | (() => J1Env), deps: J1WiringDeps): J1WiringResult {
  return createJ1LiveDispatchWithPins(env, deps, { contractSha256: J1_PINNED_CONTRACT_SHA256, checkerSha256: J1_PINNED_CHECKER_SHA256 });
}
