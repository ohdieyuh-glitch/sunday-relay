import { rmSync } from 'node:fs';
import { buildSafeEditFixture } from '../src/relay/connectors/claude-code/fixture';
import {
  resolveBaselineSha,
} from '../src/relay/workspace/repository-target-observer';
import { validateSourceRepository } from '../src/relay/workspace/repository-inspector';
import { pathInScope, protectedPathMatches } from '../src/relay/mission/repository-target';
import type { MissionRepositoryTarget } from '../src/relay/mission/repository-target';

/**
 * WHERE A MISSION'S CODE COMES FROM — the seam the bridge was missing.
 *
 * `runCodingMission` called `buildSafeEditFixture()` directly, so every hosted
 * Mission Relay has ever run edited the same four-file throwaway repository.
 * `docs/relay/REPOSITORY_TARGETS.md` listed that as the third thing not built:
 * the authorization spine, the observation layer and the lifecycle all existed
 * and nothing in the bridge read a `MissionRepositoryTarget`.
 *
 * The fixture's contract turned out to be exactly four facts — a source path, a
 * baseline revision, a claimed file and a protected set — so a registered target
 * can satisfy the same seam without the coding leg learning what a repository
 * target is. That is the whole design here: ONE branch, at the source, and every
 * downstream step (worktree isolation, inspection, file-claim policy, the test
 * command, the artifact digest) is untouched.
 *
 * THE FIXTURE PATH STAYS THE DEFAULT AND STAYS BYTE-IDENTICAL. The design
 * document's first precondition is that it keeps working unchanged, because it
 * is the only configuration where Relay's safety holds by construction. A
 * Mission with no target gets `fixtureSource()`, which is the previous code
 * moved, not rewritten.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not clone, fetch, push or reach a
 * network: a `local` target names a path already on disk, and a `remote_clone`
 * target is REFUSED here rather than silently fetched, because the credential
 * boundary says Relay performs remote operations itself after the agent exits
 * and no such provider exists yet. Refusing by name is the honest state.
 */

export interface RepositorySource {
  /** What the worktree is created from. Never the agent's working directory. */
  readonly sourceRepositoryPath: string;
  /** The commit the Mission is measured against, READ from git. */
  readonly baselineRevision: string;
  /**
   * THE FILES THIS MISSION MAY WRITE, as concrete repository-relative paths.
   *
   * The fixture has exactly one and the whole claim policy is built on it. A real
   * repository has a write SCOPE, which is a shape rather than a list — and the
   * workspace policy Relay already runs speaks concrete paths, not globs. So the
   * Mission must NARROW its scope to the files it intends to touch, which the
   * design document already requires ("the scope is per-repository AND narrowable
   * per-Mission"), and `repositoryTargetSource` refuses a target with none.
   *
   * Refusing is the right direction: an agent turned loose on a whole write scope
   * with no declared intent is exactly the thing the file-claim mechanism exists
   * to prevent, and it would have no claim to check against.
   */
  readonly allowedWritePaths: readonly string[];
  /** The shape the existing workspace policy already speaks. */
  readonly protectedPaths: { forbidden: string[]; readOnly: string[] };
  /** True only for the throwaway fixture. Used to keep evidence truthful. */
  readonly disposable: boolean;
  /** Removes anything this source created. A no-op for a real repository —
   *  Relay does not delete a founder's checkout. */
  readonly dispose: () => void;
}

export type RepositorySourceResult =
  | { readonly ok: true; readonly source: RepositorySource }
  | { readonly ok: false; readonly reason: string };

