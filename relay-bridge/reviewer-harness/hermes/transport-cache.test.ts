import { afterEach, describe, expect, it } from 'vitest';

import { buildHermesTransport, resetHermesTransportCacheForTests } from './transport-factory';

/**
 * THE CEILINGS ARE PER TRANSPORT INSTANCE, SO THE INSTANCE HAS TO BE ONE.
 *
 * `local-transport.ts` enforces concurrency, wall clock and retention in
 * closure-local counters. N instances therefore enforce N × the ceiling, and
 * the factory used to build a fresh one per request — which its own comment
 * called "harmless today because no bridge route calls `startReview`, and a
 * live hazard the moment one does".
 *
 * A concurrency bound whose correctness rests on nobody adding a route is a
 * landmine, not a design. These hold the fix so the bound is real before
 * somebody needs it, rather than after.
 */

const LOCAL_ENV: NodeJS.ProcessEnv = {
  RELAY_HERMES_MODE: 'local',
  RELAY_HERMES_PROVIDER: 'xai',
  RELAY_HERMES_MODEL: 'grok-test',
  XAI_API_KEY: 'test-key',
};

afterEach(() => { resetHermesTransportCacheForTests(); });

describe('the local transport is built once per configuration', () => {
  it('returns the SAME instance for the same configuration', async () => {
    const first = await buildHermesTransport({ env: LOCAL_ENV, production: false });
    const second = await buildHermesTransport({ env: LOCAL_ENV, production: false });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('the transport did not build');
    // Identity, not equality: two instances would each enforce the ceiling.
    expect(first.transport).toBe(second.transport);
  });

  it('builds a DIFFERENT instance for a different model', async () => {
    // Two models are two different reviewers. Sharing one instance would
    // attribute a run to the wrong one.
    const a = await buildHermesTransport({ env: LOCAL_ENV, production: false });
    const b = await buildHermesTransport({
      env: { ...LOCAL_ENV, RELAY_HERMES_MODEL: 'grok-other' }, production: false,
    });
    if (!a.ok || !b.ok) throw new Error('the transport did not build');
    expect(a.transport).not.toBe(b.transport);
  });

  it('builds a different instance for a different executable', async () => {
    const a = await buildHermesTransport({ env: LOCAL_ENV, production: false });
    const b = await buildHermesTransport({
      env: { ...LOCAL_ENV, RELAY_HERMES_EXECUTABLE: '/opt/hermes' }, production: false,
    });
    if (!a.ok || !b.ok) throw new Error('the transport did not build');
    expect(a.transport).not.toBe(b.transport);
  });

  it('reuses the instance when only the credential VALUE changed', async () => {
    // Rotating a key does not reset a concurrency ceiling, and a credential
    // value must never become a cache key anywhere.
    const a = await buildHermesTransport({ env: LOCAL_ENV, production: false });
    const b = await buildHermesTransport({
      env: { ...LOCAL_ENV, XAI_API_KEY: 'rotated-key' }, production: false,
    });
    if (!a.ok || !b.ok) throw new Error('the transport did not build');
    expect(a.transport).toBe(b.transport);
  });
});

describe('remote transports are not cached', () => {
  const REMOTE_ENV: NodeJS.ProcessEnv = {
    RELAY_HERMES_MODE: 'remote',
    RELAY_HERMES_SERVICE_URL: 'https://hermes.example.com',
    RELAY_HERMES_SERVICE_TOKEN: 'service-token',
    RELAY_HERMES_TRUSTED_ORIGINS: 'https://hermes.example.com',
  };

  it('builds a fresh remote transport each time', async () => {
    // They hold no counters, so there is nothing to bound — and caching one
    // would make a rotated service token survive in memory after it changed.
    const a = await buildHermesTransport({ env: REMOTE_ENV, production: false });
    const b = await buildHermesTransport({ env: REMOTE_ENV, production: false });
    if (!a.ok || !b.ok) throw new Error('the transport did not build');
    expect(a.transport).not.toBe(b.transport);
  });
});
