/**
 * THE SHIPPING LIFECYCLE — what happens AFTER `verified_complete`.
 *
 * Relay's hosted pipeline already ends at `verified_complete`: Prompt Architect
 * → Coding Agent → Relay verification → independent Reviewer → repair →
 * re-review → verified. That part is proven and is NOT re-implemented here.
 * This module is the tail the founder's goal adds:
 *
 *   BUILD → VERIFY → REVIEW → REPAIR → VERIFIED COMPLETE
 *         → COMMIT → PUSH/PR → MERGE (if authorized) → DEPLOY → LIVE VERIFY → SHIPPED
 *
 * THREE WORDS THAT MUST NEVER MERGE, because the whole product is the claim
 * that they do not:
 *
 *   - **Verified Complete** — the artifact passed RELAY. It says nothing about
 *     where the artifact is.
 *   - **Shipped** — the INTENDED REVISION was actually deployed. Not "a deploy
 *     was requested", not "the provider returned 200": the revision the
 *     provider reports serving equals the revision Relay committed.
 *   - **Live** — evidence came back FROM the deployed system. A deployment
 *     record is the provider's account of itself; live evidence is an
 *     observation of the thing it produced.
 *
 * A pipeline that collapses any two of those is a pipeline that can announce a
 * ship it did not perform. So `shipped` is not a stage anything transitions
 * into on request — it is a CONCLUSION computed from evidence by
 * `decideShipped`, and every stage carries the evidence for its own claim.
 *
 * PURE DOMAIN. No Node, no network, no clock. Nothing here performs an act; it
 * decides whether an act is permitted and whether a claim is earned. The
 * providers act, and report back what they OBSERVED.
 */

import type { RepositoryPermission, RepositoryProblem } from './repository-contracts';

/**
 * THE STAGES, in order.
 *
 * `verified_complete` is the JOIN with the existing pipeline and the first
 * stage here, not a new invention — a ship record cannot begin before Relay
 * has earned that word.
 */
export const SHIP_STAGES = [
  'verified_complete',
  'committed',
  'pushed',
  'pull_request_open',
  'merged',
  'deployed',
  'live_verified',
  'shipped',
] as const;
export type ShipStage = (typeof SHIP_STAGES)[number];

/**
 * WHAT EACH STAGE REQUIRES, as data rather than as a chain of `if`s.
 *
 * `permission` is the grant the ACT needs. `from` is the set of stages it may
 * follow. Two entries have no permission and that is deliberate:
 *
 *   - `live_verified` is an OBSERVATION. Observing a deployed system is not a
 *     privilege Relay grants itself; it is the check that the privilege it
 *     already used produced what it claimed.
 *   - `shipped` is a conclusion, not an act. Nothing may transition into it —
 *     see `decideShipped`, and the refusal in `advanceShipStage`.
 */
export const SHIP_STAGE_REQUIREMENTS: Readonly<Record<ShipStage, {
  readonly permission: RepositoryPermission | null;
  readonly from: readonly ShipStage[];
}>> = Object.freeze({
  verified_complete: { permission: null, from: [] },
  committed: { permission: 'commit', from: ['verified_complete'] },
  pushed: { permission: 'push_feature_branch', from: ['committed'] },
  pull_request_open: { permission: 'create_pr', from: ['pushed'] },
  /**
   * MERGE MAY FOLLOW A PULL REQUEST AND NOTHING ELSE. There is no path from
   * `pushed` to `merged`: a merge without a pull request is a push to the base
   * branch wearing a different word, and the base branch is protected.
   */
  merged: { permission: 'merge_pr', from: ['pull_request_open'] },
  /**
   * DEPLOY MAY FOLLOW A MERGE **OR** A PUSH. Deploying an unmerged branch to
   * STAGING is the normal preview flow and refusing it would push founders
   * toward merging in order to test. Which environment is being deployed to
   * decides which permission is required, and that decision is
   * `deployPermissionFor` below — it is NOT in this table, because one stage
   * with two possible permissions is exactly the shape that would let the
   * staging grant authorize a production deploy.
   */
  deployed: { permission: null, from: ['merged', 'pushed', 'committed'] },
  live_verified: { permission: null, from: ['deployed'] },
  shipped: { permission: null, from: ['live_verified'] },
});

