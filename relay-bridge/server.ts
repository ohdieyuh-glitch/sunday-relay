/**
 * Relay bridge HTTP server — the browser's only backend contract.
 *
 * Exposes a tiny mission API under /relay-api. The browser never talks to a
 * provider or the engine directly; it POSTs a mission start and POLLS status.
 * All provider work happens server-side (real Sunday Alcatraz over HTTP + real
 * Claude Code via the local CLI). Responses carry only normalized, redacted
 * read-models — no keys, no raw provider output, no stack traces.
 *
 *   GET  /relay-api/health
 *   POST /relay-api/mission/start           { missionId, objective }
 *   GET  /relay-api/mission/:id
 *   POST /relay-api/mission/:id/cancel
 *   POST /relay-api/mission/:id/retry
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadBridgeConfig, productionConfigProblems, productionConfigWarnings, type BridgeConfig,
} from './config';
import { createMissionRegistry, type MissionRegistry } from './mission';
import {
  architectPreflight, loadArchitectConfig, verifyArchitectConnection,
} from './openai-architect';
import { randomUUID } from 'node:crypto';
import { isLiveReachRoute, respondLiveReach } from './live-reach-route';
import { composeLoopRuns, loopCompositionCode } from './loop-composition';
import { createLiveReachService, type LiveReachService } from './live-reach-service';
import {
  bearerMatches, handleReviewerRoute, isReviewerRoute, type ReviewerRunPort,
} from './reviewer-routes';
import {
  handleHostedCodingRoute, isHostedCodingRoute, type HostedCodingRunPort,
} from './hosted-coding-agent/hosted-routes';
import { decodeSegment } from './path-segment';
import { handleLoopRoute, isLoopRoute, type LoopRunPort } from './loop-routes';
import { cronEnabled, handleCronRoute, isCronRoute, type CronTickPort } from './cron-routes';
import { betaWaveZeroState, handleBetaRoute, isBetaRoute } from './beta-routes';
import { handleRepositoryRoute, isRepositoryRoute } from './repository-routes';
import { handleShipRoute, isShipRoute } from './ship-route';
import { resolveRepositoryTarget } from '../src/relay/mission/repository-target';
import type { MissionRepositoryTarget } from '../src/relay/mission/repository-target';
import { guardBetaAdmission, participantFromBody } from './beta-guard';
import { claimedClientKey, createBetaRateLimiter } from './beta-rate-limit';
import type { BetaRateLimiter } from './beta-rate-limit';
import { createBetaEnrolmentStore, createRepositoryRegistrationStore } from '../src/relay/persistence';
import type { RepositoryRegistrationStore } from '../src/relay/persistence';
import type { BetaWaveConfig } from '../src/relay/mission/beta';
import type { BetaEnrolmentStore } from '../src/relay/persistence';
import { createCronTickService } from './cron-service';
import { missionDispatchProblems, resolveRoleSlotsFromEnv } from './role-slot-config';
import {
  createCronScheduler, cronSchedulerEnabled, schedulerIntervalSeconds,
} from './cron-scheduler';
import { createBrowserSessionStore } from './browser-session/grants';
import {
  authorizeReviewerCall, handleBrowserSessionRoute, isBrowserSessionRoute,
} from './browser-session/routes';

const MAX_BODY_BYTES = 64 * 1024;

/**
 * EXACT-ORIGIN CORS.
 *
 * A browser origin is echoed back only when it matches the allowlist
 * character for character. An unapproved origin gets NO
 * `access-control-allow-origin` header at all, so the browser refuses the
 * response — and the reply says nothing about why, or about what is allowed.
 *
 * A request with NO Origin header (an authenticated CLI, curl, a health probe)
 * is not a browser request and is unaffected: it simply receives no CORS
 * headers, which is exactly right.
 *
 * There is deliberately no wildcard branch. With authenticated routes, `*`
 * would let any page on the internet spend a founder's credentials.
 */
function corsHeaders(config: BridgeConfig, origin: string | undefined): Record<string, string> {
  const base: Record<string, string> = {
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  };
  if (origin === undefined) return base;
  const normalized = origin.trim().replace(/\/$/, '');
  if (!config.allowedOrigins.includes(normalized)) return base;
  return { ...base, 'access-control-allow-origin': normalized };
}

/** Whether this browser origin may proceed. No Origin = not a browser call. */
function originAllowed(config: BridgeConfig, origin: string | undefined): boolean {
  if (origin === undefined) return true;
  return config.allowedOrigins.includes(origin.trim().replace(/\/$/, ''));
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string>): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        reject(new Error('request body too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (aborted) return;
      if (!chunks.length) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', () => reject(new Error('request error')));
  });
}

