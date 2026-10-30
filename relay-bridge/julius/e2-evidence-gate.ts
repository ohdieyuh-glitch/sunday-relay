import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize as normalizePath } from 'node:path';

import { E2_STREAM_LABEL_LIVE, verifyEvidenceChain } from './cursor-run-stream-evidence';
import { isWorkflowAnchor, type ExternalAnchor } from './e2-external-anchor';

export { E2_EXTERNAL_ANCHOR_SOURCES, type E2ExternalAnchorSource, type E2UntrustedAnchorSource, type ExternalAnchor } from './e2-external-anchor';
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
  | { readonly exitCode: number | null; readonly stdoutSha256: string; readonly stderrSha256: string; readonly stdoutBytes: number; readonly stderrBytes: number; readonly cause?: string; readonly stdoutTail?: string };
export type VerifierRunner = (argv: readonly string[], cwd: string, extraEnv?: Readonly<Record<string, string>>) => Promise<VerifierRunResult>;

const TRUSTED_RUNNERS = new WeakSet<VerifierRunner>();
/** Module-private: the stdout bytes of an allowlisted git command, for the spawn runner only (no export, no setter). */
const CAPTURE = new WeakMap<VerifierRunner, (argv: readonly string[], cwd: string, env: Readonly<Record<string, string>>) => Promise<Buffer | null>>();
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
 * PILOT 43b93a4e N-3: the fixed PATH every verifier child gets. PATH is never taken from the parent, `options.env` or the
 * per-call env; node's own directory comes first so npx/npm/tsc resolve beside the running node.
 */
/** R3-3: the only caller-supplied env keys a verifier child receives (PATH is fixed separately). */
export const E2_VERIFIER_ENV_KEYS: readonly string[] = Object.freeze(['LANG', 'LC_ALL', 'CI', 'TZ', 'NODE_ENV']);
export const E2_VERIFIER_PATH = `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`;
const progName = (p: string): string => basename(p.replace(/\\/gu, '/')).toLowerCase();
/** Resolves a program name to an absolute binary on the fixed PATH (node is process.execPath), or null. */
function resolveProgram(program: string): string | null {
  const name = progName(program);
  if (name === 'node') return process.execPath;
  for (const d of E2_VERIFIER_PATH.split(':')) {
    const f = join(d, name);
    try { if (statSync(f).isFile()) return realpathSync(f); } catch { /* next */ }
  }
  return null;
}

/**
 * PILOT 5366ad30 R3-2 / Skywalker 5366ad30 M1, M2: a workspace-relative file a verifier may name. Absolute paths outside
 * the workspace, `..` escapes, /proc and symlinks that resolve outside the workspace are refused.
 */
function workspaceFile(p: string, workspace: string): string | null {
  if (typeof p !== 'string' || p === '' || p.startsWith('-') || p.includes('\u0000') || p.includes('\\')) return null;
  const abs = normalizePath(isAbsolute(p) ? p : join(workspace, p));
  if (abs.startsWith('/proc/') || abs === '/proc' || !abs.startsWith(`${workspace}/`)) return null;
  return abs.slice(workspace.length + 1);
}
/** Config files whose content shapes what npm/npx/tsc run; pinned to base whenever one of them is used. */
/** Round 5 R4-1: with only node forms left, package.json (module type, `imports` map) is the config that shapes the run. */
const TOOL_CONFIGS = Object.freeze(['package.json']);
export type E2VerifierShapeRefusal = 'program_not_allowed' | 'shape_not_allowed' | 'path_outside_workspace' | 'spec_program_untrusted';
/**
 * The closed verifier shapes, with the workspace files each one reads (to be pinned to base):
 * `node <file> [args]` and `node --test [--test-reporter=tap] <file>...` only (round 5 R4-1 dropped npm/npx/tsc). No git (R3-4).
 */
function verifierShape(argv: readonly string[], workspace: string): { readonly files: readonly string[]; readonly configs: boolean } | E2VerifierShapeRefusal {
  const name = progName(argv[0] as string);
  const args = argv.slice(1);
  const files = (xs: readonly string[]): readonly string[] | null => { const out = xs.map((x) => workspaceFile(x, workspace)); return out.every((x) => x !== null) ? out as string[] : null; };
  switch (name) {
    case 'node': {
      /* `node <file> [args to the script...]` (the script is pinned; its own arguments are its business) or `node --test <file>...`. */
      /* Round 5 R4-3: the spec inserts `--test-reporter=tap` so the run's summary can be parsed. */
      const list = args[0] === '--test' ? args.slice(args[1] === '--test-reporter=tap' ? 2 : 1) : args.slice(0, 1);
      if (list.length === 0 || list.some((x) => x.startsWith('-'))) return 'shape_not_allowed';
      const f = files(list); return f === null ? 'path_outside_workspace' : { files: f, configs: true };
    }
    /* PILOT 44c062b9 R4-1: npm/npx/tsc resolve a binary from node_modules, which git does not track and the spec cannot
       pin to base; a coder-committed node_modules/.bin/vitest ran as julius_observed. These forms are DROPPED. */
    case 'npm': case 'npx': case 'tsc': return 'spec_program_untrusted';
    default: return 'program_not_allowed';
  }
}
/** Module-built git argv (recordGitDiff and its helpers), keyed by JSON; verifiers may not run git at all (R3-4). */
const MODULE_GIT = new Set<string>();
const moduleGit = (argv: readonly string[]): readonly string[] => { MODULE_GIT.add(JSON.stringify(argv)); return Object.freeze([...argv]); };
const isModuleGit = (argv: readonly string[]): boolean => MODULE_GIT.has(JSON.stringify(argv));
/**
 * PILOT 43b93a4e N-3, 5366ad30 R3-2/R3-4 and Skywalker 5366ad30 M1/M2: the closed verifier allowlist (see verifierShape).
 * Every named file must exist, be a regular file, and realpath inside the cwd. An absolute argv0 must be the binary the
 * fixed PATH resolves to. Git, wrappers, shells, inline code and no-op forms are refused.
 */
