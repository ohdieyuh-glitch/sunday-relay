import { describe, expect, it, vi } from 'vitest';

import {
  LIVE_REACH_ROUTE_PREFIX,
  handleLiveReachRoute,
  isLiveReachRoute,
  liveReachCatalog,
} from './live-reach-route';
import { setCapability, EMPTY_LIVE_REACH_SETTINGS, type BackendProbe } from '../src/relay/mission/live-reach';

/**
 * THE LIVE REACH ROUTES.
 *
 * Two claims: an unauthenticated caller learns nothing and reaches nothing,
 * and an authenticated one cannot make a request self-authorising.
 */

const READY: readonly BackendProbe[] = Object.freeze([
  { backendId: 'relay_http_fetch', capability: 'read_item', result: 'observed', probedAt: '2026-08-10T12:00:00.000Z' },
]);

const page = () => new Response('the release removed the adapter', {
  status: 200,
  headers: { 'content-type': 'text/html', 'last-modified': 'Mon, 10 Aug 2026 11:30:00 GMT' },
});

const deps = (fetchImpl: unknown) => ({
  now: () => '2026-08-10T12:00:00.000Z',
  nextEvidenceId: () => 'ev-1',
  fetchImpl: fetchImpl as typeof fetch,
});

const retrieve = (body: Record<string, unknown>, authorized = true) => ({
  method: 'POST',
  path: `${LIVE_REACH_ROUTE_PREFIX}/retrieve`,
  authorized,
  body,
});

describe('routing', () => {
  it('claims only its own paths', () => {
    expect(isLiveReachRoute(`${LIVE_REACH_ROUTE_PREFIX}/catalog`)).toBe(true);
    expect(isLiveReachRoute(`${LIVE_REACH_ROUTE_PREFIX}/retrieve`)).toBe(true);
    expect(isLiveReachRoute('/relay-api/health')).toBe(false);
    expect(isLiveReachRoute('/relay-api/live-reach')).toBe(false);
  });
});

