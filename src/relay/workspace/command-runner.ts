import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
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

/**
 * A stream that STOPPED EARLY (the cap cut it, a chunk was dropped, a timeout, a cancel or a kill) can end inside a secret. The sanitizer's patterns
 * need a secret's WHOLE shape, so the surviving head of a cut secret is stored in clear. This withholds what such a stream cannot prove complete:
 *  1. an UNTERMINATED private key block (a BEGIN header with no END after it): from the header to the end;
 *  2. the TRAILING PARTIAL TOKEN: the last run of non-whitespace characters, when the text ends without whitespace.
 * Step 1 is applied to EVERY stream; step 2 applies when the stored text is cut or the stream stopped early (a stream that ended by itself, inside the bound, stores its last token verbatim). A stopped stream that already ends on the truncation line keeps an ordinary last token such as hello, and still withholds a secret-shaped token sitting against that line. Sanitizer patterns are not changed.
 * ORDER MATTERS: step 1 runs BEFORE the sanitizer, step 2 AFTER it. A complete secret at the very end (a whole dashed footer, say) must reach the sanitizer intact; step 2 would otherwise
 * replace its last token and break the shape the sanitizer needs. After the sanitizer a complete secret is already a mark, and step 2 skips text that ends in one.
 */
function withholdOpenBlock(text: string): { text: string; withheld: number } {
  let out = text;
  let withheld = 0;
  // CLOSED means the sanitizer's own complete shape: the DASHED footer. A bare `END ... PRIVATE KEY` phrase, or a footer cut inside its dashes, is not a closed block: the sanitizer would redact only the
  // header phrase and leave the body in clear. The sanitizer's whole-block pattern is lazy: it pairs a header with the next complete footer, so EVERY header that has a complete footer after it is covered
  // (several headers before one footer are one match). What nothing will redact is everything from the EARLIEST header after the LAST complete footer (the first header when there is no footer).
  let afterLastFooter = 0;
  for (const footer of out.matchAll(/-----END [A-Z ]*PRIVATE KEY-----/g)) afterLastFooter = (footer.index ?? 0) + footer[0].length;
  const header = /BEGIN [A-Z ]*PRIVATE KEY/g;
  header.lastIndex = afterLastFooter;
  const open = header.exec(out);
  if (open !== null) {
    let start = open.index;
    while (start > afterLastFooter && out[start - 1] === '-') start -= 1;
    out = `${out.slice(0, start)}${REDACTION_MARK}`;
    withheld += 1;
  }
  return { text: out, withheld };
}

/** Step 2: the TRAILING PARTIAL TOKEN of the (already sanitized) text, when it ends without whitespace and not in a mark. */
function withholdTrailingToken(text: string): { text: string; withheld: number } {
  if (text.endsWith(REDACTION_MARK)) return { text, withheld: 0 };
  const tail = /\S+$/.exec(text);
  if (tail === null) return { text, withheld: 0 };
  return { text: `${text.slice(0, tail.index)}${REDACTION_MARK}`, withheld: 1 };
}

const TRUNCATION_SUFFIX = '\n[TRUNCATED: output limit reached]';

/** A trailing token that is secret-shaped even when it is shorter than a sanitizer match. */
function trailingTokenLooksSecret(token: string): boolean {
  return /(?:api[-_]?key|secret|password|token)\s*[:=]/i.test(token)
    || /sk-[A-Za-z0-9]/.test(token)
    || /AKIA[0-9A-Z]/.test(token)
    || /gh[pousr]_/.test(token)
    || /xox[baprs]-/.test(token)
    || /eyJ[A-Za-z0-9_-]/.test(token)
    || /BEGIN [A-Z ]*PRIVATE KEY/.test(token);
}

export function secureCapturedStream(
  raw: string,
  limitBytes: number,
  stoppedEarly: boolean,
): { text: string; truncated: boolean; redactions: number } {
  // Redact the captured text, then bound it. Bounding first cuts a secret into a shape no pattern matches and
  // stores the head in the clear; redacting a short secret also lengthens it, so the byte bound has to be last.
  // Step 1 applies to EVERY stream: a private key header with no complete dashed footer after it at the end of the output is a partial key whether or not the runner cut the stream (`head -c 500 key.pem`, a crash).
  // Step 2 withholds the trailing token whenever that bound cuts the text, or the stream stopped early. A clean
  // exit that fits the bound keeps its last token. Withholding can lengthen a short token into the mark, so a
  // result that no longer fits is bounded again.
  let withheld = 0;
  let core = raw;
  ({ text: core, withheld } = withholdOpenBlock(core));
  const clean = sanitizeOutput(core);
  let bounded = boundOutput(clean.text, limitBytes);
  if (bounded.truncated || stoppedEarly) {
    const hadSuffix = bounded.text.endsWith(TRUNCATION_SUFFIX);
    const body = hadSuffix ? bounded.text.slice(0, -TRUNCATION_SUFFIX.length) : bounded.text;
    // The truncation line already in a stopped stream consumed the newline, so an ordinary last
    // word is a finished token. A secret-shaped token against that line is still withheld. A cut
    // this bound just made, or a stop that did not end on the truncation line, withholds whatever
    // the last token is.
    const suffixWasAlreadyThere = hadSuffix && !bounded.truncated;
    const tailToken = /\S+$/.exec(body);
    const withhold = tailToken !== null && (!suffixWasAlreadyThere || trailingTokenLooksSecret(tailToken[0]));
    let next = body;
    if (withhold) {
      const tail = withholdTrailingToken(body);
      next = tail.text;
      withheld += tail.withheld;
    }
    if (Buffer.byteLength(next, 'utf8') > limitBytes) {
      bounded = boundOutput(next, limitBytes);
    } else {
      bounded = { text: hadSuffix ? `${next}${TRUNCATION_SUFFIX}` : next, truncated: bounded.truncated };
    }
  }
  return { text: bounded.text, truncated: bounded.truncated, redactions: clean.redactions + withheld };
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
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    const finish = (exitCode: number | null, signal: string | null, termination: BoundedRunOutcome['termination'], spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(escalateTimer);
      clearTimeout(confirmTimer);
      // Flush a character whose bytes were split across reads. A chunk decoded on its own would replace it.
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
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
      if (settled) return;
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= request.outputLimitBytes * 2) stdout += stdoutDecoder.write(chunk);
      if (stdoutBytes > request.outputLimitBytes && !killRequested) {
        outputLimitHit = true;
        requestKill();
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= request.outputLimitBytes * 2) stderr += stderrDecoder.write(chunk);
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
