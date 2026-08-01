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
import { loadBridgeConfig, type BridgeConfig } from './config';
import { createMissionRegistry, type MissionRegistry } from './mission';
import { architectPreflight, loadArchitectConfig } from './openai-architect';
import {
  createIsolatedProfile, createProbe, loadXaiConfig, localReadiness,
} from './reviewer-harness/hermes';

const MAX_BODY_BYTES = 64 * 1024;

function corsHeaders(config: BridgeConfig, origin: string | undefined): Record<string, string> {
  const allow = config.allowedOrigin ?? origin ?? '*';
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  };
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

export function createBridgeServer(config: BridgeConfig, registry: MissionRegistry): Server {
  return createServer((req, res) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const cors = corsHeaders(config, origin);
    const method = req.method ?? 'GET';
    const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';

    if (method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
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
         * The Reviewer harness readiness a browser may safely ask for.
         *
         * LOCAL ONLY: it probes the installed runtime and reports whether a
         * credential is PRESENT. It never contacts a provider, so polling this
         * cannot spend money, and it never returns a credential, a path or a
         * comparison — only the evidence the pure domain needs to render a
         * truthful state. Model verification is a separate, explicit action.
         */
        if (method === 'GET' && path === '/relay-api/reviewer/readiness') {
          const profile = createIsolatedProfile();
          try {
            const evidence = localReadiness({
              executable: process.env.RELAY_HERMES_EXECUTABLE ?? 'hermes',
              probe: createProbe(profile.home),
              xai: loadXaiConfig(process.env),
            });
            send(res, 200, {
              harness: 'hermes',
              // The binary path stays server-side; a browser has no use for it
              // and it discloses the host's layout.
              evidence: { ...evidence, binaryPath: null },
            }, cors);
          } finally {
            profile.dispose();
          }
          return;
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
export function main(): void {
  const config = loadBridgeConfig();
  const registry = createMissionRegistry({
    fusionBaseUrl: config.fusionBaseUrl,
    sundayMode: config.sundayMode,
    claudeMode: config.claudeMode,
    confirmLive: config.confirmLive,
    baseEnv: process.env,
    architectEnv: process.env,
  });
  const server = createBridgeServer(config, registry);
  server.listen(config.port, () => {
    // Safe startup line — configuration facts only, no secrets.
    // eslint-disable-next-line no-console
    console.log(
      `Relay bridge listening on :${config.port} · claude: ${config.claudeMode} · ` +
        `alcatraz(fusion): ${config.fusionBaseUrl} · sundayMode: ${config.sundayMode} · ` +
        `confirm-live: ${config.confirmLive ? 'yes' : 'no'} · ` +
        `CORS: ${config.allowedOrigin ? 'restricted' : 'open (dev)'}`,
    );
  });
}

// Run when executed directly (the esbuild CJS bundle sets require.main).
if (require.main === module) {
  main();
}
