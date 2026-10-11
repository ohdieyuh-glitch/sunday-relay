/**
 * THE JULIUS HALF OF THE WONDERLAND SEAM: THREE READ-ONLY ROUTES (row 12, R3').
 *
 * Carried by path from relay/wonderland-julius-integration 35917fda and adapted
 * to main. A world follows ONE run of ONE project through three GETs, and that is
 * the whole surface -- there is no write here, and no stream:
 *
 *   GET /wonderland/julius/hydrate           the snapshot. What is true now, in one
 *                                            payload, with the ledger position it is
 *                                            consistent with. A reconnect starts here.
 *   GET /wonderland/julius/events?mode=page  the tail, ONE PAGE per request: the
 *                                            deliveries after a cursor, ordered,
 *                                            scoped and folded, and the position the
 *                                            page ended at.
 *   GET /wonderland/julius/result            the run's USER RESULT (founder decision
 *                                            5): Julius's own result projected for a
 *                                            player, its exact cost only for a role
 *                                            that carries `read_mission_cost`.
 *
 * The client that reads these is the Unreal world (WonderlandJuliusStream.cpp):
 * every request carries `Authorization: Relay-Session <token>` and NO Origin, and
 * every 200 body is `{"data": ...}`. The schema strings and field rules it decodes
 * are pinned by `wonderland-julius-client-contract.test.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED FROM THE BRANCH, AND WHY (founder, 10-07: "read-only only; no
 * unintended mutation path; preserve tenant / project / run isolation; fail
 * closed; no secrets in response or logging; a deterministic contract").
 *
 *   READ ONLY BY CONSTRUCTION. Every database read a request makes runs inside
 *   ONE `BEGIN ... READ ONLY` transaction (`WonderlandJuliusWorld`, composed in
 *   `wonderland-julius-world.ts`). A coding error that tried to write would be
 *   refused by PostgreSQL itself (SQLSTATE 25006), not by a convention.
 *
 *   NO SERVER-SENT STREAM. The branch also served `/events` as SSE with a poll
 *   loop. Main serves the page form only: the client never used the stream, a
 *   held stream would check membership once at connect time where a page checks
 *   it on every read, and a server-side poll is load nobody asked for.
 *
 *   ONE NOT-FOUND. An absent run, another project's run, a non-member, a session
 *   of the wrong kind, a browser and the operator credential all get the SAME 404
 *   body. A 403 for "exists but not yours" beside a 404 for "absent" is an
 *   existence oracle, and a different status for each refusal is a membership one.
 *
 *   NATIVE ONLY (internal review N5, MAIN's ruling). The branch also admitted a
 *   signed-in browser through a second door; the founder's requirements never ask
 *   for one and the client never uses it, so it is gone: a request carrying an
 *   Origin is the one 404, whatever session it holds. A decided deviation from
 *   the design's Q1 lean -- see `identifyWonderlandJuliusCaller`.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WHY THESE ROUTES REFUSE TO RUN WITHOUT A WORLD
 *
 * A native session carries the player and the one project it was paired for. It
 * does not prove the player still belongs to that project, and the tempting
 * default -- a paired player may read their project -- is a cross-tenant read of
 * mission state, C.A.R.D. slots and spend the moment a membership is revoked. So
 * the membership authority is part of the world port and its absence is 503, not
 * 200. A route that opened up when its authorisation was unconfigured would work
 * perfectly in every environment where nobody had wired it.
 */

import { bearerMatches } from './bearer-auth';
import { isValidProjectId } from './browser-session/grants';
import type { BrowserSessionStore } from './browser-session/grants';
import { sessionTokenFrom } from './browser-session/routes';
import { WONDERLAND_WORLD_CAPABILITY } from './wonderland-native-pairing-routes';
import type { WonderlandProjectMembershipSource } from './wonderland-native-pairing-routes';
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
import { emptyJuliusActivity } from '../src/relay/mission/wonderland/wonderland-julius-activity';
import { ingestWonderlandRows } from '../src/relay/mission/wonderland/wonderland-ingress';
import type { WonderlandIngressGrant } from '../src/relay/mission/wonderland/wonderland-ingress';
import { openWonderlandCursor } from '../src/relay/mission/wonderland/wonderland-ordering';
import type { WonderlandLedgerRow } from '../src/relay/mission/wonderland/wonderland-ledger-adapter';
import { wonderlandHydrationVerdict } from '../src/relay/mission/wonderland/wonderland-hydration';
import type { WonderlandHydration } from '../src/relay/mission/wonderland/wonderland-hydration';
import { projectWonderlandJuliusResult } from '../src/relay/mission/wonderland/wonderland-julius-result';
import type { WonderlandJuliusBillingRecord } from '../src/relay/mission/wonderland/wonderland-julius-result';
import type {
  JuliusApiIdentity,
  JuliusApiResult,
  JuliusMissionResultView,
  JuliusSlotView,
  JuliusTimelineEntry,
  JuliusTimelinePage,
} from '../src/relay/mission/julius/julius-runtime-api';

