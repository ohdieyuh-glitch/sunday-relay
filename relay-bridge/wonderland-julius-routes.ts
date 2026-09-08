/**
 * THE JULIUS HALF OF THE WONDERLAND SEAM, OVER THE TRANSPORT THAT ALREADY EXISTS.
 *
 * `wonderland-routes.ts` already serves a world: SSE at `/wonderland/events`,
 * replay from a cursor then live subscribe, a transport heartbeat, and an
 * origin-bound browser session in front of it. `PostgresWonderlandFanout`
 * already pushes identifiers over LISTEN/NOTIFY so the stream does not poll.
 * All of it is deployed.
 *
 * What it serves is BATTLE events. A Julius run's operational events had no
 * path onto it, so every layer downstream — the envelope, ordering,
 * rehydration, both Unreal subsystems — was waiting for events nothing sent.
 * This is that path, and it deliberately reuses the transport rather than
 * adding one: a second socket for the same client to the same server, carrying
 * the same kind of thing, would be two reconnect stories and two auth stories
 * to keep in step.
 *
 * TWO ROUTES, MATCHING THE TWO SHAPES ON THE SEAM:
 *
 *   GET /wonderland/julius/hydrate   the snapshot. What is true now, in one
 *                                    payload, including the sequence it is
 *                                    consistent with. A reconnect starts here.
 *   GET /wonderland/julius/events    the tail, as SSE. Everything after a
 *                                    cursor, ordered, scoped and folded.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THESE ROUTES REFUSE TO RUN WITHOUT A MEMBERSHIP PORT
 *
 * The browser session this bridge issues carries a `participantId`, an origin
 * and a scope. IT DOES NOT CARRY A PROJECT. The battle routes get away with
 * that because `WonderlandBackend.eventsFor({ projectId, playerId })` filters
 * by participation inside the backend — the authorisation lives in the data
 * model, not in the route.
 *
 * There is no equivalent for a Julius run. Nothing in this bridge can currently
 * answer "may this player read this project's runs?", and the tempting default
 * — any authenticated player may read any project — is a cross-tenant read of
 * mission state, C.A.R.D. slots and spend. So `membership` is a REQUIRED
 * dependency and its absence is 503, not 200. A route that opened up when its
 * authorisation was unconfigured would be the worst possible failure mode: it
 * would work perfectly in every environment where nobody had wired it.
 *
 * That port is the one genuinely missing piece on this path. Everything else
 * here is composed from parts that exist and are tested.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BrowserSessionStore } from './browser-session/grants';
import { sessionTokenFrom } from './browser-session/routes';
import { emptyJuliusActivity } from '../src/relay/mission/wonderland/wonderland-julius-activity';
import { ingestWonderlandRows } from '../src/relay/mission/wonderland/wonderland-ingress';
import type {
  WonderlandIngressGrant,
} from '../src/relay/mission/wonderland/wonderland-ingress';
import { openWonderlandCursor } from '../src/relay/mission/wonderland/wonderland-ordering';
import type { WonderlandLedgerRow } from '../src/relay/mission/wonderland/wonderland-ledger-adapter';
import type { WonderlandHydration } from '../src/relay/mission/wonderland/wonderland-hydration';

/** The largest page one request will serve. A cursor gets the rest. */
export const WONDERLAND_JULIUS_PAGE_LIMIT = 500;

/**
 * May this player read this project?
 *
 * DELIBERATELY ITS OWN PORT rather than a flag on the session. The answer is a
 * property of the project's membership, changes without the session changing,
 * and must be asked per request — a session issued while somebody was a member
 * must stop reading the moment they are not.
 */
export interface WonderlandProjectMembership {
  mayReadProject(input: {
    readonly playerId: string;
    readonly projectId: string;
  }): Promise<boolean>;
}

