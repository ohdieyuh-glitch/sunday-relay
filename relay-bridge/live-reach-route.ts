import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  LIVE_REACH_SOURCES,
  allSources,
  isLiveReachSource,
  resolveReadiness,
  supportedActionCapabilities,
  supportedCapabilities,
  type BackendProbe,
  type LiveReachCapability,
  type LiveReachSettings,
  type LiveReachSource,
} from '../src/relay/mission/live-reach';
import { createLiveReachService, type LiveReachService } from './live-reach-service';

/**
 * THE LIVE REACH ROUTES.
 *
 * Two, and both operator-authenticated. A retrieval leaves this machine and
 * costs someone's rate limit, so it sits exactly where every other spending
 * route sits: behind the one operator credential, unreachable from a browser
 * session by construction.
 *
 * THE CATALOG IS THE THIRD THING, and it is READ-ONLY and free. It answers
 * what Relay models, what each source could do, and what has been observed —
 * which is the question a founder opening the settings screen is asking.
 *
 * NO ACTION ROUTE EXISTS, because no action backend exists. Mounting one that
 * answered `capability_unsupported` to everything would be a surface implying
 * a capability, and the direction is explicit that unsupported operations must
 * not be presented as available.
 */

export const LIVE_REACH_ROUTE_PREFIX = '/relay-api/live-reach';

export function isLiveReachRoute(path: string): boolean {
  return path === `${LIVE_REACH_ROUTE_PREFIX}/catalog`
    || path === `${LIVE_REACH_ROUTE_PREFIX}/probe`
    || path === `${LIVE_REACH_ROUTE_PREFIX}/retrieve`;
}

