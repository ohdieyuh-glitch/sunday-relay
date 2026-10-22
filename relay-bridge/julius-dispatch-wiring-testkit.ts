import { createHash } from 'node:crypto';

import type { GptRunOutcome } from '../src/relay/connectors/gpt-architect';
import type { JuliusCodingAgentProvider, JuliusCodingAgentProviderOutcome } from '../src/relay/mission/julius/julius-coding-agent';
import { createMemoryDispatchLedger } from './julius-dispatch';
import { createJ1LiveDispatchWithPins, type J1Env, type J1WiringDeps, type J1WiringResult } from './julius-dispatch-wiring-core';
import type { ShellEffectPort } from './julius/executor-effects';

/**
 * TEST KIT ONLY. Fakes and TEST PINS (the sha256 of fake bytes) for the J1 wiring tests. Production code, server.ts and everything they
 * import must never import this file; a source-scan test in julius-dispatch-wiring.test.ts fails if one does. There is no env or NODE_ENV
 * switch anywhere: the only way to a non-production pin is to import this file.
 */

/* FAKES ONLY: no network, no process spawn, no key, no real file but the repository's own contract bytes (read once, below). */

export const sha = (v: string | Uint8Array): string => createHash('sha256').update(v).digest('hex');
export const canary = (name: string): string => ['canary', name, 'ZZ9', 'x7Q2m4k8w1'].join('_');
export const KEY = { openai: canary('openai'), xai: canary('xai') };

/** The private key directory the fake key store answers for. A canary: it must never reach a ledger row or a log. */
export const KEY_DIR = '/private-keys-ZZ9-dir';
export const FILES: Record<string, string> = {
  '/pins/contract.json': '{"fake":"contract bytes"}\n',
  '/pins/checker.mjs': 'fake checker bytes',
  '/pins/ledger.csv': 'fake seed ledger',
  '/pins/posts.json': '[]',
};
export const PIN = { contractSha256: sha(FILES['/pins/contract.json']!), checkerSha256: sha(FILES['/pins/checker.mjs']!) };

export const goodEnv = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  JULIUS_J1_ENABLED: '1', JULIUS_J1_FOUNDER_PLAYER_ID: 'founder', JULIUS_J1_PROJECT_ID: 'proj-1', JULIUS_J1_REVIEWER_PROVIDER: 'xai',
  JULIUS_J1_BUDGET_CAP_USD: '10', JULIUS_J1_LEG_ESTIMATE_USD: '1',
  JULIUS_J1_MISSION_ID: 'mission-1', JULIUS_J1_MISSION_AUTHOR: 'judev', JULIUS_J1_CHECKER_AUTHOR: 'reviewdev', JULIUS_J1_PREREG_ID: 'prereg-1',
  JULIUS_J1_CONTRACT_PATH: '/pins/contract.json', JULIUS_J1_CONTRACT_SHA256: PIN.contractSha256,
  JULIUS_J1_CHECKER_PATH: '/pins/checker.mjs', JULIUS_J1_CHECKER_SHA256: PIN.checkerSha256, JULIUS_J1_NODE_PATH: 'node',
  JULIUS_J1_SEED_LEDGER_PATH: '/pins/ledger.csv', JULIUS_J1_SEED_LEDGER_SHA256: sha(FILES['/pins/ledger.csv']!),
  JULIUS_J1_SEED_POSTS_PATH: '/pins/posts.json', JULIUS_J1_SEED_POSTS_SHA256: sha(FILES['/pins/posts.json']!),
  JULIUS_J1_ARCHITECT_MODEL: 'gpt-test-model', JULIUS_J1_CODER_MODEL: 'claude-test-model', JULIUS_J1_REVIEWER_MODEL: 'grok-test-model',
  JULIUS_J1_ARCHITECT_KEY_ENV: 'OPENAI_API_KEY', JULIUS_J1_REVIEWER_KEY_ENV: 'XAI_API_KEY',
  JULIUS_J1_REVIEWER_SERVED_MODEL_ALLOW: 'grok-test-model,grok-test-model-20260101',
  JULIUS_J1_ARCHITECT_SERVED_MODEL_ALLOW: 'gpt-test-model,gpt-served', JULIUS_J1_CODER_SERVED_MODEL_ALLOW: 'claude-test-model,claude-served',
  JULIUS_J1_ARCHITECT_MAX_OUTPUT_TOKENS: '4000', JULIUS_J1_ARCHITECT_TIMEOUT_MS: '60000',
  JULIUS_J1_CODER_PERMITTED_PATHS: 'out/normalized.json', JULIUS_J1_CODER_WORKSPACE_PATH: '/work', JULIUS_J1_CODER_WORKER_ID: 'w-coder',
  JULIUS_J1_LEDGER_FILE: '/ledger/j1.jsonl',
  JULIUS_J1_KEY_DIR: KEY_DIR, PATH: '/bin',
  ...over,
});

export const ARTIFACT = '{"normalized":true}';
export const HEAD = 'a'.repeat(40);
export const completed = (): JuliusCodingAgentProviderOutcome => ({
  kind: 'completed', finalText: ARTIFACT,
  observation: { providerModel: 'claude-served', turns: 4, toolInvocations: 9, inputTokens: 100, outputTokens: 50, costUsdMicros: null, costBasis: 'NOT_APPLICABLE', diagnostics: { responseId: 'session-0011223344' } },
});
/** A fake coding provider; given a workspace map it writes the artifact file into it, as a real session would. */
export const fakeCoder = (workspace?: Record<string, string>): JuliusCodingAgentProvider => ({ providerKind: 'fake-coding', async execute() { if (workspace !== undefined) workspace['out/normalized.json'] = ARTIFACT; return completed(); } });
export const fakeShell = (): ShellEffectPort => ({
  async run(input) {
    return input.invocationKey.endsWith(':status')
      ? { status: 'SUCCEEDED', exitCode: 0, stdout: ' M a.js\u0000?? b.js\u0000', stderr: '', invocationId: 'inv_close' }
      : { status: 'SUCCEEDED', exitCode: 0, stdout: `HEAD ${HEAD}\n`, stderr: '', invocationId: 'inv_start' };
  },
});