/** What the routes need from Julius. Read-only, and narrow on purpose. */
export interface WonderlandJuliusReader {
  /**
   * The run as it stands, plus the ledger position it is consistent with.
   *
   * BOTH IN ONE CALL, because they must be read together. A revision from one
   * moment and a sequence from another describe a run that never existed, and
   * the whole value of the position is that it says which events the state
   * already includes.
   */
  hydrate(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly worldSessionId: string | null;
  }): Promise<WonderlandHydration | null>;

  /** Ledger rows after a cursor, for one run, oldest first. */
  events(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly afterSequence: number;
    readonly limit: number;
  }): Promise<{ readonly rows: readonly WonderlandLedgerRow[]; readonly revision: number }>;
}

export interface WonderlandJuliusRouteRequest {
  readonly method: string;
  readonly path: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly now: number;
}

export interface WonderlandJuliusRouteDeps {
  readonly sessions: BrowserSessionStore;
  readonly reader?: WonderlandJuliusReader;
  readonly membership?: WonderlandProjectMembership;
  readonly response?: ServerResponse;
  readonly request?: IncomingMessage;
  readonly heartbeatMs?: number;
}

export type WonderlandJuliusRouteResult = { readonly status: number; readonly body: unknown } | null;

export function isWonderlandJuliusRoute(path: string): boolean {
  return path === '/wonderland/julius/hydrate' || path === '/wonderland/julius/events';
}

/**
 * The query a request carries, or a refusal.
 *
 * `runId` IS REQUIRED on both routes. A world watches one run — the cursor,
 * the sequence and the snapshot position are all per run — and a project-wide
 * Julius stream would interleave two runs' sequences into one cursor, where
 * the second run's third event is stale because the first reached three.
 */
export function readWonderlandJuliusQuery(
  url: string,
): { readonly projectId: string; readonly runId: string; readonly cursor: number } | null {
  const parsed = new URL(url, 'http://relay.invalid');
  const projectId = parsed.searchParams.get('projectId');
  const runId = parsed.searchParams.get('runId');
  if (projectId === null || projectId.trim() === '') return null;
  if (runId === null || runId.trim() === '') return null;
  const raw = parsed.searchParams.get('cursor');
  const cursor = raw === null ? 0 : Number(raw);
  // A cursor that is not a position is refused rather than clamped. Clamping a
  // client's bad cursor to 0 would silently replay a run from the beginning.
  if (!Number.isSafeInteger(cursor) || cursor < 0) return null;
  return { projectId, runId, cursor };
}

/**
 * Authorise a request, or say with what status to refuse it.
 *
 * FOUR REFUSALS, THREE OF THEM 4xx AND ONE 503, and the split is the point.
 * A missing session is 401, a non-member is 403, a bad query is 400 — those are
 * about the request. An unconfigured port is 503: the request was fine and this
 * deployment cannot answer it, which is an operator's problem rather than a
 * caller's, and reporting it as 403 would send somebody hunting permissions
 * that were never the issue.
 */
export async function authorizeWonderlandJulius(
  input: WonderlandJuliusRouteRequest,
  deps: WonderlandJuliusRouteDeps,
): Promise<
  | { readonly ok: true; readonly grant: WonderlandIngressGrant; readonly playerId: string; readonly cursor: number; readonly sessionId: string }
  | { readonly ok: false; readonly status: number; readonly error: string }
> {
  const query = readWonderlandJuliusQuery(input.url);
  if (query === null) {
    return { ok: false, status: 400, error: 'projectId, runId and a whole cursor are required' };
  }

  const token = sessionTokenFrom(input.authorization);
  const verified = token === null
    ? null
    : deps.sessions.verifySession({ token, origin: input.origin, now: input.now });
  if (verified === null || !verified.ok || verified.participantId === null) {
    return { ok: false, status: 401, error: 'authenticated player identity required' };
  }

  // FAIL CLOSED. See the header: a route that opened up when its authorisation
  // was unconfigured would work perfectly wherever nobody had wired it.
  if (!deps.membership || !deps.reader) {
    return {
      ok: false,
      status: 503,
      error: 'Julius world streaming is not configured on this deployment',
    };
  }

  const permitted = await deps.membership.mayReadProject({
    playerId: verified.participantId,
    projectId: query.projectId,
  });
  if (!permitted) return { ok: false, status: 403, error: 'permission denied' };

  return {
    ok: true,
    playerId: verified.participantId,
    sessionId: verified.sessionId,
    cursor: query.cursor,
    grant: { projectId: query.projectId, runId: query.runId },
  };
}

