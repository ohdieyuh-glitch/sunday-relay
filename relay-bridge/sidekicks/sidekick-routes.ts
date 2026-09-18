import type { IncomingMessage, ServerResponse } from 'node:http';

import type { SidekickService } from './sidekick-service';

/**
 * THE DOOR WONDERLAND READS THE COMPANIONS THROUGH.
 *
 *   GET  /sidekicks/v1/view      what the LLM Companion and Jhinn are, and what their bodies should be doing
 *   POST /sidekicks/v1/intents   { intent: connect | disconnect | ask | cancel | model | reset, ... }
 *
 * The same door rules as Julius Connect, for the same reasons: loopback only, and any request carrying an Origin header
 * is refused, so a web page cannot drive the founder's companions while Wonderland's own client (which sends no Origin)
 * can. Bodies are JSON and small.
 *
 * WHAT NEVER PASSES THROUGH IT: a credential. The view carries provider and model names, states and what was said in the
 * companion's own terminal -- never key material, which this system does not hold in the first place.
 */

export const SIDEKICK_ROUTE_PREFIX = '/sidekicks/v1/';
/**
 * WHERE A KEY GOES IN, and the only place it can. Posted by the founder's own connect script from this machine; the
 * material is handed to the runtime's memory and the reference comes back. Nothing reads a key out again: there is no
 * route that returns one, because nothing outside the call itself has any business seeing it.
 */
export const SIDEKICK_CREDENTIAL_ROUTE = '/sidekicks/v1/credential';
const MAX_INTENT_BYTES = 16 * 1024;

export function isSidekickRoute(pathname: string): boolean {
  return pathname.startsWith(SIDEKICK_ROUTE_PREFIX);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (value: string | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INTENT_BYTES) {
        done(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => done(null));
  });
}

export async function handleSidekickRoute(
  req: IncomingMessage,
  res: ServerResponse,
  service: SidekickService,
  putCredential?: (providerId: string, material: string) => { readonly credentialRef: string },
): Promise<void> {
  if (!isLoopback(req.socket.remoteAddress)) {
    send(res, 403, { ok: false, error: { code: 'permission-denied', message: 'This service answers this machine only.' } });
    return;
  }
  if (typeof req.headers.origin === 'string') {
    // A WEB PAGE MUST NOT DRIVE THE FOUNDER'S COMPANIONS. Wonderland's own client sends no Origin; a browser always does.
    send(res, 403, { ok: false, error: { code: 'permission-denied', message: 'This service does not answer web pages.' } });
    return;
  }
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === `${SIDEKICK_ROUTE_PREFIX}view` && req.method === 'GET') {
    send(res, 200, { ok: true, ...service.view() });
    return;
  }
  if (pathname === SIDEKICK_CREDENTIAL_ROUTE && req.method === 'POST') {
    if (putCredential === undefined) {
      send(res, 503, { ok: false, error: { code: 'not-found', message: 'This runtime has no credential intake.' } });
      return;
    }
    const text = await readBody(req);
    let body: { providerId?: unknown; material?: unknown } = {};
    try {
      body = text === null ? {} : (JSON.parse(text) as typeof body);
    } catch {
      send(res, 400, { ok: false, error: { code: 'validation-failed', message: 'Not JSON.' } });
      return;
    }
    const providerId = typeof body.providerId === 'string' ? body.providerId : '';
    const material = typeof body.material === 'string' ? body.material : '';
    if (providerId.length === 0 || material.trim().length === 0) {
      send(res, 400, { ok: false, error: { code: 'validation-failed', message: 'A providerId and the material are both needed.' } });
      return;
    }
    // NOTHING ABOUT THE MATERIAL IS LOGGED OR RETURNED -- not its length, not its shape, not a prefix. Only the reference.
    const { credentialRef } = putCredential(providerId, material);
    send(res, 200, { ok: true, credentialRef });
    return;
  }
  if (pathname === `${SIDEKICK_ROUTE_PREFIX}intents` && req.method === 'POST') {
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      send(res, 415, { ok: false, error: { code: 'validation-failed', message: 'Intents are application/json.' } });
      return;
    }
    const text = await readBody(req);
    if (text === null) {
      send(res, 413, { ok: false, error: { code: 'validation-failed', message: 'Intent too large.' } });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      send(res, 400, { ok: false, error: { code: 'validation-failed', message: 'Intent is not JSON.' } });
      return;
    }
    const result = service.intent(body);
    if (!result.ok) {
      send(res, result.error.code === 'not-found' ? 404 : result.error.code === 'permission-denied' ? 403 : 409, { ok: false, error: result.error });
      return;
    }
    send(res, 200, { ok: true, ...result.value });
    return;
  }
  send(res, 404, { ok: false, error: { code: 'not-found', message: 'No such sidekick route.' } });
}
