import { describe, expect, it } from 'vitest';

import { J1_CURSOR_API_ORIGIN, buildJ1CoderProviderFor, j1PinnedFetchUrl, realJ1WiringDeps } from './julius-dispatch-wiring-real';
import { J1_ANTHROPIC_ORIGIN, J1_OPENAI_ORIGIN, J1_XAI_ORIGIN, pinnedProviderUrl } from './julius-xai-direct-reviewer';
import { GROK_BOT_CODER_CONFIG_DEFAULTS, GROK_BOT_CODER_PROVIDER_KIND, type CodingAgentTransport, type GrokBotCoderConfig, type GrokBotWorkspacePort } from './julius/grok-bot-coding-provider';

/** THE GROK BOT CODER IN THE J1 WIRING: both additions are opt-in, and the default is what main does. */

/** main's j1PinnedFetchUrl, restated: the three origins, nothing else. */
const mainPinned = (raw: string): string => {
  for (const origin of [J1_XAI_ORIGIN, J1_OPENAI_ORIGIN, J1_ANTHROPIC_ORIGIN]) { try { return pinnedProviderUrl(origin, raw); } catch { /* next */ } }
  throw new Error('provider_base_url_unpinned');
};
const outcome = (f: () => string): string => { try { return `ok:${f()}`; } catch (e) { return `err:${(e as Error).message}`; } };
const SAMPLES = [
  'https://api.x.ai/v1/responses', 'https://api.openai.com/v1/responses', 'https://api.anthropic.com/v1/messages',
  'https://api.cursor.com/v1/agents', 'https://api.cursor.com.evil.example/v1/agents', 'https://user:pw@api.cursor.com/v1/agents',
  'http://api.cursor.com/v1/agents', 'https://evil.example.com/', 'not a url',
];

const transport: CodingAgentTransport = {
  transportKind: 'fake', createRun: async () => ({ kind: 'not_sent', cause: 'key_absent' }), pollUntilTerminal: async () => ({ kind: 'aborted', polls: 0 }),
  fetchResult: async () => ({ kind: 'unavailable', cause: 'x' }), cancelRun: async () => 'failed',
};
const workspace: GrokBotWorkspacePort = { baseRevision: async () => ({ ok: false, cause: 'x' }), fetchBranch: async () => ({ ok: false, cause: 'x' }), applyFetched: async () => ({ ok: false, cause: 'x' }) };
const PIN = Object.freeze({ modelId: 'fake-gpt-reviewer-1', modelFamily: 'openai' });
const config = { ...GROK_BOT_CODER_CONFIG_DEFAULTS, pinnedModelId: 'fake-grok-coder-1', coderModelFamily: 'xai', reviewerModelFamily: 'openai', reviewerModelId: 'fake-gpt-reviewer-1', targetRepoUrl: 'https://github.com/example-org/t', runDeadlineMs: 60_000 };

describe('the fetch allow-list: Cursor is off by default, and the default is byte-identical to main', () => {
  it('default j1PinnedFetchUrl answers every sample exactly as main does', () => {
    for (const s of SAMPLES) expect(outcome(() => j1PinnedFetchUrl(s))).toBe(outcome(() => mainPinned(s)));
    expect(() => j1PinnedFetchUrl('https://api.cursor.com/v1/agents')).toThrow('provider_base_url_unpinned');
    expect(() => j1PinnedFetchUrl('https://api.cursor.com/v1/agents', { allowCursorCloudAgents: false })).toThrow('provider_base_url_unpinned');
  });
  it('the opt-in adds exactly the pinned Cursor origin, still refusing look-alikes', () => {
    expect(J1_CURSOR_API_ORIGIN).toBe('https://api.cursor.com');
    expect(j1PinnedFetchUrl('https://api.cursor.com/v1/agents', { allowCursorCloudAgents: true })).toBe('https://api.cursor.com/v1/agents');
    for (const s of ['https://api.cursor.com.evil.example/v1/agents', 'https://user:pw@api.cursor.com/v1/agents', 'http://api.cursor.com/v1/agents']) {
      expect(() => j1PinnedFetchUrl(s, { allowCursorCloudAgents: true })).toThrow('provider_base_url_unpinned');
    }
  });
  it('realJ1WiringDeps still refuses the Cursor origin', async () => {
    const deps = realJ1WiringDeps(() => undefined);
    await expect(deps.fetchImpl('https://api.cursor.com/v1/agents', { method: 'POST', headers: {}, body: '{}', redirect: 'error' })).rejects.toThrow('provider_base_url_unpinned');
    expect(deps.coderProviderFor?.({ PATH: '/bin' }, { requestedModel: 'claude-opus-5-5' })?.providerKind).toBe('claude-code-hosted');
  });
});

