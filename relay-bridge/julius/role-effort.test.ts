import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSdkMcpServer, query as realSdkQuery, tool as realSdkTool } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JULIUS_CONTEXT_COMPILER_VERSION, type JuliusContextSnapshot } from '../../src/relay/mission/julius';
import type { ArchitectReasoningEffort } from '../../src/relay/connectors/gpt-architect/config';
import { runGptArchitect } from '../../src/relay/connectors/gpt-architect/gpt-runner';
import { HOSTED_API_KEY_ENV } from '../hosted-coding-agent/hosted-readiness';
import { runHostedCodingAgent, type HostedEffort, type HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import { createFakeExecutorShell } from './coding-agent-fixtures';
import { CODER_WORKER, resolveLiveWorkers } from './live-composition';
import { createInMemoryArtifactExchange } from './live-workers';
import {
  compileBootstrapRequest, JULIUS_LIMITS_KEYS, JULIUS_ROLE_EFFORT_LEVELS, parseLiveMissionContract, type JuliusRoleEffort,
} from './mission-contract';

/**
 * PER-ROLE REASONING EFFORT (Option 2, low-risk step): a mission contract may declare
 * `limits.architectEffort` and `limits.coderEffort`, each one of low|medium|high|xhigh|max.
 *
 * WHAT THIS PINS, in the order a drop would happen:
 *   1. the four lists of level names agree (contract, checker, architect type, coder type);
 *   2. ABSENT IS TODAY, BYTE FOR BYTE: a committed contract parses to the digest main's own parser printed
 *      before this field existed, and declaring a level changes the digest, so both arms of a registration
 *      carry the same one only if their contracts do;
 *   3. a bad level is refused by the parser and by the checker, and an unknown `limits` key is refused;
 *   4. the architect request carries `reasoning` ONLY when declared, and the whole body is otherwise identical;
 *   5. the coder SDK options carry `effort` ONLY when declared;
 *   6. END TO END, from the contract field through `resolveLiveWorkers`: the architect runner is handed the
 *      level, and the REAL Agent SDK starts a child whose argv carries `--effort <level>`.
 * Nothing here contacts a provider and nothing is spent.
 */

const ROOT = resolve(__dirname, '..', '..');
const MISSIONS = join(ROOT, '.github', 'julius-missions');
const CHECKER = join(ROOT, 'scripts', 'julius-live-contract-check.mjs');
/** Printed by main 5004713's own mission-contract.ts (no effort code) for julius-live-mission-2. */
const MISSION_2_DIGEST_BEFORE = 'sha256:4bf13d0e833a042c74f57555aa7fc520aab8941b5bc621dcef35c975b87b714b';

const rawMission2 = (): Record<string, unknown> => JSON.parse(readFileSync(join(MISSIONS, 'julius-live-mission-2', 'contract.json'), 'utf8')) as Record<string, unknown>;
const withLimits = (extra: Record<string, unknown>): string => {
  const raw = rawMission2();
  return JSON.stringify({ ...raw, limits: { ...(raw.limits as Record<string, unknown>), ...extra } });
};
const digestOf = (raw: string): string => {
  const parsed = parseLiveMissionContract(raw);
  if (!parsed.ok) throw new Error(parsed.problem);
  return compileBootstrapRequest(parsed.contract, [], 'card:julius-live:1').missionBindingDigest;
};

describe('the level names agree everywhere they are written down', () => {
  const checkerSource = readFileSync(CHECKER, 'utf8');
  const listIn = (name: string): string[] => {
    const match = new RegExp(`const ${name} = \\[([^\\]]*)\\];`, 'u').exec(checkerSource);
    expect(match, `${name} must be declared in the checker`).not.toBeNull();
    return [...match![1].matchAll(/'([^']+)'/gu)].map((entry) => entry[1]);
  };

  it('the contract, the checker and both role types hold the same five levels and the same limits keys', () => {
    expect(listIn('ROLE_EFFORT_LEVELS')).toEqual([...JULIUS_ROLE_EFFORT_LEVELS]);
    expect(listIn('LIMITS_KEYS')).toEqual([...JULIUS_LIMITS_KEYS]);
    // Mutual assignability, checked by tsc: a level one type lacks makes this file fail to compile.
    const levels: JuliusRoleEffort[] = [...JULIUS_ROLE_EFFORT_LEVELS];
    const architect: ArchitectReasoningEffort[] = levels;
    const coder: HostedEffort[] = levels;
    const backA: JuliusRoleEffort[] = architect;
    const backC: JuliusRoleEffort[] = coder;
    expect([backA, backC]).toEqual([levels, levels]);
    expect(levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('the contract: absent is today, declared is bound, bad is refused', () => {
  it('CONTROL, byte identity: an unchanged contract parses to the digest the pre-change parser printed', () => {
    expect(digestOf(JSON.stringify(rawMission2()))).toBe(MISSION_2_DIGEST_BEFORE);
  });

  it('a declared level is inside the binding: it changes the digest, and a different level changes it again', () => {
    const high = digestOf(withLimits({ architectEffort: 'high' }));
    const low = digestOf(withLimits({ architectEffort: 'low' }));
    const coder = digestOf(withLimits({ coderEffort: 'high' }));
    expect(new Set([MISSION_2_DIGEST_BEFORE, high, low, coder]).size).toBe(4);
    const parsed = parseLiveMissionContract(withLimits({ architectEffort: 'xhigh', coderEffort: 'max' }));
    expect(parsed.ok && parsed.contract.limits).toMatchObject({ architectEffort: 'xhigh', coderEffort: 'max' });
  });

  it('a level the providers do not know is refused with a reason, not coerced', () => {
    for (const bad of ['extreme', 'HIGH', '', 5, null, true]) {
      for (const key of ['architectEffort', 'coderEffort']) {
        const parsed = parseLiveMissionContract(withLimits({ [key]: bad }));
        expect(parsed.ok, `${key}=${String(bad)}`).toBe(false);
        if (!parsed.ok) expect(parsed.problem).toContain(`limits.${key}`);
      }
    }
  });

  it('no committed contract declares an effort or any limit this build does not read', () => {
    // The ONLY committed contracts allowed to declare a per-role effort are the UNSCORED diagnostic missions named here, each pinned to the effort
    // its reviewed contract declares (the first lab mission ran low/low; the second runs at the founder's maximum-capability setting). No
    // contract may declare the coder self-test at all: the Independent Reviewer's ruling A on PR #371 forbids it (scored or unscored) until the
    // output-cap defect is fixed in a reviewed delta and the workspace-copy bound is measured.
    const EFFORT_MISSIONS: Record<string, { architect: string; coder: string }> = {
      'julius-option2-lab-1': { architect: 'low', coder: 'low' },
      'julius-diag-output-safety-1': { architect: 'high', coder: 'max' },
      'julius-diag-output-safety-2': { architect: 'high', coder: 'high' },
      'julius-diag-audit-fixes-1': { architect: 'high', coder: 'high' },
      'julius-diag-digest-evidence-1': { architect: 'high', coder: 'high' },
    };
    const names = readdirSync(MISSIONS).sort();
    let seen = 0;
    const effortSeen: string[] = [];
    for (const name of names) {
      const file = join(MISSIONS, name, 'contract.json');
      if (!existsSync(file)) continue;
      const limits = (JSON.parse(readFileSync(file, 'utf8')) as { limits?: Record<string, unknown> }).limits ?? {};
      expect(Object.keys(limits).filter((key) => !(JULIUS_LIMITS_KEYS as readonly string[]).includes(key)), `${name}: unknown limits keys`).toEqual([]);
      expect('coderSelfTestCalls' in limits, `${name}: no contract may declare the coder self-test yet (ruling A on PR #371)`).toBe(false);
      const expected = EFFORT_MISSIONS[name];
      if (expected !== undefined) {
        expect(limits.architectEffort, `${name}: architect effort`).toBe(expected.architect);
        expect(limits.coderEffort, `${name}: coder effort`).toBe(expected.coder);
        effortSeen.push(name);
      } else {
        expect('architectEffort' in limits || 'coderEffort' in limits, `${name}: only ${Object.keys(EFFORT_MISSIONS).join(' and ')} may declare an effort`).toBe(false);
      }
      seen += 1;
    }
    expect(seen).toBeGreaterThanOrEqual(16);
    expect(effortSeen.sort(), 'each named mission that exists declares its effort').toEqual(Object.keys(EFFORT_MISSIONS).filter((name) => existsSync(join(MISSIONS, name))).sort());
  });
});

describe('the contract checker (the gate every paid dispatch passes)', () => {
  let scratch = '';
  beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), 'julius-effort-check-')); });
  afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });
  const check = (raw: string): { code: number; output: string } => {
    const file = join(scratch, `contract-${Math.random().toString(16).slice(2)}.json`);
    writeFileSync(file, raw);
    try {
      return { code: 0, output: execFileSync(process.execPath, [CHECKER, file], { encoding: 'utf8', cwd: ROOT }) };
    } catch (error) {
      const failed = error as { status: number; stdout: string };
      return { code: failed.status, output: failed.stdout };
    }
  };

  it('an unchanged contract passes and prints no effort line, so its output is what it always was', () => {
    const result = check(JSON.stringify(rawMission2()));
    expect(result.code).toBe(0);
    expect(result.output).not.toMatch(/effort/u);
  });

  it('a declared level passes and is echoed for the person reading the preflight', () => {
    const result = check(withLimits({ architectEffort: 'high', coderEffort: 'low' }));
    expect(result.code).toBe(0);
    expect(result.output).toContain('architect effort: high');
    expect(result.output).toContain('coder effort: low');
  });

  it('a bad level is refused, and so is a limit this build does not read', () => {
    const bad = check(withLimits({ coderEffort: 'extreme' }));
    expect(bad.code).toBe(1);
    expect(bad.output).toContain('limits.coderEffort must be one of low, medium, high, xhigh, max');
    const unknown = check(withLimits({ coderTurnCeiling: 40 }));
    expect(unknown.code).toBe(1);
    expect(unknown.output).toContain('limits.coderTurnCeiling is not a limit this build reads');
  });
});