/** The controlled fixture, unchanged. */
export function fixtureSource(): RepositorySource {
  const fixture = buildSafeEditFixture();
  return {
    sourceRepositoryPath: fixture.sourceRepo,
    baselineRevision: fixture.baselineRevision,
    allowedWritePaths: [fixture.claimedFile],
    protectedPaths: fixture.protectedPaths,
    disposable: true,
    dispose: () => {
      try {
        rmSync(fixture.fixtureRoot, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

/**
 * A REGISTERED REPOSITORY, as the same four facts.
 *
 * Every refusal is by NAME and happens before a worktree exists, before an agent
 * starts and before anything is spent — the same shape as every other refusal in
 * this feature.
 *
 * `protectedPaths.forbidden` carries the target's fully-resolved protected set,
 * so the workspace policy Relay already runs refuses those paths without knowing
 * where the list came from. `readOnly` is empty: a real repository's read scope
 * is usually everything, and the write scope is what bounds the agent.
 */
export function repositoryTargetSource(
  target: MissionRepositoryTarget,
  /** The files this Mission declares it will write, narrowed from the scope. */
  intendedWritePaths: readonly string[],
): RepositorySourceResult {
  if (target.location.kind !== 'local_path') {
    return {
      ok: false,
      reason:
        'This Mission targets a remote repository, and Relay has no remote provider. '
        + 'Nothing here clones or fetches; a remote target is refused rather than silently reached.',
    };
  }
  if (!target.permissions.includes('write_worktree')) {
    // Read-only Missions are supported and useful, but not through the coding
    // leg: it exists to produce a diff, and a Mission that may not write should
    // never have an agent started for it.
    return {
      ok: false,
      reason: 'This Mission does not hold "write_worktree", so no Coding Agent may be started for it.',
    };
  }

  if (intendedWritePaths.length === 0) {
    return {
      ok: false,
      reason:
        'A Mission against a real repository must name the files it intends to write. '
        + 'An agent turned loose on a whole write scope has no claim to check against.',
    };
  }
  /**
   * EVERY DECLARED PATH MUST BE INSIDE THE SCOPE AND OUTSIDE THE PROTECTED SET.
   *
   * Checked here, before a worktree exists, rather than only after the agent
   * exits: a Mission that declares an out-of-scope file is misconfigured, and
   * discovering that from the diff means the money is already spent.
   */
  const outOfScope = intendedWritePaths.filter((path) => !pathInScope(target.scope.write, path));
  if (outOfScope.length > 0) {
    return { ok: false, reason: `Declared write paths outside this Mission's scope: ${outOfScope.join(', ')}.` };
  }
  const hitsProtected = intendedWritePaths.filter(
    (path) => target.protectedPaths.some((rule) => protectedPathMatches(rule, path)),
  );
  if (hitsProtected.length > 0) {
    return { ok: false, reason: `Declared write paths are protected: ${hitsProtected.join(', ')}.` };
  }

  /**
   * CANONICALIZED BEFORE USE. `validateSourceRepository` is the existing gate —
   * it rejects traversal, non-directories, symlinked roots that escape and
   * anything that is not a git repository — and it returns the realpath, which
   * is what every containment check downstream compares against.
   */
  const validated = validateSourceRepository(target.location.path);
  if (!validated.ok) return { ok: false, reason: `Repository path refused: ${validated.error.message}` };

  /**
   * THE BASELINE IS READ FROM GIT, NOT TAKEN FROM THE TARGET.
   *
   * `MissionRepositoryTarget.baselineSha` is null by construction — the pure
   * domain cannot read a repository and says so. This is where it becomes known,
   * and it is resolved from the BASE BRANCH rather than from HEAD: HEAD is
   * whatever the founder last checked out, and a Mission measured against that
   * would be measured against an accident.
   */
  const baseline = resolveBaselineSha({ worktreePath: validated.value.root, ref: target.baseBranch });
  if (!baseline.ok) {
    return {
      ok: false,
      reason: `The base branch "${target.baseBranch}" could not be resolved to a revision.`,
    };
  }

  return {
    ok: true,
    source: {
      sourceRepositoryPath: validated.value.root,
      baselineRevision: baseline.value,
      allowedWritePaths: [...intendedWritePaths],
      protectedPaths: { forbidden: [...target.protectedPaths], readOnly: [] },
      disposable: false,
      // Relay does not delete a founder's repository. The WORKTREE is removed by
      // the workspace service; the source is not Relay's to touch.
      dispose: () => undefined,
    },
  };
}