describe('the coder occupant: Claude by default; the Grok Bot coder only when asked, with no fallback', () => {
  it('absent and explicit claude-code-hosted build the Claude provider', () => {
    expect(buildJ1CoderProviderFor()({ PATH: '/bin' }, { requestedModel: 'm' }).providerKind).toBe('claude-code-hosted');
    expect(buildJ1CoderProviderFor({ occupant: 'claude-code-hosted' })({ PATH: '/bin' }, { requestedModel: 'm' }).providerKind).toBe('claude-code-hosted');
  });
  it('the grok occupant builds the Grok Bot provider from its deps', () => {
    expect(buildJ1CoderProviderFor({ occupant: GROK_BOT_CODER_PROVIDER_KIND, grokBot: { config, transport, workspace } })({ PATH: '/bin' }, { requestedModel: 'fake-grok-coder-1', reviewer: PIN }).providerKind).toBe(GROK_BOT_CODER_PROVIDER_KIND);
  });
  it('refuses, never falling back to Claude: no deps, bad config, unpinned model, key-like env, unknown occupant', () => {
    const b = (o: Parameters<typeof buildJ1CoderProviderFor>[0]) => () => buildJ1CoderProviderFor(o)({ PATH: '/bin' }, { requestedModel: 'fake-grok-coder-1', reviewer: PIN });
    expect(b({ occupant: GROK_BOT_CODER_PROVIDER_KIND })).toThrow('coder_grok_bot_deps_absent');
    expect(b({ occupant: GROK_BOT_CODER_PROVIDER_KIND, grokBot: { config: GROK_BOT_CODER_CONFIG_DEFAULTS, transport, workspace } })).toThrow('coder_grok_config_model_absent');
    expect(b({ occupant: GROK_BOT_CODER_PROVIDER_KIND, grokBot: { config: { ...config, targetRepoUrl: 'https://github.com/ohdieyuh-glitch/sunday-relay' }, transport, workspace } })).toThrow('coder_grok_target_is_sunday_relay');
    expect(() => buildJ1CoderProviderFor({ occupant: GROK_BOT_CODER_PROVIDER_KIND, grokBot: { config, transport, workspace } })({ PATH: '/bin' }, { requestedModel: 'claude-opus-5-5', reviewer: PIN })).toThrow('coder_requested_model_not_pinned');
    expect(() => buildJ1CoderProviderFor({ occupant: GROK_BOT_CODER_PROVIDER_KIND, grokBot: { config, transport, workspace } })({ CURSOR_API_KEY: 'x' }, { requestedModel: 'fake-grok-coder-1', reviewer: PIN })).toThrow('coder_env_contains_secret_name');
    expect(b({ occupant: 'something-else' as never })).toThrow('coder_occupant_unknown');
  });
});