export function createBridgeServer(
  config: BridgeConfig,
  registry: MissionRegistry,
  /**
   * A STANDALONE Reviewer run engine, which `main()` does not pass and which no
   * setting supplies. Reviews happen inside the mission leg — `mission.ts`
   * builds the packet from the coding leg's evidence and calls the configured
   * transport — so this stays null and the routes refuse with a reason that
   * names that path. Readiness and test-connection answer regardless.
   *
   * The parameter remains because a test may inject one, and because a future
   * standalone lifecycle would arrive here rather than beside it.
   */
  reviewerRuns: ReviewerRunPort | null = null,
  /**
   * A STANDALONE hosted Coding Agent run engine, likewise absent by design: the
   * hosted agent runs as a mission's coding leg, which is what supplies the
   * prompt and the workspace these routes do not carry. Readiness itself always
   * answers, because it is free and offline.
   */
  hostedCodingRuns: HostedCodingRunPort | null = null,
  /**
   * The Loop run engine. Absent on a bridge that does not run Loops — the
   * routes then answer `loop_engine_not_ready` rather than inventing a run.
   * Even when present, every Loop route stays behind the server-side feature
   * flag, which defaults OFF.
   */
  loopRuns: LoopRunPort | null = null,
  /**
   * The Cron tick service. Absent on a bridge with no mounted state root —
   * the route then answers `cron_not_ready` rather than claiming an
   * occurrence it cannot durably mark. Independent of `loopRuns` ON PURPOSE:
   * a tick needs no agent, so it is wireable while the Loop run engine is
   * still absent, and nesting it under the Loop routes would inherit a
   * readiness failure that is not its own.
   */
  cronTicks: CronTickPort | null = null,
  /**
   * Whether a cron SCHEDULER exists on this server, asked at request time.
   *
   * A getter rather than a boolean because the scheduler is constructed after
   * the server in `main()`, and a snapshot taken here would answer for the
   * moment of construction rather than the moment of the request. Absent means
   * no, which is correct for every host that never builds one — including the
   * tests, and including a bridge whose volume never mounted.
   */
  cronSchedulerRunning: () => boolean = () => false,
  /**
   * The durable beta enrolment store. Absent on a bridge with no mounted state
   * root — the routes then answer `beta_not_ready` rather than recording an
   * enrolment that would not survive a restart.
   */
  betaStore: BetaEnrolmentStore | null = null,
  /**
   * The waves this deployment configures, and their seats. From the
   * DEPLOYMENT, never a request: a caller who could name their wave would name
   * the one with room. An empty list admits nobody, which is the only thing an
   * absent configuration can honestly mean.
   */
  betaWaves: readonly BetaWaveConfig[] = [],
  /**
   * The rate limiter for the public beta request route. Absent means no limit
   * — correct for a host that constructs no beta surface, and never the
   * default in `main()`.
   */
  betaLimiter: BetaRateLimiter | null = null,
  /**
   * The one Live Reach service, shared with the mission registry.
   *
   * Absent means the route builds its own per request, which is fine for a
   * test that only checks routing and wrong for anything that reads usage —
   * see the note at the Live Reach branch below. `main()` always passes one.
   */
  liveReachService: LiveReachService | null = null,
  /**
   * The durable repository registration store. Absent on a bridge with no
   * mounted state root — the registration surface then answers
   * `repository_store_unavailable`, the same shape as the beta store.
   */
  repositoryStore: RepositoryRegistrationStore | null = null,
): Server {
  /**
   * Browser pairing state lives in MEMORY, for the lifetime of this process.
   * A restart therefore revokes every grant and session — fail-closed — and no
   * browser credential is ever written to the mounted volume.
   */
  const browserSessions = createBrowserSessionStore();
  return createServer((req, res) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const cors = corsHeaders(config, origin);
    const method = req.method ?? 'GET';
    const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';

    if (method === 'OPTIONS') {
      // A preflight from an unapproved origin is refused without explaining
      // the policy or naming what is allowed.
      res.writeHead(originAllowed(config, origin) ? 204 : 403, cors);
      res.end();
      return;
    }

    // A browser request from an unapproved origin never reaches a route.
    if (!originAllowed(config, origin)) {
      send(res, 403, { error: 'origin not allowed' }, cors);
      return;
    }

    /**
     * THE PUBLIC LIVENESS PROBE.
     *
     * Deliberately the least informative endpoint in the product: it proves a
     * process is answering and nothing else. No version, no mode, no backend
     * URL, no host path, no mission, no readiness detail — a managed host's
     * health checker needs none of it, and anyone else scanning the internet
     * should learn nothing.
     */
    if (method === 'GET' && path === '/health') {
      send(res, 200, { status: 'ok' }, cors);
      return;
    }

    void (async () => {
      try {
        if (method === 'GET' && path === '/relay-api/health') {
          // Configuration PRESENCE only — never a value, never a key.
          const architect = architectPreflight(loadArchitectConfig(process.env));
          /**
           * WHETHER THIS DEPLOYMENT CAN STAFF THE ROLES IT WILL DISPATCH.
           *
           * Not always three: on the development path the Reviewer is never
           * called, so a deployment with two staffed roles is correctly bound.
           *
           * REASON CODES, NOT MESSAGES, AND NO OCCUPANT NAMES. This route is
           * unauthenticated. It already discloses which architect VARIABLES are
           * unset, so a refusal code like `configuration_missing` discloses
           * strictly less than what is here today — while a refusal MESSAGE
           * names occupants and supported environments, which is host layout.
           * Who actually holds each role is named in the mission's own
           * preflight event, behind authentication, where it belongs.
           */
          const roles = resolveRoleSlotsFromEnv(process.env);
          /**
           * BOUND IS NOT RUNNABLE. Reporting only the binding said a
           * deployment had staffed its roles while every mission it could
           * start would refuse — announcing an intention, not a fact. The
           * dispatch check is folded in, and still as codes.
           */
          const undispatchable = roles.binding.ok
            ? missionDispatchProblems(roles.binding.bindings)
            : [];
          send(res, 200, {
            ok: true,
            service: 'relay-bridge',
            claudeMode: config.claudeMode,
            fusionBaseUrl: config.fusionBaseUrl,
            sundayMode: config.sundayMode,
            confirmLive: config.confirmLive,
            promptArchitectReady: architect.ready,
            promptArchitectMissing: architect.missing,
            /**
             * WHETHER THE LOOP ENGINE IS WIRED, as a code.
             *
             * Recomputed per request from the same function `main()` uses, so
             * this cannot drift from what was actually constructed. A code and
             * never a path: this route is unauthenticated, and "no_state_root"
             * discloses that something is unset while a path discloses the
             * host's layout.
             */
            loopEngine: loopCompositionCode(composeLoopRuns({
              stateRoot: config.stateRoot,
              env: process.env,
              now: () => new Date().toISOString(),
              newId: (kind: string) => kind,
            })),
            roleSlotsBound: roles.binding.ok && undispatchable.length === 0,
            roleSlotRefusals: roles.binding.ok
              ? undispatchable.map((p) => `${p.role}:occupant_not_dispatchable`)
              : roles.binding.problems.map((p) => `${p.role}:${p.reason}`),
          }, cors);
          return;
        }

        /**
         * LIVE REACH. Operator-authenticated, because a retrieval leaves this
         * machine and spends somebody's rate limit — the same bar every other
         * outward-facing route sits behind, and unreachable from a browser
         * session by construction.
         */
        if (isLiveReachRoute(path)) {
          const auth = typeof req.headers.authorization === 'string'
            ? req.headers.authorization : undefined;
          const authorized = bearerMatches(auth, process.env.RELAY_BRIDGE_API_TOKEN);
          const body = method === 'POST' ? await readBody(req) : undefined;
          /**
           * THE SAME SERVICE THE MISSIONS USE, and it has to be.
           *
           * This route used to pass no service, so `handleLiveReachRoute`
           * constructed a fresh one PER REQUEST while missions retrieved
           * through the long-lived one in `main()`. Two services meant two
           * retrieval meters, so a usage figure would have counted half of
           * what a mission actually spent and a cap would have been enforced
           * against a meter that reset on every call.
           */
          await respondLiveReach(req, res, { path, authorized, body, cors }, liveReachService === null ? {} : { service: liveReachService });
          return;
        }

        /**
         * THE REVIEWER BOUNDARY. Every Reviewer operation the CLI can perform
         * lives behind one authenticated handler, so the terminal client never
         * needs the Hermes process adapter, the provider client or a
         * credential. Read-only routes start nothing and spend nothing.
         */
        /**
         * ONE bounded live architect check. OPERATOR ONLY — it is the single
         * route in Relay that deliberately spends money, so a browser session
         * can never reach it. It runs the architect and nothing else: no
         * Coding Agent, no Reviewer, no mission.
         */
        if (method === 'POST' && path === '/relay-api/architect/verify') {
          const auth = typeof req.headers.authorization === 'string'
            ? req.headers.authorization : undefined;
          if (!bearerMatches(auth, process.env.RELAY_BRIDGE_API_TOKEN)) {
            send(res, 401, {
              kind: 'authentication_failed',
              error: 'A live architect verification requires operator authentication.',
            }, cors);
            return;
          }
          const body = (await readBody(req)) as { authorized?: unknown } | undefined;
          if (body?.authorized !== true) {
            // Reaching the route is not consent to spend. The caller must say so.
            send(res, 403, {
              kind: 'authorization_required',
              error: 'A live architect verification spends money and requires explicit authorization.',
            }, cors);
            return;
          }
          const verification = await verifyArchitectConnection({
            config: loadArchitectConfig(process.env),
          });
          send(res, verification.ok ? 200 : 409, { data: verification }, cors);
          return;
        }

        // Browser pairing. Minting a grant costs the operator token; redeeming
        // one costs a valid grant AND the approved Origin.
        if (isBrowserSessionRoute(path.replace('/relay-api', ''))) {
          const browserResult = handleBrowserSessionRoute({
            method,
            path: path.replace('/relay-api', ''),
            authorization: typeof req.headers.authorization === 'string'
              ? req.headers.authorization : undefined,
            origin,
            body: method === 'POST' ? await readBody(req) : undefined,
            env: process.env,
            now: Date.now(),
            allowedOrigins: config.allowedOrigins,
          }, browserSessions);
          if (browserResult !== null) {
            send(res, browserResult.status, browserResult.body, cors);
            return;
          }
        }

        if (isReviewerRoute(path.replace('/relay-api', ''))) {
          const reviewerResult = await handleReviewerRoute({
            method,
            path: path.replace('/relay-api', ''),
            authorization: typeof req.headers.authorization === 'string'
              ? req.headers.authorization : undefined,
            body: method === 'POST' ? await readBody(req) : undefined,
            env: process.env,
            authorize: () => authorizeReviewerCall({
              method,
              path: path.replace('/relay-api', ''),
              authorization: typeof req.headers.authorization === 'string'
                ? req.headers.authorization : undefined,
              origin,
              env: process.env,
              now: Date.now(),
              store: browserSessions,
            }),
          }, reviewerRuns);
          if (reviewerResult !== null) {
            send(res, reviewerResult.status, reviewerResult.body, cors);
            return;
          }
        }

        /**
         * THE HOSTED CODING AGENT FAMILY.
         *
         * The same boundary as the reviewer family, for the same reason:
         * readiness and run state are readable by a paired browser session,
         * while starting, stopping and retrying either spend a provider
         * credential or change a run in flight, and belong to an operator.
         */
        if (isHostedCodingRoute(path.replace('/relay-api', ''))) {
          const hostedResult = await handleHostedCodingRoute({
            method,
            path: path.replace('/relay-api', ''),
            authorization: typeof req.headers.authorization === 'string'
              ? req.headers.authorization : undefined,
            body: method === 'POST' ? await readBody(req) : undefined,
            env: process.env,
            now: new Date().toISOString(),
            authorize: () => authorizeReviewerCall({
              method,
              path: path.replace('/relay-api', ''),
              authorization: typeof req.headers.authorization === 'string'
                ? req.headers.authorization : undefined,
              origin,
              env: process.env,
              now: Date.now(),
              store: browserSessions,
            }),
          }, hostedCodingRuns);
          if (hostedResult !== null) {
            send(res, hostedResult.status, hostedResult.body, cors);
            return;
          }
        }

        /**
         * THE LOOP FAMILY.
         *
         * Same boundary again, and the asymmetry is now familiar: status,
         * inspect and history are side-effect-free reads a paired browser may
         * poll, while confirm, pause, resume and stop change a durable run or
         * authorize work and belong to an operator. The family is additionally
         * gated by a server-side feature flag that defaults OFF, so a bridge
         * that has not been told to run Loops answers every one of these with a
         * refusal rather than a run.
         */
        if (isLoopRoute(path.replace('/relay-api', ''))) {
          const loopResult = await handleLoopRoute({
            method,
            path: path.replace('/relay-api', ''),
            authorization: typeof req.headers.authorization === 'string'
              ? req.headers.authorization : undefined,
            body: method === 'POST' ? await readBody(req) : undefined,
            env: process.env,
            now: new Date().toISOString(),
            cronSchedulerRunning: cronSchedulerRunning(),
            authorize: () => {
              const decision = authorizeReviewerCall({
                method,
                path: path.replace('/relay-api', ''),
                authorization: typeof req.headers.authorization === 'string'
                  ? req.headers.authorization : undefined,
                origin,
                env: process.env,
                now: Date.now(),
                store: browserSessions,
              });
              // The shared authorizer answers WHO; the Loop routes also need a
              // principal to bind idempotency to, and a session id is not one.
              return decision.kind === 'rejected'
                ? decision
                : { kind: decision.kind, principal: decision.kind === 'operator' ? 'operator' : 'browser' };
            },
          }, loopRuns);
          if (loopResult !== null) {
            send(res, loopResult.status, loopResult.body, cors);
            return;
          }
        }

        /**
         * THE CONTROLLED BETA. One public route and two operator ones; the
         * split is the security shape. `betaWaves` comes from the deployment
         * rather than a request, so no caller can name the wave they join or
         * the seats it holds — see WAVE_0.md.
         */
        /**
         * THE REPOSITORY REGISTRATION SURFACE. Operator-only, spends nothing,
         * and validates through the domain — see `repository-routes.ts`. It is
         * dispatched before the mission routes because it is a prerequisite of
         * them: a mission may only name a repository this registered.
         */
        if (isRepositoryRoute(path.replace('/relay-api', ''))) {
          const repoResult = handleRepositoryRoute({
            method,
            path: path.replace('/relay-api', ''),
            authorization: typeof req.headers.authorization === 'string'
              ? req.headers.authorization : undefined,
            body: method === 'POST' ? await readBody(req) : undefined,
            env: process.env,
            now: new Date().toISOString(),
          }, repositoryStore);
          if (repoResult !== null) {
            send(res, repoResult.status, repoResult.body, cors);
            return;
          }
        }

        /**
         * SHIP A VERIFIED MISSION. Operator-only, separately authorized, and
         * only a mission that verified against a real repository with a retained
         * worktree — see `ship-route.ts`. Dispatched before the generic mission
         * routes because `/mission/:id/ship` would otherwise match the
         * cancel/retry pattern's sibling.
         */
        if (isShipRoute(path.replace('/relay-api', ''))) {
          const shipResult = await handleShipRoute({
            method,
            path: path.replace('/relay-api', ''),
            authorization: typeof req.headers.authorization === 'string'
              ? req.headers.authorization : undefined,
            body: method === 'POST' ? await readBody(req) : undefined,
            env: process.env,
            now: () => new Date().toISOString(),
          }, {
            shipContext: (id) => registry.shipContext(id),
            recordShipOutcome: (id, o) => registry.recordShipOutcome(id, o),
            beginShip: (id) => registry.beginShip(id),
            endShip: (id) => registry.endShip(id),
            store: repositoryStore,
          });
          if (shipResult !== null) {
            send(res, shipResult.status, shipResult.body, cors);
            return;
          }
        }

        if (isBetaRoute(path.replace('/relay-api', ''))) {
          const betaResult = await handleBetaRoute({
            method,
            path: path.replace('/relay-api', ''),
            authorization: typeof req.headers.authorization === 'string'
              ? req.headers.authorization : undefined,
            body: method === 'POST' ? await readBody(req) : undefined,
            env: process.env,
            // THE SERVER'S CLOCK. It orders the wave's queue, so a caller's
            // would let anyone place themselves at the front of it.
            now: new Date().toISOString(),
            waves: betaWaves,
            // The public route is the only unauthenticated write surface, so
            // it is the only one that carries a limit.
            ...(betaLimiter === null ? {} : {
              rateLimit: {
                limiter: betaLimiter,
                clientKey: claimedClientKey(req.headers),
                nowMs: Date.now(),
              },
            }),
          }, betaStore);
          if (betaResult !== null) {
            send(res, betaResult.status, betaResult.body, cors);
            return;
          }
        }

        if (isCronRoute(path.replace('/relay-api', ''))) {
          const cronResult = await handleCronRoute({
            method,
            path: path.replace('/relay-api', ''),
            authorization: typeof req.headers.authorization === 'string'
              ? req.headers.authorization : undefined,
            body: method === 'POST' ? await readBody(req) : undefined,
            env: process.env,
            // THE SERVER'S CLOCK, and the only one the tick ever sees.
            now: new Date().toISOString(),
            authorize: () => {
              const decision = authorizeReviewerCall({
                method,
                path: path.replace('/relay-api', ''),
                authorization: typeof req.headers.authorization === 'string'
                  ? req.headers.authorization : undefined,
                origin,
                env: process.env,
                now: Date.now(),
                store: browserSessions,
              });
              // A 403 rejection means AUTHENTICATED BUT NOT PERMITTED — a
              // paired browser session reaching an operator-only route. It
              // must not flatten into 'none', which answers "authentication
              // is required" to someone who is authenticated and needs to be
              // told to ask an operator instead. Review caught the flattened
              // version making the route's own 403 branch unreachable.
              if (decision.kind === 'rejected') {
                return decision.status === 403
                  ? { kind: 'browser' as const, principal: 'browser' }
                  : { kind: 'none' as const, principal: 'none' };
              }
              return {
                kind: decision.kind,
                principal: decision.kind === 'operator' ? 'operator' : 'browser',
              };
            },
          }, cronTicks);
          if (cronResult !== null) {
            send(res, cronResult.status, cronResult.body, cors);
            return;
          }
        }

        /**
         * THE MISSION FAMILY IS AUTHENTICATED TOO.
         *
         * These routes predate the bridge being hosted: they were written for
         * a localhost developer tool and had no credential check, which was
         * harmless until the service got a public domain. It is not harmless
         * now — an anonymous caller could start, cancel and retry real work.
         *
         * Same boundary as the reviewer family: an operator may do anything, a
         * paired browser session may only READ one mission, and everything
         * else is refused before the registry is touched.
         */
        /**
         * WHO IS CALLING THE MISSION FAMILY. An operator may do anything; a
         * read-only browser session may read one mission; a CONTROL session
         * may also start, cancel and retry — acting as the participant bound
         * into it at mint. The decision is KEPT, not just checked: the start
         * and retry routes below use the session's identity instead of the
         * request body's, because a browser never gets to claim who it is.
         */
        let missionCaller: ReturnType<typeof authorizeReviewerCall> | null = null;
        if (path.startsWith('/relay-api/mission')) {
          const decision = authorizeReviewerCall({
            method,
            path: path.replace('/relay-api', ''),
            authorization: typeof req.headers.authorization === 'string'
              ? req.headers.authorization : undefined,
            origin,
            env: process.env,
            now: Date.now(),
            store: browserSessions,
          });
          if (decision.kind === 'rejected') {
            send(res, decision.status, {
              kind: decision.status === 403 ? 'authorization_required' : 'authentication_failed',
              error: decision.message,
            }, cors);
            return;
          }
          missionCaller = decision;
        }

        if (method === 'POST' && path === '/relay-api/mission/start') {
          const body = (await readBody(req)) as { missionId?: unknown; objective?: unknown } | undefined;
          const missionId = typeof body?.missionId === 'string' ? body.missionId : '';
          const objective = typeof body?.objective === 'string' ? body.objective : '';
          if (!missionId || !objective) {
            send(res, 400, { error: 'missionId and objective are required' }, cors);
            return;
          }
          /**
           * THE CONTROLLED BETA BITES HERE, and only here, because this is
           * the operation it exists to control: `registry.start` runs the
           * real three-role pipeline and spends real money. With the beta off
           * this is `null` and the route behaves exactly as it always did.
           */
          const refusal = guardBetaAdmission({
            env: process.env,
            /**
             * FOR A BROWSER, THE SESSION IS THE IDENTITY. The participant was
             * bound at mint by the operator; whatever the page put in the body
             * is ignored, so a compromised or curious frontend cannot act as a
             * participant nobody paired it for. Operators keep the body field —
             * they hold the credential that could mint any session anyway.
             */
            participantId: missionCaller?.kind === 'browser'
              ? missionCaller.participantId
              : participantFromBody(body),
            store: betaStore,
            waves: betaWaves,
          });
          if (refusal !== null) {
            send(res, refusal.status, refusal.body, cors);
            return;
          }

          /**
           * AN OPTIONAL REPOSITORY TARGET, RESOLVED FROM A REGISTERED KEY.
           *
           * A mission may name a `repositoryKey` a registered repository holds;
           * the target is RESOLVED here from the store, never accepted pre-built
           * from the body — "an objective cannot introduce a repository" is a
           * property of the type, and letting the body carry a target would
           * hand it a repository nobody registered.
           *
           * OPERATOR ONLY. Naming a real repository to build and (later) ship is
           * a higher-consequence act than starting a fixture mission; a browser
           * session — even a control session — may not do it. The credential
           * that gates registration gates targeting.
           */
          let repositoryTarget: MissionRepositoryTarget | undefined;
          let intendedWritePaths: readonly string[] | undefined;
          const repositoryKey = typeof (body as { repositoryKey?: unknown })?.repositoryKey === 'string'
            ? (body as { repositoryKey: string }).repositoryKey : null;
          if (repositoryKey !== null) {
            if (missionCaller?.kind !== 'operator') {
              send(res, 403, { error: { kind: 'operator_required', message: 'Naming a repository target is operator-only.' } }, cors);
              return;
            }
            if (repositoryStore === null) {
              send(res, 503, { error: { kind: 'repository_store_unavailable', message: 'No durable state root is mounted, so no repository can be resolved.' } }, cors);
              return;
            }
            const registration = repositoryStore.get(repositoryKey);
            if (registration === null) {
              send(res, 404, { error: { kind: 'repository_not_registered', message: `No registered repository named "${repositoryKey}".` } }, cors);
              return;
            }
            const workingBranch = typeof (body as { workingBranch?: unknown })?.workingBranch === 'string'
              ? (body as { workingBranch: string }).workingBranch : '';
            if (workingBranch === '') {
              send(res, 422, { error: { kind: 'validation_failed', message: 'A workingBranch is required to target a repository.' } }, cors);
              return;
            }
            const declared = (body as { intendedWritePaths?: unknown })?.intendedWritePaths;
            intendedWritePaths = Array.isArray(declared) && declared.every((x) => typeof x === 'string')
              ? declared as string[] : [];
            const resolved = resolveRepositoryTarget({
              registration,
              request: {
                repositoryKey,
                // The OPERATOR selected it; the server stamps when.
                selectedBy: 'operator',
                selectedAt: new Date().toISOString(),
                workingBranch,
                // No widening from the body: a mission may only narrow the
                // registration's grants, and the resolver enforces it.
                permissions: null,
              },
              now: new Date().toISOString(),
            });
            if (!resolved.ok) {
              send(res, 422, { error: { kind: 'repository_resolution_refused', message: resolved.error.message } }, cors);
              return;
            }
            repositoryTarget = resolved.target;
          }

          const view = registry.start({ missionId, objective, repositoryTarget, intendedWritePaths });
          send(res, 200, { missionId, view }, cors);
          return;
        }

        const missionMatch = path.match(/^\/relay-api\/mission\/([^/]+)(?:\/(cancel|retry))?$/);
        if (missionMatch) {
          // `%ZZ` here is a malformed client request naming no mission. Bare
          // `decodeURIComponent` threw a URIError into the catch below, which
          // whitelists two message strings and answers 500 for everything
          // else — a server fault reported for a client's typo.
          const id = decodeSegment(missionMatch[1]);
          if (id === null) return send(res, 404, { error: 'mission not found' }, cors);
          const action = missionMatch[2];
          if (method === 'GET' && !action) {
            const view = registry.get(id);
            if (!view) return send(res, 404, { error: 'mission not found' }, cors);
            return send(res, 200, { missionId: id, view }, cors);
          }
          if (method === 'POST' && action === 'cancel') {
            const view = registry.cancel(id);
            if (!view) return send(res, 404, { error: 'mission not found' }, cors);
            return send(res, 200, { missionId: id, view }, cors);
          }
          if (method === 'POST' && action === 'retry') {
            /**
             * RETRY RE-DRIVES THE SAME PIPELINE, so it is where money is spent
             * too. Guarding only `start` meant a mission begun while the beta
             * was off could be re-driven after it was on, by a caller the gate
             * refuses — which contradicts the boundary the guard states.
             */
            const retryRefusal = guardBetaAdmission({
              env: process.env,
              // The same identity rule as start: a browser is who its session
              // says, never who its request body says.
              participantId: missionCaller?.kind === 'browser'
                ? missionCaller.participantId
                : participantFromBody(await readBody(req)),
              store: betaStore,
              waves: betaWaves,
            });
            if (retryRefusal !== null) {
              send(res, retryRefusal.status, retryRefusal.body, cors);
              return;
            }
            const view = registry.retry(id);
            if (!view) return send(res, 404, { error: 'mission not found' }, cors);
            return send(res, 200, { missionId: id, view }, cors);
          }
        }

        send(res, 404, { error: 'not found' }, cors);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'internal error';
        // Only ever surface known safe request errors; never internals.
        const safe = msg === 'request body too large' || msg === 'invalid JSON body' ? msg : 'internal error';
        send(res, safe === 'internal error' ? 500 : 400, { error: safe }, cors);
      }
    })();
  });
}

