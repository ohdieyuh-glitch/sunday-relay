import { afterEach, describe, expect, it } from 'vitest';

import { clearBridgeSession, saveBridgeSession } from '../app/bridge-session';
import {
  beginWonderlandEntry,
  isInsideWonderland,
  requestWonderlandAdmission,
} from '../../mission/wonderland/wonderland-entry';
import type { WonderlandEntry } from '../../mission/wonderland/wonderland-entry';
import { joinWonderland } from './join-wonderland';

/**
 * THE ONE NETWORK CALL IN THE ENTRY PATH.
 *
 * Every test here drives a fake `fetch`, so what is proven is how each possible
 * ANSWER is folded — not that a bridge exists. The important half is negative:
 * the only route to `admitted` is a 2xx that named a session, and every other
 * outcome must arrive as a refusal a person can read.
 */

const BRIDGE = 'https://bridge.example';
const NOW = '2026-09-07T10:00:00.000Z';

const asking = (): WonderlandEntry =>
  requestWonderlandAdmission(
    beginWonderlandEntry({ projectId: 'project-1', playerId: 'player-1' }),
  );

function signedIn(): void {
  saveBridgeSession({
    token: 'session-token',
    origin: 'https://sunday-relay.example',
    expiresAt: '2099-01-01T00:00:00.000Z',
    scope: 'browser_read_only',
    participantId: null,
  });
}

const responding = (
  status: number,
  body: unknown,
): typeof fetch =>
  (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;

const join = (fetchImpl: typeof fetch) =>
  joinWonderland({ entry: asking(), commandId: 'cmd-1', atIso: NOW, bridgeUrl: BRIDGE, fetchImpl });

afterEach(() => {
  clearBridgeSession();
});

describe('before the request is even made', () => {
  it('refuses when no bridge is configured, without calling anything', async () => {
    signedIn();
    let called = false;
    const spy = (async () => {
      called = true;
      return {} as Response;
    }) as unknown as typeof fetch;
    const entry = await joinWonderland({
      entry: asking(),
      commandId: 'cmd-1',
      atIso: NOW,
      bridgeUrl: null,
      fetchImpl: spy,
    });
    expect(called).toBe(false);
    expect(entry.admission).toBe('refused');
    expect(entry.admissionReason).toContain('No Relay Bridge is configured');
  });

  it('refuses when nobody is signed in', async () => {
    const entry = await join(responding(200, { data: { sessionId: 'session-1' } }));
    expect(entry.admission).toBe('refused');
    expect(entry.admissionReason).toContain('Sign in');
  });
});

describe('folding the bridge`s answer', () => {
  it('admits ONLY on a response that named a session', async () => {
    signedIn();
    const entry = await join(responding(200, { data: { sessionId: 'session-1' } }));
    expect(entry.admission).toBe('admitted');
    expect(entry.sessionId).toBe('session-1');
    expect(entry.admittedAtIso).toBe(NOW);
    // Admitted, and still not there. The renderer has said nothing.
    expect(isInsideWonderland(entry)).toBe(false);
  });

  it('reads a session named at the top level too', async () => {
    signedIn();
    const entry = await join(responding(200, { sessionId: 'session-2' }));
    expect(entry.sessionId).toBe('session-2');
  });

  it('refuses a 200 that named no session', async () => {
    // The request worked. That is not admission — nothing came back that could
    // be left, resumed or proven, and inventing one is the whole prohibition.
    signedIn();
    for (const body of [{}, { data: {} }, { data: { sessionId: '' } }, null, 'ok']) {
      const entry = await join(responding(200, body));
      expect(entry.admission).toBe('refused');
      expect(entry.sessionId).toBeNull();
      expect(entry.admissionReason).toContain('without naming a session');
    }
  });

  it('refuses a 200 whose body cannot be read at all', async () => {
    signedIn();
    const broken = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
      }) as unknown as Response) as unknown as typeof fetch;
    const entry = await join(broken);
    expect(entry.admission).toBe('refused');
  });

  it('gives every HTTP refusal a sentence a person can act on', async () => {
    signedIn();
    const cases: ReadonlyArray<readonly [number, string]> = [
      [401, 'Sign in'],
      [403, 'not allowed'],
      [404, 'does not serve'],
      [500, 'Try again'],
      [418, 'HTTP 418'],
    ];
    for (const [status, fragment] of cases) {
      const entry = await join(responding(status, {}));
      expect(entry.admission).toBe('refused');
      expect(entry.admissionReason).toContain(fragment);
    }
  });

  it('says a request that never completed is unreachable, not refused BY the bridge', async () => {
    // The two are different facts and the founder acts on them differently.
    signedIn();
    const throwing = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    const entry = await join(throwing);
    expect(entry.admission).toBe('refused');
    expect(entry.admissionReason).toContain('could not be reached');
  });
});

describe('what it sends', () => {
  it('carries the session header, the command id and the entry`s own project', async () => {
    signedIn();
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const capturing = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(url);
      seenInit = init;
      return { ok: true, status: 200, json: async () => ({ sessionId: 's' }) } as unknown as Response;
    }) as unknown as typeof fetch;

    await join(capturing);

    expect(seenUrl).toBe(`${BRIDGE}/wonderland/presence/join`);
    expect(seenInit?.method).toBe('POST');
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Relay-Session session-token');
    const body = JSON.parse(String(seenInit?.body));
    expect(body).toEqual({ commandId: 'cmd-1', projectId: 'project-1' });
    // Never sends credentials or reads a cache: this is an authenticated call
    // whose answer is a fact about right now.
    expect(seenInit?.credentials).toBe('omit');
    expect(seenInit?.cache).toBe('no-store');
  });

  it('never puts a token in the URL', async () => {
    signedIn();
    let seenUrl = '';
    const capturing = (async (url: RequestInfo | URL) => {
      seenUrl = String(url);
      return { ok: true, status: 200, json: async () => ({ sessionId: 's' }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await join(capturing);
    expect(seenUrl).not.toContain('session-token');
    expect(seenUrl).not.toContain('?');
  });
});
