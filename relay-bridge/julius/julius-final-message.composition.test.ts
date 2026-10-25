import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { compileHostedEnvelope } from '../hosted-coding-agent/hosted-envelope';
import { observeHostedMessages } from '../hosted-coding-agent/hosted-observation';
import type { HostedQueryFn, HostedRunOutcome } from '../hosted-coding-agent/hosted-runner';
import { createJuliusContextSnapshot, type JuliusTask, type JuliusWorker } from '../../src/relay/mission/julius';
import { resolveLiveWorkers } from './live-composition';
import { createInMemoryArtifactExchange } from './live-workers';
import { juliusFinalMessageStem } from './julius-final-message';

/**
 * REVIEW #459 LOW: the wiring, behaviourally. JULIUS_FINAL_MESSAGE_DIR in the composition's
 * env reaches the Coding Agent the live composition builds, and a dispatch through that adapter
 * keeps the final message; without the variable, nothing is kept.
 */
const MODEL = 'claude-opus-5-5';
const ARTIFACT = '{"schema":"inworld-ledger.v1","sales":[]}';
const LIVE_ENV: Record<string, string> = {
  OPENAI_API_KEY: 'FAKETESTNOTREAL-openai', OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-5.6-sol', RELAY_PROMPT_ARCHITECT_MODE: 'live',
  ANTHROPIC_API_KEY: 'FAKETESTNOTREAL-anthropic', RELAY_HOSTED_CODING_MODEL: MODEL, RELAY_HERMES_PROVIDER: 'xai', RELAY_HERMES_MODEL: 'grok-build-0.1',
};
const messages = [
  { type: 'system', subtype: 'init', session_id: 's', model: MODEL, claude_code_version: '2.1.220', apiKeySource: 'none', cwd: '/w', tools: ['Read', 'Edit'] },
  { type: 'assistant', parent_tool_use_id: null, session_id: 's', message: { model: MODEL, content: [{ type: 'text', text: 'working' }], usage: { input_tokens: 100, output_tokens: 50 } } },
  {
    type: 'result', subtype: 'success', is_error: false, num_turns: 1, duration_ms: 1000, usage: { input_tokens: 100, output_tokens: 50 },
    total_cost_usd: 0.2, terminal_reason: 'completed', result: ARTIFACT, permission_denials: [], modelUsage: { [MODEL]: { inputTokens: 100, outputTokens: 50 } },
  },
];

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function dispatchThroughComposition(finalMessageDir: string | null): Promise<{ workspace: string }> {
  const root = mkdtempSync(join(tmpdir(), 'julius-final-composition-'));
  roots.push(root);
  const workspace = join(root, 'ws');
  mkdirSync(workspace);
  if (finalMessageDir !== null) mkdirSync(finalMessageDir, { mode: 0o700 });
  const task: JuliusTask = {
    taskId: 'task:build-1', missionId: 'mission', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [],
    taskType: 'implementation', role: 'CODING_AGENT', ordinal: 1, state: 'ACTIVE',
  };
  const worker: JuliusWorker = {
    workerId: 'coder', role: 'CODING_AGENT', adapterId: 'claude-agent-sdk-hosted-live', providerId: 'anthropic',
    capabilities: ['code'], taskTypes: ['implementation'], concurrencyLimit: 1, timeoutMs: 360_000, maxRetries: 1, status: 'AVAILABLE',
  };
  const snapshot = createJuliusContextSnapshot({
    contextId: 'ctx-1', runId: 'wlj_x', task, worker, entries: [], maxCharacters: 2_000,
    missionContractRevision: 1, cardRevision: 'card', projectBrainRevision: 1,
    dependencyTaskIds: [], evidenceIds: [], findingIds: [], acceptanceCriterionIds: [],
  });
  const artifacts = createInMemoryArtifactExchange();
  artifacts.seed({ kind: 'PLAN', runId: 'wlj_x', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, 'THE PLAN');
  const resolution = resolveLiveWorkers({
    env: { ...LIVE_ENV, ...(finalMessageDir === null ? {} : { JULIUS_FINAL_MESSAGE_DIR: finalMessageDir }) },
    projectId: 'project', workspacePath: workspace, testCommand: '',
    contexts: { snapshotFor: (contextId: string) => (contextId === 'ctx-1' ? snapshot : null) },
    artifacts,
    shell: { run: async () => ({ status: 'SUCCEEDED', exitCode: 0, stdout: 'abc123', stderr: '', invocationId: 'inv' }) },
    runners: {
      coder: (async (): Promise<HostedRunOutcome> => ({
        kind: 'completed', observation: observeHostedMessages(messages), envelope: compileHostedEnvelope({ workspacePath: workspace }),
        startedAt: '2026-10-25T00:00:00.000Z', completedAt: '2026-10-25T00:00:01.000Z',
      })) as never,
      queryLoader: async () => (() => (async function* () { /* none */ })()) as HostedQueryFn,
    },
  } as Parameters<typeof resolveLiveWorkers>[0]);
  expect(resolution.ok).toBe(true);
  if (!resolution.ok) return { workspace };
  const coder = resolution.entries.find((entry) => entry.worker.role === 'CODING_AGENT');
  expect(coder).toBeDefined();
  await coder?.adapter.dispatch({ taskId: 'task:build-1', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contextId: 'ctx-1', taskType: 'implementation' }).catch(() => undefined);
  return { workspace };
}

describe('the live composition keeps the final message only when the paid workflow asks', () => {
  it('JULIUS_FINAL_MESSAGE_DIR in the env reaches the Coding Agent, and a dispatch keeps its final message', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'julius-final-dir-')), 'final');
    roots.push(join(out, '..'));
    await dispatchThroughComposition(out);
    const stem = juliusFinalMessageStem('task:build-1', 'ctx-1');
    expect(readdirSync(out).sort()).toEqual([`${stem}.manifest.json`, `${stem}.raw.txt`, `${stem}.redacted.json`]);
    expect(readFileSync(join(out, `${stem}.raw.txt`), 'utf8')).toBe(ARTIFACT);
    const manifest = JSON.parse(readFileSync(join(out, `${stem}.manifest.json`), 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({ taskId: 'task:build-1', contextId: 'ctx-1', trimmedSha256: createHash('sha256').update(ARTIFACT).digest('hex') });
  });

  it('without the variable nothing is kept', async () => {
    const { workspace } = await dispatchThroughComposition(null);
    expect(readdirSync(workspace)).toEqual([]);
  });
});
