import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { E2_STREAM_LABEL_LIVE, type E2StreamEvidence } from './cursor-run-stream-evidence';
import { isRouterModelId } from './grok-bot-coding-provider';

/**
 * E2 PARTS B AND C, AND THE GATE.
 *
 * (B) Julius re-runs the verifier commands itself and records, per command, the argv, exit code, sha256 of stdout and
 *     stderr, and start/end times. Labelled `julius_observed` only when run by {@link spawnVerifierRunner} (no shell);
 *     any injected runner is labelled `fake`.
 * (C) `git diff --no-ext-diff --no-textconv --binary base..head` on validated 40-hex SHAs, hashed, same labelling.
 * (A) is captureCursorRunStream (Cursor's own report, not independent of Cursor).
 *
 * {@link e2Gate} admits E2 evidence only when ALL three are present and real: the stream is live-labelled, complete and
 * cause-free with at least one tool call; every re-run command was Julius-observed with exit code 0; the diff was
 * Julius-observed; and the model is pinned (no Auto/Router). It never falls back to the diff alone. Undocumented values
 * (per-event timestamps, Cursor-side exit codes) stay `not_provided` in part A and are never inferred here.
 */

export const E2_JULIUS_LABEL = 'julius_observed';
export const E2_FAKE_LABEL = 'fake';

export interface VerifierRunResult { readonly exitCode: number | null; readonly stdout: Uint8Array | string; readonly stderr: Uint8Array | string }
export type VerifierRunner = (argv: readonly string[], cwd: string) => Promise<VerifierRunResult>;

