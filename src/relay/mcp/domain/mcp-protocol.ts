/**
 * MCP PROTOCOL IDENTITY AND NEGOTIATION (PURE).
 *
 * Relay's production baseline is the Model Context Protocol revision
 * **2025-11-25**. That single sentence is the whole of the version policy, and
 * everything here exists to keep it from quietly becoming untrue.
 *
 * WHY A RELAY-OWNED CONSTANT AND NOT THE SDK'S.
 * The official SDK ships `LATEST_PROTOCOL_VERSION`, which moves when the SDK
 * moves. Binding Relay's baseline to it would mean a routine dependency bump
 * silently changed which protocol a Mission Contract was verified against —
 * the version would be a fact about `node_modules`, not a decision anyone made.
 * The constant below is the decision; `mcp-sdk-contract.test.ts` asserts the
 * pinned SDK can actually speak it, so the two can never drift apart in
 * silence.
 *
 * THE DRAFT IS NOT THE BASELINE. Revision 2026-07-28 exists and Relay does not
 * run on it. It appears in `MCP_KNOWN_REVISIONS` so a server announcing it is
 * recognised and refused for a stated reason, rather than falling through the
 * generic "unknown version" path that cannot tell a draft from a typo.
 *
 * REQUESTED IS NOT NEGOTIATED. `requestedProtocolVersion` is what Relay asked
 * for; `negotiatedProtocolVersion` is what the server actually agreed to. They
 * are separate fields on every connection because a server is free to answer
 * with something else, and a host that stores only one of them cannot tell
 * "we speak 2025-11-25" from "we asked for it".
 */

/** The revision Relay implements, verifies against, and binds missions to. */
export const MCP_BASELINE_PROTOCOL_REVISION = '2025-11-25' as const;
export type McpBaselineProtocolRevision = typeof MCP_BASELINE_PROTOCOL_REVISION;

/**
 * Revisions Relay will ACCEPT from a server during negotiation.
 *
 * Deliberately a list of one. Accepting an older revision means every
 * capability, annotation and error shape below this line has a second
 * behaviour that nothing in this repository tests. When Relay adds a second
 * supported revision it will add the tests that prove both, and this array is
 * where that decision becomes visible in review.
 */
export const MCP_SUPPORTED_PROTOCOL_REVISIONS: readonly string[] = Object.freeze([
  MCP_BASELINE_PROTOCOL_REVISION,
]);

/**
 * Revisions Relay RECOGNISES, whether or not it accepts them. Used only to
 * produce a truthful refusal: "that is the 2026-07-28 draft and Relay's
 * production baseline is 2025-11-25" is an actionable message; "unsupported
 * protocol version" is not.
 */
export const MCP_KNOWN_REVISIONS: Readonly<Record<string, string>> = Object.freeze({
  '2024-11-05': 'an early MCP revision that predates Relay support',
  '2025-03-26': 'a superseded MCP revision that predates Relay support',
  '2025-06-18': 'a superseded MCP revision that predates Relay support',
  '2025-11-25': "Relay's production baseline",
  '2026-07-28': "a draft/release-candidate revision; Relay's production baseline is 2025-11-25",
});

export const MCP_TRANSPORT_KINDS = ['stdio', 'streamable_http'] as const;
export type McpTransportKind = (typeof MCP_TRANSPORT_KINDS)[number];

/**
 * Transports Relay deliberately does NOT implement in this milestone, with the
 * reason stated. Represented rather than omitted: a configuration naming
 * `http_sse` gets "deprecated, not supported by this milestone" instead of
 * "unknown transport", which is the difference between a user who knows what
 * to do and a user who files a bug.
 */
export const MCP_UNSUPPORTED_TRANSPORT_KINDS: Readonly<Record<string, string>> = Object.freeze({
  http_sse: 'the deprecated HTTP+SSE transport — superseded by Streamable HTTP and not supported by this milestone',
  websocket: 'not part of the MCP specification Relay implements',
});

export function isSupportedTransportKind(value: unknown): value is McpTransportKind {
  return typeof value === 'string' && (MCP_TRANSPORT_KINDS as readonly string[]).includes(value);
}

/**
 * The outcome of comparing what a server answered with against what Relay
 * supports. `acceptable: false` always carries a reason that names the actual
 * revision, because a protocol mismatch that cannot say which version it saw
 * is indistinguishable from a server that answered nothing.
 */
export interface McpProtocolNegotiation {
  readonly requested: string;
  readonly negotiated: string | null;
  readonly acceptable: boolean;
  readonly reason: string | null;
}

export function negotiateProtocol(
  serverAnswer: unknown,
  requested: string = MCP_BASELINE_PROTOCOL_REVISION,
): McpProtocolNegotiation {
  if (typeof serverAnswer !== 'string' || serverAnswer.trim() === '') {
    return {
      requested,
      negotiated: null,
      acceptable: false,
      reason: 'the server returned no usable protocolVersion during initialize',
    };
  }
  const negotiated = serverAnswer.trim();
  if (MCP_SUPPORTED_PROTOCOL_REVISIONS.includes(negotiated)) {
    return { requested, negotiated, acceptable: true, reason: null };
  }
  const known = MCP_KNOWN_REVISIONS[negotiated];
  return {
    requested,
    negotiated,
    acceptable: false,
    reason: known
      ? `the server negotiated ${negotiated} — ${known}; Relay requires ${MCP_BASELINE_PROTOCOL_REVISION}`
      : `the server negotiated an unrecognised protocol revision ${negotiated}; Relay requires ${MCP_BASELINE_PROTOCOL_REVISION}`,
  };
}

/**
 * The protocol facts Relay records for a connection. All four are stored
 * because collapsing them loses the only evidence that negotiation happened at
 * all (§4, identity separation).
 */
export interface McpProtocolIdentity {
  /** What Relay asked for. */
  readonly requestedProtocolVersion: string;
  /** What the server answered, verbatim — null when it never answered. */
  readonly negotiatedProtocolVersion: string | null;
  /** Whether the negotiated revision is one Relay accepts. */
  readonly acceptable: boolean;
  /** The configured transport. */
  readonly configuredTransport: McpTransportKind;
  /** The transport actually used. Differs from configured only through a bug,
   * which is precisely why both are recorded. */
  readonly actualTransport: McpTransportKind;
}