export interface LiveReachRouteDeps {
  readonly service?: LiveReachService;
  readonly now?: () => string;
  readonly nextEvidenceId?: () => string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * What this deployment models and what it has observed.
 *
 * Probes are supplied by the caller rather than taken here: a catalog request
 * must not go and touch nine external services, and a readiness answer that
 * required a live round trip would make opening a settings screen an event.
 */
export function liveReachCatalog(probes: readonly BackendProbe[] = []): {
  readonly sources: readonly {
    readonly source: LiveReachSource;
    readonly displayName: string;
    readonly accessNote: string;
    readonly readCapabilities: readonly LiveReachCapability[];
    readonly actionCapabilities: readonly LiveReachCapability[];
    readonly readiness: string;
    readonly backends: readonly string[];
  }[];
} {
  return {
    sources: allSources().map((definition) => {
      const capabilities = supportedCapabilities(definition.source);
      const actions = supportedActionCapabilities(definition.source);
      const readiness = capabilities.length === 0
        ? 'capability_unsupported'
        : (capabilities
          .map((capability) => resolveReadiness({ source: definition.source, capability, probes }))
          .find((state) => state === 'ready')
          ?? resolveReadiness({ source: definition.source, capability: capabilities[0] as LiveReachCapability, probes }));
      return {
        source: definition.source,
        displayName: definition.displayName,
        accessNote: definition.accessNote,
        readCapabilities: capabilities.filter((c) => !actions.includes(c)),
        actionCapabilities: actions,
        readiness,
        // Backend IDS, never their configuration. A name is enough to explain
        // which system answered; the variables it reads are not a browser's
        // business and are not here.
        backends: definition.backends.map((b) => b.backendId),
      };
    }),
  };
}

export interface LiveReachRouteRequest {
  readonly method: string;
  readonly path: string;
  readonly authorized: boolean;
  readonly body: unknown;
}

export type LiveReachRouteResponse = {
  readonly status: number;
  readonly payload: unknown;
};

/**
 * Handle one Live Reach request.
 *
 * Pure enough to test without a socket: the transport hands in what it read
 * and gets back a status and a payload.
 */
export async function handleLiveReachRoute(
  request: LiveReachRouteRequest,
  deps: LiveReachRouteDeps = {},
): Promise<LiveReachRouteResponse> {
  if (!request.authorized) {
    // Uniform, and it names no capability: an unauthenticated caller learns
    // nothing about what this deployment can reach.
    return {
      status: 401,
      payload: { kind: 'authentication_failed', error: 'Live Reach requires operator authentication.' },
    };
  }

  const body = (request.body ?? {}) as Record<string, unknown>;

  if (request.method === 'GET' && request.path === `${LIVE_REACH_ROUTE_PREFIX}/catalog`) {
    return { status: 200, payload: liveReachCatalog() };
  }

  const service = deps.service ?? createLiveReachService({
    now: deps.now ?? (() => new Date().toISOString()),
    nextEvidenceId: deps.nextEvidenceId ?? (() => `ev-${String(Date.now())}`),
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
  });

  if (request.method === 'POST' && request.path === `${LIVE_REACH_ROUTE_PREFIX}/probe`) {
    const source = body.source;
    const url = body.url;
    if (!isLiveReachSource(source) || typeof url !== 'string' || url === '') {
      return { status: 400, payload: { kind: 'invalid_request', error: 'A probe needs a known source and a url.' } };
    }
    const capability = (typeof body.capability === 'string' ? body.capability : 'read_item') as LiveReachCapability;
    const probe = await service.probe({ source, capability, url });
    return { status: 200, payload: { probe } };
  }

  if (request.method === 'POST' && request.path === `${LIVE_REACH_ROUTE_PREFIX}/retrieve`) {
    const source = body.source;
    const reference = body.reference;
    if (!isLiveReachSource(source) || typeof reference !== 'string' || reference === '') {
      return { status: 400, payload: { kind: 'invalid_request', error: 'A retrieval needs a known source and a reference.' } };
    }
    if (typeof body.missionId !== 'string' || typeof body.projectId !== 'string') {
      return { status: 400, payload: { kind: 'invalid_request', error: 'A retrieval belongs to a Mission and a project.' } };
    }
    /**
     * MISSION AUTHORITY IS EXPLICIT AND DEFAULTS TO NO.
     *
     * A caller has to say that this Mission asked for this. Defaulting to
     * true would make every request self-authorising, which is precisely the
     * layer the direction insists stays separate from capability
     * availability.
     */
    const missionAuthorises = body.missionAuthorises === true;

    const result = await service.retrieve({
      missionId: body.missionId,
      projectId: body.projectId,
      source,
      capability: (typeof body.capability === 'string' ? body.capability : 'read_item') as LiveReachCapability,
      reference,
      query: typeof body.query === 'string' ? body.query : null,
      missionAuthorises,
      ...(typeof body.settings === 'object' && body.settings !== null
        ? { settings: body.settings as LiveReachSettings }
        : {}),
      ...(Array.isArray(body.probes) ? { probes: body.probes as BackendProbe[] } : {}),
    });

    if (!result.ok) {
      // 403 for a refusal Relay made, because the request was understood and
      // declined. The code says which of the reasons it was.
      return {
        status: 403,
        payload: {
          kind: 'live_reach_refused',
          refusal: result.refusal,
          error: result.detail,
          attempt: result.attempt,
          events: result.events,
        },
      };
    }

    return {
      status: 200,
      payload: { artifact: result.artifact, attempt: result.attempt, events: result.events },
    };
  }

  return { status: 404, payload: { kind: 'not_found', error: 'No such Live Reach route.' } };
}

/** Every source this build knows, for a caller enumerating them. */
export const LIVE_REACH_KNOWN_SOURCES: readonly string[] = LIVE_REACH_SOURCES;

/** Adapter for the node transport. Kept thin on purpose. */
export async function respondLiveReach(
  req: IncomingMessage,
  res: ServerResponse,
  input: { path: string; authorized: boolean; body: unknown; cors: Record<string, string> },
  deps: LiveReachRouteDeps = {},
): Promise<void> {
  const response = await handleLiveReachRoute(
    { method: req.method ?? 'GET', path: input.path, authorized: input.authorized, body: input.body },
    deps,
  );
  res.writeHead(response.status, { 'content-type': 'application/json', ...input.cors });
  res.end(JSON.stringify(response.payload));
}