/** Entry point — `node dist-relay-bridge/server.cjs`. */
/**
 * Prepares the durable-state root and proves it is usable.
 *
 * A bridge that cannot write its own state must not report itself healthy, so
 * this failing is a startup failure rather than a warning. Permissions are
 * owner-only: the volume holds mission state, not public data.
 */
export function prepareStateRoot(root: string | null): { ok: true } | { ok: false; reason: string } {
  if (root === null) return { ok: true };
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    // Prove writability rather than assume it — a mount can exist read-only.
    const probe = join(root, '.relay-write-probe');
    writeFileSync(probe, 'ok', { mode: 0o600 });
    rmSync(probe, { force: true });
    return { ok: true };
  } catch {
    // The path is NOT included: it is host layout, and this line reaches logs.
    return { ok: false, reason: 'the durable state directory is not writable' };
  }
}

export function main(): void {
  const config = loadBridgeConfig();

  // Refuse to boot a production bridge that would be unsafe. Names only —
  // never values — so this is safe in a deployment log.
  const problems = productionConfigProblems(config, process.env);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`Relay bridge cannot start: ${problem}`);
    process.exitCode = 1;
    return;
  }
  // Said out loud, but never fatal — a CLI-only bridge is a valid deployment.
  for (const warning of productionConfigWarnings(config)) {
    console.warn(`Relay bridge notice: ${warning}`);
  }

  const state = prepareStateRoot(config.stateRoot);
  if (!state.ok) {
    console.error(`Relay bridge cannot start: ${state.reason}.`);
    process.exitCode = 1;
    return;
  }

  /**
   * LIVE REACH, CONSTRUCTED FOR THE MISSION.
   *
   * Without this the mission's gatherer defaults to refusing everything, and a
   * Mission naming an evidence reference on the real bridge would always be
   * told nothing was retrieved — the same unwired-engine shape the Loop routes
   * had, where the service existed and nothing built it.
   *
   * It is built unconditionally because, unlike the Loop engine, it needs
   * neither a durable volume nor an agent: it makes an HTTP request through
   * the network policy and returns an observation. What it can actually reach
   * is still decided per request by the permission model and by readiness, so
   * constructing it claims nothing.
   */
  const liveReach = createLiveReachService({
    now: () => new Date().toISOString(),
    nextEvidenceId: () => `ev-${randomUUID()}`,
  });

  const registry = createMissionRegistry({
    fusionBaseUrl: config.fusionBaseUrl,
    sundayMode: config.sundayMode,
    claudeMode: config.claudeMode,
    confirmLive: config.confirmLive,
    baseEnv: process.env,
    architectEnv: process.env,
    deps: {
      gatherEvidence: liveReach.retrieve,
      /**
       * NO PROBES ARE SUPPLIED, and that is deliberate rather than an
       * oversight. Readiness is OBSERVED, and this process has observed
       * nothing at startup — so a Mission's first evidence request is refused
       * `not_ready` until an operator probes through
       * `/relay-api/live-reach/probe`. Seeding an optimistic probe here would
       * be exactly the "configured therefore ready" claim the readiness model
       * exists to refuse.
       */
      evidenceProbes: [],
    },
  });
  /**
   * NO MOUNTED STATE ROOT MEANS NO TICK. The claim marker is what makes a
   * cron occurrence at-most-once, and it has to live on a durable volume —
   * so an unmounted bridge answers `cron_not_ready` rather than claiming
   * occurrences it would forget.
   */
  const cronTicks = config.stateRoot === null
    ? null
    : createCronTickService({
      root: config.stateRoot,
      now: () => new Date().toISOString(),
    });
  /**
   * THE TIMER, only if every gate above it is open.
   *
   * It depends on a mounted state root (no claim marker, no at-most-once), on
   * Cron being enabled, and on its own flag — a background process nobody
   * switched on is one nobody chose. It creates durable run records and
   * dispatches nothing, exactly as an operator tick does.
   */
  const scheduler = cronTicks !== null && cronEnabled(process.env)
    && cronSchedulerEnabled(process.env)
    ? createCronScheduler({
      ticks: cronTicks,
      now: () => new Date().toISOString(),
      intervalSeconds: schedulerIntervalSeconds(process.env),
      onPass: (report) => {
        /**
         * QUIET WHEN THERE IS NOTHING TO SAY — but "nothing to say" is not the
         * same as "ticked nothing". The first version logged only ticks,
         * creations and refusals, so a pass that deferred five schedules, or
         * durably claimed an occurrence with no run behind it, printed a line
         * indistinguishable from a clean one. Every field that represents work
         * NOT done is a reason to speak.
         */
        const quiet = report.ticked === 0 && report.refused.length === 0
          && report.deferred.length === 0 && report.claimedWithoutRun === 0
          && report.capacitySkipped === 0 && !report.truncated
          && !report.occurrencesTruncated && !report.listingTruncated
          && report.corrupt.length === 0 && report.missing.length === 0
          && report.refusal === null;
        if (quiet) return;
        const notes: string[] = [];
        if (report.deferred.length > 0) {
          notes.push(`deferred ${String(report.deferred.length)} to the next pass`);
        }
        /**
         * A REFUSAL IS PRINTED AS A REASON, NOT A COUNT. "Fix your timezone",
         * "this schedule is unparseable" and "this Loop has stopped recurring
         * and will not resume" were one integer, which is no more actionable
         * than silence — and the last of those is permanent.
         */
        const byReason = new Map<string, string[]>();
        for (const r of report.refused) {
          byReason.set(r.reason, [...(byReason.get(r.reason) ?? []), r.scheduleId]);
        }
        for (const [reason, ids] of byReason) {
          const loud = reason === 'run_records_at_ceiling'
            ? ' — THESE SCHEDULES HAVE STOPPED RECURRING and will not resume on '
              + 'their own; rebind each to a fresh Loop by editing it'
            : '';
          notes.push(`refused (${reason}): ${ids.join(', ')}${loud}`);
        }
        if (report.corrupt.length > 0) {
          notes.push(`CORRUPT, a human must look: ${report.corrupt.join(', ')}`);
        }
        if (report.missing.length > 0) notes.push(`missing: ${report.missing.join(', ')}`);
        if (report.claimedWithoutRun > 0) {
          // The loudest thing this report can carry: a human has to decide.
          notes.push(`CLAIMED WITHOUT A RUN ${String(report.claimedWithoutRun)}`);
        }
        if (report.capacitySkipped > 0) {
          notes.push(`dropped by overlap capacity ${String(report.capacitySkipped)}`);
        }
        if (report.occurrencesTruncated) notes.push('occurrences truncated');
        if (report.listingTruncated) {
          notes.push('the schedule listing is truncated — schedules past the cap are unreachable');
        }
        if (report.refusal !== null) notes.push(`refusal ${report.refusal}`);
        console.log(`Relay cron pass ${report.at}: ticked ${String(report.ticked)}, `
          + `created ${String(report.runsCreated)}`
          + (notes.length > 0 ? ` — ${notes.join('; ')}` : ''));
      },
    })
    : null;
  if (scheduler !== null) {
    console.log('Relay cron scheduler is ON — it creates run records and dispatches nothing.');
  }

  // The capability route answers from THIS object, not from the flags that ask
  // for it: the flags can be set on a bridge whose volume never mounted.
  /**
   * THE BETA STORE AND THE WAVES THIS DEPLOYMENT OPENS.
   *
   * The store needs a mounted volume for the same reason the cron claim marker
   * does: an enrolment that does not survive a restart is not an enrolment.
   *
   * WAVE 0'S CAP IS 100 AND IT IS SET HERE, from `WAVE_0.md`, because it is a
   * deployment decision rather than a domain constant — the gate does not
   * choose any wave's cap. The wave ships `not_open`: opening it is an
   * explicit act, and the safe default is the one a missing decision means.
   * Waves 1-3 are deliberately unconfigured, so `/beta/status` names them as
   * unconfigured rather than showing them merely closed.
   */
  const betaStore = config.stateRoot === null
    ? null
    : createBetaEnrolmentStore({ root: config.stateRoot });
  /**
   * THE REPOSITORY REGISTRATION STORE. Built only when a durable root is
   * mounted — a registration that does not survive a restart is not one.
   */
  const repositoryStore = config.stateRoot === null
    ? null
    : createRepositoryRegistrationStore({ root: config.stateRoot });
  // One limiter for the process, so its windows are shared across requests.
  const betaLimiter = createBetaRateLimiter();
  const betaWaves: readonly BetaWaveConfig[] = Object.freeze([
    Object.freeze({ wave: 'wave_0' as const, state: betaWaveZeroState(process.env), seats: 100 }),
  ]);

  /**
   * THE LOOP RUN ENGINE, actually constructed.
   *
   * This argument was a literal `null`, so every Loop route answered
   * `loop_engine_not_ready` while the service sat unbuilt. It is built now
   * when — and only when — a durable state root is mounted and an operator has
   * named an agent, and never with the simulator on a production deployment.
   * `loopComposition` carries the reason when it is not built, and the health
   * surface reports that reason as a code.
   */
  const loopComposition = composeLoopRuns({
    stateRoot: config.stateRoot,
    env: process.env,
    now: () => new Date().toISOString(),
    newId: (kind: string) => `${kind}-${randomUUID()}`,
  });
  if (!loopComposition.wired) {
    // eslint-disable-next-line no-console
    console.log(`Relay bridge Loop engine: not wired (${loopComposition.refusal}).`);
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `Relay bridge Loop engine: wired with the ${loopComposition.agentName} agent`
      + `${loopComposition.simulated ? ' — ITERATIONS ARE SIMULATED' : ''}.`,
    );
  }

  const server = createBridgeServer(
    config, registry, null, null,
    loopComposition.wired ? loopComposition.service : null,
    cronTicks,
    // Not "was one constructed" — "will it still fire". Shutdown stops the
    // timer and then drains for up to ten seconds, and for that whole window
    // the old getter reported a scheduler that would never run again.
    () => scheduler?.isRunning() === true,
    betaStore,
    betaWaves,
    betaLimiter,
    // The SAME service the mission registry retrieves through, so one meter
    // counts both paths.
    liveReach,
    repositoryStore,
  );

  /**
   * GRACEFUL SHUTDOWN. A managed host sends SIGTERM before replacing an
   * instance. Stop accepting new connections, let in-flight requests finish,
   * and exit — rather than dying mid-request and leaving a caller unsure
   * whether its work was accepted.
   */
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Relay bridge received ${signal} — closing.`);
    scheduler?.stop();
    server.close(() => process.exit(0));
    // A caller that never finishes must not hold the deploy open forever.
    const forced = setTimeout(() => process.exit(0), 10_000);
    forced.unref?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  server.listen(config.port, config.host, () => {
    // Safe startup line — configuration facts only, no secrets.
    // eslint-disable-next-line no-console
    console.log(
      // Configuration FACTS only. No token, no origin list contents beyond a
      // count, no state path — this line goes straight into a deployment log.
      `Relay bridge listening on ${config.host}:${config.port} · claude: ${config.claudeMode} · ` +
        `sundayMode: ${config.sundayMode} · confirm-live: ${config.confirmLive ? 'yes' : 'no'} · ` +
        `CORS origins: ${config.allowedOrigins.length} · ` +
        `durable state: ${config.stateRoot === null ? 'default' : 'mounted'} · ` +
        `auth: ${(process.env.RELAY_BRIDGE_API_TOKEN ?? '').trim() === '' ? 'OPEN (dev)' : 'required'}`,
    );
  });
}

// Run when executed directly (the esbuild CJS bundle sets require.main).
if (require.main === module) {
  main();
}
