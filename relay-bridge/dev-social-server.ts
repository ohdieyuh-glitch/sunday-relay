/**
 * WONDERLAND SOCIAL — a DEVELOPMENT server for real multi-client tests. Loopback only; never deployed.
 *
 * It serves the real social routes (wonderland-social-routes.ts) over the real in-memory store, so two or more Wonderland
 * desktop clients on this machine can befriend, message and party with each other through exactly the code the bridge will
 * run -- before the routes are wired into the bridge, its session grants and its database (founder-gated).
 *
 * WHAT IS NOT REAL HERE, said on its face:
 *   - SESSIONS: `POST /dev/session {"player":"kai"}` mints a token for player `usr_kai` holding the `social` capability. No
 *     account, no pairing, no password -- which is why it listens on 127.0.0.1 only and refuses any Origin.
 *   - STORAGE: in memory; a restart forgets everything -- UNLESS started with `--pg <url>` (a THROWAWAY database: the
 *     portable test PostgreSQL), when it runs the real chain + 030 and the DURABLE store, so a restart of this server
 *     proves what a backend restart gives back. Never pointed at a live database: the URL must be 127.0.0.1.
 *
 *   node_modules/.bin/esbuild relay-bridge/dev-social-server.ts --bundle --platform=node --format=esm --outfile=<scratch>/dev-social.mjs
 *   node <scratch>/dev-social.mjs [port] [--pg postgresql://postgres@127.0.0.1:54329/<throwaway>]   (default 8796)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { openSocialPostgresStore } from '../src/relay/persistence/social-postgres';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { createInMemorySocialStore, type SocialStore } from '../src/relay/social/social-store';
import { handleSocialRoute, type SocialSessionFacts } from './wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from './wonderland-social-scope';

const MAX_BODY = 64 * 1024;

/** A throwaway database, migrated (the chain, then 030) and opened as the durable store. Loopback URLs only. */
export async function openDevPostgresStore(url: string, repoRoot: string): Promise<{ store: SocialStore; pool: Pool }> {
  if (!/^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:\d+\//.test(url)) throw new Error('the dev social server only uses a loopback throwaway database');
  const pool = new Pool({ connectionString: url });
  await new TransactionalWonderlandDatabase(pool).migrate();
  const applied = await pool.query(`SELECT 1 FROM relay_wonderland.schema_migrations WHERE version='030_wonderland_social'`);
  if (applied.rowCount === 0) await pool.query(readFileSync(join(repoRoot, 'src', 'relay', 'social', 'persistence', '030_wonderland_social.sql'), 'utf8'));
  return { store: await openSocialPostgresStore(pool), pool };
}

export function createDevSocialServer(durable?: { store: SocialStore; pool: Pool }) {
  const store = durable?.store ?? createInMemorySocialStore();
  const sessions = new Map<string, SocialSessionFacts & { displayName: string }>();

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new Error('request body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').trim();
        if (text.length === 0) return resolve(null);
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error('invalid JSON body'));
        }
      });
      req.on('error', reject);
    });

  return createServer((req, res) => {
    void (async () => {
      try {
        if (req.headers.origin !== undefined) return send(res, 403, { error: { kind: 'desktop_only', message: 'no browsers on the dev social server' } });
        const path = (req.url ?? '/').replace(/^\/relay-api/, '');
        const body = req.method === 'POST' ? await readBody(req) : null;
        if (req.method === 'POST' && path === '/dev/session') {
          const player = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).player : undefined;
          if (typeof player !== 'string' || !/^[a-z][a-z0-9_]{1,23}$/.test(player)) return send(res, 400, { error: { kind: 'bad_player', message: 'player must be a short lowercase name' } });
          if (durable !== undefined) {
            // the durable store's rows reference players: a development player is one, in the throwaway database
            await durable.pool.query(`INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING`, [`usr_${player}`]);
          }
          const token = `dev-${player}-${randomBytes(12).toString('hex')}`;
          sessions.set(token, {
            sessionId: token.slice(-8),
            participantId: `usr_${player}`,
            capabilities: [NATIVE_SOCIAL_CAPABILITY],
            displayName: player.replace(/^./, (c) => c.toUpperCase()),
          });
          return send(res, 200, { data: { token, userId: `usr_${player}`, note: 'DEVELOPMENT SESSION: loopback only, in memory' } });
        }
        const result = await handleSocialRoute(
          { method: req.method ?? 'GET', path, authorization: req.headers.authorization, origin: undefined, body, now: Date.now() },
          {
            verifySession: (token) => sessions.get(token) ?? null,
            identify: async (participantId) => {
              const facts = [...sessions.values()].find((s) => s.participantId === participantId);
              return facts === undefined ? null : { userId: participantId, displayName: facts.displayName, handle: `@${participantId.replace(/^usr_/, '')}` };
            },
            store,
          },
        );
        if (result === null) return send(res, 404, { error: { kind: 'not_found', message: 'no such route' } });
        return send(res, result.status, result.body);
      } catch (e) {
        const message = e instanceof Error && (e.message === 'request body too large' || e.message === 'invalid JSON body') ? e.message : 'internal error';
        return send(res, message === 'internal error' ? 500 : 400, { error: { kind: 'bad_request', message } });
      }
    })();
  });
}

// Run directly (the bundle's entry): listen on loopback only.
const entry = process.argv[1] ?? '';
if (/dev-social(-server)?\.(m?js|ts)$/.test(entry)) {
  const port = Number.parseInt(process.argv[2] ?? '8796', 10);
  const pgAt = process.argv.indexOf('--pg');
  const repoRoot = process.env.WONDERLAND_SOCIAL_REPO ?? process.cwd();
  void (async () => {
    const durable = pgAt > 0 ? await openDevPostgresStore(process.argv[pgAt + 1] ?? '', repoRoot) : undefined;
    createDevSocialServer(durable).listen(port, '127.0.0.1', () => {
      console.log(`WONDERLAND SOCIAL DEV SERVER on http://127.0.0.1:${port} -- loopback only, ${durable ? 'DURABLE (throwaway PostgreSQL)' : 'in memory'}, DEVELOPMENT SESSIONS`);
    });
  })();
}
