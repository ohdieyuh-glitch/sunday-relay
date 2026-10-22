import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { GptRunOutcome } from '../src/relay/connectors/gpt-architect';
import type { JuliusCodingAgentProvider, JuliusCodingAgentProviderOutcome } from '../src/relay/mission/julius/julius-coding-agent';
import type { JuliusApiIdentity, JuliusRunView } from '../src/relay/mission/julius/julius-runtime-api';
import { createMemoryDispatchLedger } from './julius-dispatch';
import { createJ1LiveDispatchFromEnv, J1_PINNED_CHECKER_SHA256, J1_PINNED_CONTRACT_SHA256, type J1WiringDeps } from './julius-dispatch-wiring';
import type { ShellEffectPort } from './julius/executor-effects';

/* FAKES ONLY: no network, no process spawn, no key, no real file but the repository's own contract bytes (read once, below). */

const sha = (v: string | Uint8Array): string => createHash('sha256').update(v).digest('hex');
const canary = (name: string): string => ['canary', name, 'ZZ9', 'x7Q2m4k8w1'].join('_');
const KEY = { openai: canary('openai'), xai: canary('xai') };

const FILES: Record<string, string> = {
  '/pins/contract.json': '{"fake":"contract bytes"}\n',
  '/pins/checker.mjs': 'fake checker bytes',
  '/pins/ledger.csv': 'fake seed ledger',
  '/pins/posts.json': '[]',
};
const PIN = { contractSha256: sha(FILES['/pins/contract.json']!), checkerSha256: sha(FILES['/pins/checker.mjs']!) };

const goodEnv = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
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
  OPENAI_API_KEY: KEY.openai, XAI_API_KEY: KEY.xai, PATH: '/bin',
  ...over,
});

const identity: JuliusApiIdentity = { tenantId: 't', projectId: 'proj-1', actorId: 'bridge', scopes: ['run:read'] };
const view = (): JuliusRunView => ({
  runId: 'run:1', missionId: 'mission-1', state: 'READY', revision: 1, cardRevision: 'c', missionContractRevision: 1, projectBrainRevision: 1,
  taskCounts: {} as never, activeTasks: 0, pendingApprovals: 0,
});

const ARTIFACT = '{"normalized":true}';
const HEAD = 'a'.repeat(40);
const completed = (): JuliusCodingAgentProviderOutcome => ({
  kind: 'completed', finalText: ARTIFACT,
  observation: { providerModel: 'claude-served', turns: 4, toolInvocations: 9, inputTokens: 100, outputTokens: 50, costUsdMicros: null, costBasis: 'NOT_APPLICABLE', diagnostics: { responseId: 'session-0011223344' } },
});
const fakeCoder = (): JuliusCodingAgentProvider => ({ providerKind: 'fake-coding', async execute() { return completed(); } });
const fakeShell = (): ShellEffectPort => ({
  async run(input) {
    return input.invocationKey.endsWith(':status')
      ? { status: 'SUCCEEDED', exitCode: 0, stdout: ' M a.js\u0000?? b.js\u0000', stderr: '', invocationId: 'inv_close' }
      : { status: 'SUCCEEDED', exitCode: 0, stdout: `HEAD ${HEAD}\n`, stderr: '', invocationId: 'inv_start' };
  },
});

interface Probe { readonly logs: string[]; readonly spawned: { command: string; args: readonly string[] }[]; readonly fetched: { url: string; auth: string }[]; readonly ledgers: ReturnType<typeof createMemoryDispatchLedger>[]; readonly artifacts: Map<string, string> }

function makeDeps(over: Partial<J1WiringDeps> = {}, files: Record<string, string> = FILES): { deps: J1WiringDeps; probe: Probe } {
  const probe: Probe = { logs: [], spawned: [], fetched: [], ledgers: [], artifacts: new Map() };
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
    writeArtifact: async (text) => { const path = `/tmp/art-${probe.artifacts.size}.txt`; probe.artifacts.set(path, text); return { path, cleanup: async () => undefined }; },
    openLedger: () => { const l = createMemoryDispatchLedger(); probe.ledgers.push(l); return l; },
    architectRun: async () => ({ ok: true, actualModel: 'gpt-served', responseId: 'resp_arch_0011223344', status: 'completed', outputText: 'PLAN', usage: { inputTokens: 5, cachedInputTokens: null, outputTokens: 7, reasoningTokens: null, totalTokens: 12 } }) as GptRunOutcome,
    coderProviderFor: () => fakeCoder(),
    shell: fakeShell(),
    runStore: { api: { inspectRun: async () => ({ ok: true, value: view() }) }, identityFor: () => identity, contractSha256Of: async () => PIN.contractSha256 },
    now: () => (clock += 1000),
    log: (line) => probe.logs.push(line),
    pinned: PIN,
    ...over,
  };
  return { deps, probe };
}

