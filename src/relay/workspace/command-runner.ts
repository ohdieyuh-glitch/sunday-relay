import { spawn } from 'node:child_process';
import type { TerminationOutcome } from './contracts';

/**
 * Bounded process runner (Prompt 7). spawn(executable, args) with
 * `shell: false` ALWAYS — no interpolation, no pipes, no substitution, no
 * redirects, no `bash -c` equivalents can ever exist here. Runtime and
 * output are hard-bounded; exceeding the output budget terminates the
 * process rather than pretending full output is available. Cancellation and
 * timeouts terminate the detached process group (SIGTERM, then SIGKILL),
 * and termination is only ever reported as confirmed when the close event
 * actually arrived.
 */

export interface RunnerRequest {
  commandId: string;
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  outputLimitBytes: number;
}

export interface RunnerOutcome {
  status: 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'output_limit';
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  termination: TerminationOutcome;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface CommandRunner {
  execute(request: RunnerRequest): Promise<RunnerOutcome>;
  /** True when a matching active process existed and stop was requested. */
  cancel(commandId: string): boolean;
}

export function createCommandRunner(clock: { now(): string } = { now: () => new Date().toISOString() }): CommandRunner {
  const active = new Map<string, () => void>();

  const execute = (request: RunnerRequest): Promise<RunnerOutcome> =>
    new Promise((resolveOutcome) => {
      const startedAt = clock.now();
      const startMs = Date.now();
      let stdout = '';
      let stderr = '';
      let capturedBytes = 0;
      let truncated = false;
      let timedOut = false;
      let cancelled = false;
      let overflow = false;
      let killRequested = false;
      let closed = false;
      let settled = false;

      const child = spawn(request.executable, request.args, {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const killTree = (signal: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          try {
            child.kill(signal);
          } catch {
            /* already gone */
          }
        }
      };
      const requestStop = () => {
        if (killRequested) return;
        killRequested = true;
        killTree('SIGTERM');
        setTimeout(() => {
          if (!closed) killTree('SIGKILL');
        }, 1500).unref();
      };

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        requestStop();
      }, request.timeoutMs);
      timeoutTimer.unref();

      active.set(request.commandId, () => {
        cancelled = true;
        requestStop();
      });

      const collect = (stream: 'out' | 'err') => (chunk: Buffer) => {
        capturedBytes += chunk.length;
        if (capturedBytes > request.outputLimitBytes) {
          truncated = true;
          if (!overflow) {
            overflow = true;
            requestStop();
          }
          return;
        }
        if (stream === 'out') stdout += chunk.toString('utf8');
        else stderr += chunk.toString('utf8');
      };
      child.stdout?.on('data', collect('out'));
      child.stderr?.on('data', collect('err'));

      const finish = (exitCode: number | null, signal: string | null, termination: TerminationOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        active.delete(request.commandId);
        const status: RunnerOutcome['status'] = cancelled
          ? 'cancelled'
          : timedOut
            ? 'timed_out'
            : overflow
              ? 'output_limit'
              : exitCode === 0
                ? 'completed'
                : 'failed';
        resolveOutcome({
          status,
          exitCode,
          signal,
          stdout: truncated ? `${stdout}\n[TRUNCATED: output limit reached]` : stdout,
          stderr,
          truncated,
          timedOut,
          cancelled,
          termination,
          startedAt,
          completedAt: clock.now(),
          durationMs: Date.now() - startMs,
        });
      };

      child.on('error', (err) => {
        stderr += `[spawn error] ${err.message}`;
        finish(null, null, 'not_required');
      });
      child.on('close', (code, signal) => {
        closed = true;
        finish(code, signal, killRequested ? 'termination_confirmed' : 'not_required');
      });

      // Never claim termination that was not observed: if close never
      // arrives after a kill, report termination_unconfirmed honestly.
      setTimeout(() => {
        if (!settled) finish(null, null, killRequested ? 'termination_unconfirmed' : 'not_required');
      }, request.timeoutMs + 10_000).unref();
    });

  return {
    execute,
    cancel(commandId) {
      const stop = active.get(commandId);
      if (!stop) return false;
      stop();
      return true;
    },
  };
}
