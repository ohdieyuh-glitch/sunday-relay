import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';

/**
 * State-root resolution + path safety (Prompt 8.5). Runtime state NEVER
 * lives in the Git repository, Downloads, a temp dir (as the durable
 * default), a provider credential directory, or browser storage.
 *
 * Resolution order: explicit test override → RELAY_STATE_HOME →
 * XDG_STATE_HOME/sunday-relay → ~/.local/state/sunday-relay.
 *
 * Every run reference is validated as a single safe path segment and every
 * resolved run directory must stay inside the canonical state root; symlinked
 * run directories are rejected (never followed).
 */

export const STATE_DIR_NAME = 'sunday-relay';

const FORBIDDEN_ROOT_MARKERS = ['/.codex/', '/.claude/', '/Downloads/'];

export interface StateRootResolution {
  root: string;
  source: 'override' | 'RELAY_STATE_HOME' | 'XDG_STATE_HOME' | 'home_default';
}

export function resolveStateRoot(
  env: Record<string, string | undefined>,
  override?: string,
): RelayResult<StateRootResolution> {
  const candidate: StateRootResolution | null = override
    ? { root: resolve(override), source: 'override' }
    : env.RELAY_STATE_HOME && env.RELAY_STATE_HOME.trim() !== ''
      ? { root: resolve(env.RELAY_STATE_HOME), source: 'RELAY_STATE_HOME' }
      : env.XDG_STATE_HOME && env.XDG_STATE_HOME.trim() !== ''
        ? { root: resolve(env.XDG_STATE_HOME, STATE_DIR_NAME), source: 'XDG_STATE_HOME' }
        : { root: resolve(homedir(), '.local', 'state', STATE_DIR_NAME), source: 'home_default' };
  if (!candidate || !isAbsolute(candidate.root)) {
    return fail(relayError('validation-failed', 'State root must resolve to an absolute path.'));
  }
  const normalized = candidate.root + sep;
  for (const marker of FORBIDDEN_ROOT_MARKERS) {
    if (normalized.includes(marker)) {
      return fail(relayError('permission-denied',
        `State root may not live under a provider credential or download directory (${marker.replaceAll('/', '')}).`));
    }
  }
  // Never a Git repository work tree (env-derived roots only — explicit test
  // overrides always point at isolated temp directories).
  if (candidate.source !== 'override' && existsSync(join(candidate.root, '.git'))) {
    return fail(relayError('permission-denied', 'State root may not be a Git repository work tree.'));
  }
  return ok(candidate);
}

/** Create the root (0o700) and its fixed structure. */
export function ensureStateRoot(root: string): void {
  for (const dir of [root, join(root, 'index'), join(root, 'runs'), join(root, 'workspaces'),
    join(root, 'quarantine'), join(root, 'migrations'), join(root, 'archive'), join(root, 'projects')]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;

/** A run reference must be one safe path segment — no separators, no
 * traversal, no leading dot. */
export function safeRunSegment(reference: string): RelayResult<string> {
  if (typeof reference !== 'string' || !SAFE_SEGMENT.test(reference) || reference === '.' || reference === '..') {
    return fail(relayError('validation-failed', 'Run reference is not a safe identifier.'));
  }
  return ok(reference);
}

/** Resolve a run directory inside `root/<area>/` with containment +
 * symlink rejection. The directory need not exist yet. */
export function resolveRunDir(
  root: string, area: 'runs' | 'archive' | 'quarantine', reference: string,
): RelayResult<string> {
  const segment = safeRunSegment(reference);
  if (!segment.ok) return segment;
  const canonicalRoot = realpathSync(root);
  const dir = join(canonicalRoot, area, segment.value);
  // Containment: the joined path must remain under the canonical root.
  if (!(dir + sep).startsWith(canonicalRoot + sep)) {
    return fail(relayError('permission-denied', 'Run reference escapes the state root.'));
  }
  if (existsSync(dir)) {
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink()) {
      return fail(relayError('permission-denied', 'Run directory is a symlink — refusing to follow it.'));
    }
    const real = realpathSync(dir);
    if (!(real + sep).startsWith(canonicalRoot + sep)) {
      return fail(relayError('permission-denied', 'Run directory resolves outside the state root.'));
    }
  }
  return ok(dir);
}
