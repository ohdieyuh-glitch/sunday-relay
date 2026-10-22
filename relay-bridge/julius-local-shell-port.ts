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

export function createLocalShellPort(input: {
  /** The private temp workspace (created by an injected function). Commands run here and seeding writes here. */
  readonly cwd: string;
  readonly spawn: LocalSpawn;
  readonly fs: LocalSeedFs;
  readonly seedFiles: readonly J1SeedFile[];
  /** Only `PATH` is taken from this; nothing else is ever passed to a child. */
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
}): ShellEffectPort {
  const names = input.seedFiles.map((f) => f.name).sort();
  if (names.length !== SEED_NAMES.length || names.some((n, i) => n !== [...SEED_NAMES].sort()[i])) throw new Error('local_shell_seed_names_invalid');
  const cwd = input.cwd.replace(/[\\/]+$/u, '');
  if (cwd === '') throw new Error('local_shell_cwd_invalid');
  const childEnv: Readonly<Record<string, string>> = Object.freeze({
    PATH: input.baseEnv.PATH ?? '', HOME: `${cwd}.home`, LANG: 'C', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null',
  });
  const START = juliusAttemptStartCommand(null);
  const CLOSE_PLAIN = juliusAttemptCloseCommand(null);
  /** The close command for the trees the last start reported. Null until a start has run. */
  let closeForTrees: string | null = null;
  let counter = 0;
  let chain: Promise<unknown> = Promise.resolve();

  const exec = async (command: string, timeoutMs: number): Promise<ShellEffectResult> => {
    counter += 1;
    const invocationId = `local:${sha256(`${counter}:${command}`).slice(0, 16)}`;
    try {
      const r = await input.spawn('bash', ['-c', command], { cwd, env: childEnv, timeoutMs: Math.max(1, Math.min(Math.floor(timeoutMs), MAX_TIMEOUT_MS)) });
      return {
        status: r.exitCode === 0 && !r.timedOut ? 'SUCCEEDED' : 'FAILED', exitCode: r.exitCode,
        stdout: r.stdout.slice(0, MAX_OUTPUT_CHARS), stderr: r.stderr.slice(0, MAX_OUTPUT_CHARS), invocationId,
      };
    } catch {
      /* the platform's message names paths and may name more: only a code leaves */
      return { status: 'FAILED', exitCode: null, stdout: '', stderr: 'refused:spawn_failed', invocationId };
    }
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
      closeForTrees = null;
      const refusal = await seed(request.timeoutMs);
      if (refusal !== null) return FAILED(refusal);
      const r = await exec(START, request.timeoutMs);
      if (r.status === 'SUCCEEDED') {
        const trees = parseJuliusAttemptStart(r.stdout, null);
        if (trees.baseTree !== null && trees.startTree !== null) closeForTrees = juliusAttemptCloseCommand({ baseTree: trees.baseTree, startTree: trees.startTree });
      }
      return r;
    }
    if (command === CLOSE_PLAIN || (closeForTrees !== null && command === closeForTrees)) return exec(command, request.timeoutMs);
    return FAILED('command_not_allowed');
  };

  return {
    run(request) {
      /* one command at a time: the seed, the start and the close of an attempt never interleave */
      const next = chain.then(() => handle(request));
      chain = next.then(() => undefined, () => undefined);
      return next;
    },
  };
}
