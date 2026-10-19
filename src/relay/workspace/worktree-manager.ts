import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { runGit } from './repository-inspector';

/**
 * Worktree lifecycle (Prompt 7). Real `git worktree` operations, confined
 * to the approved Relay workspace root beside the source repository:
 *
 *   <realpath(parent-of-source)>/.relay-workspaces/<project-id>/<run-id>/
 *
 * The root is created 0o700, must never be a symlink, and every created
 * path is verified by realpath containment before use. The source worktree
 * is never touched: creation adds a NEW worktree at the pinned revision on
 * a run-specific branch, and removal targets only Relay-created paths.
 */

export const WORKSPACE_ROOT_DIRNAME = '.relay-workspaces';

/** Conservative branch-name validation (subset of git-check-ref-format).
 * Rejects injection shapes outright: options (`-`), traversal, `@{`,
 * spaces, control chars, lock suffixes, empty segments. */
export function validateBranchName(name: string): RelayResult<string> {
  if (typeof name !== 'string' || name.length === 0 || name.length > 100) {
    return fail(relayError('validation-failed', 'Branch name must be 1–100 chars.'));
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) {
    return fail(relayError('validation-failed', 'Branch name contains rejected characters.'));
  }
  if (name.includes('..') || name.includes('//') || name.includes('@{') ||
      name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock') ||
      name.split('/').some((seg) => seg === '' || seg === '.' || seg === '..' ||
        seg.startsWith('-') || seg.endsWith('.lock'))) {
    return fail(relayError('validation-failed', 'Branch name shape is rejected.'));
  }
  return ok(name);
}

/** Deterministic run-specific branch: relay/run/<sanitized-run-token>. */
export function deriveRunBranch(runId: string): RelayResult<string> {
  const token = runId.replace(/^run_/, '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
  if (token.length === 0) return fail(relayError('validation-failed', 'Run id yields no safe branch token.'));
  return validateBranchName(`relay/run/${token}`);
}

const safePathSegment = (raw: string): RelayResult<string> => {
  const token = raw.replace(/[^A-Za-z0-9._-]/g, '');
  if (token === '' || token === '.' || token === '..') {
    return fail(relayError('validation-failed', `"${raw}" yields no safe path segment.`));
  }
  return ok(token);
};

/** Resolve (and create) the approved workspace root for a source repo.
 * Never inside the source tree; never behind a symlink. */
export function resolveWorkspaceRoot(sourceRoot: string): RelayResult<string> {
  const parent = dirname(sourceRoot);
  let parentReal: string;
  try {
    parentReal = realpathSync(parent);
  } catch {
    return fail(relayError('validation-failed', 'Workspace root parent cannot be canonicalized.'));
  }
  const root = join(parentReal, WORKSPACE_ROOT_DIRNAME);
  if (existsSync(root)) {
    if (lstatSync(root).isSymbolicLink()) {
      return fail(relayError('permission-denied', 'Workspace root is a symlink — refused.'));
    }
    if (!lstatSync(root).isDirectory()) {
      return fail(relayError('validation-failed', 'Workspace root exists but is not a directory.'));
    }
  } else {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  const rootReal = realpathSync(root);
  if (rootReal === sourceRoot || rootReal.startsWith(sourceRoot + sep)) {
    return fail(relayError('permission-denied', 'Workspace root may not live inside the source repository.'));
  }
  return ok(rootReal);
}

/** Compute the per-run worktree path under the approved root. */
export function resolveWorkspacePath(root: string, projectId: string, runId: string): RelayResult<string> {
  const project = safePathSegment(projectId);
  if (!project.ok) return project;
  const run = safePathSegment(runId);
  if (!run.ok) return run;
  const path = join(root, project.value, run.value);
  if (!path.startsWith(root + sep)) {
    return fail(relayError('permission-denied', 'Workspace path escapes the approved root.'));
  }
  return ok(path);
}

export interface CreatedWorktree {
  workspacePath: string;
  branchName: string;
  revision: string;
}

/** Create the isolated worktree at the pinned revision on a new branch,
 * then verify it points at the expected repository and revision. */
export function createWorktree(input: {
  sourceRoot: string;
  workspacePath: string;
  branchName: string;
  revision: string;
}): RelayResult<CreatedWorktree> {
  const { sourceRoot, workspacePath, branchName, revision } = input;
  if (!isAbsolute(workspacePath)) return fail(relayError('validation-failed', 'Workspace path must be absolute.'));
  if (existsSync(workspacePath)) {
    return fail(relayError('duplicate-command', 'Workspace path already exists — refusing to reuse an unregistered directory.'));
  }
  if (!/^[0-9a-f]{7,40}$/i.test(revision)) {
    return fail(relayError('validation-failed', 'Revision must be a commit hash.'));
  }
  const branchExists = runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`], sourceRoot);
  if (branchExists.ok && branchExists.value.trim() !== '') {
    return fail(relayError('duplicate-command', `Branch ${branchName} already exists — refusing reuse.`));
  }
  mkdirSync(dirname(workspacePath), { recursive: true, mode: 0o700 });
  const added = runGit(['worktree', 'add', '-b', branchName, workspacePath, revision], sourceRoot);
  if (!added.ok) return added;

  /* verify: correct repo, revision, branch */
  const head = runGit(['rev-parse', 'HEAD'], workspacePath);
  if (!head.ok) return head;
  const branch = runGit(['branch', '--show-current'], workspacePath);
  if (!branch.ok) return branch;
  const commonDir = runGit(['rev-parse', '--git-common-dir'], workspacePath);
  if (!commonDir.ok) return commonDir;
  const sourceGitDir = realpathSync(join(sourceRoot, '.git'));
  const linkedCommon = realpathSync(commonDir.value.trim());
  if (head.value.trim() !== revision || branch.value.trim() !== branchName || linkedCommon !== sourceGitDir) {
    return fail(
      relayError('validation-failed', 'Created worktree failed verification (repo/revision/branch mismatch).', {
        details: [`head=${head.value.trim()}`, `branch=${branch.value.trim()}`],
      }),
    );
  }
  return ok({ workspacePath, branchName, revision });
}

/** Remove a Relay-created worktree (never forced, never the source). The
 * caller has already validated registration and identity. */
export function removeWorktree(sourceRoot: string, workspacePath: string): RelayResult<null> {
  let real: string;
  try {
    real = realpathSync(workspacePath);
  } catch {
    return fail(relayError('not-found', 'Workspace path no longer exists.'));
  }
  if (real === sourceRoot) return fail(relayError('permission-denied', 'Refusing to remove the source worktree.'));
  const removed = runGit(['worktree', 'remove', workspacePath], sourceRoot);
  if (!removed.ok) return removed;
  if (existsSync(workspacePath)) {
    return fail(relayError('validation-failed', 'Worktree removal reported success but the path remains.'));
  }
  return ok(null);
}
