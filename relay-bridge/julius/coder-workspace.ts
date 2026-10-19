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

/* ------------------------------------------------------------------ the coder's self-test */

/** Where a self-test runs: a copy, inside the sandbox's own tmpfs, so the live workspace is never written by it. */
const SELF_TEST_COPY = '/tmp/julius-selftest-copy';
/** Where the test's combined output is captured (also in the sandbox's tmpfs), and the bounds on it. */
const SELF_TEST_OUT = '/tmp/julius-selftest-out';
/** A test that prints more than this is stopped and reported as OUTPUT_LIMIT, with no exit code. Well under the 16 MiB /tmp beside a 4 MiB workspace copy. */
export const SELF_TEST_OUTPUT_LIMIT = 4_194_304;
/** The tail of the output the command prints, far below the executor's output cap, so the header before it can never be cut. */
const SELF_TEST_TAIL_BYTES = 16_384;

/**
 * ONE SELF-TEST OF THE CODER'S OWN WORK, as a single executor command.
 *
 * DIAGNOSTIC TELEMETRY, NEVER EVIDENCE. This runs the mission's declared test command so the coder can see its own
 * result mid-session. It records nothing a verification reads: the post-session test run is still the only TEST evidence,
 * and a self-test's result is never a TEST row.
 *
 * WHAT IT DOES, IN ORDER:
 *   1. snapshots the working tree exactly as an attempt's start does (a temporary index in the sandbox's tmpfs; the real
 *      index is never touched) and prints it as `SELFTEST_TREE`, so two self-tests can be told apart by whether the coder
 *      edited between them;
 *   2. copies the workspace into the sandbox's tmpfs and runs the test command THERE. The executor mounts the live
 *      workspace read-write, so a test run in place could leave build output that then appears in the attempt's diff and
 *      in what the attempt is said to have changed; in a copy it cannot;
 *   3. captures the test's combined output in the sandbox's tmpfs (bounded at SELF_TEST_OUTPUT_LIMIT bytes), measures and
 *      hashes the FULL capture THERE, and prints the result as a short HEADER FIRST: `SELFTEST_BYTES`, `SELFTEST_SHA256`
 *      and either `SELFTEST_EXIT <code>` or `SELFTEST_OUTPUT_LIMIT`, then `SELFTEST_OUTPUT_BEGIN` and only a bounded TAIL
 *      of the output. The executor keeps the BEGINNING of what a command prints and drops the rest, so a verdict printed
 *      last is lost by exactly the tests that talk most (Codex review of PR #371, finding 2); a verdict printed first,
 *      over a bounded tail, cannot be cut. It exits with the test's own code.
 * A copy that cannot be made prints `SELFTEST_COPY_FAILED` and runs nothing, rather than falling back to the live directory.
 * The test command goes in its own lines inside a subshell, so a trailing comment in it cannot swallow the closing paren.
 */
export function juliusSelfTestCommand(testCommand: string): string {
  return [
    'set -u',
    SNAPSHOT,
    "printf 'SELFTEST_TREE %s\n' \"$(git write-tree)\"",
    'rm -f "$GIT_INDEX_FILE"; unset GIT_INDEX_FILE',
    `JULIUS_COPY=${SELF_TEST_COPY}; rm -rf "$JULIUS_COPY"; mkdir -p "$JULIUS_COPY"`,
    'if ! cp -a . "$JULIUS_COPY/" 2>/dev/null || ! cd "$JULIUS_COPY"; then printf \'SELFTEST_COPY_FAILED\n\'; exit 90; fi',
    `JULIUS_OUT=${SELF_TEST_OUT}; rm -rf "$JULIUS_OUT"; mkdir -p "$JULIUS_OUT"`,
    // The test's combined output goes to a file, bounded: head closes the pipe at the limit, which stops a test that keeps talking.
    '{',
    '(',
    testCommand,
    ')',
    'echo "$?" > "$JULIUS_OUT/rc"',
    `} 2>&1 | head -c ${String(SELF_TEST_OUTPUT_LIMIT)} > "$JULIUS_OUT/full"`,
    'JULIUS_BYTES=$(wc -c < "$JULIUS_OUT/full" | tr -d \' \')',
    "printf 'SELFTEST_BYTES %s\n' \"$JULIUS_BYTES\"",
    "printf 'SELFTEST_SHA256 %s\n' \"$(sha256sum \"$JULIUS_OUT/full\" | cut -d' ' -f1)\"",
    // At the limit the test was stopped by the closed pipe, so the code in rc is the signal's and not the test's: say so, do not report it.
    `if [ "$JULIUS_BYTES" -ge ${String(SELF_TEST_OUTPUT_LIMIT)} ]; then printf 'SELFTEST_OUTPUT_LIMIT\n'; JULIUS_RC=125; else JULIUS_RC=$(cat "$JULIUS_OUT/rc" 2>/dev/null || echo 125); printf 'SELFTEST_EXIT %s\n' "$JULIUS_RC"; fi`,
    "printf 'SELFTEST_OUTPUT_BEGIN\n'",
    `tail -c ${String(SELF_TEST_TAIL_BYTES)} "$JULIUS_OUT/full"`,
    'exit "$JULIUS_RC"',
  ].join('\n');
}

