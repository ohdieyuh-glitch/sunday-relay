import { describe, expect, it } from 'vitest';
import { resolveLiveWorkers } from './live-composition';
import { JULIUS_CLAUDE_AUTH_ENV } from '../hosted-coding-agent/hosted-auth';
import { HOSTED_API_KEY_ENV } from '../hosted-coding-agent/hosted-readiness';

/**
 * THE COMPOSITION'S HALF: CAN THE CODING AGENT RESOLVE WITHOUT AN ANTHROPIC KEY?
 *
 * The live-mission preflight prints a CLAUDE AUTH line, and it is not sufficient
 * proof on its own: that display filters out any CODING_AGENT problem mentioning the
 * executor shell, and preflight resolution deliberately runs with a null shell so a
 * machine with no executor still reports everything in one pass. So a coder blocked
 * for want of a key would have looked identical to one that resolved. I nearly
 * reported it as proof before noticing.
 *
 * These cases resolve with a REAL shell so nothing is filtered, and assert the one
 * thing that matters: which role appears in `problems`, and why.
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

const resolve = (env: Record<string, string>) => resolveLiveWorkers({
  env, projectId: 'prj-auth', workspacePath: '/workspace/mission',
  testCommand: 'node --test x.test.ts',
  contexts: { snapshotFor: () => null },
  artifacts: { publish: () => undefined, fetch: () => null } as never,
  // A real (fake) shell, so no CODING_AGENT problem can be about the executor and
  // every problem that remains is about credentials or models.
  shell: { run: async () => { throw new Error('no dispatch in a resolution test'); } } as never,
});

const problemFor = (env: Record<string, string>, role: string) =>
  resolve(env).problems.find((entry) => entry.role === role);

describe('the Coding Agent resolves from a subscription, and from a key, and never from a guess', () => {
  it('A. SUBSCRIPTION mode resolves the Coding Agent with NO Anthropic key present', () => {
    const problem = problemFor({ ...BASE, [JULIUS_CLAUDE_AUTH_ENV]: 'CLAUDE_SUBSCRIPTION' }, 'CODING_AGENT');
    expect(problem, `the coder must resolve without a key in subscription mode: ${JSON.stringify(problem)}`)
      .toBeUndefined();
  });

  it('B. removing the key does NOT break subscription mode, and DOES break API mode', () => {
    // The same environment, the only difference being the requested mode. This is
    // the pair that shows the mode is doing the work rather than something else.
    expect(problemFor({ ...BASE, [JULIUS_CLAUDE_AUTH_ENV]: 'CLAUDE_SUBSCRIPTION' }, 'CODING_AGENT')).toBeUndefined();
    const api = problemFor(BASE, 'CODING_AGENT');
    expect(api, 'API mode with no key must still refuse').toBeDefined();
    expect(api!.missing).toContain(HOSTED_API_KEY_ENV);
  });

  it('C. API MODE STILL WORKS and has not been deleted', () => {
    const problem = problemFor({ ...BASE, [HOSTED_API_KEY_ENV]: 'FAKETESTNOTREAL-anthropic' }, 'CODING_AGENT');
    expect(problem, `API mode with a key must resolve: ${JSON.stringify(problem)}`).toBeUndefined();
    // And explicitly naming the default mode is the same as omitting it.
    expect(problemFor({
      ...BASE, [HOSTED_API_KEY_ENV]: 'FAKETESTNOTREAL-anthropic',
      [JULIUS_CLAUDE_AUTH_ENV]: 'ANTHROPIC_API',
    }, 'CODING_AGENT')).toBeUndefined();
  });

  it('a key configured ALONGSIDE a subscription request is a contradiction, and is refused', () => {
    // Not silently resolved in either direction. The parent holding a key while the
    // operator asks for the subscription is a mistake worth surfacing, even though
    // the child would not receive it.
    const problem = problemFor({
      ...BASE, [JULIUS_CLAUDE_AUTH_ENV]: 'CLAUDE_SUBSCRIPTION',
      [HOSTED_API_KEY_ENV]: 'FAKETESTNOTREAL-anthropic',
    }, 'CODING_AGENT');
    expect(problem).toBeDefined();
    expect(problem!.missing.join(' ')).toContain(HOSTED_API_KEY_ENV);
    expect(problem!.missing.join(' ')).toContain('CLAUDE_SUBSCRIPTION');
  });

  it('a MISSPELLED mode refuses the Coding Agent rather than defaulting to the key', () => {
    const problem = problemFor({
      ...BASE, [JULIUS_CLAUDE_AUTH_ENV]: 'subscription',
      [HOSTED_API_KEY_ENV]: 'FAKETESTNOTREAL-anthropic',
    }, 'CODING_AGENT');
    expect(problem, 'a typo must not fall back to billing an API key').toBeDefined();
    expect(problem!.missing.join(' ')).toContain('auth_mode_unknown');
  });

  it('D and E. the architect stays OpenAI and the reviewer stays the independent provider', () => {
    const resolution = resolve({ ...BASE, [JULIUS_CLAUDE_AUTH_ENV]: 'CLAUDE_SUBSCRIPTION' });
    expect(resolution.problems.map((entry) => entry.role),
      'changing the Coding Agent credential must not disturb the other two legs').toEqual([]);
    const roles = resolution.entries.map((entry) => entry.worker.role);
    expect(roles).toContain('PROMPT_ARCHITECT');
    expect(roles).toContain('CODING_AGENT');
    expect(roles).toContain('INDEPENDENT_REVIEWER');
    const architect = resolution.entries.find((entry) => entry.worker.role === 'PROMPT_ARCHITECT');
    const reviewer = resolution.entries.find((entry) => entry.worker.role === 'INDEPENDENT_REVIEWER');
    const coder = resolution.entries.find((entry) => entry.worker.role === 'CODING_AGENT');
    expect(architect?.worker.providerId, 'the architect is unchanged').toBe('openai');
    expect(reviewer?.worker.providerId, 'the reviewer is unchanged').toBe('xai');
    // F. PROVIDER TRUTH: the Coding Agent is STILL Anthropic. Billing moved; the
    // vendor did not, and the provider-independence rule still has three vendors.
    expect(coder?.worker.providerId, 'a billing change is not a provider change').toBe('anthropic');
    expect(new Set(roles).size, 'three distinct roles').toBe(3);
    expect(new Set([architect?.worker.providerId, coder?.worker.providerId, reviewer?.worker.providerId]).size,
      'F. three distinct providers, so reviewer independence still holds').toBe(3);
  });

  it('G. resolution is a pure function of the environment, so a restart cannot drift back to the key', () => {
    // A restart re-resolves from the same environment. Two resolutions of one
    // environment must agree, and the subscription one must not acquire a key
    // requirement on the second pass.
    const env = { ...BASE, [JULIUS_CLAUDE_AUTH_ENV]: 'CLAUDE_SUBSCRIPTION' };
    const first = resolve(env).problems.map((entry) => `${entry.role}:${entry.missing.join(',')}`);
    const second = resolve(env).problems.map((entry) => `${entry.role}:${entry.missing.join(',')}`);
    expect(second).toEqual(first);
    expect(second).toEqual([]);
  });
});