/**
 * WHICH PERMISSION A DEPLOY NEEDS. The environment decides, and there are only
 * two answers.
 *
 * **"Build this" never authorizes production.** The founder's goal says so in
 * those words, and this function is where that becomes mechanical: a
 * production deploy asks for `deploy_production` and nothing else satisfies it.
 * `deploy_staging` is a PREREQUISITE of `deploy_production` in the permission
 * ladder, which means holding production implies holding staging — the reverse
 * is what must never happen, and it cannot, because this returns one name.
 */
export const DEPLOY_ENVIRONMENTS = ['staging', 'production'] as const;
export type DeployEnvironment = (typeof DEPLOY_ENVIRONMENTS)[number];

export const deployPermissionFor = (environment: DeployEnvironment): RepositoryPermission =>
  environment === 'production' ? 'deploy_production' : 'deploy_staging';

/* ------------------------------------------------------------- evidence */

/**
 * WHAT RELAY OBSERVED AT ONE STAGE.
 *
 * Every field is what a provider REPORTED BACK, never what Relay asked for.
 * The requested values live on the target and the Mission Contract; these are
 * the other half of the pair, and they are all nullable because "not observed"
 * is a real state that must not render as agreement.
 */
export interface ShipStageEvidence {
  readonly stage: ShipStage;
  readonly observedAt: string;
  /** The commit the provider reports it created. Null until it says. */
  readonly commitSha: string | null;
  /** The branch the provider reports it wrote. */
  readonly branch: string | null;
  /** Remote ref the provider reports it updated, for a push. */
  readonly remoteRef: string | null;
  /** Pull-request number/url, as the provider reports them. */
  readonly pullRequestRef: string | null;
  /** The environment a deploy targeted. */
  readonly environment: DeployEnvironment | null;
  /**
   * THE REVISION THE DEPLOYED SYSTEM REPORTS SERVING. This is the field the
   * word "shipped" is built on. A provider that cannot report it leaves it
   * null, and the Mission is NOT shipped — it is deployed, which is a
   * different and smaller claim.
   */
  readonly deployedRevision: string | null;
  /** Whether an observation of the running system succeeded, and how. */
  readonly liveProbe: LiveProbeResult | null;
  /** Free text, safe. Never a credential, never provider output verbatim. */
  readonly detail: string | null;
}

/**
 * EVIDENCE FROM THE DEPLOYED SYSTEM ITSELF.
 *
 * `reachable` is not `healthy`. A system that answers with a 500 is reachable
 * and not healthy, and a system that answers 200 while serving last week's
 * bundle is both and still not shipped. Three separate fields because they are
 * three separate facts, and the one that matters for shipping —
 * `reportedRevision` — is the one a provider is most likely to be unable to
 * supply.
 */
export interface LiveProbeResult {
  readonly reachable: boolean;
  readonly healthy: boolean;
  /** What the running system says it is serving. Null when it does not say. */
  readonly reportedRevision: string | null;
  /** How the probe was performed, for the audit trail. */
  readonly method: string;
  readonly observedAt: string;
  readonly detail: string | null;
}

/* --------------------------------------------------------- transitions */

export interface ShipTransitionRequest {
  readonly to: ShipStage;
  readonly currentStage: ShipStage;
  /** The permissions live for this Mission RIGHT NOW — see
   *  `revalidateRepositoryTarget`, never the set captured at Mission start. */
  readonly permissions: readonly RepositoryPermission[];
  /** Required when `to` is `deployed`; ignored otherwise. */
  readonly environment?: DeployEnvironment | null;
}

