import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOSTED_LIMITS, HOSTED_ALLOWED_TOOLS, HOSTED_CHILD_ENV_KEYS,
  HOSTED_DISALLOWED_TOOLS, compileHostedEnvelope, hostedChildEnv,
  verifyGrantedEnvelope, withinCostCeiling,
} from './hosted-envelope';
import {
  HOSTED_ADAPTER_ID, LOCAL_ADAPTER_ID, probeHostedReadiness,
  runtimePackageFor, sanitizeHostedStatus, surfaceForAdapter,
  type ResolveProbe,
} from './hosted-readiness';
import { hostedStreamIsUsable, observeHostedMessages } from './hosted-observation';

/**
 * Every test here runs offline and makes no provider call. That is the point:
 * the hosted Coding Agent's containment and truthfulness must be provable
 * before a single paid execution happens.
 */

const NOW = '2026-08-02T12:00:00.000Z';
const WS = '/data/relay-workspaces/prj/run-1';

/** A probe where only the named packages resolve. */
const probeWith = (present: readonly string[]): ResolveProbe => ({
  resolve: (id) => {
    if (!present.includes(id)) throw new Error(`Cannot find module '${id}'`);
    return `/node_modules/${id}/package.json`;
  },
  version: (id) => (present.includes(id) ? '0.3.220' : null),
});

const SDK = '@anthropic-ai/claude-agent-sdk';
const READY = [SDK, `${SDK}-linux-x64`];
const READY_ENV = { ANTHROPIC_API_KEY: 'sk-ant-test', RELAY_HOSTED_CODING_MODEL: 'claude-sonnet-5' };

const ready = (over: Partial<Parameters<typeof probeHostedReadiness>[0]> = {}) =>
  probeHostedReadiness({
    env: READY_ENV as NodeJS.ProcessEnv, now: NOW,
    platform: 'linux', arch: 'x64', probe: probeWith(READY), ...over,
  });

