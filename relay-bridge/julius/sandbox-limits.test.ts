import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXECUTOR_SANDBOX_LIMITS, EXECUTOR_SANDBOX_POLICY } from './sandbox-limits';
import {
  MAX_EXECUTOR_RESPONSE_BYTES,
  MAX_SANDBOX_OUTPUT_BYTES,
  parseExecutorOperationRequest,
} from '../../src/relay/workspace/julius-tools/executor-operation-request';
import { BETA_WORKSPACE_BYTES } from '../../src/relay/workspace/julius-tools/workspace-provisioning';

/**
 * REGRESSION — GitHub Actions run 33625851653, 2026-09-02, the first free dry
 * run of the first-live workflow. The real executor refused the very first
 * `createSandbox` with `executor_operation_invalid:limits.outputBytes`: the
 * live composition asked for 262,144 bytes and the executor's derived ceiling
 * was 257,377. Nothing offline had ever fed the live limits through the real
 * validator; two hand-kept copies agreed with each other and with nothing else.
 *
 * These cases make that drift impossible rather than unlikely: the live limits
 * are run through the executor's own validator, `outputBytes` is proven to be
 * the ceiling rather than a number near it, and the files that could hold a
 * second number are read and refused if they do.
 */

const TENANT = 'tenant';

/** A create request shaped exactly as the preflight and the live port shape it. */
const identity = {
  sandboxId: 'preflight:1756813306000:1', invocationId: 'preflight:1756813306000:1', tenantId: TENANT,
  projectId: 'prj-julius-first-live', runId: 'run:julius-live-preflight', taskId: 'task:julius-live-preflight',
  leaseGeneration: 1, policyRevision: 'card:julius-live:1',
  createdAt: '2026-09-02T11:41:46.000Z', expiresAt: '2026-09-02T11:51:46.000Z',
};

const create = (limits: unknown): { limits: unknown; policy: unknown } => parseExecutorOperationRequest(
  'create',
  { identity, policy: EXECUTOR_SANDBOX_POLICY, limits },
  { tenantId: TENANT },
) as { limits: unknown; policy: unknown };

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');

describe('dry run 33625851653 — the live sandbox output limit and the executor ceiling', () => {
  it('never asks the executor for more output than its ceiling', () => {
    expect(EXECUTOR_SANDBOX_LIMITS.outputBytes).toBeGreaterThan(0);
    expect(EXECUTOR_SANDBOX_LIMITS.outputBytes, 'the executor refuses anything above MAX_SANDBOX_OUTPUT_BYTES')
      .toBeLessThanOrEqual(MAX_SANDBOX_OUTPUT_BYTES);
  });

  it('the exact live limits and policy pass the executor create validator, field for field', () => {
    // This is the call the dry run died on, made offline with the real validator.
    const parsed = create(EXECUTOR_SANDBOX_LIMITS);
    expect(parsed.limits).toEqual(EXECUTOR_SANDBOX_LIMITS);
    expect(parsed.policy).toEqual(EXECUTOR_SANDBOX_POLICY);
  });

  it('the ceiling itself is accepted, and one byte more is refused as limits.outputBytes', () => {
    expect(() => create({ ...EXECUTOR_SANDBOX_LIMITS, outputBytes: MAX_SANDBOX_OUTPUT_BYTES })).not.toThrow();
    expect(() => create({ ...EXECUTOR_SANDBOX_LIMITS, outputBytes: MAX_SANDBOX_OUTPUT_BYTES + 1 }))
      .toThrow(/^executor_operation_invalid:limits\.outputBytes$/u);
  });

  it('the ceiling is derived from the response envelope with its margin intact, not asserted', () => {
    // Raising the envelope to let a stale request pass would be the wrong repair;
    // the envelope is what one executor response can carry.
    expect(MAX_EXECUTOR_RESPONSE_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_SANDBOX_OUTPUT_BYTES).toBe(Math.floor(MAX_EXECUTOR_RESPONSE_BYTES / (2 * (6 + 4 / 3)) * 0.9));
    // Two streams at the ceiling, escaped and encoded, still fit under the envelope.
    expect(MAX_SANDBOX_OUTPUT_BYTES * 2 * (6 + 4 / 3)).toBeLessThan(MAX_EXECUTOR_RESPONSE_BYTES);
  });

  it('outputBytes is the executor ceiling itself; no file that could hold a second number holds one', () => {
    expect(read('relay-bridge/julius/sandbox-limits.ts'), 'the request must name the ceiling, not a number near it')
      .toMatch(/outputBytes:\s*MAX_SANDBOX_OUTPUT_BYTES\b/u);
    for (const file of [
      'relay-bridge/julius/sandbox-limits.ts',
      'relay-bridge/julius/executor-effects.ts',
      'scripts/julius-live-preflight.ts',
    ]) {
      expect(read(file), `${file} must not carry its own outputBytes number`).not.toMatch(/outputBytes:\s*\d/u);
    }
  });

  it('network stays DENY and the workspace ceiling stays the beta 4 MiB', () => {
    expect(EXECUTOR_SANDBOX_POLICY.network).toBe('DENY');
    expect(EXECUTOR_SANDBOX_LIMITS.workspaceBytes).toBe(BETA_WORKSPACE_BYTES);
    expect(EXECUTOR_SANDBOX_LIMITS.workspaceBytes).toBe(4_194_304);
  });

  it('the shared objects are frozen, so no caller can drift them at runtime', () => {
    expect(Object.isFrozen(EXECUTOR_SANDBOX_LIMITS)).toBe(true);
    expect(Object.isFrozen(EXECUTOR_SANDBOX_POLICY)).toBe(true);
  });
});
