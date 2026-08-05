/**
 * OFFLINE FAKE-SERVER HARNESS (TEST/FIXTURE SURFACE — server-only).
 *
 * Starts the fake MCP servers the offline proof runs against:
 *
 *   stdio  a REAL spawned child process (`fake-stdio-entry.mjs`), launched
 *          through Relay's own transport with its own executable allowlist,
 *          its own from-empty environment and its own process-group teardown.
 *   http   a REAL Streamable HTTP server bound to an EPHEMERAL LOOPBACK PORT
 *          (127.0.0.1:0). Never a fixed port — a fixed port makes tests fail
 *          when something else holds it and, worse, can silently talk to
 *          whatever else is listening.
 *
 * NO EXTERNAL NETWORKING EXISTS HERE. `assertNoExternalNetwork` installs
 * guards that make an external fetch, an external DNS lookup or a non-loopback
 * connection FAIL THE TEST rather than succeed quietly (§25). A test suite that
 * would pass while reaching the internet is not an offline proof.
 *
 * THE EXECUTABLE SHIM exists because Relay spawns children with an environment
 * built from empty, so there is no PATH for the OS to search. The shim is a
 * file named exactly as the registry entry's allowlisted executable, carrying
 * an ABSOLUTE-PATH shebang to this process's own Node binary. It is what lets
 * the real allowlist run against a real process without weakening the
 * allowlist or reintroducing an inherited PATH.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { McpDnsResolverPort } from '../policy/mcp-network-policy';

const HERE = dirname(fileURLToPath(import.meta.url));
const STDIO_ENTRY = resolve(HERE, 'fake-stdio-entry.mjs');

export const FAKE_STDIO_ENTRY_PATH = STDIO_ENTRY;

/* ------------------------------------------------------------------ *
 * stdio: executable shims.
 * ------------------------------------------------------------------ */

export interface FakeExecutableShims {
  readonly directory: string;
  /** Maps an allowlisted executable NAME to the shim's absolute path. */
  readonly resolve: (name: string) => string | null;
  readonly dispose: () => void;
}

/**
 * Creates executable shims for the allowlisted fixture names.
 *
 * The shebang is `#!<process.execPath>` — an absolute path — rather than
 * `#!/usr/bin/env node`, because `env` would search a PATH the child does not
 * have. This is the one place the empty-environment design shows up as extra
 * work, and paying it here is far better than adding a PATH to every MCP
 * child on the planet.
 */
export function createFakeExecutableShims(names: readonly string[]): FakeExecutableShims {
  const directory = mkdtempSync(join(tmpdir(), 'relay-mcp-bin-'));
  const paths = new Map<string, string>();
  for (const name of names) {
    const shimPath = join(directory, name);
    writeFileSync(
      shimPath,
      `#!${process.execPath}\nimport(${JSON.stringify(STDIO_ENTRY)});\n`,
      'utf8',
    );
    chmodSync(shimPath, 0o700);
    paths.set(name, shimPath);
  }
  return {
    directory,
    resolve: (name) => paths.get(name) ?? null,
    dispose: () => { try { rmSync(directory, { recursive: true, force: true }); } catch { /* best effort */ } },
  };
}

/* ------------------------------------------------------------------ *
 * Streamable HTTP on an ephemeral loopback port.
 * ------------------------------------------------------------------ */

export interface FakeHttpServerHandle {
  readonly url: string;
  readonly origin: string;
  readonly port: number;
  /** How many requests the server actually received. Zero-dispatch proofs
   * assert this stays at 0 for every refusal scenario. */
  readonly requestCount: () => number;
  readonly close: () => Promise<void>;
}

export interface FakeHttpServerOptions {
  readonly scenario: string;
  readonly serverName?: string;
  /** Require this exact Authorization header value; 401 otherwise. */
  readonly requireAuthorization?: string;
  /** Redirect the first request to this absolute URL, to exercise the
   * redirect and credential-forwarding policy. */
  readonly redirectTo?: string;
}

/**
 * Starts a Streamable HTTP MCP server on 127.0.0.1 with an OS-assigned port.
 *
 * The SDK's `StreamableHTTPServerTransport` is imported dynamically so this
 * module can be loaded by tests that never start an HTTP server.
 */