/* ------------------------------------------------------------ the architect's request */

const created = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('openai', () => ({
  default: class {
    responses = {
      create: async (params: Record<string, unknown>) => { created.push(params); throw new Error('stop after capture'); },
    };
  },
}));

describe('the architect request body', () => {
  const ask = async (effort?: ArchitectReasoningEffort): Promise<Record<string, unknown>> => {
    created.length = 0;
    await runGptArchitect({
      apiKey: 'FAKETESTNOTREAL', instructions: 'plan it', input: 'the packet',
      config: { liveMode: true, model: 'gpt-5.6-sol', maxOutputTokens: 4_000, timeoutMs: 60_000, ...(effort === undefined ? {} : { reasoningEffort: effort }) } as never,
    });
    expect(created).toHaveLength(1);
    return created[0];
  };

  it('absent: no reasoning field at all, and the body is exactly the one sent before this field existed', async () => {
    const body = await ask();
    expect('reasoning' in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual(['input', 'instructions', 'max_output_tokens', 'model', 'store', 'text']);
  });

  it('declared: reasoning.effort is that level, and nothing else in the body moves', async () => {
    const plain = await ask();
    for (const level of JULIUS_ROLE_EFFORT_LEVELS) {
      const body = await ask(level);
      expect(body.reasoning).toEqual({ effort: level });
      const { reasoning: _reasoning, ...rest } = body;
      expect(rest).toEqual(plain);
    }
  });
});

/* ------------------------------------------------------------ the coder's SDK options */

const WS = '/data/relay-workspaces/prj/run-1';
const clock = () => { let n = 0; return () => new Date(Date.UTC(2026, 9, 18, 12, 0, n++)).toISOString(); };
const messages = [
  { type: 'system', subtype: 'init', model: 'claude-sonnet-5-20260114', claude_code_version: '2.1.220', apiKeySource: 'ANTHROPIC_API_KEY', cwd: WS, tools: ['Read', 'Glob', 'Grep', 'Edit'] },
  { type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 2, duration_ms: 1200, total_cost_usd: 0.01, usage: { input_tokens: 500, output_tokens: 60 }, permission_denials: [] },
];

describe('the coder SDK options', () => {
  const optionsFor = async (effort?: HostedEffort): Promise<Record<string, unknown>> => {
    let seen: Record<string, unknown> = {};
    const fn: HostedQueryFn = (params) => { seen = params.options; return (async function* () { for (const m of messages) yield m; })(); };
    await runHostedCodingAgent({
      queryFn: fn, prompt: 'implement it', workspacePath: WS, apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-sonnet-5', now: clock(),
      ...(effort === undefined ? {} : { effort }),
    });
    return seen;
  };

  it('absent: no effort option; declared: exactly that level, with every other option unchanged', async () => {
    const plain = await optionsFor();
    expect('effort' in plain).toBe(false);
    for (const level of JULIUS_ROLE_EFFORT_LEVELS) {
      const options = await optionsFor(level);
      expect(options.effort).toBe(level);
      expect(Object.keys(options).filter((key) => key !== 'effort').sort()).toEqual(Object.keys(plain).sort());
      expect(options.allowedTools).toEqual(plain.allowedTools);
      expect(options.disallowedTools).toEqual(plain.disallowedTools);
      expect(options.maxTurns).toBe(plain.maxTurns);
    }
  });
});

/* ------------------------------------------------------------ end to end */

const BASE: Record<string, string> = Object.freeze({
  OPENAI_API_KEY: 'FAKETESTNOTREAL-openai',
  OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-5.6-sol',
  RELAY_PROMPT_ARCHITECT_MODE: 'live',
  RELAY_HOSTED_CODING_MODEL: 'claude-fable-5',
  RELAY_HERMES_PROVIDER: 'xai',
  RELAY_HERMES_MODEL: 'grok-build-0.1',
  RELAY_HERMES_EXECUTABLE: '/usr/bin/true',
  [HOSTED_API_KEY_ENV]: 'FAKETESTNOTREAL-configured',
});

describe('from the contract field to the provider call', () => {
  let scratch = '';
  let workspace = '';
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'julius-effort-e2e-'));
    workspace = join(scratch, 'workspace');
    mkdirSync(workspace);
  });
  afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });

  const declared = (extra: Record<string, unknown>) => {
    const parsed = parseLiveMissionContract(withLimits(extra));
    if (!parsed.ok) throw new Error(parsed.problem);
    return parsed.contract.limits!;
  };

  it('the architect runner is handed the level the contract declared, and none when it declared none', async () => {
    const planSnapshot = (): JuliusContextSnapshot => ({
      contextId: 'ctx-1', runId: 'run:new', taskId: 'run:new:plan', workerId: 'prompt-architect-openai', workerRole: 'PROMPT_ARCHITECT',
      compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-1', projectBrainRevision: 0,
      taskContractRevision: null, taskContractDigest: null, sourceEntryIds: ['run:new:objective'], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
      acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:test', integrityVersion: null, integrityConflicts: null, integrityExcludedEntryIds: null,
      integrityEvictedEntryIds: null, characterCount: 20, redactionCount: 0, truncated: false,
      packet: { missionId: 'mission-1', taskId: 'run:new:plan', workerId: 'prompt-architect-openai', sourceEntryIds: ['run:new:objective'], blocks: [{ kind: 'CONSTRAINT', text: 'OBJECTIVE: plan.' }], truncated: false },
    });
    const effortSeenBy = async (limits: ReturnType<typeof declared>): Promise<unknown> => {
      const configs: Record<string, unknown>[] = [];
      const resolution = resolveLiveWorkers({
        env: BASE, projectId: 'prj-effort', workspacePath: workspace, testCommand: 'npm test',
        contexts: { snapshotFor: () => planSnapshot() }, artifacts: createInMemoryArtifactExchange(), shell: createFakeExecutorShell({}),
        architectMaxOutputTokens: limits.architectMaxOutputTokens,
        architectEffort: limits.architectEffort, coderEffort: limits.coderEffort,
        runners: { architect: (async (request: { config: Record<string, unknown> }) => { configs.push(request.config); return { ok: false, failureClass: 'refused', message: 'scripted' }; }) as never },
      });
      const architect = resolution.entries.find((entry) => entry.worker.role === 'PROMPT_ARCHITECT');
      expect(architect, 'the architect must resolve').toBeDefined();
      await architect!.adapter.dispatch({ taskId: 'run:new:plan', attempt: { leaseGeneration: 1 }, contextId: 'ctx-1', taskType: 'plan' } as never).then(() => null, () => null);
      expect(configs).toHaveLength(1);
      return configs[0].reasoningEffort;
    };
    expect(await effortSeenBy(declared({}))).toBeUndefined();
    expect(await effortSeenBy(declared({ architectEffort: 'high' }))).toBe('high');
    expect(await effortSeenBy(declared({ architectEffort: 'max', architectMaxOutputTokens: 8_000 }))).toBe('max');
    // the coder's level must not leak into the architect's config
    expect(await effortSeenBy(declared({ coderEffort: 'low' }))).toBeUndefined();
  });

  it('the coder child process is started with --effort <level> when declared, and with no --effort flag when not', async () => {
    const FAKE_CHILD = [
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync(new URL('./child-argv.json', import.meta.url), JSON.stringify(process.argv.slice(2)));",
      'process.exit(1);',
      '',
    ].join('\n');
    writeFileSync(join(scratch, 'fake-claude.mjs'), FAKE_CHILD);
    const snapshot = (): JuliusContextSnapshot => ({
      contextId: 'ctx-1', runId: 'run-live', taskId: 'build-1', workerId: CODER_WORKER.workerId, workerRole: 'CODING_AGENT',
      compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-1', projectBrainRevision: 3,
      taskContractRevision: 2, taskContractDigest: `sha256:${'b'.repeat(64)}`, sourceEntryIds: ['brain:objective'], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
      acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:test', characterCount: 40, redactionCount: 0, truncated: false,
      integrityVersion: null, integrityConflicts: null, integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
      packet: { missionId: 'mission-1', taskId: 'build-1', workerId: CODER_WORKER.workerId, sourceEntryIds: ['brain:objective'], blocks: [{ kind: 'OBJECTIVE', text: 'OBJECTIVE: normalize.' }], truncated: false },
    });
    const charge = {
      stage: 'build' as const,
      binding: { contractId: 'contract:run-live:build-1', taskId: 'build-1', contractRevision: 2, bindingDigest: `sha256:${'b'.repeat(64)}` },
      objective: 'Normalize the mission label.', responsibilityBoundary: 'Only the slug module.',
      inScope: ['src/slug.ts'], outOfScope: ['src/persistence/'], permittedPaths: ['src/slug.ts'],
      prohibitedActions: ['adding a dependency'], blockingCriteria: ['[AC-1] The slug test passes.'], contractReviewCriteria: ['AC-1 holds'],
      requiredEvidence: ['TEST'] as const, requiredChecks: ['npm test'], failureConditions: ['AC-1 fails'], stoppingCondition: 'The suite is green.',
    };
    const dispatch = { taskId: 'build-1', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contextId: 'ctx-1', taskType: 'build', contract: charge, allocation: { usdMicros: 2_000_000, policyVersion: 'v3', basis: 'CODER_SHARE' } };
    const argvFor = async (limits: ReturnType<typeof declared>): Promise<string[]> => {
      rmSync(join(scratch, 'child-argv.json'), { force: true });
      const artifacts = createInMemoryArtifactExchange();
      artifacts.seed({ kind: 'PLAN', runId: 'run-live', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, JSON.stringify({ objectiveSummary: 'Normalize.', steps: ['edit'] }));
      const resolution = resolveLiveWorkers({
        env: BASE, projectId: 'prj-effort', workspacePath: workspace, testCommand: 'npm test',
        contexts: { snapshotFor: () => snapshot() }, artifacts, shell: createFakeExecutorShell({}),
        architectEffort: limits.architectEffort, coderEffort: limits.coderEffort,
        runners: {
          queryLoader: async () => (params) => realSdkQuery({
            ...params, options: { ...params.options, pathToClaudeCodeExecutable: join(scratch, 'fake-claude.mjs') },
          } as Parameters<typeof realSdkQuery>[0]) as AsyncIterable<unknown>,
        },
      });
      const coder = resolution.entries.find((entry) => entry.worker.role === 'CODING_AGENT');
      expect(coder, 'the coder must resolve').toBeDefined();
      await coder!.adapter.dispatch(dispatch as never).then(() => null, () => null);
      const file = join(scratch, 'child-argv.json');
      expect(existsSync(file), 'the SDK must actually have started the child').toBe(true);
      return JSON.parse(readFileSync(file, 'utf8')) as string[];
    };
    const plain = await argvFor(declared({}));
    expect(plain).not.toContain('--effort');
    const high = await argvFor(declared({ coderEffort: 'high' }));
    expect(high[high.indexOf('--effort') + 1]).toBe('high');
    expect(high.filter((arg) => arg === '--effort')).toHaveLength(1);
    // the architect's level never reaches the coder
    expect(await argvFor(declared({ architectEffort: 'max' }))).not.toContain('--effort');
  }, 120_000);
});

