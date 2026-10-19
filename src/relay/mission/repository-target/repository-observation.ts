/**
 * JUDGING WHAT ACTUALLY CHANGED.
 *
 * `ChangeCeilings` and `allowDeletions` have existed in the contracts since
 * repository targets were designed, and nothing enforced either of them. A
 * ceiling nothing checks is a comment; this module is the check.
 *
 * THE INPUT MUST BE AN OBSERVATION. Every function here takes changed paths and
 * line counts that RELAY read out of a git worktree after the agent exited —
 * never the agent's own account of what it touched. This layer cannot tell the
 * difference, which is exactly why the requirement is stated at the type: see
 * `ObservedDiff.observedBy`, which has no member for the agent and must never
 * gain one. A claim laundered through here would come out the other side as a
 * verdict.
 *
 * PURE DOMAIN. The git commands live in `src/relay/workspace/repository-inspector.ts`,
 * which is the repository's only sanctioned git surface; this file decides what
 * their output MEANS.
 */

import type {
  ChangeCeilings,
  MissionRepositoryTarget,
  RepositoryProblem,
} from './repository-contracts';
import { classifyObservedChanges, type ScopeVerdict } from './repository-scope';

/**
 * ONE CHANGED PATH, AS OBSERVED.
 *
 * `linesAdded`/`linesRemoved` are nullable because a binary file has no line
 * count and a provider that could not produce one must say so rather than
 * report zero. A null removed-count is treated as UNKNOWN by the ceiling check,
 * and unknown removals cannot be proven to be under a ceiling — see
 * `enforceChangeCeilings`.
 */
export interface ObservedFileChange {
  readonly path: string;
  /**
   * `symlinked` is a REFUSAL kind, not a change kind. The observer emits it for
   * any path whose own name or any ancestor is a symlink, because a symlink's
   * target is outside anything a path rule can reason about — a write through
   * `src/outside -> /tmp/x` leaves the worktree entirely and is invisible to an
   * observation of the worktree. It is refused by name in `judgeObservedDiff`.
   */
  readonly kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'symlinked';
  readonly linesAdded: number | null;
  readonly linesRemoved: number | null;
}

/**
 * THE WHOLE OBSERVATION, and who made it.
 *
 * `observedBy` names the mechanism. The union has exactly two members —
 * `relay_git_inspection` for a real worktree read, and `relay_fixture_inspection`
 * for the controlled fixture path — and deliberately no member naming the
 * Coding Agent, the Reviewer, or a model of any kind. Adding one would be the
 * whole safety property, deleted.
 */
export interface ObservedDiff {
  readonly observedBy: 'relay_git_inspection' | 'relay_fixture_inspection';
  readonly observedAt: string;
  readonly changes: readonly ObservedFileChange[];
  /** True when git reported a conflicted worktree. A conflicted tree is never
   *  judged: it is not a diff, it is an unfinished merge. */
  readonly conflicted: boolean;
  /** The commit the worktree was created from, as git reported it. */
  readonly baselineSha: string | null;
}

/* ---------------------------------------------------------- ceilings */

export interface CeilingVerdict {
  readonly within: boolean;
  readonly problems: readonly RepositoryProblem[];
  readonly filesChanged: number;
  /** Null when any change reported an unknown removed-line count. */
  readonly linesRemoved: number | null;
  readonly deletedPaths: readonly string[];
}

/**
 * IS THIS DIFF WITHIN ITS CEILINGS?
 *
 * Three refusals, and the reasoning for each:
 *
 *   - **File count.** A diff that touches four hundred files is not a fix that
 *     went slightly wrong. Exceeding REFUSES; it never truncates, because a
 *     truncated diff is a Reviewer reading a fragment and answering as though
 *     it read the whole thing.
 *   - **Lines removed.** Additions are bounded by the Mission's own usefulness;
 *     removals are how work disappears. An UNKNOWN removal count cannot be
 *     shown to be under the ceiling, so it is refused rather than assumed
 *     small — the one place in this file where absent data blocks rather than
 *     merely reports, because the alternative is a binary blob deleting a
 *     repository under a ceiling that saw zero.
 *   - **Deletions.** "Change this file" and "remove this file" are different
 *     acts, and the second is off by default. A deletion with
 *     `allowDeletions: false` is refused by name whatever the counts say.
 */