export function isVerifierCommandAllowed(argv: readonly string[], cwd: string): boolean {
  if (!validArgv(argv) || !isCanonicalDir(cwd)) return false;
  const program = argv[0] as string;
  const name = progName(program);
  if (name !== 'node' || program !== program.trim()) return false;
  if (program.includes('/') || program.includes('\\')) {
    const resolved = resolveProgram(name);
    let real: string | null = null;
    try { real = realpathSync(program); } catch { real = null; }
    if (resolved === null || real !== resolved) return false;
  }
  const shape = verifierShape(argv, cwd);
  if (typeof shape === 'string') return false;
  return shape.files.every((f) => { try { const r = realpathSync(join(cwd, f)); return r.startsWith(`${cwd}/`) && statSync(r).isFile(); } catch { return false; } });
}

/** What the spawn runner reports when it gave up: a refused argv, the hard deadline, or an output overrun. */
export type VerifierRunCause = 'refused' | 'timeout' | 'output_overrun' | 'spawn_failed' | 'pipes_held_after_exit';

/**
 * The only runner whose records are `julius_observed`. No shell; only allowlisted programs, resolved on a fixed PATH;
 * cwd checked; the environment is an allowlist (fixed PATH, C.UTF-8 locale, then `env`, then the per-call extras, with
 * PATH dropped from both), never inherited. The child leads its own process group; when the leader exits the group is
 * killed (stragglers), and a HARD deadline (timeoutMs) kills the group, destroys stdout/stderr and resolves with exit
 * null and cause `timeout` even if an escaped process (setsid/new session) still holds the pipes. HONEST LIMIT: such an
 * escapee is not killed, only abandoned. Where the leader exits but the pipes stay open, the runner waits a short grace
 * then resolves the same way. On win32 the tree is killed with `taskkill /PID <pid> /T /F` — NOT PROVEN ON WINDOWS
 * (unit-tested with an injected platform and spawn only).
 */
