/**
 * LOCAL STDIO TRANSPORT FACTORY (SERVER-ONLY — spawns child processes).
 *
 * Unreachable from the browser bundle;
 * `src/relay/shared/browser-boundary.test.ts` proves it by walking the module
 * graph from every browser entry.
 *
 * THE LAUNCH DECISION IS NOT MADE HERE. `planStdioLaunch`
 * (`./stdio-launch-policy.ts`) decides — executable allowlist, argument
 * allowlist, environment built from empty, filesystem-root check — and this
 * file only executes an already-approved plan. That is why the security rules
 * are fully tested without spawning anything, and why there is no branch here
 * through which an unapproved command could be reached.
 *
 * THE PROCESS ITSELF is run by `RelayStdioProcessTransport`, whose docstring
 * explains exactly why the SDK's own `StdioClientTransport` could not be used
 * (it merges parent environment, and it cannot spawn into a separate process
 * group). The SDK `Client` still owns all protocol behaviour.
 *
 * NOTHING LEAKS ON A FAILURE PATH. Every early return runs the same cleanup:
 * terminate the process group, remove the temporary root. The temporary
 * directory is created before the launch decision only because the decision
 * needs a cwd to check, so it must be removed on the refusal path too — and
 * `stdio-transport.test.ts` asserts a refused launch leaves no directory
 * behind and no process alive.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mcpFail, mcpFailure, mcpOk, type McpFailure, type McpOutcome } from '../domain/mcp-failure';
import { MCP_BASELINE_PROTOCOL_REVISION, negotiateProtocol } from '../domain/mcp-protocol';
import type {
  McpClientPort, McpTransportFactoryPort, McpTransportOpenRequest,
} from '../domain/mcp-ports';
import type { McpRegistryEntry } from '../registry/mcp-registry-types';
import { classifySdkError, RelayMcpSdkClient } from './mcp-sdk-client';
import { planStdioLaunch } from './stdio-launch-policy';
import { RelayStdioProcessTransport } from './stdio-process-transport';

export interface McpStdioTransportOptions {
  readonly registry: readonly McpRegistryEntry[];
  /**
   * Resolves an ALLOWLISTED EXECUTABLE NAME to an absolute path.
   *
   * Relay resolves the path itself and never lets the child do it, for a
   * reason that is easy to miss: the child's environment is built from empty,
   * so it has no `PATH`, so `execvp` would find nothing. Handing the resolver
   * this job keeps the empty environment intact instead of quietly adding a
   * `PATH` back to make name resolution work — which would reintroduce exactly
   * the parent-environment leak §8 forbids.
   *
   * The REGISTRY still only ever contains names; a path never appears in
   * curated data, and `planStdioLaunch` refuses one outright.
   */
  readonly resolveExecutable: (name: string) => string | null;
  /** Approved filesystem roots. Empty means isolated temp directories only. */
  readonly approvedFilesystemRoots: readonly string[];
  /** Resolved workspace root, when a registry entry asks to run there. */
  readonly workspaceRoot: string | null;
  /** Non-secret values Relay supplies to the child (e.g. a fixture scenario). */
  readonly relaySuppliedEnvironment?: Readonly<Record<string, string>>;
  /** Grace period between SIGTERM and SIGKILL on the process group. */
  readonly terminationGraceMs?: number;
}

const DEFAULT_TERMINATION_GRACE_MS = 2_000;

export class McpStdioTransportFactory implements McpTransportFactoryPort {
  readonly kind = 'stdio' as const;

  constructor(private readonly options: McpStdioTransportOptions) {}