export function enforceChangeCeilings(input: {
  readonly diff: ObservedDiff;
  readonly ceilings: ChangeCeilings;
}): CeilingVerdict {
  const { diff, ceilings } = input;
  const problems: RepositoryProblem[] = [];
  const filesChanged = diff.changes.length;
  /**
   * A RENAME IS A DELETION OF ITS SOURCE, and `allowDeletions` has to see it.
   *
   * The live observer passes `--no-renames`, so git reports a `git mv` as a
   * separate `D` and `A` and this list catches the `D` on its own. But
   * `ObservedDiff` is also the `relay_fixture_inspection` shape and the intended
   * persisted record, so a `renamed` entry can still arrive here — and counting
   * it as "not a deletion" is how a protected file left the repository while
   * `allowDeletions: false` reported nothing.
   */
  const deletedPaths = diff.changes
    .filter((c) => c.kind === 'deleted' || c.kind === 'renamed')
    .map((c) => c.path);

  /**
   * A COUNT THAT IS NOT A NON-NEGATIVE SAFE INTEGER IS UNKNOWN, NOT A NUMBER.
   *
   * This trusted its input. Executed by an independent review:
   * `[-500, +500]` summed to `0` and reported `within: true` — a negative
   * cancelling a real removal — and `NaN` reported `within: true` while
   * serialising to `null` after any JSON hop. A check that passed because it
   * could not run, which is the failure mode this module's own header names.
   *
   * `parseNumstat` guards `n >= 0`, so the live observer cannot produce these —
   * but `ObservedDiff` is also the `relay_fixture_inspection` shape and the
   * intended persisted record.
   */
  const usableRemoval = (value: number | null): number | null =>
    value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const unknownRemoval = diff.changes.some((c) => usableRemoval(c.linesRemoved) === null);
  const linesRemoved = unknownRemoval
    ? null
    : diff.changes.reduce((total, c) => total + (usableRemoval(c.linesRemoved) ?? 0), 0);

  if (filesChanged > ceilings.maxFilesChanged) {
    problems.push({
      refusal: 'ceiling_exceeded',
      message: `${filesChanged} files changed exceeds the ceiling of ${ceilings.maxFilesChanged}.`,
    });
  }
  if (linesRemoved === null) {
    problems.push({
      refusal: 'ceiling_exceeded',
      message:
        'At least one change reported no removed-line count, so the removal ceiling cannot be shown to hold. '
        + 'Unknown is not zero.',
    });
  } else if (linesRemoved > ceilings.maxLinesRemoved) {
    problems.push({
      refusal: 'ceiling_exceeded',
      message: `${linesRemoved} lines removed exceeds the ceiling of ${ceilings.maxLinesRemoved}.`,
    });
  }
  if (deletedPaths.length > 0 && !ceilings.allowDeletions) {
    problems.push({
      refusal: 'deletion_not_permitted',
      message: `This Mission may not delete files, and ${deletedPaths.length} were deleted: ${deletedPaths.join(', ')}.`,
    });
  }
  return { within: problems.length === 0, problems, filesChanged, linesRemoved, deletedPaths };
}

/* ------------------------------------------------------- the verdict */

export interface DiffJudgement {
  readonly accepted: boolean;
  readonly problems: readonly RepositoryProblem[];
  readonly scope: ScopeVerdict;
  readonly ceilings: CeilingVerdict;
  /** The paths Relay is prepared to commit. Empty when refused. */
  readonly committablePaths: readonly string[];
}

/**
 * MAY RELAY COMMIT WHAT IT OBSERVED?
 *
 * The one function the coding leg calls after the agent exits, composing every
 * rule in this directory over an OBSERVATION. Order and precedence:
 *
 *   1. A CONFLICTED worktree is refused first and alone. An unfinished merge is
 *      not a diff, and classifying its paths would report scope violations for
 *      conflict markers rather than the one fact that matters.
 *   2. An observation with no baseline SHA is refused. Without it the artifact
 *      digest the Reviewer bound its verdict to describes a diff against
 *      nothing, and "the base moved under the Mission" becomes undetectable.
 *   3. Scope and protection, then ceilings. All of them, reported together —
 *      an agent whose diff breaks three rules should be told three things.
 *   4. `committablePaths` is `scope.allowed` AND ONLY when nothing was refused.
 *      A partial accept is the dangerous shape: it would commit the allowed
 *      half of a diff whose other half violated protection, leaving the
 *      repository in a state no Reviewer ever read.
 */
