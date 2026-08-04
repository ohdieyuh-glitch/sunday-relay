import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createBridgeServer } from '../../server';
import { loadBridgeConfig } from '../../config';
import { findCatalogEntry } from '../../../src/relay/mission/reviewer-harness';

/**
 * `adapterAvailable: true` IS A CLAIM ABOUT THE SERVER RUNTIME.
 *
 * The catalog says Relay ships a concrete adapter for this harness. That is
 * only true if the adapter is actually reachable from the bridge entry point —
 * an adapter that exists as source but is never imported is dead code, and the
 * claim would be false in exactly the way this product exists to prevent.
 *
 * So the claim is tied to the import graph here, not to intent.
 */

const REPO = resolve(__dirname, '..', '..', '..');
const SERVER = join(REPO, 'relay-bridge', 'server.ts');

describe('the catalog claim matches the server runtime', () => {
  it('the bridge entry point actually reaches the Hermes adapter', () => {
    expect(findCatalogEntry('hermes')?.adapterAvailable).toBe(true);
    // Follow the REAL chain rather than pinning one file: the entry imports
    // the Reviewer routes, and those import the adapter. Either link breaking
    // would make the catalog's `adapterAvailable` claim false.
    const server = readFileSync(SERVER, 'utf8');
    expect(
      /from '\.\/reviewer-routes'/.test(server),
      'the bridge entry must import the Reviewer routes',
    ).toBe(true);
    const routes = readFileSync(join(REPO, 'relay-bridge', 'reviewer-routes.ts'), 'utf8');
    expect(
      /from '\.\/reviewer-harness\/hermes\//.test(routes),
      'the catalog claims an adapter, so the bridge must reach one',
    ).toBe(true);
    // The bridge now reaches Hermes through the TRANSPORT rather than calling
    // local readiness directly. The guarantee is unchanged — the catalog's
    // adapterAvailable claim still has to be backed by a real chain — but the
    // chain deliberately no longer probes this container's own PATH, which is
    // what made a hosted bridge tell a founder to install Hermes on a laptop.
    expect(routes).toContain('buildHermesTransport');
    expect(
      routes.includes('localReadiness'),
      'the bridge must not call local Hermes readiness directly any more',
    ).toBe(false);
  });

  it('exposes readiness without exposing the host or the credential', () => {
    const routes = readFileSync(join(REPO, 'relay-bridge', 'reviewer-routes.ts'), 'utf8');
    expect(routes).toContain('/reviewer/readiness');
    // The binary path is deliberately stripped before it leaves the process.
    expect(routes).toContain('binaryPath: null');
  });
});

describe('the readiness endpoint costs nothing', () => {
  // Reviewer routes are authenticated — including the read-only ones, since
  // run state and host contents are both operational disclosure.
  const TOKEN = 'wiring-test-bridge-token';

  const call = async (
    path: string, opts: { token?: string | null } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const previous = process.env.RELAY_BRIDGE_API_TOKEN;
    const previousExe = process.env.RELAY_HERMES_EXECUTABLE;
    process.env.RELAY_BRIDGE_API_TOKEN = TOKEN;
    // Deterministic and fast: never probe whichever Hermes this machine has.
    process.env.RELAY_HERMES_EXECUTABLE = '/nonexistent/relay-hermes-probe';
    const server = createBridgeServer(loadBridgeConfig(), {
      start: () => ({}) as never, get: () => undefined, cancel: () => undefined, retry: () => undefined,
    } as never);
    await new Promise<void>((r) => server.listen(0, r));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const token = opts.token === undefined ? TOKEN : opts.token;
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: token === null ? {} : { Authorization: `Bearer ${token}` },
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      if (previous === undefined) delete process.env.RELAY_BRIDGE_API_TOKEN;
      else process.env.RELAY_BRIDGE_API_TOKEN = previous;
      if (previousExe === undefined) delete process.env.RELAY_HERMES_EXECUTABLE;
      else process.env.RELAY_HERMES_EXECUTABLE = previousExe;
    }
  };

  it('refuses an unauthenticated readiness probe', async () => {
    const { status, body } = await call('/relay-api/reviewer/readiness', { token: null });
    expect(status).toBe(401);
    expect(body.kind).toBe('authentication_failed');
  }, 30_000);

  it('answers with evidence only, and contacts no provider', async () => {
    // Any outbound provider call would have to go through fetch; the endpoint
    // must not make one. (The test's own loopback call is made directly.)
    const realFetch = globalThis.fetch;
    const seen: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: unknown) => {
      seen.push(String(url));
      return realFetch(url as never, init as never);
    });

    const { status, body } = await call('/relay-api/reviewer/readiness');
    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.harness).toBe('hermes');

    const evidence = data.evidence as Record<string, unknown>;
    expect(evidence.bridgeAvailable).toBe(true);
    // The host's layout never leaves the process.
    expect(evidence.binaryPath).toBeNull();
    // Presence only — never a value, a length or a hash.
    expect(typeof evidence.credentialPresent).toBe('boolean');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/xai-[A-Za-z0-9]{8,}/);
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('apiKey');

    // A local readiness check never verifies a model, so it can never render
    // as connected no matter how often it is polled.
    expect(evidence.modelVerified).toBe(false);
    expect(evidence.verifiedModelId).toBeNull();

    // Nothing reached a provider host.
    expect(seen.filter((u) => !u.includes('127.0.0.1'))).toEqual([]);
    vi.unstubAllGlobals();
  }, 30_000);
});