const dispatchInput = { projectId: 'proj-1', runId: 'run:1', callerPlayerId: 'founder', sessionId: 's1', idempotencyKey: 'key-0000001', clientTriggerId: 'trig-00000001', clientLogSha256: 'e'.repeat(64), clientUiActionUtc: '2026-10-22T11:59:30.000Z' };

describe('J1 live wiring (fakes only)', () => {
  it('the frozen pin constants are the contract file sha256 in this tree and the reviewer-frozen checker sha256', () => {
    expect(J1_PINNED_CHECKER_SHA256).toBe('1d1dc64ff9cf8f1f4133bbe22a65c483a9ad343a3ef4c2ee898709549b46f5dd');
    expect(sha(readFileSync(join(__dirname, 'julius-inworld-mission', 'julius-inworld-data-1', 'contract.json')))).toBe(J1_PINNED_CONTRACT_SHA256);
  });

  it('DEFAULT OFF: without JULIUS_J1_ENABLED=1 it is the uncomposed refuse-only controller and touches no dependency', async () => {
    const { deps, probe } = makeDeps({ readFileSync: () => { throw new Error('must not read'); }, openLedger: () => { throw new Error('must not open'); } });
    const r = createJ1LiveDispatchFromEnv(goodEnv({ JULIUS_J1_ENABLED: undefined }), deps);
    expect(r).toMatchObject({ live: false, reason: 'j1_disabled' });
    expect(await r.controller.dispatch(dispatchInput)).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_disabled' });
    expect(probe.ledgers).toHaveLength(0);
    for (const off of ['0', 'true', '', ' 1']) expect(createJ1LiveDispatchFromEnv(goodEnv({ JULIUS_J1_ENABLED: off }), deps).live).toBe(false);
  });

  it('every missing configuration value refuses (reason code only), and no value or key reaches the log', () => {
    const names = Object.keys(goodEnv()).filter((n) => n.startsWith('JULIUS_J1_') && n !== 'JULIUS_J1_ENABLED');
    expect(names.length).toBeGreaterThan(25);
    for (const name of names) {
      const { deps, probe } = makeDeps();
      const r = createJ1LiveDispatchFromEnv(goodEnv({ [name]: undefined }), deps);
      expect(r.live, name).toBe(false);
      expect(r.reason, name).toBe(`config_missing_${name.toLowerCase()}`);
      expect(probe.ledgers, name).toHaveLength(0);
      expect(probe.logs.join('\n')).not.toMatch(/canary_|ZZ9/);
    }
  });

  it('a missing dependency refuses (coder provider, shell, run store)', () => {
    expect(createJ1LiveDispatchFromEnv(goodEnv(), makeDeps({ coderProviderFor: null }).deps)).toMatchObject({ live: false, reason: 'dep_coder_provider_absent' });
    expect(createJ1LiveDispatchFromEnv(goodEnv(), makeDeps({ shell: null }).deps)).toMatchObject({ live: false, reason: 'dep_shell_absent' });
    expect(createJ1LiveDispatchFromEnv(goodEnv(), makeDeps({ runStore: null }).deps)).toMatchObject({ live: false, reason: 'dep_run_store_absent' });
  });

  it('a mismatched checker sha refuses: the env value, or the file on disk', async () => {
    const wrongEnv = createJ1LiveDispatchFromEnv(goodEnv({ JULIUS_J1_CHECKER_SHA256: 'f'.repeat(64) }), makeDeps().deps);
    expect(wrongEnv).toMatchObject({ live: false, reason: 'pin_checker_sha256_not_the_frozen_value' });
    const { deps, probe } = makeDeps({}, { ...FILES, '/pins/checker.mjs': 'tampered checker' });
    const r = createJ1LiveDispatchFromEnv(goodEnv(), deps);
    expect(r).toMatchObject({ live: false, reason: 'pin_checker_file_mismatch' });
    expect(await r.controller.dispatch(dispatchInput)).toMatchObject({ ok: false, status: 503 });
    expect(probe.ledgers).toHaveLength(0);
    expect(probe.spawned).toHaveLength(0);
  });

  it('the default pins are the real frozen ones: fake bytes cannot satisfy them', () => {
    const { deps } = makeDeps();
    const { pinned: _drop, ...rest } = deps;
    expect(createJ1LiveDispatchFromEnv(goodEnv(), rest)).toMatchObject({ live: false, reason: 'pin_contract_sha256_not_the_frozen_value' });
  });

  it('other pin mismatches refuse: contract file bytes, seed ledger, seed posts, malformed sha, unreadable file', () => {
    expect(createJ1LiveDispatchFromEnv(goodEnv(), makeDeps({}, { ...FILES, '/pins/contract.json': 'other' }).deps)).toMatchObject({ live: false, reason: 'pin_contract_sha256_mismatch' });
    expect(createJ1LiveDispatchFromEnv(goodEnv(), makeDeps({}, { ...FILES, '/pins/ledger.csv': 'other' }).deps)).toMatchObject({ live: false, reason: 'pin_seed_ledger_file_mismatch' });
    expect(createJ1LiveDispatchFromEnv(goodEnv(), makeDeps({}, { ...FILES, '/pins/posts.json': 'other' }).deps)).toMatchObject({ live: false, reason: 'pin_seed_posts_file_mismatch' });
    expect(createJ1LiveDispatchFromEnv(goodEnv({ JULIUS_J1_SEED_POSTS_SHA256: 'xyz' }), makeDeps().deps)).toMatchObject({ live: false, reason: 'config_invalid_julius_j1_seed_posts_sha256' });
    const noChecker = { ...FILES }; delete noChecker['/pins/checker.mjs'];
    expect(createJ1LiveDispatchFromEnv(goodEnv(), makeDeps({}, noChecker).deps)).toMatchObject({ live: false, reason: 'pin_checker_unreadable' });
  });

  it('a shared vendor, a same-author checker, a bad budget or an unopenable ledger all refuse', () => {
    expect(createJ1LiveDispatchFromEnv(goodEnv({ JULIUS_J1_REVIEWER_MODEL: 'gpt-grok-like' }), makeDeps().deps).live).toBe(false);
    expect(createJ1LiveDispatchFromEnv(goodEnv({ JULIUS_J1_CHECKER_AUTHOR: 'JUDEV' }), makeDeps().deps)).toMatchObject({ live: false, reason: 'frozen_mission_record_invalid' });
    expect(createJ1LiveDispatchFromEnv(goodEnv({ JULIUS_J1_BUDGET_CAP_USD: '0' }), makeDeps().deps)).toMatchObject({ live: false, reason: 'config_invalid_julius_j1_budget_cap_usd' });
    expect(createJ1LiveDispatchFromEnv(goodEnv(), makeDeps({ openLedger: () => { throw new Error(`disk ${KEY.xai}`); } }).deps)).toMatchObject({ live: false, reason: 'ledger_open_failed' });
  });

  it('a good env yields a LIVE controller composed with three different vendors, ledger opened once at the configured path', () => {
    const paths: string[] = [];
    const { deps, probe } = makeDeps({ openLedger: (f) => { paths.push(f); return createMemoryDispatchLedger(); } });
    const r = createJ1LiveDispatchFromEnv(goodEnv(), deps);
    expect(r).toMatchObject({ live: true, reason: null });
    expect(paths).toEqual(['/ledger/j1.jsonl']);
    expect(r.controller.killSwitchOn()).toBe(true);
    expect(probe.fetched).toHaveLength(0);
    expect(probe.spawned).toHaveLength(0);
  });

  it('the controller re-reads the kill switch from the env accessor', () => {
    const env = goodEnv();
    const r = createJ1LiveDispatchFromEnv(() => env, makeDeps().deps);
    expect(r.live).toBe(true);
    expect(r.controller.killSwitchOn()).toBe(true);
    env.JULIUS_J1_ENABLED = '0';
    expect(r.controller.killSwitchOn()).toBe(false);
  });

  it('END TO END (all fakes): dispatch runs architect, coder, reviewer, the frozen checker, ends COMPLETED and writes ledger rows with no key', async () => {
    const { deps, probe } = makeDeps();
    const r = createJ1LiveDispatchFromEnv(goodEnv(), deps);
    expect(r.live).toBe(true);
    expect(await r.controller.dispatch(dispatchInput)).toMatchObject({ ok: true, mode: 'live' });
    await r.controller.whenIdle();
    const rows = await probe.ledgers[0]!.rows();
    expect(rows.find((row) => row.role === 'final')).toMatchObject({ state: 'COMPLETED' });
    expect(rows.map((row) => row.phase)).toContain('run_start');
    expect(JSON.stringify(rows)).not.toContain(KEY.openai);
    expect(JSON.stringify(rows)).not.toContain(KEY.xai);
    expect(probe.fetched).toHaveLength(1);
    expect(probe.fetched[0]!.auth).toBe(`Bearer ${KEY.xai}`);
    expect(probe.spawned).toHaveLength(1);
    expect(probe.spawned[0]!.args).toContain('--expect-self-sha256');
    expect(probe.artifacts.get(probe.spawned[0]!.args[1]!)).toBe(ARTIFACT);
  });

  it('a second dispatch before recover() finished cannot run; a failing recover refuses 503', async () => {
    const { deps } = makeDeps({ openLedger: () => ({ append: async () => undefined, rows: async () => { throw new Error('torn'); } }) });
    const r = createJ1LiveDispatchFromEnv(goodEnv(), deps);
    expect(r.live).toBe(true);
    expect(await r.controller.dispatch(dispatchInput)).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_ledger_unavailable' });
  });

  it('SOURCE SCAN: neither wiring module reads process.env', () => {
    for (const file of ['julius-dispatch-wiring.ts', 'julius-dispatch-wiring-real.ts']) {
      const code = readFileSync(join(__dirname, file), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
      expect(code.filter((l) => /process\.env|process\['env'\]|process\[\"env\"\]/.test(l)), file).toEqual([]);
    }
  });
});
