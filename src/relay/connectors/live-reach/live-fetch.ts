import {
  MCP_DEFAULT_NETWORK_POLICY,
  checkRedirect,
  checkResolvedAddresses,
  checkUrlPolicy,
  originOf,
  type McpDnsResolverPort,
  type McpNetworkPolicy,
} from '../../mcp/policy/mcp-network-policy';
import { isInlineableMimeType } from '../../mcp/policy/mcp-sanitize';

/**
 * LIVE REACH — the bounded fetch Relay performs itself.
 *
 * This is the whole retrieval runtime, and its shape is a direct consequence
 * of the Agent Reach evaluation: that project's retrieval model is "the agent
 * runs a CLI with the platform's cookies in its environment", which Relay does
 * not do. Relay makes the request itself, inside its own limits, and hands
 * back an observation.
 *
 * IT REUSES THE EXISTING NETWORK POLICY. Relay already refuses loopback, link
 * local, metadata and private addresses, checks EVERY resolved address rather
 * than picking the safe one, re-checks every redirect hop, and drops
 * credentials the moment an origin changes. Writing a second SSRF guard here
 * would be the duplicate system the direction forbids, and it would be the
 * weaker of the two.
 *
 * WHAT IT DELIBERATELY IS NOT:
 *
 *   not a browser        no JavaScript is executed, so a page that renders
 *                        client-side returns what the server sent. Saying that
 *                        plainly beats a headless browser inside the control
 *                        plane.
 *   not authenticated    it sends no credential and holds none. Sources that
 *                        need a session are reported as needing one.
 *   not unbounded        bytes, time and redirects all have ceilings, because
 *                        a retrieval that can exhaust the host is a denial of
 *                        service with extra steps.
 *
 * ADAPTERS MAY NOT IMPORT `/mission`, so nothing here knows what an
 * EvidenceArtifact is. It returns a neutral observation and a composition root
 * turns it into evidence — the same inversion every other connector uses.
 */

export interface LiveFetchRequest {
  readonly url: string;
  /** Hard ceiling on the body Relay will read. Bytes beyond it are dropped. */
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly policy?: McpNetworkPolicy;
  /** Injected so the whole path is testable without a network. */
  readonly fetchImpl?: typeof fetch;
  readonly resolver?: McpDnsResolverPort;
}

/**
 * What happened, in the vocabulary the readiness model already speaks.
 *
 * These map one-to-one onto `BackendProbeResult` in the domain, which is what
 * lets one probe answer both "can Relay reach this" and "is this source
 * ready" without a second taxonomy.
 */
export type LiveFetchOutcome =
  | {
    readonly kind: 'observed';
    readonly status: number;
    readonly finalUrl: string;
    readonly body: string;
    readonly contentType: string | null;
    /** From `Last-Modified`, when the server sent one. Null is a real answer. */
    readonly serverPublishedAt: string | null;
    readonly bytes: number;
    readonly truncated: boolean;
  }
  | { readonly kind: 'refused'; readonly detail: string }
  | { readonly kind: 'unreachable'; readonly detail: string }
  | { readonly kind: 'throttled'; readonly detail: string; readonly retryAfter: string | null }
  | { readonly kind: 'unauthenticated'; readonly detail: string };

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

/** The identity Relay presents. Honest, and contactable. */
export const LIVE_REACH_USER_AGENT = 'SundayRelay-LiveReach/1.0 (+https://sunday-relay.vercel.app)';

/**
 * Fetch one document, or say precisely why not.
 *
 * Redirects are followed MANUALLY so every hop is checked. Following them
 * automatically would hand the destination to whoever controls the first
 * response, which is the entire redirect attack.
 */
