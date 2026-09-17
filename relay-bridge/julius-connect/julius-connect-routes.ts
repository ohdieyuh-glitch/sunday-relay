import type { IncomingMessage, ServerResponse } from 'node:http';

import type { LiveBrowser } from './live-browser';
import type { JuliusConnectService } from './julius-connect-service';

/**
 * JULIUS CONNECT — THE LOCAL HTTP CONTRACT.
 *
 *   GET  /julius-connect/v1/surface          the Connections surface, as the domain projects it
 *   POST /julius-connect/v1/intents          { intent, ... }  -> the surface after the intent
 *   GET  /julius-connect/v1/browser/frame    the real page as a JPEG, for Wonderland to draw (Wonder Web Live)
 *   POST /julius-connect/v1/browser/intent   navigate, viewport, click, scroll, type, key, back, close
 *   GET  /julius-connect/v1/browser/log      what the real browser has been asked to do: hosts and actions, never text
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

export async function handleJuliusConnectRoute(req: IncomingMessage, res: ServerResponse, service: JuliusConnectService, browser?: LiveBrowser): Promise<void> {
  if (!isLoopback(req.socket.remoteAddress)) {
    send(res, 403, { ok: false, error: { code: 'permission-denied', message: 'Julius Connect development service is loopback only.' } });
    return;
  }
  if (req.headers.origin !== undefined) {
    send(res, 403, { ok: false, error: { code: 'permission-denied', message: 'Web pages cannot drive Julius Connect.' } });
    return;
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  // ---------------------------------------------------------------- the real browser
  if (pathname.startsWith(`${JULIUS_CONNECT_ROUTE_PREFIX}browser/`)) {
    // A BROWSER THAT FAILS ANSWERS THE REQUEST. It is another process doing something the web asked of it; when it goes
    // wrong the caller is told, and this service -- which also holds every connection and every audit line -- stays up.
    try {
      await handleBrowserRoute(req, res, pathname, url, browser);
    } catch (error) {
      if (!res.headersSent) {
        send(res, 502, { ok: false, error: { code: 'unavailable', message: `The browser did not manage it: ${String(error).slice(0, 200)}` } });
      }
    }
    return;
  }

  await handleRestOfRoute(req, res, service, pathname);
}

async function handleBrowserRoute(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL, browser?: LiveBrowser): Promise<void> {
  {
    if (browser === undefined) {
      send(res, 503, { ok: false, error: { code: 'not-found', message: 'This service was started without the live browser.' } });
      return;
    }
    if (pathname.endsWith('/frame') && req.method === 'GET') {
      const tab = (url.searchParams.get('tab') ?? 'social').slice(0, 40);
      const frame = await browser.frame(tab);
      if (frame === null) {
        send(res, 404, { ok: false, error: { code: 'not-found', message: `No page is open on tab ${tab}.` } });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': frame.jpeg.length,
        'Cache-Control': 'no-store',
        'X-Wonder-Web-Url': frame.url,
        'X-Wonder-Web-Title': encodeURIComponent(frame.title).slice(0, 300),
        'X-Wonder-Web-Size': `${frame.width}x${frame.height}`,
        'X-Wonder-Web-Loading': frame.loading ? '1' : '0',
      });
      res.end(frame.jpeg);
      return;
    }
    if (pathname.endsWith('/log') && req.method === 'GET') {
      send(res, 200, { ok: true, open: browser.open(), log: browser.log().slice(-40) });
      return;
    }
    if (pathname.endsWith('/intent') && req.method === 'POST') {
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        send(res, 415, { ok: false, error: { code: 'validation-failed', message: 'Intents are application/json.' } });
        return;
      }
      const text = await readBody(req);
      let body: Record<string, unknown> = {};
      try {
        body = text === null ? {} : (JSON.parse(text) as Record<string, unknown>);
      } catch {
        send(res, 400, { ok: false, error: { code: 'validation-failed', message: 'Intent is not JSON.' } });
        return;
      }
      const op = typeof body.op === 'string' ? body.op : '';
      const tab = typeof body.tab === 'string' ? body.tab.slice(0, 40) : 'social';
      const number = (name: string) => (typeof body[name] === 'number' ? (body[name] as number) : 0);
      if (op === 'navigate') {
        const result = await browser.navigate(tab, typeof body.url === 'string' ? body.url : '');
        send(res, result.ok ? 200 : 403, result.ok ? { ok: true, host: result.host } : { ok: false, error: { code: 'permission-denied', message: result.refusal } });
        return;
      }
      if (op === 'viewport') {
        send(res, 200, { ok: await browser.setViewport(tab, number('width'), number('height')) });
        return;
      }
      if (op === 'click') {
        send(res, 200, { ok: await browser.click(tab, number('x'), number('y')) });
        return;
      }
      if (op === 'scroll') {
        send(res, 200, { ok: await browser.scroll(tab, number('deltaY')) });
        return;
      }
      if (op === 'type') {
        send(res, 200, { ok: await browser.typeText(tab, typeof body.text === 'string' ? body.text.slice(0, 500) : '') });
        return;
      }
      if (op === 'key') {
        send(res, 200, { ok: await browser.pressKey(tab, typeof body.key === 'string' ? body.key.slice(0, 20) : 'Enter') });
        return;
      }
      if (op === 'back') {
        send(res, 200, { ok: await browser.back(tab) });
        return;
      }
      if (op === 'close') {
        await browser.close(tab);
        send(res, 200, { ok: true });
        return;
      }
      send(res, 400, { ok: false, error: { code: 'validation-failed', message: 'Unknown browser op. Known: navigate, viewport, click, scroll, type, key, back, close.' } });
      return;
    }
    send(res, 404, { ok: false, error: { code: 'not-found', message: 'No such browser route.' } });
    return;
  }
}

/** Everything that is not the browser: the surface, the intents, and the door's own answers. */
async function handleRestOfRoute(req: IncomingMessage, res: ServerResponse, service: JuliusConnectService, pathname: string): Promise<void> {
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