describe('the entrypoint hands both levels to the composition at BOTH of its call sites', () => {
  // Structural, and named as such: the entrypoint needs a database and an executor to run, so what can be proven offline
  // is that each place it resolves the workers (the preflight and the confirmed run) passes both fields from the contract.
  it('the preflight resolution and the confirmed-run resolution both carry architectEffort and coderEffort', () => {
    const entry = readFileSync(join(ROOT, 'relay-bridge', 'julius-live-mission.ts'), 'utf8');
    expect(entry.match(/resolveLiveWorkers\(\{/gu)).toHaveLength(2);
    // all THREE controls, at BOTH sites: a prefix match let the self-test cap be dropped from one site unnoticed (mutants S30, S31)
    expect(entry.match(/architectEffort: contract\.limits\?\.architectEffort, coderEffort: contract\.limits\?\.coderEffort, coderSelfTestCalls: contract\.limits\?\.coderSelfTestCalls,/gu)).toHaveLength(2);
  });
});

/* ------------------------------------------------------------ limits.coderSelfTestCalls (diagnostic telemetry) */

describe('limits.coderSelfTestCalls: declared by the contract, bounded, inside the binding', () => {
  it('1 to 4 parse; anything else is refused with a reason naming the key', () => {
    for (const ok of [1, 2, 3, 4]) {
      const parsed = parseLiveMissionContract(withLimits({ coderSelfTestCalls: ok }));
      expect(parsed.ok && parsed.contract.limits?.coderSelfTestCalls, String(ok)).toBe(ok);
    }
    for (const bad of [0, 5, -1, 2.5, '2', null, true, Number.NaN]) {
      const parsed = parseLiveMissionContract(withLimits({ coderSelfTestCalls: bad }));
      expect(parsed.ok, String(bad)).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toContain('limits.coderSelfTestCalls');
    }
  });

  it('absent is today (the control digest), and a declared cap changes the digest, each cap again', () => {
    expect(digestOf(JSON.stringify(rawMission2()))).toBe(MISSION_2_DIGEST_BEFORE);
    const digests = [1, 2, 3].map((calls) => digestOf(withLimits({ coderSelfTestCalls: calls })));
    expect(new Set([MISSION_2_DIGEST_BEFORE, ...digests]).size).toBe(4);
  });

  it('the checker echoes a valid cap, refuses an invalid one, and prints nothing about it when absent', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'julius-selftest-check-'));
    try {
      const check = (raw: string): { code: number; output: string } => {
        const file = join(scratch, `contract-${Math.random().toString(16).slice(2)}.json`);
        writeFileSync(file, raw);
        try { return { code: 0, output: execFileSync(process.execPath, [CHECKER, file], { encoding: 'utf8', cwd: ROOT }) }; } catch (error) {
          const failed = error as { status: number; stdout: string };
          return { code: failed.status, output: failed.stdout };
        }
      };
      const valid = check(withLimits({ coderSelfTestCalls: 3 }));
      expect(valid.code).toBe(0);
      expect(valid.output).toContain('coder self-tests (diagnostic telemetry only): up to 3');
      const invalid = check(withLimits({ coderSelfTestCalls: 9 }));
      expect(invalid.code).toBe(1);
      expect(invalid.output).toContain('limits.coderSelfTestCalls must be an integer from 1 to 4');
      expect(check(JSON.stringify(rawMission2())).output).not.toMatch(/self-test/u);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
});

describe('from the contract field to the coder child process: the self-test tool is allowed and the server configured ONLY when declared', () => {
  let scratch = '';
  let workspace = '';
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'julius-selftest-e2e-'));
    workspace = join(scratch, 'workspace');
    mkdirSync(workspace);
    // The child records its argv AND the first thing the SDK writes to its stdin (the control-channel initialize, which is where
    // an SDK-hosted MCP server is registered), then exits before speaking the protocol: no provider is contacted.
    writeFileSync(join(scratch, 'fake-claude.mjs'), [
      "import { writeFileSync } from 'node:fs';",
      'let data = ""; let done = false;',
      'const finish = () => {',
      '  if (done) return; done = true;',
      "  writeFileSync(new URL('./child-argv.json', import.meta.url), JSON.stringify(process.argv.slice(2)));",
      "  writeFileSync(new URL('./child-stdin.txt', import.meta.url), data);",
      '  process.exit(1);',
      '};',
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { data += chunk; if (data.includes(String.fromCharCode(10))) setTimeout(finish, 50); });",
      'setTimeout(finish, 3000);',
      '',
    ].join(String.fromCharCode(10)));
  });
  afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });

  const charge = {
    stage: 'build' as const,
    binding: { contractId: 'contract:run-live:build-1', taskId: 'build-1', contractRevision: 2, bindingDigest: `sha256:${'b'.repeat(64)}` },
    objective: 'Normalize the mission label.', responsibilityBoundary: 'Only the slug module.',
    inScope: ['src/slug.ts'], outOfScope: ['src/persistence/'], permittedPaths: ['src/slug.ts'],
    prohibitedActions: ['adding a dependency'], blockingCriteria: ['[AC-1] The slug test passes.'], contractReviewCriteria: ['AC-1 holds'],
    requiredEvidence: ['TEST'] as const, requiredChecks: ['npm test'], failureConditions: ['AC-1 fails'], stoppingCondition: 'The suite is green.',
  };
  const snapshot = (): JuliusContextSnapshot => ({
    contextId: 'ctx-1', runId: 'run-live', taskId: 'build-1', workerId: CODER_WORKER.workerId, workerRole: 'CODING_AGENT',
    compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-1', projectBrainRevision: 3,
    taskContractRevision: 2, taskContractDigest: charge.binding.bindingDigest, sourceEntryIds: ['brain:objective'], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
    acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:test', characterCount: 40, redactionCount: 0, truncated: false,
    integrityVersion: null, integrityConflicts: null, integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
    packet: { missionId: 'mission-1', taskId: 'build-1', workerId: CODER_WORKER.workerId, sourceEntryIds: ['brain:objective'], blocks: [{ kind: 'OBJECTIVE', text: 'OBJECTIVE: normalize.' }], truncated: false },
  });
  const dispatch = { taskId: 'build-1', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } }, contextId: 'ctx-1', taskType: 'build', contract: charge, allocation: { usdMicros: 2_000_000, policyVersion: 'v3', basis: 'CODER_SHARE' } };

  const argvFor = async (limits: { coderSelfTestCalls?: number }): Promise<{ argv: string[]; stdin: string }> => {
    rmSync(join(scratch, 'child-argv.json'), { force: true });
    rmSync(join(scratch, 'child-stdin.txt'), { force: true });
    const artifacts = createInMemoryArtifactExchange();
    artifacts.seed({ kind: 'PLAN', runId: 'run-live', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, JSON.stringify({ objectiveSummary: 'Normalize.', steps: ['edit'] }));
    const resolution = resolveLiveWorkers({
      env: BASE, projectId: 'prj-selftest', workspacePath: workspace, testCommand: 'npm test',
      contexts: { snapshotFor: () => snapshot() }, artifacts, shell: createFakeExecutorShell({}),
      coderSelfTestCalls: limits.coderSelfTestCalls,
      runners: {
        queryLoader: async () => (params) => realSdkQuery({
          ...params, options: { ...params.options, pathToClaudeCodeExecutable: join(scratch, 'fake-claude.mjs') },
        } as Parameters<typeof realSdkQuery>[0]) as AsyncIterable<unknown>,
        // the REAL SDK helpers, imported statically: vitest cannot service the runner's indirect import()
        sdkHelpersLoader: async () => ({ createSdkMcpServer, tool: realSdkTool }) as never,
      },
    });
    const coder = resolution.entries.find((entry) => entry.worker.role === 'CODING_AGENT');
    expect(coder, 'the coder must resolve').toBeDefined();
    await coder!.adapter.dispatch(dispatch as never).then(() => null, () => null);
    const file = join(scratch, 'child-argv.json');
    expect(existsSync(file), 'the SDK must actually have started the child').toBe(true);
    const stdinFile = join(scratch, 'child-stdin.txt');
    return { argv: JSON.parse(readFileSync(file, 'utf8')) as string[], stdin: existsSync(stdinFile) ? readFileSync(stdinFile, 'utf8') : '' };
  };
  const flagValue = (argv: string[], flag: string): string => argv[argv.indexOf(flag) + 1] ?? '';

  it('absent: the allowed tools are the file tools alone and the child is told of no SDK server', async () => {
    const { argv, stdin } = await argvFor({});
    expect(flagValue(argv, '--allowedTools')).toBe('Read,Glob,Grep,Edit');
    expect(argv.join(' ')).not.toContain('run_mission_test');
    expect(stdin).not.toContain('run_mission_test');
    expect(stdin).not.toContain('sdkMcpServers');
  });

  it('declared: exactly the one sanctioned tool id is added to the allowed tools, and the child is told of the julius SDK server', async () => {
    const { argv, stdin } = await argvFor({ coderSelfTestCalls: 2 });
    expect(flagValue(argv, '--allowedTools')).toBe('Read,Glob,Grep,Edit,mcp__julius__run_mission_test');
    // the disallowed list is untouched: Bash still cannot be used
    expect(flagValue(argv, '--disallowedTools')).toContain('Bash');
    // the SDK registers an SDK-hosted server over the control channel, not on argv
    expect(stdin, 'the control-channel initialize names the server').toMatch(/sdkMcpServers.{0,40}julius/u);
  }, 120_000);
});