export type ShipTransitionDecision =
  | { readonly ok: true; readonly permissionUsed: RepositoryPermission | null }
  | { readonly ok: false; readonly problem: RepositoryProblem };

const deny = (refusal: RepositoryProblem['refusal'], message: string): ShipTransitionDecision =>
  ({ ok: false, problem: { refusal, message } });

/**
 * MAY THIS MISSION TAKE THIS STEP?
 *
 * Order matters and is the same as `resolveRepositoryTarget`'s: the shape of
 * the request first, then the transition, then the permission. A request to
 * enter an unknown stage must not produce a permission error, because a
 * permission error reads as "grant me more" and the fix is not more permission.
 */
export function advanceShipStage(request: ShipTransitionRequest): ShipTransitionDecision {
  const { to, currentStage, permissions } = request;

  if (!(SHIP_STAGES as readonly string[]).includes(to)) {
    return deny('identity_invalid', `"${String(to)}" is not a shipping stage.`);
  }
  /**
   * NOTHING TRANSITIONS INTO `shipped`.
   *
   * It is a conclusion computed from evidence by `decideShipped`, and if it
   * were reachable here then a caller holding a merge grant could assert a ship
   * it never observed — the exact collapse this module exists to prevent. The
   * refusal names the alternative rather than only saying no.
   */
  if (to === 'shipped') {
    return deny(
      'identity_invalid',
      '"shipped" is not a stage anything advances into. It is decided from live evidence by decideShipped.',
    );
  }
  if (to === 'verified_complete') {
    return deny(
      'identity_invalid',
      '"verified_complete" is earned by Relay\'s own verification and review, not by a shipping transition.',
    );
  }

  const requirement = SHIP_STAGE_REQUIREMENTS[to];
  if (!requirement.from.includes(currentStage)) {
    return deny(
      'identity_invalid',
      `A Mission at "${currentStage}" may not advance to "${to}" (allowed from: ${requirement.from.join(', ')}).`,
    );
  }

  /**
   * THE DEPLOY BRANCH, where the environment decides the permission.
   *
   * A missing environment is REFUSED rather than defaulted. Defaulting to
   * `staging` would look harmless and would mean a caller that forgot to say
   * where it was deploying got a deploy anyway; defaulting to `production`
   * needs no explanation. There is no safe default for this question.
   */
  if (to === 'deployed') {
    const environment = request.environment ?? null;
    if (environment === null) {
      return deny('identity_invalid', 'A deploy must name its environment. There is no default.');
    }
    if (!(DEPLOY_ENVIRONMENTS as readonly string[]).includes(environment)) {
      return deny('identity_invalid', `"${String(environment)}" is not a deploy environment.`);
    }
    const needed = deployPermissionFor(environment);
    if (!permissions.includes(needed)) {
      return deny(
        'permission_not_granted',
        `Deploying to ${environment} requires "${needed}", which this Mission does not hold.`,
      );
    }
    return { ok: true, permissionUsed: needed };
  }

  const needed = requirement.permission;
  if (needed === null) return { ok: true, permissionUsed: null };
  if (!permissions.includes(needed)) {
    return deny('permission_not_granted', `"${to}" requires "${needed}", which this Mission does not hold.`);
  }
  return { ok: true, permissionUsed: needed };
}

/* ------------------------------------------------------------- shipped */

export interface ShipVerdict {
  readonly shipped: boolean;
  /** Present whether shipped or not — it always says WHY. */
  readonly reason: string;
  /** The revision proven to be serving, when it is proven. */
  readonly liveRevision: string | null;
}

