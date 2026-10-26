import { describe, expect, it } from 'vitest';
import { HOSTED_CHILD_MAX_RETRIES, hostedChildEnv, hostedChildEnvKeys } from './hosted-envelope';

/**
 * #43 · THE CLAUDE CODE CLI NEVER RE-SENDS A FAILED API REQUEST ON ITS OWN.
 *
 * Claude Code 2.1.286 (bundled by @anthropic-ai/claude-agent-sdk 0.3.286)
 * retries a failed request 10 times by default, on x-should-retry, 408, 409,
 * 429 or any 5xx. It honours `CLAUDE_CODE_MAX_RETRIES` >= 0. Every coder child
 * environment carries 0, in both credential modes and with or without a model.
 */
describe('#43 · the coder child carries CLAUDE_CODE_MAX_RETRIES=0', () => {
  it.each([
    ['API mode, model pinned', { apiKey: 'present', mode: 'ANTHROPIC_API' as const, model: 'claude-opus-5-5' }],
    ['API mode, no model', { apiKey: 'present' }],
    ['subscription mode', { apiKey: 'ignored', mode: 'CLAUDE_SUBSCRIPTION' as const, oauthToken: 'tok' }],
  ])('%s', (_name, input) => {
    expect(HOSTED_CHILD_MAX_RETRIES).toBe('0');
    expect(hostedChildEnv(input).CLAUDE_CODE_MAX_RETRIES).toBe('0');
  });

  it('and the key is on both always-present lists, so a preflight that checks keys sees it', () => {
    expect(hostedChildEnvKeys('ANTHROPIC_API')).toContain('CLAUDE_CODE_MAX_RETRIES');
    expect(hostedChildEnvKeys('CLAUDE_SUBSCRIPTION')).toContain('CLAUDE_CODE_MAX_RETRIES');
  });
});
