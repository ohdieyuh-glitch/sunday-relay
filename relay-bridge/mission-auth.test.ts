import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeServer } from './server';
import { loadBridgeConfig } from './config';
import { browserSessionMayCall } from './browser-session/grants';
import { createRepositoryRegistration } from '../src/relay/mission/repository-target';
import type { RepositoryRegistration } from '../src/relay/mission/repository-target';
import type { RepositoryRegistrationStore } from '../src/relay/persistence';

/**
 * THE MISSION ROUTES ARE AUTHENTICATED.
 *
 * They predate the bridge being hosted — written for a localhost developer
 * tool, with no credential check, which was harmless until the service got a
 * public domain. An anonymous `POST /relay-api/mission/start` against the
 * deployed bridge returned 200 and ran preflight; these tests exist so that
 * cannot come back.
 */

const ORIGIN = 'https://sunday-relay.vercel.app';
const OPERATOR = 'operator-token-for-tests-only';

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    if (s === undefined) continue;
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }
  vi.unstubAllEnvs();
});

async function boot(): Promise<string> {
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  const started: string[] = [];
  const server = createBridgeServer(loadBridgeConfig(process.env), {
    start: (input: { missionId: string }) => { started.push(input.missionId); return {} as never; },
    get: () => undefined,
    cancel: () => undefined,
    retry: () => undefined,
  } as never);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

/** A local repository the OPERATOR registers — ownerParticipant defaults to null,
    so it is operator-owned and no browser participant may target it. */
function operatorOwnedLocalDraft() {
  return {
    identity: { provider: 'local', host: null, owner: null, name: 'proj', defaultBranch: 'main' },
    location: { kind: 'local_path', path: '/tmp/proj' },
    scope: { read: ['**'], write: ['src/**'] },
    grants: ['read', 'write_worktree'].map((permission) => ({
      permission, authorizedBy: 'founder', authorizedAt: '2026-08-12T00:00:00.000Z', expiresAt: null, note: null,
    })),
    ceilings: { maxFilesChanged: 5, maxLinesRemoved: 100, allowDeletions: false },
    registeredBy: 'founder',
  } as never;
}

/** Boots the bridge with a repository store pre-seeded with one registration,
    so the ownership gate has something real to read. */
async function bootWithRepo(reg: RepositoryRegistration): Promise<string> {
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  const store: RepositoryRegistrationStore = {
    save: () => undefined,
    get: (key: string) => (key === reg.key ? reg : null),
    list: () => [reg],
  };
  const server = createBridgeServer(
    loadBridgeConfig(process.env),
    { start: () => ({}) as never, get: () => undefined, cancel: () => undefined, retry: () => undefined } as never,
    null, null, null, null, () => false, null, [], null, null, store,
  );
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

const startMission = (base: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/relay-api/mission/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ missionId: 'probe', objective: 'probe' }),
  });

/**
 * Mint a CONTROL browser session, exactly as production does: an operator pairs
 * a control grant bound to a participant, and the browser redeems it from the
 * approved origin. A control session MAY start a mission — that is what the
 * scope exists for — which is precisely why the repository gate below has to be
 * its own check.
 */
