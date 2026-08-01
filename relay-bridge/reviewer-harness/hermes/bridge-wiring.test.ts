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
  it('the bridge entry point actually imports the Hermes adapter', () => {
    const source = readFileSync(SERVER, 'utf8');
    expect(findCatalogEntry('hermes')?.adapterAvailable).toBe(true);
    expect(
      /from '\.\/reviewer-harness\/hermes'/.test(source),
      'the catalog claims an adapter, so the bridge must import one',
    ).toBe(true);
    expect(source).toContain('localReadiness');
  });

  it('exposes readiness without exposing the host or the credential', () => {
    const source = readFileSync(SERVER, 'utf8');
    expect(source).toContain('/relay-api/reviewer/readiness');
    // The binary path is deliberately stripped before it leaves the process.
    expect(source).toContain('binaryPath: null');
  });
});

describe('the readiness endpoint costs nothing', () => {
  const call = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
    const server = createBridgeServer(loadBridgeConfig(), {
      start: () => ({}) as never, get: () => undefined, cancel: () => undefined, retry: () => undefined,
    } as never);
    await new Promise<void>((r) => server.listen(0, r));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  };

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
    expect(body.harness).toBe('hermes');

    const evidence = body.evidence as Record<string, unknown>;
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
