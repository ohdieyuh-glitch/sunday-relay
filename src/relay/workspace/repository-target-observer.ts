/**
 * OBSERVING A REAL REPOSITORY, AND WRITING TO ONE (Node only).
 *
 * This is the layer that makes `repository-target/` about a real repository
 * rather than about a policy. Two responsibilities, deliberately kept apart:
 *
 *   - **Observation.** Read what the worktree ACTUALLY contains after the agent
 *     exits, and hand it to `judgeObservedDiff` as an `ObservedDiff`. The
 *     agent's account of what it touched never enters this module — its input is
 *     a worktree path, and there is no parameter through which a claim could
 *     arrive.
 *   - **Writing.** Commit exactly the paths the judgement approved, on the
 *     working branch, after proving it is not the base branch and not protected.
 *
 * WHAT IS REUSED RATHER THAN REBUILT, because in this repository the milestone
 * that begins "implement X" almost always finds a substantial X already present:
 *
 *   - `repository-inspector.ts` — `runGit`, `validateSourceRepository`,
 *     `inspectRepositoryState`, `parseStatusZ`. The only sanctioned git surface.
 *   - `worktree-manager.ts` / `mission-worktree.ts` — real `git worktree
 *     add/remove`, containment under `.relay-workspaces`, adoption after a
 *     restart, and the eight restart validations.
 *
 * THE CREDENTIAL IS NOT HERE, AND NEITHER IS THE REMOTE. Nothing in this file
 * fetches, pushes, opens a pull request or merges one. `runGit` passes a fixed
 * environment with no provider variables, so a git invocation from here cannot
 * authenticate to anything even if somebody added a remote subcommand to the
 * allow-list. Remote operations belong to a provider that holds a credential,
 * and that provider is a separate, separately-audited surface.
 */

import { lstatSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type {
  DiffJudgement,
  MissionRepositoryTarget,
  ObservedDiff,
  ObservedFileChange,
} from '../mission/repository-target';
import { inspectRepositoryState, parseStatusZ, runGit } from './repository-inspector';

/**
 * THE GIT SUBCOMMANDS THIS MODULE MAY RUN. An allow-list, not a deny-list.
 *
 * A deny-list of dangerous subcommands is a list somebody has to keep complete,
 * and git has more ways to destroy history than anyone remembers —
 * `filter-branch`, `replace`, `update-ref`, `reflog expire`, `worktree prune
 * --expire=now`. An allow-list is wrong in the safe direction: a subcommand
 * nobody thought about is refused rather than permitted.
 *
 * `push`, `fetch`, `remote`, `merge`, `rebase`, `reset`, `clean`, `gc`, `tag`
 * and `config` are absent, and their absence is the enforcement. The design
 * document's rule — *"Relay adds commits; it never rewrites them"* — is this
 * array.
 */
export const REPOSITORY_GIT_ALLOWLIST: readonly string[] = [
  'rev-parse',
  'status',
  'diff',
  'add',
  'commit',
  'branch',
  'show',
  'log',
  'ls-files',
  'cat-file',
];

/**
 * THE OPTIONS EACH SUBCOMMAND MAY CARRY. An allow-list again, and it replaced a
 * deny-list that five real invocations walked straight past.
 *
 * The deny-list held ten exact strings — `--force`, `-f`, `--amend` and so on —
 * and an independent review executed these against real git:
 *
 *   git add -fv -- secrets.env   ALLOWED, staged a .gitignore'd file holding a token
 *   git commit -n                ALLOWED, skipped a pre-commit hook that exits 1
 *   git branch -D doomed         ALLOWED, "Deleted branch doomed"
 *   git branch -m main renamed   ALLOWED, renamed the current branch
 *   git diff --output=/tmp/x     ALLOWED, wrote a file outside the repository
 *   git commit -F /etc/hostname  ALLOWED, took its subject from that file
 *
 * `-fv` is `-f` and `-v` in one cluster, which exact-string matching cannot see;
 * `-n` is the short spelling of `--no-verify`; `-D` and `-m` rewrite refs, which
 * "Relay adds commits; it never rewrites them" forbids. Every one of those is a
 * string somebody forgot, and a deny-list is a list somebody has to remember to
 * finish.
 *
 * So the rule inverts: **any argument beginning with `-` must appear in its own
 * subcommand's set, or it is refused.** A short cluster is expanded to its
 * letters first. A form nobody thought about is refused rather than permitted,
 * which is the direction that fails loudly.
 */
const GIT_SUBCOMMAND_OPTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'rev-parse': ['--verify', '--quiet', '--short'],
  status: ['--porcelain=v1', '-z', '--no-renames'],
  diff: ['--numstat', '--name-only', '--no-renames', '-z'],
  // Paths only, after the `--` terminator. `-f`/`--force` would write an ignored
  // file, and `.gitignore` in a real repository is where credentials live.
  add: [],
  commit: ['-m'],
  // READS ONLY. `-D`, `-d`, `-m` and `-M` all rewrite refs.
  branch: ['--show-current'],
  show: ['--name-only'],
  log: ['--oneline', '-1'],
  'ls-files': ['--others', '--exclude-standard', '-z'],
  'cat-file': ['-t', '-p'],
});

