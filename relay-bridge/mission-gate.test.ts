import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMissionRegistry } from './mission';

/**
 * PRE-DISPATCH GATE.
 *
 * The Prompt Architect is the first required role. When its server-side
 * configuration is absent, the mission must stop BEFORE anything is
 * dispatched — no OpenAI request, no Claude Code invocation, no reviewer run.
 * These tests assert that by making any outbound call a failure: `fetch` is
 * replaced with a spy that must never be called, and the registry is built
 * with a coding runtime that would be a real live path if it were reached.
 *
 * No provider is contacted by this file.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

function registryWith(architectEnv: NodeJS.ProcessEnv) {
  return createMissionRegistry({
    fusionBaseUrl: 'http://localhost:3000',
    sundayMode: 'fast',
    claudeMode: 'live',
    confirmLive: true,
    architectEnv,
    now: () => '2026-07-23T10:00:00.000Z',
  });
}

describe('14. missing OpenAI configuration blocks every live role before dispatch', () => {
  it('fails honestly without contacting any provider when nothing is configured', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('no network call may happen in this test');
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const registry = registryWith({});
    registry.start({ missionId: 'm-gate-1', objective: 'Normalize project names' });
    await settle();

    const view = registry.get('m-gate-1');
    expect(view?.state).toBe('failed');
    expect(view?.error?.code).toBe('architect_not_configured');
    expect(view?.error?.safeMessage).toContain('RELAY_PROMPT_ARCHITECT_MODE=live');
    expect(view?.error?.safeMessage).toContain('OPENAI_API_KEY');
    expect(view?.error?.safeMessage).toContain('OPENAI_PROMPT_ARCHITECT_MODEL');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never dispatches the Coding Agent — no coding event, no terminal capture', async () => {
    globalThis.fetch = (vi.fn(async () => {
      throw new Error('no network call may happen in this test');
    }) as unknown) as typeof fetch;

    const registry = registryWith({ OPENAI_API_KEY: 'present-but-not-live' });
    registry.start({ missionId: 'm-gate-2', objective: 'Normalize project names' });
    await settle();

    const view = registry.get('m-gate-2');
    expect(view?.state).toBe('failed');
    // Nothing downstream of the architect ran.
    expect(view?.terminal).toBeUndefined();
    expect(view?.claim).toBeUndefined();
    expect(view?.handoff).toBeUndefined();
    expect(view?.events.some((e) => e.category === 'coding_agent')).toBe(false);
    expect(view?.events.some((e) => e.category === 'verification')).toBe(false);
  });

  it('a key alone is not live mode — presence never implies configuration', async () => {
    const registry = registryWith({
      OPENAI_API_KEY: 'k',
      OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-test',
    });
    registry.start({ missionId: 'm-gate-3', objective: 'Normalize project names' });
    await settle();

    const view = registry.get('m-gate-3');
    expect(view?.state).toBe('failed');
    expect(view?.error?.safeMessage).toContain('RELAY_PROMPT_ARCHITECT_MODE=live');
  });

  it('the block is not retryable, so a Start press cannot burn a run by retrying', async () => {
    const registry = registryWith({});
    registry.start({ missionId: 'm-gate-4', objective: 'Normalize project names' });
    await settle();
    expect(registry.get('m-gate-4')?.error?.retryable).toBe(false);
  });

  it('the mission is idempotent while blocked — a second start never re-runs it', async () => {
    const registry = registryWith({});
    registry.start({ missionId: 'm-gate-5', objective: 'Normalize project names' });
    await settle();
    const first = registry.get('m-gate-5');
    registry.start({ missionId: 'm-gate-5', objective: 'Normalize project names' });
    await settle();
    const second = registry.get('m-gate-5');
    expect(second?.events.length).toBe(first?.events.length);
  });

  it('the blocked message never contains a configuration VALUE', async () => {
    const registry = registryWith({
      OPENAI_API_KEY: 'sk-supersecretvalue1234567890',
      RELAY_PROMPT_ARCHITECT_MODE: 'off',
    });
    registry.start({ missionId: 'm-gate-6', objective: 'Normalize project names' });
    await settle();
    const serialized = JSON.stringify(registry.get('m-gate-6'));
    expect(serialized).not.toContain('sk-supersecretvalue1234567890');
  });
});
