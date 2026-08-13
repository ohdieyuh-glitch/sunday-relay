import { afterEach, describe, expect, it, vi } from 'vitest';

import { listConnectedRepositories } from './repository-client';
import { saveBridgeSession, clearBridgeSession } from './bridge-session';

/**
 * THE REPOSITORY CLIENT talks to the SAME `/repository/list` route the API
 * enforces, always as the signed-in participant (a Relay-Session header, never
 * an operator Bearer). It surfaces a refusal verbatim, returns an empty list as
 * an empty array rather than an error, and never reaches the network without a
 * session.
 */

const BRIDGE = 'https://bridge.example';

function signedIn() {
  saveBridgeSession({ token: 'sess-tok', origin: '', expiresAt: '', scope: 'browser_control', participantId: 'ghu-1' });
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const registration = (over: Record<string, unknown> = {}) => ({
  key: 'github:github.com/beta-alice/their-app',
  provider: 'github',
  owner: 'beta-alice',
  name: 'their-app',
  defaultBranch: 'main',
  grants: ['read', 'write_worktree', 'commit'],
  credentialEnvVarName: 'RELAY_REPO_CRED_ALICE',
  revoked: false,
  registeredAt: '2026-08-12T00:00:00Z',
  ...over,
});

afterEach(() => { clearBridgeSession(); vi.restoreAllMocks(); });

describe('repository-client', () => {
  it('requires a session and does not reach the network without one', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await listConnectedRepositories({ bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.repositories).toEqual([]);
    expect(result.message).toMatch(/sign in/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses the participant registrations and carries the participant session', async () => {
    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, {
      data: { registrations: [
        registration(),
        registration({ key: 'github:github.com/beta-alice/other', name: 'other', grants: ['read'] }),
        { bogus: true }, // dropped: not a registration
      ] },
    }));
    const result = await listConnectedRepositories({ bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.repositories.map((r) => r.key)).toEqual([
      'github:github.com/beta-alice/their-app',
      'github:github.com/beta-alice/other',
    ]);
    // The credential env var NAME the bridge returns is never modelled here.
    expect(Object.keys(result.repositories[0])).not.toContain('credentialEnvVarName');
    const first = result.repositories[0];
    expect(first.owner).toBe('beta-alice');
    expect(first.defaultBranch).toBe('main');
    expect(first.grants).toEqual(['read', 'write_worktree', 'commit']);
    expect(first.revoked).toBe(false);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://bridge.example/relay-api/repository/list');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Relay-Session sess-tok');
  });

  it('marks a revoked registration as revoked so the picker can refuse it', async () => {
    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, {
      data: { registrations: [registration({ revoked: true })] },
    }));
    const result = await listConnectedRepositories({ bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.repositories[0].revoked).toBe(true);
  });

  it('surfaces a refusal verbatim rather than throwing', async () => {
    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(401, {
      error: { kind: 'session_invalid', message: 'This session is no longer valid.' },
    }));
    const result = await listConnectedRepositories({ bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.repositories).toEqual([]);
    expect(result.message).toBe('This session is no longer valid.');
  });

  it('returns an EMPTY list as an empty array, never an error', async () => {
    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, { data: { registrations: [] } }));
    const result = await listConnectedRepositories({ bridgeUrl: BRIDGE, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.repositories).toEqual([]);
    expect(result.message).toBeNull();
  });
});
