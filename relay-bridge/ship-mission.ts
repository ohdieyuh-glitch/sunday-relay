import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

import { createLocalDirectoryDeploymentProvider } from './local-directory-deployment-provider';
import { createGitHubRemoteProvider } from './github-remote-provider';
import { resolveRepositoryCredential } from './repository-credential';
import { runShipLifecycle } from './ship-runner';
import type { ShipRunResult } from './ship-runner';
import type {
  DiffJudgement,
  MissionRepositoryTarget,
  RepositoryRegistration,
} from '../src/relay/mission/repository-target';

/**
 * THE SEAM BETWEEN A VERIFIED MISSION AND THE SHIP RUNNER.
 *
 * `runShipLifecycle` has walked COMMIT → … → SHIPPED since PR #122, and nothing
 * in the bridge called it: a hosted mission stopped at `verified_complete`.
 * This is the join, and it is deliberately a SEPARATE operation from the build.
 *
 * SHIPPING IS NOT INFERRED FROM BUILDING. The goal's own lifecycle reads
 * "VERIFIED COMPLETE → COMMIT → PUSH/PR → MERGE **if authorized** → DEPLOY
 * **when authorized**", and "never infer production authorization from build
 * this". So this function takes an EXPLICIT `ShipAuthorization`: what it is not
 * told to do, it does not do. There is no default that ships.
 *
 * WHAT IT COMPOSES, AND WHAT IT REFUSES TO INVENT:
 *   - The deployment provider is built only when a `deploy` authorization is
 *     present. No deploy authorization → the run stops after COMMIT, which is a
 *     complete outcome.
 *   - The remote provider (push/PR/merge) is built only when a `remote`
 *     authorization is present, and its credential is ALWAYS the TARGET's
 *     authorized credential, resolved through `resolveRepositoryCredential` — an
 *     env-var PAT or a short-lived GitHub App installation token. The body may
 *     NAME a credential (checked to equal the target's, requested == actual) but
 *     is never a credential SOURCE, and a body that names one the target does not
 *     authorize is refused before anything runs.
 *   - The registration is READ, not captured: `readRegistration` is threaded
 *     straight through so a revocation between build and ship still lands.
 *
 * It performs no HTTP auth of its own — the route that calls it decides WHO may
 * ship (operator, or a control session), the same boundary every money-spending
 * route already draws. This function decides only WHAT, from what it was told.
 */

export interface ShipAuthorization {
  /** COMMIT is always part of a ship; these two are the optional tail. */
  readonly deploy?: {
    readonly environment: 'staging' | 'production';
    /** The directory the local-directory provider deploys into. Must exist. */
    readonly deployRoot: string;
    /** Base URL the deployed revision is served at, for the live probe. */
    readonly baseUrl: string | null;
  };
  readonly remote?: {
    /** GitHub is the first remote provider; the value is the provider id. */
    readonly provider: 'github';
    /**
     * OPTIONAL. The credential is ALWAYS the target's authorized credential,
     * resolved through `resolveRepositoryCredential` — never a body-supplied env
     * var. When the body names this, it is checked to EQUAL the target's
     * authorized env var (requested == actual) and is otherwise refused; when the
     * body omits it, that is the App-installation path and is allowed. It is
     * never used as a credential SOURCE.
     */
    readonly credentialEnvVarName?: string | null;
    readonly pullRequestTitle: string;
    readonly pullRequestBody: import('../src/relay/mission/repository-target').PullRequestEvidence;
  };
}

export interface ShipMissionRequest {
  readonly target: MissionRepositoryTarget;
  readonly readRegistration: () => RepositoryRegistration | null;
  /** The worktree the coding leg wrote the VERIFIED diff into. Still present. */
  readonly worktreePath: string;
  readonly judgement: DiffJudgement;
  readonly commitMessage: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorization: ShipAuthorization;
  readonly now: () => string;
  /** Injected for tests; production reads it from the process environment. */
  readonly env?: NodeJS.ProcessEnv;
}

export type ShipMissionResult =
  | { readonly ok: true; readonly result: ShipRunResult }
  | { readonly ok: false; readonly reason: string };

