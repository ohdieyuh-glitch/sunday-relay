import { spawn, type ChildProcess } from 'node:child_process';
import { createStreamParser, type ParsedStreamState } from './stream-parser';
import { sanitizeOutput } from '../../workspace/output-sanitizer';

/**
 * Claude Code process runner (Prompt 8). Launches the resolved Claude
 * executable with an explicit argument array, `shell: false`, cwd pinned to
 * the isolated workspace, a filtered environment, and hard runtime/output
 * bounds. Streams stdout into the incremental parser as it arrives; stderr
 * is captured bounded and secret-sanitized. Cancellation and timeout
 * escalate SIGTERM -> SIGKILL and report termination honestly.
 *
 * The prompt is delivered on stdin (kept out of argv / the process list).
 */

export interface ClaudeRunRequest {
  executablePath: string;
  args: string[];
  prompt: string;
  cwd: string;
  env: Record<string, string>;
  maxRuntimeMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

export interface ClaudeRunOutcome {
  parsed: ParsedStreamState;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  outputTruncated: boolean;
  termination: 'not_required' | 'termination_confirmed' | 'termination_unconfirmed';
  spawnError?: string;
  redactions: number;
}

export interface ClaudeRunHandle {
  cancel(): boolean;
}

const KILL_GRACE_MS = 3_000;
const CONFIRM_WAIT_MS = 5_000;

export function runClaudeProcess(
  request: ClaudeRunRequest,
  now: () => string,
  onHandle?: (handle: ClaudeRunHandle) => void,
): Promise<ClaudeRunOutcome> {
  return new Promise((resolvePromise) => {
    const startedAt = now();
    const startMono = Date.now();
    const parser = createStreamParser();
    let stdoutBytes = 0;
    let stderr = '';
    let stderrBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let cancelled = false;
    let killRequested = false;
    let settled = false;
    let child: ChildProcess;

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let escalateTimer: ReturnType<typeof setTimeout> | undefined;
    let confirmTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (exitCode: number | null, signal: string | null, termination: ClaudeRunOutcome['termination'], spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(escalateTimer);
      clearTimeout(confirmTimer);
      const clean = sanitizeOutput(stderr);
      resolvePromise({
        parsed: parser.end(),
        stderr: clean.text,
        exitCode, signal, startedAt, completedAt: now(),
        durationMs: Date.now() - startMono,
        timedOut, cancelled, outputTruncated, termination,
        spawnError, redactions: clean.redactions,
      });
    };

    const requestKill = () => {
      if (killRequested) return;
      killRequested = true;
      try { child.kill('SIGTERM'); } catch { /* gone */ }
      escalateTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, KILL_GRACE_MS);
      confirmTimer = setTimeout(() => finish(null, null, 'termination_unconfirmed'), KILL_GRACE_MS + CONFIRM_WAIT_MS);
    };

    try {
      child = spawn(request.executablePath, request.args, {
        cwd: request.cwd, env: request.env, shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(null, null, 'not_required', error instanceof Error ? error.message.slice(0, 200) : 'spawn failed');
      return;
    }

    onHandle?.({
      cancel: () => {
        if (settled) return false;
        cancelled = true;
        requestKill();
        return true;
      },
    });

    child.on('error', (error) => finish(null, null, 'not_required', error.message.slice(0, 200)));

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= request.maxStdoutBytes * 2) parser.push(chunk.toString('utf8'));
      if (stdoutBytes > request.maxStdoutBytes && !killRequested) {
        outputTruncated = true;
        requestKill();
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= request.maxStderrBytes) stderr += chunk.toString('utf8');
      else if (!outputTruncated) outputTruncated = true;
    });

    // Relay controls stdin: deliver the prompt, then close it.
    //
    // THE LISTENER IS THE GUARD, NOT THE try/catch. A broken pipe arrives
    // ASYNCHRONOUSLY as an `error` event on the stream, so the catch below —
    // which only sees a synchronous throw — never ran, and an unlistened
    // stream `error` is an uncaught exception that takes the process down.
    // THE TRIGGER IS A PIPE THAT BREAKS MID-WRITE, not a child that has already
    // gone: a child that exits BEFORE the write survives, because the stream is
    // destroyed and the write is discarded (measured 11 of 11). What crashes is
    // the read end closing while this stream is still writable — a large frame
    // in flight when the child dies, or a live child that closes its own stdin.
    // Observed as `Error: write EPIPE` in a full suite run. The reviewer's runner
    // (`connectors/codex-reviewer/process-runner.ts`) has always attached
    // this; this one diverged from its own sibling.
    //
    // Attached BEFORE the write, because attaching after leaves the window it
    // exists to close.
    child.stdin?.on('error', () => { /* the process may have exited already */ });
    try {
      child.stdin?.write(request.prompt);
      child.stdin?.end();
    } catch { /* the same, arriving synchronously */ }

    timeoutTimer = setTimeout(() => { timedOut = true; requestKill(); }, request.maxRuntimeMs);

    child.on('close', (code, signal) => {
      finish(code, signal, killRequested ? 'termination_confirmed' : 'not_required');
    });
  });
}
