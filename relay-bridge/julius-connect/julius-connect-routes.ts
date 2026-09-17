import type { IncomingMessage, ServerResponse } from 'node:http';

import type { JuliusConnectService } from './julius-connect-service';

/**
 * JULIUS CONNECT — THE LOCAL HTTP CONTRACT.
 *
 *   GET  /julius-connect/v1/surface   the Connections surface, as the domain projects it
 *   POST /julius-connect/v1/intents   { intent, ... }  -> the surface after the intent
 *
 * Loopback only, and closed to web pages: a request from anything but a loopback address is refused, and so is any
 * request that carries an Origin header -- a browser tab on some website cannot drive the user's connections through
 * this port, while Wonderland's native HTTP client (which sends no Origin) can. POST bodies must be JSON and small.
 */

export const JULIUS_CONNECT_ROUTE_PREFIX = '/julius-connect/v1/';
const MAX_INTENT_BYTES = 4 * 1024;

export function isJuliusConnectRoute(pathname: string): boolean {
  return pathname.startsWith(JULIUS_CONNECT_ROUTE_PREFIX);
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
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INTENT_BYTES) {
        if (!settled) {
          settled = true;
          resolve(null);
        }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });
  });
}

export async function handleJuliusConnectRoute(req: IncomingMessage, res: ServerResponse, service: JuliusConnectService): Promise<void> {
  if (!isLoopback(req.socket.remoteAddress)) {
    send(res, 403, { ok: false, error: { code: 'permission-denied', message: 'Julius Connect development service is loopback only.' } });
    return;
  }
  if (req.headers.origin !== undefined) {
    send(res, 403, { ok: false, error: { code: 'permission-denied', message: 'Web pages cannot drive Julius Connect.' } });
    return;
  }
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === `${JULIUS_CONNECT_ROUTE_PREFIX}surface` && req.method === 'GET') {
    send(res, 200, { ok: true, ...service.view() });
    return;
  }
  if (pathname === `${JULIUS_CONNECT_ROUTE_PREFIX}intents` && req.method === 'POST') {
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
      const status = result.error.code === 'not-found' ? 404 : result.error.code === 'permission-denied' ? 403 : 409;
      send(res, status, { ok: false, error: { code: result.error.code, message: result.error.message }, ...service.view() });
      return;
    }
    send(res, 200, { ok: true, ...result.value });
    return;
  }
  send(res, 404, { ok: false, error: { code: 'not-found', message: 'No such Julius Connect route.' } });
}
