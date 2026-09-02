/**
 * THE ONE PLACE JULIUS STATES WHAT IT ASKS THE EXECUTOR FOR.
 *
 * The executor owns every ceiling. Its request validator
 * (`src/relay/workspace/julius-tools/executor-operation-request.ts`) refuses a
 * `createSandbox` whose `limits.outputBytes` exceeds `MAX_SANDBOX_OUTPUT_BYTES`,
 * a figure DERIVED from what the 4 MiB response envelope can carry: two
 * streams, each crossing the wire JSON-escaped and base64-encoded, under a
 * load-bearing margin. Julius may ask for that ceiling or for less. It may
 * never ask for more, and the validator is not consulted about intent.
 *
 * WHY THIS FILE EXISTS — dry run 33625851653 (2026-09-02). The live composition
 * asked for 262,144 bytes of output, a number chosen by hand in #209 without
 * reading the ceiling #208 had derived the same day (257,377 at the current
 * constants). The real executor refused the very first `createSandbox`, before
 * a sandbox, a receipt or a diff existed. The provider-free preflight carried
 * the same literal on purpose, so it failed exactly as the paid mission would
 * have — after that mission had already paid an architect and a coding agent.
 *
 * So there is no number here to drift. `outputBytes` IS the executor's ceiling,
 * imported from the module the validator itself reads, and both the live
 * composition (`./executor-effects.ts`) and the preflight
 * (`scripts/julius-live-preflight.ts`) import THESE objects rather than keeping
 * copies: parity is identity, not a test that two copies still agree.
 *
 * Deliberately pure — constants and types only — so the preflight can import it
 * without dragging a provider connector into a script whose whole point is that
 * it contacts no provider. Frozen, so no caller can drift them at runtime.
 */

import type { JuliusSandboxLimits, JuliusSandboxPolicy } from '../../src/relay/mission/julius';
import { MAX_SANDBOX_OUTPUT_BYTES } from '../../src/relay/workspace/julius-tools/executor-operation-request';
import { BETA_WORKSPACE_BYTES } from '../../src/relay/workspace/julius-tools/workspace-provisioning';

/** What every live Julius sandbox is created with. `outputBytes` is the executor's own ceiling, never a copy of it. */
export const EXECUTOR_SANDBOX_LIMITS: JuliusSandboxLimits = Object.freeze<JuliusSandboxLimits>({
  cpuCount: 1, memoryBytes: 1_073_741_824, pids: 256, openFiles: 1_024,
  workspaceBytes: BETA_WORKSPACE_BYTES, outputBytes: MAX_SANDBOX_OUTPUT_BYTES,
  wallClockMs: 300_000, concurrentProcesses: 32,
});

/** The sandbox policy every live tool effect runs under. Network stays DENY: no worker reaches a provider through a tool. */
export const EXECUTOR_SANDBOX_POLICY: JuliusSandboxPolicy = Object.freeze<JuliusSandboxPolicy>({
  readWorkspace: true, mutateWorkspace: true, executeProcess: true,
  network: 'DENY', allowedTools: ['shell.bash'],
});