  async open(request: McpTransportOpenRequest): Promise<McpOutcome<McpClientPort>> {
    const entry = this.options.registry.find((candidate) => candidate.registryEntryId === request.registryEntryId);
    if (entry === undefined || entry.stdio === null) {
      return mcpFail(mcpFailure('registry_untrusted', 'no curated stdio registry entry matches this connection'));
    }

    /* --- working directory --- */
    let temporaryRoot: string | null = null;
    let cwd: string;
    if (entry.stdio.workspaceRootBehavior === 'isolated_temp') {
      temporaryRoot = mkdtempSync(join(tmpdir(), 'relay-mcp-stdio-'));
      cwd = temporaryRoot;
    } else {
      if (this.options.workspaceRoot === null) {
        return mcpFail(mcpFailure(
          'environment_not_allowed',
          'this server runs in the workspace root and no workspace root is configured',
        ));
      }
      cwd = this.options.workspaceRoot;
    }
    const cleanupTemporary = (): void => {
      if (temporaryRoot === null) return;
      try { rmSync(temporaryRoot, { recursive: true, force: true }); } catch { /* best effort */ }
      temporaryRoot = null;
    };

    /* --- the launch DECISION --- */
    const plan = planStdioLaunch({
      definition: entry.stdio,
      additionalArguments: [],
      credentialEnvironment: request.resolvedCredential?.material ?? {},
      relaySuppliedEnvironment: this.options.relaySuppliedEnvironment ?? {},
      cwd,
      startupTimeoutMs: request.connectTimeoutMs,
      // A temp cwd is isolated by construction and needs no root check; a
      // workspace cwd is checked against the approved roots.
      approvedFilesystemRoots: temporaryRoot !== null ? [] : this.options.approvedFilesystemRoots,
    });
    if (!plan.allowed) {
      cleanupTemporary();
      return mcpFail(mcpFailure(plan.category, plan.reason));
    }

    /* --- fatal-condition latch --- */
    let fatal: McpFailure | null = null;
    const stderrChunks: string[] = [];
    const latch = (failure: McpFailure): void => {
      // FIRST failure wins: a crash followed by a pipe error should report the
      // crash, which is the cause, not its consequence.
      if (fatal === null) fatal = failure;
    };

    // Resolution happens AFTER the allowlist decision, never before: an
    // executable that policy refused is never looked up, so a resolver bug
    // cannot turn a refusal into a launch.
    const executablePath = this.options.resolveExecutable(plan.plan.executable);
    if (executablePath === null) {
      cleanupTemporary();
      return mcpFail(mcpFailure(
        'executable_not_allowed',
        `the allowlisted MCP executable "${plan.plan.executable}" is not installed on this host`,
      ));
    }

    const grace = this.options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
    const transport = new RelayStdioProcessTransport({
      executable: executablePath,
      args: plan.plan.args,
      env: plan.plan.env,
      cwd: plan.plan.cwd,
      terminationGraceMs: grace,
      onFatal: latch,
      onStderr: (text) => { if (stderrChunks.length < 40) stderrChunks.push(text); },
    });

    const client = new Client(
      { name: request.clientName, version: request.clientVersion },
      { capabilities: {} },
    );

    const teardown = async (): Promise<void> => {
      try { await transport.close(); } catch { /* best effort */ }
      cleanupTemporary();
    };

    /* --- startup, bounded --- */
    try {
      await client.connect(transport, {
        signal: request.signal,
        timeout: plan.plan.startupTimeoutMs,
      });
    } catch (error) {
      // Let the event loop drain before reading the latch. A child that died
      // mid-handshake produces the connect rejection and the `exit` event in
      // an order the OS decides; without this, a crash intermittently reports
      // as a generic timeout, which is a less truthful cause for the same
      // event. One turn is enough — the exit event is already queued.
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      await teardown();
      // A latched fatal condition (crash, non-MCP stdout) is a truer cause
      // than the connect rejection it produced.
      const failure = fatal ?? classifySdkError(error, 'process_spawn_failed');
      const stderr = stderrChunks.join('').trim();
      return mcpFail(stderr === ''
        ? failure
        : mcpFailure(failure.category, failure.message, { details: [`server stderr: ${stderr}`] }));
    }

    // A process that died during initialization is never ready, even if the
    // handshake completed against the bytes it had already written.
    if (fatal !== null) {
      const failure: McpFailure = fatal;
      await teardown();
      return mcpFail(failure);
    }

    const port = new RelayMcpSdkClient({
      client,
      transport: 'stdio',
      negotiatedProtocolVersion: transport.negotiatedProtocolVersion,
      observedOrigin: null,
      fatal: () => fatal,
      onClose: teardown,
    });

    /**
     * RELAY'S OWN VERSION CHECK, at the boundary.
     *
     * The SDK accepts FIVE revisions and defaults to 2025-03-26 — so
     * `client.connect()` succeeding proves only that some MCP was spoken.
     * Refusing here rather than only in the connection manager matters
     * because returning a client Relay already knows cannot speak its
     * baseline would leak a live child process onto a path that is going to
     * fail anyway.
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
