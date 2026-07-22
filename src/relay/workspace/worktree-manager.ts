import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { inspectSourceRepository, isWithin, runGit, type SourceRepositoryInfo } from './repository-inspector';

/**
 * Isolated worktree creation (Prompt 7). Real `git worktree add` against a
 * pinned revision, into an approved workspace root OUTSIDE any tracked
 * tree, on a run-specific validated branch. The source working tree is
 * never reset, cleaned, checked out, committed, merged, or pushed — Git
 * only records worktree bookkeeping inside the source `.git` directory,
 * which is inherent to worktrees and documented.
 */

/** Git branch-name validation — allowlist shape, never `git check-ref-format`
 * on untrusted input (no process launch for validation). */
export function validateBranchName(name: string): RelayResult<string> {
  if (typeof name !== 'string' || name.trim() === '') {
    return fail(relayError('validation-failed', 'Branch name must be a non-empty string.'));
  }
  if (name.length > 200) return fail(relayError('validation-failed', 'Branch name is too long.'));
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) {
    return fail(relayError('validation-failed', 'Branch name contains characters outside the safe allowlist.'));
  }
  if (name.includes('..') || name.includes('//') || name.includes('@{')) {
    return fail(relayError('validation-failed', 'Branch name contains a forbidden sequence.'));
  }
  if (name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) {
    return fail(relayError('validation-failed', 'Branch name has a forbidden ending.'));
  }
  if (name.split('/').some((segment) => segment === '' || segment.startsWith('-'))) {
    return fail(relayError('validation-failed', 'Branch segments must be non-empty and must not start with "-".'));
  }
  return ok(name);
}

/** Deterministic default branch for a run: relay/run/<safe-run-token>. */
export function defaultBranchForRun(runId: string): string {
  const token = runId.replace(/^run_/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'unnamed';
  return `relay/run/${token}`;
}

/** Conventional approved root: a sibling of the source repository, never
 * inside any tracked tree. Callers may override (tests use tmp roots). */
export const defaultWorkspaceRootFor = (sourceRootPath: string): string =>
  join(dirname(sourceRootPath), '.relay-workspaces');

export interface ApprovedRootValidation {
  rootRealPath: string;
}

/** Validate (and create if needed) the approved workspace root: absolute,
 * not a symlink, and disjoint from the source repository in both
 * directions. */
export function ensureApprovedRoot(rawRoot: string, sourceRootRealPath: string): RelayResult<ApprovedRootValidation> {
  if (typeof rawRoot !== 'string' || rawRoot.includes('\0') || !isAbsolute(rawRoot)) {
    return fail(relayError('validation-failed', 'Workspace root must be an absolute path without null bytes.'));
  }
  if (existsSync(rawRoot) && lstatSync(rawRoot).isSymbolicLink()) {
    return fail(relayError('validation-failed', 'Workspace root must not be a symlink.'));
  }
  try {
    mkdirSync(rawRoot, { recursive: true, mode: 0o700 });
  } catch {
    return fail(relayError('validation-failed', 'Workspace root could not be created.'));
  }
  const rootRealPath = realpathSync(rawRoot);
  if (isWithin(sourceRootRealPath, rootRealPath)) {
    return fail(relayError('validation-failed', 'Workspace root must not live inside the source repository.'));
  }
  if (isWithin(rootRealPath, sourceRootRealPath)) {
    return fail(relayError('validation-failed', 'The source repository must not live inside the workspace root.'));
  }
  return ok({ rootRealPath });
}

const PATH_TOKEN = /^[A-Za-z0-9_-]+$/;

export interface CreateWorktreeInput {
  source: SourceRepositoryInfo;
  rootRealPath: string;
  /** Path tokens under the root — validated (prefixed relay ids qualify). */
  projectToken: string;
  runToken: string;
  taskToken: string;
  branchName: string;
}

export interface CreatedWorktree {
  workspacePath: string;
  workspaceRealPath: string;
}

export function branchExists(sourceRoot: string, branchName: string): boolean {
  return runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`], sourceRoot).ok;
}

/** Create the isolated worktree and verify it points at the expected
 * repository, revision, and branch before reporting success. */
export function createWorktree(input: CreateWorktreeInput): RelayResult<CreatedWorktree> {
  const { source, rootRealPath, branchName } = input;
  for (const token of [input.projectToken, input.runToken, input.taskToken]) {
    if (!PATH_TOKEN.test(token.replace(/^[a-z]{3}_/, ''))) {
      return fail(relayError('validation-failed', `Workspace path token "${token}" is not path-safe.`));
    }
  }
  const workspacePath = join(rootRealPath, input.projectToken, input.runToken, input.taskToken);
  if (!isWithin(rootRealPath, workspacePath)) {
    return fail(relayError('validation-failed', 'Workspace path escaped the approved root.'));
  }
  if (existsSync(workspacePath)) {
    return fail(relayError('duplicate-task', 'Workspace path already exists — conflicting reuse is refused.'));
  }
  if (branchExists(source.rootPath, branchName)) {
    return fail(relayError('duplicate-task', `Branch "${branchName}" already exists — it cannot be reused for a new workspace.`));
  }
  mkdirSync(dirname(workspacePath), { recursive: true, mode: 0o700 });

  const added = runGit(['worktree', 'add', '-b', branchName, workspacePath, source.revision], source.rootPath);
  if (!added.ok) {
    return fail(relayError('validation-failed', 'git worktree add failed.', { details: [added.stderr.slice(0, 300)] }));
  }

  /* verify before trusting */
  const workspaceRealPath = realpathSync(workspacePath);
  const head = runGit(['rev-parse', 'HEAD'], workspaceRealPath);
  const ref = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], workspaceRealPath);
  const common = runGit(['rev-parse', '--git-common-dir'], workspaceRealPath);
  // --git-common-dir may return an absolute path or one relative to cwd.
  const commonRaw = common.stdout.trim();
  const commonReal = common.ok
    ? realpathSync(isAbsolute(commonRaw) ? commonRaw : join(workspaceRealPath, commonRaw))
    : '';
  const pointsAtSource = common.ok && isWithin(source.rootPath, commonReal);
  if (!head.ok || head.stdout.trim() !== source.revision) {
    return fail(relayError('validation-failed', 'Created worktree does not point at the pinned revision.'));
  }
  if (!ref.ok || ref.stdout.trim() !== branchName) {
    return fail(relayError('validation-failed', 'Created worktree is not on the expected branch.'));
  }
  if (!pointsAtSource) {
    return fail(relayError('validation-failed', 'Created worktree does not belong to the expected repository.'));
  }
  return ok({ workspacePath, workspaceRealPath });
}

/** Remove a Relay-created worktree. Never forced: a dirty worktree makes
 * removal fail honestly rather than destroying changes. */
export function removeWorktree(sourceRoot: string, workspacePath: string): RelayResult<null> {
  const removed = runGit(['worktree', 'remove', workspacePath], sourceRoot);
  if (!removed.ok) {
    return fail(relayError('validation-failed', 'git worktree remove failed (dirty worktrees are never force-removed).', { details: [removed.stderr.slice(0, 300)] }));
  }
  return ok(null);
}

export { inspectSourceRepository };
