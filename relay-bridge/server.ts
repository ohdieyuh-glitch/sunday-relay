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
import {
  bearerMatches, handleReviewerRoute, isReviewerRoute, type ReviewerRunPort,
} from './reviewer-routes';
import {
  handleHostedCodingRoute, isHostedCodingRoute, type HostedCodingRunPort,
} from './hosted-coding-agent/hosted-routes';
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
   * The Reviewer run engine. Absent on a bridge that only reports readiness —
   * the routes then answer `reviewer_not_ready` rather than inventing a run.
   */
  reviewerRuns: ReviewerRunPort | null = null,
  /**
   * The hosted Coding Agent run engine. Absent on a bridge that only reports
   * readiness — the lifecycle routes then answer `hosted_coding_not_ready`
   * rather than inventing a run. Readiness itself always answers, because it
   * is free and offline.
   */
  hostedCodingRuns: HostedCodingRunPort | null = null,
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
          send(res, 200, {
            ok: true,
            service: 'relay-bridge',
            claudeMode: config.claudeMode,
            fusionBaseUrl: config.fusionBaseUrl,
            sundayMode: config.sundayMode,
            confirmLive: config.confirmLive,
            promptArchitectReady: architect.ready,
            promptArchitectMissing: architect.missing,
          }, cors);
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
        }

        if (method === 'POST' && path === '/relay-api/mission/start') {
          const body = (await readBody(req)) as { missionId?: unknown; objective?: unknown } | undefined;
          const missionId = typeof body?.missionId === 'string' ? body.missionId : '';
          const objective = typeof body?.objective === 'string' ? body.objective : '';
          if (!missionId || !objective) {
            send(res, 400, { error: 'missionId and objective are required' }, cors);
            return;
          }
          const view = registry.start({ missionId, objective });
          send(res, 200, { missionId, view }, cors);
          return;
        }

        const missionMatch = path.match(/^\/relay-api\/mission\/([^/]+)(?:\/(cancel|retry))?$/);
        if (missionMatch) {
          const id = decodeURIComponent(missionMatch[1]);
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

  const registry = createMissionRegistry({
    fusionBaseUrl: config.fusionBaseUrl,
    sundayMode: config.sundayMode,
    claudeMode: config.claudeMode,
    confirmLive: config.confirmLive,
    baseEnv: process.env,
    architectEnv: process.env,
  });
  const server = createBridgeServer(config, registry);

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
