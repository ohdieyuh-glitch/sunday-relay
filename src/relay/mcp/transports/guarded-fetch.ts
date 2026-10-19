/**
 * THE GUARDED FETCH (SERVER-ONLY).
 *
 * Every byte the Streamable HTTP transport sends or receives passes through
 * this function. The SDK's `StreamableHTTPClientTransport` accepts a custom
 * `fetch`, which is the single chokepoint where Relay's network policy can be
 * enforced without reimplementing the transport — so that is exactly what this
 * is used for.
 *
 * WHAT IT ENFORCES, and why each one is here rather than trusted to the SDK:
 *
 *   URL POLICY        scheme, embedded credentials, fragments, literal
 *                     addresses — re-checked on EVERY request, not once at
 *                     connect. A session that was safe to open is not
 *                     permanently safe to keep using.
 *   DNS POLICY        the resolved ADDRESSES are checked, not the hostname
 *                     string. `evil.example.com` resolving to
 *                     169.254.169.254 is the attack this defeats, and a
 *                     string check cannot see it.
 *   REDIRECTS         followed MANUALLY (`redirect: 'manual'`) so each hop is
 *                     policy-checked and counted. `redirect: 'follow'` would
 *                     let the runtime chase an attacker-chosen origin with
 *                     Relay's Authorization header attached, which is the
 *                     whole credential-forwarding problem.
 *   CREDENTIAL DROP   the Authorization header is REMOVED the moment a hop
 *                     changes origin. Not re-signed, not re-scoped — removed.
 *   CONTENT TYPE      only `application/json` and `text/event-stream` are
 *                     accepted. An HTML error page is not MCP, and treating it
 *                     as a malformed MCP response hides that a proxy answered.
 *   RESPONSE SIZE     streamed with a running byte cap, so an oversized body
 *                     is refused DURING transfer rather than after it has
 *                     already been buffered into memory.
 *   TIMEOUTS          a per-request deadline on top of any the SDK applies.
 *
 * IT NEVER REFLECTS AN UPSTREAM BODY. Every refusal message is Relay's own
 * wording. An upstream error body is untrusted content that may carry a
 * token, a path or an injection payload, and putting it into an exception
 * message is how it ends up in a log.
 */

import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  checkRedirect, checkResolvedAddresses, checkUrlPolicy, contentTypeAcceptable, originOf,
  type McpDnsResolverPort, type McpNetworkPolicy,
} from '../policy/mcp-network-policy';

/** Named error classes; `classifySdkError` maps them onto Relay categories. */
export class RelayMcpPolicyError extends Error {
  override readonly name = 'RelayMcpPolicyError';
}
export class RelayMcpResponseError extends Error {
  override readonly name = 'RelayMcpResponseError';
}
export class RelayMcpSizeError extends Error {
  override readonly name = 'RelayMcpSizeError';
}
export class RelayMcpAuthError extends Error {
  override readonly name = 'RelayMcpAuthError';
}

export interface GuardedFetchOptions {
  readonly policy: McpNetworkPolicy;
  readonly resolver: McpDnsResolverPort;
  /** The origin the connection was opened against. */
  readonly expectedOrigin: string;
  /** Records the origin each response actually came from. */
  readonly onObservedOrigin?: (origin: string) => void;
  /** Underlying fetch. Injected in tests; `globalThis.fetch` in production. */
  readonly baseFetch?: FetchLike;
}

