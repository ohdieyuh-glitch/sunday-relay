import { bearerMatches, BRIDGE_TOKEN_ENV, type ReviewerRouteResult } from './reviewer-routes';
import { shipVerifiedMission, disposeRetainedWorktree, type ShipAuthorization } from './ship-mission';
import { observeRepositoryWorktree } from '../src/relay/workspace/repository-target-observer';
import { judgeObservedDiff } from '../src/relay/mission/repository-target';
import type { MissionRepositoryTarget } from '../src/relay/mission/repository-target';
import type { RepositoryRegistrationStore } from '../src/relay/persistence';

/**
 * SHIP A VERIFIED MISSION — operator only, and only what the mission verified.
 *
 * This is the last join: an operator triggers a ship on a mission that reached
 * `verified_complete` against a real repository. It reads the retained worktree
 * the coding leg kept, RE-OBSERVES and RE-JUDGES it (Relay observes the
 * filesystem, never a stored claim), and hands the result to
 * `shipVerifiedMission`. Then it disposes the retained worktree — the resource
 * the coding leg deliberately did not remove.
 *
 * WHAT IT IS, AND IS NOT:
 *   - OPERATOR ONLY. Shipping spends a credential and mutates a real remote; the
 *     same credential that gates registration gates it.
 *   - SEPARATELY AUTHORIZED. The body carries the `ShipAuthorization` — deploy
 *     environment, remote credential env var — and the ship does only what it
 *     names. "MERGE if authorized, DEPLOY when authorized" is the goal's rule.
 *   - RE-JUDGED AT SHIP TIME. The commit is decided from the worktree's ACTUAL
 *     state now, not a judgement stored at coding time. A worktree that changed
 *     between verification and ship would be re-judged and refused, which is the
 *     honest behaviour.
 *   - The registration is READ from the store and passed as `readRegistration`,
 *     so a revocation between verification and ship still lands.
 */

const ok = (data: unknown): ReviewerRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): ReviewerRouteResult =>
  ({ status, body: { error: { kind, message } } });

/** `POST /mission/:id/ship`. */
export function isShipRoute(path: string): boolean {
  return /^\/mission\/[^/]+\/ship$/.test(path);
}

export interface ShipRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` stripped. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
  readonly env: NodeJS.ProcessEnv;
  readonly now: () => string;
}

export interface ShipRouteDeps {
  /** The registry's ship context: target + retained worktree for a verified
   *  real-target mission, or null. */
  readonly shipContext: (missionId: string) => {
    readonly target: MissionRepositoryTarget;
    readonly worktreePath: string;
  } | null;
  readonly store: RepositoryRegistrationStore | null;
}

export async function handleShipRoute(
  request: ShipRouteRequest,
  deps: ShipRouteDeps,
): Promise<ReviewerRouteResult | null> {
  if (request.method !== 'POST' || !isShipRoute(request.path)) return null;

  if (!bearerMatches(request.authorization, request.env[BRIDGE_TOKEN_ENV])) {
    return err(401, 'authentication_failed', 'Shipping a mission is operator-only.');
  }
  if (deps.store === null) {
    return err(503, 'repository_store_unavailable',
      'No durable state root is mounted, so the mission\'s repository cannot be re-read.');
  }

  const missionId = request.path.replace(/^\/mission\/([^/]+)\/ship$/, '$1');

  /**
   * THE MISSION MUST HAVE SOMETHING TO SHIP. `shipContext` returns non-null only
   * for a verified, real-target mission that retained a worktree; anything else
   * is `mission_not_shippable`, before the store or the body is touched.
   */
  const context = deps.shipContext(missionId);
  if (context === null) {
    return err(409, 'mission_not_shippable',
      'This mission is not verified against a real repository with a retained worktree.');
  }

  const registration = deps.store.get(context.target.repositoryKey);
  if (registration === null) {
    return err(404, 'repository_not_registered',
      `The repository "${context.target.repositoryKey}" this mission targeted is no longer registered.`);
  }

  /**
   * RE-OBSERVE AND RE-JUDGE THE RETAINED WORKTREE. The commit is decided from
   * what is on disk NOW, against the target's baseline. A worktree that no
   * longer matches what was verified is re-judged and refused by the runner.
   */
  const observed = observeRepositoryWorktree({
    worktreePath: context.worktreePath,
    baselineSha: context.target.baseBranch,
    now: request.now(),
  });
  if (!observed.ok) {
    return err(422, 'worktree_unreadable',
      `The mission's retained worktree could not be re-observed: ${observed.error.message}`);
  }
  const judgement = judgeObservedDiff({ target: context.target, diff: observed.value });

  const authorization = (request.body ?? {}) as ShipAuthorization;

  /**
   * THE RETAINED WORKTREE IS DISPOSED IN A `finally`, so it goes whether the
   * ship returns a refusal OR THROWS. A review found the disposal was only on
   * the return path, so a thrown git error would leak the worktree — the same
   * resource class the ship exists to release.
   */
  let outcome: Awaited<ReturnType<typeof shipVerifiedMission>>;
  try {
    outcome = await shipVerifiedMission({
      target: context.target,
      readRegistration: () => deps.store!.get(context.target.repositoryKey),
      worktreePath: context.worktreePath,
      judgement,
      commitMessage: `Relay mission ${missionId}: verified change`,
      authorName: 'Relay',
      authorEmail: 'relay@aquala',
      authorization,
      now: request.now,
      env: request.env,
    });
  } finally {
    disposeRetainedWorktree({
      worktreePath: context.worktreePath,
      sourceRepositoryPath: context.target.location.kind === 'local_path'
        ? context.target.location.path
        : context.worktreePath,
      workingBranch: context.target.workingBranch,
    });
  }

  if (!outcome.ok) {
    return err(422, 'ship_refused', outcome.reason);
  }
  return ok({
    missionId,
    stage: outcome.result.stage,
    shipped: outcome.result.verdict?.shipped ?? false,
    stoppedBy: outcome.result.stoppedBy,
    evidence: outcome.result.evidence.map((e) => ({ stage: e.stage, detail: e.detail })),
  });
}