/**
 * ONE DECLARATION OF EACH. Main's native pairing route declared the membership
 * port and the world capability while these routes were absent; they are the
 * same shape, so they are imported from there rather than declared twice.
 */
export { WONDERLAND_WORLD_CAPABILITY };
export type { WonderlandProjectMembershipSource };

/** The largest page one request will serve. A cursor gets the rest. */
export const WONDERLAND_JULIUS_PAGE_LIMIT = 500;

/**
 * A run id, as every other Julius route on this bridge accepts one
 * (julius-lifecycle-routes, project-brain-routes): the client sends `run:<hex>`
 * raw. Anything else cannot name a run, so it is answered as one that does not
 * exist -- and never travels into a log line.
 */
const RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/u;

/**
 * A cursor, as the client writes one: a plain non-negative decimal -- `0`, or a
 * digit 1-9 followed by digits. Its value must also be a safe integer
 * (`readWonderlandJuliusQuery`); internal review N4.
 */
const CURSOR = /^(0|[1-9]\d*)$/u;

/** What the routes need from Julius. Read-only, and narrow on purpose. */
export interface WonderlandJuliusReader {
  /**
   * The run as it stands, plus the ledger position it is consistent with, or null
   * when THIS PROJECT has no such run.
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

  /**
   * Ledger rows after a cursor, for one run, oldest first -- or null when THIS
   * PROJECT has no such run, so the page route answers an absent run exactly as
   * the other two do. (On the branch an absent run read as an empty page: a 200
   * for a run that does not exist.)
   */
  events(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly afterSequence: number;
    readonly limit: number;
  }): Promise<{ readonly rows: readonly WonderlandLedgerRow[]; readonly revision: number } | null>;
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
  /**
   * WHO PAID, for a viewer who may see cost -- and ONLY asked for one: a
   * member's request never reads it. Julius's slots and settlements, or null
   * when the project has no such run. Must THROW when it cannot answer, like
   * `result`. A source without it projects every role's billing UNKNOWN.
   */
  billing?(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly actorId: string;
  }): Promise<WonderlandJuliusBillingRecord | null>;
}

/**
 * EVERYTHING A REQUEST MAY READ, BOUND TO ONE READ-ONLY TRANSACTION.
 *
 * The three reads are handed over together because they must come from one
 * database and one snapshot: a membership answer from one moment authorising a
 * read taken at another is two databases' worth of truth in one response.
 */
export interface WonderlandJuliusReadScope {
  readonly membership: WonderlandProjectMembershipSource;
  readonly reader: WonderlandJuliusReader;
  readonly results: WonderlandJuliusResultSource;
}

/**
 * THE WORLD PORT. `read` opens one read-only transaction, hands its scope to
 * `work`, and closes it whatever happens. It must THROW when it cannot open one:
 * the route answers that with 503, never with a guess.
 *
 * The production composition is `wonderlandJuliusWorld` (wonderland-julius-world.ts):
 * `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY` on the world's
 * own pool (`createWonderlandJuliusWorldPool`: the Julius database, at most four
 * connections, every session read-only by default; internal review M1+M2).
 */
export interface WonderlandJuliusWorld {
  read<T>(work: (scope: WonderlandJuliusReadScope) => Promise<T>): Promise<T>;
}

/**
 * The most timeline pages one billing read walks. Past it the record is not
 * read whole, and the billing is not established -- never a prefix passed off
 * as the run.
 */