/** Options that consume the following argument, so its value is never read as
 *  an option itself — a commit message may legitimately begin with a dash. */
const GIT_VALUE_OPTIONS: readonly string[] = ['-m'];

/**
 * Run one git command inside the repository write surface.
 *
 * The refusal is by NAME and happens before any process is spawned, so a caller
 * that asks for something outside the envelope learns why rather than getting a
 * git error it has to interpret.
 */
export function runRepositoryGit(
  args: readonly string[],
  cwd: string,
  /**
   * Identity only. `runGit` already strips the environment down to PATH, HOME,
   * LANG and TMPDIR with `GIT_TERMINAL_PROMPT=0`, so no provider variable can
   * reach git from here — and a commit in a fresh repository with no configured
   * `user.name` fails without an explicit author, which is why this parameter
   * exists at all. It is NOT a general env passthrough: `--author` and `--date`
   * are on the refused-flag list, so identity arrives here or nowhere.
   */
  identityEnv: Readonly<Record<string, string>> = {},
): RelayResult<string> {
  const subcommand = args[0];
  if (typeof subcommand !== 'string' || !REPOSITORY_GIT_ALLOWLIST.includes(subcommand)) {
    return fail(
      relayError('permission-denied', `git "${String(subcommand)}" is outside Relay's repository write surface.`, {
        details: [...REPOSITORY_GIT_ALLOWLIST],
      }),
    );
  }
  const permitted = GIT_SUBCOMMAND_OPTIONS[subcommand] ?? [];
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i] as string;
    // Everything after `--` is a pathspec. git will not read it as an option,
    // and a path that begins with a dash is exactly why the terminator exists.
    if (arg === '--') break;
    if (!arg.startsWith('-')) continue;

    /**
     * NO CLUSTER EXPANSION, AND THE REASON IS WHY THE ALLOW-LIST IS THE FIX.
     *
     * The first version of this loop expanded a short cluster to its letters —
     * `-fv` to `-f` and `-v` — because that is how `-fv` walked past the old
     * DENY-list containing `-f`. Against an ALLOW-list the expansion is dead
     * code: `-fv` is not a permitted string, so it is refused whole. A mutation
     * probe that removed the expansion changed no outcome, which is how it was
     * found — and code that does nothing while a comment calls it load-bearing is
     * the defect class this repository repairs most often.
     *
     * The clustering problem was never about matching letters. It was about a
     * deny-list needing to be complete.
     */
    if (!permitted.includes(arg)) {
      return fail(
        relayError(
          'permission-denied',
          `git option "${arg}" is not permitted for "${subcommand}". `
            + 'Relay adds commits and never rewrites them.',
          { details: [...permitted] },
        ),
      );
    }
    if (GIT_VALUE_OPTIONS.includes(arg)) i += 1;
  }
  return runGit([...args], cwd, { ...identityEnv });
}

/* --------------------------------------------------------- observation */

/** Lines counted from disk for a file git has never seen. Bounded, because an
 *  agent can create a very large file and this is not the place to run out of
 *  memory. A file over the bound reports an UNKNOWN line count, which the
 *  ceiling check then refuses — the safe direction. */
const MAX_UNTRACKED_BYTES = 2_000_000;

