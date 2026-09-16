import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';

/**
 * WONDER WEB — the sandbox server.
 *
 * This file is where the isolation claim in `WONDER_WEB_ISOLATION_PROFILES`
 * becomes true or false. The domain says a `static_bundle` runs behind
 * "inert-bytes + opaque-origin frame + connect-denying content policy". Those
 * are not adjectives — each one is implemented here, and a test asserts each
 * one, because a sandbox that is described rather than enforced is the fake
 * security the design forbids.
 *
 * WHAT MAKES THE CLAIM TRUE, mechanism by mechanism:
 *
 *   INERT BYTES        Artifacts are streamed from disk with `nosniff` and an
 *                      explicit content type. Nothing is executed server-side;
 *                      there is no template, no include, no interpreter.
 *
 *   ITS OWN ORIGIN     Every running creation gets its OWN EPHEMERAL PORT. A
 *                      port is an origin, and an origin is a storage partition,
 *                      so creation A cannot read creation B's localStorage,
 *                      IndexedDB or cookies. Serving both from one port would
 *                      have quietly made `other_user_creations` unenforced
 *                      while the profile still claimed it.
 *
 *   NO CREDENTIALS     The server never sets a cookie and never reads one, and
 *                      it is not the Relay origin, so no Relay session, bearer
 *                      token or pairing grant is reachable from inside a frame
 *                      pointed at it.
 *
 *   NO EGRESS          `connect-src 'none'` denies fetch, XHR, WebSocket and
 *                      EventSource. `form-action 'none'` closes the form-POST
 *                      exfiltration path that `connect-src` alone leaves open.
 *                      `default-src 'self'` plus `object-src 'none'` and
 *                      `base-uri 'none'` close the rest.
 *
 *   LOOPBACK ONLY      Bound to 127.0.0.1, so a creation is not reachable from
 *                      the network even while it runs.
 *
 * WHAT THIS DOES NOT DO, stated plainly: it does not sandbox a host process.
 * Only `static_bundle` is served here, and `authorizeWonderWebRun` refuses
 * every other runtime before this file is ever reached.
 */

/** The one host this server will ever bind. Not configurable, deliberately. */
export const WONDER_WEB_BIND_HOST = '127.0.0.1';

/**
 * The content policy served with every creation document.
 *
 * `'unsafe-inline'` and `'unsafe-eval'` are permitted for scripts because
 * generated single-file applications routinely inline both, and refusing them
 * would make the beta unable to open the very things it exists to open. They
 * cost nothing here: the threat this policy addresses is EXFILTRATION and
 * CROSS-ORIGIN REACH, and those are closed by `connect-src`, `form-action` and
 * the dedicated origin, not by forbidding inline script inside a document that
 * is already alone in its own origin with nothing to steal.
 */
export const WONDER_WEB_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  // The two that carry the egress claim.
  "connect-src 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

/** Denied browser capabilities, so a creation cannot ask for the microphone. */
export const WONDER_WEB_PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'bluetooth=()',
  'midi=()',
  'display-capture=()',
  'idle-detection=()',
].join(', ');

const MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
});

/**
 * A media type for a path, or `application/octet-stream`.
 *
 * Unknown extensions are NOT guessed into something executable. Combined with
 * `nosniff`, an unrecognized file is delivered as an opaque download rather than
 * interpreted as script by a browser being helpful.
 */
export function wonderWebMediaType(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MEDIA_TYPES[path.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a request path inside the creation root, or refuse.
 *
 * Refuses absolute escapes, `..` traversal, NUL bytes and anything that
 * normalizes outside the root. The containment check is done on the RESOLVED
 * path with a separator suffix, so `/root-evil` cannot pass as inside `/root`.
 */
export function resolveWithinRoot(root: string, requestPath: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(requestPath);
    } catch {
      return null;
    }
  })();
  if (decoded === null || decoded.includes('\0')) return null;

  const withoutQuery = decoded.split('?')[0].split('#')[0];
  const relative = withoutQuery.replace(/^\/+/, '');
  if (relative === '') return null;
  // A backslash is a separator on Windows; normalizing first would let
  // `..\..\x` through on a POSIX check.
  if (relative.includes('\\')) return null;
  if (relative.split('/').some((segment) => segment === '..')) return null;

  const rootResolved = resolve(root);
  const candidate = resolve(rootResolved, normalize(relative));
  return candidate === rootResolved || candidate.startsWith(rootResolved + sep)
    ? candidate
    : null;
}

export interface WonderWebServedCreation {
  readonly creationId: string;
  /** Absolute path to the directory holding this creation's build artifacts. */
  readonly rootPath: string;
  /** Relative path, already proven to exist by the build that produced it. */
  readonly entrypoint: string;
}

export interface WonderWebRunningServer {
  readonly creationId: string;
  readonly port: number;
  readonly origin: string;
  /** The address Wonder Web points its frame at. */
  readonly entrypointUrl: string;
  close(): Promise<void>;
}

/**
 * Serve ONE creation on its OWN port.
 *
 * `port: 0` asks the OS for an ephemeral port, which is what gives each running
 * creation a distinct origin without a registry of reserved numbers.
 */
export function serveWonderWebCreation(
  creation: WonderWebServedCreation,
  options: { readonly port?: number } = {},
): Promise<WonderWebRunningServer> {
  const server: Server = createServer((request, response) => {
    // Only reads. A creation is bytes to be opened, not an endpoint to be
    // driven, so nothing else is accepted.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end();
      return;
    }

    const requested = request.url ?? '/';
    const target =
      requested === '/' || requested.startsWith('/?') || requested.startsWith('/#')
        ? join(resolve(creation.rootPath), creation.entrypoint)
        : resolveWithinRoot(creation.rootPath, requested);

    if (target === null) {
      response.writeHead(403, securityHeaders('text/plain; charset=utf-8'));
      response.end('Refused: that path is outside this creation.');
      return;
    }

    void (async () => {
      let isFile = false;
      try {
        isFile = (await stat(target)).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) {
        response.writeHead(404, securityHeaders('text/plain; charset=utf-8'));
        response.end('Not found in this creation.');
        return;
      }
      response.writeHead(200, securityHeaders(wonderWebMediaType(target)));
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(target)
        .on('error', () => {
          response.destroy();
        })
        .pipe(response);
    })();
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.on('error', rejectPromise);
    server.listen(options.port ?? 0, WONDER_WEB_BIND_HOST, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        rejectPromise(new Error('wonder_web_server_has_no_port'));
        return;
      }
      const origin = `http://${WONDER_WEB_BIND_HOST}:${address.port}`;
      resolvePromise({
        creationId: creation.creationId,
        port: address.port,
        origin,
        entrypointUrl: `${origin}/`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

/** Every response carries the boundary, including errors. */
function securityHeaders(contentType: string): Record<string, string> {
  return {
    'content-type': contentType,
    'content-security-policy': WONDER_WEB_CONTENT_SECURITY_POLICY,
    'permissions-policy': WONDER_WEB_PERMISSIONS_POLICY,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    // A creation is never cached across a rebuild: a stale bundle presented as
    // the current one is the same lie as a stale READY.
    'cache-control': 'no-store',
  };
}