export const WONDERLAND_JULIUS_BILLING_MAX_PAGES = 200;

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
  inspectSlots(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<readonly JuliusSlotView[]>>;
  timeline(identity: JuliusApiIdentity, runId: string, sinceSequence?: number): Promise<JuliusApiResult<JuliusTimelinePage>>;
}): WonderlandJuliusResultSource {
  const identityFor = (projectId: string, actorId: string): JuliusApiIdentity =>
    ({ tenantId: WONDERLAND_WORLD_CALLER_TENANT, projectId, actorId, scopes: ['run:read'] });
  return {
    async result({ projectId, runId, actorId }) {
      const answer = await api.inspectResult(identityFor(projectId, actorId), runId);
      if (answer.ok) return answer.value;
      // Not found and not this project's are one answer in Julius, and one here.
      if (answer.reason === 'run_not_found') return null;
      // Anything else is this read being unable to answer -- never "no result".
      throw new Error(`Julius refused the world's result read: ${answer.reason}`);
    },
    async billing({ projectId, runId, actorId }) {
      const identity = identityFor(projectId, actorId);
      const slots = await api.inspectSlots(identity, runId);
      if (!slots.ok) {
        if (slots.reason === 'run_not_found') return null;
        throw new Error(`Julius refused the world's billing read: ${slots.reason}`);
      }
      // EVERY PAGE, OR NOT WHOLE. A billing read that stopped at a prefix would
      // name a path for a role whose later settlement it never saw.
      const settlements: JuliusTimelineEntry[] = [];
      let whole = true;
      let cursor = 0;
      for (let page = 0; ; page += 1) {
        if (page === WONDERLAND_JULIUS_BILLING_MAX_PAGES) { whole = false; break; }
        const answer = await api.timeline(identity, runId, cursor);
        if (!answer.ok) {
          if (answer.reason === 'run_not_found') return null;
          throw new Error(`Julius refused the world's billing read: ${answer.reason}`);
        }
        if (answer.value.gapDetected) whole = false;
        for (const entry of answer.value.entries) {
          if (entry.type === 'budget.settled') settlements.push(entry);
        }
        if (!answer.value.hasMore) break;
        // A cursor that does not move would walk forever and read nothing new.
        if (answer.value.nextCursor <= cursor) { whole = false; break; }
        cursor = answer.value.nextCursor;
      }
      return { slots: slots.value, settlements, whole };
    },
  };
}

export interface WonderlandJuliusRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly now: number;
}

export interface WonderlandJuliusRouteDeps {
  readonly sessions: BrowserSessionStore;
  /** The read-only world. Absent or null, every authenticated request is 503: fail closed. */
  readonly world?: WonderlandJuliusWorld | null;
  /**
   * The bridge's operator credential, so these routes can REFUSE it. An operator
   * is not a player: it belongs to no project, so a player's world has nothing to
   * show it, and it is answered exactly like any other caller with no business
   * here.
   */
  readonly operatorToken?: string;
  /**
   * The role table decisions are made against. Absent in production, where it is
   * the canonical `WONDERLAND_ROLE_CAPABILITIES`; injected only so a test can
   * reach a role the product does not write yet -- the member who may read a
   * result but not its cost -- without unfreezing the canonical table.
   */
  readonly roleCapabilities?: Readonly<Record<string, readonly WonderlandProjectCapability[]>>;
  /** Called with every decision, granted or not. For an operator's log only. */
  readonly onAuthorization?: (decision: WonderlandAuthorizationDecision) => void;
  /**
   * One line per refused or failed request: the route, the status, a fixed
   * reason word and identifiers that passed their shape checks. Never a body,
   * never run content, never an error message (a driver's message can quote a
   * value).
   */
  readonly log?: (line: string) => void;
}

export type WonderlandJuliusRouteResult = { readonly status: number; readonly body: unknown } | null;

const ROUTES = {
  '/wonderland/julius/hydrate': 'hydrate',
  '/wonderland/julius/events': 'events',
  '/wonderland/julius/result': 'result',
} as const;
type WonderlandJuliusRouteName = (typeof ROUTES)[keyof typeof ROUTES];

export function isWonderlandJuliusRoute(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(ROUTES, path);
}

/**
 * THE ONE NOT-FOUND, frozen so every refusal that uses it is byte-identical:
 * absent, another project's, not a member, the wrong kind of session, the
 * operator. The decision behind it goes to the operator's log and nowhere else.
 */
export const WONDERLAND_JULIUS_NOT_FOUND = Object.freeze({ error: WONDERLAND_DENIAL_MESSAGE });

const NOT_FOUND = (): { readonly status: number; readonly body: unknown } => ({ status: 404, body: WONDERLAND_JULIUS_NOT_FOUND });
const UNAVAILABLE = (): { readonly status: number; readonly body: unknown } =>
  ({ status: 503, body: { error: WONDERLAND_UNAVAILABLE_MESSAGE } });
