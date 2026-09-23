/**
 * THE WORKSPACE, AS THE INDEPENDENT EXECUTOR SEES IT, ONE ATTEMPT AT A TIME.
 *
 * Julius has one workspace per mission and never resets it, so `git status`
 * alone says only what the directory holds — not which attempt put it there.
 * These are the two commands that make an attempt's own work identifiable, and
 * the parsers for what they print. They run through the same executor as every
 * other effect: no local shell, no Docker authority here.
 *
 * HOW A SNAPSHOT IS TAKEN. `git add -A` into a TEMPORARY index and `git
 * write-tree` produce a tree object for exactly what the working directory
 * contains — tracked and untracked alike, ignored files excluded, content
 * addressed. The real index is never touched (`GIT_INDEX_FILE` points
 * elsewhere and the file is removed afterwards), so nothing a coder or a
 * reviewer sees changes, and the objects written are unreferenced and
 * collectable. `git status` is run only with the temporary index unset, or it
 * would compare the workspace against the snapshot and report a clean tree.
 *
 * WHAT IS INTERPOLATED. Only values that have already passed
 * {@link isJuliusTreeId} — forty hex characters — ever reach a command string.
 */

import { isJuliusTreeId, parseJuliusTreeDiff, type JuliusWorkspaceRestore } from '../../src/relay/mission/julius/julius-workspace-attribution';
import { parseJuliusWorkspaceStatus, type JuliusWorkspaceChange } from '../../src/relay/mission/julius/julius-coding-agent';

/** Separates the sections of one command's output. NUL-wrapped, so no `-z` path can be mistaken for it. */
const SECTION = '\u0000JULIUS-SECTION-9f2a\u0000';
/** In the sandbox's own tmpfs, which is created fresh for every effect. */
const INDEX = '/tmp/julius-attempt-index';

/**
 * SEEDED FROM THE REPOSITORY'S OWN INDEX, AND NEVER WRITING BACK TO IT.
 *
 * `git add -A` into an EMPTY index rehashes every file in the workspace; copied
 * from the real index first, it is a stat pass over unchanged files and reads
 * only what actually differs — which is what keeps an attempt's two snapshots
 * inside the executor's step bound on a repository of any size. The copy is
 * read-only on the original: the staging state a coder or a reviewer sees is
 * untouched, and the temporary file is removed on the way out. A workspace
 * whose index cannot be copied still snapshots correctly, only more slowly.
 */
const SNAPSHOT = [
  `GIT_INDEX_FILE=${INDEX}; export GIT_INDEX_FILE; rm -f "$GIT_INDEX_FILE"`,
  'JULIUS_GIT_DIR=$(git rev-parse --git-dir 2>/dev/null || echo .git)',
  'cp "$JULIUS_GIT_DIR/index" "$GIT_INDEX_FILE" 2>/dev/null || true',
  'git add -A -- . >/dev/null 2>&1',
].join('\n');

/**
 * THE START OF AN ATTEMPT: the commit it starts from, the committed tree, and
 * the working tree as it stands — after undoing a refused attempt's edits, when
 * Julius asked for that.
 */
export function juliusAttemptStartCommand(restore: { readonly toTree: string; readonly expectedTree: string } | null): string {
  const lines = [
    'set -u',
    SNAPSHOT,
    'CUR=$(git write-tree)',
  ];
  if (restore !== null && isJuliusTreeId(restore.toTree) && isJuliusTreeId(restore.expectedTree)) {
    lines.push(
      // ONLY IF THE WORKSPACE IS STILL EXACTLY WHAT THE REFUSED ATTEMPT LEFT.
      `if [ "$CUR" = "${restore.expectedTree}" ]; then`,
      `  rm -f "$GIT_INDEX_FILE"; git read-tree ${restore.toTree}`,
      `  ADDED=$(git diff --name-only --diff-filter=A -z ${restore.toTree} "$CUR" | tr -cd '\\000' | wc -c)`,
      `  git diff --name-only --diff-filter=A -z ${restore.toTree} "$CUR" | xargs -0 -r rm -f --`,
      `  PUT=$(git diff --name-only --diff-filter=DMT -z ${restore.toTree} "$CUR" | tr -cd '\\000' | wc -c)`,
      `  git diff --name-only --diff-filter=DMT -z ${restore.toTree} "$CUR" | xargs -0 -r git checkout-index -f -u --`,
      '  rm -f "$GIT_INDEX_FILE"; git add -A -- . >/dev/null 2>&1; CUR=$(git write-tree)',
      '  printf \'RESTORE RESTORED %s %s\\n\' "$ADDED" "$PUT"',
      'else',
      '  printf \'RESTORE REFUSED_TREE_MOVED\\n\'',
      'fi',
    );
  } else {
    lines.push("printf 'RESTORE NONE\\n'");
  }
  lines.push(
    'rm -f "$GIT_INDEX_FILE"; unset GIT_INDEX_FILE',
    "printf 'HEAD %s\\n' \"$(git rev-parse HEAD)\"",
    "printf 'BASE %s\\n' \"$(git rev-parse 'HEAD^{tree}')\"",
    'printf \'START %s\\n\' "$CUR"',
  );
  return lines.join('\n');
}

