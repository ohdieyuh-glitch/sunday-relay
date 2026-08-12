import { createLocalDirectoryDeploymentProvider } from './local-directory-deployment-provider';
import { createGitHubRemoteProvider } from './github-remote-provider';
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
 *     authorization is present AND names the credential env var. It is never
 *     constructed from an absent credential name — the credential boundary says
 *     Relay performs remote operations from code that names, server-side, where
 *     the credential is read, and a remote leg with no named credential is a
 *     remote leg that would read `undefined`.
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
     * The env var the push credential is read from, server-side. NAMED here,
     * never the value. A remote authorization that does not name it is refused.
     */
    readonly credentialEnvVarName: string;
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
   * THE REMOTE PROVIDER, only if a remote operation is authorized AND names
   * its credential. Fail-closed: an authorization that omits the credential
   * name is refused before anything runs, rather than building a provider that
   * would read `undefined` and surface a confusing downstream failure.
   */
  let remote: Parameters<typeof runShipLifecycle>[0]['remote'];
  if (authorization.remote === undefined) {
    remote = undefined;
  } else {
    if (authorization.remote.credentialEnvVarName.trim() === '') {
      return {
        ok: false,
        reason: 'A remote ship authorization must name the env var its credential is read from.',
      };
    }
    remote = {
      provider: createGitHubRemoteProvider({
        credentialEnvVarName: authorization.remote.credentialEnvVarName,
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