function countUntrackedLines(worktreePath: string, relativePath: string): number | null {
  try {
    const full = join(worktreePath, relativePath);
    const stat = statSync(full);
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_BYTES) return null;
    const text = readFileSync(full, 'utf8');
    if (text === '') return 0;
    // `\0` means git would treat it as binary, and a line count of a binary
    // file is not a fact. Unknown, not zero.
    if (text.includes('\0')) return null;
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  } catch {
    return null;
  }
}

/**
 * IS THIS PATH, OR ANYTHING ABOVE IT, A SYMLINK?
 *
 * A symlink inside the write scope defeated the whole observation. Executed by an
 * independent review: an agent created `src/outside -> /tmp/probe-XXXX`, wrote
 * through it, and Relay observed one untracked change at `src/outside`, judged it
 * `accepted`, and committed a mode-120000 entry pointing at an absolute path
 * outside the repository — while the file it overwrote out there was never seen at
 * all.
 *
 * Both halves matter. "Read what the worktree ACTUALLY contains" does not bound
 * the blast radius if a write can leave the worktree, and a symlink's target is
 * outside anything `scopeMatches` can reason about — so it cannot be classified,
 * only refused.
 *
 * Every ancestor is checked, not just the leaf: `src/link/app.ts` where `src/link`
 * is the symlink is the same escape one directory up.
 */
function pathCrossesSymlink(worktreePath: string, relativePath: string): boolean {
  const segments = relativePath.split('/').filter((segment) => segment !== '');
  let current = worktreePath;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      // `lstat`, never `stat`: `stat` follows the link and reports the target,
      // which is precisely the thing being hidden.
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch (error) {
      /**
       * A MISSING SEGMENT IS NOT A SYMLINK, and treating it as one refused
       * deletions for a reason that was not true.
       *
       * The first version returned `true` for any lstat failure. A DELETED path
       * cannot be lstat'd — that is what deleted means — so `git mv` of a
       * protected file reported its source as `symlinked` instead of `deleted`.
       * The refusal still happened, which hid it, but it happened for the wrong
       * reason and the deletion ceiling never saw a deletion.
       *
       * `ENOENT` means the rest of this path does not exist, so nothing further
       * along it can be a symlink: stop and report none. Any OTHER error is a
       * path Relay cannot inspect, and that stays fail-closed.
       */
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return false;
      return true;
    }
  }
  return false;
}

/** git status codes → the observation's vocabulary. */
function classifyStatusCode(code: string): ObservedFileChange['kind'] {
  if (code === '??') return 'untracked';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  if (code.includes('A')) return 'added';
  return 'modified';
}

/**
 * Parse `git diff --numstat HEAD`.
 *
 * A binary file's counts are literally `-` and become NULL rather than zero.
 * That single character is the difference between a ceiling that would have
 * caught a repository being emptied and one that watched it happen — see
 * `enforceChangeCeilings`, which refuses an unknown removal count.
 */
export function parseNumstat(raw: string): Map<string, { added: number | null; removed: number | null }> {
  const out = new Map<string, { added: number | null; removed: number | null }>();
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const parts = line.split('\t');
    /**
     * EXACTLY THREE FIELDS. `observeRepositoryWorktree` passes `--no-renames`, so
     * numstat emits `added<TAB>removed<TAB>path` and nothing else.
     *
     * This used to take the LAST field and say in a comment that "a rename
     * prints `old => new` or three tab-separated path fields". Real
     * `git diff --numstat` prints neither without `-z`: it prints the COMBINED
     * path `{.github/workflows => src}/ci.yml` as a single field, which matched
     * no key and silently gave the file an unknown line count. The unit test
     * fed a hand-made four-field line real git never produces. Anything other
     * than three fields is now skipped rather than guessed at.
     */
    if (parts.length !== 3) continue;
    const [addedRaw, removedRaw] = parts as [string, string, string];
    const path = (parts[2] as string).trim();
    if (path === '') continue;
    const num = (v: string): number | null => {
      const n = Number.parseInt(v, 10);
      return Number.isSafeInteger(n) && n >= 0 ? n : null;
    };
    out.set(path, { added: num(addedRaw), removed: num(removedRaw) });
  }
  return out;
}

/**
 * WHAT THE WORKTREE ACTUALLY CONTAINS.
 *
 * Two git reads, because neither alone is the whole answer: `status` knows about
 * files git has never seen, and `diff --numstat` knows how many lines moved.
 * A path present in `status` but absent from `numstat` — every untracked file —
 * gets its added-count from disk and a removed-count of zero, which is a fact
 * about a file that did not previously exist rather than an assumption.
 */
