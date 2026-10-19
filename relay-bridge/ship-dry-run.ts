import { planDryRun, revalidateRepositoryTarget } from '../src/relay/mission/repository-target';
import type {
  DeployEnvironment,
  DiffJudgement,
  DryRunPlan,
  MissionRepositoryTarget,
  PullRequestEvidence,
  RepositoryRegistration,
} from '../src/relay/mission/repository-target';

/**
 * THE CALLER THE DRY RUN NEVER HAD.
 *
 * `planDryRun` has been built, exported and covered by 19 tests, and
 * `REPOSITORY_TARGETS.md` said it "does not exist" — a stale claim that
 * understated the product in the one section written to be conservative. The
 * real gap was narrower and is this: nothing CALLED it, so the capability
 * existed and nothing offered it.
 *
 * WHY THIS IS NOT A ONE-LINE WRAPPER. A plan is a promise about what a Mission
 * WOULD be allowed to do, and it is read by a founder deciding whether to let
 * it. Rendered from the permissions captured when the target was resolved, it
 * can promise operations the Mission no longer holds — a plan that says "will
 * open a pull request" for a Mission whose `create_pr` was revoked an hour ago.
 * So the registration is re-read here, exactly as `ship-runner.ts` re-reads it
 * before every step, and the plan is rendered from the LIVE set.
 *
 * A dry run is also the one place where being wrong is cheap and therefore
 * tempting: nothing is performed, so an over-generous plan does no immediate
 * damage. It does the damage later, when a founder authorizes a Mission on the
 * strength of it.
 */

export interface ShipDryRunRequest {
  readonly target: MissionRepositoryTarget;
  /** READ, not captured — the same contract as the runner. */
  readonly readRegistration: () => RepositoryRegistration | null;
  readonly judgement: DiffJudgement | null;
  readonly evidence: PullRequestEvidence;
  readonly deployEnvironment?: DeployEnvironment | null;
  readonly now: () => string;
}

export type ShipDryRunResult =
  | { readonly ok: true; readonly plan: DryRunPlan }
  | { readonly ok: false; readonly reason: string };

export function planShipDryRun(request: ShipDryRunRequest): ShipDryRunResult {
  const revalidated = revalidateRepositoryTarget({
    registration: request.readRegistration(),
    target: request.target,
    now: request.now(),
  });
  if (!revalidated.ok) {
    /**
     * A deregistered or narrowed-to-nothing repository gets a refusal rather
     * than an empty plan. An empty plan reads as "this Mission would do
     * nothing", which is a different and much less alarming statement than
     * "this repository is no longer registered".
     */
    return { ok: false, reason: revalidated.problem.message };
  }
  return {
    ok: true,
    plan: planDryRun({
      target: request.target,
      // The LIVE set. Never `request.target.permissions`.
      permissions: revalidated.permissions,
      deployEnvironment: request.deployEnvironment ?? null,
      judgement: request.judgement,
      evidence: request.evidence,
    }),
  };
}
