import { afterEach, describe, expect, it, vi } from 'vitest';

import { listConnectedRepositories, discoverInstallationRepositories } from './repository-client';
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

/**
 * DISCOVERY — the SAME idioms as the list route, against a fresh installation's
 * `install/repositories` endpoint: session-gated, participant-scoped, refusal
 * verbatim, and an installation that authorizes nothing yet is an empty array
 * (never an error, never a fabricated repository).
 */
const discovered = (over: Record<string, unknown> = {}) => ({
  owner: 'beta-alice',
  name: 'their-app',
  fullName: 'beta-alice/their-app',
  defaultBranch: 'main',
  private: true,
  ...over,
});

describe('discoverInstallationRepositories', () => {
  it('requires a session and does not reach the network without one', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await discoverInstallationRepositories({ bridgeUrl: BRIDGE, installationId: '55550001', fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.repositories).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.message).toMatch(/sign in/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses the authorized repositories, posture and truncation, and carries the session', async () => {
    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, {
      data: {
        installationId: '55550001',
        repositories: [
          discovered(),
          discovered({ name: 'other', fullName: 'beta-alice/other', defaultBranch: 'develop', private: false }),
          { bogus: true }, // dropped: not a repository
        ],
        truncated: true,
      },
    }));
    const result = await discoverInstallationRepositories({ bridgeUrl: BRIDGE, installationId: '55550001', fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.repositories.map((r) => r.fullName)).toEqual([
      'beta-alice/their-app',
      'beta-alice/other',
    ]);
    const [first, second] = result.repositories;
    expect(first.owner).toBe('beta-alice');
    expect(first.name).toBe('their-app');
    expect(first.defaultBranch).toBe('main');
    expect(first.private).toBe(true);
    expect(second.defaultBranch).toBe('develop');
    expect(second.private).toBe(false);
    // The installation id rides the query, and the participant session the header.
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://bridge.example/relay-api/auth/github/install/repositories?installation_id=55550001');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Relay-Session sess-tok');
  });

  it('surfaces a refusal verbatim rather than throwing', async () => {
    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(502, {
      error: { kind: 'github_repositories_unavailable', message: 'GitHub returned 502 for that installation.' },
    }));
    const result = await discoverInstallationRepositories({ bridgeUrl: BRIDGE, installationId: '55550001', fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.repositories).toEqual([]);
    expect(result.message).toBe('GitHub returned 502 for that installation.');
  });

  it('returns an installation that authorizes NO repositories as an empty array, never an error', async () => {
    signedIn();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, {
      data: { installationId: '55550001', repositories: [], truncated: false },
    }));
    const result = await discoverInstallationRepositories({ bridgeUrl: BRIDGE, installationId: '55550001', fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.repositories).toEqual([]);
    expect(result.message).toBeNull();
  });
});