export function spawnVerifierRunner(options: {
  readonly timeoutMs?: number; readonly env?: Readonly<Record<string, string>>; readonly maxOutputBytes?: number;
  readonly platform?: NodeJS.Platform; readonly spawnImpl?: typeof spawn; readonly exitGraceMs?: number;
} = {}): VerifierRunner {
  const pos = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  const timeoutMs = pos(options.timeoutMs, 15 * 60 * 1000);
  const maxOutputBytes = pos(options.maxOutputBytes, 1024 * 1024 * 1024);
  /* R3-9: after the leader exits, held pipes get a short grace (default 500 ms), never past the hard deadline. */
  const exitGraceMs = pos(options.exitGraceMs, 500);
  const platform = options.platform ?? process.platform;
  const spawnImpl = options.spawnImpl ?? spawn;
  const refused = { exitCode: null, stdoutSha256: EMPTY_SHA, stderrSha256: EMPTY_SHA, stdoutBytes: 0, stderrBytes: 0 } as const;
  /* R3-3: a key allowlist, not a denylist. NODE_OPTIONS, GIT_*, HOME, LD_*, npm_config_* and PATH never pass. */
  const noPath = (e: Readonly<Record<string, string>> | undefined): Record<string, string> =>
    Object.fromEntries(Object.entries(e ?? {}).filter(([k, v]) => E2_VERIFIER_ENV_KEYS.includes(k) && typeof v === 'string'));
  const runner: VerifierRunner = (argv, cwd, extraEnv) => new Promise((resolve) => {
    if (!validArgv(argv) || !isCanonicalDir(cwd) || !(isVerifierCommandAllowed(argv, cwd) || isModuleGit(argv))) { resolve({ ...refused, cause: 'refused' }); return; }
    const bin = resolveProgram(argv[0] as string);
    if (bin === null) { resolve({ ...refused, cause: 'refused' }); return; }
    /* Module git gets only its own fixed env (R3-3/L2); caller env never reaches git. */
    const env: Record<string, string> = isModuleGit(argv)
      ? { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', ...E2_GIT_ENV, GIT_NO_REPLACE_OBJECTS: '1', PATH: E2_VERIFIER_PATH }
      : { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', ...noPath(options.env), ...noPath(extraEnv), PATH: E2_VERIFIER_PATH };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(bin, argv.slice(1), { cwd, shell: false, env, detached: platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { resolve({ ...refused, cause: 'spawn_failed' }); return; }
    const out = createHash('sha256');
    const err = createHash('sha256');
    let outBytes = 0;
    let errBytes = 0;
    let cause: VerifierRunCause | null = null;
    let failed = false;
    let settled = false;
    const killGroup = (): void => {
      const pid = child.pid;
      if (pid === undefined) return;
      if (platform === 'win32') {
        try { spawnImpl('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, stdio: 'ignore', windowsHide: true }).unref?.(); } catch { /* best effort */ }
        return;
      }
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
    };
    let code: number | null = null;
    let sig: NodeJS.Signals | null = null;
    const finish = (c: number | null, s: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace !== undefined) clearTimeout(grace);
      const r = {
        exitCode: !failed && cause === null && s === null && typeof c === 'number' && c >= 0 ? c : null,
        stdoutSha256: out.digest('hex'), stderrSha256: err.digest('hex'), stdoutBytes: outBytes, stderrBytes: errBytes,
        stdoutTail: tail.toString('utf8'),
      };
      resolve(cause === null ? r : { ...r, cause });
    };
    /* Hard deadline: never waits for the pipes to close. */
    const abandon = (why: VerifierRunCause): void => {
      if (cause === null) cause = why;
      killGroup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(null, null);
    };
    const started = Date.now();
    const timer = setTimeout(() => abandon('timeout'), timeoutMs);
    let grace: ReturnType<typeof setTimeout> | undefined;
    const over = (): void => { if (outBytes + errBytes > maxOutputBytes && cause === null) abandon('output_overrun'); };
    let tail = Buffer.alloc(0);
    child.stdout?.on('data', (d: Buffer) => {
      if (settled) return; outBytes += d.byteLength; out.update(d);
      tail = Buffer.concat([tail, d]); if (tail.byteLength > E2_STDOUT_TAIL_BYTES) tail = tail.subarray(tail.byteLength - E2_STDOUT_TAIL_BYTES);
      over();
    });
    child.stderr?.on('data', (d: Buffer) => { if (settled) return; errBytes += d.byteLength; err.update(d); over(); });
    child.on('error', () => { failed = true; finish(null, null); });
    // A leader that exits leaves no reason for its group to keep the pipes open: stragglers are killed (mutant M9).
    child.on('exit', (c: number | null, s: NodeJS.Signals | null) => {
      code = c; sig = s; killGroup();
      grace = setTimeout(() => abandon('pipes_held_after_exit'), Math.max(0, Math.min(exitGraceMs, timeoutMs - (Date.now() - started))));
    });
    child.on('close', (c: number | null, s: NodeJS.Signals | null) => finish(code ?? c, sig ?? s));
  });
  TRUSTED_RUNNERS.add(runner);
  CAPTURE.set(runner, (argv, cwd) => new Promise((resolve) => {
    if (!isCanonicalDir(cwd) || !isModuleGit(argv)) { resolve(null); return; }
    const bin = resolveProgram('git');
    if (bin === null) { resolve(null); return; }
    execFile(bin, argv.slice(1), { cwd, shell: false, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
      env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', ...E2_GIT_ENV, GIT_NO_REPLACE_OBJECTS: '1', PATH: E2_VERIFIER_PATH } }, (e, out) => resolve(e === null ? out : null));
  }));
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
  /** Round 5 R4-3: the trailing node --test TAP summary of the captured stdout tail, or null (absent or not parseable). */
  readonly testSummary: E2TestSummary | null;
}
export interface E2TestSummary { readonly tests: number; readonly pass: number; readonly fail: number }
/** Bytes of stdout kept (as text) for the summary; the full stream is still only hashed. */
export const E2_STDOUT_TAIL_BYTES = 64 * 1024;
/**
 * Round 5 R4-3: the summary node's TAP (or spec, `ℹ`) reporter prints LAST. It must end the output: anything the test
 * code prints is escaped by the TAP reporter (`# \# tests 99`) and comes earlier, so it cannot stand in for this block.
 * Cancelled tests count as failures. HONEST LIMIT: a detached grandchild that keeps writing to the inherited stdout after
 * the summary makes the summary non-final (refused, never accepted).
 */
const SUMMARY = /(?:^|\n)[#ℹ] tests (\d+)\n[#ℹ] suites \d+\n[#ℹ] pass (\d+)\n[#ℹ] fail (\d+)\n[#ℹ] cancelled (\d+)\n[#ℹ] skipped \d+\n[#ℹ] todo \d+\n[#ℹ] duration_ms [0-9.]+\n?$/u;
export function parseNodeTestSummary(text: string): E2TestSummary | null {
  const m = SUMMARY.exec(text);
  if (m === null) return null;
  return Object.freeze({ tests: Number(m[1]), pass: Number(m[2]), fail: Number(m[3]) + Number(m[4]) });
}
export interface E2ReexecEvidence {
  readonly label: typeof E2_JULIUS_LABEL | typeof E2_FAKE_LABEL; readonly cwd: string; readonly commands: readonly E2CommandRecord[];
  /** The mission spec the commands came from (null: the legacy free-argv form, refused by the gate). */
  readonly spec: E2VerifierSpec | null;
  readonly refusal: E2ReexecRefusal | null;
}
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
  /** `git diff --name-only -z` of the same range (spawn runner only; null otherwise). Rule (b). */
  readonly paths: readonly string[] | null;
  /** M-8: the repository's info/attributes is absent or empty (spawn runner only; false otherwise). */
  readonly isolated: boolean;
}

const validArgv = (a: unknown): a is readonly string[] =>
  Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'string' && !x.includes('\u0000')) && (a[0] as string) !== '';

const normalize = (r: VerifierRunResult): { exitCode: number | 'unknown'; stdoutSha256: string; stderrSha256: string; stdoutBytes: number; stderrBytes: number; tail: string } => {
  const exitCode = typeof r.exitCode === 'number' && Number.isInteger(r.exitCode) ? r.exitCode : 'unknown' as const;
  if ('stdoutSha256' in r) return { exitCode, stdoutSha256: r.stdoutSha256, stderrSha256: r.stderrSha256, stdoutBytes: r.stdoutBytes, stderrBytes: r.stderrBytes, tail: typeof r.stdoutTail === 'string' ? r.stdoutTail : '' };
  const len = (b: Uint8Array | string): number => (typeof b === 'string' ? Buffer.byteLength(b) : b.byteLength);
  const buf = typeof r.stdout === 'string' ? Buffer.from(r.stdout) : Buffer.from(r.stdout);
  return { exitCode, stdoutSha256: sha256(r.stdout), stderrSha256: sha256(r.stderr), stdoutBytes: len(r.stdout), stderrBytes: len(r.stderr), tail: buf.subarray(Math.max(0, buf.byteLength - E2_STDOUT_TAIL_BYTES)).toString('utf8') };
};
const run = async (runner: VerifierRunner, argv: readonly string[], cwd: string, env?: Readonly<Record<string, string>>): Promise<ReturnType<typeof normalize>> => {
  try { return normalize(await runner([...argv], cwd, env)); } catch { return normalize({ exitCode: null, stdout: '', stderr: '' }); }
};

/**
 * PILOT 5366ad30 R3-2 / Skywalker 5366ad30 M1, M2: the verifier commands come from the MISSION, not from the coder. The
 * mission's `testCommand` (a shell string) and any explicitly listed additional checks are mapped to argv by a plain
 * whitespace split (any shell metacharacter or quote refuses the spec), each argv must be one of the closed verifier
 * shapes, and every file those commands read (scripts, test files, package.json and tool configs) is hashed AT BASE from
 * the git object store. {@link recordVerifierReexec} re-hashes the workspace files and refuses to run if any differ.
 * HONEST LIMITS: files a script imports transitively (other modules, node_modules) are NOT pinned; a coder who edits a
 * helper the pinned test imports can still change behaviour. Pins are checked right before running (a TOCTOU window
 * remains against a concurrent writer in the workspace).
 */
export interface E2MissionVerifierInput {
  readonly testCommand: string;
  readonly additionalChecks?: readonly string[];
  readonly workspace: string;
  readonly base: string;
  /** Round 5 R4-3: the mission's minimum passing-test count for `node --test` commands (a non-negative integer). */
  readonly minTests?: number;
}
export interface E2VerifierSpec {
  readonly base: string;
  readonly workspace: string;
  readonly commands: readonly (readonly string[])[];
  /** workspace-relative path -> sha256 of its content at base, or 'absent'. */
  readonly pins: Readonly<Record<string, string>>;
  /**
   * Round 5 R4-3, per command: for `node --test`, the passing-test floor = max(1, mission minTests, count of test()/it()
   * calls in the base-pinned test files); null for `node <file>`. Never from run-time output or anything the coder wrote.
   */
  readonly minTests: readonly (number | null)[];
}
export type E2VerifierSpecRefusal =
  | 'spec_invalid' | 'spec_shell_syntax' | 'spec_base_invalid' | 'spec_workspace_invalid'
  | E2VerifierShapeRefusal | 'spec_file_not_at_base';
const SPECS = new WeakSet<object>();
/** R4-3: test()/it() calls in a base-pinned test file (a static count; over-counting only raises the floor). */
const BASE_TEST_CALL = /\b(?:test|it)\s*\(/gu;
const SHELL_SYNTAX = /[;&|<>$`'"\\(){}[\]*?~!#=%^\r\n\t]/u;
const gitBlob = (workspace: string, base: string, path: string): Buffer | null => {
  const bin = resolveProgram('git');
  if (bin === null) return null;
  try {
    return execFileSync(bin, [...GIT_PINS, 'cat-file', 'blob', `${base}:${path}`], {
      cwd: workspace, shell: false, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
      env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', ...E2_GIT_ENV, GIT_NO_REPLACE_OBJECTS: '1', PATH: E2_VERIFIER_PATH },
    });
  } catch { return null; }
};
/** Builds the pinned spec, or a named refusal. Call it on the mission record, not on anything the coder wrote. */
export function pinVerifierSpec(input: E2MissionVerifierInput): E2VerifierSpec | { readonly refused: E2VerifierSpecRefusal } {
  const no = (refused: E2VerifierSpecRefusal) => Object.freeze({ refused });
  if (typeof input !== 'object' || input === null || typeof input.testCommand !== 'string') return no('spec_invalid');
  if (!SHA.test(input.base)) return no('spec_base_invalid');
  if (!isCanonicalDir(input.workspace)) return no('spec_workspace_invalid');
  const strings = [input.testCommand, ...(input.additionalChecks ?? [])];
  if (!strings.every((x) => typeof x === 'string' && x.trim() !== '')) return no('spec_invalid');
  if (input.minTests !== undefined && !(Number.isSafeInteger(input.minTests) && input.minTests >= 0)) return no('spec_invalid');
  if (strings.some((x) => SHELL_SYNTAX.test(x.trim()))) return no('spec_shell_syntax');
  const commands = strings.map((x) => {
    const a = x.trim().split(/ +/u);
    /* R4-3: node --test always reports TAP so the gate can read the summary. */
    return Object.freeze(progName(a[0] as string) === 'node' && a[1] === '--test' && a[2] !== '--test-reporter=tap' ? [a[0] as string, '--test', '--test-reporter=tap', ...a.slice(2)] : a);
  });
  const pins: Record<string, string> = {};
  const minTests: (number | null)[] = [];
  for (const argv of commands) {
    if ((argv[0] as string).includes('/')) return no('program_not_allowed');
    const shape = verifierShape(argv, input.workspace);
    if (typeof shape === 'string') return no(shape);
    let atBase = 0;
    for (const f of shape.files) {
      const blob = gitBlob(input.workspace, input.base, f);
      if (blob === null) return no('spec_file_not_at_base');
      pins[f] = sha256(blob);
      atBase += (blob.toString('utf8').match(BASE_TEST_CALL) ?? []).length;
    }
    minTests.push(argv[1] === '--test' ? Math.max(1, input.minTests ?? 0, atBase) : null);
    if (shape.configs) for (const f of TOOL_CONFIGS) { const blob = gitBlob(input.workspace, input.base, f); pins[f] = blob === null ? 'absent' : sha256(blob); }
  }
  const spec: E2VerifierSpec = Object.freeze({ base: input.base, workspace: input.workspace, commands: Object.freeze(commands), pins: Object.freeze(pins), minTests: Object.freeze(minTests) });
  SPECS.add(spec);
  return spec;
}
const isSpec = (x: unknown): x is E2VerifierSpec => typeof x === 'object' && x !== null && SPECS.has(x);
/** The workspace file still has its base content (a symlink, a missing file where one was pinned, or new content: false). */
function pinHolds(workspace: string, path: string, want: string): boolean {
  const f = join(workspace, path);
  let st;
  try { st = lstatSync(f); } catch (e) { return want === 'absent' && (e as { code?: string }).code === 'ENOENT'; }
  if (want === 'absent' || !st.isFile()) return false;
  try { return sha256(readFileSync(f)) === want; } catch { return false; }
}

/** Why a spec re-exec did not run its commands. */
export type E2ReexecRefusal = 'pin_changed' | 'cwd_not_spec_workspace';
/**
 * (B) Re-runs the verifier commands in order. With `spec` (the only form the gate accepts) the commands are the spec's
 * and every pin is re-checked first; a changed file runs nothing and records `refusal: 'pin_changed'`. The legacy
 * `commands` form still records evidence for the runner's own tests but the gate refuses it (`e2_verifier_not_from_spec`).
 * Invalid argv, a shell program, a non-allowlisted command or a relative cwd is refused (null) before anything runs.
 */
export async function recordVerifierReexec(input: {
  readonly spec?: E2VerifierSpec;
  readonly commands?: readonly (readonly string[])[];
  readonly cwd: string;
  readonly runner: VerifierRunner;
  readonly now?: () => number;
}): Promise<E2ReexecEvidence | null> {
  const now = input.now ?? Date.now;
  const spec = isSpec(input.spec) ? input.spec : null;
  if (input.spec !== undefined && spec === null) return null;
  const list = spec !== null ? spec.commands : input.commands;
  if (!Array.isArray(list) || list.length === 0 || !list.every(validArgv)) return null;
  if (list.some((a) => isShellProgram(a[0] as string))) return null;
  if (typeof input.cwd !== 'string' || !isAbsolute(input.cwd)) return null;
  const label = TRUSTED_RUNNERS.has(input.runner) ? E2_JULIUS_LABEL : E2_FAKE_LABEL;
  const refusedEv = (refusal: E2ReexecRefusal): E2ReexecEvidence => { const e: E2ReexecEvidence = Object.freeze({ label, cwd: input.cwd, commands: Object.freeze([]), spec, refusal }); RECORDED.add(e); return e; };
  if (spec !== null) {
    if (input.cwd !== spec.workspace) return refusedEv('cwd_not_spec_workspace');
    if (!Object.entries(spec.pins).every(([f, h]) => pinHolds(spec.workspace, f, h))) return refusedEv('pin_changed');
  }
  /* PILOT 43b93a4e N-3 / Skywalker N3: only allowlisted, non-trivial verifier programs, whatever runner is supplied. */
  if (!list.every((a) => isVerifierCommandAllowed(a, input.cwd))) return null;
  const commands: E2CommandRecord[] = [];
  for (const argv of list) {
    const startedAt = new Date(now()).toISOString();
    const { tail, ...r } = await run(input.runner, argv, input.cwd);
    commands.push(Object.freeze({ argv: Object.freeze([...argv]), ...r, startedAt, endedAt: new Date(now()).toISOString(), testSummary: parseNodeTestSummary(tail) }));
  }
  const ev: E2ReexecEvidence = Object.freeze({ label, cwd: input.cwd, commands: Object.freeze(commands), spec, refusal: null });
  RECORDED.add(ev);
  return ev;
}

const SHA = /^[0-9a-f]{40}$/u;
/** M-8: git configuration that would change the diff bytes is pinned; global and system config are not read. */
export const E2_GIT_ENV = Object.freeze({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1' });
const GIT_PINS = Object.freeze([
  /* Skywalker L2: replace refs never redirect objects (also GIT_NO_REPLACE_OBJECTS=1 in the env). */
  '--no-replace-objects',
  '-c', 'diff.noprefix=false', '-c', 'diff.renames=false', '-c', 'core.quotepath=false', '-c', 'diff.mnemonicPrefix=false',
  '-c', 'color.ui=never', '-c', 'diff.relative=false', '-c', 'diff.suppressBlankEmpty=false', '-c', 'core.autocrlf=false',
  /* PILOT 43b93a4e M-8: everything else in the repo's own config that shapes the bytes. */
  '-c', 'diff.context=3', '-c', 'diff.interHunkContext=0', '-c', 'diff.orderFile=/dev/null', '-c', 'diff.srcPrefix=a/', '-c', 'diff.dstPrefix=b/',
  '-c', 'diff.algorithm=myers', '-c', 'diff.indentHeuristic=true', '-c', 'core.attributesFile=/dev/null', '-c', 'diff.wsErrorHighlight=none',
]);
/** M-8: the same settings as explicit flags (a flag beats config). */
const DIFF_FLAGS = Object.freeze(['-U3', '--inter-hunk-context=0', '-O/dev/null', '--src-prefix=a/', '--dst-prefix=b/', '--diff-algorithm=myers', '--indent-heuristic']);
/** (C) The config-pinned diff between two full commit SHAs, and whether head descends from base. Bad SHAs are refused (null). */
export async function recordGitDiff(input: { readonly base: string; readonly head: string; readonly cwd: string; readonly runner: VerifierRunner }): Promise<E2DiffEvidence | null> {
  if (!SHA.test(input.base) || !SHA.test(input.head)) return null;
  if (typeof input.cwd !== 'string' || !isAbsolute(input.cwd)) return null;
  const range = `${input.base}..${input.head}`;
  const argv = moduleGit(['git', ...GIT_PINS, 'diff', '--no-ext-diff', '--no-textconv', '--binary', '--no-renames', '--no-color', '--full-index', ...DIFF_FLAGS, range]);
  const r = await run(input.runner, argv, input.cwd, E2_GIT_ENV);
  const anc = await run(input.runner, moduleGit(['git', ...GIT_PINS, 'merge-base', '--is-ancestor', input.base, input.head]), input.cwd, E2_GIT_ENV);
  /* Rule (b) needs the changed paths; M-8 needs to know whether info/attributes (which no config can switch off) is empty. */
  const capture = CAPTURE.get(input.runner);
  let paths: readonly string[] | null = null;
  let isolated = false;
  if (capture !== undefined) {
    const names = await capture(moduleGit(['git', ...GIT_PINS, 'diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', range]), input.cwd, E2_GIT_ENV);
    if (names !== null) paths = Object.freeze(names.toString('utf8').split('\u0000').filter((x) => x !== ''));
    const attr = await capture(moduleGit(['git', ...GIT_PINS, 'rev-parse', '--git-path', 'info/attributes']), input.cwd, E2_GIT_ENV);
    if (attr !== null) {
      const f = attr.toString('utf8').replace(/\n$/u, '');
      try { isolated = statSync(isAbsolute(f) ? f : join(input.cwd, f)).size === 0; } catch (e) { isolated = (e as { code?: string }).code === 'ENOENT'; }
    }
  }
  const ev: E2DiffEvidence = Object.freeze({
    label: TRUSTED_RUNNERS.has(input.runner) ? E2_JULIUS_LABEL : E2_FAKE_LABEL, base: input.base, head: input.head, cwd: input.cwd, argv,
    exitCode: r.exitCode, sha256: r.stdoutSha256, bytes: r.stdoutBytes, ancestry: anc.exitCode === 0, paths, isolated,
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
  'e2_diff_not_isolated', 'e2_edit_path_not_in_diff', 'e2_edit_path_unknown',
  'e2_anchor_not_external', 'e2_verifier_spec_absent', 'e2_verifier_not_from_spec', 'e2_verifier_pin_changed',
  'e2_tool_unknown', 'e2_edit_path_outside_workspace', 'e2_verifier_binary_untrusted', 'e2_verifier_tests_below_minimum',
] as const);
export type E2GateReason = (typeof E2_GATE_REASONS)[number];

/** What the gate needs to bind the three parts: the run, the commits and the workspace, all from the caller's own record. */
export interface E2Binding { readonly runId: string; readonly base: string; readonly head: string; readonly workspace: string; readonly remoteWorkspaceRoot?: string }
/**
 * The final hash recorded OUTSIDE the capture (workflow output, ledger). The gate never takes it from the file.
 * PILOT 5366ad30 R3-1: ENFORCED by type and by a module-private registry. The gate accepts only an {@link ExternalAnchor}
 * made by `externalAnchor` in ./e2-external-anchor with a source from the closed set {@link E2_EXTERNAL_ANCHOR_SOURCES}; a bare object, a
 * string, a copy, or an anchor labelled `evidence_file` / `capturing_process` is refused with `e2_anchor_not_external`.
 * {@link anchorFromEvidenceFile} and {@link anchorFromCapture} exist only so a caller that has nothing better gets a
 * refusal with a name instead of a silent pass. HONEST LIMIT: the label is the caller's claim. A writer who controls the
 * events, the final record AND the external anchor source still wins; the workflow side must hold the anchor (write it
 * from the workflow right after capture and read it back from that output only). The gate cannot verify provenance.
 */
/* Round 5 R4-2: the constructor and the brand registry live in ./e2-external-anchor (not exported from here). The two
   helpers below make anchors the gate always refuses, so a caller with nothing better gets a named refusal. */
export type E2Anchor = ExternalAnchor;
const untrusted = (source: 'evidence_file' | 'capturing_process', finalHash: unknown): ExternalAnchor =>
  Object.freeze({ finalHash: typeof finalHash === 'string' ? finalHash : '', source }) as unknown as ExternalAnchor;
/** An anchor read from the evidence file itself: always refused by the gate (`e2_anchor_not_external`). */
export function anchorFromEvidenceFile(lines: readonly string[]): ExternalAnchor {
  const c = verifyEvidenceChain(lines);
  return untrusted('evidence_file', c.ok ? c.finalHash : '');
}
/** An anchor taken from the capturing process's own result object: always refused (`e2_anchor_not_external`). */
export const anchorFromCapture = (evidence: { readonly finalHash: string }): ExternalAnchor => untrusted('capturing_process', evidence.finalHash);
const isExternal = isWorkflowAnchor;

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
/**
 * Round 4 M3/R3-6: a CLOSED table of tool names, exact match. NOT VERIFIED against live Cursor Cloud Agents tool names
 * (no provider call was made); the names are the ones seen in Cursor/agent tool docs and fixtures. An edit tool must name
 * its path(s); a known non-edit tool (todo_write, reads, searches, terminal) is not an edit; any other name is refused
 * with `e2_tool_unknown` instead of being guessed from a substring. HONEST LIMIT: a terminal command can change files
 * without naming them; those changes are only seen through the diff, not rule (b).
 */
export const E2_EDIT_TOOL_NAMES: readonly string[] = Object.freeze(['edit_file', 'search_replace', 'write', 'apply_patch', 'delete_file', 'MultiEdit', 'Edit', 'Write']);
export const E2_NON_EDIT_TOOL_NAMES: readonly string[] = Object.freeze([
  'todo_write', 'TodoWrite', 'read_file', 'Read', 'grep', 'Grep', 'glob_file_search', 'Glob', 'codebase_search', 'list_dir', 'LS',
  'file_search', 'run_terminal_cmd', 'Bash', 'web_search', 'read_lints',
]);
export const isEditToolName = (name: unknown): boolean => typeof name === 'string' && E2_EDIT_TOOL_NAMES.includes(name);
const isKnownToolName = (name: unknown): boolean => isEditToolName(name) || (typeof name === 'string' && E2_NON_EDIT_TOOL_NAMES.includes(name));

interface Recount { readonly ok: boolean; readonly toolCallCount: number; readonly unfinished: number; readonly editCalls: number; readonly editPaths: readonly (readonly string[] | null)[]; readonly unknownTools: number; readonly terminalStatus: string | null; readonly done: boolean }
/** PILOT 43b93a4e N-1: everything the gate grades, recounted from the event records. An unparsable event fails closed. */
function recount(lines: readonly string[]): Recount {
  const calls = new Map<string, { name: unknown; status: unknown; args: unknown }>();
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
      calls.set(v.callId, { name: v.name ?? calls.get(v.callId)?.name, status: v.status, args: v.args ?? calls.get(v.callId)?.args });
    } else if (r.event === 'result') {
      const v = parse();
      if (v === null || typeof v.status !== 'string') { ok = false; continue; }
      terminalStatus = v.status;
    } else if (r.event === 'done') done = true;
  }
  const all = [...calls.values()];
  return { ok, toolCallCount: all.length, unfinished: all.filter((c) => c.status !== 'completed').length, editCalls: all.filter((c) => isEditToolName(c.name)).length,
    editPaths: all.filter((c) => isEditToolName(c.name)).map((c) => editPaths(c.args)), unknownTools: all.filter((c) => !isKnownToolName(c.name)).length, terminalStatus, done };
}

const okPath = (v: unknown): v is string => typeof v === 'string' && v !== '' && !v.includes('\u0000') && v !== '/dev/null';
/** Round 4 M3: paths named in apply_patch text (`*** Update/Add/Delete File:`, `*** Move to:`, `--- a/`, `+++ b/`). Linear. */
function patchPaths(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/u.exec(line) ?? /^\*\*\* Move to: (.+)$/u.exec(line) ?? /^(?:---|\+\+\+) [ab]\/(.+)$/u.exec(line);
    if (m !== null) out.push((m[1] as string).replace(/\r$/u, '').trim());
  }
  return out;
}
/**
 * Rule (b): every path an edit-type call names, from the argument shapes seen in Cursor tool calls; null if unrecognised.
 * Round 4 M3: exactly one of a single-path key, a `paths` list, or patch text (`patch`/`input`); conservative otherwise.
 */
function editPaths(args: unknown): readonly string[] | null {
  if (typeof args !== 'object' || args === null) return null;
  const a = args as Record<string, unknown>;
  const single = ['path', 'file_path', 'target_file', 'filePath', 'targetFile'].map((k) => a[k]).filter((v) => v !== undefined);
  const list = a.paths;
  const patch = ['patch', 'input'].map((k) => a[k]).filter((v) => v !== undefined);
  const forms = [single.length > 0, list !== undefined, patch.length > 0].filter(Boolean).length;
  if (forms !== 1) return null;
  if (single.length > 0) return single.length === 1 && okPath(single[0]) ? [single[0]] : null;
  if (list !== undefined) return Array.isArray(list) && list.length > 0 && list.every(okPath) ? [...(list as string[])] : null;
  if (patch.length !== 1 || typeof patch[0] !== 'string') return null;
  const ps = patchPaths(patch[0]);
  return ps.length > 0 && ps.every(okPath) ? ps : null;
}
/**
 * Rule (b): a workspace-relative POSIX path, or null when it leaves the workspace. Round 4 M3: an absolute path under the
 * caller's explicit `remoteWorkspaceRoot` (the agent's own checkout path) is stripped to relative. NOT VERIFIED which
 * root live Cursor runs use; the caller must supply it.
 */
function relToWorkspace(p: string, workspace: string, remoteRoot?: string): string | null {
  const norm = normalizePath(p);
  for (const r of [remoteRoot, workspace]) {
    if (typeof r === 'string' && isAbsolute(r) && isAbsolute(norm) && norm.startsWith(`${normalizePath(r).replace(/\/+$/u, '')}/`)) {
      return norm.slice(normalizePath(r).replace(/\/+$/u, '').length + 1);
    }
  }
  if (isAbsolute(norm) || norm === '..' || norm.startsWith('../') || norm === '.') return null;
  return norm.replace(/^\.\//u, '');
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
  readonly anchor: ExternalAnchor | null | undefined;
  readonly reexec: E2ReexecEvidence | null | undefined;
  /** R3-2 / M1: the pinned mission spec (from {@link pinVerifierSpec}); the re-exec must have run exactly this. */
  readonly verifierSpec: E2VerifierSpec | { readonly refused: E2VerifierSpecRefusal } | null | undefined;
  readonly diff: E2DiffEvidence | null | undefined;
  readonly modelId: string | null | undefined;
  readonly binding: E2Binding | null | undefined;
}): { readonly ok: true } | { readonly ok: false; readonly reasons: readonly E2GateReason[] } {
  const reasons: E2GateReason[] = [];
  const { streamLines, anchor, reexec, diff, modelId, binding, verifierSpec } = input;
  const bound = binding !== null && binding !== undefined && typeof binding === 'object'
    && typeof binding.runId === 'string' && binding.runId !== '' && SHA.test(binding.base) && SHA.test(binding.head) && isCanonicalDir(binding.workspace);
  let header: Record<string, unknown> | null = null;
  let rc: Recount | null = null;
  if (!Array.isArray(streamLines)) reasons.push('e2_stream_absent');
  else {
    const chain = verifyEvidenceChain(streamLines);
    if (!chain.ok || chain.finalHash === '') reasons.push('e2_stream_chain_invalid');
    else {
      const anchorHash = isExternal(anchor) ? anchor.finalHash : undefined;
      if (anchor === null || anchor === undefined) reasons.push('e2_anchor_absent');
      else if (!isExternal(anchor)) reasons.push('e2_anchor_not_external');
      else if (typeof anchorHash !== 'string' || anchorHash === '') reasons.push('e2_anchor_absent');
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
      rc = recount(streamLines);
      const finTerminal = terminal !== null && terminal !== undefined && typeof terminal === 'object' ? terminal.status : null;
      if (!rc.ok || rc.toolCallCount !== fin.toolCallCount || rc.unfinished !== fin.unfinishedCalls || rc.terminalStatus !== (finTerminal ?? null)
        || (finTerminal !== null && finTerminal !== undefined && !rc.done)) reasons.push('e2_final_record_mismatch');
      else if (rc.toolCallCount >= 1 && rc.editCalls < 1) reasons.push('e2_no_edit_calls');
      if (rc.ok && rc.unknownTools > 0) reasons.push('e2_tool_unknown');
      if (header.start !== 'created_by_this_transport') reasons.push('e2_stream_mid_run_start');
    }
  }
  const realReexec = reexec !== null && reexec !== undefined && RECORDED.has(reexec);
  if (reexec === null || reexec === undefined) reasons.push('e2_reexec_absent');
  else if (!realReexec) reasons.push('e2_reexec_forged');
  else if (!isSpec(verifierSpec)) reasons.push('e2_verifier_spec_absent');
  else if (reexec.spec !== verifierSpec) reasons.push('e2_verifier_not_from_spec');
  else if (reexec.refusal === 'pin_changed') reasons.push('e2_verifier_pin_changed');
  else if (reexec.refusal !== null || reexec.commands.length === 0) reasons.push('e2_reexec_absent');
  else {
    if (reexec.label !== E2_JULIUS_LABEL) reasons.push('e2_reexec_fake');
    if (reexec.commands.some((c) => c.exitCode === 'unknown')) reasons.push('e2_reexec_exit_unknown');
    if (reexec.commands.some((c) => c.exitCode !== 0 && c.exitCode !== 'unknown')) reasons.push('e2_reexec_failed');
    /* Round 5 R4-3: exit 0 is not enough for node --test; the summary must show the spec's floor passing and none failing. */
    const floors = verifierSpec.minTests;
    if (reexec.commands.length !== floors.length || reexec.commands.some((c, i) => {
      const floor = floors[i];
      if (floor === null || floor === undefined) return false;
      const t = c.testSummary;
      return t === null || t.pass < floor || t.fail > 0;
    })) reasons.push('e2_verifier_tests_below_minimum');
  }
  const realDiff = diff !== null && diff !== undefined && RECORDED.has(diff);
  if (diff === null || diff === undefined) reasons.push('e2_diff_absent');
  else if (!realDiff) reasons.push('e2_diff_forged');
  else {
    if (diff.label !== E2_JULIUS_LABEL) reasons.push('e2_diff_fake');
    if (diff.exitCode !== 0) reasons.push('e2_diff_failed');
    else if (diff.bytes === 0 || diff.base === diff.head) reasons.push('e2_diff_empty');
    if (diff.isolated !== true) reasons.push('e2_diff_not_isolated');
  }
  if (!bound) reasons.push('e2_binding_absent');
  else {
    if (header !== null && header.runId !== binding.runId) reasons.push('e2_binding_run_mismatch');
    if (realDiff && (diff.base !== binding.base || diff.head !== binding.head)) reasons.push('e2_binding_diff_mismatch');
    if (realDiff && !diff.ancestry) reasons.push('e2_diff_not_descendant');
    if (isSpec(verifierSpec) && verifierSpec.base !== binding.base && !reasons.includes('e2_verifier_not_from_spec')) reasons.push('e2_verifier_not_from_spec');
    if ((realReexec && reexec.cwd !== binding.workspace) || (realDiff && diff.cwd !== binding.workspace)) reasons.push('e2_binding_cwd_mismatch');
    /* Skywalker N3 rule (b): every edit-type call names one path, and that path is in the diff. Conservative: an edit call
       whose path the gate cannot read is refused, not skipped. Paths an edit touched but later reverted are refused too. */
    if (rc !== null && rc.ok && realDiff && diff.exitCode === 0) {
      if (rc.editPaths.some((p) => p === null)) reasons.push('e2_edit_path_unknown');
      else {
        const inDiff = new Set(diff.paths ?? []);
        const rels = rc.editPaths.flatMap((ps) => (ps as readonly string[]).map((p) => relToWorkspace(p, binding.workspace, binding.remoteWorkspaceRoot)));
        if (rels.some((r) => r === null)) reasons.push('e2_edit_path_outside_workspace');
        if (diff.paths === null || rels.some((r) => r !== null && !inDiff.has(r))) reasons.push('e2_edit_path_not_in_diff');
      }
    }
    /* Round 5 R4-1: a diff that adds or changes anything under node_modules can change what the verifier imports. */
    if (realDiff && diff.exitCode === 0 && (diff.paths === null || diff.paths.some((p) => p.split('/').includes('node_modules')))) {
      reasons.push('e2_verifier_binary_untrusted');
    }
  }
  /* Skywalker N2: the graded model is the one the creating transport requested, recorded in the chained header. */
  const headerModel = header !== null && typeof header.requestedModelId === 'string' ? header.requestedModelId : null;
  if (header !== null && (headerModel === null || headerModel !== modelId)) reasons.push('e2_model_unbound');
  const m = modelReason(modelId);
  if (m !== null) reasons.push(m);
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons: Object.freeze(reasons) };
}