/**
 * IS THIS SHIPPED?
 *
 * Four things must all be true, and each one is a real failure mode that has a
 * plausible-sounding near-miss:
 *
 *   1. A commit exists, and Relay knows its SHA. Without it there is nothing
 *      to compare a deployment against — "shipped" would mean "something was
 *      deployed".
 *   2. A deployment reports the revision it deployed. A provider that returned
 *      success without naming a revision has told Relay that it did something,
 *      not what.
 *   3. That deployed revision EQUALS the committed one. This is the check that
 *      catches the most common real failure: a deploy that succeeded against a
 *      stale build, a cached artifact, or the wrong branch.
 *   4. A live probe reached the system, found it healthy, AND — when the system
 *      reports a revision — that revision matches too. A system that does not
 *      report its revision does not block shipping, because many do not; a
 *      system that reports a DIFFERENT one does, because it is telling Relay
 *      the deploy did not take.
 *
 * Anything short of all four returns `shipped: false` WITH the reason. It never
 * returns a partial yes, and it never treats an unreported value as a match.
 */
export function decideShipped(input: {
  readonly committedSha: string | null;
  readonly deployment: ShipStageEvidence | null;
  readonly liveProbe: LiveProbeResult | null;
}): ShipVerdict {
  const { committedSha, deployment, liveProbe } = input;

  if (committedSha === null || committedSha.trim() === '') {
    return { shipped: false, reason: 'No commit was recorded, so there is no revision a deploy could have shipped.', liveRevision: null };
  }
  if (deployment === null) {
    return { shipped: false, reason: 'No deployment was recorded.', liveRevision: null };
  }
  if (deployment.deployedRevision === null) {
    return {
      shipped: false,
      reason: 'The deployment provider did not report which revision it deployed, so the deploy is recorded and the ship is not.',
      liveRevision: null,
    };
  }
  if (deployment.deployedRevision !== committedSha) {
    return {
      shipped: false,
      reason: `The deployed revision (${deployment.deployedRevision}) is not the revision Relay committed (${committedSha}).`,
      liveRevision: null,
    };
  }
  if (liveProbe === null) {
    return { shipped: false, reason: 'The deployed system was never observed, so "live" is unproven.', liveRevision: null };
  }
  if (!liveProbe.reachable) {
    return { shipped: false, reason: 'The deployed system could not be reached.', liveRevision: null };
  }
  if (!liveProbe.healthy) {
    return { shipped: false, reason: 'The deployed system was reached and reported itself unhealthy.', liveRevision: null };
  }
  if (liveProbe.reportedRevision !== null && liveProbe.reportedRevision !== committedSha) {
    return {
      shipped: false,
      reason: `The running system reports serving ${liveProbe.reportedRevision}, not the committed ${committedSha}.`,
      liveRevision: liveProbe.reportedRevision,
    };
  }
  return {
    shipped: true,
    reason:
      liveProbe.reportedRevision === null
        ? `The committed revision ${committedSha} was deployed and the running system is healthy. It does not report its own revision, so the match is the provider's report, not the system's.`
        : `The running system reports serving the committed revision ${committedSha}.`,
    // Only the SYSTEM's own report fills this. The provider's report is not the
    // system speaking, and this field is read as "the system said so".
    liveRevision: liveProbe.reportedRevision,
  };
}

/**
 * THE STAGE A RECORD IS ACTUALLY AT, derived from its evidence.
 *
 * Derived rather than stored, because a stored stage and its evidence can
 * disagree and then the stage wins — which is how a record comes to claim a
 * step it has no evidence for. The evidence is the authority; this reads it.
 */
export function deriveShipStage(input: {
  readonly evidence: readonly ShipStageEvidence[];
  readonly verdict: ShipVerdict;
}): ShipStage {
  if (input.verdict.shipped) return 'shipped';
  const reached = new Set(input.evidence.map((e) => e.stage));
  // Walked backwards from the most advanced stage, so a record with a gap
  // reports the furthest step it actually has evidence for.
  for (const stage of [...SHIP_STAGES].reverse()) {
    if (stage === 'shipped') continue;
    if (reached.has(stage)) return stage;
  }
  return 'verified_complete';
}
