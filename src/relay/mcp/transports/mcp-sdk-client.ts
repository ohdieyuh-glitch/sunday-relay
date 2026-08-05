/**
 * THE SDK ADAPTER — the ONLY module family that imports
 * `@modelcontextprotocol/sdk` (with its two transport siblings).
 *
 * Everything above this file speaks `McpClientPort` from
 * `../domain/mcp-ports.ts`. Nothing above it has ever seen an SDK type, and
 * `mcp-boundary.test.ts` fails the build if that changes.
 *
 * WHY RELAY DOES NOT TRUST THE SDK's PROTOCOL NEGOTIATION, even though it uses
 * the SDK for everything else. The pinned SDK exports:
 *
 *     LATEST_PROTOCOL_VERSION              = '2025-11-25'
 *     DEFAULT_NEGOTIATED_PROTOCOL_VERSION  = '2025-03-26'
 *     SUPPORTED_PROTOCOL_VERSIONS          = [2025-11-25, 2025-06-18,
 *                                             2025-03-26, 2024-11-05, 2024-10-07]
 *
 * So a `client.connect()` that succeeds proves only that the server spoke ONE
 * OF FIVE revisions — and a server that says nothing lands on 2025-03-26 by
 * default. Relay's production baseline is 2025-11-25 and only that. The
 * negotiated revision is therefore read back off the connected client and
 * re-checked by `negotiateProtocol` in `../domain/mcp-protocol.ts`, which is
 * what turns "the SDK connected" into "the server speaks the revision this
 * mission was verified against". `../mcp-boundary.test.ts` asserts the SDK's
 * own constant still equals Relay's baseline, so a dependency bump that moved
 * the protocol out from under us fails a test instead of shipping.
 *
 * EVERY ERROR BECOMES A CLASSIFIED VALUE. `classifySdkError` maps thrown SDK
 * and transport errors onto the `McpFailureCategory` taxonomy, keeping
 * timeout, cancellation, protocol mismatch, malformed response, auth failure
 * and unreachability distinct (§7). Nothing escapes as an exception, and no
 * raw upstream message reaches a caller — messages are Relay's own wording,
 * because an upstream error body is untrusted content that may carry a header,
 * a path, or a token.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

import {
  mcpFail, mcpFailure, mcpOk,
  type McpFailure, type McpFailureCategory, type McpOutcome,
} from '../domain/mcp-failure';
import type { McpDeclaredServerIdentity } from '../domain/mcp-identity';
import type { McpTransportKind } from '../domain/mcp-protocol';
import type {
  McpCallOptions, McpClientPort, McpListedCapabilities, McpRawPromptResult,
  McpRawResourceContents, McpRawToolResult, McpTransportSession,
} from '../domain/mcp-ports';
import type { McpRawContentBlock } from '../policy/mcp-sanitize';

/** JSON-RPC codes the SDK surfaces through `McpError`. */
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_PARSE_ERROR = -32700;
/** The SDK raises this code on its own request timeout. */
const MCP_REQUEST_TIMEOUT = -32001;

/**
 * Maps a thrown value onto Relay's taxonomy.
 *
 * `fallback` is what an otherwise-unrecognised error becomes. Callers pass the
 * category that is TRUE for their phase — an unrecognised failure while
 * opening a transport is `server_unreachable`, while the same failure during a
 * tool call is `tool_execution_error`. A single hardcoded fallback would
 * mislabel one of them, and a mislabelled failure sends an operator to the
 * wrong system.
 */
