import { createHash } from 'node:crypto';

import { juliusAttemptCloseCommand, juliusAttemptStartCommand, parseJuliusAttemptStart } from './julius/coder-workspace';
import type { ShellEffectInput, ShellEffectPort, ShellEffectResult } from './julius/executor-effects';

/**
 * A LOCAL ShellEffectPort FOR J1 (construct-only; no process is spawned and no file is touched unless an injected function does it).
 *
 * WHAT IT RUNS: ONLY the bridge's own attempt commands, by EXACT STRING MATCH against what the generators produce for the current trees:
 *   - `juliusAttemptStartCommand(null)`                                    (the start of an attempt);
 *   - `juliusAttemptCloseCommand(null)` (plain status) and
 *     `juliusAttemptCloseCommand({ baseTree, startTree })` for the trees the LAST start reported;
 *   - the J1 workspace seed ({@link J1_SEED_COMMAND}), which only this module issues (a caller cannot send it).
 * Anything else is REFUSED with `refused:command_not_allowed` and nothing is spawned: no arbitrary text can run through this port.
 * The coder session itself gets NO shell: the hosted envelope offers it Read/Glob/Grep/Edit and this port is not reachable from it.
 *
 * HOW: `bash -c <command>` through the injected `spawn`, with cwd = the private workspace, a MINIMAL env (PATH, a private HOME, LANG,
 * git hardening; no parent variable, no key), a timeout (the caller's, capped), and bounded output. The git hardening is the env-scope
 * config `core.fsmonitor=false` and `core.hooksPath=/dev/null`, which outranks the repository's own config, so a planted `.git/config`
 * cannot make the bridge's `git add`/`git status` run a command.
 *
 * D-5 (the shared index file): the generated attempt commands use the fixed path /tmp/julius-attempt-index. IMMEDIATELY after the start
 * command, and again BEFORE each close, this module runs {@link J1_INDEX_HASH_COMMAND} (one more exact string, issued only here) and records
 * the sha256 of that file (`ABSENT` when it does not exist, which is its normal state: the commands remove it on the way out; `SYMLINK`
 * for a link). A close is REFUSED when the two differ (`index_file_changed_between_start_and_close`) or when either could not be read
 * (`index_file_unverified`). Both values are returned by `evidence()`.
 *
 * REAL CHILD PATH: the bash is an absolute pinned path whose sha256 must equal the pin (read through the injected `readFileBytes` at
 * construction), and the child PATH is EXACTLY the bash directory plus the git directory: the parent PATH is never read.
 *
 * SEEDING (at the start of EVERY attempt, before the start command): the three pinned files are re-hashed against their pins, the
 * workspace is emptied (only if it is empty already or carries the bridge's marker; a foreign directory is never wiped), the files are
 * written, `out/normalized.json` is PRE-SEEDED with the placeholder `{}` (the hosted coder can Edit but not Write; prereg addendum B),
 * and the bridge runs git init + the initial commit. The placeholder is the two bytes `{}` with NO trailing newline.
 */

export const J1_PLACEHOLDER = '{}';
export const J1_PLACEHOLDER_SHA256 = createHash('sha256').update(J1_PLACEHOLDER).digest('hex');
export const J1_ARTIFACT_RELATIVE = 'out/normalized.json';
/** Inside .git, so the marker is part of the git tree hash and not of the workspace file list. */
const MARKER = '.git/j1-bridge-workspace';
const SEED_NAMES: readonly string[] = Object.freeze(['data/legacy_ledger.csv', 'data/posts.json', 'format.test.mjs']);
/** D-5: hashes the shared index file. One fixed string; only this module issues it (a caller's copy is refused like any other command). */
export const J1_INDEX_HASH_COMMAND = [
  'if [ -L /tmp/julius-attempt-index ]; then echo SYMLINK;',
  'elif [ -e /tmp/julius-attempt-index ]; then sha256sum < /tmp/julius-attempt-index | cut -d" " -f1;',
  'else echo ABSENT; fi',
].join(' ');
const INDEX_VALUE = /^(ABSENT|SYMLINK|[0-9a-f]{64})$/mu;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 4 * 1024 * 1024;

/** The initial commit, as ONE fixed string with nothing interpolated. */
export const J1_SEED_COMMAND = [
  'set -eu',
  'git init -q',
  'git config user.email j1-bridge@localhost',
  'git config user.name j1-bridge',
  'git config commit.gpgsign false',
  'git add -A -- .',
  'git commit -q -m j1-seed',
  "printf 'SEEDED %s\\n' \"$(git rev-parse HEAD)\"",
].join('\n');

/** What the port observed, for the bundle / ledger. The index hashes are null until the corresponding step has run (or could not be read). */
export interface LocalShellEvidence {
  readonly indexSha256AfterStart: string | null;
  readonly indexSha256BeforeClose: string | null;
  readonly bashSha256: string;
}
export type LocalShellPort = ShellEffectPort & { evidence(): LocalShellEvidence };

