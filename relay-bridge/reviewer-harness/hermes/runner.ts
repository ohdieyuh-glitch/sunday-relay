/**
 * THE HERMES REVIEWER PROCESS RUNNER.
 *
 * One bounded, read-only, one-shot execution. Every property that keeps it
 * safe is structural rather than instructed:
 *
 *   read-only     the isolated profile grants NO toolset, so the model holds
 *                 no file, terminal, code-execution, web or delegation tool;
 *   no injection  argv only, `shell: false`, prompt passed as one argument;
 *   no leakage    the credential travels in the child ENVIRONMENT, never argv,
 *                 and stdout/stderr are redacted and byte-capped;
 *   bounded       wall-clock timeout, output cap, single turn, and on timeout
 *                 the whole process GROUP is terminated, not just the child.
 *
 * It reports what happened, and never more: a timeout is not a completion, a
 * cancellation is not a failure, and unparseable output can never approve.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { safeText } from '../../redact';
import { createIsolatedProfile, isolatedChildEnv, type IsolatedProfile } from './isolated-profile';
import type { HermesProviderId } from './hermes-provider';

export interface HermesRunLimits {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly maxTurns: number;
  readonly maxPromptBytes: number;
}

export const DEFAULT_RUN_LIMITS: HermesRunLimits = Object.freeze({
  timeoutMs: 180_000,
  maxOutputBytes: 512 * 1024,
  maxTurns: 1,
  maxPromptBytes: 256 * 1024,
});

/** Usage as Hermes reports it in `--usage-file`. Unknown stays null. */
export interface HermesUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly model: string | null;
  readonly apiCalls: number | null;
  readonly costMicros: string | null;
  readonly currency: string | null;
  readonly source: 'harness_reported' | 'unavailable';
}

export const UNKNOWN_USAGE: HermesUsage = Object.freeze({
  inputTokens: null, outputTokens: null, totalTokens: null, model: null,
  apiCalls: null, costMicros: null, currency: null, source: 'unavailable',
});

export type HermesRunOutcome =
  | {
    readonly kind: 'completed';
    readonly stdout: string;
    readonly usage: HermesUsage;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly exitCode: number | null;
  }
  | { readonly kind: 'launch_failed'; readonly safeMessage: string }
  | {
    readonly kind: 'timed_out';
    readonly safeMessage: string;
    readonly startedAt: string; readonly completedAt: string;
    readonly usage: HermesUsage;
  }
  | {
    readonly kind: 'cancelled';
    readonly safeMessage: string;
    readonly startedAt: string; readonly completedAt: string;
    readonly usage: HermesUsage;
  }
  | {
    readonly kind: 'failed';
    readonly safeMessage: string;
    readonly startedAt: string; readonly completedAt: string;
    readonly exitCode: number | null;
    readonly usage: HermesUsage;
  };

/** Parses Hermes' usage report. Absent or malformed → Unknown, never zero. */
export function parseUsageFile(path: string): HermesUsage {
  if (!existsSync(path)) return UNKNOWN_USAGE;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return UNKNOWN_USAGE;
  }
  if (raw === null || typeof raw !== 'object') return UNKNOWN_USAGE;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const input = num(o.input_tokens ?? o.prompt_tokens);
  const output = num(o.output_tokens ?? o.completion_tokens);
  const total = num(o.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  const cost = o.estimated_cost ?? o.cost;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    model: typeof o.model === 'string' && o.model.trim() !== '' ? safeText(o.model) : null,
    apiCalls: num(o.api_calls),
    // Reported cost is carried as a STRING with its provenance, never turned
    // into a computed figure Relay would then have to defend.
    costMicros: typeof cost === 'number' && Number.isFinite(cost)
      ? String(Math.round(cost * 1_000_000)) : null,
    currency: typeof cost === 'number' ? 'USD' : null,
    source: input === null && output === null && typeof o.model !== 'string'
      ? 'unavailable' : 'harness_reported',
  };
}

/**
 * The argv for one review. The prompt is a single argument — never
 * interpolated into a string — and the credential is absent by construction.
 */
export function buildHermesArgs(input: {
  prompt: string;
  model: string;
  provider: HermesProviderId;
  usageFilePath: string;
}): string[] {
  return [
    '-z', input.prompt,
    '--usage-file', input.usageFilePath,
    '-m', input.model,
    '--provider', input.provider,
    // No AGENTS.md, SOUL.md, .cursorrules, memory or preloaded skills. The
    // isolated profile already contains none of these; this is the second lock.
    '--ignore-rules',
  ];
}

