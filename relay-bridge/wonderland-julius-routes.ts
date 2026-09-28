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
 * AND ONE FOR THE END OF THE LOOP (founder decision 5, 2026-09-27):
 *
 *   GET /wonderland/julius/result    the run's USER RESULT -- Julius's own
 *                                    result, projected for a player, with its
 *                                    exact cost only for a role that carries
 *                                    `read_mission_cost`.
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
import {
  WONDERLAND_DENIAL_MESSAGE,
  WONDERLAND_UNAVAILABLE_MESSAGE,
  authorizeWonderlandProjectCapability,
} from '../src/relay/mission/wonderland/wonderland-authorization';
import type {
  WonderlandAuthorizationDecision,
  WonderlandMembership,
  WonderlandProjectCapability,
} from '../src/relay/mission/wonderland/wonderland-authorization';
import { sessionTokenFrom } from './browser-session/routes';
import { emptyJuliusActivity } from '../src/relay/mission/wonderland/wonderland-julius-activity';
import { ingestWonderlandRows } from '../src/relay/mission/wonderland/wonderland-ingress';
import type {
  WonderlandIngressGrant,
} from '../src/relay/mission/wonderland/wonderland-ingress';
import { openWonderlandCursor } from '../src/relay/mission/wonderland/wonderland-ordering';
import type { WonderlandLedgerRow } from '../src/relay/mission/wonderland/wonderland-ledger-adapter';
import { wonderlandHydrationVerdict } from '../src/relay/mission/wonderland/wonderland-hydration';
import type { WonderlandHydration } from '../src/relay/mission/wonderland/wonderland-hydration';
import { projectWonderlandJuliusResult } from '../src/relay/mission/wonderland/wonderland-julius-result';
import type {
  JuliusApiIdentity,
  JuliusApiResult,
  JuliusMissionResultView,
} from '../src/relay/mission/julius/julius-runtime-api';

/** The largest page one request will serve. A cursor gets the rest. */
export const WONDERLAND_JULIUS_PAGE_LIMIT = 500;

/**
 * The canonical membership record for one player in one project, or null.
 *
 * DELIBERATELY ITS OWN PORT rather than a flag on the session. Membership is a
 * property of the project, changes without the session changing, and must be
 * asked per request — a session issued while somebody was a member has to stop
 * reading the moment they are not.
 *
 * THE PORT RETURNS THE RECORD, NOT A VERDICT. The decision lives in
 * `wonderland-authorization.ts` where it is pure and tested; a port that
 * answered yes-or-no would put an authorisation decision inside whatever
 * happened to implement it, and there would be as many decisions as
 * implementations.
 *
 * NULL MEANS NO ROW. An implementation that cannot reach its store must THROW,
 * not return null — those are different facts with different safe answers, and
 * a lookup failure read as an absence is a denial where a 503 belonged.
 */
export interface WonderlandProjectMembershipSource {
  lookup(input: {
    readonly playerId: string;
    readonly projectId: string;
  }): Promise<WonderlandMembership | null>;
}

/** The capability every route here requires. Read-only, and narrowed further downstream. */
export const WONDERLAND_WORLD_CAPABILITY: WonderlandProjectCapability = 'read_world_state';

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

/**
 * JULIUS'S OWN RESULT FOR ONE RUN -- `JuliusRuntimeApi.inspectResult` -- or null
 * when the project has no such run. The route projects it for a player; the
 * source never does, so there is one answer to "did it work" and it is Julius's.
 *
 * Must THROW when it cannot answer, for the reason the membership port must: an
 * absence and a failure are different facts with different safe answers.
 */
export interface WonderlandJuliusResultSource {
  result(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly actorId: string;
  }): Promise<JuliusMissionResultView | null>;
}

