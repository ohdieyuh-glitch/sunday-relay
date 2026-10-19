/**
 * THE MCP ADAPTER BOUNDARY (PURE TYPES ONLY).
 *
 * This file is the seam §3 requires: **the official MCP SDK lives BELOW these
 * interfaces and nothing above them ever sees it.**
 *
 * Every type here is Relay's own. No `Client`, no `Transport`, no `Tool`, no
 * `CallToolResult` from `@modelcontextprotocol/sdk` appears in any signature,
 * so:
 *
 *   - the gateway, the policy layer, the mission preflight, the CLI and the
 *     website can all be written, typed and tested with no SDK installed at
 *     all — and they are: `mcp-gateway.test.ts` runs entirely against fakes;
 *   - an SDK upgrade changes `../client/` and nothing else. If a major version
 *     renames `CallToolResult`, that is a one-file edit, not a repository-wide
 *     migration through domain records that were secretly SDK shapes;
 *   - nothing durable can hold a live handle. A raw SDK object owns a socket
 *     or a child process, and the moment one is stored in a snapshot, a
 *     capsule or a ledger entry, that record stops being serializable and
 *     starts being a resource leak.
 *
 * `mcp-boundary.test.ts` enforces this structurally: it reads every file
 * outside `src/relay/mcp/client/` and `src/relay/mcp/transports/` and fails if
 * any of them imports the SDK. The rule is not a convention here — it is a
 * test that names the offending file.
 */

import type { McpCapabilitySnapshot } from './mcp-capabilities';
import type { McpCredentialReference } from './mcp-credential';
import type { McpFailure, McpOutcome } from './mcp-failure';
import type { McpDeclaredServerIdentity } from './mcp-identity';
import type { McpTransportKind } from './mcp-protocol';
import type { McpRawContentBlock } from '../policy/mcp-sanitize';

/** What one live transport session exposes. Relay-shaped, SDK-free. */
export interface McpTransportSession {
  readonly transport: McpTransportKind;
  readonly negotiatedProtocolVersion: string;
  readonly declaredIdentity: McpDeclaredServerIdentity | null;
  readonly serverCapabilityFlags: unknown;
  /** For HTTP: the origin the response actually came from. */
  readonly observedOrigin: string | null;
}

export interface McpListedCapabilities {
  readonly tools: readonly unknown[];
  readonly resources: readonly unknown[];
  readonly prompts: readonly unknown[];
}

export interface McpRawToolResult {
  readonly content: readonly McpRawContentBlock[];
  readonly isError: boolean;
  readonly structuredContent: unknown;
}

export interface McpRawResourceContents {
  readonly contents: readonly McpRawContentBlock[];
}

export interface McpRawPromptResult {
  readonly description: string | null;
  readonly messages: readonly unknown[];
}

/**
 * One connected MCP server, as Relay sees it. Every method is cancellable and
 * every method is bounded — there is deliberately no un-timed call on this
 * interface, because an un-timed call is how a mission hangs forever.
 */
export interface McpClientPort {
  listCapabilities(options: McpCallOptions): Promise<McpOutcome<McpListedCapabilities>>;
  callTool(name: string, args: Record<string, unknown>, options: McpCallOptions): Promise<McpOutcome<McpRawToolResult>>;
  readResource(uri: string, options: McpCallOptions): Promise<McpOutcome<McpRawResourceContents>>;
  getPrompt(name: string, args: Record<string, string>, options: McpCallOptions): Promise<McpOutcome<McpRawPromptResult>>;
  /** Cheap liveness probe. Never reports a crashed process as healthy. */
  ping(options: McpCallOptions): Promise<McpOutcome<true>>;
  close(): Promise<void>;
  readonly session: McpTransportSession;
}

export interface McpCallOptions {
  readonly timeoutMs: number;
  /** Cooperative cancellation. Honoured by every transport. */
  readonly signal?: AbortSignal;
}

/** Opens a transport. Implemented once per transport kind in `../transports`. */
export interface McpTransportFactoryPort {
  readonly kind: McpTransportKind;
  open(request: McpTransportOpenRequest): Promise<McpOutcome<McpClientPort>>;
}

export interface McpTransportOpenRequest {
  readonly connectionId: string;
  readonly registryEntryId: string;
  readonly requestedProtocolVersion: string;
  readonly clientName: string;
  readonly clientVersion: string;
  readonly connectTimeoutMs: number;
  readonly signal?: AbortSignal;
  /** Resolved server-side, immediately before opening. Never stored. */
  readonly resolvedCredential: McpResolvedCredential | null;
}

/**
 * THE ONLY PLACE A REAL SECRET EXISTS IN THIS SUBSYSTEM, and it exists for the
 * duration of one `open` call.
 *
 * It is never a field on a domain record, never returned from a port, never
 * logged, and never persisted. `mcp-credential-boundary.test.ts` asserts no
 * durable Relay type structurally contains it.
 */
export interface McpResolvedCredential {
  readonly reference: McpCredentialReference;
  /** For HTTP: header name → value. For stdio: env name → value. */
  readonly material: Readonly<Record<string, string>>;
}

/**
 * Resolves a reference to material. SERVER-ONLY: implemented behind the
 * boundary and never imported by a browser module.
 */
export interface McpCredentialResolverPort {
  resolve(reference: McpCredentialReference): Promise<McpOutcome<McpResolvedCredential>>;
}

/** Where capability snapshots are kept. In-memory now; durable later. */
export interface McpSnapshotStorePort {
  put(snapshot: McpCapabilitySnapshot): void;
  get(snapshotId: string): McpCapabilitySnapshot | null;
  latestForConnection(connectionId: string): McpCapabilitySnapshot | null;
}

/** Where safe MCP evidence is written. Returns a REFERENCE, never content. */
export interface McpEvidenceStorePort {
  store(input: {
    readonly connectionId: string;
    readonly invocationId: string;
    readonly blockIndex: number;
    readonly mimeType: string | null;
    readonly bytes: number;
    readonly digest: string;
  }): string;
}

export type McpPortOutcome<T> = McpOutcome<T>;
export type { McpFailure };
