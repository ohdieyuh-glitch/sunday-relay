import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query as realSdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JULIUS_CONTEXT_COMPILER_VERSION, JuliusDispatchError, type JuliusContextSnapshot } from '../../src/relay/mission/julius';
import { classifyClaudeAuth } from '../../src/relay/connectors/claude-code/capability-probe';
import {
  ANTHROPIC_CREDENTIAL_ENV_NAMES, JULIUS_CLAUDE_AUTH_ENV, decideClaudeAuth,
} from '../hosted-coding-agent/hosted-auth';
import { HOSTED_API_KEY_ENV } from '../hosted-coding-agent/hosted-readiness';
import type { HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import { createFakeExecutorShell } from './coding-agent-fixtures';
import { CODER_WORKER, resolveLiveWorkers } from './live-composition';
import { createLiveArtifactExchange, planRef } from './live-workers';

/**
 * THE CODING AGENT'S CHILD PROCESS RECEIVES EXACTLY THE ENVIRONMENT JULIUS COMPOSED.
 *
 * The earlier guard for this read four source files and checked that each hop
 * named `authMode`. That is the check a dropped hop defeats: before the field was
 * declared on every hop, the mode typechecked, compiled, and was discarded one call
 * before the invoker — and a grep for the forwarding line would still have passed.
 * So this proves it the only way that cannot be satisfied by source text: it asks
 * the ACTUAL CHILD PROCESS what it received.
 *
 * WHAT IS REAL. The environment-to-worker composition (`resolveLiveWorkers`), the
 * live Coding Agent adapter, the Claude Code provider, the hosted runner, and the
 * Claude Agent SDK itself — its real `query`, which builds the child's environment
 * and spawns the child. WHAT IS NOT: the executable the SDK spawns. It is pointed at
 * a script that writes down the environment it was started with and exits, so the
 * session never starts and NO PROVIDER IS CONTACTED. The executor is the fake shell,
 * which runs nothing.
 *
 * THE ONE SUBSTITUTION IS NAMED. The SDK is wrapped to add
 * `pathToClaudeCodeExecutable` and nothing else: every option the runner composed —
 * `env` above all — reaches the real SDK untouched.
 */

const BASE: Record<string, string> = Object.freeze({
  OPENAI_API_KEY: 'FAKETESTNOTREAL-openai',
  OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-5.6-sol',
  RELAY_PROMPT_ARCHITECT_MODE: 'live',
  RELAY_HOSTED_CODING_MODEL: 'claude-fable-5',
  RELAY_HERMES_PROVIDER: 'xai',
  RELAY_HERMES_MODEL: 'grok-build-0.1',
  RELAY_HERMES_EXECUTABLE: '/usr/bin/true',
});

/** The key Julius is CONFIGURED with in API mode. Fake, so it may be compared. */
const CONFIGURED_KEY = 'FAKETESTNOTREAL-configured-for-the-child';
/** A key sitting in the PARENT process, which no child may inherit. */
const PARENT_KEY = 'FAKETESTNOTREAL-parent-process-sentinel';
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * The only names the composed child may carry, before the SDK adds its own markers
 * and the platform adds its own.
 *
 * WINDOWS ONLY, AND MEASURED: libuv copies a FIXED list of system variables from
 * the parent into every child it starts, whatever environment it was handed
 * (`make_program_env`'s required list). The first run of this test on Windows
 * found exactly these ten, and it also explains an earlier measurement: adding
 * `USERPROFILE` to the allow-list "changed nothing" because libuv was already
 * supplying it. None is a credential. The list is asserted EXACTLY rather than
 * waved through, so a new name appearing here is a finding. On POSIX — the WSL
 * launch environment and CI — the child receives what it was handed and nothing
 * else.
 */
const COMPOSED_NAMES = [
  'PATH', 'HOME', 'CI', 'NO_COLOR', 'TERM',
  ...(process.platform === 'win32'
    ? ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR']
    : []),
];
/** What the Agent SDK itself adds to the environment it was handed. Its own markers, never credentials. */
const SDK_MARKER = /^CLAUDE_(CODE|AGENT_SDK)_[A-Z0-9_]+$/u;

/**
 * The child. It records the NAMES in its environment, a digest of an Anthropic key
 * if one is present (never the value), and exits non-zero before speaking a word of
 * the SDK's protocol — so the session is a launch failure and nothing is dispatched.
 */
const FAKE_CHILD = [
  "import { writeFileSync } from 'node:fs';",
  "import { createHash } from 'node:crypto';",
  'const key = process.env.ANTHROPIC_API_KEY;',
  "writeFileSync(new URL('./child-env.json', import.meta.url), JSON.stringify({",
  '  names: Object.keys(process.env).sort(),',
  "  anthropicKeySha256: key === undefined ? null : createHash('sha256').update(key).digest('hex'),",
  "  oauthTokenSha256: process.env.CLAUDE_CODE_OAUTH_TOKEN === undefined ? null : createHash('sha256').update(process.env.CLAUDE_CODE_OAUTH_TOKEN).digest('hex'),",
  '}));',
  'process.exit(1);',
  '',
].join('\n');

interface ChildRecord { readonly names: readonly string[]; readonly anthropicKeySha256: string | null; readonly oauthTokenSha256: string | null }

const CHARGE = Object.freeze({
  stage: 'build' as const,
  binding: { contractId: 'contract:run-live:build-1', taskId: 'build-1', contractRevision: 2, bindingDigest: `sha256:${'b'.repeat(64)}` },
  objective: 'Normalize the mission label.', responsibilityBoundary: 'Only the slug module.',
  inScope: ['src/slug.ts'], outOfScope: ['src/persistence/'], permittedPaths: ['src/slug.ts'],
  prohibitedActions: ['adding a dependency'], blockingCriteria: ['[AC-1] The slug test passes.'], contractReviewCriteria: ['AC-1 holds'],
  requiredEvidence: ['TEST'] as const, requiredChecks: ['npm test'], failureConditions: ['AC-1 fails'],
  stoppingCondition: 'The suite is green.',
});
const snapshot = (): JuliusContextSnapshot => ({
  contextId: 'ctx-1', runId: 'run-live', taskId: 'build-1', workerId: CODER_WORKER.workerId, workerRole: 'CODING_AGENT',
  compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-1', projectBrainRevision: 3,
  taskContractRevision: 2, taskContractDigest: CHARGE.binding.bindingDigest,
  sourceEntryIds: ['brain:objective'], dependencyTaskIds: [], evidenceIds: [], findingIds: [], acceptanceCriterionIds: ['AC-1'],
  contentHash: 'sha256:test', characterCount: 40, redactionCount: 0, truncated: false,
  integrityVersion: null, integrityConflicts: null, integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
  packet: {
    missionId: 'mission-1', taskId: 'build-1', workerId: CODER_WORKER.workerId, sourceEntryIds: ['brain:objective'],
    blocks: [{ kind: 'OBJECTIVE', text: 'OBJECTIVE: normalize the mission label.' }], truncated: false,
  },
});
const DISPATCH = { taskId: 'build-1', contextId: 'ctx-1', taskType: 'build', contract: CHARGE, allocation: { usdMicros: 2_000_000, policyVersion: 'v3', basis: 'CODER_SHARE' } };

let scratch = '';
/**
 * A REAL directory. The SDK starts the child with the workspace as its working
 * directory, and a path that does not exist fails the spawn itself — which would
 * make every assertion below about a child that was never started.
 */
let workspace = '';
let parentKey: string | undefined;
let parentToken: string | undefined;
beforeEach(() => {
  parentToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  scratch = mkdtempSync(join(tmpdir(), 'julius-child-env-'));
  workspace = join(scratch, 'workspace');
  mkdirSync(workspace);
  writeFileSync(join(scratch, 'fake-claude.mjs'), FAKE_CHILD);
  parentKey = process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  if (parentKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = parentKey;
  if (parentToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = parentToken;
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * The REAL Agent SDK, with one option added: which executable it spawns.
 *
 * Imported statically here rather than through `loadHostedQuery`, whose indirect
 * `import()` exists so esbuild cannot bundle the SDK and which vitest's module
 * runner cannot service. The function is the same `query` production loads; only
 * how the test obtains it differs, and the loader is not what is under test.
 */
const realSdkSpawning = (executable: string, calls: { count: number }) => async (): Promise<HostedQueryFn> => {
  calls.count += 1;
  return (params) => realSdkQuery({
    ...params, options: { ...params.options, pathToClaudeCodeExecutable: executable },
  } as Parameters<typeof realSdkQuery>[0]) as AsyncIterable<unknown>;
};

/**
 * Compose from `env`, dispatch the Coding Agent once, and return what its child
 * process received — or null when no child was ever started.
 */
async function dispatchAndInspect(env: Record<string, string>): Promise<{
  readonly child: ChildRecord | null;
  readonly failure: JuliusDispatchError | null;
  readonly problems: ReturnType<typeof resolveLiveWorkers>['problems'];
  readonly loaderCalls: number;
  readonly providerId: string | null;
}> {
  const artifacts = createLiveArtifactExchange();
  artifacts.put(planRef('run-live'), JSON.stringify({ objectiveSummary: 'Normalize.', steps: ['edit'] }));
  const calls = { count: 0 };
  const resolution = resolveLiveWorkers({
    env, projectId: 'prj-child-env', workspacePath: workspace, testCommand: 'npm test',
    contexts: { snapshotFor: () => snapshot() }, artifacts,
    shell: createFakeExecutorShell({}),
    runners: { queryLoader: realSdkSpawning(join(scratch, 'fake-claude.mjs'), calls) },
  });
  const coder = resolution.entries.find((entry) => entry.worker.role === 'CODING_AGENT');
  let failure: JuliusDispatchError | null = null;
  if (coder !== undefined) {
    const settled = await coder.adapter.dispatch(DISPATCH as never).then(() => null, (error: unknown) => error);
    expect(settled, 'the fake child exits before the session starts, so the dispatch must fail').toBeInstanceOf(JuliusDispatchError);
    failure = settled as JuliusDispatchError;
  }
  const recordPath = join(scratch, 'child-env.json');
  return {
    child: existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) as ChildRecord : null,
    failure, problems: resolution.problems, loaderCalls: calls.count,
    providerId: coder?.worker.providerId ?? null,
  };
}

describe('CLAUDE_SUBSCRIPTION: the actual child process carries no Anthropic credential', () => {
  it('the mode reaches the invoker, the child has no key even with one in the parent, and nothing is rewritten to API mode', async () => {
    // A key in the PARENT process. The child is built from `{}` and must not inherit it.
    process.env.ANTHROPIC_API_KEY = PARENT_KEY;
    const seen = await dispatchAndInspect({ ...BASE, [JULIUS_CLAUDE_AUTH_ENV]: 'CLAUDE_SUBSCRIPTION' });

    expect(seen.child, 'the SDK must actually have spawned the child').not.toBeNull();
    const names = seen.child!.names;
    expect(names).not.toContain('ANTHROPIC_API_KEY');
    for (const credential of ANTHROPIC_CREDENTIAL_ENV_NAMES) {
      expect(names, `${credential} would take the child off the subscription path`).not.toContain(credential);
    }
    expect(names.filter((name) => name.startsWith('ANTHROPIC_')), 'no Anthropic variable of any kind').toEqual([]);
    expect(seen.child!.anthropicKeySha256).toBeNull();
    // EXACTLY the composed allow-list, plus the SDK's own markers — nothing from the parent.
    expect(names.filter((name) => !COMPOSED_NAMES.includes(name) && !SDK_MARKER.test(name)), 'no inherited variable').toEqual([]);
    expect(names).toContain('PATH');

    // PROVIDER AND RUNTIME ARE UNCHANGED BY THE MODE.
    expect(seen.providerId).toBe('anthropic');
    // The SDK stamps its own entrypoint on every child it spawns: this child was
    // started by the Claude Agent SDK, not by anything else.
    expect(names).toContain('CLAUDE_CODE_ENTRYPOINT');
    expect(names).toContain('CLAUDE_AGENT_SDK_VERSION');

    // AND THE MODE REACHED THE PROVIDER, observed on the record it wrote — a second,
    // independent reading from the one the child gave.
    const diagnostics = seen.failure!.diagnostics!;
    expect(diagnostics.provider).toBe('anthropic');
    expect(diagnostics.billingPath, 'subscription mode was not silently rewritten to API mode').toBe('SUBSCRIPTION');
    expect(diagnostics.costBasis).toBe('NOT_APPLICABLE');
    expect(diagnostics.costUsdMicros).toBeNull();
    expect(seen.loaderCalls).toBe(1);
  });
});

/**
 * THE SETUP-TOKEN PATH, ASKED OF THE ACTUAL CHILD. A GitHub runner holds the founder's
 * subscription as `CLAUDE_CODE_OAUTH_TOKEN` in the parent process; the runner passes it
 * to `hostedChildEnv`, which admits it under CLAUDE_SUBSCRIPTION only. Note the SDK
 * marker pattern above would also match `CLAUDE_CODE_OAUTH_TOKEN`, so its presence and
 * absence are asserted by name and by digest rather than left to the "no inherited
 * variable" filter.
 */
const PARENT_TOKEN = 'FAKETESTNOTREAL-oauth-token-in-the-parent';

describe('CLAUDE_SUBSCRIPTION with a setup-token token: the child carries the token and nothing Anthropic', () => {
  it('token in the parent, subscription mode: the child holds exactly that token, no key, and bills SUBSCRIPTION', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = PARENT_TOKEN;
    process.env.ANTHROPIC_API_KEY = PARENT_KEY;
    const seen = await dispatchAndInspect({ ...BASE, [JULIUS_CLAUDE_AUTH_ENV]: 'CLAUDE_SUBSCRIPTION' });
    expect(seen.child, 'the SDK must actually have spawned the child').not.toBeNull();
    const names = seen.child!.names;
    expect(names).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(seen.child!.oauthTokenSha256, 'the token the parent held, by digest').toBe(sha256(PARENT_TOKEN));
    for (const credential of ANTHROPIC_CREDENTIAL_ENV_NAMES) expect(names, credential).not.toContain(credential);
    expect(seen.child!.anthropicKeySha256).toBeNull();
    expect(names.filter((name) => !COMPOSED_NAMES.includes(name) && !SDK_MARKER.test(name)), 'no inherited variable').toEqual([]);
    const diagnostics = seen.failure!.diagnostics!;
    expect(diagnostics.billingPath).toBe('SUBSCRIPTION');
    expect(diagnostics.costBasis).toBe('NOT_APPLICABLE');
    expect(diagnostics.costUsdMicros, 'null, never a fabricated 0').toBeNull();
    expect(JSON.stringify(diagnostics), 'no diagnostic carries the token value').not.toContain(PARENT_TOKEN);
    expect(JSON.stringify(seen.failure!.message ?? '')).not.toContain(PARENT_TOKEN);
  });

  it('token in the parent, API mode: the child carries the configured key and NOT the token', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = PARENT_TOKEN;
    const seen = await dispatchAndInspect({ ...BASE, [HOSTED_API_KEY_ENV]: CONFIGURED_KEY });
    expect(seen.child).not.toBeNull();
    expect(seen.child!.names).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(seen.child!.oauthTokenSha256).toBeNull();
    expect(seen.child!.anthropicKeySha256).toBe(sha256(CONFIGURED_KEY));
    expect(seen.failure!.diagnostics!.billingPath).toBe('API_BILLED');
  });
});

describe('ANTHROPIC_API: the key reaches the child only when API mode is chosen', () => {
  for (const [label, env] of [
    ['mode absent (the default, unchanged)', { ...BASE, [HOSTED_API_KEY_ENV]: CONFIGURED_KEY }],
    ['mode named explicitly', { ...BASE, [HOSTED_API_KEY_ENV]: CONFIGURED_KEY, [JULIUS_CLAUDE_AUTH_ENV]: 'ANTHROPIC_API' }],
  ] as const) {
    it(`${label}: the child carries the CONFIGURED key, never the parent's`, async () => {
      process.env.ANTHROPIC_API_KEY = PARENT_KEY;
      const seen = await dispatchAndInspect(env);
      expect(seen.child, 'the SDK must actually have spawned the child').not.toBeNull();
      expect(seen.child!.names).toContain('ANTHROPIC_API_KEY');
      // Compared by digest, and both sides are test fakes.
      expect(seen.child!.anthropicKeySha256, 'the key Julius was configured with').toBe(sha256(CONFIGURED_KEY));
      expect(seen.child!.anthropicKeySha256, 'and not one the parent happened to hold').not.toBe(sha256(PARENT_KEY));
      expect(seen.child!.names.filter((name) => !COMPOSED_NAMES.includes(name) && !SDK_MARKER.test(name) && name !== 'ANTHROPIC_API_KEY'))
        .toEqual([]);
      expect(seen.failure!.diagnostics!.billingPath).toBe('API_BILLED');
    });
  }
});

describe('an unknown mode fails closed before any child exists', () => {
  it('a misspelled mode resolves no Coding Agent, loads no SDK and spawns nothing', async () => {
    process.env.ANTHROPIC_API_KEY = PARENT_KEY;
    const seen = await dispatchAndInspect({ ...BASE, [JULIUS_CLAUDE_AUTH_ENV]: 'subscription' });
    const coder = seen.problems.find((problem) => problem.role === 'CODING_AGENT');
    expect(coder, 'the Coding Agent must be refused, not defaulted to API mode').toBeDefined();
    expect(coder!.missing.join(' ')).toContain('auth_mode_unknown');
    expect(seen.loaderCalls).toBe(0);
    expect(seen.child, 'no child process was ever started').toBeNull();
  });
});

describe('the Max login is classified separately, and cannot excuse a key the child would carry', () => {
  /**
   * `claude auth status` answers "claude.ai / firstParty" even with a key present
   * — measured 2026-09-28 — so it cannot be the authority on what a request would
   * bill. The authority is the child's environment, observed above. The login
   * probe answers the other question: whether a first-party subscription exists.
   * Here the decision is made over the names a REAL child was actually given.
   */
  const MAX_LOGIN = { loggedIn: true, sourceClass: 'local_subscription', subscriptionLabel: 'max' } as const;

  it('the observed subscription child plus a Max login is SUBSCRIPTION, with no API key and no API cost', async () => {
    const seen = await dispatchAndInspect({ ...BASE, [JULIUS_CLAUDE_AUTH_ENV]: 'CLAUDE_SUBSCRIPTION' });
    const decision = decideClaudeAuth({
      mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false, childEnvNames: seen.child!.names, login: MAX_LOGIN,
    });
    expect(decision).toMatchObject({
      ok: true,
      provenance: {
        provider: 'ANTHROPIC', execution: 'CLAUDE_AGENT_SDK', authentication: 'CLAUDE_SUBSCRIPTION',
        plan: 'max', apiKeyUsed: false, apiCostApplicable: false,
      },
    });
  });

  it('the same Max login cannot excuse the key an API-mode child was observed to carry', async () => {
    const seen = await dispatchAndInspect({ ...BASE, [HOSTED_API_KEY_ENV]: CONFIGURED_KEY });
    const decision = decideClaudeAuth({
      mode: 'CLAUDE_SUBSCRIPTION', apiKeyProvided: false, childEnvNames: seen.child!.names, login: MAX_LOGIN,
    });
    expect(decision).toMatchObject({ ok: false, refusal: 'subscription_would_use_api_key' });
  });

  /**
   * The login probe itself, against a stand-in `claude` that answers `auth status`
   * as the real CLI did on this workstation. The probe runs the executable WITHOUT
   * A SHELL, as production does, and the two platforms answer differently — so
   * each branch asserts what is true of its own:
   *   - POSIX (Linux CI and the WSL launch environment, which is where a
   *     subscription qualification is launched): the stand-in runs, and a
   *     first-party Max login is local_subscription / max, approved;
   *   - Windows: a script cannot be started without a shell, the stand-in never
   *     answers, and the probe must FAIL CLOSED — never approve a live run on a
   *     login it could not observe.
   */
  it('the login probe approves a first-party Max login it observed, and nothing it could not', () => {
    const cli = join(scratch, 'claude');
    writeFileSync(cli, [
      '#!/usr/bin/env node',
      "process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' }));",
      '',
    ].join('\n'));
    chmodSync(cli, 0o755);
    // The probe refuses outright when the PARENT holds a key: that is its own first check.
    delete process.env.ANTHROPIC_API_KEY;
    const classified = classifyClaudeAuth(new Date().toISOString(), cli);
    if (process.platform === 'win32') {
      expect(classified.approvedForLiveRun, 'an unobserved login is never approved').toBe(false);
      expect(classified.sourceClass).not.toBe('local_subscription');
    } else {
      expect(classified).toMatchObject({
        loggedIn: true, sourceClass: 'local_subscription', subscriptionLabel: 'max', approvedForLiveRun: true,
      });
    }
  });
});