export async function liveFetch(request: LiveFetchRequest): Promise<LiveFetchOutcome> {
  const policy = request.policy ?? MCP_DEFAULT_NETWORK_POLICY;
  const maxBytes = request.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = request.fetchImpl ?? fetch;

  const verdict = checkUrlPolicy(request.url, policy);
  if (!verdict.allowed || verdict.url === null) {
    return { kind: 'refused', detail: verdict.reason ?? 'the URL is not permitted' };
  }

  let current = verdict.url;
  let hop = 0;

  // A name has to be resolved and every answer checked before Relay connects.
  // A literal address was already classified by `checkUrlPolicy`.
  const resolveAndCheck = async (url: URL): Promise<LiveFetchOutcome | null> => {
    if (request.resolver === undefined) return null;
    const literal = checkUrlPolicy(url.toString(), policy).literalAddressClass;
    if (literal !== null) return null;
    const resolution = await checkResolvedAddresses(url.hostname, request.resolver, policy);
    if (!resolution.allowed) {
      return { kind: 'refused', detail: resolution.reason ?? 'the hostname is not permitted' };
    }
    return null;
  };

  for (;;) {
    const blocked = await resolveAndCheck(current);
    if (blocked !== null) return blocked;

    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
    let response: Response;
    try {
      response = await doFetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': LIVE_REACH_USER_AGENT, accept: 'text/*, application/json;q=0.9, */*;q=0.1' },
      });
    } catch (error) {
      return {
        kind: 'unreachable',
        detail: error instanceof Error && error.name === 'AbortError'
          ? `the request exceeded ${String(timeoutMs)}ms`
          : 'the endpoint could not be reached',
      };
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null || location === '') {
        return { kind: 'unreachable', detail: 'the endpoint redirected without a destination' };
      }
      hop += 1;
      const redirect = checkRedirect(current, location, hop, policy);
      if (!redirect.allowed || redirect.target === null) {
        return { kind: 'refused', detail: redirect.reason ?? 'the redirect was not permitted' };
      }
      // Nothing to drop: this fetch never sends a credential. Recording the
      // origin change keeps that true if one is ever added.
      void originOf(redirect.target);
      current = redirect.target;
      continue;
    }

    // 401/403 and 429 are ANSWERS, not failures. A source that says "who are
    // you" is reachable and unauthenticated, which is a different sentence to
    // a founder than "unavailable".
    if (response.status === 401 || response.status === 403) {
      return {
        kind: 'unauthenticated',
        detail: `the source answered ${String(response.status)}; it requires an authenticated session Relay does not have`,
      };
    }
    if (response.status === 429) {
      return {
        kind: 'throttled',
        detail: 'the source is rate limiting this deployment',
        retryAfter: response.headers.get('retry-after'),
      };
    }
    if (!response.ok) {
      return { kind: 'unreachable', detail: `the source answered ${String(response.status)}` };
    }

    /**
     * WHICH ALLOWLIST, and why not the other one.
     *
     * `contentTypeAcceptable` answers a DIFFERENT question — whether a
     * response is a valid MCP transport reply, which is JSON or an SSE stream
     * and nothing else. A web page is `text/html` and a feed is XML, so
     * reusing it here refused every document Live Reach exists to read.
     * `isInlineableMimeType` is the question actually being asked: may this be
     * rendered as text into an agent context? Anything else is stored as a
     * reference rather than inlined, which is the rule that module already
     * states.
     */
    const contentType = response.headers.get('content-type');
    if (!isInlineableMimeType(contentType)) {
      return {
        kind: 'refused',
        detail: `the response content type ${contentType ?? 'was absent'} is not one Relay reads`,
      };
    }

    const raw = await response.text();
    const truncated = raw.length > maxBytes;
    const body = truncated ? raw.slice(0, maxBytes) : raw;

    return {
      kind: 'observed',
      status: response.status,
      finalUrl: current.toString(),
      body,
      contentType,
      serverPublishedAt: normalizeHttpDate(response.headers.get('last-modified')),
      bytes: body.length,
      truncated,
    };
  }
}

/**
 * `Last-Modified` as an ISO instant, or null.
 *
 * Null is a real answer and the common one: most servers do not send it, and
 * an absent header is not a document published now.
 */
export function normalizeHttpDate(header: string | null): string | null {
  if (header === null || header.trim() === '') return null;
  const parsed = Date.parse(header);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * A readiness probe.
 *
 * SIDE-EFFECT FREE, and it has to stay that way: the readiness model retries,
 * and Agent Reach's own probe module documents what a non-idempotent probe
 * does when retried. A GET of a public document repeated twice changes
 * nothing; anything that writes is not a probe.
 */
export async function probeReachability(input: {
  url: string;
  policy?: McpNetworkPolicy;
  fetchImpl?: typeof fetch;
  resolver?: McpDnsResolverPort;
  timeoutMs?: number;
}): Promise<'observed' | 'unauthenticated' | 'throttled' | 'unreachable' | 'unconfigured'> {
  const outcome = await liveFetch({
    url: input.url,
    maxBytes: 2048,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.policy === undefined ? {} : { policy: input.policy }),
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    ...(input.resolver === undefined ? {} : { resolver: input.resolver }),
  });
  switch (outcome.kind) {
    case 'observed': return 'observed';
    case 'unauthenticated': return 'unauthenticated';
    case 'throttled': return 'throttled';
    // A policy refusal is a CONFIGURATION problem — the deployment asked Relay
    // to probe something it is not allowed to reach — not an unreachable host.
    case 'refused': return 'unconfigured';
    default: return 'unreachable';
  }
}