/**
 * THE TENANT THE WORLD PRESENTS TO JULIUS, and why it is a name and not a value.
 *
 * Julius's API asks every caller for a tenant, a project and an actor, and
 * scopes a run by PROJECT: `loadRun(runId, projectId)`, and a run row carries no
 * tenant at all. The world knows the player, and the project its membership
 * authorised -- no tenant. So it names its own context, which grants nothing:
 * the run is found under the project the MEMBERSHIP authorised, or not at all.
 * If Julius ever scopes runs by tenant, this must change with it.
 */
export const WONDERLAND_WORLD_CALLER_TENANT = 'wonderland' as const;

/** The world's result read, through Julius's own API and nothing else. */
export function wonderlandJuliusResultsFrom(api: {
  inspectResult(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<JuliusMissionResultView>>;
}): WonderlandJuliusResultSource {
  return {
    async result({ projectId, runId, actorId }) {
      const answer = await api.inspectResult(
        { tenantId: WONDERLAND_WORLD_CALLER_TENANT, projectId, actorId, scopes: ['run:read'] },
        runId,
      );
      if (answer.ok) return answer.value;
      // Not found and not this project's are one answer in Julius, and one here.
      if (answer.reason === 'run_not_found') return null;
      // Anything else is this read being unable to answer -- never "no result".
      throw new Error(`Julius refused the world's result read: ${answer.reason}`);
    },
  };
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
  readonly membership?: WonderlandProjectMembershipSource;
  /** Julius's result for a run. Absent, `/wonderland/julius/result` answers 503: fail closed, like the others. */
  readonly results?: WonderlandJuliusResultSource;
  /**
   * The role table decisions are made against. Absent in production, where it is
   * the canonical `WONDERLAND_ROLE_CAPABILITIES`; injected only so a test can
   * reach a role the product does not write yet -- the member who may read a
   * result but not its cost -- without unfreezing the canonical table.
   */
  readonly roleCapabilities?: Readonly<Record<string, readonly WonderlandProjectCapability[]>>;
  /** Called with every decision, granted or not. For an operator's log only. */
  readonly onAuthorization?: (decision: WonderlandAuthorizationDecision) => void;
  readonly response?: ServerResponse;
  readonly request?: IncomingMessage;
  readonly heartbeatMs?: number;
  /** How often an open stream reads the ledger for rows after its cursor. */
  readonly pollMs?: number;
}

/**
 * How often an open Julius stream reads for new rows. One indexed read per open
 * stream per interval. See the stream body for why this exists at all, and why
 * a push from the appender should replace it.
 */
export const WONDERLAND_JULIUS_POLL_MS = 1_000;

export type WonderlandJuliusRouteResult = { readonly status: number; readonly body: unknown } | null;

export function isWonderlandJuliusRoute(path: string): boolean {
  return path === '/wonderland/julius/hydrate' || path === '/wonderland/julius/events'
    || path === '/wonderland/julius/result';
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
  /** What the caller must be able to do. The world stream by default; a run's result asks for `read_mission_result`. */
  capability: WonderlandProjectCapability = WONDERLAND_WORLD_CAPABILITY,
): Promise<
  | {
    readonly ok: true;
    readonly grant: WonderlandIngressGrant;
    readonly playerId: string;
    readonly cursor: number;
    readonly sessionId: string;
    /** The row the decision was made from, so a route can ask a NARROWER question of the same record. Never sent. */
    readonly membership: WonderlandMembership;
  }
  | { readonly ok: false; readonly status: number; readonly error: string }
> {
  const query = readWonderlandJuliusQuery(input.url);
  if (query === null) {
    return { ok: false, status: 400, error: 'projectId, runId and a whole cursor are required' };
  }
  // The world routes read Julius; a bridge without the reader is as unconfigured as one without membership.
  const caller = await authorizeWonderlandCaller(input, query.projectId, deps, capability, deps.reader !== undefined);
  if (!caller.ok) return caller;
  return {
    ok: true,
    playerId: caller.playerId,
    sessionId: caller.sessionId,
    cursor: query.cursor,
    grant: { projectId: query.projectId, runId: query.runId },
    membership: caller.membership,
  };
}

/**
 * WHO IS CALLING, AND MAY THEY DO THIS TO THIS PROJECT -- the world routes' caller
 * check, shared with every Wonderland route that acts for a player on a project
 * (the result read, the player's mission creation).
 *
 * The refusals come in the order the world routes have always given them: no
 * verifiable player is 401; an unconfigured bridge is 503 (`available` false, or
 * no membership port); a membership that does not carry `capability` is 403 in
 * one sentence. The PROJECT is the caller's request, never an authorisation --
 * the membership row is what makes it one.
 */
export async function authorizeWonderlandCaller(
  input: { readonly authorization: string | undefined; readonly origin: string | undefined; readonly now: number },
  projectId: string,
  deps: Pick<WonderlandJuliusRouteDeps, 'sessions' | 'membership' | 'roleCapabilities' | 'onAuthorization'>,
  capability: WonderlandProjectCapability,
  available = true,
): Promise<
  | { readonly ok: true; readonly playerId: string; readonly sessionId: string; readonly membership: WonderlandMembership }
  | { readonly ok: false; readonly status: number; readonly error: string }
> {
  const token = sessionTokenFrom(input.authorization);
  // TWO KINDS OF CALLER, AND THE ORIGIN HEADER TELLS THEM APART.
  //
  // A BROWSER sends an Origin, and its session is checked against it. A NATIVE
  // Wonderland client sends none -- and `verifySession` skips the origin check
  // when there is no Origin, so a browser session token copied into a native
  // client would pass it. That copy is what the founder ruled out, so an
  // originless caller is verified ONLY by `verifyNativeSession`, which accepts a
  // `native_world` session and refuses every browser session however valid.
  // Conversely a native session presented from a web page carries that page's
  // Origin and fails the audience check inside `verifySession`; it is refused
  // again here by scope, so neither guard stands alone.
  let verified: { readonly ok: true; readonly participantId: string; readonly sessionId: string } | null = null;
  if (token !== null) {
    if (input.origin === undefined) {
      const native = deps.sessions.verifyNativeSession({ token, now: input.now });
      // A NATIVE SESSION IS BOUND TO THE PROJECT IT WAS PAIRED FOR (founder decision 2). Asking for another
      // project is refused here, before membership is even consulted -- membership still applies below, so
      // neither guard stands alone.
      if (native.ok && native.projectId !== projectId) {
        return { ok: false, status: 403, error: 'this desktop session was paired for another project' };
      }
      if (native.ok) verified = { ok: true, participantId: native.participantId, sessionId: native.sessionId };
    } else {
      const browser = deps.sessions.verifySession({ token, origin: input.origin, now: input.now });
      if (browser.ok && browser.participantId !== null && browser.scope !== 'native_world') {
        verified = { ok: true, participantId: browser.participantId, sessionId: browser.sessionId };
      }
    }
  }
  if (verified === null) {
    return { ok: false, status: 401, error: 'authenticated player identity required' };
  }

  // FAIL CLOSED. See the header: a route that opened up when its authorisation
  // was unconfigured would work perfectly wherever nobody had wired it.
  if (!available || !deps.membership) {
    return { ok: false, status: 503, error: WONDERLAND_UNAVAILABLE_MESSAGE };
  }

  // THE PROJECT ID IN THE QUERY IS A REQUEST TO BE AUTHORISED, NEVER AN
  // AUTHORISATION. It arrived from a browser and the session does not carry
  // one, so the only thing that makes it trustworthy is this lookup.
  //
  // AND IT IS THE ONLY SOURCE OF PROJECT IDENTITY HERE. Nothing resolves a
  // project from the RUN id, which is equally attacker-controlled: doing so
  // would let somebody name a run they have no rights to, have the server
  // discover its project, and be authorised against the project they just
  // caused it to pick. The run is checked against the AUTHORISED project
  // later, never the other way round.
  let membership: WonderlandMembership | null;
  try {
    membership = await deps.membership.lookup({
      playerId: verified.participantId,
      projectId,
    });
  } catch {
    // A store that could not answer is NOT a denial. The request may have been
    // perfectly authorised; reporting it as denied sends an operator hunting
    // permissions that were never the issue, and reporting it as granted would
    // be the worst outcome available.
    return { ok: false, status: 503, error: WONDERLAND_UNAVAILABLE_MESSAGE };
  }

  const decision = authorizeWonderlandProjectCapability(
    {
      playerId: verified.participantId,
      projectId,
      capability,
    },
    membership,
    deps.roleCapabilities,
  );
  deps.onAuthorization?.(decision);
  if (!decision.granted || membership === null) {
    // ONE SENTENCE FOR EVERY DENIAL. The decision knows more and that stays in
    // the log: a body that said "not a member" where another said "no such
    // project" is a membership oracle.
    return { ok: false, status: 403, error: WONDERLAND_DENIAL_MESSAGE };
  }

  return { ok: true, playerId: verified.participantId, sessionId: verified.sessionId, membership };
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

  const wantsResult = input.path === '/wonderland/julius/result';
  const authorized = await authorizeWonderlandJulius(
    input, deps, wantsResult ? 'read_mission_result' : WONDERLAND_WORLD_CAPABILITY);
  if (!authorized.ok) return { status: authorized.status, body: { error: authorized.error } };

  /*
   * THE RUN'S USER RESULT (founder decision 5). Julius's own result, projected
   * for a player by `projectWonderlandJuliusResult`: what it made, whether each
   * criterion was met, what is still open, why it ended -- and its exact cost
   * only when the SAME membership row also carries `read_mission_cost`.
   */
  if (wantsResult) {
    if (!deps.results) return { status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } };
    let view: JuliusMissionResultView | null;
    try {
      view = await deps.results.result({
        projectId: authorized.grant.projectId,
        runId: authorized.grant.runId as string,
        actorId: authorized.playerId,
      });
    } catch {
      // Julius could not answer. Not "no result", and not a denial.
      return { status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } };
    }
    // NOT FOUND AND NOT YOURS LOOK THE SAME, as on hydrate. And the answer must be
    // the run that was asked for: a source that answered for another would be the
    // one thing between this caller and somebody else's mission.
    if (view === null || view.runId !== authorized.grant.runId) {
      return { status: 404, body: { error: WONDERLAND_DENIAL_MESSAGE } };
    }
    const costDecision = authorizeWonderlandProjectCapability(
      { playerId: authorized.playerId, projectId: authorized.grant.projectId, capability: 'read_mission_cost' },
      authorized.membership,
      deps.roleCapabilities,
    );
    deps.onAuthorization?.(costDecision);
    return { status: 200, body: { data: projectWonderlandJuliusResult(view, { includeCost: costDecision.granted }) } };
  }

  const reader = deps.reader as WonderlandJuliusReader;

  if (input.path === '/wonderland/julius/hydrate') {
    const hydration = await reader.hydrate({
      projectId: authorized.grant.projectId,
      runId: authorized.grant.runId as string,
      worldSessionId: authorized.sessionId,
    });
    // NOT FOUND AND NOT YOURS LOOK THE SAME. A 404 that only appeared for runs
    // that do not exist would confirm the existence of every run that does.
    if (hydration === null) return { status: 404, body: { error: WONDERLAND_DENIAL_MESSAGE } };

    // THE RUN IS CHECKED AGAINST THE AUTHORISED PROJECT, and this is the check
    // that stops the attack the whole route is shaped around: name somebody
    // else's run id, be authorised for a project you DO belong to, and read a
    // run you do not. The authorisation decided a project; the run must belong
    // to that project, not the other way round.
    //
    // Verified here rather than trusted to the reader. A reader that filtered
    // correctly makes this redundant, and a reader that did not makes it the
    // only thing standing between a tenant and somebody else's mission.
    if (wonderlandHydrationVerdict(authorized.grant.projectId, hydration) !== 'accepted') {
      return { status: 404, body: { error: WONDERLAND_DENIAL_MESSAGE } };
    }
    return { status: 200, body: { data: hydration } };
  }

  const page = await serveWonderlandJuliusPage(authorized.grant, authorized.cursor, {
    reader,
    worldSessionId: authorized.sessionId,
  });

  const response = deps.response;
  // ONE PAGE, ON REQUEST. `mode=page` answers exactly what the stream would send
  // first, as JSON, and ends. It is how a client that cannot hold an SSE stream
  // open -- the native Unreal client, whose HTTP module has no first-class SSE --
  // follows a run: read the page after its cursor, apply it, read again from
  // `nextCursor`. The deliveries are identical in both modes.
  const wantsPage = new URL(input.url, 'http://relay.invalid').searchParams.get('mode') === 'page';
  if (response === undefined || wantsPage) {
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
  const writeDeliveries = (deliveries: readonly unknown[]): void => {
    for (const delivery of deliveries) {
      const envelope = (delivery as { envelope: { sequence: number } }).envelope;
      response.write(`id: ${envelope.sequence}\nevent: wonderland.envelope\ndata: ${JSON.stringify(delivery)}\n\n`);
    }
  };
  writeDeliveries(page.deliveries);

  /*
   * THE STREAM IS LIVE ONLY IF SOMETHING FEEDS IT.
   *
   * Until 2026-09-27 this wrote the backlog once and then nothing but
   * heartbeats. The battle stream is fed by PostgresWonderlandFanout, whose
   * backend publishes a NOTIFY on every write; Julius's appends publish
   * nothing, and this route never subscribed to anything. So a world holding
   * this stream open received the run as it stood at connect time and then
   * silence -- and the heartbeat made that silence look healthy. A frozen
   * mission presented as a live one is the exact failure the founder ruled
   * out. It also served only the FIRST page of a backlog longer than
   * WONDERLAND_JULIUS_PAGE_LIMIT and never the rest.
   *
   * So the stream reads the ledger after its own cursor every `pollMs` and
   * sends what it finds. The cursor is the ledger position (`nextCursor`), so
   * nothing is sent twice and nothing is skipped, and a long backlog drains
   * page by page. One indexed read per open stream per second is cheap at beta
   * scale; a NOTIFY published by the Julius appender is the better design, and
   * it can replace this loop without any client noticing.
   *
   * A READ THAT FAILS ENDS THE STREAM. Carrying on with heartbeats over a
   * reader that cannot answer would be the same lie in a different place. An
   * ended stream is something a client can see: it marks itself stale and
   * reconnects, and reconnecting starts with a fresh hydrate.
   */
  let cursor = page.nextCursor;
  let closed = false;
  let reading = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (poll !== undefined) clearInterval(poll);
    if (heartbeat !== undefined) clearInterval(heartbeat);
    if (!response.writableEnded) response.end();
  };
  const readOnward = async (): Promise<void> => {
    if (closed || reading) return;
    reading = true;
    try {
      const next = await serveWonderlandJuliusPage(authorized.grant, cursor, {
        reader,
        worldSessionId: authorized.sessionId,
      });
      if (closed) return;
      writeDeliveries(next.deliveries);
      cursor = next.nextCursor;
    } catch {
      close();
    } finally {
      reading = false;
    }
  };
  poll = setInterval(() => { void readOnward(); }, deps.pollMs ?? WONDERLAND_JULIUS_POLL_MS);
  // A transport heartbeat keeps intermediaries from closing a healthy stream.
  // Now that the stream reads, a heartbeat means what it appears to: alive AND
  // current to within one poll.
  heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(': heartbeat\n\n');
  }, deps.heartbeatMs ?? 15_000);
  deps.request?.once('close', close);
  response.once('close', close);
  return null;
}
