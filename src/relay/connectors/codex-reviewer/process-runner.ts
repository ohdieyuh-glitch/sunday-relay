import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createReviewerStreamParser, type ParsedReviewerStream } from './stream-parser';
import { sanitizeOutput } from '../../workspace/output-sanitizer';

/**
 * Codex Reviewer process runner (Prompt 8.3) — spawns the local Codex
 * executable with `shell: false`, bounded runtime and output, and honest
 * cancellation (SIGTERM → SIGKILL with confirmation reporting). The review
 * contract is written to stdin (kept out of argv). The structured final report
 * is read from the --output-last-message file; the JSONL stream is parsed for
 * lifecycle + activity. NO shell, NO network grant here — the read-only
 * sandbox and env filtering are applied by the caller.
 */

const KILL_GRACE_MS = 3_000;
const CONFIRM_WAIT_MS = 5_000;

export interface CodexRunRequest {
  executablePath: string;
  args: string[];
  /** The review contract — written to stdin, never placed in argv. */
  prompt: string;
  cwd: string;
  env: Record<string, string>;
  outputLastMessagePath: string;
  maxRuntimeMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

export interface CodexRunOutcome {
  parsed: ParsedReviewerStream;
  /** Final report text — prefers the --output-last-message file, falls back
   * to assistant text captured from the stream. */
  finalMessage: string | null;
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

export interface CodexRunHandle {
  cancel(): boolean;
}

export function runCodexProcess(
  request: CodexRunRequest,
  now: () => string,
  onHandle?: (handle: CodexRunHandle) => void,
): Promise<CodexRunOutcome> {
  return new Promise<CodexRunOutcome>((resolve) => {
    const parser = createReviewerStreamParser();
    const startedAt = now();
    const startMs = Date.parse(startedAt);
    let stderr = '';
    let stdoutBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let cancelled = false;
    let killRequested = false;
    let finished = false;
    let child: ChildProcess | null = null;
    let spawnError: string | undefined;

    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let confirmTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = (): void => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (confirmTimer) clearTimeout(confirmTimer);
    };

    const finish = (
      exitCode: number | null,
      signal: string | null,
      termination: CodexRunOutcome['termination'],
    ): void => {
      if (finished) return;
      finished = true;
      clearTimers();
      const parsed = parser.end();
      // Prefer the structured final message from the output file.
      let finalMessage: string | null = null;
      try {
        const fileText = readFileSync(request.outputLastMessagePath, 'utf8');
        if (fileText && fileText.trim()) finalMessage = fileText;
      } catch {
        /* file absent — fall back to the stream */
      }
      if (finalMessage == null) finalMessage = parsed.finalMessage;
      const sanitizedErr = sanitizeOutput(stderr.slice(0, request.maxStderrBytes));
      const completedAt = now();
      resolve({
        parsed, finalMessage, stderr: sanitizedErr.text, exitCode, signal, startedAt, completedAt,
        durationMs: Math.max(0, Date.parse(completedAt) - startMs),
        timedOut, cancelled, outputTruncated, termination, spawnError, redactions: sanitizedErr.redactions,
      });
    };

    const requestKill = (): void => {
      if (killRequested || !child) return;
      killRequested = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      killTimer = setTimeout(() => {
        try {
          child?.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, KILL_GRACE_MS);
      confirmTimer = setTimeout(() => finish(null, 'SIGKILL', 'termination_unconfirmed'), KILL_GRACE_MS + CONFIRM_WAIT_MS);
    };

    if (onHandle) {
      onHandle({
        cancel(): boolean {
          if (finished) return false;
          cancelled = true;
          requestKill();
          return true;
        },
      });
    }

    try {
      child = spawn(request.executablePath, request.args, {
        cwd: request.cwd, env: request.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      spawnError = (err as Error).message;
      finish(null, null, 'not_required');
      return;
    }

    child.on('error', (err) => {
      spawnError = err.message;
      finish(null, null, 'not_required');
    });

    if (child.stdin) {
      child.stdin.on('error', () => { /* ignore broken pipe */ });
      child.stdin.write(request.prompt);
      child.stdin.end();
    }

    child.stdout?.on('data', (buf: Buffer) => {
      const chunk = buf.toString('utf8');
      stdoutBytes += buf.byteLength;
      if (stdoutBytes <= request.maxStdoutBytes * 2) parser.push(chunk);
      if (stdoutBytes > request.maxStdoutBytes && !outputTruncated) {
        outputTruncated = true;
        requestKill();
      }
    });

    child.stderr?.on('data', (buf: Buffer) => {
      if (stderr.length < request.maxStderrBytes) stderr += buf.toString('utf8');
    });

    child.on('close', (code, signal) => {
      const termination = killRequested ? 'termination_confirmed' : 'not_required';
      finish(code, signal ?? null, termination);
    });

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      requestKill();
    }, request.maxRuntimeMs);
  });
}