export function classifySdkError(error: unknown, fallback: McpFailureCategory): McpFailure {
  if (isAbortError(error)) {
    return mcpFailure('cancelled', 'the MCP request was cancelled');
  }
  if (error instanceof McpError) {
    switch (error.code) {
      case MCP_REQUEST_TIMEOUT:
        return mcpFailure('timed_out', 'the MCP request exceeded its timeout');
      case JSONRPC_PARSE_ERROR:
        return mcpFailure('malformed_response', 'the server sent a message that is not valid JSON-RPC');
      case JSONRPC_INVALID_REQUEST:
        return mcpFailure('malformed_response', 'the server rejected the request as malformed JSON-RPC');
      case JSONRPC_METHOD_NOT_FOUND:
        return mcpFailure('capability_missing', 'the server does not implement this MCP method');
      case JSONRPC_INVALID_PARAMS:
        return mcpFailure('result_rejected', 'the server rejected the request parameters');
      default:
        return mcpFailure(fallback, `the MCP server returned an error (code ${error.code})`);
    }
  }
  if (error instanceof Error) {
    const name = error.name;
    // Matched on NAME and on a small set of well-known Node error CODES —
    // never on the message text, which is upstream-controlled.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ECONNREFUSED') return mcpFailure('connection_refused', 'the MCP endpoint refused the connection');
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return mcpFailure('dns_resolution_failed', 'the MCP endpoint hostname could not be resolved');
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return mcpFailure('timed_out', 'the connection to the MCP endpoint timed out');
    if (code === 'ENOENT') return mcpFailure('process_spawn_failed', 'the MCP server executable could not be started');
    if (code === 'EPIPE') return mcpFailure('process_exited_early', 'the MCP server closed its input before the request completed');
    if (name === 'UnauthorizedError') return mcpFailure('authorization_required', 'the MCP endpoint requires authorization Relay does not hold');
    if (name === 'SyntaxError') return mcpFailure('malformed_response', 'the server sent a response that could not be parsed');
    if (name === 'RelayMcpPolicyError') return mcpFailure('network_policy_blocked', error.message);
    if (name === 'RelayMcpResponseError') return mcpFailure('malformed_response', error.message);
    if (name === 'RelayMcpSizeError') return mcpFailure('response_too_large', error.message);
    if (name === 'RelayMcpAuthError') return mcpFailure('authentication_failed', error.message);
  }
  return mcpFailure(fallback, `the MCP operation failed (${errorName(error)})`);
}

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/* ------------------------------------------------------------------ *
 * The port implementation.
 * ------------------------------------------------------------------ */

export interface RelayMcpSdkClientInput {
  readonly client: Client;
  readonly transport: McpTransportKind;
  /**
   * The revision the SERVER actually negotiated, captured from the SDK's
   * `Transport.setProtocolVersion` hook. Empty string when `initialize` never
   * completed — which `negotiateProtocol` treats as "no usable protocolVersion"
   * and REFUSES, rather than guessing the baseline.
   */
  readonly negotiatedProtocolVersion: string;
  readonly observedOrigin: string | null;
  /** Called on close, after the SDK closes, for transport-specific cleanup
   * (process-group termination). Must never throw. */
  readonly onClose?: () => Promise<void>;
  /** Set when the transport detected a fatal condition (crash, non-MCP
   * stdout). Consulted before every call so a dead process can never serve. */
  readonly fatal?: () => McpFailure | null;
}

/**
 * Wraps a CONNECTED SDK client as an `McpClientPort`.
 *
 * The client must already be connected: `session` reads the negotiated
 * protocol and the declared identity, and both are only available afterwards.
 * A wrapper constructed around an unconnected client would report an empty
 * identity as though the server had declared nothing, which is a very
 * different fact.
 */
export class RelayMcpSdkClient implements McpClientPort {
  readonly session: McpTransportSession;

  constructor(private readonly input: RelayMcpSdkClientInput) {
    const version = input.client.getServerVersion();
    const declaredIdentity: McpDeclaredServerIdentity | null = version === undefined
      ? null
      : {
        name: typeof version.name === 'string' ? version.name : '',
        version: typeof version.version === 'string' ? version.version : null,
        title: typeof (version as { title?: unknown }).title === 'string' ? (version as { title: string }).title : null,
      };
    this.session = {
      transport: input.transport,
      // Captured from the transport's `setProtocolVersion` hook, then
      // re-checked by Relay's own negotiator — see the module docstring.
      negotiatedProtocolVersion: input.negotiatedProtocolVersion,
      declaredIdentity,
      serverCapabilityFlags: input.client.getServerCapabilities(),
      observedOrigin: input.observedOrigin,
    };
  }

  /** A fatal transport condition beats any in-flight result. */
  private fatalFailure(): McpFailure | null {
    return this.input.fatal?.() ?? null;
  }