describe('N1: the reviewer the grok coder must be independent of is the WIRED reviewer pin, never the coder config', () => {
  const grok = (cfg: GrokBotCoderConfig) => buildJ1CoderProviderFor({ occupant: GROK_BOT_CODER_PROVIDER_KIND, grokBot: { config: cfg, transport, workspace } });
  it('the grok occupant refuses without a reviewer pin, even with a full reviewer in its own config (today\'s core passes none)', () => {
    expect(() => grok(config)({ PATH: '/bin' }, { requestedModel: 'fake-grok-coder-1' })).toThrow('coder_grok_reviewer_pin_absent');
    for (const bad of [{ modelId: '', modelFamily: 'openai' }, { modelId: 'fake-gpt-reviewer-1', modelFamily: ' ' }, { modelId: 'has space', modelFamily: 'openai' }, null, 'gpt-5'] as never[]) {
      expect(() => grok(config)({ PATH: '/bin' }, { requestedModel: 'fake-grok-coder-1', reviewer: bad }), String(bad)).toThrow('coder_grok_reviewer_pin_absent');
    }
  });
  it('a coder config that describes a different reviewer than the pin is refused (the gpt-5/openai-next-to-grok case)', () => {
    const grokPin = { modelId: 'grok-build-0.1', modelFamily: 'xai' };
    const lie = { ...config, pinnedModelId: 'composer-1', coderModelFamily: 'cursor', reviewerModelId: 'gpt-5', reviewerModelFamily: 'openai' };
    expect(() => grok(lie)({ PATH: '/bin' }, { requestedModel: 'composer-1', reviewer: grokPin })).toThrow('coder_grok_reviewer_pin_mismatch');
    expect(() => grok({ ...lie, reviewerModelId: 'grok-build-0.1' })({ PATH: '/bin' }, { requestedModel: 'composer-1', reviewer: grokPin })).toThrow('coder_grok_reviewer_pin_mismatch');
    expect(() => grok({ ...lie, reviewerModelFamily: 'xai' })({ PATH: '/bin' }, { requestedModel: 'composer-1', reviewer: grokPin })).toThrow('coder_grok_reviewer_pin_mismatch');
    /* Probe P1's accepted pairing: a grok coder beside a self-stated gpt-5 reviewer, when the wired reviewer is Grok. */
    const p1 = { ...config, pinnedModelId: 'grok-code-fast-1', coderModelFamily: 'cursor', reviewerModelId: 'gpt-5', reviewerModelFamily: 'openai' };
    expect(() => grok(p1)({ PATH: '/bin' }, { requestedModel: 'grok-code-fast-1', reviewer: grokPin })).toThrow('coder_grok_reviewer_pin_mismatch');
    /* Without the config's claim, the pin itself refuses the grok coder as the same family. */
    expect(() => grok({ ...p1, reviewerModelId: null, reviewerModelFamily: null })({ PATH: '/bin' }, { requestedModel: 'grok-code-fast-1', reviewer: grokPin })).toThrow('coder_grok_same_family_as_reviewer');
  });
  it('the pin alone decides: a config with no reviewer fields runs against the pin; a matching restatement is accepted', () => {
    const grokPin = { modelId: 'grok-build-0.1', modelFamily: 'xai' };
    const bare = { ...config, pinnedModelId: 'composer-1', coderModelFamily: 'cursor', reviewerModelId: null, reviewerModelFamily: null };
    expect(grok(bare)({ PATH: '/bin' }, { requestedModel: 'composer-1', reviewer: grokPin }).providerKind).toBe(GROK_BOT_CODER_PROVIDER_KIND);
    expect(grok({ ...bare, reviewerModelId: 'GROK-BUILD-0.1', reviewerModelFamily: 'x.ai' })({ PATH: '/bin' }, { requestedModel: 'composer-1', reviewer: grokPin }).providerKind).toBe(GROK_BOT_CODER_PROVIDER_KIND);
    /* The pin's own family must agree with its id. */
    expect(() => grok(bare)({ PATH: '/bin' }, { requestedModel: 'composer-1', reviewer: { modelId: 'grok-build-0.1', modelFamily: 'openai' } })).toThrow('coder_grok_family_declaration_mismatch');
  });
  it('the Claude occupant ignores the reviewer field, so passing it changes nothing for main\'s path', () => {
    expect(buildJ1CoderProviderFor()({ PATH: '/bin' }, { requestedModel: 'm', reviewer: { modelId: 'grok-build-0.1', modelFamily: 'xai' } }).providerKind).toBe('claude-code-hosted');
  });
});