export function createGuardedFetch(options: GuardedFetchOptions): FetchLike {
  const base: FetchLike = options.baseFetch ?? ((url, init) => fetch(url as string | URL, init));

  return async function guardedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
    let currentUrl = new URL(typeof input === 'string' ? input : input.toString());
    let currentInit: RequestInit = { ...init, redirect: 'manual' };
    let mayForwardCredentials = originOf(currentUrl) === options.expectedOrigin;

    for (let hop = 0; ; hop += 1) {
      /* --- stage 1: URL policy, on every hop --- */
      const urlVerdict = checkUrlPolicy(currentUrl.toString(), options.policy);
      if (!urlVerdict.allowed) {
        throw new RelayMcpPolicyError(urlVerdict.reason ?? 'the MCP endpoint is not permitted by network policy');
      }

      /* --- stage 2: resolved addresses, when the host is a NAME --- */
      if (urlVerdict.literalAddressClass === null) {
        const resolution = await checkResolvedAddresses(currentUrl.hostname, options.resolver, options.policy);
        if (!resolution.allowed) {
          throw new RelayMcpPolicyError(resolution.reason ?? 'the MCP endpoint resolved to a destination that is not permitted');
        }
      }

      /* --- credentials are dropped the moment the origin changes --- */
      if (!mayForwardCredentials) {
        currentInit = { ...currentInit, headers: stripAuthorization(currentInit.headers) };
      }

      const response = await withTimeout(
        () => base(currentUrl, currentInit),
        options.policy.requestTimeoutMs,
      );

      /* --- redirects, followed manually and counted --- */
      if (isRedirect(response.status)) {
        const location = response.headers.get('location');
        if (location === null) {
          throw new RelayMcpResponseError('the endpoint returned a redirect with no location');
        }
        const verdict = checkRedirect(currentUrl, location, hop + 1, options.policy);
        if (!verdict.allowed || verdict.target === null) {
          throw new RelayMcpPolicyError(verdict.reason ?? 'the redirect was refused');
        }
        // Once credentials have been dropped they stay dropped: a hop back to
        // the original origin does not re-authorize a chain that already left
        // it.
        mayForwardCredentials = mayForwardCredentials && verdict.mayForwardCredentials;
        currentUrl = verdict.target;
        continue;
      }

      options.onObservedOrigin?.(originOf(currentUrl));

      /* --- authentication is DISTINCT from network failure --- */
      if (response.status === 401 || response.status === 403) {
        throw new RelayMcpAuthError(
          `the MCP endpoint refused the request with HTTP ${response.status}`,
        );
      }

      /* --- content type, on SUCCESSFUL responses only --- */
      /**
       * The check exists to stop an HTML error page, a captive portal or a
       * proxy interstitial being parsed as MCP. That is a property of a 2xx
       * response.
       *
       * A NON-2xx response is a protocol-level answer the SDK interprets
       * itself — a 405 to the optional SSE `GET` is how a JSON-only Streamable
       * HTTP server correctly says "no stream here", and it legitimately
       * carries `text/plain`. Enforcing the content type there turns a handled,
       * specification-compliant answer into a fatal `malformed_response`, which
       * is how this check first broke a working server.
       *
       * 202 Accepted carries no body at all, so it has no content type to
       * require.
       */
      if (response.ok && response.status !== 202 && response.body !== null) {
        if (!contentTypeAcceptable(response.headers.get('content-type'))) {
          throw new RelayMcpResponseError(
            'the endpoint returned a content type that is not MCP (expected application/json or text/event-stream)',
          );
        }
      }

      /* --- response size, capped DURING transfer --- */
      return boundResponseSize(response, options.policy.maximumResponseBytes);
    }
  };
}

/* ------------------------------------------------------------------ */

const isRedirect = (status: number): boolean =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

function stripAuthorization(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers === undefined) return out;
  const entries: Array<[string, string]> = headers instanceof Headers
    ? [...headers.entries()]
    : Array.isArray(headers)
      ? headers.map(([key, value]) => [key, value] as [string, string])
      : Object.entries(headers as Record<string, string>);
  for (const [key, value] of entries) {
    const lowered = key.toLowerCase();
    // Every header that can carry a bearer secret, not just `authorization`.
    if (lowered === 'authorization' || lowered === 'proxy-authorization'
      || lowered === 'cookie' || lowered === 'x-api-key') continue;
    out[key] = value;
  }
  return out;
}

async function withTimeout<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('the MCP request exceeded its timeout');
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Wraps the body in a stream that counts bytes and ERRORS past the cap.
 *
 * Reading the whole body and checking its length afterwards would mean a
 * malicious endpoint could exhaust memory before the check ran. This refuses
 * mid-transfer, which is the only version of the check that actually bounds
 * anything.
 *
 * `content-length`, when present and already over the cap, short-circuits
 * before a single byte is read — but its ABSENCE proves nothing, so the
 * streaming counter runs regardless.
 */
function boundResponseSize(response: Response, maximumBytes: number): Response {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maximumBytes) {
    throw new RelayMcpSizeError(
      `the endpoint declared a ${declared}-byte response, above the ${maximumBytes}-byte limit`,
    );
  }
  if (response.body === null) return response;

  let seen = 0;
  const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maximumBytes) {
        controller.error(new RelayMcpSizeError(
          `the endpoint sent more than the ${maximumBytes}-byte response limit`,
        ));
        return;
      }
      controller.enqueue(chunk);
    },
  }));

  return new Response(bounded, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
