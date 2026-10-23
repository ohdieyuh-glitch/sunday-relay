import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { NATIVE_WORLD_AUDIENCE, type BrowserSessionStore } from './browser-session/grants';
import { loadBridgeConfig } from './config';
import { createBridgeServer } from './server';

/**
 * The server builds its own session store. This test keeps that store so it
 * can redeem a real native session into it. Pairing over HTTP needs the Julius
 * database, which this proof does not.
 */
const holder = vi.hoisted(() => ({ store: null as BrowserSessionStore | null }));

vi.mock('./browser-session/grants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./browser-session/grants')>();
  return {
    ...actual,
    createBrowserSessionStore() {
      const store = actual.createBrowserSessionStore();
      holder.store = store;
      return store;
    },
  };
});

const PROJECT = 'project-1';
const FOUNDER = 'founder';
const LOG = 'ab'.repeat(32);
const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const KEY = '11111111-2222-4333-8444-555555555555';

const FORWARDING_HEADERS = [
  ['x-forwarded-for', '203.0.113.4'],
  ['x-forwarded-host', 'proxy.example'],
  ['forwarded', 'for=203.0.113.4;host=proxy.example'],
  ['x-real-ip', '203.0.113.4'],
] as const;

function nativeToken(playerId: string, projectId: string): string {
  const store = holder.store;
  if (store === null) throw new Error('the server has no session store');
  const now = Date.now();
  const grant = store.createGrant({
    origin: NATIVE_WORLD_AUDIENCE,
    now,
    scope: 'native_world',
    participantId: playerId,
    projectId,
  });
  const redeemed = store.consumeGrant({
    grantId: grant.grantId,
    secret: grant.secret,
    origin: NATIVE_WORLD_AUDIENCE,
    now,
  });
  if (!redeemed.ok) throw new Error('native session was not redeemed');
  return redeemed.session.token;
}

async function post(
  base: string,
  path: string,
  token: string,
  over: { runId?: string; key?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: { data?: { state?: string; dispatched?: boolean }; error?: { kind?: string } | string } }> {
  const response = await fetch(`${base}/relay-api${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Relay-Session ${token}`,
      'x-relay-idempotency-key': over.key ?? KEY,
      ...over.headers,
    },
    body: JSON.stringify({
      runId: over.runId ?? RUN,
      clientTriggerId: 'trigger_01',
      clientLogSha256: LOG,
      clientUiActionUtc: '2026-10-23T16:15:00.000Z',
    }),
  });
  return { status: response.status, body: await response.json() as { data?: { state?: string; dispatched?: boolean }; error?: { kind?: string } | string } };
}

describe('admission through createBridgeServer', () => {
  let base = '';
  let server: Server | null = null;
  let founderToken = '';
  let otherToken = '';

  beforeAll(async () => {
    vi.stubEnv('JULIUS_WONDERLAND_ADMISSION', '1');
    vi.stubEnv('JULIUS_J1_FOUNDER_PLAYER_ID', FOUNDER);
    vi.stubEnv('JULIUS_J1_PROJECT_ID', PROJECT);
    vi.stubEnv('JULIUS_WONDERLAND_MISSION', 'julius-inworld-data-1');
    vi.stubEnv('JULIUS_J1_DAILY_CAP', '20');
    vi.stubEnv('RELAY_BRIDGE_API_TOKEN', 'operator-token-for-tests-only');
    vi.stubEnv('RELAY_ALLOWED_ORIGINS', 'https://sunday-relay.vercel.app');
    server = createBridgeServer(loadBridgeConfig(process.env), {
      start: () => ({}) as never,
      get: () => undefined,
      cancel: () => undefined,
      retry: () => undefined,
    } as never);
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    base = `http://127.0.0.1:${port}`;
    founderToken = nativeToken(FOUNDER, PROJECT);
    otherToken = nativeToken('other-player', PROJECT);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    const running = server;
    if (running === null) throw new Error('admission server was not started');
    running.closeAllConnections?.();
    await new Promise<void>((resolve) => running.close(() => resolve()));
  });

  it('POST /wonderland/julius/dispatch?projectId= admits on the real server', async () => {
    const result = await post(base, `/wonderland/julius/dispatch?projectId=${PROJECT}`, founderToken);
    expect(result.status).toBe(202);
    expect(result.body.data?.state).toBe('ADMISSION_HELD');
    expect(result.body.data?.dispatched).toBe(false);
    expect(result.body.error).toBeUndefined();
  });

  it('a wrong projectId is julius_dispatch_wrong_project from admission', async () => {
    const result = await post(base, '/wonderland/julius/dispatch?projectId=other-project', founderToken, {
      runId: 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      key: '99999999-8888-4777-a666-555555555555',
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toEqual({
      kind: 'julius_dispatch_wrong_project',
      message: 'This session was not paired for that project.',
    });
  });

  it('a non-founder native session is founder_only', async () => {
    const result = await post(base, `/wonderland/julius/dispatch?projectId=${PROJECT}`, otherToken, {
      runId: 'wlj_bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      key: '22222222-3333-4444-8555-666666666666',
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toMatchObject({ kind: 'julius_dispatch_founder_only' });
  });

  it('each forwarding header is not_loopback', async () => {
    for (const [index, [name, value]] of FORWARDING_HEADERS.entries()) {
      const result = await post(base, `/wonderland/julius/dispatch?projectId=${PROJECT}`, founderToken, {
        runId: `wlj_ccccccc${index}-dddd-4eee-8fff-aaaaaaaaaaaa`,
        key: `3333333${index}-4444-4555-8666-777777777777`,
        headers: { [name]: value },
      });
      expect(result.status, name).toBe(403);
      expect(result.body.error, name).toMatchObject({ kind: 'julius_dispatch_not_loopback' });
    }
  });

  it('a trailing slash, a different case, and a child path stay on the catch-all', async () => {
    const paths = [
      `/wonderland/julius/dispatch/?projectId=${PROJECT}`,
      `/Wonderland/Julius/Dispatch?projectId=${PROJECT}`,
      `/wonderland/julius/dispatch/x?projectId=${PROJECT}`,
    ];
    for (const path of paths) {
      const result = await post(base, path, founderToken, {
        key: '44444444-5555-4666-8777-888888888888',
      });
      expect(result.status, path).toBe(403);
      expect(result.body, path).toEqual({ error: 'a native Wonderland session reaches only the Julius world stream' });
    }
  });
});
