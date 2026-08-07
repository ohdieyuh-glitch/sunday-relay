/**
 * RELAY-OWNED STDIO PROCESS TRANSPORT (SERVER-ONLY).
 *
 * WHY THIS EXISTS INSTEAD OF THE SDK's `StdioClientTransport`.
 *
 * The directive is explicit that hand-written JSON-RPC is forbidden "when the
 * official SDK provides the required behavior". For stdio, it does not — in
 * two specific, verified ways. Both were confirmed by reading the pinned SDK
 * 1.30.0 source, not assumed:
 *
 *   1. IT COPIES PARENT ENVIRONMENT. `StdioClientTransport.start()` spawns with
 *          env: { ...getDefaultEnvironment(), ...serverParams.env }
 *      and on POSIX `getDefaultEnvironment()` returns HOME, LOGNAME, PATH,
 *      SHELL, TERM and USER read from `process.env`. There is no option to
 *      turn it off. §8 requires that Relay does NOT copy the parent process
 *      environment into a third-party MCP server, and an env built from empty
 *      that the transport then merges parent variables into is not an env
 *      built from empty.
 *
 *   2. IT CANNOT PREVENT ORPHANS. The spawn options are `shell: false`,
 *      `windowsHide`, `stdio`, `cwd`, `env` — there is no `detached`, so the
 *      child joins Relay's process group. `process.kill(-pid)` therefore
 *      cannot be used, and killing only the direct child leaves any helper
 *      process the MCP server spawned running after the mission ends. §6
 *      requires terminating the COMPLETE PROCESS GROUP and preventing orphans.
 *
 * SO WHAT IS RELAY'S HERE IS THE PROCESS, AND ONLY THE PROCESS. This class
 * implements the SDK's own `Transport` interface and uses the SDK's own
 * `ReadBuffer`, `deserializeMessage` and `serializeMessage` for framing. The
 * SDK `Client` still owns every piece of protocol behaviour: initialization,
 * version negotiation, request/response correlation, schema validation,
 * notifications, cancellation. No JSON-RPC is written by hand — not a message,
 * not an id, not a frame.
 *
 * THE STDOUT CHANNEL IS THE PROTOCOL. A line that is not JSON-RPC on stdout is
 * reported as `non_mcp_stdout`, distinctly from `malformed_response`, because
 * "this is not an MCP server" and "this MCP server is broken" call for
 * different actions.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { CONSEQUENTIAL_DETAIL, mcpFailure, type McpFailure } from '../domain/mcp-failure';
import { redactStderr } from './stdio-launch-policy';

export interface RelayStdioProcessTransportOptions {
  readonly executable: string;
  readonly args: readonly string[];
  /** The COMPLETE environment. Nothing is merged into it. */
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly terminationGraceMs: number;
  /** Latches a fatal condition for the client wrapper to observe. */
  readonly onFatal: (failure: McpFailure) => void;
  /** Receives redacted, bounded stderr text. */
  readonly onStderr: (text: string) => void;
}

const MAX_STDERR_BYTES = 64 * 1024;