export function judgeObservedDiff(input: {
  readonly diff: ObservedDiff;
  readonly target: MissionRepositoryTarget;
}): DiffJudgement {
  const { diff, target } = input;
  const emptyScope: ScopeVerdict = { allowed: [], protectedHits: [], outOfScope: [], invalid: [] };
  const emptyCeilings: CeilingVerdict = {
    within: true, problems: [], filesChanged: diff.changes.length, linesRemoved: null, deletedPaths: [],
  };

  if (diff.conflicted) {
    return {
      accepted: false,
      problems: [{
        refusal: 'identity_invalid',
        message: 'The worktree is conflicted. An unfinished merge is not a diff and is never judged.',
      }],
      scope: emptyScope,
      ceilings: emptyCeilings,
      committablePaths: [],
    };
  }
  if (diff.baselineSha === null || diff.baselineSha.trim() === '') {
    return {
      accepted: false,
      problems: [{
        refusal: 'identity_invalid',
        message: 'The observation reports no baseline revision, so there is nothing this diff can be proven to be against.',
      }],
      scope: emptyScope,
      ceilings: emptyCeilings,
      committablePaths: [],
    };
  }

  /**
   * SYMLINKS FIRST, and they never reach the scope rules.
   *
   * A symlinked path inside the write scope would be ACCEPTED by
   * `classifyObservedChanges` — the path is in scope; it is the target that is
   * not, and no path rule can see a target. Refused before classification.
   */
  const symlinked = diff.changes.filter((c) => c.kind === 'symlinked').map((c) => c.path);

  const scope = classifyObservedChanges({
    changedPaths: diff.changes.filter((c) => c.kind !== 'symlinked').map((c) => c.path),
    writeScope: target.scope.write,
    protectedPaths: target.protectedPaths,
  });
  const ceilings = enforceChangeCeilings({ diff, ceilings: target.ceilings });

  const problems: RepositoryProblem[] = [];
  /**
   * A MISSION THAT MAY NOT WRITE MAY NOT HAVE ITS CHANGES ACCEPTED.
   *
   * `write_worktree` was enforced nowhere. An independent review resolved a
   * Mission with `permissions: ['read']` — and one with `[]` — and both produced
   * `accepted: true, committablePaths: ['src/app.ts']`. Only `commitObservedWork`
   * refused, on the separate `commit` grant.
   *
   * `DiffJudgement` is the record the Reviewer and the UI read. For a read-only
   * Mission it was saying Relay is prepared to commit paths the Mission was
   * never authorized to write, which is a claim about authority that the
   * authority layer disagreed with.
   */
  if (diff.changes.length > 0 && !target.permissions.includes('write_worktree')) {
    problems.push({
      refusal: 'permission_not_granted',
      message:
        `${String(diff.changes.length)} path(s) changed, and this Mission does not hold "write_worktree". `
        + 'A read-only Mission that produced a diff produced it outside its authority.',
    });
  }
  if (symlinked.length > 0) {
    problems.push({
      refusal: 'identity_invalid',
      message:
        `Symlinked paths were changed and Relay will not vouch for where they point: ${symlinked.join(', ')}. `
        + 'A write through a symlink can leave the worktree entirely, which an observation of the worktree cannot see.',
    });
  }
  if (scope.protectedHits.length > 0) {
    problems.push({
      refusal: 'protected_path_unprotect_refused',
      message: `Protected paths were changed: ${scope.protectedHits.join(', ')}.`,
    });
  }
  if (scope.outOfScope.length > 0) {
    problems.push({
      refusal: 'mission_scope_exceeds_registration',
      message: `Paths outside the write scope were changed: ${scope.outOfScope.join(', ')}.`,
    });
  }
  if (scope.invalid.length > 0) {
    problems.push({
      refusal: 'identity_invalid',
      message: `Paths Relay could not normalize were reported changed: ${scope.invalid.join(', ')}.`,
    });
  }
  problems.push(...ceilings.problems);

  const accepted = problems.length === 0;
  return {
    accepted,
    problems,
    scope,
    ceilings,
    // Never a partial accept. See the header.
    committablePaths: accepted ? scope.allowed : [],
  };
}

/**
 * DID THE BASE MOVE UNDER THE MISSION?
 *
 * The design document names this explicitly: *"The base is recorded as a
 * revision SHA at the start and verified unchanged at the end. A base that moved
 * under the Mission invalidates the artifact digest, and the Reviewer reviewed a
 * diff that no longer applies."*
 *
 * Both halves must be present. A missing start baseline is not agreement, and
 * neither is a missing end one — a check that passes because it could not run is
 * worse than no check, because it reads as evidence.
 */
export function baseMovedUnderMission(input: {
  readonly baselineAtStart: string | null;
  readonly baselineAtEnd: string | null;
}): { readonly moved: boolean; readonly reason: string } {
  const { baselineAtStart, baselineAtEnd } = input;
  if (baselineAtStart === null || baselineAtStart.trim() === '') {
    return { moved: true, reason: 'No baseline was recorded at the start, so nothing can be shown to be unchanged.' };
  }
  if (baselineAtEnd === null || baselineAtEnd.trim() === '') {
    return { moved: true, reason: 'The base could not be read at the end, so it cannot be shown to be unchanged.' };
  }
  if (baselineAtStart !== baselineAtEnd) {
    return {
      moved: true,
      reason: `The base moved from ${baselineAtStart} to ${baselineAtEnd} while the Mission ran. The reviewed diff no longer applies.`,
    };
  }
  return { moved: false, reason: `The base is unchanged at ${baselineAtStart}.` };
}