export interface JuliusSelfTestObserved {
  /** The working tree the test ran against, or null when the snapshot could not be read. */
  readonly treeBefore: string | null;
  /** The test's own exit code, or null when the run never reached it (copy failed, output limit hit, executor cut it off). */
  readonly exitCode: number | null;
  readonly copyFailed: boolean;
  /** The test hit SELF_TEST_OUTPUT_LIMIT and was stopped: its exit code is unknown, never read as a failure or a pass. */
  readonly outputLimit: boolean;
  /** Size and sha256 of the FULL (bounded) capture, measured inside the sandbox; null for an output without the header (executor cut-off, older format). */
  readonly fullOutputBytes: number | null;
  readonly fullOutputSha256: string | null;
  /** The test's own output (the bounded tail in the current format), with Julius's marker lines removed. */
  readonly output: string;
}

const OUTPUT_BEGIN = '\nSELFTEST_OUTPUT_BEGIN\n';

/**
 * Reads one self-test's output. In the current format the verdict lives in a HEADER printed before the output, and only the
 * header is read for markers: a test that prints a line looking like a marker cannot forge its own result. An output
 * without the header (the executor cut it off before the header, or the older trailing-marker format) is still read, with no
 * full-output measurements, so the recorder can tell it from a measured one.
 */
export function parseJuliusSelfTest(stdout: string, stderr: string): JuliusSelfTestObserved {
  const join = (output: string): string => (stderr === '' ? output : `${output}${output.endsWith('\n') || output === '' ? '' : '\n'}${stderr}`);
  const begin = stdout.indexOf(OUTPUT_BEGIN);
  if (begin >= 0) {
    const header = stdout.slice(0, begin + 1);
    const bytes = /^SELFTEST_BYTES (\d+)$/mu.exec(header);
    const sha = /^SELFTEST_SHA256 ([0-9a-f]{64})$/mu.exec(header);
    const exit = /^SELFTEST_EXIT (-?\d+)$/mu.exec(header);
    const outputLimit = /^SELFTEST_OUTPUT_LIMIT$/mu.test(header);
    return Object.freeze({
      treeBefore: TREE_LINE(header, 'SELFTEST_TREE'),
      exitCode: outputLimit || exit === null ? null : Number(exit[1]),
      copyFailed: false,
      outputLimit,
      fullOutputBytes: bytes === null ? null : Number(bytes[1]),
      fullOutputSha256: sha === null ? null : sha[1]!,
      output: join(stdout.slice(begin + OUTPUT_BEGIN.length)),
    });
  }
  const treeBefore = TREE_LINE(stdout, 'SELFTEST_TREE');
  const exit = /^SELFTEST_EXIT (-?\d+)$/mu.exec(stdout);
  const copyFailed = /^SELFTEST_COPY_FAILED$/mu.test(stdout);
  const output = stdout
    .replace(/^SELFTEST_TREE [0-9a-f]{40}\n?/mu, '')
    .replace(/\n?^SELFTEST_EXIT -?\d+\n?$/mu, '')
    .replace(/^SELFTEST_COPY_FAILED\n?/mu, '');
  return Object.freeze({
    treeBefore,
    exitCode: exit === null ? null : Number(exit[1]),
    copyFailed,
    outputLimit: false,
    fullOutputBytes: null,
    fullOutputSha256: null,
    output: join(output),
  });
}
