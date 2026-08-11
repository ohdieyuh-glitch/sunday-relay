// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLiveRelayApplicationAdapter } from './live-adapter';
import { clearBridgeSession, saveBridgeSession } from './bridge-session';
import type { RelayMission, RelayProject, StoredProjectSettings } from './contracts';

/**
 * THE LIVE ADAPTER CARRIES THE PAIRED SESSION, AND TELLS THE TRUTH WHEN IT
 * CANNOT.
 *
 * Before this, the adapter sent NO credential on any mission call — the
 * pairing machinery existed and had zero consumers here — so the deployed
 * website's every live mission call answered 401, which the adapter then
 * reported as "The Relay backend is not reachable": a false statement about a
 * healthy server, hiding the one action (pairing) that would have fixed it.
 * Verified against production before the change.
 */

const mission = (): RelayMission => ({
  id: 'm-1', projectId: 'p-1', title: 'T', objective: 'Do the thing.',
  state: 'ready', currentRole: 'relay', currentStep: 0, demo: false,
  createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
  completedAt: null as never,
});
const project = { id: 'p-1', name: 'P' } as RelayProject;
const settings = { projectId: 'p-1' } as StoredProjectSettings;

const okView = () => ({
  ok: true,
  status: 200,
  json: async () => ({ view: { state: 'ready' } }),
}) as unknown as Response;

const refusal = (status: number) => ({
  ok: false,
  status,
  json: async () => ({}),
}) as unknown as Response;

beforeEach(() => {
  clearBridgeSession();
  window.sessionStorage.clear();
});
afterEach(() => {
  clearBridgeSession();
  window.sessionStorage.clear();
});

const paired = (scope: 'browser_read_only' | 'browser_control' = 'browser_control') =>
  saveBridgeSession({
    token: 'session-token-abc',
    origin: window.location.origin,
    expiresAt: '2026-08-11T23:00:00.000Z',
    scope,
    participantId: scope === 'browser_control' ? 'founder' : null,
  });

describe('the paired session rides on every mission call', () => {
  it('sends Relay-Session on start when the browser is paired', async () => {
    paired();
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const adapter = createLiveRelayApplicationAdapter({
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
        return okView();
      }) as typeof fetch,
    });
    await adapter.startMission?.({ mission: mission(), project, settings });
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.Authorization).toBe('Relay-Session session-token-abc');
    // And never the operator scheme — the two must stay unmistakable.
    expect(seen[0].headers.Authorization).not.toMatch(/^Bearer/);
  });

  it('reads the session PER CALL, so pairing after load takes effect without a reload', async () => {
    const seen: Array<Record<string, string>> = [];
    const adapter = createLiveRelayApplicationAdapter({
      fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        seen.push((init?.headers ?? {}) as Record<string, string>);
        return okView();
      }) as typeof fetch,
    });
    await adapter.pollMission?.({ mission: mission() });
    expect(seen[0].Authorization).toBeUndefined();
    paired();
    await adapter.pollMission?.({ mission: mission() });
    expect(seen[1].Authorization).toBe('Relay-Session session-token-abc');
  });
});

describe('each refusal is its own fact', () => {
  const adapterAnswering = (status: number) =>
    createLiveRelayApplicationAdapter({
      fetchImpl: (async () => refusal(status)) as typeof fetch,
    });

  it('401 while unpaired says PAIR, not "backend not reachable"', async () => {
    await expect(adapterAnswering(401).startMission?.({ mission: mission(), project, settings }))
      .rejects.toThrow(/not paired/i);
  });

  it('401 while holding a session says the session lapsed', async () => {
    paired();
    await expect(adapterAnswering(401).startMission?.({ mission: mission(), project, settings }))
      .rejects.toThrow(/expired|no longer accepts/i);
  });

  it('403 names the missing scope', async () => {
    paired('browser_read_only');
    await expect(adapterAnswering(403).startMission?.({ mission: mission(), project, settings }))
      .rejects.toThrow(/read-only.*CONTROL/is);
  });

  it('an unreachable backend still says exactly that', async () => {
    const adapter = createLiveRelayApplicationAdapter({
      fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch,
    });
    await expect(adapter.pollMission?.({ mission: mission() }))
      .rejects.toThrow(/not reachable/i);
  });
});