/**
 * Serve one page of the tail: read, ingest, and hand back what a world applies.
 *
 * The ingest is where every refusal lives, and it is the same function the
 * suite exercises against reconnects and mis-routed fan-outs. This adds
 * reading and nothing else — which is why it can be trusted without a server
 * in the loop.
 */
export async function serveWonderlandJuliusPage(
  grant: WonderlandIngressGrant,
  cursor: number,
  deps: { readonly reader: WonderlandJuliusReader; readonly worldSessionId: string | null },
): Promise<{
  readonly deliveries: readonly unknown[];
  readonly nextCursor: number;
  readonly summary: Readonly<Record<string, number>>;
}> {
  const page = await deps.reader.events({
    projectId: grant.projectId,
    runId: grant.runId as string,
    afterSequence: cursor,
    limit: WONDERLAND_JULIUS_PAGE_LIMIT,
  });

  const result = ingestWonderlandRows({
    grant,
    rows: page.rows,
    revision: page.revision,
    cursor: openWonderlandCursor({ projectId: grant.projectId, runId: grant.runId }),
    activity: emptyJuliusActivity({
      projectId: grant.projectId,
      runId: grant.runId as string,
    }),
    identity: { worldSessionId: deps.worldSessionId },
  });

  return {
    deliveries: result.deliveries,
    // THE LEDGER'S OWN POSITION, not the ingest's. A client resumes from where
    // the ROWS ended, so rows that were refused are not served again — a
    // refused row is still a row this client has now seen.
    nextCursor: page.rows.length === 0 ? cursor : page.rows[page.rows.length - 1].sequence,
    summary: result.refusals,
  };
}

/**
 * Handle a Julius world route. Returns null when the path is not one of ours.
 *
 * The SSE branch writes to the response and returns null, matching the battle
 * route's shape so the server's dispatch does not need a second convention.
 */
export async function handleWonderlandJuliusRoute(
  input: WonderlandJuliusRouteRequest,
  deps: WonderlandJuliusRouteDeps,
): Promise<WonderlandJuliusRouteResult> {
  if (!isWonderlandJuliusRoute(input.path) || input.method !== 'GET') return null;

  const authorized = await authorizeWonderlandJulius(input, deps);
  if (!authorized.ok) return { status: authorized.status, body: { error: authorized.error } };

  const reader = deps.reader as WonderlandJuliusReader;

  if (input.path === '/wonderland/julius/hydrate') {
    const hydration = await reader.hydrate({
      projectId: authorized.grant.projectId,
      runId: authorized.grant.runId as string,
      worldSessionId: authorized.sessionId,
    });
    if (hydration === null) return { status: 404, body: { error: 'run not found' } };
    return { status: 200, body: { data: hydration } };
  }

  const page = await serveWonderlandJuliusPage(authorized.grant, authorized.cursor, {
    reader,
    worldSessionId: authorized.sessionId,
  });

  const response = deps.response;
  if (response === undefined) {
    // No stream to write to — used by the suite, and by any caller that wants
    // one page rather than a subscription.
    return { status: 200, body: { data: page } };
  }

  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  for (const delivery of page.deliveries) {
    const envelope = (delivery as { envelope: { sequence: number } }).envelope;
    response.write(`id: ${envelope.sequence}\nevent: wonderland.envelope\ndata: ${JSON.stringify(delivery)}\n\n`);
  }
  // A transport heartbeat keeps intermediaries from closing a healthy stream.
  // It reads no state and is not polling, exactly as the battle stream's is.
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(': heartbeat\n\n');
  }, deps.heartbeatMs ?? 15_000);
  const close = (): void => {
    clearInterval(heartbeat);
    if (!response.writableEnded) response.end();
  };
  deps.request?.once('close', close);
  response.once('close', close);
  return null;
}