export interface HermesRunInput {
  readonly executable: string;
  readonly prompt: string;
  readonly model: string;
  readonly provider: HermesProviderId;
  readonly apiKey: string | null;
  readonly baseUrl: string | null;
  readonly limits?: HermesRunLimits;
  readonly profile?: IsolatedProfile;
  readonly signal?: AbortSignal;
  readonly now?: () => string;
  readonly spawnImpl?: typeof spawn;
}

/** SIGTERM the whole group, then SIGKILL what survives. No orphans. */
function terminateTree(child: ChildProcess, afterMs = 5_000): void {
  const pid = child.pid;
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (pid !== undefined) process.kill(-pid, signal);
      else child.kill(signal);
    } catch {
      try { child.kill(signal); } catch { /* already gone */ }
    }
  };
  kill('SIGTERM');
  const hard = setTimeout(() => kill('SIGKILL'), afterMs);
  hard.unref?.();
  child.once('close', () => clearTimeout(hard));
}

export async function runHermesReviewer(input: HermesRunInput): Promise<HermesRunOutcome> {
  const now = input.now ?? (() => new Date().toISOString());
  const limits = input.limits ?? DEFAULT_RUN_LIMITS;
  const doSpawn = input.spawnImpl ?? spawn;

  if (Buffer.byteLength(input.prompt, 'utf8') > limits.maxPromptBytes) {
    return {
      kind: 'launch_failed',
      safeMessage:
        'The review evidence exceeds the configured input limit. Relay blocks rather than '
        + 'silently truncating material the verdict depends on.',
    };
  }

  const ownedProfile = input.profile === undefined;
  const profile = input.profile ?? createIsolatedProfile();
  const args = buildHermesArgs({
    prompt: input.prompt,
    model: input.model,
    provider: input.provider,
    usageFilePath: profile.usageFilePath,
  });
  // The provider decides which variables carry the credential and base URL.
  // This call site used to name the xAI variables unconditionally, which sent
  // an Anthropic secret to the child as XAI_API_KEY and left the run with no
  // credential its provider would read.
  const env = isolatedChildEnv({
    profile,
    provider: input.provider,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
  });

  const startedAt = now();
  return await new Promise<HermesRunOutcome>((resolve) => {
    let settled = false;
    let child: ChildProcess;
    const finish = (o: HermesRunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      if (ownedProfile) profile.dispose();
      resolve(o);
    };

    try {
      child = doSpawn(input.executable, args, {
        cwd: profile.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        // Its own process group, so a timeout can end the whole tree.
        detached: true,
      });
    } catch {
      if (ownedProfile) profile.dispose();
      resolve({ kind: 'launch_failed', safeMessage: 'The Hermes Reviewer could not be started.' });
      return;
    }

    let out = '';
    let bytes = 0;
    let truncated = false;

    const timer = setTimeout(() => {
      terminateTree(child);
      finish({
        kind: 'timed_out',
        safeMessage: `The Hermes Reviewer exceeded its ${limits.timeoutMs} ms limit and was stopped.`,
        startedAt, completedAt: now(), usage: parseUsageFile(profile.usageFilePath),
      });
    }, limits.timeoutMs);

    const onAbort = () => {
      terminateTree(child);
      finish({
        kind: 'cancelled',
        safeMessage: 'The Hermes Reviewer run was cancelled. Evidence already received is preserved.',
        startedAt, completedAt: now(), usage: parseUsageFile(profile.usageFilePath),
      });
    };
    if (input.signal?.aborted === true) { onAbort(); return; }
    input.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (c: Buffer) => {
      bytes += c.length;
      if (bytes <= limits.maxOutputBytes) out += c.toString('utf8');
      else truncated = true;
    });
    // stderr is consumed so the pipe cannot fill and deadlock the child, but is
    // never surfaced verbatim: a provider error can quote the request.
    child.stderr?.on('data', () => { /* intentionally dropped */ });

    child.on('error', () =>
      finish({ kind: 'launch_failed', safeMessage: 'The Hermes Reviewer could not be started.' }));

    child.on('close', (code, signal) => {
      const completedAt = now();
      const usage = parseUsageFile(profile.usageFilePath);
      if (signal !== null) {
        finish({
          kind: 'cancelled',
          safeMessage: 'The Hermes Reviewer was terminated before it returned a result.',
          startedAt, completedAt, usage,
        });
        return;
      }
      if (code !== 0) {
        finish({
          kind: 'failed',
          safeMessage: `The Hermes Reviewer exited without a result (code ${code ?? 'unknown'}).`,
          startedAt, completedAt, exitCode: code, usage,
        });
        return;
      }
      finish({
        kind: 'completed',
        // Redacted before it can reach a log, a record or a user.
        stdout: truncated ? `${safeText(out)}\n[output truncated at limit]` : safeText(out),
        usage, startedAt, completedAt, exitCode: code,
      });
    });
  });
}
