import { spawn, type ChildProcess } from 'node:child_process';
import { boundOutput, REDACTION_MARK, sanitizeOutput } from './output-sanitizer';

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

/** The exact suffix `boundOutput` appends to text it cut. */
const TRUNCATION_SUFFIX = /\n\[TRUNCATED: output limit reached\]$/;

/**
 * A stream that STOPPED EARLY (the cap cut it, a chunk was dropped, a timeout, a cancel or a kill) can end inside a secret. The sanitizer's patterns
 * need a secret's WHOLE shape, so the surviving head of a cut secret is stored in clear. This withholds what such a stream cannot prove complete:
 *  1. an UNTERMINATED private key block (a BEGIN header with no END after it): from the header to the end;
 *  2. the TRAILING PARTIAL TOKEN: the last run of non-whitespace characters, when the text ends without whitespace.
 * Only applied to a stream that stopped early; a stream that ended by itself is stored exactly as before. Sanitizer patterns are not changed.
 */
function withholdOpenSecret(text: string): { text: string; withheld: number } {
  let out = text;
  let withheld = 0;
  const begins = [...out.matchAll(/BEGIN [A-Z ]*PRIVATE KEY/g)];
  const last = begins[begins.length - 1];
  if (last?.index !== undefined && !/END [A-Z ]*PRIVATE KEY/.test(out.slice(last.index))) {
    let start = last.index;
    while (start > 0 && out[start - 1] === '-') start -= 1;
    out = `${out.slice(0, start)}${REDACTION_MARK}`;
    withheld += 1;
  }
  if (!out.endsWith(REDACTION_MARK)) {
    const tail = /\S+$/.exec(out);
    if (tail !== null) {
      out = `${out.slice(0, tail.index)}${REDACTION_MARK}`;
      withheld += 1;
    }
  }
  return { text: out, withheld };
}

function secureCapturedStream(
  raw: string,
  limitBytes: number,
  stoppedEarly: boolean,
): { text: string; truncated: boolean; redactions: number } {
  const bounded = boundOutput(raw, limitBytes);
  const suffix = bounded.truncated ? (TRUNCATION_SUFFIX.exec(bounded.text)?.[0] ?? '') : '';
  let core = suffix === '' ? bounded.text : bounded.text.slice(0, bounded.text.length - suffix.length);
  let withheld = 0;
  if (bounded.truncated || stoppedEarly) ({ text: core, withheld } = withholdOpenSecret(core));
  const clean = sanitizeOutput(core);
  return { text: `${clean.text}${suffix}`, truncated: bounded.truncated, redactions: clean.redactions + withheld };
}

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
      // A stream the cap cut, or one that was stopped (cap hit, timeout, cancel, kill), may end inside a secret.
      const stoppedEarly = killRequested || signal !== null;
      const cleanOut = secureCapturedStream(stdout, request.outputLimitBytes, stoppedEarly);
      const cleanErr = secureCapturedStream(stderr, request.outputLimitBytes, stoppedEarly);
      resolvePromise({
        exitCode,
        signal,
        stdout: cleanOut.text,
        stderr: cleanErr.text,
        timedOut,
        cancelled,
        truncated: cleanOut.truncated || cleanErr.truncated || outputLimitHit,
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