const SIGN_IN = (): { readonly status: number; readonly body: unknown } =>
  ({ status: 401, body: { error: 'authenticated player identity required' } });
const BAD_QUERY = (message: string): { readonly status: number; readonly body: unknown } =>
  ({ status: 400, body: { error: message } });

/**
 * The query a request carries, or a refusal.
 *
 * `runId` IS REQUIRED on every route. A world watches one run -- the cursor,
 * the sequence and the snapshot position are all per run -- and a project-wide
 * Julius stream would interleave two runs' sequences into one cursor, where
 * the second run's third event is stale because the first reached three.
 */
export function readWonderlandJuliusQuery(
  url: string,
): { readonly projectId: string; readonly runId: string; readonly cursor: number; readonly mode: string | null } | null {
  const parsed = new URL(url, 'http://relay.invalid');
  const projectId = parsed.searchParams.get('projectId');
  const runId = parsed.searchParams.get('runId');
  if (projectId === null || projectId.trim() === '') return null;
  if (runId === null || runId.trim() === '') return null;
  const raw = parsed.searchParams.get('cursor');
  // A cursor that is not a position is refused rather than clamped. Clamping a
  // client's bad cursor to 0 would silently replay a run from the beginning.
  // ONLY A PLAIN DECIMAL is a position (internal review N4): `Number()` alone
  // read `0x10` as 16, `1e3` as 1000 and `+5` as 5. The client writes `%lld`
  // (RunQuery, WonderlandJuliusStream.cpp): digits, no sign, no leading zero.
  if (raw !== null && !CURSOR.test(raw)) return null;
  const cursor = raw === null ? 0 : Number(raw);
  if (!Number.isSafeInteger(cursor)) return null;
  return { projectId, runId, cursor, mode: parsed.searchParams.get('mode') };
}

/** Who is calling, from the credential alone -- no database is touched to answer it. */
export type WonderlandJuliusCaller =
  | {
    readonly ok: true;
    readonly playerId: string;
    readonly sessionId: string;
    /** The ONE project the native session was paired for (founder decision 2). */
    readonly boundProjectId: string;
  }
  | { readonly ok: false; readonly status: 401 | 404; readonly reason: string };

/**
 * WHO IS CALLING -- ONE DOOR, the native client's, and nothing else gets in.
 *
 * NATIVE-ONLY (internal review N5, MAIN's ruling; a DECIDED DEVIATION from the
 * design's Q1 lean, which kept the branch's browser door beside the native one).
 * The founder's requirements never ask for a browser to read these routes, and
 * the one client that does is the Unreal world, which sends NO Origin
 * (WonderlandJuliusStream.cpp NewRequest). A browser door only added surface: a
 * `browser_control` token is not bound to one project, so a leaked one would read
 * every project where its player is an owner. So:
 *
 *   NO SESSION is 401, Origin or not: the client pairs again (R3).
 *   AN ORIGIN is the one 404 for EVERY credential -- a valid native session
 *   included -- and no session is even looked up for it: a web page has no door
 *   here, and since any caller can send any Origin, the rule is the header's.
 *   NO ORIGIN: `verifyNativeSession` accepts only a `native_world` session bound
 *   to NATIVE_WORLD_AUDIENCE and to one project. Any other session -- a browser
 *   session copied into a native client, the cookie copy the founder ruled out --
 *   is the wrong kind, however valid: the one 404. Expired or revoked: 401.
 *   THE OPERATOR CREDENTIAL is the one 404: an operator is not a player.
 */
export function identifyWonderlandJuliusCaller(
  input: Pick<WonderlandJuliusRouteRequest, 'authorization' | 'origin' | 'now'>,
  deps: Pick<WonderlandJuliusRouteDeps, 'sessions' | 'operatorToken'>,
): WonderlandJuliusCaller {
  if (bearerMatches(input.authorization, deps.operatorToken)) {
    return { ok: false, status: 404, reason: 'operator_is_not_a_player' };
  }
  const token = sessionTokenFrom(input.authorization);
  if (token === null) return { ok: false, status: 401, reason: 'no_session' };
  if (input.origin !== undefined) return { ok: false, status: 404, reason: 'a_browser_has_no_door' };

  const native = deps.sessions.verifyNativeSession({ token, now: input.now });
  if (native.ok) {
    return { ok: true, playerId: native.participantId, sessionId: native.sessionId, boundProjectId: native.projectId };
  }
  return native.reason === 'not_native'
    ? { ok: false, status: 404, reason: 'not_a_native_session' }
    : { ok: false, status: 401, reason: `session_${native.reason}` };
}

