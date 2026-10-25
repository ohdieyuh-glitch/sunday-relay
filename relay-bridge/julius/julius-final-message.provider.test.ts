import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { observeHostedMessages } from '../hosted-coding-agent/hosted-observation';
import { compileHostedEnvelope } from '../hosted-coding-agent/hosted-envelope';
import type { HostedQueryFn, HostedRunOutcome } from '../hosted-coding-agent/hosted-runner';
import type { JuliusCodingAgentRequest } from '../../src/relay/mission/julius/julius-coding-agent';
import { createClaudeCodeCodingAgentProvider } from './claude-code-coding-provider';
import { juliusFinalMessageStem } from './julius-final-message';

/**
 * B1 (REVIEW, #459): the final message must be kept on the PAID coder path,
 * `createClaudeCodeCodingAgentProvider`, which is what julius-live-mission's
 * composition builds for the Coding Agent — not the old Relay invoker.
 */
const REQUESTED = 'claude-opus-5-5';
const ARTIFACT = '{"schema":"inworld-ledger.v1","sales":[]}';
const init = { type: 'system', subtype: 'init', session_id: 's', model: REQUESTED, claude_code_version: '2.1.220', apiKeySource: 'none', cwd: '/workspace/mission', tools: ['Read', 'Edit', 'Write'] };
const turn = { type: 'assistant', parent_tool_use_id: null, session_id: 's', message: { model: REQUESTED, content: [{ type: 'text', text: 'working' }], usage: { input_tokens: 100, output_tokens: 50 } } };
const result = {
  type: 'result', subtype: 'success', is_error: false, num_turns: 1, duration_ms: 1000, usage: { input_tokens: 100, output_tokens: 50 },
  total_cost_usd: 0.2, terminal_reason: 'completed', result: `\n${ARTIFACT}\n`, permission_denials: [],
  modelUsage: { [REQUESTED]: { inputTokens: 100, outputTokens: 50 } },
};

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function dirs(): { workspace: string; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'julius-final-provider-'));
  roots.push(root);
  mkdirSync(join(root, 'ws'));
  mkdirSync(join(root, 'final-message'), { mode: 0o700 });
  return { workspace: join(root, 'ws'), out: join(root, 'final-message') };
}
const request = (workspacePath: string, contextId = 'context:1') => ({
  version: 'julius-coding-agent.v1', identity: { runId: 'wlj_x', missionId: 'm', taskId: 'task:build-1', taskType: 'build', contextId },
  workspacePath, contract: null, plan: 'THE PLAN',
  sections: { acceptedGuidance: [], architecture: [], findings: [], continuation: [], missionContext: [] },
  permissions: { mayEditFiles: true, mayRunCommands: false, mayUseNetwork: false, permittedPaths: [], outOfScope: [], prohibitedActions: [] },
  requiredEvidence: ['TEST'], budget: { usdMicros: null }, protocol: { participation: 'HOW TO ASK', researchAuthority: 'WHAT TO READ' },
} as unknown as JuliusCodingAgentRequest);
const provider = (finalMessageDir: string | undefined) => createClaudeCodeCodingAgentProvider({
  apiKey: 'FAKETESTNOTREAL', requestedModel: REQUESTED,
  ...(finalMessageDir === undefined ? {} : { finalMessageDir }),
  run: (async (): Promise<HostedRunOutcome> => ({
    kind: 'completed', observation: observeHostedMessages([init, turn, result]),
    envelope: compileHostedEnvelope({ workspacePath: '/workspace/mission' }), startedAt: 't', completedAt: 't',
  })) as never,
  queryLoader: async () => (() => (async function* () { /* none */ })()) as HostedQueryFn,
});

describe('the paid Coding Agent provider keeps the final message for the hidden checker', () => {
  it('writes the dispatch\'s trimmed final message and names its sha256 and context on the durable diagnostics', async () => {
    const { workspace, out } = dirs();
    const outcome = await provider(out).execute(request(workspace));
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    const stem = juliusFinalMessageStem('task:build-1', 'context:1');
    expect(readFileSync(join(out, `${stem}.raw.txt`), 'utf8')).toBe(ARTIFACT);
    const sha = createHash('sha256').update(ARTIFACT, 'utf8').digest('hex');
    expect(outcome.observation.diagnostics).toMatchObject({ finalMessageSha256: sha, finalMessageContextId: 'context:1' });
    expect(readdirSync(workspace)).toEqual([]);
  });

  it('a retried attempt of the same task is its own file, keyed by its own dispatch context', async () => {
    const { workspace, out } = dirs();
    await provider(out).execute(request(workspace, 'context:1'));
    const second = await provider(out).execute(request(workspace, 'context:2'));
    expect(second.kind === 'completed' && second.observation.diagnostics).toMatchObject({ finalMessageContextId: 'context:2' });
    expect(readdirSync(out).filter((f) => f.endsWith('.raw.txt')).sort()).toEqual([
      `${juliusFinalMessageStem('task:build-1', 'context:1')}.raw.txt`, `${juliusFinalMessageStem('task:build-1', 'context:2')}.raw.txt`,
    ]);
  });

  it('a write that fails is a recorded fact, not silence', async () => {
    const { workspace, out } = dirs();
    await provider(out).execute(request(workspace, 'context:1'));
    const again = await provider(out).execute(request(workspace, 'context:1'));
    expect(again.kind === 'completed' && again.observation.diagnostics).toMatchObject({ finalMessageWrite: 'write_failed' });
    expect(again.kind === 'completed' && 'finalMessageSha256' in (again.observation.diagnostics as object)).toBe(false);
  });

  it('with no directory nothing is written and the diagnostics are unchanged', async () => {
    const { workspace } = dirs();
    const outcome = await provider(undefined).execute(request(workspace));
    const diagnostics = outcome.kind === 'completed' ? outcome.observation.diagnostics as Record<string, unknown> : {};
    expect('finalMessageSha256' in diagnostics || 'finalMessageWrite' in diagnostics).toBe(false);
  });

  it('the live composition hands the paid workflow\'s directory to this provider, and nothing else reads it', () => {
    const composition = readFileSync(join('relay-bridge', 'julius', 'live-composition.ts'), 'utf8');
    expect(composition).toContain('finalMessageDir: options.env.JULIUS_FINAL_MESSAGE_DIR');
    const workers = readFileSync(join('relay-bridge', 'julius', 'live-workers.ts'), 'utf8');
    expect(workers).toContain('finalMessageDir: input.finalMessageDir');
  });
});

describe('the durable record keeps the final-message facts', () => {
  it('safeReviewDiagnostics admits the sha256, the context and the write reason, and refuses malformed ones', async () => {
    const { safeReviewDiagnostics } = await import('../../src/relay/mission/julius/julius-router');
    const sha = 'a'.repeat(64);
    expect(safeReviewDiagnostics({ finalMessageSha256: sha, finalMessageContextId: 'context:1' })).toMatchObject({ finalMessageSha256: sha, finalMessageContextId: 'context:1' });
    expect(safeReviewDiagnostics({ finalMessageWrite: 'write_failed' })).toMatchObject({ finalMessageWrite: 'write_failed' });
    const refused = safeReviewDiagnostics({ finalMessageSha256: 'A'.repeat(64), finalMessageContextId: 'a/b', finalMessageWrite: 'not a code!' }) as Record<string, unknown>;
    expect('finalMessageSha256' in refused || 'finalMessageContextId' in refused || 'finalMessageWrite' in refused).toBe(false);
  });
});
