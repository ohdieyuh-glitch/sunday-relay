import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';

/**
 * Repository inspection (Prompt 7) — the ONLY sanctioned Git surface for
 * workspace infrastructure. Every invocation uses the fixed `git`
 * executable with explicit argument arrays, `shell: false` (execFileSync
 * never spawns a shell), a validated absolute cwd, bounded output, and a
 * hard timeout. No push, merge, reset, clean, force, config, or remote
 * access exists anywhere in this module.
 */

const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

/** Minimal environment for infrastructure git calls: PATH resolution only,
 * plus explicit identity overrides for fixture use. Never provider vars. */
const gitEnv = (extra: Record<string, string> = {}): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'TMPDIR']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, GIT_TERMINAL_PROMPT: '0', ...extra };
};

export function runGit(args: string[], cwd: string, extraEnv: Record<string, string> = {}): RelayResult<string> {
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.includes('\0')) {
      return fail(relayError('validation-failed', 'Git argument rejected (null byte or non-string).'));
    }
  }
  if (!isAbsolute(cwd)) return fail(relayError('validation-failed', 'Git cwd must be absolute.'));
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      env: gitEnv(extraEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return ok(stdout);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 300) : 'unknown git failure';
    return fail(relayError('validation-failed', `git ${args[0] ?? ''} failed.`, { details: [detail] }));
  }
}

/** Validate and canonicalize a source repository path. Rejects traversal
 * products, non-directories, symlinked roots that escape, and non-repos.
 * Returns the realpath repository ROOT (toplevel). */
export function validateSourceRepository(rawPath: string): RelayResult<{ root: string }> {
  if (typeof rawPath !== 'string' || rawPath.trim() === '' || rawPath.includes('\0')) {
    return fail(relayError('validation-failed', 'Repository path must be a non-empty string without null bytes.'));
  }
  const resolved = resolve(rawPath);
  if (!existsSync(resolved)) return fail(relayError('not-found', 'Repository path does not exist.'));
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    return fail(relayError('validation-failed', 'Repository path cannot be canonicalized.'));
  }
  if (!lstatSync(real).isDirectory()) {
    return fail(relayError('validation-failed', 'Repository path is not a directory.'));
  }
  const toplevel = runGit(['rev-parse', '--show-toplevel'], real);
  if (!toplevel.ok) return fail(relayError('validation-failed', 'Path is not inside a Git repository.'));
  let root: string;
  try {
    root = realpathSync(toplevel.value.trim());
  } catch {
    return fail(relayError('validation-failed', 'Repository root cannot be canonicalized.'));
  }
  if (root !== real) {
    return fail(relayError('validation-failed', 'Path must be the repository root, not a subdirectory.'));
  }
  return ok({ root });
}

export interface RepositoryState {
  revision: string;
  branch: string;
  dirty: boolean;
  statusEntries: Array<{ code: string; path: string }>;
  conflicted: boolean;
}

/** Parse `git status --porcelain=v1 -z` (machine-readable; never localized
 * human output). Rename/copy entries carry a second NUL-separated token. */
export function parseStatusZ(raw: string): Array<{ code: string; path: string }> {
  const entries: Array<{ code: string; path: string }> = [];
  const tokens = raw.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '') continue;
    const code = token.slice(0, 2);
    const path = token.slice(3);
    entries.push({ code, path });
    if (code[0] === 'R' || code[0] === 'C') i += 1; // skip the "from" path
  }
  return entries;
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

export function inspectRepositoryState(root: string): RelayResult<RepositoryState> {
  const revision = runGit(['rev-parse', 'HEAD'], root);
  if (!revision.ok) return revision;
  const branch = runGit(['branch', '--show-current'], root);
  if (!branch.ok) return branch;
  const status = runGit(['status', '--porcelain=v1', '-z'], root);
  if (!status.ok) return status;
  const statusEntries = parseStatusZ(status.value);
  return ok({
    revision: revision.value.trim(),
    branch: branch.value.trim() || '(detached)',
    dirty: statusEntries.length > 0,
    statusEntries,
    conflicted: statusEntries.some((e) => CONFLICT_CODES.has(e.code)),
  });
}

/** Changed + untracked paths in a worktree relative to its pinned base. */
export function listWorktreeChanges(root: string): RelayResult<{ changed: string[]; untracked: string[]; conflicted: boolean }> {
  const state = inspectRepositoryState(root);
  if (!state.ok) return state;
  const changed: string[] = [];
  const untracked: string[] = [];
  for (const entry of state.value.statusEntries) {
    if (entry.code === '??') untracked.push(entry.path);
    else changed.push(entry.path);
  }
  return ok({ changed, untracked, conflicted: state.value.conflicted });
}