export async function shipVerifiedMission(request: ShipMissionRequest): Promise<ShipMissionResult> {
  const { authorization } = request;

  /**
   * THE DEPLOY PROVIDER, only if a deploy is authorized. The environment gate
   * inside `runShipLifecycle` still decides whether THIS provider may serve
   * THAT environment — here we only refuse to build a provider for a deploy
   * nobody asked for.
   */
  const deployment = authorization.deploy === undefined
    ? undefined
    : {
      provider: createLocalDirectoryDeploymentProvider({
        deployRoot: authorization.deploy.deployRoot,
        baseUrl: authorization.deploy.baseUrl,
        now: request.now,
      }),
      environment: authorization.deploy.environment,
      /**
       * The artifact IS the verified worktree: the local-directory provider
       * copies a directory, and the directory the mission verified is the one
       * to deploy. A production provider would take a built bundle instead;
       * that is a different provider, separately authorized.
       */
      artifactPath: request.worktreePath,
      liveUrl: authorization.deploy.baseUrl,
    };

  /**
   * THE REMOTE PROVIDER, only if a remote operation is authorized. Its
   * credential is ALWAYS the TARGET's authorized credential, resolved through
   * the canonical seam `resolveRepositoryCredential` — an env-var PAT
   * (`target.credential.envVarName`) OR a short-lived GitHub App installation
   * token (`target.credential.installationId`), minted fresh per call. Never a
   * body-supplied env var, never a silent PAT fallback.
   *
   * REQUESTED == ACTUAL. If the body DOES name a credential, it must equal the
   * one the target authorizes — a request naming a credential the target does
   * not authorize is refused before anything runs. If the body omits it, that is
   * the installation path (the target authorizes no env var) and is allowed. The
   * body's value is a CHECK, never a source.
   */
  let remote: Parameters<typeof runShipLifecycle>[0]['remote'];
  if (authorization.remote === undefined) {
    remote = undefined;
  } else {
    const authorizedEnvVar = request.target.credential.envVarName;
    const requestedEnvVar = authorization.remote.credentialEnvVarName;
    if (typeof requestedEnvVar === 'string' && requestedEnvVar.trim() !== ''
      && requestedEnvVar.trim() !== (authorizedEnvVar ?? '')) {
      return {
        ok: false,
        reason: authorizedEnvVar === null
          ? `The remote ship names the credential in ${requestedEnvVar.trim()}, but this repository `
            + 'authorizes no environment-variable credential (it uses a GitHub App installation). '
            + 'Relay ships with the credential the target authorizes, not one the request names.'
          : `The remote ship names the credential in ${requestedEnvVar.trim()}, but this repository `
            + `authorizes the credential in ${authorizedEnvVar}. Relay ships with the credential the `
            + 'target authorizes, not one the request names.',
      };
    }
    remote = {
      provider: createGitHubRemoteProvider({
        // Authoritative: the target's env var name, or null for the App path.
        credentialEnvVarName: authorizedEnvVar,
        // THE CANONICAL SEAM. The sole credential source for the provider's API
        // calls — the App installation token for an installation target, the
        // env-var value for an env-var target, null (fail closed) for neither.
        resolveToken: async () => {
          // The SAME base the git-push leg resolves against (ship-runner uses
          // `request.env ?? {}`), never `process.env`: a missing env must fail
          // closed against an empty environment, not silently read a host var.
          const resolved = await resolveRepositoryCredential({
            target: request.target,
            env: request.env ?? {},
          });
          return resolved.ok ? (resolved.value?.token ?? null) : null;
        },
        env: request.env,
        now: request.now,
      }),
      evidence: authorization.remote.pullRequestBody,
    };
  }

  const result = await runShipLifecycle({
    target: request.target,
    readRegistration: request.readRegistration,
    worktreePath: request.worktreePath,
    env: request.env,
    judgement: request.judgement,
    commitMessage: request.commitMessage,
    authorName: request.authorName,
    authorEmail: request.authorEmail,
    remote,
    deployment,
    now: request.now,
  });

  return { ok: true, result };
}


/**
 * DISPOSE A RETAINED WORKTREE — the resource the coding leg kept for shipping.
 *
 * A retained worktree outlives the coding leg only so a ship can commit from
 * it. Whatever ends the mission — a ship (success or refusal), a reviewer
 * rejection, a cancellation, a teardown — must remove it, or it leaks: the
 * directory on disk, its `.git/worktrees` admin entry, and the
 * `relay/mission-*` branch inside the founder's real repository.
 *
 * A review found that `fail()` and `cancelled()` did not dispose it, so an
 * ordinary reviewer rejection leaked one every time. This is the one disposer
 * they share.
 *
 * `sourceRepositoryPath` is the registered repository — the worktree's parent —
 * so `git worktree remove` and the branch delete run there. Best-effort and
 * total: the directory goes even if git cannot prune the admin entry, and a
 * disposal failure never propagates (a mission is not failed by a cleanup it
 * could not finish).
 */
export function disposeRetainedWorktree(input: {
  readonly worktreePath: string;
  readonly sourceRepositoryPath: string;
  /** Kept for the audit trail and future branch policy; the worktree, not the
   *  branch, is what this disposes. */
  readonly workingBranch: string;
}): void {
  void input.workingBranch;
  const git = (args: readonly string[]): void => {
    try {
      execFileSync('git', args, {
        cwd: input.sourceRepositoryPath,
        stdio: 'ignore',
        env: { PATH: process.env.PATH ?? '', HOME: input.sourceRepositoryPath },
      });
    } catch { /* best effort */ }
  };
  // Ask git first so the admin entry goes with the directory...
  git(['worktree', 'remove', '--force', input.worktreePath]);
  // ...then make sure the directory is gone even if git could not.
  try { rmSync(input.worktreePath, { recursive: true, force: true }); } catch { /* best effort */ }
  // Prune any stale admin entry the forced remove left. The working BRANCH is
  // NOT deleted: it holds the mission's commit, and for a local-only ship the
  // branch IS the deliverable. Deleting it would discard the commit the ship
  // just made. A stray branch from a rejected mission is cheap and auditable;
  // an orphaned worktree directory is the disk leak this removes.
  git(['worktree', 'prune']);
}