/**
 * Serve one page of the tail: read, ingest, and hand back what a world applies.
 * Null when the project has no such run.
 *
 * The ingest is where every refusal lives, and it is the same function the
 * suite exercises against reconnects and mis-routed fan-outs. This adds
 * reading and nothing else -- which is why it can be trusted without a server
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
} | null> {
  const page = await deps.reader.events({
    projectId: grant.projectId,
    runId: grant.runId as string,
    afterSequence: cursor,
    limit: WONDERLAND_JULIUS_PAGE_LIMIT,
  });
  if (page === null) return null;

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
    // the ROWS ended, so rows that were refused are not served again -- a
    // refused row is still a row this client has now seen.
    nextCursor: page.rows.length === 0 ? cursor : page.rows[page.rows.length - 1].sequence,
    summary: result.refusals,
  };
}

/**
 * Handle a Julius world route. Returns null when the path or the method is not
 * one of ours (only GET is routed, so a write to one of these paths reaches the
 * Wonderland family exactly as it did before they existed).
 *
 * THE ORDER IS THE POLICY:
 *   1. the caller, from the credential alone (401 / the one 404, which is also
 *      every request carrying an Origin) -- no database is touched, and nothing
 *      about the query is answered, for a caller who is not identified (internal
 *      review N1: an anonymous malformed request is 401, never 400);
 *   2. the query (400), for an identified caller -- nothing is looked up for a
 *      request that names nothing;
 *   3. identifiers that cannot exist, and a native session asking for a project
 *      it was not paired for (the one 404);
 *   4. a deployment that cannot answer (503);
 *   5. INSIDE ONE READ-ONLY TRANSACTION: membership, asked fresh on every
 *      request (the one 404, or 503 when it cannot be asked), then the run,
 *      looked up by (project, run) and never by run alone (the one 404).
 */