export interface Probe { readonly logs: string[]; readonly spawned: { command: string; args: readonly string[] }[]; readonly fetched: { url: string; auth: string }[]; readonly ledgers: ReturnType<typeof createMemoryDispatchLedger>[]; readonly artifacts: Map<string, string>; readonly workspace: Record<string, string>; readonly keyReads: string[]; readonly keyDirs: string[] }

export function makeDeps(over: Partial<J1WiringDeps> = {}, files: Record<string, string> = FILES): { deps: J1WiringDeps; probe: Probe } {
  const probe: Probe = { logs: [], spawned: [], fetched: [], ledgers: [], artifacts: new Map(), keyReads: [], keyDirs: [], workspace: { 'data/legacy_ledger.csv': 'a,b', 'data/posts.json': '[]', 'format.test.mjs': 't' } };
  let clock = Date.parse('2026-10-22T12:00:00Z');
  const xaiBody = { id: 'resp_xai_0011223344', model: 'grok-test-model', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, output: [{ content: [{ text: '{"verdict":"approve","summary":"fine"}' }] }] };
  const deps: J1WiringDeps = {
    readFileSync: (path) => { const v = files[path]; if (v === undefined) throw new Error('enoent'); return new TextEncoder().encode(v); },
    fetchImpl: async (url, init) => { probe.fetched.push({ url, auth: init.headers.authorization ?? '' }); return { ok: true, status: 200, text: async () => JSON.stringify(xaiBody) }; },
    runProcess: async (command, args) => {
      probe.spawned.push({ command, args });
      const judged = sha((probe.artifacts.get(args[1]!) ?? '').trim());
      return { exitCode: 0, stdout: `checker_sha256=${PIN.checkerSha256}\njudged_trimmed_sha256=${judged}\nPASS\n` };
    },
    stageFiles: async (files) => ({ paths: files.map((f) => `/stage/${f.name}`), cleanup: async () => undefined }),
    readStagedFile: async (path) => { const name = path.replace('/stage/', ''); const v = files[name === 'checker.mjs' ? '/pins/checker.mjs' : name === 'ledger.csv' ? '/pins/ledger.csv' : '/pins/posts.json']; return new TextEncoder().encode(v ?? ''); },
    realpath: async (p) => p,
    checkerBaseEnv: { PATH: '/bin', OPENAI_API_KEY: 'must-not-reach-child' },
    writeArtifact: async (text) => { const path = `/tmp/art-${probe.artifacts.size}.txt`; probe.artifacts.set(path, text); return { path, cleanup: async () => undefined }; },
    openLedger: () => { const l = createMemoryDispatchLedger(); probe.ledgers.push(l); return l; },
    architectRun: async () => ({ ok: true, actualModel: 'gpt-served', responseId: 'resp_arch_0011223344', status: 'completed', outputText: 'PLAN', usage: { inputTokens: 5, cachedInputTokens: null, outputTokens: 7, reasoningTokens: null, totalTokens: 12 } }) as GptRunOutcome,
    coderProviderFor: () => fakeCoder(probe.workspace),
    shell: fakeShell(),
    keyStoreFor: (dir) => {
      probe.keyDirs.push(dir);
      const held: Record<string, string> = { OPENAI_API_KEY: KEY.openai, XAI_API_KEY: KEY.xai };
      return { has: (name) => name in held, getKey: (name) => { probe.keyReads.push(name); const v = held[name]; if (v === undefined) throw new Error('key_file_absent'); return v; } };
    },
    workspaceFs: () => ({
      listEntries: async () => Object.keys(probe.workspace).map((path) => ({ path, kind: 'file' as const })),
      readFile: async (p) => { const v = probe.workspace[p]; if (v === undefined) throw new Error('enoent'); return new TextEncoder().encode(v); },
    }),
    now: () => (clock += 1000),
    log: (line) => probe.logs.push(line),
    ...over,
  };
  return { deps, probe };
}

export const dispatchInput = { projectId: 'proj-1', runId: 'run:1', callerPlayerId: 'founder', sessionId: 's1', idempotencyKey: 'key-0000001', clientTriggerId: 'trig-00000001', clientLogSha256: 'e'.repeat(64), clientUiActionUtc: '2026-10-22T11:59:30.000Z' };

/** The live factory with the TEST pins. The production factory (`createJ1LiveDispatchFromEnv`) has no such parameter. */
export const createJ1LiveForTest = (env: J1Env | (() => J1Env), deps: J1WiringDeps): J1WiringResult => createJ1LiveDispatchWithPins(env, deps, PIN);

/** The live composition REQUIRES the clock binding: fetch an echo from the controller and return the dispatch input carrying it (offset 0). */
export async function echoed(controller: { issueEcho: (i: { projectId: string; callerPlayerId: string }) => { ok: boolean; echoId?: string } }): Promise<typeof dispatchInput & { clientOffsetMs: number; echoId: string }> {
  const e = controller.issueEcho({ projectId: dispatchInput.projectId, callerPlayerId: dispatchInput.callerPlayerId });
  if (!e.ok || e.echoId === undefined) throw new Error('echo_refused');
  return { ...dispatchInput, clientOffsetMs: 0, echoId: e.echoId };
}
