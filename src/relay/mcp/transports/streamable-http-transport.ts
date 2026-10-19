/**
 * REMOTE STREAMABLE HTTP TRANSPORT (SERVER-ONLY).
 *
 * STREAMABLE HTTP IS THE PRIMARY REMOTE TRANSPORT. The deprecated HTTP+SSE
 * transport is NOT implemented and NOT reachable — `MCP_UNSUPPORTED_TRANSPORT_KINDS`
 * names it with a reason so a configuration mentioning it gets "deprecated,
 * superseded by Streamable HTTP" rather than "unknown transport". The SDK ships
 * an SSE client; this milestone never constructs one.
 *
 * ALL NETWORK POLICY LIVES IN `./guarded-fetch.ts`, which is injected as the
 * SDK transport's `fetch`. That is the whole SSRF, redirect,
 * credential-forwarding, content-type and response-size story, applied to
 * every request the SDK makes rather than to the first one only.
 *
 * AUTHORIZATION IS ATTACHED SERVER-SIDE AND ONLY TO THE APPROVED ORIGIN. The
 * resolved credential is turned into request headers here and nowhere else,
 * and the guarded fetch removes them the instant a redirect changes origin.
 * §8 requires exactly this: attach only to the approved origin, never forward
 * after a cross-origin redirect.
 *
 * NO REAL OAUTH IS PERFORMED. The SDK's `authProvider` hook — which would
 * redirect a user agent to an authorization server — is deliberately not
 * wired. Relay represents OAuth states truthfully (`authorization_required`,
 * `authorization_expired`, `insufficient_scope`, `revoked`) and refuses,
 * rather than inventing a custom flow or pretending a token exists. Wiring a
 * real provider is a separate, founder-gated milestone.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { mcpFail, mcpFailure, mcpOk, type McpOutcome } from '../domain/mcp-failure';
import { MCP_BASELINE_PROTOCOL_REVISION, negotiateProtocol } from '../domain/mcp-protocol';
import type {
  McpClientPort, McpTransportFactoryPort, McpTransportOpenRequest,
} from '../domain/mcp-ports';
import { checkUrlPolicy, type McpDnsResolverPort, type McpNetworkPolicy } from '../policy/mcp-network-policy';
import type { McpRegistryEntry } from '../registry/mcp-registry-types';
import { createGuardedFetch } from './guarded-fetch';
import { classifySdkError, RelayMcpSdkClient } from './mcp-sdk-client';

export interface McpStreamableHttpTransportOptions {
  readonly registry: readonly McpRegistryEntry[];
  readonly policy: McpNetworkPolicy;
  readonly resolver: McpDnsResolverPort;
  /** Injected in tests so no real socket is opened. */
  readonly baseFetch?: typeof fetch;
}

export class McpStreamableHttpTransportFactory implements McpTransportFactoryPort {
  readonly kind = 'streamable_http' as const;

  constructor(private readonly options: McpStreamableHttpTransportOptions) {}

  async open(request: McpTransportOpenRequest): Promise<McpOutcome<McpClientPort>> {
    const entry = this.options.registry.find((candidate) => candidate.registryEntryId === request.registryEntryId);
    if (entry === undefined || entry.http === null) {
      return mcpFail(mcpFailure('registry_untrusted', 'no curated Streamable HTTP registry entry matches this connection'));
    }

    /* --- URL policy BEFORE anything is constructed --- */
    const policy: McpNetworkPolicy = entry.http.allowsPlainHttp
      ? this.options.policy
      : { ...this.options.policy, allowPlainHttp: false };

    const verdict = checkUrlPolicy(entry.http.url, policy);
    if (!verdict.allowed || verdict.url === null) {
      return mcpFail(mcpFailure('network_policy_blocked', verdict.reason ?? 'the endpoint is not permitted by network policy'));
    }

    let observedOrigin: string | null = null;

    const guardedFetch = createGuardedFetch({
      policy,
      resolver: this.options.resolver,
      expectedOrigin: entry.http.expectedOrigin,
      onObservedOrigin: (origin) => { observedOrigin = origin; },
      baseFetch: this.options.baseFetch as ReturnType<typeof createGuardedFetch> | undefined,
    });

    /* --- authorization, attached server-side --- */
    const headers: Record<string, string> = {};
    if (request.resolvedCredential !== null) {
      for (const [name, value] of Object.entries(request.resolvedCredential.material)) {
        headers[name] = value;
      }
    }

    const transport = new CapturingStreamableHttpTransport(verdict.url, {
      fetch: guardedFetch,
      requestInit: { headers },
      // No `authProvider`: Relay performs no OAuth in this milestone and says
      // so rather than half-implementing one.
    });

    const client = new Client(
      { name: request.clientName, version: request.clientVersion },
      { capabilities: {} },
    );

    try {
      await client.connect(transport, {
        signal: request.signal,
        timeout: request.connectTimeoutMs,
      });
    } catch (error) {
      try { await transport.close(); } catch { /* best effort */ }
      return mcpFail(classifySdkError(error, 'server_unreachable'));
    }

    const port = new RelayMcpSdkClient({
      client,
      transport: 'streamable_http',
      negotiatedProtocolVersion: transport.negotiatedProtocolVersion,
      observedOrigin,
      onClose: async () => {
        try { await transport.close(); } catch { /* best effort */ }
      },
    });

    /**
     * RELAY'S OWN VERSION CHECK. The SDK accepts five revisions and falls back
     * to 2025-03-26; Relay accepts exactly one. A connected client that cannot
     * speak the baseline is closed here rather than handed out.
     */
    const negotiation = negotiateProtocol(port.session.negotiatedProtocolVersion);
    if (!negotiation.acceptable) {
      await port.close();
      return mcpFail(mcpFailure(
        'protocol_mismatch',
        negotiation.reason ?? `Relay requires MCP ${MCP_BASELINE_PROTOCOL_REVISION}`,
      ));
    }

    return mcpOk(port);
  }
}

/**
 * Captures the negotiated revision through the SDK's own
 * `Transport.setProtocolVersion` hook.
 *
 * The SDK `Client` does not expose the negotiated revision on a public getter
 * — it hands it to the transport. Subclassing to observe that call is the
 * supported seam; reading a private `_protocolVersion` would break silently on
 * an SDK upgrade, which is exactly the kind of silent break this milestone's
 * version policy exists to prevent.
 */
class CapturingStreamableHttpTransport extends StreamableHTTPClientTransport {
  private negotiated = '';

  override setProtocolVersion(version: string): void {
    this.negotiated = version;
    super.setProtocolVersion?.(version);
  }

  /** Empty until `initialize` completed — which `negotiateProtocol` refuses. */
  get negotiatedProtocolVersion(): string {
    return this.negotiated;
  }
}