export async function startFakeHttpMcpServer(options: FakeHttpServerOptions): Promise<FakeHttpServerHandle> {
  const [{ StreamableHTTPServerTransport }, fake] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
    import('./fake-mcp-server.mjs') as Promise<typeof import('./fake-mcp-server.mjs')>,
  ]);

  const server = fake.createFakeMcpServer({
    scenario: options.scenario,
    serverName: options.serverName,
  });

  /**
   * SESSION-FUL, deliberately.
   *
   * `sessionIdGenerator: undefined` puts the SDK transport in stateless mode,
   * which expects a FRESH transport per request. Against one long-lived fixture
   * server it accepts `initialize` and then rejects the follow-up
   * `notifications/initialized` POST, so `client.connect()` fails with an
   * opaque "Error POSTing to endpoint". A session id is what a real remote MCP
   * server issues, and it is what makes this fixture exercise the same session
   * handling Relay will meet in production.
   */
  let sessionCounter = 0;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => `relay-fixture-session-${(sessionCounter += 1)}`,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  let requests = 0;

  const http: HttpServer = createServer((request, response) => {
    requests += 1;

    if (options.redirectTo !== undefined) {
      response.writeHead(307, { location: options.redirectTo });
      response.end();
      return;
    }

    if (options.requireAuthorization !== undefined
      && request.headers.authorization !== options.requireAuthorization) {
      // A truthful 401 — distinct from a network failure, which is exactly the
      // distinction §7 requires Relay to preserve.
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    /**
     * NO LONG-LIVED SSE STREAM.
     *
     * A `GET` on a Streamable HTTP endpoint opens the optional server→client
     * notification stream. Answering it would hold a socket open for the life
     * of the session, which keeps the Node process alive and hangs the test
     * run. `405` is the specification-compliant way for a JSON-only server to
     * say "no stream here", the SDK client handles it, and it keeps every
     * exchange in this fixture a bounded request/response.
     */
    if (request.method === 'GET') {
      response.writeHead(405, { 'content-type': 'text/plain', allow: 'POST, DELETE' });
      response.end('this fixture serves JSON responses only');
      return;
    }

    /**
     * The body is NOT read here.
     *
     * `StreamableHTTPServerTransport.handleRequest` converts the Node request
     * into a Web Standard `Request` via Hono's `getRequestListener`, which
     * reads the body stream itself. Draining the stream first — even while
     * passing the parsed body through the third argument — leaves that
     * conversion with a consumed stream, and the request simply never
     * completes: the client sees an initialize timeout rather than an error.
     */
    void transport.handleRequest(request, response);
  });

  await new Promise<void>((resolvePromise) => {
    // Port 0 => the OS assigns an ephemeral port. Loopback only.
    http.listen(0, '127.0.0.1', () => resolvePromise());
  });

  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;

  return {
    url: `${origin}/mcp`,
    origin,
    port,
    requestCount: () => requests,
    close: async () => {
      // `http.close()` stops ACCEPTING and then waits for existing connections
      // to end. The MCP client uses `fetch`, which keeps its sockets ALIVE, so
      // waiting for them means waiting for an idle timeout — the test process
      // hangs long after the assertions finished. Destroying them first is what
      // makes teardown bounded.
      http.closeAllConnections?.();
      await new Promise<void>((resolvePromise) => { http.close(() => resolvePromise()); });
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}

/* ------------------------------------------------------------------ *
 * The no-external-network guards.
 * ------------------------------------------------------------------ */

/** A DNS resolver that answers ONLY for loopback names. */
export const loopbackOnlyResolver: McpDnsResolverPort = {
  async resolve(hostname: string): Promise<readonly string[]> {
    if (hostname === 'localhost' || hostname === '127.0.0.1') return ['127.0.0.1'];
    if (hostname === '::1') return ['::1'];
    throw new Error(`RELAY TEST GUARD: refused to resolve "${hostname}" — the offline proof performs no external DNS`);
  },
};

/**
 * A resolver that ANSWERS with a dangerous address, for SSRF tests.
 *
 * This is how "a public-looking hostname resolves to cloud metadata" is proven
 * without any DNS traffic: the resolver is injected, so the test controls the
 * answer and the policy is exercised against a real resolution result.
 */
export function fixedResolver(map: Readonly<Record<string, readonly string[]>>): McpDnsResolverPort {
  return {
    async resolve(hostname: string): Promise<readonly string[]> {
      const answer = map[hostname];
      if (answer === undefined) throw new Error(`no fixture resolution for ${hostname}`);
      return answer;
    },
  };
}

export interface NetworkGuard {
  readonly externalAttempts: () => readonly string[];
  readonly restore: () => void;
}

/**
 * Installs a `fetch` guard that THROWS on any non-loopback URL.
 *
 * §25 requires that a test attempting external HTTP/HTTPS FAILS rather than
 * succeeds. Returning an error response would let a lenient caller swallow it;
 * throwing cannot be swallowed silently, and every attempt is recorded so a
 * test can assert the count is zero.
 */
export function installNoExternalNetworkGuard(): NetworkGuard {
  const attempts: string[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      host = raw;
    }
    const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
    if (!isLoopback) {
      attempts.push(raw);
      throw new Error(`RELAY TEST GUARD: refused an external request to ${host} — the offline proof makes no external call`);
    }
    return original(input as RequestInfo, init);
  }) as typeof fetch;

  return {
    externalAttempts: () => [...attempts],
    restore: () => { globalThis.fetch = original; },
  };
}
