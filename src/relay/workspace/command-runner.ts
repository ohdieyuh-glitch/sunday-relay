import { spawn, type ChildProcess } from 'node:child_process';
import { boundOutput, sanitizeOutput } from './output-sanitizer';

/**
 * Bounded process runner (Prompt 7). Executes an ALREADY-APPROVED command
 * as executable + argument array with `shell: false` — no interpolation,
 * pipes, substitution, or redirects can exist. Runtime and both output
 * streams are hard-bounded; exceeding a stream cap terminates the process
 * (no unbounded capture, ever). Termination is escalated SIGTERM → SIGKILL
 * and its confirmation is reported honestly: if the process cannot be
 * confirmed dead, the result says so instead of claiming success.
 */

export interface BoundedRunRequest {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  outputLimitBytes: number;
}

export interface BoundedRunOutcome {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  outputLimitHit: boolean;
  termination: 'not_required' | 'termination_confirmed' | 'termination_unconfirmed';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  redactions: number;
  spawnError?: string;
}

export interface RunningCommandHandle {
  cancel(): boolean;
}

const KILL_GRACE_MS = 2_000;
const CONFIRM_WAIT_MS = 5_000;

export function runBoundedCommand(
  request: BoundedRunRequest,
  now: () => string,
  onHandle?: (handle: RunningCommandHandle) => void,
): Promise<BoundedRunOutcome> {
  return new Promise((resolvePromise) => {
    const startedAt = now();
    const startMono = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let cancelled = false;
    let outputLimitHit = false;
    let killRequested = false;
    let settled = false;
    let child: ChildProcess;

    const finish = (exitCode: number | null, signal: string | null, termination: BoundedRunOutcome['termination'], spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(escalateTimer);
      clearTimeout(confirmTimer);
      const boundedOut = boundOutput(stdout, request.outputLimitBytes);
      const boundedErr = boundOutput(stderr, request.outputLimitBytes);
      const cleanOut = sanitizeOutput(boundedOut.text);
      const cleanErr = sanitizeOutput(boundedErr.text);
      resolvePromise({
        exitCode,
        signal,
        stdout: cleanOut.text,
        stderr: cleanErr.text,
        timedOut,
        cancelled,
        truncated: boundedOut.truncated || boundedErr.truncated || outputLimitHit,
        outputLimitHit,
        termination,
        startedAt,
        completedAt: now(),
        durationMs: Date.now() - startMono,
        redactions: cleanOut.redactions + cleanErr.redactions,
        spawnError,
      });
    };

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let escalateTimer: ReturnType<typeof setTimeout> | undefined;
    let confirmTimer: ReturnType<typeof setTimeout> | undefined;

    const requestKill = () => {
      if (killRequested) return;
      killRequested = true;
      try {
        child.kill('SIGTERM');
      } catch { /* already gone */ }
      escalateTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch { /* already gone */ }
      }, KILL_GRACE_MS);
      confirmTimer = setTimeout(() => {
        // The process never reported exit: report the truth, not success.
        finish(null, null, 'termination_unconfirmed');
      }, KILL_GRACE_MS + CONFIRM_WAIT_MS);
    };

    try {
      child = spawn(request.executable, request.args, {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
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

    child.on('error', (error) => {
      finish(null, null, 'not_required', error.message.slice(0, 200));
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= request.outputLimitBytes * 2) stdout += chunk.toString('utf8');
      if (stdoutBytes > request.outputLimitBytes && !killRequested) {
        outputLimitHit = true;
        requestKill();
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= request.outputLimitBytes * 2) stderr += chunk.toString('utf8');
      if (stderrBytes > request.outputLimitBytes && !killRequested) {
        outputLimitHit = true;
        requestKill();
      }
    });

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      requestKill();
    }, request.timeoutMs);

    child.on('close', (code, signal) => {
      finish(code, signal, killRequested ? 'termination_confirmed' : 'not_required');
    });
  });
}
