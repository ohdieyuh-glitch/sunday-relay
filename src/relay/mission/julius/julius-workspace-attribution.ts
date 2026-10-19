/**
 * WHICH ATTEMPT CHANGED WHAT, AND WHAT WAS ALREADY THERE.
 *
 * One mission has ONE workspace. It is never reset between attempts, so the
 * only change set Julius had — `git status` against HEAD — was the sum of
 * everything every attempt, every repair round and every earlier task had left
 * behind. Attempt 2 of a build was therefore credited with attempt 1's edits,
 * scope was checked against that sum, and an attempt that failed before the
 * capture ran left edits nobody recorded at all: they simply appeared inside
 * the next attempt's diff.
 *
 * THREE TREES, AND THE ATTRIBUTION FALLS OUT OF THEM. The executor writes the
 * working tree into a temporary index and records the tree object it makes —
 * a content-addressed identity for "what the workspace was at that instant",
 * including files git does not track and excluding the ones it ignores:
 *
 *   baseTree   HEAD's tree when the attempt started: the committed state.
 *   startTree  the working tree when the attempt started.
 *   endTree    the working tree when the attempt stopped.
 *
 *   inherited  = baseTree -> startTree   what this attempt found already changed
 *   own        = startTree -> endTree    what THIS attempt changed
 *   cumulative = baseTree -> endTree     what the mission carries now
 *
 * A path can be in `own` and not in `cumulative`: an attempt that put a file
 * back the way HEAD has it changed something and left nothing. That is the
 * point of keeping the three separately rather than subtracting one set from
 * another.
 *
 * UNKNOWN IS NEVER CLEAN. If any snapshot is missing or unreadable the whole
 * record is `captured: false` with empty sets, and {@link juliusWorkspaceCleanliness}
 * answers `UNKNOWN` — never `OBSERVED_CLEAN`. A dirty workspace that could not
 * be read must not pass for one that was read and found empty.
 */

import {
  JULIUS_WORKSPACE_CHANGE_KINDS,
  JULIUS_WORKSPACE_LIMITS,
  type JuliusWorkspaceChange,
  type JuliusWorkspaceChangeKind,
} from './julius-coding-agent';

export const JULIUS_ATTEMPT_WORKSPACE_VERSION = 'julius-attempt-workspace.v1' as const;

/** A git tree object id. Julius interpolates these into executor commands, so nothing else is ever accepted. */
export const isJuliusTreeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);

/**
 * WHAT HAPPENED TO THE EDITS OF AN ATTEMPT JULIUS REFUSED.
 *
 * Julius undoes an attempt's changes in exactly one case: the attempt failed
 * and its own changes broke the locked contract's scope, so nothing of it will
 * ever be reviewed and leaving them means the next attempt inherits edits
 * nobody authorised. It is refused unless the workspace is still exactly as
 * that attempt left it, because anything else would be destroying work whose
 * provenance Julius cannot account for.
 */
export const JULIUS_WORKSPACE_RESTORE_OUTCOMES = [
  'RESTORED',
  /** The workspace is no longer the tree the refused attempt left; nothing was touched. */
  'REFUSED_TREE_MOVED',
  /** The refused attempt recorded no usable snapshot; nothing was touched. */
  'REFUSED_UNKNOWN_SNAPSHOT',
  /** The executor could not carry it out; nothing is claimed about the workspace. */
  'REFUSED_EXECUTOR',
] as const;
export type JuliusWorkspaceRestoreOutcome = (typeof JULIUS_WORKSPACE_RESTORE_OUTCOMES)[number];

export interface JuliusWorkspaceRestore {
  readonly outcome: JuliusWorkspaceRestoreOutcome;
  /** The tree the workspace was to be put back to — the refused attempt's start. */
  readonly toTree: string | null;
  /** The tree the refused attempt left, which the workspace had to still be. */
  readonly expectedTree: string | null;
  /** What the executor actually found. Null when it never got that far. */
  readonly observedTree: string | null;
  /** Paths the refused attempt had added, removed again. */
  readonly removed: number;
  /** Paths the refused attempt had changed or deleted, put back. */
  readonly restored: number;
}