describe('the safety envelope', () => {
  it('permits only read and edit tools', () => {
    const envelope = compileHostedEnvelope({ workspacePath: WS });
    expect(envelope.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Edit']);
  });

  it('denies every acting, networking, and agent-spawning tool', () => {
    // Bash is the load-bearing one: a hosted shell could read Railway's
    // environment directly and defeat the credential boundary.
    for (const tool of ['Bash', 'BashOutput', 'KillShell', 'Write', 'WebFetch', 'WebSearch', 'Task']) {
      expect(HOSTED_DISALLOWED_TOOLS).toContain(tool);
    }
    expect(HOSTED_ALLOWED_TOOLS.some((t) => HOSTED_DISALLOWED_TOOLS.includes(t))).toBe(false);
  });

  it('pins the working directory to the disposable workspace', () => {
    expect(compileHostedEnvelope({ workspacePath: WS }).cwd).toBe(WS);
  });

  it('loads no settings source, so nothing on the host can widen it', () => {
    // A settings file, hook, or plugin on the server would otherwise be able
    // to re-grant a tool this envelope just denied.
    expect(compileHostedEnvelope({ workspacePath: WS }).settingSources).toEqual([]);
  });

  it('never invents a model when none was requested', () => {
    expect(compileHostedEnvelope({ workspacePath: WS }).model).toBeNull();
    expect(compileHostedEnvelope({ workspacePath: WS, requestedModel: '  ' }).model).toBeNull();
    expect(compileHostedEnvelope({ workspacePath: WS, requestedModel: 'claude-sonnet-5' }).model)
      .toBe('claude-sonnet-5');
  });

  it('bounds turns and runtime', () => {
    expect(DEFAULT_HOSTED_LIMITS.maxTurns).toBeGreaterThan(0);
    expect(compileHostedEnvelope({ workspacePath: WS }).maxTurns).toBe(DEFAULT_HOSTED_LIMITS.maxTurns);
  });
});

describe('the credential boundary', () => {
  it('builds the child environment from nothing, not by filtering the parent', () => {
    const env = hostedChildEnv({ apiKey: 'sk-ant-secret', path: '/usr/bin', home: '/root' });
    expect(Object.keys(env).sort()).toEqual([...HOSTED_CHILD_ENV_KEYS].sort());
  });

  it('passes no other Railway variable to the child, including ones added later', () => {
    // The parent process on a hosted box holds the operator token, the xAI
    // reviewer key and the architect key. A deny-list would leak whichever one
    // nobody remembered to name; an allowlist cannot.
    const env = hostedChildEnv({ apiKey: 'sk-ant-secret' });
    for (const leaked of [
      'RELAY_BRIDGE_API_TOKEN', 'XAI_API_KEY', 'OPENAI_API_KEY',
      'DATABASE_URL', 'SOME_FUTURE_SECRET',
    ]) {
      expect(env[leaked]).toBeUndefined();
    }
  });

  it('carries the provider credential only in the environment, never in the envelope', () => {
    const serialized = JSON.stringify(compileHostedEnvelope({ workspacePath: WS }));
    expect(serialized).not.toContain('sk-ant');
    expect(serialized.toLowerCase()).not.toContain('api_key');
  });
});

describe('a configured envelope is not a verified one', () => {
  const envelope = compileHostedEnvelope({ workspacePath: WS });

  it('accepts a run whose granted tools and cwd match', () => {
    const v = verifyGrantedEnvelope({
      envelope, reportedTools: ['Read', 'Glob', 'Grep', 'Edit'], reportedCwd: WS,
    });
    expect(v.matches).toBe(true);
    expect(v.reason).toBeNull();
  });

  it('fails a run the runtime granted a denied tool to', () => {
    const v = verifyGrantedEnvelope({
      envelope, reportedTools: ['Read', 'Edit', 'Bash'], reportedCwd: WS,
    });
    expect(v.matches).toBe(false);
    expect(v.unexpectedTools).toEqual(['Bash']);
    expect(v.reason).toContain('Bash');
  });

  it('fails a run that started somewhere other than the isolated workspace', () => {
    const v = verifyGrantedEnvelope({
      envelope, reportedTools: ['Read'], reportedCwd: '/home/founder/sunday-relay-product',
    });
    expect(v.matches).toBe(false);
    expect(v.cwdMatches).toBe(false);
  });

  it('treats an unreported cwd as unproven, not as a pass', () => {
    expect(verifyGrantedEnvelope({ envelope, reportedTools: ['Read'], reportedCwd: null }).matches)
      .toBe(false);
  });

  it('records a tool granted short of the request without failing the run', () => {
    // Being given less than Relay asked for is not an escape.
    const v = verifyGrantedEnvelope({ envelope, reportedTools: ['Read', 'Edit'], reportedCwd: WS });
    expect(v.matches).toBe(true);
    expect(v.missingTools).toEqual(['Glob', 'Grep']);
  });
});

describe('the spend ceiling', () => {
  it('passes a run under the ceiling', () => {
    expect(withinCostCeiling(0.02).within).toBe(true);
  });

  it('fails a run above the ceiling', () => {
    const r = withinCostCeiling(5.0);
    expect(r.within).toBe(false);
    expect(r.reason).toContain('ceiling');
  });

  it('treats an unreported cost as Unknown rather than asserting the ceiling held', () => {
    expect(withinCostCeiling(null)).toEqual({ within: true, reason: null });
  });
});

describe('readiness is free and offline', () => {
  it('reports the hosted surface when everything is present', () => {
    const r = ready();
    expect(r.surface).toBe('hosted_anthropic');
    expect(r.blockedReason).toBeNull();
    expect(r.sdkInstalled).toBe(true);
    expect(r.runtimeBinaryPresent).toBe(true);
  });

  it('is unavailable when the runtime is not installed', () => {
    const r = ready({ probe: probeWith([]) });
    expect(r.surface).toBe('unavailable');
    expect(r.blockedReason).toContain('not installed');
  });

  it('is unavailable when no executable exists for this host', () => {
    const r = ready({ probe: probeWith([SDK]) });
    expect(r.surface).toBe('unavailable');
    expect(r.blockedReason).toContain('no executable');
  });

  it('accepts a musl-based image', () => {
    // An Alpine host carries the -musl runtime; a probe that only knew the
    // glibc name would call a perfectly capable host unavailable.
    const r = ready({ probe: probeWith([SDK, `${SDK}-linux-x64-musl`]) });
    expect(r.surface).toBe('hosted_anthropic');
  });

  it('is unavailable without a credential, and says so without describing one', () => {
    const r = ready({ env: { RELAY_HOSTED_CODING_MODEL: 'claude-sonnet-5' } as NodeJS.ProcessEnv });
    expect(r.surface).toBe('unavailable');
    expect(r.credentialPresent).toBe(false);
    expect(r.blockedReason).toContain('ANTHROPIC_API_KEY');
  });

  it('refuses to choose a model when none is configured', () => {
    const r = ready({ env: { ANTHROPIC_API_KEY: 'sk-ant-test' } as NodeJS.ProcessEnv });
    expect(r.surface).toBe('unavailable');
    expect(r.blockedReason).toContain('will not choose a model');
  });

  it('reports a present credential as configured, never as valid', () => {
    // Readiness cannot know whether a key works without spending money.
    const r = ready();
    expect(r.credentialPresent).toBe(true);
    expect(Object.keys(r)).not.toContain('credentialValid');
  });

  it('resolves BOTH package shapes against the really-installed SDK', () => {
    // Regression. The SDK is a normal package whose `exports` map hides its
    // manifest (probing `<id>/package.json` throws), while its platform
    // runtime packages are binary-only with no usable entry point (probing the
    // entry throws). A probe that knew only one strategy reported a correctly
    // installed runtime as unavailable — first in one direction, then the
    // other. This asserts against the real node_modules, not a fake.
    const real = probeHostedReadiness({
      env: { ANTHROPIC_API_KEY: 'sk-ant-test', RELAY_HOSTED_CODING_MODEL: 'claude-sonnet-5' } as NodeJS.ProcessEnv,
      now: NOW,
    });
    expect(real.sdkInstalled, 'SDK entry point must resolve').toBe(true);
    expect(real.sdkVersion, 'manifest must be readable past the exports map').not.toBeNull();
    expect(real.runtimeBinaryPresent, 'binary-only package must resolve by manifest').toBe(true);
    expect(real.surface).toBe('hosted_anthropic');
  });

  it('maps every supported host to its runtime package', () => {
    expect(runtimePackageFor('linux', 'x64')).toBe(`${SDK}-linux-x64`);
    expect(runtimePackageFor('darwin', 'arm64')).toBe(`${SDK}-darwin-arm64`);
    expect(runtimePackageFor('sunos', 'x64')).toBeNull();
  });
});

describe('the browser-safe status', () => {
  it('exposes no credential material and no host path', () => {
    const s = JSON.stringify(sanitizeHostedStatus(ready()));
    expect(s).not.toContain('sk-ant');
    expect(s).not.toContain('/node_modules');
    expect(s).not.toContain('ANTHROPIC_API_KEY=');
  });

  it('says a credential is configured without saying anything about it', () => {
    const s = sanitizeHostedStatus(ready());
    expect(s.credentialConfigured).toBe(true);
    expect(s.surface).toBe('hosted_anthropic');
    expect(JSON.stringify(s)).not.toMatch(/sk-|Bearer|secret/i);
  });
});

describe('the surface a record reports', () => {
  it('names the surface each adapter actually executes on', () => {
    expect(surfaceForAdapter(LOCAL_ADAPTER_ID)).toBe('local_claude_code');
    expect(surfaceForAdapter(HOSTED_ADAPTER_ID)).toBe('hosted_anthropic');
  });

  it('reports an unrecognised adapter as unavailable rather than guessing', () => {
    expect(surfaceForAdapter('something-else')).toBe('unavailable');
    expect(surfaceForAdapter(null)).toBe('unavailable');
  });
});

describe('reading a hosted run', () => {
  const init = {
    type: 'system', subtype: 'init', model: 'claude-sonnet-5-20260114',
    claude_code_version: '2.1.220', apiKeySource: 'ANTHROPIC_API_KEY',
    cwd: WS, tools: ['Read', 'Glob', 'Grep', 'Edit'],
  };
  const result = {
    type: 'result', subtype: 'success', is_error: false, result: 'done',
    num_turns: 3, duration_ms: 4200, total_cost_usd: 0.0123,
    usage: { input_tokens: 900, output_tokens: 120 }, permission_denials: [],
  };

  it('takes the model from the runtime, never from the request', () => {
    const o = observeHostedMessages([init, result]);
    // Requested was `claude-sonnet-5`; the runtime answered with a dated build.
    expect(o.actualModel).toBe('claude-sonnet-5-20260114');
    expect(o.actualModel).not.toBe('claude-sonnet-5');
  });

  it('records runtime version and credential SOURCE, never a credential', () => {
    const o = observeHostedMessages([init, result]);
    expect(o.runtimeVersion).toBe('2.1.220');
    expect(o.apiKeySource).toBe('ANTHROPIC_API_KEY');
    expect(JSON.stringify(o)).not.toContain('sk-ant');
  });

  it('keeps unreported usage Unknown rather than zero', () => {
    const o = observeHostedMessages([init, { type: 'result', subtype: 'success', is_error: false }]);
    expect(o.usage.source).toBe('unavailable');
    expect(o.usage.inputTokens).toBeNull();
    expect(o.usage.totalCostUsd).toBeNull();
  });

  it('carries runtime-reported usage through', () => {
    const o = observeHostedMessages([init, result]);
    expect(o.usage.source).toBe('runtime_reported');
    expect(o.usage.inputTokens).toBe(900);
    expect(o.usage.totalCostUsd).toBeCloseTo(0.0123);
  });

  it('drops hidden reasoning, counting it without storing it', () => {
    const o = observeHostedMessages([
      init,
      { type: 'assistant', message: { content: [
        { type: 'thinking', thinking: 'SECRET internal chain of thought' },
        { type: 'text', text: 'working' },
      ] } },
      result,
    ]);
    expect(o.thinkingBlocksOmitted).toBe(1);
    expect(JSON.stringify(o)).not.toContain('SECRET internal');
  });

  it('records tool targets so scope can be audited afterwards', () => {
    const o = observeHostedMessages([
      init,
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Read', input: { file_path: 'src/normalize.js' } },
      ] } },
      result,
    ]);
    expect(o.toolsUsed).toEqual(['Read']);
    expect(o.toolTargets).toEqual(['src/normalize.js']);
  });

  it('counts an unrecognised message instead of throwing', () => {
    const o = observeHostedMessages([init, { type: 'some_future_message' }, result]);
    expect(o.unknownMessageCount).toBe(1);
    expect(o.initSeen).toBe(true);
  });

  it('refuses a stream with no init, because the envelope cannot be checked', () => {
    const usable = hostedStreamIsUsable(observeHostedMessages([result]));
    expect(usable.ok).toBe(false);
    expect(usable.reason).toContain('initialization');
  });

  it('refuses a stream that never produced a result', () => {
    expect(hostedStreamIsUsable(observeHostedMessages([init])).ok).toBe(false);
  });

  it('refuses a run the runtime itself reported as an error', () => {
    const errored = { ...result, subtype: 'error_during_execution', is_error: true };
    expect(hostedStreamIsUsable(observeHostedMessages([init, errored])).ok).toBe(false);
  });

  it('accepts a complete stream — which means usable, not correct', () => {
    // `ok` says the stream can be read. Whether the WORK passed is decided by
    // Relay's own inspection and tests, not here.
    expect(hostedStreamIsUsable(observeHostedMessages([init, result])).ok).toBe(true);
  });
});
