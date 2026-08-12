import { bearerMatches, BRIDGE_TOKEN_ENV, type ReviewerRouteResult } from './reviewer-routes';
import { shipVerifiedMission, disposeRetainedWorktree, type ShipAuthorization } from './ship-mission';
import { observeRepositoryWorktree, resolveBaselineSha } from '../src/relay/workspace/repository-target-observer';
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
 *     state now, not a judgement stored at coding time — it is re-observed and
 *     re-judged against the target's scope, protected paths and change ceilings.
 *     A change made between verification and ship that lands OUTSIDE that scope,
 *     touches a protected path, or breaches a ceiling is refused; one that stays
 *     inside is accepted, and the shipped record stays truthful about what is
 *     actually on disk. (It is NOT re-compared against the reviewer's artifact
 *     digest here, so this is not a promise that nothing changed since review.)
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
  /** Records that a ship was attempted so the mission stops presenting as
   *  shippable. Called AFTER the worktree is disposed — success, refusal, or
   *  throw — so the registry record matches the now-gone worktree on disk. */
  readonly recordShipOutcome: (missionId: string, outcome: { readonly shipped: boolean }) => void;
  /** Claims the mission for shipping (false if one is already in flight) so two
   *  concurrent ship requests cannot both act; `endShip` releases it. */
  readonly beginShip: (missionId: string) => boolean;
  readonly endShip: (missionId: string) => void;
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
   * what is on disk NOW, against the target's baseline, judged against scope,
   * protected paths and ceilings — a change outside scope is refused by the
   * runner; one inside is committed as-is.
   *
   * PRE-FLIGHT REFUSALS ARE RETRYABLE AND DELIBERATELY KEEP THE WORKTREE. The
   * refusals before the ship acts — repository_not_registered above,
   * worktree_unreadable and baseline_unresolved below — each name a condition an
   * operator can fix and retry (re-register the repo, fix the base branch).
   * Disposing the retained worktree on one of these would destroy a
   * still-shippable deliverable on a fixable error, so disposal stays scoped to
   * the ship attempt's `finally` and to fail()/cancelled() — never a pre-flight
   * refusal. A review flagged the class as implicit; this states it.
   */
  /**
   * A REAL SHA IN THE SHA-TYPED FIELD. A review found the base BRANCH NAME
   * (e.g. "main") flowing into `baselineSha`. `resolveBaselineSha` turns the
   * base branch into the actual revision, which is what the field is for and
   * what a reader who trusts the type will get.
   */
  const baseline = resolveBaselineSha({ worktreePath: context.worktreePath, ref: context.target.baseBranch });
  if (!baseline.ok) {
    return err(422, 'baseline_unresolved',
      `The target's base branch could not be resolved to a revision: ${baseline.error.message}`);
  }
  const observed = observeRepositoryWorktree({
    worktreePath: context.worktreePath,
    baselineSha: baseline.value,
    now: request.now(),
  });
  if (!observed.ok) {
    return err(422, 'worktree_unreadable',
      `The mission's retained worktree could not be re-observed: ${observed.error.message}`);
  }
  const judgement = judgeObservedDiff({ target: context.target, diff: observed.value });

  const authorization = (request.body ?? {}) as ShipAuthorization;

  /**
   * CLAIM THE MISSION FOR SHIPPING BEFORE THE `await`. Two ship requests for the
   * same mission could otherwise interleave across the ship's await — both see a
   * non-null `shipContext` (the record is not updated until the finally) and
   * both dispose and push. The claim is taken synchronously here, so the second
   * request is refused. Taken AFTER every pre-flight refusal above, so a refusal
   * never leaves a mission falsely claimed; released in the `finally` below.
   */
  if (!deps.beginShip(missionId)) {
    return err(409, 'ship_in_progress', 'A ship is already in flight for this mission.');
  }

  /**
   * THE RETAINED WORKTREE IS DISPOSED IN A `finally`, so it goes whether the
   * ship returns a refusal OR THROWS. A review found the disposal was only on
   * the return path, so a thrown git error would leak the worktree — the same
   * resource class the ship exists to release.
   */
  let outcome: Awaited<ReturnType<typeof shipVerifiedMission>>;
  let shipped = false;
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
    shipped = outcome.ok && (outcome.result.verdict?.shipped ?? false);
  } finally {
    disposeRetainedWorktree({
      worktreePath: context.worktreePath,
      sourceRepositoryPath: context.target.location.kind === 'local_path'
        ? context.target.location.path
        : context.worktreePath,
      workingBranch: context.target.workingBranch,
    });
    /**
     * THE MISSION RECORD FOLLOWS THE DISPOSAL. The worktree the ship consumed is
     * now gone; tell the registry so `shipContext` stops offering this mission
     * and a re-ship is refused on explicit state rather than on a git
     * side-effect. Inside the `finally`, so it runs on success, on a refusal,
     * and on a throw — matching the disposal it accompanies. A review (Medium)
     * found the record was never updated, so a shipped mission still read
     * `verified_complete` and still presented as shippable.
     */
    deps.recordShipOutcome(missionId, { shipped });
    // Release the concurrent-ship claim taken before the await. Permanent
    // non-shippability now rests on the shipOutcome recorded just above.
    deps.endShip(missionId);
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