export class RelayStdioProcessTransport implements Transport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly readBuffer = new ReadBuffer();
  private stderrBytes = 0;
  private closing = false;

  private negotiated = '';

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private readonly options: RelayStdioProcessTransportOptions) {}

  /** The spawned pid, for tests that assert the group is gone. */
  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  /**
   * The SDK's own hook. `Client.connect()` calls this with the revision the
   * server actually negotiated — the SDK does not expose it any other way, and
   * reading a private field instead would break silently on an SDK upgrade.
   *
   * Capturing it here is what lets Relay re-check the result against its OWN
   * baseline: the SDK accepts five revisions, Relay accepts one.
   */
  setProtocolVersion(version: string): void {
    this.negotiated = version;
  }

  /** Empty until `initialize` completed — which `negotiateProtocol` refuses. */
  get negotiatedProtocolVersion(): string {
    return this.negotiated;
  }

  async start(): Promise<void> {
    if (this.child !== null) throw new Error('RelayStdioProcessTransport already started');

    const child = spawn(this.options.executable, [...this.options.args], {
      // THE COMPLETE ENVIRONMENT. No spread of `process.env`, no
      // `getDefaultEnvironment()`. What the launch policy built is what the
      // child gets, and nothing else.
      env: { ...this.options.env },
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // NEVER a shell. There is no command string to interpret, and this makes
      // that structural rather than conventional.
      shell: false,
      // Its OWN PROCESS GROUP, so `kill(-pid)` reaches the server AND anything
      // the server itself spawned. This is the orphan-prevention guarantee.
      detached: true,
      windowsHide: process.platform === 'win32',
    }) as ChildProcessWithoutNullStreams;

    this.child = child;

    child.on('error', (error: Error) => {
      this.options.onFatal(classifySpawnError(error));
      this.onerror?.(error);
    });

    child.on('exit', (code, signal) => {
      if (this.closing) return;
      // An exit Relay did not ask for is a crash, and a crash can never be a
      // completion. Recorded truthfully, including the signal.
      this.options.onFatal(mcpFailure(
        signal !== null ? 'process_crashed' : 'process_exited_early',
        signal !== null
          ? `the MCP server process was terminated by ${signal}`
          : `the MCP server process exited with code ${code ?? 'unknown'} before the transport was closed`,
      ));
      this.onclose?.();
    });

    child.stdout.on('data', (chunk: Buffer) => {
      this.readBuffer.append(chunk);
      this.drain();
    });
    child.stdout.on('error', (error: Error) => this.onerror?.(error));
    // AND STDIN, which had no listener at all. A write callback does NOT
    // suppress the stream's `error` event: measured on Node 22, one broken pipe
    // delivered EPIPE to the write callback AND emitted `error` on the stream,
    // and an unlistened stream `error` is an uncaught exception. That is the
    // whole reason this listener exists — a `try`/`catch` around the write sees
    // neither, because both arrive asynchronously.
    //
    // ROUTED TO `onFatal`, not just `onerror`, which is the difference between
    // the error reaching someone and not. `onerror` is the Transport
    // interface's channel and the SDK claims it at `connect()`; nothing in
    // this repository sets `client.onerror`, so an error sent only there is
    // dropped. `onFatal` is latched and surfaced in the returned `McpFailure`.
    // The classification matches `mcp-sdk-client.ts`, which already maps EPIPE
    // to `process_exited_early`. Both channels are called, as the spawn-error
    // path above does.
    child.stdin.on('error', (error: Error) => {
      if (!this.closing) {
        // A CONSEQUENCE, not a cause. When the server was killed, its `exit`
        // handler knows the signal and this does not — so the latch in
        // `stdio-transport.ts` lets a `process_crashed` replace this.
        this.options.onFatal(mcpFailure(
          'process_exited_early',
          'the MCP server closed its input before the transport finished writing to it',
          { details: [CONSEQUENTIAL_DETAIL] },
        ));
      }
      this.onerror?.(error);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (this.stderrBytes >= MAX_STDERR_BYTES) return;   // bounded: a crash loop cannot flood evidence
      this.stderrBytes += chunk.length;
      // REDACTED BEFORE IT IS ANYTHING — before a log, a note, or an error.
      this.options.onStderr(redactStderr(chunk.toString('utf8')).text);
    });

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', (error: Error) => reject(error));
    });
  }

  /** Reads whole JSON-RPC lines using the SDK's own framing. */
  private drain(): void {
    for (;;) {
      let message: JSONRPCMessage | null;
      try {
        message = this.readBuffer.readMessage();
      } catch (error) {
        // The SDK's deserializer rejected a complete line. That line was on
        // the PROTOCOL channel and was not JSON-RPC — a banner, a warning, a
        // stack trace. Distinct category, distinct operator action.
        this.options.onFatal(mcpFailure(
          'non_mcp_stdout',
          'the MCP server wrote non-JSON-RPC output to stdout, corrupting the protocol channel',
          { details: [`parser: ${error instanceof Error ? error.name : typeof error}`] },
        ));
        this.onerror?.(error instanceof Error ? error : new Error('non-MCP stdout'));
        return;
      }
      if (message === null) return;
      this.onmessage?.(message);
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const child = this.child;
    if (child === null) throw new Error('RelayStdioProcessTransport is not started');
    await new Promise<void>((resolve, reject) => {
      // The SDK's serializer — Relay writes no JSON-RPC of its own.
      const ok = child.stdin.write(serializeMessage(message), (error) => {
        if (error) reject(error); else resolve();
      });
      if (ok) resolve();
    });
  }

  /**
   * Closes stdin, then terminates the COMPLETE PROCESS GROUP: SIGTERM so a
   * well-behaved server can flush and exit, SIGKILL after the grace period so
   * a wedged one still dies. Every step is guarded — a close path that stops
   * at its first error is exactly how an orphan is created.
   */
  async close(): Promise<void> {
    this.closing = true;
    const child = this.child;
    this.child = null;
    if (child === null) return;

    try { child.stdin.end(); } catch { /* already closed */ }

    const pid = child.pid;
    if (pid === undefined) return;

    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        // NEGATIVE pid = the whole group. Only possible because of `detached`.
        process.kill(-pid, signal);
      } catch {
        try { process.kill(pid, signal); } catch { /* already gone */ }
      }
    };

    signalGroup('SIGTERM');
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => { child.once('exit', () => resolve(true)); }),
      new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), this.options.terminationGraceMs); }),
    ]);
    if (!exited) signalGroup('SIGKILL');

    try { child.stdout.destroy(); child.stderr.destroy(); } catch { /* already destroyed */ }
    this.onclose?.();
  }
}

function classifySpawnError(error: Error): McpFailure {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    return mcpFailure('process_spawn_failed', 'the MCP server executable was not found on this host');
  }
  if (code === 'EACCES') {
    return mcpFailure('process_spawn_failed', 'the MCP server executable is not executable by this process');
  }
  return mcpFailure('process_spawn_failed', `the MCP server process could not be started (${error.name})`);
}