async function pairControl(base: string, participantId: string): Promise<string> {
  const minted = await fetch(`${base}/relay-api/browser/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${OPERATOR}` },
    body: JSON.stringify({ origin: ORIGIN, scope: 'control', participantId }),
  });
  const grant = (await minted.json()).data as { grantId: string; grantSecret: string };
  const exchanged = await fetch(`${base}/relay-api/browser/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(grant),
  });
  const session = (await exchanged.json()).data as { sessionToken: string };
  return session.sessionToken;
}

const startAs = (base: string, token: string, extra: Record<string, unknown>) =>
  fetch(`${base}/relay-api/mission/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Relay-Session ${token}`,
      Origin: ORIGIN,
    },
    body: JSON.stringify({ missionId: 'probe', objective: 'probe', ...extra }),
  });

describe('an anonymous caller cannot touch a mission', () => {
  it('refuses start with no credential — the exact defect found in production', async () => {
    const base = await boot();
    const res = await startMission(base);
    expect(res.status).toBe(401);
    // And it never reached the registry.
    expect(JSON.stringify(await res.json())).not.toContain(OPERATOR);
  }, 30_000);

  it('refuses cancel and retry with no credential', async () => {
    const base = await boot();
    for (const action of ['cancel', 'retry']) {
      const res = await fetch(`${base}/relay-api/mission/probe/${action}`, { method: 'POST' });
      expect(res.status, action).toBe(401);
    }
  }, 30_000);

  it('refuses reading a mission with no credential', async () => {
    const base = await boot();
    expect((await fetch(`${base}/relay-api/mission/probe`)).status).toBe(401);
  }, 30_000);

  it('refuses an invalid credential', async () => {
    const base = await boot();
    const res = await startMission(base, { Authorization: 'Bearer wrong-token' });
    expect(res.status).toBe(401);
  }, 30_000);
});

describe('the operator keeps full access', () => {
  it('may start a mission', async () => {
    const base = await boot();
    const res = await startMission(base, { Authorization: `Bearer ${OPERATOR}` });
    expect(res.status).toBe(200);
  }, 30_000);

  it('may cancel and retry', async () => {
    const base = await boot();
    for (const action of ['cancel', 'retry']) {
      const res = await fetch(`${base}/relay-api/mission/probe/${action}`, {
        method: 'POST', headers: { Authorization: `Bearer ${OPERATOR}` },
      });
      // 404 = reached the registry and found no such mission, which is the
      // point: it got past authentication.
      expect([200, 404], action).toContain(res.status);
    }
  }, 30_000);
});

describe('naming a repository target is operator-only, even for a control session', () => {
  /**
   * A control session may START a mission — and may target a repository it OWNS
   * (that is criterion 2 of the private beta). What it may NOT do is target a
   * repository it does not own: an operator-owned (legacy) registration is the
   * operator's, and the check reads the registration's owner, never the request.
   * This proves the ownership gate fires for a genuine control session whose
   * participant does not own the operator-registered repository.
   */
  it('refuses a control session that targets a repository it does not own', async () => {
    const built = createRepositoryRegistration({ draft: operatorOwnedLocalDraft(), now: '2026-08-12T00:00:00.000Z' });
    if (!built.ok) throw new Error(`fixture refused: ${built.error.message}`);
    const base = await bootWithRepo(built.value);
    const token = await pairControl(base, 'beta-participant-1');
    const res = await startAs(base, token, { repositoryKey: built.value.key, workingBranch: 'relay/x' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatchObject({ kind: 'repository_not_yours' });
  }, 30_000);

  it('but the SAME control session may start a mission when it names no repository', async () => {
    // The gate is about the repository, not about the control session: strip the
    // repositoryKey and the identical caller is admitted. Without this half, a
    // blanket refusal of control-session starts would pass the test above too.
    const base = await boot();
    const token = await pairControl(base, 'beta-participant-1');
    const res = await startAs(base, token, {});
    expect(res.status).toBe(200);
  }, 30_000);

  it('refuses a malformed spend/compute limit in the config, at the boundary', async () => {
    // A limit that is not a real number is refused before the mission starts, so
    // a Mission can never run under a ceiling that is not enforceable.
    const base = await boot();
    const token = await pairControl(base, 'beta-participant-1');
    const res = await startAs(base, token, { config: { limits: { spendUsd: -5 } } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatchObject({ kind: 'config_invalid' });
  }, 30_000);

  it('admits a well-formed config', async () => {
    const base = await boot();
    const token = await pairControl(base, 'beta-participant-1');
    const res = await startAs(base, token, {
      config: { mode: 'autonomous', review: 'independent', limits: { spendUsd: 1, agentCalls: 8 } },
    });
    expect(res.status).toBe(200);
  }, 30_000);
});

describe('a browser session may read a mission, never run one', () => {
  it('scopes reading in and running out', () => {
    expect(browserSessionMayCall('GET', '/mission/m1')).toBe(true);
    for (const [method, path] of [
      ['POST', '/mission/start'],
      ['POST', '/mission/m1/cancel'],
      ['POST', '/mission/m1/retry'],
    ] as const) {
      expect(browserSessionMayCall(method, path), `${method} ${path}`).toBe(false);
    }
  });
});

describe('the public liveness probe is still public', () => {
  it('answers without any credential — a health checker has none', async () => {
    const base = await boot();
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  }, 30_000);
});