export interface JuliusAttemptStart {
  readonly headRevision: string | null;
  readonly baseTree: string | null;
  readonly startTree: string | null;
  readonly restore: JuliusWorkspaceRestore | null;
}

const TREE_LINE = (output: string, key: string): string | null => {
  const found = new RegExp(`^${key} ([0-9a-f]{40})$`, 'mu').exec(output);
  return found === null ? null : found[1]!;
};

export function parseJuliusAttemptStart(output: string, requested: { readonly toTree: string; readonly expectedTree: string } | null): JuliusAttemptStart {
  const head = /^HEAD ([0-9a-f]{40})$/mu.exec(output);
  const restored = /^RESTORE RESTORED (\d+) (\d+)$/mu.exec(output);
  const startTree = TREE_LINE(output, 'START');
  const restore: JuliusWorkspaceRestore | null = requested === null ? null : Object.freeze({
    outcome: restored !== null ? 'RESTORED' as const
      : /^RESTORE REFUSED_TREE_MOVED$/mu.test(output) ? 'REFUSED_TREE_MOVED' as const
        : 'REFUSED_EXECUTOR' as const,
    toTree: requested.toTree,
    expectedTree: requested.expectedTree,
    observedTree: startTree,
    removed: restored === null ? 0 : Number(restored[1]),
    restored: restored === null ? 0 : Number(restored[2]),
  });
  return Object.freeze({
    headRevision: head === null ? null : head[1]!,
    baseTree: TREE_LINE(output, 'BASE'),
    startTree,
    restore,
  });
}

/**
 * THE END OF AN ATTEMPT, in one consistent look at the workspace: the tree it
 * leaves, the change set against HEAD that the contract is checked from, and
 * the three tree diffs that say who changed what.
 *
 * With no start snapshot to compare against, this is the change set alone —
 * exactly what the dispatch captured before attribution existed — and the
 * attempt record reports itself uncaptured rather than guessing.
 */
export function juliusAttemptCloseCommand(start: { readonly baseTree: string; readonly startTree: string } | null): string {
  const status = "git status --porcelain=v1 --untracked-files=all -z";
  if (start === null || !isJuliusTreeId(start.baseTree) || !isJuliusTreeId(start.startTree)) return status;
  return [
    'set -u',
    SNAPSHOT,
    'END=$(git write-tree)',
    'rm -f "$GIT_INDEX_FILE"; unset GIT_INDEX_FILE',
    'printf \'END %s\\n\' "$END"',
    `printf '${SECTION.replaceAll('\u0000', '\\000')}'`,
    status,
    `printf '${SECTION.replaceAll('\u0000', '\\000')}'`,
    `git diff --name-status -z ${start.startTree} "$END"`,
    `printf '${SECTION.replaceAll('\u0000', '\\000')}'`,
    `git diff --name-status -z ${start.baseTree} ${start.startTree}`,
    `printf '${SECTION.replaceAll('\u0000', '\\000')}'`,
    `git diff --name-status -z ${start.baseTree} "$END"`,
  ].join('\n');
}

export interface JuliusAttemptClose {
  /** The change set against HEAD — what the contract is checked from, and what the reviewer is told about. */
  readonly status: { readonly captured: boolean; readonly changes: readonly JuliusWorkspaceChange[]; readonly truncated: boolean };
  readonly endTree: string | null;
  readonly own: readonly JuliusWorkspaceChange[] | null;
  readonly inherited: readonly JuliusWorkspaceChange[] | null;
  readonly cumulative: readonly JuliusWorkspaceChange[] | null;
  readonly truncated: boolean;
}

export function parseJuliusAttemptClose(output: string, captured: boolean): JuliusAttemptClose {
  if (!captured) {
    return Object.freeze({ status: { captured: false, changes: [], truncated: false }, endTree: null, own: null, inherited: null, cumulative: null, truncated: false });
  }
  const sections = output.split(SECTION);
  if (sections.length < 5) {
    // The plain change-set command, or an output Julius cannot read as an attempt.
    const status = parseJuliusWorkspaceStatus(output);
    return Object.freeze({ status: { captured: true, ...status }, endTree: null, own: null, inherited: null, cumulative: null, truncated: status.truncated });
  }
  const endTree = TREE_LINE(sections[0]!, 'END');
  const status = parseJuliusWorkspaceStatus(sections[1]!);
  const own = parseJuliusTreeDiff(sections[2]!);
  const inherited = parseJuliusTreeDiff(sections[3]!);
  const cumulative = parseJuliusTreeDiff(sections[4]!);
  return Object.freeze({
    status: { captured: true, changes: status.changes, truncated: status.truncated },
    endTree,
    own: own.changes, inherited: inherited.changes, cumulative: cumulative.changes,
    truncated: status.truncated || own.truncated || inherited.truncated || cumulative.truncated,
  });
}