const TRUSTED_RUNNERS = new WeakSet<VerifierRunner>();
const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/** The only runner whose records are `julius_observed`: spawn without a shell, bounded by a timeout (exit unknown on kill). */
export function spawnVerifierRunner(options: { readonly timeoutMs?: number; readonly env?: NodeJS.ProcessEnv } = {}): VerifierRunner {
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
  const runner: VerifierRunner = (argv, cwd) => new Promise((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let child;
    try {
      child = spawn(argv[0] as string, argv.slice(1), { cwd, shell: false, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { resolve({ exitCode: null, stdout: '', stderr: '' }); return; }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    let failed = false;
    child.on('error', () => { failed = true; });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      resolve({ exitCode: !failed && sig === null && typeof code === 'number' && code >= 0 ? code : null, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    });
  });
  TRUSTED_RUNNERS.add(runner);
  return runner;
}

export interface E2CommandRecord {
  readonly argv: readonly string[];
  readonly exitCode: number | 'unknown';
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly startedAt: string;
  readonly endedAt: string;
}
export interface E2ReexecEvidence { readonly label: typeof E2_JULIUS_LABEL | typeof E2_FAKE_LABEL; readonly cwd: string; readonly commands: readonly E2CommandRecord[] }
export interface E2DiffEvidence {
  readonly label: typeof E2_JULIUS_LABEL | typeof E2_FAKE_LABEL;
  readonly base: string;
  readonly head: string;
  readonly argv: readonly string[];
  readonly exitCode: number | 'unknown';
  readonly sha256: string;
  readonly bytes: number;
}

const validArgv = (a: unknown): a is readonly string[] =>
  Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'string' && !x.includes('\u0000')) && (a[0] as string) !== '';

/** (B) Re-runs each verifier command in order. Invalid argv lists are refused (null) before anything runs. */
export async function recordVerifierReexec(input: {
  readonly commands: readonly (readonly string[])[];
  readonly cwd: string;
  readonly runner: VerifierRunner;
  readonly now?: () => number;
}): Promise<E2ReexecEvidence | null> {
  const now = input.now ?? Date.now;
  if (!Array.isArray(input.commands) || input.commands.length === 0 || !input.commands.every(validArgv)) return null;
  const commands: E2CommandRecord[] = [];
  for (const argv of input.commands) {
    const startedAt = new Date(now()).toISOString();
    let r: VerifierRunResult;
    try { r = await input.runner([...argv], input.cwd); } catch { r = { exitCode: null, stdout: '', stderr: '' }; }
    commands.push(Object.freeze({
      argv: Object.freeze([...argv]),
      exitCode: typeof r.exitCode === 'number' && Number.isInteger(r.exitCode) ? r.exitCode : 'unknown' as const,
      stdoutSha256: sha256(r.stdout), stderrSha256: sha256(r.stderr), startedAt, endedAt: new Date(now()).toISOString(),
    }));
  }
  return Object.freeze({ label: TRUSTED_RUNNERS.has(input.runner) ? E2_JULIUS_LABEL : E2_FAKE_LABEL, cwd: input.cwd, commands: Object.freeze(commands) });
}

const SHA = /^[0-9a-f]{40}$/u;
/** (C) The diff between two full commit SHAs, no external diff drivers or textconv. Bad SHAs are refused (null). */
export async function recordGitDiff(input: { readonly base: string; readonly head: string; readonly cwd: string; readonly runner: VerifierRunner }): Promise<E2DiffEvidence | null> {
  if (!SHA.test(input.base) || !SHA.test(input.head)) return null;
  const argv = Object.freeze(['git', 'diff', '--no-ext-diff', '--no-textconv', '--binary', `${input.base}..${input.head}`]);
  let r: VerifierRunResult;
  try { r = await input.runner([...argv], input.cwd); } catch { r = { exitCode: null, stdout: '', stderr: '' }; }
  const bytes = typeof r.stdout === 'string' ? Buffer.byteLength(r.stdout) : r.stdout.byteLength;
  return Object.freeze({
    label: TRUSTED_RUNNERS.has(input.runner) ? E2_JULIUS_LABEL : E2_FAKE_LABEL, base: input.base, head: input.head, argv,
    exitCode: typeof r.exitCode === 'number' && Number.isInteger(r.exitCode) ? r.exitCode : 'unknown' as const, sha256: sha256(r.stdout), bytes,
  });
}

export const E2_GATE_REASONS = Object.freeze([
  'e2_stream_absent', 'e2_stream_not_live', 'e2_stream_failed', 'e2_stream_no_terminal', 'e2_no_tool_calls',
  'e2_reexec_absent', 'e2_reexec_fake', 'e2_reexec_failed', 'e2_reexec_exit_unknown',
  'e2_diff_absent', 'e2_diff_fake', 'e2_diff_failed', 'e2_model_absent', 'e2_model_router',
] as const);
export type E2GateReason = (typeof E2_GATE_REASONS)[number];

/** All three parts, all real, or refused with every reason. Never the diff alone. */
export function e2Gate(input: {
  readonly stream: E2StreamEvidence | null | undefined;
  readonly reexec: E2ReexecEvidence | null | undefined;
  readonly diff: E2DiffEvidence | null | undefined;
  readonly modelId: string | null | undefined;
}): { readonly ok: true } | { readonly ok: false; readonly reasons: readonly E2GateReason[] } {
  const reasons: E2GateReason[] = [];
  const { stream, reexec, diff, modelId } = input;
  if (stream === null || stream === undefined) reasons.push('e2_stream_absent');
  else {
    if (stream.label !== E2_STREAM_LABEL_LIVE || stream.mode !== 'live') reasons.push('e2_stream_not_live');
    if (stream.cause !== null) reasons.push('e2_stream_failed');
    if (stream.terminal === null) reasons.push('e2_stream_no_terminal');
    if (stream.toolCalls.length === 0) reasons.push('e2_no_tool_calls');
  }
  if (reexec === null || reexec === undefined || reexec.commands.length === 0) reasons.push('e2_reexec_absent');
  else {
    if (reexec.label !== E2_JULIUS_LABEL) reasons.push('e2_reexec_fake');
    if (reexec.commands.some((c) => c.exitCode === 'unknown')) reasons.push('e2_reexec_exit_unknown');
    if (reexec.commands.some((c) => c.exitCode !== 0 && c.exitCode !== 'unknown')) reasons.push('e2_reexec_failed');
  }
  if (diff === null || diff === undefined) reasons.push('e2_diff_absent');
  else {
    if (diff.label !== E2_JULIUS_LABEL) reasons.push('e2_diff_fake');
    if (diff.exitCode !== 0) reasons.push('e2_diff_failed');
  }
  if (typeof modelId !== 'string' || modelId.trim() === '') reasons.push('e2_model_absent');
  else if (isRouterModelId(modelId)) reasons.push('e2_model_router');
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons: Object.freeze(reasons) };
}