export function observeRepositoryWorktree(input: {
  readonly worktreePath: string;
  readonly baselineSha: string | null;
  readonly now: string;
}): RelayResult<ObservedDiff> {
  const { worktreePath, baselineSha, now } = input;

  const state = inspectRepositoryState(worktreePath);
  if (!state.ok) return state;

  /**
   * `--no-renames`, ON BOTH READS, AND THIS WAS A CRITICAL DEFECT.
   *
   * With rename detection on, `git mv .github/workflows/ci.yml src/notes.yml`
   * reports as ONE entry — `R  src/notes.yml\0.github/workflows/ci.yml` — and
   * `parseStatusZ` skips the second path by design. So the deletion of a path
   * Relay protects UNCONDITIONALLY BY DEFAULT was invisible: the observation
   * carried one `renamed` change inside the write scope, `judgeObservedDiff`
   * returned `accepted: true`, and `commitObservedWork` committed the CI file's
   * removal. An independent review executed it end to end in a real repository.
   *
   * Under DEFAULT config the same `git mv` happened to be refused — but by the
   * wrong guard, and by an accident: non-`-z` numstat prints the combined path
   * `{.github/workflows => src}/ci.yml`, which matched no key, so the ceiling
   * check refused it for an unknown removal count. The only thing between an
   * agent and deleting CI was the text format of a diff summary.
   *
   * `--no-renames` makes rename detection irrelevant to the safety decision.
   * git then reports what actually happened to the filesystem — `D` for the
   * source and `A` for the destination, with real line counts for both — and
   * every existing rule applies to each path on its own. It also removes the
   * dependence on whoever's `.gitconfig` is in force, and `runGit` passes `HOME`.
   */
  const statusRaw = runRepositoryGit(['status', '--porcelain=v1', '-z', '--no-renames'], worktreePath);
  if (!statusRaw.ok) return statusRaw;
  const entries = parseStatusZ(statusRaw.value);

  const numstatRaw = runRepositoryGit(['diff', '--numstat', '--no-renames', 'HEAD'], worktreePath);
  if (!numstatRaw.ok) return numstatRaw;
  const numstat = parseNumstat(numstatRaw.value);

  const changes: ObservedFileChange[] = entries.map((entry) => {
    /**
     * A SYMLINKED PATH IS REFUSED, NOT CLASSIFIED.
     *
     * `symlinked` is reported as its own kind so `judgeObservedDiff` can refuse
     * it by name. Classifying it as `modified` and letting scope decide would
     * accept it — the path `src/outside` is inside a `src/**` write scope, and
     * the target it points at is not something any path rule can see.
     */
    if (pathCrossesSymlink(worktreePath, entry.path)) {
      return { path: entry.path, kind: 'symlinked', linesAdded: null, linesRemoved: null };
    }
    const kind = classifyStatusCode(entry.code);
    const counted = numstat.get(entry.path);
    if (counted !== undefined) {
      return { path: entry.path, kind, linesAdded: counted.added, linesRemoved: counted.removed };
    }
    if (kind === 'untracked') {
      return {
        path: entry.path,
        kind,
        linesAdded: countUntrackedLines(worktreePath, entry.path),
        // A file that did not exist removed nothing. This is the one zero in
        // this module that is a fact rather than a default.
        linesRemoved: 0,
      };
    }
    // Changed according to `status`, absent from `numstat`. Relay does not know
    // how many lines moved, and says so.
    return { path: entry.path, kind, linesAdded: null, linesRemoved: null };
  });

  return ok({
    observedBy: 'relay_git_inspection',
    observedAt: now,
    changes,
    conflicted: state.value.conflicted,
    // The baseline is passed IN, from whoever pinned it before the agent ran —
    // reading it here would read the worktree's current HEAD, which after a
    // commit is no longer the baseline. That substitution would make
    // `baseMovedUnderMission` compare a value against itself and always agree.
    baselineSha,
  });
}

/** Resolve a branch to the commit it points at, as git reports it. */
export function resolveBaselineSha(input: {
  readonly worktreePath: string;
  readonly ref: string;
}): RelayResult<string> {
  const result = runRepositoryGit(['rev-parse', input.ref], input.worktreePath);
  if (!result.ok) return result;
  const sha = result.value.trim();
  if (!/^[0-9a-f]{7,64}$/.test(sha)) {
    return fail(relayError('validation-failed', `git did not resolve "${input.ref}" to a revision.`));
  }
  return ok(sha);
}

