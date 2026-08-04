import { createServer, type Server } from 'node:http';

/**
 * A REAL HTTP SERVER standing in for the Relay Bridge.
 *
 * The Bridge Client's job is request framing, authentication, timeouts,
 * content negotiation, size limits, redirect refusal and error classification
 * — none of which a stubbed `fetch` would exercise. So the tests speak actual
 * HTTP to this, and the client under test is the real one.
 *
 * It records every request it receives (headers included) so a test can assert
 * where the credential travelled, and it never contacts anything itself.
 */

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: string;
}

export interface FakeBridgeRoute {
  readonly status?: number;
  readonly body?: unknown;
  /** Raw body, for malformed-JSON and content-type tests. */
  readonly rawBody?: string;
  readonly contentType?: string;
  readonly headers?: Record<string, string>;
  /** Delay before answering, for timeout tests. */
  readonly delayMs?: number;
}

export interface FakeBridge {
  readonly url: string;
  readonly requests: RecordedRequest[];
  close: () => Promise<void>;
}

export async function startFakeBridge(input: {
  token: string;
  routes: Record<string, FakeBridgeRoute>;
  /** When false the server rejects every credential. */
  acceptToken?: boolean;
}): Promise<FakeBridge> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const authorization = typeof req.headers.authorization === 'string'
          ? req.headers.authorization : undefined;
        requests.push({ method: req.method ?? 'GET', url: req.url ?? '/', authorization, body });

        const key = `${req.method} ${(req.url ?? '/').split('?')[0]}`;
        const route = input.routes[key];

        // EXACT MATCH, AND NOT A MODEL OF THE REAL PARSER.
        //
        // `relay-bridge/bearer-auth.ts` is deliberately tolerant — RFC 6750
        // makes the scheme case-insensitive and allows any whitespace run
        // after it — so this fixture ACCEPTS LESS than a real bridge does. It
        // stays that way on purpose: this file cannot import the bridge (the
        // browser boundary forbids `src/relay` reaching `relay-bridge`), and a
        // second tolerant copy here would be exactly the drifting duplicate
        // that `bearer-auth.ts` exists to remove.
        //
        // What follows is the consequence, stated rather than discovered: a
        // test written against this fake proves the CLIENT sends the canonical
        // `Bearer <token>` form. It can prove nothing about the real parser,
        // and no test here should be read as covering it.
        const accept = input.acceptToken !== false;
        if (!accept || authorization !== `Bearer ${input.token}`) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ kind: 'authentication_failed', error: 'nope' }));
          return;
        }
        if (route === undefined) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ kind: 'mission_not_found', error: 'no such route' }));
          return;
        }
        if (route.delayMs !== undefined && route.delayMs > 0) {
          await new Promise((r) => setTimeout(r, route.delayMs));
        }
        const payload = route.rawBody ?? JSON.stringify(route.body ?? {});
        res.writeHead(route.status ?? 200, {
          'content-type': route.contentType ?? 'application/json',
          ...(route.headers ?? {}),
        });
        res.end(payload);
      })();
    });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