export async function handleWonderlandJuliusRoute(
  input: WonderlandJuliusRouteRequest,
  deps: WonderlandJuliusRouteDeps,
): Promise<WonderlandJuliusRouteResult> {
  if (!isWonderlandJuliusRoute(input.path) || input.method !== 'GET') return null;
  const route: WonderlandJuliusRouteName = ROUTES[input.path as keyof typeof ROUTES];
  const note = (status: number, reason: string, ids: { projectId?: string; runId?: string; playerId?: string } = {}): void => {
    const named = [
      ids.playerId === undefined ? null : `player=${ids.playerId}`,
      ids.projectId === undefined ? null : `project=${ids.projectId}`,
      ids.runId === undefined ? null : `run=${ids.runId}`,
    ].filter((part): part is string => part !== null);
    deps.log?.(`wonderland julius ${route}: ${status} ${reason}${named.length === 0 ? '' : ` ${named.join(' ')}`}`);
  };

  // WHO IS CALLING, BEFORE WHAT IT ASKED (internal review N1). A caller who is not identified is answered 401 for
  // any query, well-formed or not -- R3's wording -- and one refused for who it is gets the one 404 whatever it asked.
  const caller = identifyWonderlandJuliusCaller(input, deps);
  if (!caller.ok) {
    // An anonymous caller is not logged: a scanner would fill the log with nothing an operator can act on.
    if (caller.status === 401) return SIGN_IN();
    note(404, caller.reason);
    return NOT_FOUND();
  }

  // ONLY NOW THE QUERY: an identified caller's malformed request is 400.
  const query = readWonderlandJuliusQuery(input.url);
  if (query === null) return BAD_QUERY('projectId, runId and a whole cursor are required');
  if (route === 'events' && query.mode !== 'page') {
    return BAD_QUERY('the events route serves one page per request: send mode=page');
  }

  // NOTHING CAN BE NAMED BY A MALFORMED ID, so it is answered as absent -- and kept out of every log line.
  if (!isValidProjectId(query.projectId) || !RUN_ID.test(query.runId)) {
    note(404, 'no_such_run', { playerId: caller.playerId });
    return NOT_FOUND();
  }
  const ids = { playerId: caller.playerId, projectId: query.projectId, runId: query.runId };

  // A NATIVE SESSION IS BOUND TO THE PROJECT IT WAS PAIRED FOR (founder decision 2). Asking for another is
  // refused before membership is consulted -- and membership still applies below, so neither guard stands alone.
  if (caller.boundProjectId !== query.projectId) {
    note(404, 'session_paired_for_another_project', ids);
    return NOT_FOUND();
  }

  // FAIL CLOSED. A route that opened up when its authorisation was unconfigured would work perfectly
  // wherever nobody had wired it.
  const world = deps.world ?? null;
  if (world === null) {
    note(503, 'world_not_configured', ids);
    return UNAVAILABLE();
  }

  const capability: WonderlandProjectCapability = route === 'result' ? 'read_mission_result' : WONDERLAND_WORLD_CAPABILITY;
  const grant: WonderlandIngressGrant = { projectId: query.projectId, runId: query.runId };
  try {
    return await world.read(async (scope) => {
      // THE PROJECT IN THE QUERY IS A REQUEST TO BE AUTHORISED, NEVER AN AUTHORISATION. And it is the only
      // source of project identity here: nothing resolves a project from the RUN id, which is equally
      // attacker-controlled. The run is checked against the AUTHORISED project, never the other way round.
      const membership: WonderlandMembership | null = await scope.membership.lookup({
        playerId: caller.playerId,
        projectId: query.projectId,
      });
      const decision = authorizeWonderlandProjectCapability(
        { playerId: caller.playerId, projectId: query.projectId, capability },
        membership,
        deps.roleCapabilities,
      );
      deps.onAuthorization?.(decision);
      if (!decision.granted || membership === null) {
        note(404, decision.verdict, ids);
        return NOT_FOUND();
      }

      if (route === 'result') {
        const view = await scope.results.result({ projectId: query.projectId, runId: query.runId, actorId: caller.playerId });
        // NOT FOUND AND NOT YOURS LOOK THE SAME. And the answer must be the run that was asked for: a source
        // that answered for another would be the one thing between this caller and somebody else's mission.
        if (view === null || view.runId !== query.runId) {
          note(404, 'no_such_run', ids);
          return NOT_FOUND();
        }
        // THE SAME MEMBERSHIP ROW, A NARROWER QUESTION: may this player see the run's exact spend?
        const costDecision = authorizeWonderlandProjectCapability(
          { playerId: caller.playerId, projectId: query.projectId, capability: 'read_mission_cost' },
          membership,
          deps.roleCapabilities,
        );
        deps.onAuthorization?.(costDecision);
        // WHO PAID is read only for a viewer who may see cost: a member's request never touches it.
        const billing = costDecision.granted && scope.results.billing !== undefined
          ? await scope.results.billing({ projectId: query.projectId, runId: query.runId, actorId: caller.playerId })
          : null;
        return { status: 200, body: { data: projectWonderlandJuliusResult(view, { includeCost: costDecision.granted, billing }) } };
      }

      if (route === 'hydrate') {
        const hydration = await scope.reader.hydrate({
          projectId: query.projectId,
          runId: query.runId,
          worldSessionId: caller.sessionId,
        });
        // THE RUN IS CHECKED AGAINST THE AUTHORISED PROJECT -- and against the run that was asked for --
        // here rather than trusted to the reader. A reader that filtered correctly makes this redundant;
        // a reader that did not makes it the only thing between a tenant and somebody else's mission.
        if (hydration === null || hydration.run.runId !== query.runId
          || wonderlandHydrationVerdict(query.projectId, hydration) !== 'accepted') {
          note(404, 'no_such_run', ids);
          return NOT_FOUND();
        }
        return { status: 200, body: { data: hydration } };
      }

      const page = await serveWonderlandJuliusPage(grant, query.cursor, {
        reader: scope.reader,
        worldSessionId: caller.sessionId,
      });
      if (page === null) {
        note(404, 'no_such_run', ids);
        return NOT_FOUND();
      }
      return { status: 200, body: { data: page } };
    });
  } catch (error) {
    // THE STORE COULD NOT ANSWER. Not a denial and not "no such run": the request may have been perfectly
    // authorised. Only a SQLSTATE-shaped code reaches the log -- never a driver's message, which can quote a value.
    const code = typeof (error as { code?: unknown } | null)?.code === 'string'
      && /^[0-9A-Z]{5}$/u.test((error as { code: string }).code) ? (error as { code: string }).code : 'none';
    note(503, `store_unavailable sqlstate=${code}`, ids);
    return UNAVAILABLE();
  }
}