/* -------------------------------------------------------------- writing */

export interface CommitObservedWorkResult {
  /** The commit git reports it created. Read back, never assumed. */
  readonly commitSha: string;
  readonly branch: string;
  readonly committedPaths: readonly string[];
}

/**
 * COMMIT EXACTLY WHAT THE JUDGEMENT APPROVED.
 *
 * Five refusals before a single byte is written, in this order:
 *
 *   1. The judgement was not accepted. A refused diff is never partially
 *      committed — `committablePaths` is already empty in that case, and this
 *      checks `accepted` as well so an empty-path commit cannot slip through as
 *      a no-op success.
 *   2. The Mission does not hold `commit`. Checked here as well as at the
 *      lifecycle transition, because this function is reachable from anywhere
 *      and the transition is not the only door.
 *   3. The worktree is not on the working branch. Committing on whatever branch
 *      happens to be checked out is how work lands on `main`.
 *   4. The branch is the base branch, or protected. Refused by name.
 *   5. There is nothing to commit. Reported as a refusal rather than an empty
 *      commit, because `--allow-empty` is on the refused-flag list and an empty
 *      commit is a record of work that did not happen.
 */
export function commitObservedWork(input: {
  readonly target: MissionRepositoryTarget;
  readonly worktreePath: string;
  readonly judgement: DiffJudgement;
  readonly message: string;
  readonly authorName: string;
  readonly authorEmail: string;
}): RelayResult<CommitObservedWorkResult> {
  const { target, worktreePath, judgement, message } = input;

  if (!judgement.accepted || judgement.committablePaths.length === 0) {
    return fail(
      relayError('permission-denied', 'Relay will not commit a diff it did not accept.', {
        details: judgement.problems.map((p) => p.refusal),
      }),
    );
  }
  if (!target.permissions.includes('commit')) {
    return fail(relayError('permission-denied', 'This Mission does not hold the "commit" permission.'));
  }

  const state = inspectRepositoryState(worktreePath);
  if (!state.ok) return state;
  const branch = state.value.branch;
  if (branch !== target.workingBranch) {
    return fail(
      relayError(
        'permission-denied',
        `The worktree is on "${branch}" and this Mission's working branch is "${target.workingBranch}".`,
      ),
    );
  }
  if (branch === target.baseBranch || target.protectedBranches.includes(branch)) {
    // Unreachable while the resolver refuses a protected working branch, and
    // checked anyway: this function does not get to assume the resolver ran.
    return fail(relayError('permission-denied', `"${branch}" is a protected branch and Relay does not commit to it.`));
  }
  if (typeof message !== 'string' || message.trim() === '') {
    return fail(relayError('validation-failed', 'A commit needs a message.'));
  }

  // `--` terminates the option list, so a path that begins with a dash cannot
  // become a flag. Only the approved paths are staged; anything else the agent
  // left behind stays uncommitted and visible.
  const staged = runRepositoryGit(['add', '--', ...judgement.committablePaths], worktreePath);
  if (!staged.ok) return staged;

  /**
   * THE AUTHOR IS RELAY, NAMED. A commit attributed to whatever `user.name`
   * happens to be configured on the host is a commit whose author is an
   * accident of the machine, and on a real repository that machine may be a
   * founder's laptop. The caller supplies the identity and it travels as
   * environment rather than as `--author`, which is refused.
   */
  const committed = runRepositoryGit(['commit', '-m', message.trim()], worktreePath, {
    GIT_AUTHOR_NAME: input.authorName,
    GIT_AUTHOR_EMAIL: input.authorEmail,
    GIT_COMMITTER_NAME: input.authorName,
    GIT_COMMITTER_EMAIL: input.authorEmail,
  });
  if (!committed.ok) return committed;

  // READ BACK. The commit SHA is what git says it created, never a value this
  // function computed — the same rule that makes the served model evidence.
  const head = resolveBaselineSha({ worktreePath, ref: 'HEAD' });
  if (!head.ok) return head;

  return ok({ commitSha: head.value, branch, committedPaths: judgement.committablePaths });
}