export interface JuliusAttemptWorkspace {
  readonly version: typeof JULIUS_ATTEMPT_WORKSPACE_VERSION;
  /** Every snapshot this record needs arrived and was readable. */
  readonly captured: boolean;
  readonly baseTree: string | null;
  readonly startTree: string | null;
  readonly endTree: string | null;
  /** What THIS attempt changed. */
  readonly own: readonly JuliusWorkspaceChange[];
  /** What it found already changed when it started. */
  readonly inherited: readonly JuliusWorkspaceChange[];
  /** What the workspace carries against HEAD now. */
  readonly cumulative: readonly JuliusWorkspaceChange[];
  readonly truncated: boolean;
  readonly restore: JuliusWorkspaceRestore | null;
}

/** Nothing was observed. Sets are empty because nothing is known, which is not the same as empty. */
export const UNCAPTURED_ATTEMPT_WORKSPACE: JuliusAttemptWorkspace = Object.freeze({
  version: JULIUS_ATTEMPT_WORKSPACE_VERSION,
  captured: false, baseTree: null, startTree: null, endTree: null,
  own: Object.freeze([]), inherited: Object.freeze([]), cumulative: Object.freeze([]),
  truncated: false, restore: null,
});

const SAFE_PATH = /^[^\u0000-\u001f\u007f]+$/u;

/**
 * `git diff --name-status -z A B`, as a change set.
 *
 * The format is NUL-separated fields, not lines: a status field then its path,
 * and for a rename or copy the status carries a similarity score and TWO paths
 * follow. The destination is the change; the source is reported as a deletion,
 * which is what a reviewer reading paths needs to see.
 */
export function parseJuliusTreeDiff(output: string): { readonly changes: readonly JuliusWorkspaceChange[]; readonly truncated: boolean } {
  const fields = output.split('\u0000');
  const changes: JuliusWorkspaceChange[] = [];
  const seen = new Set<string>();
  let truncated = false;
  const push = (path: string, change: JuliusWorkspaceChangeKind): boolean => {
    if (!SAFE_PATH.test(path) || path.length > JULIUS_WORKSPACE_LIMITS.pathChars) return true;
    if (seen.has(path)) return true;
    if (changes.length >= JULIUS_WORKSPACE_LIMITS.paths) { truncated = true; return false; }
    seen.add(path);
    changes.push(Object.freeze({ path, change }));
    return true;
  };
  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index]!.trim();
    if (status === '') continue;
    const letter = status[0]!;
    if (!/^[A-Z]$/u.test(letter)) continue;
    if (letter === 'R' || letter === 'C') {
      const from = fields[index + 1] ?? '';
      const to = fields[index + 2] ?? '';
      index += 2;
      if (from !== '' && letter === 'R' && !push(from, 'DELETED')) break;
      if (to !== '' && !push(to, letter === 'R' ? 'RENAMED' : 'ADDED')) break;
      continue;
    }
    const path = fields[index + 1] ?? '';
    index += 1;
    if (path === '') continue;
    const kind: JuliusWorkspaceChangeKind = letter === 'A' ? 'ADDED'
      : letter === 'D' ? 'DELETED'
        : letter === 'M' || letter === 'T' ? 'MODIFIED'
          : 'OTHER';
    if (!push(path, kind)) break;
  }
  return Object.freeze({ changes: Object.freeze(changes), truncated });
}

const readChanges = (value: unknown): readonly JuliusWorkspaceChange[] | null => {
  if (!Array.isArray(value)) return null;
  const changes: JuliusWorkspaceChange[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== 'string' || !SAFE_PATH.test(entry.path) || entry.path.length > JULIUS_WORKSPACE_LIMITS.pathChars) return null;
    if (typeof entry.change !== 'string' || !(JULIUS_WORKSPACE_CHANGE_KINDS as readonly string[]).includes(entry.change)) return null;
    if (changes.length >= JULIUS_WORKSPACE_LIMITS.paths) break;
    changes.push(Object.freeze({ path: entry.path, change: entry.change as JuliusWorkspaceChangeKind }));
  }
  return Object.freeze(changes);
};