describe('authentication', () => {
  it('refuses every route without operator authentication', async () => {
    for (const path of ['catalog', 'probe', 'retrieve']) {
      const response = await handleLiveReachRoute({
        method: path === 'catalog' ? 'GET' : 'POST',
        path: `${LIVE_REACH_ROUTE_PREFIX}/${path}`,
        authorized: false,
        body: {},
      });
      expect(response.status, path).toBe(401);
    }
  });

  it('tells an unauthenticated caller nothing about what this deployment can reach', async () => {
    const response = await handleLiveReachRoute({
      method: 'GET', path: `${LIVE_REACH_ROUTE_PREFIX}/catalog`, authorized: false, body: {},
    });
    const text = JSON.stringify(response.payload);
    expect(text).not.toContain('github');
    expect(text).not.toContain('relay_http_fetch');
  });

  it('does not fetch for an unauthenticated retrieval', async () => {
    const fetchImpl = vi.fn();
    const response = await handleLiveReachRoute(
      retrieve({ source: 'web', reference: 'https://example.com/', missionId: 'm', projectId: 'p', missionAuthorises: true }, false),
      deps(fetchImpl),
    );
    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('the catalog', () => {
  it('reports what each source can do and what has been observed', () => {
    const catalog = liveReachCatalog(READY);
    const web = catalog.sources.find((s) => s.source === 'web');
    expect(web?.readiness).toBe('ready');
    expect(web?.readCapabilities.length).toBeGreaterThan(0);
    // No action capability anywhere, because none is implemented.
    for (const source of catalog.sources) expect(source.actionCapabilities).toEqual([]);
  });

  it('says UNKNOWN for a source nothing has probed, and unsupported where there is no backend', () => {
    const catalog = liveReachCatalog();
    expect(catalog.sources.find((s) => s.source === 'github')?.readiness).toBe('unknown');
    expect(catalog.sources.find((s) => s.source === 'linkedin')?.readiness).toBe('capability_unsupported');
  });

  it('names backends but never their configuration', () => {
    const text = JSON.stringify(liveReachCatalog(READY));
    expect(text).toContain('relay_http_fetch');
    for (const name of ['API_KEY', 'TOKEN', 'SECRET', 'RELAY_HERMES']) {
      expect(text).not.toContain(name);
    }
  });
});

describe('a retrieval', () => {
  it('needs a known source and a reference', async () => {
    for (const body of [
      { source: 'myspace', reference: 'https://x/', missionId: 'm', projectId: 'p' },
      { source: 'web', reference: '', missionId: 'm', projectId: 'p' },
      { source: 'web', reference: 'https://x/' },
    ]) {
      const response = await handleLiveReachRoute(retrieve(body), deps(vi.fn()));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('is not self-authorising: Mission authority must be stated', async () => {
    const fetchImpl = vi.fn();
    const response = await handleLiveReachRoute(retrieve({
      source: 'web', reference: 'https://example.com/', missionId: 'm', projectId: 'p',
      probes: READY,
      // `missionAuthorises` absent. Defaulting it to true would make every
      // request authorise itself, collapsing the two layers the direction
      // insists stay separate.
    }), deps(fetchImpl));
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.payload)).toContain('mission_does_not_authorize');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns an artifact when everything agrees', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page());
    const response = await handleLiveReachRoute(retrieve({
      source: 'web', reference: 'https://example.com/', missionId: 'm', projectId: 'p',
      missionAuthorises: true, probes: READY,
    }), deps(fetchImpl));
    expect(response.status).toBe(200);
    const payload = response.payload as { artifact: { publishedAt: string; age: { freshness: string } }; attempt: { actualBackendId: string } };
    expect(payload.artifact.publishedAt).toBe('2026-08-10T11:30:00.000Z');
    expect(payload.artifact.age.freshness).toBe('live');
    expect(payload.attempt.actualBackendId).toBe('relay_http_fetch');
  });

  it('refuses with the real reason when a capability is switched off', async () => {
    const fetchImpl = vi.fn();
    const response = await handleLiveReachRoute(retrieve({
      source: 'web', reference: 'https://example.com/', missionId: 'm', projectId: 'p',
      missionAuthorises: true, probes: READY,
      settings: setCapability(EMPTY_LIVE_REACH_SETTINGS, 'web', 'read_item', false),
    }), deps(fetchImpl));
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.payload)).toContain('capability_disabled');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('carries the events with it, so a caller can record what happened', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page());
    const response = await handleLiveReachRoute(retrieve({
      source: 'web', reference: 'https://example.com/', missionId: 'm', projectId: 'p',
      missionAuthorises: true, probes: READY,
    }), deps(fetchImpl));
    const payload = response.payload as { events: { kind: string }[] };
    expect(payload.events.map((e) => e.kind)).toContain('EVIDENCE_RETRIEVED');
  });
});

describe('a probe', () => {
  it('answers without spending a retrieval', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page());
    const response = await handleLiveReachRoute({
      method: 'POST',
      path: `${LIVE_REACH_ROUTE_PREFIX}/probe`,
      authorized: true,
      body: { source: 'web', url: 'https://example.com/' },
    }, deps(fetchImpl));
    expect(response.status).toBe(200);
    expect((response.payload as { probe: { result: string } }).probe.result).toBe('observed');
  });

  it('refuses a probe for a source this build does not know', async () => {
    const response = await handleLiveReachRoute({
      method: 'POST',
      path: `${LIVE_REACH_ROUTE_PREFIX}/probe`,
      authorized: true,
      body: { source: 'myspace', url: 'https://example.com/' },
    }, deps(vi.fn()));
    expect(response.status).toBe(400);
  });
});

/**
 * THE USAGE SURFACE.
 *
 * A meter nobody can read is a meter nobody can act on. This is the route that
 * makes retrieval spend observable, and the things it must not do are as
 * important as the number: no network, no authentication bypass, and no 404
 * for a mission that simply has not retrieved anything.
 */
describe('reading what a mission has spent', () => {
  const usagePath = (missionId: string) => `${LIVE_REACH_ROUTE_PREFIX}/usage/${missionId}`;

  it('is recognised as a Live Reach route', () => {
    expect(isLiveReachRoute(usagePath('msn-1'))).toBe(true);
  });

  it('refuses an unauthenticated reader, like every other Live Reach route', async () => {
    const response = await handleLiveReachRoute({
      method: 'GET', path: usagePath('msn-1'), authorized: false, body: undefined,
    });
    expect(response.status).toBe(401);
  });

  it('reports an empty meter for a mission that has retrieved nothing', async () => {
    // Not a 404: "this mission retrieved nothing" is a real answer, and a
    // not-found would be indistinguishable from a mistyped id.
    const fetchImpl = vi.fn();
    const response = await handleLiveReachRoute(
      { method: 'GET', path: usagePath('msn-quiet'), authorized: true, body: undefined },
      deps(fetchImpl),
    );
    expect(response.status).toBe(200);
    const { usage } = response.payload as { usage: { retrievals: number; bytes: number | null } };
    expect(usage.retrievals).toBe(0);
    // Unknown, not zero.
    expect(usage.bytes).toBeNull();
    // And it touched nothing to say so.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a request with no mission id rather than reporting somebody’s meter', async () => {
    const response = await handleLiveReachRoute(
      { method: 'GET', path: `${LIVE_REACH_ROUTE_PREFIX}/usage/`, authorized: true, body: undefined },
      deps(vi.fn()),
    );
    expect(response.status).toBe(400);
  });

  it('reports what a retrieval through the SAME service actually spent', async () => {
    // The service is passed in, which is what makes this meaningful: the
    // server used to let the route build its own per request, so a retrieval
    // and a usage read would have landed on two different meters.
    const { createLiveReachService } = await import('./live-reach-service');
    const service = createLiveReachService({
      now: () => '2026-08-10T12:00:00.000Z',
      nextEvidenceId: () => 'ev-1',
      fetchImpl: (() => Promise.resolve(page())) as unknown as typeof fetch,
    });

    await handleLiveReachRoute(retrieve({
      missionId: 'msn-1', projectId: 'rly-1', source: 'web',
      reference: 'https://example.com/notes', missionAuthorises: true, probes: READY,
    }), { service });

    const response = await handleLiveReachRoute(
      { method: 'GET', path: usagePath('msn-1'), authorized: true, body: undefined },
      { service },
    );
    const { usage } = response.payload as { usage: { retrievals: number; bytes: number | null; unit: string } };
    expect(usage.retrievals).toBe(1);
    expect(usage.bytes).toBeGreaterThan(0);
    // The unit is stated, so nobody reads a retrieval count as a bill.
    expect(usage.unit).toBe('retrievals_and_bytes');
  });
});