  async listCapabilities(options: McpCallOptions): Promise<McpOutcome<McpListedCapabilities>> {
    const fatal = this.fatalFailure();
    if (fatal !== null) return mcpFail(fatal);

    const flags = this.input.client.getServerCapabilities();
    const request = { timeout: options.timeoutMs, signal: options.signal };
    try {
      // A server that does not advertise a capability is not asked for it.
      // Calling `tools/list` on a server without a tools capability is a
      // protocol error that would be reported as a discovery failure, when the
      // truth is simply that this server has no tools.
      const tools = flags?.tools ? (await this.input.client.listTools(undefined, request)).tools : [];
      const resources = flags?.resources ? (await this.input.client.listResources(undefined, request)).resources : [];
      const prompts = flags?.prompts ? (await this.input.client.listPrompts(undefined, request)).prompts : [];
      return mcpOk({ tools, resources, prompts });
    } catch (error) {
      return mcpFail(classifySdkError(error, 'initialize_failed'));
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: McpCallOptions,
  ): Promise<McpOutcome<McpRawToolResult>> {
    const fatal = this.fatalFailure();
    if (fatal !== null) return mcpFail(fatal);
    try {
      const result = await this.input.client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: options.timeoutMs, signal: options.signal },
      );
      // Re-check AFTER the call: a process that crashed mid-call must not have
      // whatever arrived first treated as its answer.
      const after = this.fatalFailure();
      if (after !== null) return mcpFail(after);
      return mcpOk({
        content: toContentBlocks(result.content),
        isError: result.isError === true,
        structuredContent: (result as { structuredContent?: unknown }).structuredContent ?? null,
      });
    } catch (error) {
      return mcpFail(classifySdkError(error, 'tool_execution_error'));
    }
  }

  async readResource(uri: string, options: McpCallOptions): Promise<McpOutcome<McpRawResourceContents>> {
    const fatal = this.fatalFailure();
    if (fatal !== null) return mcpFail(fatal);
    try {
      const result = await this.input.client.readResource({ uri }, { timeout: options.timeoutMs, signal: options.signal });
      const after = this.fatalFailure();
      if (after !== null) return mcpFail(after);
      return mcpOk({ contents: toContentBlocks(result.contents) });
    } catch (error) {
      return mcpFail(classifySdkError(error, 'result_rejected'));
    }
  }

  async getPrompt(
    name: string,
    args: Record<string, string>,
    options: McpCallOptions,
  ): Promise<McpOutcome<McpRawPromptResult>> {
    const fatal = this.fatalFailure();
    if (fatal !== null) return mcpFail(fatal);
    try {
      const result = await this.input.client.getPrompt(
        { name, arguments: args },
        { timeout: options.timeoutMs, signal: options.signal },
      );
      const after = this.fatalFailure();
      if (after !== null) return mcpFail(after);
      return mcpOk({
        description: typeof result.description === 'string' ? result.description : null,
        messages: Array.isArray(result.messages) ? result.messages : [],
      });
    } catch (error) {
      return mcpFail(classifySdkError(error, 'result_rejected'));
    }
  }

  async ping(options: McpCallOptions): Promise<McpOutcome<true>> {
    const fatal = this.fatalFailure();
    if (fatal !== null) return mcpFail(fatal);
    try {
      await this.input.client.ping({ timeout: options.timeoutMs, signal: options.signal });
      const after = this.fatalFailure();
      if (after !== null) return mcpFail(after);
      return mcpOk(true);
    } catch (error) {
      return mcpFail(classifySdkError(error, 'server_unreachable'));
    }
  }

  /**
   * Closes the SDK client, then runs transport cleanup — in that order, and
   * BOTH regardless of whether the first threw. A close path that stops at its
   * first error is how an orphaned child process happens.
   */
  async close(): Promise<void> {
    try {
      await this.input.client.close();
    } catch {
      // A client that cannot close cleanly still must not block cleanup.
    } finally {
      await this.input.onClose?.().catch(() => undefined);
    }
  }
}

/* ------------------------------------------------------------------ */

/** Normalizes SDK content into Relay's raw-block shape, trusting nothing. */
function toContentBlocks(value: unknown): readonly McpRawContentBlock[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return { type: 'unknown' } satisfies McpRawContentBlock;
    }
    const record = entry as Record<string, unknown>;
    return {
      type: typeof record.type === 'string' ? record.type : 'unknown',
      text: record.text,
      mimeType: record.mimeType,
      data: record.data,
      uri: record.uri,
    } satisfies McpRawContentBlock;
  });
}