const readRestore = (value: unknown): JuliusWorkspaceRestore | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const outcome = typeof source.outcome === 'string' && (JULIUS_WORKSPACE_RESTORE_OUTCOMES as readonly string[]).includes(source.outcome)
    ? source.outcome as JuliusWorkspaceRestoreOutcome : null;
  if (outcome === null) return null;
  const count = (raw: unknown): number => (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0);
  return Object.freeze({
    outcome,
    toTree: isJuliusTreeId(source.toTree) ? source.toTree : null,
    expectedTree: isJuliusTreeId(source.expectedTree) ? source.expectedTree : null,
    observedTree: isJuliusTreeId(source.observedTree) ? source.observedTree : null,
    removed: count(source.removed),
    restored: count(source.restored),
  });
};

/**
 * REBUILD THE ATTEMPT RECORD FROM AN ALLOWLIST, or report that nothing was
 * observed. An adapter cannot assert `captured` — it is derived here from the
 * three tree ids actually being present and every set being readable.
 */
export function readJuliusAttemptWorkspace(value: unknown): JuliusAttemptWorkspace {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return UNCAPTURED_ATTEMPT_WORKSPACE;
  const source = value as Record<string, unknown>;
  const restore = readRestore(source.restore);
  const baseTree = isJuliusTreeId(source.baseTree) ? source.baseTree : null;
  const startTree = isJuliusTreeId(source.startTree) ? source.startTree : null;
  const endTree = isJuliusTreeId(source.endTree) ? source.endTree : null;
  const own = readChanges(source.own);
  const inherited = readChanges(source.inherited);
  const cumulative = readChanges(source.cumulative);
  if (baseTree === null || startTree === null || endTree === null || own === null || inherited === null || cumulative === null) {
    return restore === null ? UNCAPTURED_ATTEMPT_WORKSPACE : Object.freeze({ ...UNCAPTURED_ATTEMPT_WORKSPACE, restore });
  }
  return Object.freeze({
    version: JULIUS_ATTEMPT_WORKSPACE_VERSION,
    captured: true, baseTree, startTree, endTree, own, inherited, cumulative,
    truncated: source.truncated === true,
    restore,
  });
}

export const JULIUS_WORKSPACE_CLEANLINESS = ['OBSERVED_CLEAN', 'OBSERVED_CHANGED', 'UNKNOWN'] as const;
export type JuliusWorkspaceCleanliness = (typeof JULIUS_WORKSPACE_CLEANLINESS)[number];

/**
 * A WORKSPACE NOBODY COULD READ IS NOT A CLEAN ONE.
 *
 * `captured` is the whole question: the change sets of an unread workspace are
 * empty because nothing is known about it, and an empty set read as "no
 * changes" is how a failed capture came to look like an honest nothing.
 */
export function juliusWorkspaceCleanliness(workspace: {
  readonly captured: boolean;
  readonly changes: readonly JuliusWorkspaceChange[];
}): JuliusWorkspaceCleanliness {
  if (!workspace.captured) return 'UNKNOWN';
  return workspace.changes.length === 0 ? 'OBSERVED_CLEAN' : 'OBSERVED_CHANGED';
}

/**
 * THE SNAPSHOT THE NEXT ATTEMPT MUST UNDO, or null when there is nothing to
 * undo. Julius asks for a restore only when the LAST recorded attempt of this
 * task failed with changes its own contract scope refused: nothing of it will
 * be reviewed, and leaving them makes them the next attempt's inheritance.
 */
export interface JuliusRefusedAttemptSnapshot {
  readonly startTree: string;
  readonly endTree: string;
}

export function juliusRestoreRequestFor(input: {
  readonly lastAttempt: {
    readonly outcome: 'SUCCEEDED' | 'FAILED';
    readonly scopeViolations: number;
    readonly startTree: string | null;
    readonly endTree: string | null;
  } | null;
}): JuliusRefusedAttemptSnapshot | null {
  const attempt = input.lastAttempt;
  if (attempt === null || attempt.outcome !== 'FAILED' || attempt.scopeViolations <= 0) return null;
  if (!isJuliusTreeId(attempt.startTree) || !isJuliusTreeId(attempt.endTree)) return null;
  // Nothing to undo when the attempt left the workspace exactly as it found it.
  if (attempt.startTree === attempt.endTree) return null;
  return Object.freeze({ startTree: attempt.startTree, endTree: attempt.endTree });
}