export interface J1SeedFile { readonly name: 'data/legacy_ledger.csv' | 'data/posts.json' | 'format.test.mjs'; readonly bytes: Uint8Array; readonly sha256: string }

export interface LocalSpawnResult { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean }
/** Runs `file args` (always `bash -c <command>`); injected. The real one is a child process; tests use a fake. */
export type LocalSpawn = (file: string, args: readonly string[], options: { readonly cwd: string; readonly env: Readonly<Record<string, string>>; readonly timeoutMs: number }) => Promise<LocalSpawnResult>;

/** The directory operations seeding needs; injected. All paths are absolute. */
export interface LocalSeedFs {
  listDir(path: string): readonly string[];
  exists(path: string): boolean;
  removeRecursive(path: string): void;
  mkdirp(path: string): void;
  writeFile(path: string, bytes: Uint8Array): void;
}

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const FAILED = (code: string): ShellEffectResult => ({ status: 'FAILED', exitCode: null, stdout: '', stderr: `refused:${code}`, invocationId: `local:refused:${code}` });

/** True for a POSIX-absolute, drive-absolute or UNC path with no `..` segment. A bare name (which a PATH search would resolve) is false. */
export function isAbsoluteBashPath(p: string): boolean {
  if (!(/^\//u.test(p) || /^[A-Za-z]:[\\/]/u.test(p) || /^\\\\/u.test(p))) return false;
  return !p.split(/[\\/]+/u).includes('..');
}

/** The directory part of an absolute path (either separator). */
const dirOf = (p: string): string => p.replace(/[\\/]+[^\\/]*$/u, '');

export function createLocalShellPort(input: {
  /** The private temp workspace (created by an injected function). Commands run here and seeding writes here. */
  readonly cwd: string;
  /** D-2: the ABSOLUTE path of the bash to run (never found by searching PATH; a bare name is refused at construction). */
  readonly bashPath: string;
  /** Required: the sha256 the bash file must have (JULIUS_J1_BASH_SHA256). Verified at construction through `readFileBytes`. */
  readonly bashSha256: string;
  readonly readFileBytes: (path: string) => Uint8Array;
  /** Required: the ABSOLUTE directory holding git (JULIUS_J1_GIT_DIR); it must exist. The child PATH is bash's directory plus this one. */
  readonly gitDir: string;
  readonly spawn: LocalSpawn;
  readonly fs: LocalSeedFs;
  readonly seedFiles: readonly J1SeedFile[];
  /** Accepted for call-site compatibility and NEVER READ: no parent variable (not even PATH) reaches a child. */
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
}): LocalShellPort {
  const names = input.seedFiles.map((f) => f.name).sort();
  if (names.length !== SEED_NAMES.length || names.some((n, i) => n !== [...SEED_NAMES].sort()[i])) throw new Error('local_shell_seed_names_invalid');
  if (!isAbsoluteBashPath(input.bashPath)) throw new Error('local_shell_bash_path_invalid');
  if (!/^[0-9a-f]{64}$/u.test(input.bashSha256)) throw new Error('local_shell_bash_sha256_invalid');
  let bashBytes: Uint8Array;
  try { bashBytes = input.readFileBytes(input.bashPath); } catch { throw new Error('local_shell_bash_unreadable'); }
  if (sha256(bashBytes) !== input.bashSha256) throw new Error('local_shell_bash_sha256_mismatch');
  if (!isAbsoluteBashPath(input.gitDir)) throw new Error('local_shell_git_dir_invalid');
  if (!input.fs.exists(input.gitDir)) throw new Error('local_shell_git_dir_not_found');
  /* Windows-style bash path (drive or UNC) = ';' separator; POSIX = ':'. */
  const pathSep = /^\//u.test(input.bashPath) ? ':' : ';';
  const childPath = [dirOf(input.bashPath), input.gitDir.replace(/[\\/]+$/u, '')].filter((v, i, a) => a.indexOf(v) === i).join(pathSep);
  const cwd = input.cwd.replace(/[\\/]+$/u, '');
  if (cwd === '') throw new Error('local_shell_cwd_invalid');
  const childEnv: Readonly<Record<string, string>> = Object.freeze({
    PATH: childPath, HOME: `${cwd}.home`, LANG: 'C', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null',
  });
  const START = juliusAttemptStartCommand(null);
  const CLOSE_PLAIN = juliusAttemptCloseCommand(null);
  /** The close command for the trees the last start reported. Null until a start has run. */
  let closeForTrees: string | null = null;
  /** D-5: the index file hashes. Null = not read (yet). */
  let indexAfterStart: string | null = null;
  let indexBeforeClose: string | null = null;
  let counter = 0;
  let chain: Promise<unknown> = Promise.resolve();

  const exec = async (command: string, timeoutMs: number): Promise<ShellEffectResult> => {
    counter += 1;
    const invocationId = `local:${sha256(`${counter}:${command}`).slice(0, 16)}`;
    try {
      const r = await input.spawn(input.bashPath, ['-c', command], { cwd, env: childEnv, timeoutMs: Math.max(1, Math.min(Math.floor(timeoutMs), MAX_TIMEOUT_MS)) });
      return {
        status: r.exitCode === 0 && !r.timedOut ? 'SUCCEEDED' : 'FAILED', exitCode: r.exitCode,
        stdout: r.stdout.slice(0, MAX_OUTPUT_CHARS), stderr: r.stderr.slice(0, MAX_OUTPUT_CHARS), invocationId,
      };
    } catch {
      /* the platform's message names paths and may name more: only a code leaves */
      return { status: 'FAILED', exitCode: null, stdout: '', stderr: 'refused:spawn_failed', invocationId };
    }
  };

  /** The sha256 (or ABSENT / SYMLINK) of the shared index file, or null when it could not be read. */
  const readIndex = async (timeoutMs: number): Promise<string | null> => {
    const r = await exec(J1_INDEX_HASH_COMMAND, timeoutMs);
    if (r.status !== 'SUCCEEDED') return null;
    const m = INDEX_VALUE.exec(r.stdout);
    return m === null ? null : m[1]!;
  };

  /** Returns a refusal code, or null when the workspace was seeded. */
  const seed = async (timeoutMs: number): Promise<string | null> => {
    for (const f of input.seedFiles) if (sha256(f.bytes) !== f.sha256) return 'seed_file_hash_mismatch';
    if (!input.fs.exists(cwd)) input.fs.mkdirp(cwd);
    const entries = input.fs.listDir(cwd);
    if (entries.length > 0 && !input.fs.exists(`${cwd}/${MARKER}`)) return 'workspace_not_bridge_owned';
    for (const entry of entries) input.fs.removeRecursive(`${cwd}/${entry}`);
    /* D-1: the ownership marker goes in FIRST, so a seed that fails part-way leaves a directory the next attempt may reseed. */
    input.fs.mkdirp(`${cwd}/.git`);
    input.fs.writeFile(`${cwd}/${MARKER}`, new Uint8Array(0));
    for (const f of input.seedFiles) {
      const dir = f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/')) : '';
      if (dir !== '') input.fs.mkdirp(`${cwd}/${dir}`);
      input.fs.writeFile(`${cwd}/${f.name}`, f.bytes);
    }
    input.fs.mkdirp(`${cwd}/out`);
    input.fs.writeFile(`${cwd}/${J1_ARTIFACT_RELATIVE}`, new TextEncoder().encode(J1_PLACEHOLDER));
    const r = await exec(J1_SEED_COMMAND, timeoutMs);
    if (r.status !== 'SUCCEEDED' || !/^SEEDED [0-9a-f]{40}$/mu.test(r.stdout)) return 'seed_failed';
    return null;
  };

  const handle = async (request: ShellEffectInput): Promise<ShellEffectResult> => {
    const command = request.command;
    if (command === START) {
      closeForTrees = null; indexAfterStart = null; indexBeforeClose = null;
      const refusal = await seed(request.timeoutMs);
      if (refusal !== null) return FAILED(refusal);
      const r = await exec(START, request.timeoutMs);
      if (r.status === 'SUCCEEDED') {
        const trees = parseJuliusAttemptStart(r.stdout, null);
        if (trees.baseTree !== null && trees.startTree !== null) closeForTrees = juliusAttemptCloseCommand({ baseTree: trees.baseTree, startTree: trees.startTree });
      }
      /* D-5: immediately after the start command, whatever its outcome */
      indexAfterStart = await readIndex(request.timeoutMs);
      return r;
    }
    if (command === CLOSE_PLAIN || (closeForTrees !== null && command === closeForTrees)) {
      indexBeforeClose = await readIndex(request.timeoutMs);
      if (indexAfterStart === null || indexBeforeClose === null) return FAILED('index_file_unverified');
      if (indexAfterStart !== indexBeforeClose) return FAILED('index_file_changed_between_start_and_close');
      return exec(command, request.timeoutMs);
    }
    return FAILED('command_not_allowed');
  };

  return {
    evidence: () => ({ indexSha256AfterStart: indexAfterStart, indexSha256BeforeClose: indexBeforeClose, bashSha256: input.bashSha256 }),
    run(request) {
      /* one command at a time: the seed, the start and the close of an attempt never interleave */
      const next = chain.then(() => handle(request));
      chain = next.then(() => undefined, () => undefined);
      return next;
    },
  };
}
