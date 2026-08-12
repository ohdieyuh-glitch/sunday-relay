import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSafeEditFixture } from '../src/relay/connectors/claude-code/fixture';
import {
  checkoutMatchesIdentity,
  resolveBaselineSha,
} from '../src/relay/workspace/repository-target-observer';
import { validateSourceRepository } from '../src/relay/workspace/repository-inspector';
import { pathInScope, protectedPathMatches } from '../src/relay/mission/repository-target';
import type { MissionRepositoryTarget } from '../src/relay/mission/repository-target';
import { envVarCredentialProvider, buildEphemeralGitAuth } from './repository-credential';
import { cloneAuthorizedRepository } from './repository-remote-transport';

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
  /** Server-side environment the credential seam resolves the token from. */
  env: NodeJS.ProcessEnv = process.env,
): RepositorySourceResult {
  /**
   * CHEAP CONFIGURATION CHECKS FIRST — never spend a network clone on a Mission
   * that is misconfigured. write_worktree, a narrowed intent, and scope/protected
   * containment do not depend on where the code comes from.
   */
  if (!target.permissions.includes('write_worktree')) {
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
   * OBTAIN THE SOURCE. A `local_path` names a checkout already on disk; a
   * `remote_clone` is fetched over authenticated HTTPS into the isolated
   * workspace. Either way the checkout's own `origin` is verified against the
   * registered identity before a worktree exists, so Relay never commits a
   * scratch directory and pushes it to a repository nobody registered.
   */
  const obtained = target.location.kind === 'local_path'
    ? obtainLocalCheckout(target, target.location.path)
    : obtainRemoteClone(target, target.location.cloneUrl, env);
  if (!obtained.ok) return { ok: false, reason: obtained.reason };

  return {
    ok: true,
    source: {
      sourceRepositoryPath: obtained.root,
      baselineRevision: obtained.baselineRevision,
      allowedWritePaths: [...intendedWritePaths],
      protectedPaths: { forbidden: [...target.protectedPaths], readOnly: [] },
      disposable: false,
      dispose: obtained.dispose,
    },
  };
}

type ObtainedSource =
  | { readonly ok: true; readonly root: string; readonly baselineRevision: string; readonly dispose: () => void }
  | { readonly ok: false; readonly reason: string };

/**
 * A REMOTE-HOSTED REPOSITORY ALREADY CHECKED OUT LOCALLY. The checkout's own
 * `origin` must name this exact repository (for a `github` identity), or Relay
 * would commit a scratch directory and push it to production. Relay does not
 * delete a founder's checkout — `dispose` is a no-op.
 */
function obtainLocalCheckout(target: MissionRepositoryTarget, path: string): ObtainedSource {
  const validated = validateSourceRepository(path);
  if (!validated.ok) return { ok: false, reason: `Repository path refused: ${validated.error.message}` };

  if (target.identity.provider !== 'local') {
    const agrees = checkoutMatchesIdentity({
      worktreePath: validated.value.root,
      host: target.identity.host,
      owner: target.identity.owner,
      name: target.identity.name,
    });
    if (!agrees.ok) return { ok: false, reason: agrees.error.message };
  }
  const baseline = resolveBaselineSha({ worktreePath: validated.value.root, ref: target.baseBranch });
  if (!baseline.ok) {
    return { ok: false, reason: `The base branch "${target.baseBranch}" could not be resolved to a revision.` };
  }
  return { ok: true, root: validated.value.root, baselineRevision: baseline.value, dispose: () => undefined };
}

/**
 * A REMOTE REPOSITORY, CLONED OVER AUTHENTICATED HTTPS.
 *
 * The credential is resolved from the seam (the named env var today, a GitHub
 * App installation token later) and injected only for the clone child; the clone
 * refuses redirects and is verified against the registered identity, and the
 * baseline is read from the base branch of the clone.
 *
 * `dispose` is a NO-OP on purpose: the retained worktree the ship pushes from is
 * a `git worktree` of this clone, so the clone must outlive the coding leg's
 * `finally`. It lives under the OS temp dir and is reclaimed on the next deploy;
 * a follow-up removes it as part of the retained-worktree disposal.
 */
function obtainRemoteClone(target: MissionRepositoryTarget, cloneUrl: string, env: NodeJS.ProcessEnv): ObtainedSource {
  const credential = envVarCredentialProvider(env).resolve(target);
  const auth = buildEphemeralGitAuth(credential);
  const parent = mkdtempSync(join(tmpdir(), 'relay-remote-src-'));
  const dest = join(parent, 'checkout');
  try {
    const cloned = cloneAuthorizedRepository({
      cloneUrl,
      destPath: dest,
      runFrom: parent,
      baseBranch: target.baseBranch,
      identity: target.identity,
      auth,
    });
    if (!cloned.ok) {
      rmSync(parent, { recursive: true, force: true });
      return { ok: false, reason: cloned.error.message };
    }
    return {
      ok: true,
      root: cloned.value.root,
      baselineRevision: cloned.value.baselineRevision,
      dispose: () => undefined,
    };
  } finally {
    // Remove the askpass helper immediately; the token is already out of every
    // child env. The ship's push resolves a fresh credential of its own.
    auth.dispose();
  }
}
