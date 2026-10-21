import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE ABSENT PATH NEVER REACHES THE SCHEDULE (juju2, 2026-10-20). The fail-closed validation lives inside `coderRuntimeSchedule`; this file
 * proves, at run time, that a contract WITHOUT `limits.coderRuntimeMinutes` never calls it (nor `resolveContractCoderRuntime`), so the
 * validation cannot alter any absent-path output. The control (declared => called) proves the spy can see a call.
 */
const calls = vi.hoisted(() => ({ schedule: 0, resolve: 0 }));
vi.mock('../hosted-coding-agent/coder-envelope', async (importOriginal) => {
  const original = await importOriginal<typeof import('../hosted-coding-agent/coder-envelope')>();
  return {
    ...original,
    coderRuntimeSchedule: (...args: Parameters<typeof original.coderRuntimeSchedule>) => { calls.schedule += 1; return original.coderRuntimeSchedule(...args); },
    resolveContractCoderRuntime: (...args: Parameters<typeof original.resolveContractCoderRuntime>) => { calls.resolve += 1; return original.resolveContractCoderRuntime(...args); },
  };
});

import { createFakeExecutorShell } from './coding-agent-fixtures';
import { CODER_WORKER, coderRuntimeScheduleOfContract, resolveLiveWorkers } from './live-composition';
import { liveCoderRuntimeBudgetLines } from './live-report-lines';
import { createInMemoryArtifactExchange } from './live-workers';
import { HOSTED_API_KEY_ENV } from '../hosted-coding-agent/hosted-readiness';

const BASE: Record<string, string> = Object.freeze({
  OPENAI_API_KEY: 'FAKETESTNOTREAL-openai', OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-5.6-sol', RELAY_PROMPT_ARCHITECT_MODE: 'live', RELAY_HOSTED_CODING_MODEL: 'claude-fable-5',
  RELAY_HERMES_PROVIDER: 'xai', RELAY_HERMES_MODEL: 'grok-build-0.1', RELAY_HERMES_EXECUTABLE: '/usr/bin/true', [HOSTED_API_KEY_ENV]: 'FAKETESTNOTREAL-configured',
});

describe('absent limits.coderRuntimeMinutes: the schedule and the resolver are never called', () => {
  let scratch = '';
  let workspace = '';
  beforeEach(() => { calls.schedule = 0; calls.resolve = 0; scratch = mkdtempSync(join(tmpdir(), 'julius-crt-absent-')); workspace = join(scratch, 'workspace'); mkdirSync(workspace); });
  afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });
  const resolveWith = (extra: Record<string, unknown>) => resolveLiveWorkers({
    env: BASE, projectId: 'prj-crt', workspacePath: workspace, testCommand: 'npm test',
    contexts: { snapshotFor: () => null }, artifacts: createInMemoryArtifactExchange(), shell: createFakeExecutorShell({}), ...extra,
  } as never);

  it('composition with the field absent / null / undefined, with any repairCycles and approval wait: no call, and the coder entry is CODER_WORKER itself', () => {
    for (const extra of [{}, { coderRuntimeMinutes: undefined }, { coderRuntimeMinutes: null }, { repairCycles: 3, approvalWaitMs: 2_100_000 }, { coderRuntimeMinutes: null, repairCycles: 0, approvalWaitMs: -1 }]) {
      const resolution = resolveWith(extra);
      expect(resolution.ok, JSON.stringify(extra)).toBe(true);
      expect(resolution.entries.find((entry) => entry.worker.role === 'CODING_AGENT')?.worker, JSON.stringify(extra)).toBe(CODER_WORKER);
    }
    expect(calls).toEqual({ schedule: 0, resolve: 0 });
  });
  it('the report path: no key => no schedule, no lines, no call (even with a hostile approvalGates clause or repairCycles)', () => {
    for (const contract of [{}, { limits: {} }, { limits: { repairCycles: -5 } }, { limits: { repairCycles: Number.NaN }, approvalGates: [{}] }, { limits: { coderEffort: 'max' } }]) {
      expect(coderRuntimeScheduleOfContract({}, contract as never)).toBeNull();
      expect(liveCoderRuntimeBudgetLines(coderRuntimeScheduleOfContract({}, contract as never))).toEqual([]);
    }
    expect(calls).toEqual({ schedule: 0, resolve: 0 });
  });
  it('CONTROL: with the field declared the spy DOES see the calls (so the zero above is meaningful)', () => {
    const resolution = resolveWith({ coderRuntimeMinutes: 20, repairCycles: 1 });
    expect(resolution.ok).toBe(true);
    expect(calls.schedule).toBeGreaterThan(0);
    expect(calls.resolve).toBeGreaterThan(0);
    calls.schedule = 0;
    expect(coderRuntimeScheduleOfContract({}, { limits: { coderRuntimeMinutes: 20 } } as never)).not.toBeNull();
    expect(calls.schedule).toBe(1);
  });
});
