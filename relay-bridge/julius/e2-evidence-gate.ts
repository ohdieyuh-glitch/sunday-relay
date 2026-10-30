import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';

import { E2_STREAM_LABEL_LIVE, verifyEvidenceChain } from './cursor-run-stream-evidence';
import { familyFromModelId, isRouterModelId } from './grok-bot-coding-provider';

/**
 * E2 PARTS B AND C, AND THE GATE.
 *
 * (A) captureCursorRunStream writes a hash-chained JSONL file (Cursor's own report, not independent of Cursor).
 * (B) Julius re-runs the verifier commands itself: argv, exit code, streamed sha256 and byte counts of stdout/stderr, times.
 * (C) a config-pinned `git diff` of base..head on validated 40-hex SHAs, hashed, plus `merge-base --is-ancestor`.
 *
 * {@link e2Gate} (PILOT H-3/H-4) grades from the FILE, not from an in-memory object: it re-verifies the chain from the
 * lines, requires the recomputed final hash to be non-empty and equal to an ANCHOR the caller supplies from outside the
 * capture (a workflow or ledger record of the final hash), reads every fact it grades from the chained final record, and
 * binds runId, base, head and the workspace across the stream, the re-exec and the diff. Re-exec and diff objects count
 * only if this module's own functions made them with the spawn runner (a module-private WeakSet, no exported setter).
 *
 * HONEST LIMITS. This is tamper-evident against hand-made objects, copied objects and rewritten evidence files (a rewrite
 * with every hash recomputed no longer matches the anchor). It is NOT protection against a malicious Julius process: the
 * anchor is only as trustworthy as whoever writes it, and if the process that captures also writes the anchor it can
 * rewrite both. Cursor's report stays Cursor's report. The pre-import fetch/dispatcher residual (M-5) is unchanged.
 */

export const E2_JULIUS_LABEL = 'julius_observed';
export const E2_FAKE_LABEL = 'fake';

/** What an injected runner may return: raw output (hashed here) or streamed hashes and byte counts. */
export type VerifierRunResult =
  | { readonly exitCode: number | null; readonly stdout: Uint8Array | string; readonly stderr: Uint8Array | string }
  | { readonly exitCode: number | null; readonly stdoutSha256: string; readonly stderrSha256: string; readonly stdoutBytes: number; readonly stderrBytes: number };
export type VerifierRunner = (argv: readonly string[], cwd: string, extraEnv?: Readonly<Record<string, string>>) => Promise<VerifierRunResult>;

const TRUSTED_RUNNERS = new WeakSet<VerifierRunner>();
const RECORDED = new WeakSet<object>();
const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const EMPTY_SHA = sha256('');

/** M-7: program names that are a shell or a launcher of arbitrary commands; never run, never julius_observed. */
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'mksh', 'fish', 'csh', 'tcsh', 'ash', 'busybox', 'env', 'cmd', 'cmd.exe', 'powershell', 'pwsh', 'nohup', 'xargs', 'sudo', 'su', 'doas']);
export const isShellProgram = (program: string): boolean => SHELLS.has(basename(program).toLowerCase());

/** M-7: the cwd must be absolute, exist, be a directory, and already be its own realpath (no symlink, no `..`). */
export function isCanonicalDir(cwd: string): boolean {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return false;
  try { return statSync(cwd).isDirectory() && realpathSync(cwd) === cwd; } catch { return false; }
}

/**
 * The only runner whose records are `julius_observed`. No shell; shell argv0 refused; cwd checked; the environment is an
 * allowlist (PATH, C.UTF-8 locale, then `env`, then the per-call extras), never inherited; the child leads its own process
 * group and a timeout or an output overrun kills the whole group (exit unknown); output is hashed while it streams.
 */
