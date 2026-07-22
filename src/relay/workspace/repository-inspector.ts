import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';

/**
 * Repository inspection (Prompt 7) — the ONLY sanctioned Git surface for
 * workspace infrastructure. Every invocation uses the fixed `git`
 * executable with explicit argument arrays, `shell: false` (execFileSync
 * never spawns a shell), a validated working directory, bounded runtime and
 * output, and a minimal environment (no credentials, no terminal prompts).
 * Local-only plumbing commands; push/fetch/reset/clean/merge never appear
 * here and are policy-denied everywhere else.
 */

const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

/** Minimal git environment: PATH/HOME only, prompts disabled, stable C
 * locale for machine parsing. Provider credentials are never inherited. */
function gitEnvironment(): Record<string, string> {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LANG: 'C',
    LC_ALL: 'C',
  };
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.HOME) env.HOME = process.env.HOME;
  return env;
}

export interface GitInvocation {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** Run one bounded local git command. Never throws; never uses a shell. */
export function runGit(args: string[], cwd: string): GitInvocation {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      env: gitEnvironment(),
      // Capture stderr — never stream git chatter to the parent terminal.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const failure = err as { status?: number | null; stdout?: unknown; stderr?: unknown; message?: string };
    const text = (value: unknown) => (typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : '');
    return {
      ok: false,
      stdout: text(failure.stdout),
      stderr: text(failure.stderr) || failure.message || 'git invocation failed',
      exitCode: typeof failure.status === 'number' ? failure.status : null,
    };
  }
}

export interface SourceRepositoryInfo {
  /** Canonical realpath of the repository working-tree root. */
  rootPath: string;
  revision: string;
  /** '(detached)' when HEAD is not on a branch. */
  branch: string;
  dirty: boolean;
}

/** Validate a source path as a usable non-bare Git repository and pin its
 * identity. Rejects hostile shapes, non-repositories, bare repositories,
 * and unborn (commitless) repositories. */
export function inspectSourceRepository(rawPath: string): RelayResult<SourceRepositoryInfo> {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    return fail(relayError('validation-failed', 'Source repository path must be a non-empty string.'));
  }
  if (rawPath.includes('\0')) {
    return fail(relayError('validation-failed', 'Source repository path contains a null byte.'));
  }
  const resolved = resolve(rawPath);
  if (!existsSync(resolved)) {
    return fail(relayError('not-found', 'Source repository path does not exist.'));
  }
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    return fail(relayError('validation-failed', 'Source repository path cannot be resolved.'));
  }
  if (!lstatSync(real).isDirectory()) {
    return fail(relayError('validation-failed', 'Source repository path is not a directory.'));
  }

  const bare = runGit(['rev-parse', '--is-bare-repository'], real);
  if (!bare.ok) {
    return fail(relayError('validation-failed', 'Path is not inside a Git repository.', { details: [bare.stderr.slice(0, 200)] }));
  }
  if (bare.stdout.trim() !== 'false') {
    return fail(relayError('validation-failed', 'Bare repositories are not supported as workspace sources.'));
  }

  const toplevel = runGit(['rev-parse', '--show-toplevel'], real);
  if (!toplevel.ok || toplevel.stdout.trim() === '') {
    return fail(relayError('validation-failed', 'Unable to resolve the repository root.'));
  }
  const rootPath = realpathSync(toplevel.stdout.trim());

  const head = runGit(['rev-parse', 'HEAD'], rootPath);
  if (!head.ok) {
    return fail(relayError('validation-failed', 'Repository has no commits (unborn HEAD) — unsupported state for workspace creation.'));
  }
  const revision = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    return fail(relayError('validation-failed', 'Repository HEAD did not resolve to a full revision.'));
  }

  const branchProbe = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], rootPath);
  const branchName = branchProbe.ok ? branchProbe.stdout.trim() : 'HEAD';
  const branch = branchName === 'HEAD' ? '(detached)' : branchName;

  const status = runGit(['status', '--porcelain'], rootPath);
  if (!status.ok) {
    return fail(relayError('validation-failed', 'Repository status could not be inspected.'));
  }

  return ok({ rootPath, revision, branch, dirty: status.stdout.trim() !== '' });
}

/** Machine-readable status of one working tree (NUL-separated porcelain). */
export interface WorkingTreeStatus {
  changedFiles: string[];
  untrackedFiles: string[];
  conflicted: boolean;
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

export function readWorkingTreeStatus(worktreePath: string): RelayResult<WorkingTreeStatus> {
  const status = runGit(['status', '--porcelain', '-z'], worktreePath);
  if (!status.ok) {
    return fail(relayError('validation-failed', 'Working-tree status could not be inspected.', { details: [status.stderr.slice(0, 200)] }));
  }
  const changedFiles: string[] = [];
  const untrackedFiles: string[] = [];
  let conflicted = false;
  const entries = status.stdout.split('\0').filter((entry) => entry !== '');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (CONFLICT_CODES.has(code)) conflicted = true;
    if (code === '??') untrackedFiles.push(path);
    else changedFiles.push(path);
    // Rename/copy entries carry the ORIGINAL path as the next NUL token.
    if (code[0] === 'R' || code[0] === 'C') i += 1;
  }
  return ok({ changedFiles, untrackedFiles, conflicted });
}

export const isWithin = (parent: string, child: string): boolean =>
  child === parent || child.startsWith(parent + sep);
