import { createUncomposedJuliusDispatch } from './julius-dispatch';
import { J1_PINNED_CHECKER_FILE_SHA256, J1_PINNED_CHECKER_SHA256, J1_PINNED_CONTRACT_SHA256, J1_PINNED_ORACLE_SHA256 } from './julius-inworld-checker';
import { createJ1LiveDispatchWithPins, type J1Env, type J1WiringDeps, type J1WiringResult } from './julius-dispatch-wiring-core';

export type { J1Env, J1WiringDeps, J1WiringResult } from './julius-dispatch-wiring-core';
export { J1_PINNED_CHECKER_FILE_SHA256, J1_PINNED_CHECKER_SHA256, J1_PINNED_CONTRACT_SHA256, J1_PINNED_ORACLE_SHA256 };

/**
 * THE PRODUCTION FACTORY. It takes NO pin override: the pins are the in-world constants, there is no parameter,
 * environment variable or NODE_ENV switch that changes them. A pin change is a code edit, which is reviewed.
 * DEFAULT OFF and FAIL-CLOSED. A live controller exists only when the caller is the gated paid workflow.
 * Test doubles live in `julius-dispatch-wiring-testkit.ts`, which nothing here imports.
 */
export const J1_PAID_WORKFLOW_FILE = 'julius-first-live-mission.yml';
export const J1_PAID_SLOT_SCRIPT = 'scripts/julius-paid-slot.mjs';

export function createJ1LiveDispatchFromEnv(env: J1Env | (() => J1Env), deps: J1WiringDeps): J1WiringResult {
  const snapshot = typeof env === 'function' ? env() : env;
  const workflow = snapshot.JULIUS_PAID_WORKFLOW === J1_PAID_WORKFLOW_FILE && snapshot.JULIUS_PAID_SLOT === J1_PAID_SLOT_SCRIPT;
  if (!workflow) {
    return {
      live: false,
      controller: createUncomposedJuliusDispatch(() => ({ ...snapshot }), deps.now),
      reason: 'julius_dispatch_paid_path_is_workflow',
    };
  }
  return createJ1LiveDispatchWithPins(env, deps, {
    contractSha256: J1_PINNED_CONTRACT_SHA256,
    checkerSha256: J1_PINNED_CHECKER_SHA256,
    checkerFileSha256: J1_PINNED_CHECKER_FILE_SHA256,
    oracleSha256: J1_PINNED_ORACLE_SHA256,
  });
}