export function spawnVerifierRunner(options: { readonly timeoutMs?: number; readonly env?: Readonly<Record<string, string>>; readonly maxOutputBytes?: number } = {}): VerifierRunner {
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024 * 1024;
  const refused = { exitCode: null, stdoutSha256: EMPTY_SHA, stderrSha256: EMPTY_SHA, stdoutBytes: 0, stderrBytes: 0 } as const;
  const runner: VerifierRunner = (argv, cwd, extraEnv) => new Promise((resolve) => {
    if (!validArgv(argv) || isShellProgram(argv[0] as string) || !isCanonicalDir(cwd)) { resolve(refused); return; }
    const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', ...options.env, ...extraEnv };
    let child;
    try {
      child = spawn(argv[0] as string, argv.slice(1), { cwd, shell: false, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { resolve(refused); return; }
    const out = createHash('sha256');
    const err = createHash('sha256');
    let outBytes = 0;
    let errBytes = 0;
    let killed = false;
    let failed = false;
    const killGroup = (): void => {
      try { if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    };
    const timer = setTimeout(() => { killed = true; killGroup(); }, timeoutMs);
    const over = (): void => { if (outBytes + errBytes > maxOutputBytes && !killed) { killed = true; killGroup(); } };
    child.stdout.on('data', (d: Buffer) => { outBytes += d.byteLength; out.update(d); over(); });
    child.stderr.on('data', (d: Buffer) => { errBytes += d.byteLength; err.update(d); over(); });
    child.on('error', () => { failed = true; });
    let code: number | null = null;
    let sig: NodeJS.Signals | null = null;
    // A leader that exits leaves no reason for its group to keep the pipes open: stragglers are killed.
    child.on('exit', (c, s) => { code = c; sig = s; killGroup(); });
    child.on('close', (c, s) => {
      clearTimeout(timer);
      const fc = code ?? c;
      const fs = sig ?? s;
      resolve({
        exitCode: !failed && !killed && fs === null && typeof fc === 'number' && fc >= 0 ? fc : null,
        stdoutSha256: out.digest('hex'), stderrSha256: err.digest('hex'), stdoutBytes: outBytes, stderrBytes: errBytes,
      });
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
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly startedAt: string;
  readonly endedAt: string;
}
export interface E2ReexecEvidence { readonly label: typeof E2_JULIUS_LABEL | typeof E2_FAKE_LABEL; readonly cwd: string; readonly commands: readonly E2CommandRecord[] }
export interface E2DiffEvidence {
  readonly label: typeof E2_JULIUS_LABEL | typeof E2_FAKE_LABEL;
  readonly base: string;
  readonly head: string;
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly exitCode: number | 'unknown';
  readonly sha256: string;
  readonly bytes: number;
  /** `git merge-base --is-ancestor base head` exited 0. */
  readonly ancestry: boolean;
}

const validArgv = (a: unknown): a is readonly string[] =>
  Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'string' && !x.includes('\u0000')) && (a[0] as string) !== '';

const normalize = (r: VerifierRunResult): { exitCode: number | 'unknown'; stdoutSha256: string; stderrSha256: string; stdoutBytes: number; stderrBytes: number } => {
  const exitCode = typeof r.exitCode === 'number' && Number.isInteger(r.exitCode) ? r.exitCode : 'unknown' as const;
  if ('stdoutSha256' in r) return { exitCode, stdoutSha256: r.stdoutSha256, stderrSha256: r.stderrSha256, stdoutBytes: r.stdoutBytes, stderrBytes: r.stderrBytes };
  const len = (b: Uint8Array | string): number => (typeof b === 'string' ? Buffer.byteLength(b) : b.byteLength);
  return { exitCode, stdoutSha256: sha256(r.stdout), stderrSha256: sha256(r.stderr), stdoutBytes: len(r.stdout), stderrBytes: len(r.stderr) };
};
const run = async (runner: VerifierRunner, argv: readonly string[], cwd: string, env?: Readonly<Record<string, string>>): Promise<ReturnType<typeof normalize>> => {
  try { return normalize(await runner([...argv], cwd, env)); } catch { return normalize({ exitCode: null, stdout: '', stderr: '' }); }
};

/** (B) Re-runs each verifier command in order. Invalid argv, a shell program or a relative cwd is refused (null) before anything runs. */
export async function recordVerifierReexec(input: {
  readonly commands: readonly (readonly string[])[];
  readonly cwd: string;
  readonly runner: VerifierRunner;
  readonly now?: () => number;
}): Promise<E2ReexecEvidence | null> {
  const now = input.now ?? Date.now;
  if (!Array.isArray(input.commands) || input.commands.length === 0 || !input.commands.every(validArgv)) return null;
  if (input.commands.some((a) => isShellProgram(a[0] as string))) return null;
  if (typeof input.cwd !== 'string' || !isAbsolute(input.cwd)) return null;
  const commands: E2CommandRecord[] = [];
  for (const argv of input.commands) {
    const startedAt = new Date(now()).toISOString();
    const r = await run(input.runner, argv, input.cwd);
    commands.push(Object.freeze({ argv: Object.freeze([...argv]), ...r, startedAt, endedAt: new Date(now()).toISOString() }));
  }
  const ev: E2ReexecEvidence = Object.freeze({ label: TRUSTED_RUNNERS.has(input.runner) ? E2_JULIUS_LABEL : E2_FAKE_LABEL, cwd: input.cwd, commands: Object.freeze(commands) });
  RECORDED.add(ev);
  return ev;
}

const SHA = /^[0-9a-f]{40}$/u;
/** M-8: git configuration that would change the diff bytes is pinned; global and system config are not read. */
export const E2_GIT_ENV = Object.freeze({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
const GIT_PINS = Object.freeze([
  '-c', 'diff.noprefix=false', '-c', 'diff.renames=false', '-c', 'core.quotepath=false', '-c', 'diff.mnemonicPrefix=false',
  '-c', 'color.ui=never', '-c', 'diff.relative=false', '-c', 'diff.suppressBlankEmpty=false', '-c', 'core.autocrlf=false',
]);
/** (C) The config-pinned diff between two full commit SHAs, and whether head descends from base. Bad SHAs are refused (null). */
export async function recordGitDiff(input: { readonly base: string; readonly head: string; readonly cwd: string; readonly runner: VerifierRunner }): Promise<E2DiffEvidence | null> {
  if (!SHA.test(input.base) || !SHA.test(input.head)) return null;
  if (typeof input.cwd !== 'string' || !isAbsolute(input.cwd)) return null;
  const argv = Object.freeze(['git', ...GIT_PINS, 'diff', '--no-ext-diff', '--no-textconv', '--binary', '--no-renames', '--no-color', '--full-index', `${input.base}..${input.head}`]);
  const r = await run(input.runner, argv, input.cwd, E2_GIT_ENV);
  const anc = await run(input.runner, ['git', 'merge-base', '--is-ancestor', input.base, input.head], input.cwd, E2_GIT_ENV);
  const ev: E2DiffEvidence = Object.freeze({
    label: TRUSTED_RUNNERS.has(input.runner) ? E2_JULIUS_LABEL : E2_FAKE_LABEL, base: input.base, head: input.head, cwd: input.cwd, argv,
    exitCode: r.exitCode, sha256: r.stdoutSha256, bytes: r.stdoutBytes, ancestry: anc.exitCode === 0,
  });
  RECORDED.add(ev);
  return ev;
}

export const E2_GATE_REASONS = Object.freeze([
  'e2_stream_absent', 'e2_stream_chain_invalid', 'e2_anchor_absent', 'e2_anchor_mismatch',
  'e2_stream_not_live', 'e2_stream_failed', 'e2_stream_no_terminal', 'e2_stream_terminal_not_finished', 'e2_stream_call_unfinished', 'e2_no_tool_calls',
  'e2_reexec_absent', 'e2_reexec_forged', 'e2_reexec_fake', 'e2_reexec_failed', 'e2_reexec_exit_unknown',
  'e2_diff_absent', 'e2_diff_forged', 'e2_diff_fake', 'e2_diff_failed',
  'e2_binding_absent', 'e2_binding_run_mismatch', 'e2_binding_diff_mismatch', 'e2_diff_not_descendant', 'e2_binding_cwd_mismatch',
  'e2_model_absent', 'e2_model_router', 'e2_model_claude', 'e2_model_unrecognised',
  'e2_final_record_mismatch', 'e2_no_edit_calls', 'e2_diff_empty', 'e2_stream_mid_run_start', 'e2_model_unbound',
] as const);
export type E2GateReason = (typeof E2_GATE_REASONS)[number];

/** What the gate needs to bind the three parts: the run, the commits and the workspace, all from the caller's own record. */
export interface E2Binding { readonly runId: string; readonly base: string; readonly head: string; readonly workspace: string }
/**
 * The final hash recorded OUTSIDE the capture (workflow output, ledger). The gate never takes it from the file.
 * PILOT 43b93a4e N-1: the anchor MUST come from a separate trust domain (a record the writer of the evidence file cannot
 * also rewrite). An anchor derived from the file itself, or kept next to it by the same writer, is NOT independent: whoever
 * can re-chain the file can recompute it. The gate cannot tell where an anchor came from; that is the caller's obligation.
 * The gate does recount every fact it grades from the events, so a re-chained file whose final record disagrees with its
 * own events is refused even with a matching anchor; a re-chained file whose events were also rewritten is not detectable.
 */
export interface E2Anchor { readonly finalHash: string }

/**
 * Skywalker N1 (0774db05): model ids are compared after NFKC, trimming and the provider's lookalike folding, so `AUTO `,
 * `Аuto` (Cyrillic A) or full-width forms are routers. Only an id the reviewed table places in a family other than
 * Anthropic passes; an id it cannot place is refused (no facts are invented about it).
 */
const CONFUSABLES: Readonly<Record<string, string>> = Object.freeze({
  '\u0410': 'A', '\u0430': 'a', '\u0412': 'B', '\u0415': 'E', '\u0435': 'e', '\u041a': 'K', '\u043a': 'k', '\u041c': 'M', '\u041d': 'H',
  '\u041e': 'O', '\u043e': 'o', '\u0420': 'P', '\u0440': 'p', '\u0421': 'C', '\u0441': 'c', '\u0422': 'T', '\u0423': 'Y', '\u0443': 'y',
  '\u0425': 'X', '\u0445': 'x', '\u0456': 'i', '\u0406': 'I', '\u0458': 'j', '\u0455': 's', '\u0405': 'S', '\u0501': 'd',
  '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0397': 'H', '\u0399': 'I', '\u039a': 'K', '\u039c': 'M', '\u039d': 'N', '\u039f': 'O',
  '\u03bf': 'o', '\u03a1': 'P', '\u03a4': 'T', '\u03a5': 'Y', '\u03a7': 'X', '\u03bd': 'v', '\u03c5': 'u', '\u0131': 'i',
});
const foldConfusables = (s: string): string => [...s].map((c) => CONFUSABLES[c] ?? c).join('');

/**
 * PILOT 43b93a4e N-6 / Skywalker L3: the CLOSED list of coder model ids the gate accepts, exact match only (no folding,
 * no prefix, no family inference). Anything else is e2_model_unrecognised after the router/Claude diagnostics.
 */
export const E2_CODER_MODEL_IDS: ReadonlySet<string> = Object.freeze(new Set(['composer-1', 'composer-2', 'grok-code-fast-1']));
/** Tool names that change files. Read-type calls alone are not work (Skywalker N3). */
const EDIT_TOOL = /(edit|write|apply|create|delete|patch|replace|insert|rename|move)/iu;
export const isEditToolName = (name: unknown): boolean => typeof name === 'string' && EDIT_TOOL.test(name);

interface Recount { readonly ok: boolean; readonly toolCallCount: number; readonly unfinished: number; readonly editCalls: number; readonly terminalStatus: string | null; readonly done: boolean }
/** PILOT 43b93a4e N-1: everything the gate grades, recounted from the event records. An unparsable event fails closed. */
function recount(lines: readonly string[]): Recount {
  const calls = new Map<string, { name: unknown; status: unknown }>();
  let terminalStatus: string | null = null; let done = false; let ok = true;
  for (const line of lines.slice(1, -1)) {
    const r = JSON.parse(line) as Record<string, unknown>;
    if (r.kind !== 'event' || r.duplicate === true) continue;
    const parse = (): Record<string, unknown> | null => {
      try { const v = JSON.parse(String(r.data)) as unknown; return typeof v === 'object' && v !== null ? v as Record<string, unknown> : null; } catch { return null; }
    };
    if (r.event === 'tool_call') {
      const v = parse();
      if (v === null || typeof v.callId !== 'string') { ok = false; continue; }
      calls.set(v.callId, { name: v.name ?? calls.get(v.callId)?.name, status: v.status });
    } else if (r.event === 'result') {
      const v = parse();
      if (v === null || typeof v.status !== 'string') { ok = false; continue; }
      terminalStatus = v.status;
    } else if (r.event === 'done') done = true;
  }
  const all = [...calls.values()];
  return { ok, toolCallCount: all.length, unfinished: all.filter((c) => c.status !== 'completed').length, editCalls: all.filter((c) => isEditToolName(c.name)).length, terminalStatus, done };
}

function modelReason(modelId: unknown): E2GateReason | null {
  if (typeof modelId !== 'string') return 'e2_model_absent';
  const m = foldConfusables(modelId.normalize('NFKC').replace(/[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/gu, '')).trim();
  if (m === '') return 'e2_model_absent';
  if (isRouterModelId(m) || isRouterModelId(modelId)) return 'e2_model_router';
  const family = familyFromModelId(m);
  if (family === 'anthropic') return 'e2_model_claude';
  if (family === null) return 'e2_model_unrecognised';
  if (typeof modelId !== 'string' || !E2_CODER_MODEL_IDS.has(modelId)) return 'e2_model_unrecognised';
  return null;
}

/** All three parts, all real, bound together and anchored, or refused with every reason. Never the diff alone. */
export function e2Gate(input: {
  readonly streamLines: readonly string[] | null | undefined;
  readonly anchor: E2Anchor | null | undefined;
  readonly reexec: E2ReexecEvidence | null | undefined;
  readonly diff: E2DiffEvidence | null | undefined;
  readonly modelId: string | null | undefined;
  readonly binding: E2Binding | null | undefined;
}): { readonly ok: true } | { readonly ok: false; readonly reasons: readonly E2GateReason[] } {
  const reasons: E2GateReason[] = [];
  const { streamLines, anchor, reexec, diff, modelId, binding } = input;
  const bound = binding !== null && binding !== undefined && typeof binding === 'object'
    && typeof binding.runId === 'string' && binding.runId !== '' && SHA.test(binding.base) && SHA.test(binding.head) && isCanonicalDir(binding.workspace);
  let header: Record<string, unknown> | null = null;
  if (!Array.isArray(streamLines)) reasons.push('e2_stream_absent');
  else {
    const chain = verifyEvidenceChain(streamLines);
    if (!chain.ok || chain.finalHash === '') reasons.push('e2_stream_chain_invalid');
    else {
      const anchorHash = anchor !== null && anchor !== undefined && typeof anchor === 'object' ? anchor.finalHash : undefined;
      if (typeof anchorHash !== 'string' || anchorHash === '') reasons.push('e2_anchor_absent');
      else if (anchorHash !== chain.finalHash) reasons.push('e2_anchor_mismatch');
      header = JSON.parse(streamLines[0] as string) as Record<string, unknown>;
      const fin = JSON.parse(streamLines[streamLines.length - 1] as string) as Record<string, unknown>;
      const terminal = fin.terminal as { status?: unknown } | null | undefined;
      if (fin.label !== E2_STREAM_LABEL_LIVE || fin.mode !== 'live') reasons.push('e2_stream_not_live');
      if (fin.cause !== null) reasons.push('e2_stream_failed');
      if (terminal === null || terminal === undefined || typeof terminal !== 'object') reasons.push('e2_stream_no_terminal');
      else if (terminal.status !== 'FINISHED') reasons.push('e2_stream_terminal_not_finished');
      if (fin.unfinishedCalls !== 0) reasons.push('e2_stream_call_unfinished');
      if (typeof fin.toolCallCount !== 'number' || fin.toolCallCount < 1) reasons.push('e2_no_tool_calls');
      const rc = recount(streamLines);
      const finTerminal = terminal !== null && terminal !== undefined && typeof terminal === 'object' ? terminal.status : null;
      if (!rc.ok || rc.toolCallCount !== fin.toolCallCount || rc.unfinished !== fin.unfinishedCalls || rc.terminalStatus !== (finTerminal ?? null)
        || (finTerminal !== null && finTerminal !== undefined && !rc.done)) reasons.push('e2_final_record_mismatch');
      else if (rc.toolCallCount >= 1 && rc.editCalls < 1) reasons.push('e2_no_edit_calls');
      if (header.start !== 'created_by_this_transport') reasons.push('e2_stream_mid_run_start');
    }
  }
  const realReexec = reexec !== null && reexec !== undefined && RECORDED.has(reexec);
  if (reexec === null || reexec === undefined) reasons.push('e2_reexec_absent');
  else if (!realReexec) reasons.push('e2_reexec_forged');
  else if (reexec.commands.length === 0) reasons.push('e2_reexec_absent');
  else {
    if (reexec.label !== E2_JULIUS_LABEL) reasons.push('e2_reexec_fake');
    if (reexec.commands.some((c) => c.exitCode === 'unknown')) reasons.push('e2_reexec_exit_unknown');
    if (reexec.commands.some((c) => c.exitCode !== 0 && c.exitCode !== 'unknown')) reasons.push('e2_reexec_failed');
  }
  const realDiff = diff !== null && diff !== undefined && RECORDED.has(diff);
  if (diff === null || diff === undefined) reasons.push('e2_diff_absent');
  else if (!realDiff) reasons.push('e2_diff_forged');
  else {
    if (diff.label !== E2_JULIUS_LABEL) reasons.push('e2_diff_fake');
    if (diff.exitCode !== 0) reasons.push('e2_diff_failed');
    else if (diff.bytes === 0 || diff.base === diff.head) reasons.push('e2_diff_empty');
  }
  if (!bound) reasons.push('e2_binding_absent');
  else {
    if (header !== null && header.runId !== binding.runId) reasons.push('e2_binding_run_mismatch');
    if (realDiff && (diff.base !== binding.base || diff.head !== binding.head)) reasons.push('e2_binding_diff_mismatch');
    if (realDiff && !diff.ancestry) reasons.push('e2_diff_not_descendant');
    if ((realReexec && reexec.cwd !== binding.workspace) || (realDiff && diff.cwd !== binding.workspace)) reasons.push('e2_binding_cwd_mismatch');
  }
  /* Skywalker N2: the graded model is the one the creating transport requested, recorded in the chained header. */
  const headerModel = header !== null && typeof header.requestedModelId === 'string' ? header.requestedModelId : null;
  if (header !== null && (headerModel === null || headerModel !== modelId)) reasons.push('e2_model_unbound');
  const m = modelReason(modelId);
  if (m !== null) reasons.push(m);
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons: Object.freeze(reasons) };
}
