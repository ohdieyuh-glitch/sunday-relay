import { afterEach, describe, expect, it, vi } from 'vitest';

import { listPsps, loadPsp, savePsp, pspIdFromName } from './psp-client';
import { saveBridgeSession, clearBridgeSession } from './bridge-session';

/**
 * THE PSP CLIENT talks to the same routes the API enforces, always as the
 * signed-in participant (a Relay-Session header, never an operator Bearer), and
 * never coerces a config the bridge refuses — it surfaces the refusal verbatim.
 */

const BRIDGE = 'https://bridge.example';

function signedIn() {
  saveBridgeSession({ token: 'sess-tok', origin: '', expiresAt: '', scope: 'browser_control', participantId: 'ghu-1' });
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

afterEach(() => { clearBridgeSession(); vi.restoreAllMocks(); });

describe('psp-client', () => {
  it('listPsps requires a session and does not reach the network without one', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await listPsps({ bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.psps).toEqual([]);
    expect(result.message).toMatch(/sign in/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('listPsps parses the saved profiles and carries the participant session', async () => {
    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, {
      data: { psps: [
        { pspId: 'fast', name: 'Fast lane', updatedAt: '2026-08-12T00:00:00Z', mode: 'autonomous' },
        { pspId: 'careful', name: 'Careful', updatedAt: '2026-08-12T01:00:00Z', mode: 'guided' },
        { bogus: true }, // dropped: not a summary
      ] },
    }));
    const result = await listPsps({ bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.psps.map((p) => p.pspId)).toEqual(['fast', 'careful']);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://bridge.example/relay-api/psp');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Relay-Session sess-tok');
  });

  it('loadPsp returns the full config, and surfaces a not-found refusal verbatim', async () => {
    signedIn();
    const okFetch = vi.fn<typeof fetch>(async () => jsonResponse(200, {
      data: { pspId: 'careful', name: 'Careful', config: { mode: 'guided', limits: { spendUsd: 5 } }, updatedAt: 'x' },
    }));
    const loaded = await loadPsp({ pspId: 'careful', bridgeUrl: BRIDGE, fetchImpl: okFetch });
    expect(loaded.ok).toBe(true);
    expect((loaded.config as { mode?: string }).mode).toBe('guided');

    const missing = vi.fn<typeof fetch>(async () => jsonResponse(404, { error: { kind: 'psp_not_found', message: 'No such PSP.' } }));
    const gone = await loadPsp({ pspId: 'nope', bridgeUrl: BRIDGE, fetchImpl: missing });
    expect(gone.ok).toBe(false);
    expect(gone.message).toBe('No such PSP.');
  });

  it('savePsp posts the named config, and surfaces a validation refusal verbatim', async () => {
    signedIn();
    const good = vi.fn<typeof fetch>(async () => jsonResponse(200, { data: { saved: true, pspId: 'careful', name: 'Careful' } }));
    const saved = await savePsp({ pspId: 'careful', name: 'Careful', config: { mode: 'guided' }, bridgeUrl: BRIDGE, fetchImpl: good });
    expect(saved.ok).toBe(true);
    expect(saved.pspId).toBe('careful');
    const body = JSON.parse((good.mock.calls[0][1]?.body as string));
    expect(body).toEqual({ pspId: 'careful', name: 'Careful', config: { mode: 'guided' } });

    const bad = vi.fn<typeof fetch>(async () => jsonResponse(422, { error: { kind: 'psp_config_invalid', message: 'spendUsd must be a non-negative number when set.' } }));
    const refused = await savePsp({ pspId: 'careful', name: 'Careful', config: { limits: { spendUsd: -1 } }, bridgeUrl: BRIDGE, fetchImpl: bad });
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/non-negative number/i);
  });

  it('pspIdFromName slugifies a human name and refuses one with nothing usable', () => {
    expect(pspIdFromName('Careful & Slow!')).toBe('careful-slow');
    expect(pspIdFromName('  Fast Lane  ')).toBe('fast-lane');
    expect(pspIdFromName('!!!')).toBeNull();
    expect(pspIdFromName('')).toBeNull();
  });
});
