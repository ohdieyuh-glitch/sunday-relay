import { afterEach, describe, expect, it, vi } from 'vitest';

import { retryBetaMission, cancelBetaMission, listBetaMissions } from './beta-mission';
import { saveBridgeSession, clearBridgeSession } from './bridge-session';
import type { LiveMissionUpdate } from './contracts';

/**
 * THE MISSION-ACTION CLIENT (retry/cancel) needs a session, returns the bridge's
 * view unchanged on success, and states a refusal in the bridge's own words —
 * whether the bridge phrased it as a bare string (a 404) or an object (a beta
 * refusal). It never invents a view for a call that failed.
 */

const BRIDGE = 'https://bridge.example';
const runningView = { state: 'running', currentRole: 'coding_agent', events: [], phase: 'coding' } as unknown as LiveMissionUpdate;

function signedIn() {
  saveBridgeSession({ token: 'sess', origin: '', expiresAt: '', scope: 'browser_control', participantId: 'ghu-1' });
}
function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

afterEach(() => { clearBridgeSession(); vi.restoreAllMocks(); });

describe('retry/cancel mission client', () => {
  it('retry requires a session and does not reach the network without one', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await retryBetaMission({ missionId: 'm-1', bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/sign in/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('retry returns the bridge view unchanged on success, POSTing to the retry route', async () => {
    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, { missionId: 'm-1', view: runningView }));
    const result = await retryBetaMission({ missionId: 'm-1', bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.view?.state).toBe('running');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://bridge.example/relay-api/mission/m-1/retry');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Relay-Session sess');
  });

  it('retry surfaces a bare-string 404 error verbatim, with no view', async () => {
    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(404, { error: 'mission not found' }));
    const result = await retryBetaMission({ missionId: 'gone', bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.view).toBeNull();
    expect(result.message).toBe('mission not found');
  });

  it('retry surfaces an object refusal (a beta gate) verbatim', async () => {
    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(403, { error: { kind: 'beta_closed', message: 'The private beta is not open to you yet.' } }));
    const result = await retryBetaMission({ missionId: 'm-1', bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.message).toBe('The private beta is not open to you yet.');
  });

  it('listBetaMissions requires a session and parses the rows the bridge returns', async () => {
    const noSession = vi.fn<typeof fetch>();
    const gated = await listBetaMissions({ bridgeUrl: BRIDGE, fetchImpl: noSession });
    expect(gated.ok).toBe(false);
    expect(noSession).not.toHaveBeenCalled();

    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, {
      missions: [
        { missionId: 'm-1', objective: 'Do', state: 'running', createdAt: 'x', completedAt: null },
        { junk: true }, // dropped: not a summary
      ],
    }));
    const listed = await listBetaMissions({ bridgeUrl: BRIDGE, fetchImpl });
    expect(listed.ok).toBe(true);
    expect(listed.missions.map((m) => m.missionId)).toEqual(['m-1']);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://bridge.example/relay-api/missions');
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Relay-Session sess');
  });

  it('cancel returns the bridge view on success and hits the cancel route', async () => {
    signedIn();
    const cancelledView = { state: 'cancelled', currentRole: 'relay', events: [], phase: 'cancelled' } as unknown as LiveMissionUpdate;
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, { missionId: 'm-1', view: cancelledView }));
    const result = await cancelBetaMission({ missionId: 'm-1', bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.view?.state).toBe('cancelled');
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://bridge.example/relay-api/mission/m-1/cancel');
  });
});
