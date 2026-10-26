import { describe, expect, it } from 'vitest';

import { createInMemoryArtifactExchange, createLiveArchitectAdapter } from './live-workers';
import { architectWorker } from './live-composition';
import {
  JULIUS_CONTEXT_COMPILER_VERSION,
  JuliusExecutionCoordinator, JuliusProviderHealthRegistry, JuliusProviderRouter, JuliusWorkerRegistry,
  type JuliusCardPolicy, type JuliusContextSnapshot, type JuliusExecutionPorts,
} from '../../src/relay/mission/julius';
import type { GptRunOutcome } from '../../src/relay/connectors/gpt-architect';

/**
 * #43 AT THE PROMPT ARCHITECT'S OWN SITE: its retryable failures, driven through
 * the REAL architect adapter and the REAL coordinator, counting provider calls.
 *
 * The architect never attests that nothing ran (its own comment: a 429 can
 * follow a billed first try inside the SDK's retry, and a correction call follows
 * a billed answer). So after the handoff each of its retryable classes is OUTCOME
 * UNKNOWN: exactly one provider call, never retried, the hold closed unknown.
 * Provider-free: the connector is a scripted outcome; nothing is contacted.
 */

const worker = architectWorker({});
const policy: JuliusCardPolicy = {
  revision: 'card', autonomy: 'AUTONOMOUS', allowedProviders: [worker.providerId], capabilities: ['plan'],
  network: false, filesystemMutation: false, fallback: false, automaticRetry: true,
  subagents: { allowed: false, maxDepth: 0, maxActive: 0, maxTotal: 0 },
  iterativeReview: { allowed: false, maxRounds: 0 }, concurrency: 1, approvals: [],
};

function snapshot(taskId: string): JuliusContextSnapshot {
  return {
    contextId: 'ctx-43', runId: 'run-43', taskId, workerId: worker.workerId,
    workerRole: 'PROMPT_ARCHITECT', compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION,
    missionContractRevision: 1, cardRevision: 'card', projectBrainRevision: 0,
    taskContractRevision: 1, taskContractDigest: 'sha256:contract',
    sourceEntryIds: [], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
    acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:content',
    integrityVersion: null, integrityConflicts: null,
    integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
    characterCount: 24, redactionCount: 0, truncated: false,
    packet: {
      missionId: 'mission-43', taskId, workerId: worker.workerId, sourceEntryIds: [],
      blocks: [{ kind: 'CONSTRAINT', text: 'OBJECTIVE: #43' }], truncated: false,
    },
  };
}

const claim = {
  runId: 'run-43', projectId: 'project', taskId: 'plan-1', leaseOwner: 'scheduler', leaseGeneration: 1,
  capability: 'plan', contextId: 'ctx-43',
  task: {
    taskId: 'plan-1', missionId: 'mission-43', parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT' as const], taskType: 'plan',
    role: 'PROMPT_ARCHITECT' as const, ordinal: 0, state: 'ACTIVE' as const,
  },
};

async function drive(outcome: GptRunOutcome) {
  let calls = 0;
  const adapter = createLiveArchitectAdapter({
    worker,
    contexts: { snapshotFor: () => snapshot('plan-1') },
    artifacts: createInMemoryArtifactExchange(),
    config: { liveMode: true, model: 'gpt-5.6-sol', maxOutputTokens: 4_000 } as never,
    apiKey: 'FAKETESTNOTREAL-openai',
    run: (async () => { calls += 1; return outcome; }) as never,
  });
  const registry = new JuliusWorkerRegistry();
  registry.register(worker);
  const rows: Record<string, unknown>[] = [];
  const released: { usdMicros: number | null | undefined; spendUnknown: boolean | undefined }[] = [];
  const ports: JuliusExecutionPorts = {
    async reserve() { return { reservationId: 'r', state: 'RESERVED', denialReason: null }; },
    async commit() {}, async release(input) { released.push({ usdMicros: input.usdMicros, spendUnknown: input.spendUnknown }); },
    async persistEvidence() {}, async acceptResult() { return { duplicate: false }; },
    async recordEvent(input) { rows.push({ type: input.type, ...input.payload }); },
  };
  const coordinator = new JuliusExecutionCoordinator(
    new JuliusProviderRouter(registry, new Map([[worker.adapterId, adapter]]), new JuliusProviderHealthRegistry()), ports);
  const result = await coordinator.execute({
    claim, policy, role: 'PROMPT_ARCHITECT', taskType: 'plan', capability: 'plan', operationId: 'op',
    resources: { usdMicros: 10, inputTokens: 10, outputTokens: 10, toolCalls: 0, runtimeMs: 100 },
    reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } } as never,
  });
  return { result, calls: () => calls, rows, released };
}

describe('#43 · the Prompt Architect: every retryable class after the handoff is OUTCOME UNKNOWN', () => {
  it.each([
    ['timeout', 'TIMEOUT', 'HANDED_TIMEOUT_OUTCOME_UNKNOWN'],
    ['network_disconnected', 'TIMEOUT', 'HANDED_TIMEOUT_OUTCOME_UNKNOWN'],
    ['rate_limited', 'RATE_LIMIT', 'HANDED_FAILURE_OUTCOME_UNKNOWN'],
  ] as const)('%s: one provider call, FAILED on the named cause, the hold closed unknown', async (failureClass, code, cause) => {
    const h = await drive({ ok: false, failureClass, message: 'scripted' } as GptRunOutcome);
    expect(h.calls(), 'exactly one provider call').toBe(1);
    expect(h.result).toMatchObject({ status: 'FAILED', code, failureClass, reasonCode: cause });
    expect(h.rows.filter((row) => row.type === 'retry.scheduled'), 'never retried').toEqual([]);
    expect(h.rows.find((row) => row.type === 'task.failed')).toMatchObject({ code, reasonCode: cause, errorRetryable: true });
    expect(h.released, 'unknown spend, never released as $0').toEqual([{ usdMicros: null, spendUnknown: true }]);
  });

  it('a non-retryable class keeps today\'s ending: FAILED, no OUTCOME UNKNOWN cause', async () => {
    const h = await drive({ ok: false, failureClass: 'authentication_failed', message: 'scripted' } as GptRunOutcome);
    expect(h.calls()).toBe(1);
    expect(h.result).toMatchObject({ status: 'FAILED', code: 'AUTH_CONFIGURATION' });
    expect((h.result as { reasonCode?: string }).reasonCode).toBeUndefined();
  });
});
