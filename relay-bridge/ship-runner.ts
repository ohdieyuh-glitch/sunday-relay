import {
  advanceShipStage,
  decideShipped,
  pushLanded,
  refusePushTarget,
  renderPullRequestBody,
  renderPullRequestTitle,
  revalidateRepositoryTarget,
} from '../src/relay/mission/repository-target';
import { checkoutMatchesIdentity, commitObservedWork } from '../src/relay/workspace/repository-target-observer';
import type {
  DeploymentProvider,
  PullRequestEvidence,
  RemoteRepositoryProvider,
  DiffJudgement,
  LiveProbeResult,
  MissionRepositoryTarget,
  RepositoryRegistration,
  ShipStage,
  ShipStageEvidence,
  ShipVerdict,
} from '../src/relay/mission/repository-target';

/**
 * THE THING THAT ACTUALLY WALKS THE SHIPPING LIFECYCLE.
 *
 * `repository-lifecycle.ts` has been able to DECIDE every step of
 * `COMMIT → PUSH → PR → MERGE → DEPLOY → LIVE VERIFY → SHIPPED` since the
 * feature existed, and nothing in the bridge ever ASKED it. `grep shipStage
 * relay-bridge` returned nothing. So the lifecycle was a set of rules with no
 * subject: Relay could say whether a Mission may deploy and had no code that
 * would then deploy it.
 *
 * This is that subject, for the part that needs no credential. COMMIT is
 * performed by the workspace's existing `commitObservedWork`; DEPLOY and LIVE
 * VERIFY are performed by an injected `DeploymentProvider`. PUSH, PR and MERGE
 * are deliberately NOT here — they need a remote credential, and the credential
 * boundary says Relay performs those itself from separately-audited code after
 * the agent has exited. A runner that quietly skipped them and still reported
 * `shipped` would be the exact failure this module exists to make impossible.
 *
 * THREE PROPERTIES, EACH OF WHICH IS A PAST BUG SOMEWHERE IN THIS REPOSITORY:
 *
 *   1. **Permission is re-read before every step, never captured once.**
 *      `revalidateRepositoryTarget` re-asks the CURRENT registration, and it
 *      can only narrow. A Mission that had `deploy_staging` revoked mid-flight
 *      stops at the next step rather than finishing on a stale grant.
 *   2. **Every stage records what was OBSERVED, not what was attempted.** The
 *      evidence carries the provider's report; nothing is defaulted from the
 *      request. `decideShipped` is what turns evidence into the word "shipped",
 *      and it is never bypassed.
 *   3. **A step that does not happen is not a step that succeeded.** The run
 *      stops at the first refusal and reports the stage it reached. There is no
 *      partial success and no "mostly shipped".
 */

export interface ShipRunRequest {
  readonly target: MissionRepositoryTarget;
  /**
   * READ the registration, at each step. A FUNCTION and not a value, because
   * "re-asks the current registration" is not true of a value handed over once
   * — a frozen copy cannot become current, and revocation mid-run would be
   * unrepresentable. Returns null when the repository has been deregistered.
   *
   * This started as a `RepositoryRegistration` field and the comment above it
   * claimed exactly what this signature now makes true. Mutation testing found
   * it: removing the revalidation entirely still passed every test, because
   * nothing could change between steps.
   */
  readonly readRegistration: () => RepositoryRegistration | null;
  readonly worktreePath: string;
  readonly judgement: DiffJudgement;
  readonly commitMessage: string;
  readonly authorName: string;
  readonly authorEmail: string;
  /**
   * REMOTE OPERATIONS, only if this is given AND the Mission holds the grants.
   *
   * Absent means the run goes from COMMIT straight to DEPLOY and the record
   * says `committed`, never `pushed`. This closes the last "nothing invokes the
   * provider at those stages" gap: the invocation EXISTS now, and what is
   * missing in this environment is a credential rather than code.
   */
  readonly remote?: {
    readonly provider: RemoteRepositoryProvider;
    /**
     * EVIDENCE, NOT PROSE. The runner used to take a free-text `title` and
     * `body` and post them verbatim, which made the founder-facing surface of a
     * Mission able to carry an unverified narrative — "a claim is never
     * presented as evidence" is the contract it broke.
     *
     * The domain already owns the renderer, and `planDryRun` already used it:
     * `renderPullRequestBody` states an absent fact as absent, keeps requested
     * and served separate, and emits a WARNING line when the Reviewer read a
     * different artifact than the one being merged. The thing that actually
     * opens pull requests was the one component bypassing it.
     */
    readonly evidence: PullRequestEvidence;
  };
  /**
   * Deploy only if this is given AND the Mission holds the grant. Absent means
   * the run stops after COMMIT, which is a complete and honest outcome.
   */
  readonly deployment?: {
    readonly provider: DeploymentProvider;
    readonly environment: 'staging' | 'production';
    /** The built artifact. Building is a separate, separately-reported step. */
    readonly artifactPath: string;
    /** Where the deployed system is reachable, for the live probe. */
    readonly liveUrl: string | null;
  };
  readonly now: () => string;
}

export interface ShipRunResult {
  /** The furthest stage actually REACHED, not the furthest requested. */
  readonly stage: ShipStage;
  readonly evidence: readonly ShipStageEvidence[];
  readonly commitSha: string | null;
  readonly verdict: ShipVerdict | null;
  /** Named refusal that stopped the run, or null if it ran to its end. */
  readonly stoppedBy: string | null;
}

/** Re-ask the registration, and refuse if it has narrowed away the grant. */
function stillPermitted(
  request: ShipRunRequest,
  to: ShipStage,
  currentStage: ShipStage,
  environment: 'staging' | 'production' | null,
): { readonly ok: true; readonly target: MissionRepositoryTarget } | { readonly ok: false; readonly reason: string } {
  const revalidated = revalidateRepositoryTarget({
    // Re-READ, every step. Not captured once.
    registration: request.readRegistration(),
    target: request.target,
    now: request.now(),
  });
  if (!revalidated.ok) {
    return { ok: false, reason: revalidated.problem.message };
  }
  const decision = advanceShipStage({
    to,
    currentStage,
    // The LIVE set that `revalidateRepositoryTarget` just returned — never
    // `request.target.permissions`, which is the set captured at Mission start.
    permissions: revalidated.permissions,
    environment,
  });
  if (!decision.ok) return { ok: false, reason: decision.problem.message };
  /**
   * The target handed onward carries the NARROWED permissions.
   *
   * `commitObservedWork` does its own `target.permissions.includes('commit')`
   * check, so passing the original target would re-admit exactly the stale
   * grant this function exists to strip. Revalidation that only guards the
   * gate and then hands the caller the old capability is not revalidation.
   *
   * NO TEST DISTINGUISHES THIS TODAY, and that is worth saying rather than
   * leaving for someone to discover with a mutation run. `advanceShipStage`
   * checks `commit` for the `committed` transition and `commitObservedWork`
   * checks `commit` too, so the gate always refuses first and the narrowed
   * target never gets to matter. It is kept because handing a stale capability
   * onward is wrong in principle and the two checks are free to diverge — but
   * it is defence in depth, not a proven guard, and the difference is the kind
   * of thing this repository keeps getting wrong in the other direction.
   */
  return { ok: true, target: { ...request.target, permissions: revalidated.permissions } };
}

export async function runShipLifecycle(request: ShipRunRequest): Promise<ShipRunResult> {
  const evidence: ShipStageEvidence[] = [];
  let stage: ShipStage = 'verified_complete';

  /* ------------------------------------------------------------- COMMIT */

  /**
   * THE CHECKOUT MUST BE THE REGISTERED REPOSITORY, CHECKED HERE TOO.
   *
   * Relaxing the domain rule to allow a remote-hosted target to name a LOCAL
   * checkout rests entirely on comparing the checkout's `origin` with the
   * registered identity. That comparison lived only in `repository-source.ts`,
   * the CODING leg — and this is the module that commits, pushes, opens the
   * pull request and merges. A review proved the gap by handing the runner a
   * scratch checkout under an `acme/production` identity: it committed the
   * scratch work and pushed it to production, which is verbatim the scenario
   * the relaxation's own comment says is prevented.
   *
   * `worktreePath` is an independent parameter, so the check is against what
   * this runner will actually write to, not against what the target says.
   */
  if (request.target.identity.provider !== 'local') {
    const agrees = checkoutMatchesIdentity({
      worktreePath: request.worktreePath,
      host: request.target.identity.host,
      owner: request.target.identity.owner,
      name: request.target.identity.name,
    });
    if (!agrees.ok) {
      return { stage, evidence: [], commitSha: null, verdict: null, stoppedBy: agrees.error.message };
    }
  }

  const commitGate = stillPermitted(request, 'committed', stage, null);
  if (!commitGate.ok) {
    return { stage, evidence, commitSha: null, verdict: null, stoppedBy: commitGate.reason };
  }

  const committed = commitObservedWork({
    target: commitGate.target,
    worktreePath: request.worktreePath,
    judgement: request.judgement,
    message: request.commitMessage,
    authorName: request.authorName,
    authorEmail: request.authorEmail,
  });
  if (!committed.ok) {
    return { stage, evidence, commitSha: null, verdict: null, stoppedBy: committed.error.message };
  }
  stage = 'committed';
  const commitSha = committed.value.commitSha;
  evidence.push({
    stage: 'committed',
    observedAt: request.now(),
    // READ from git by the workspace, not assembled here.
    commitSha,
    branch: commitGate.target.workingBranch,
    remoteRef: null,
    pullRequestRef: null,
    environment: null,
    deployedRevision: null,
    liveProbe: null,
    detail: null,
  });

  /* --------------------------------------------------- PUSH / PR / MERGE */

  if (request.remote !== undefined) {
    const { provider: remote, evidence: prEvidence } = request.remote;

    const pushGate = stillPermitted(request, 'pushed', stage, null);
    if (!pushGate.ok) {
      return { stage, evidence, commitSha, verdict: null, stoppedBy: pushGate.reason };
    }
    const target = pushGate.target;
    /**
     * WHERE, not just WHETHER. The ladder decides if a Mission may push; this
     * decides where, and they are different questions — a Mission can hold
     * `push_feature_branch` legitimately and still have no business pushing the
     * base branch.
     */
    const wrongTarget = refusePushTarget({
      branch: target.workingBranch,
      baseBranch: target.baseBranch,
      protectedBranches: target.protectedBranches,
    });
    if (wrongTarget !== null) {
      return { stage, evidence, commitSha, verdict: null, stoppedBy: wrongTarget.message };
    }

    /**
     * AN UNKNOWN OWNER IS REFUSED, NOT DEFAULTED. `owner ?? ''` sent an empty
     * segment to the provider and reported a complete `pull_request_open`
     * outcome for a repository with no remote owner. "Unknown is not zero.
     * Never a default" is the rule, and relying on GitHub to reject the empty
     * string makes the provider the guard instead of Relay.
     */
    if (target.identity.owner === null || target.identity.owner.trim() === '') {
      return {
        stage, evidence, commitSha, verdict: null,
        stoppedBy: 'This repository has no remote owner recorded, so Relay will not perform a remote operation for it.',
      };
    }
    const owner = target.identity.owner;

    /**
     * REGISTERED IS NOT THE SAME AS DRIVABLE, and the descriptor is what says so.
     *
     * The runner used to ignore `remote.descriptor` entirely. Two things follow
     * from that, and a review found both:
     *
     *   - `descriptor.supports` is the provider's own statement of what this
     *     implementation can actually DO. Calling `mergePullRequest` on a
     *     provider that does not list `merge_pr` is asking for an operation
     *     nobody built, and — before the Critical fix — a refusal from it was
     *     recorded as a merge.
     *   - `descriptor.credentialEnvVarName` is the env var the provider reads.
     *     The registration NAMES the credential the founder authorized for this
     *     repository. A provider holding a DIFFERENT credential would have been
     *     driven without complaint, which is a credential boundary crossed
     *     silently — the one failure the boundary exists to make impossible.
     *
     * Both are checked before any network call, and both refuse by name.
     */
    const authorizedEnvVar = target.credential.envVarName;
    if (authorizedEnvVar !== null && remote.descriptor.credentialEnvVarName !== authorizedEnvVar) {
      return {
        stage, evidence, commitSha, verdict: null,
        stoppedBy:
          `This repository authorizes the credential in ${authorizedEnvVar}, and the provider reads `
          + `${remote.descriptor.credentialEnvVarName ?? 'none'}. Relay will not act on a credential it was not given.`,
      };
    }
    const unsupported = (permission: 'push_feature_branch' | 'create_pr' | 'merge_pr'): boolean =>
      !remote.descriptor.supports.includes(permission);
    if (unsupported('push_feature_branch')) {
      return {
        stage, evidence, commitSha, verdict: null,
        stoppedBy: `Provider "${remote.descriptor.providerId}" does not support pushing a feature branch.`,
      };
    }

    const pushed = await remote.push({
      repositoryKey: target.repositoryKey,
      owner,
      repo: target.identity.name,
      branch: target.workingBranch,
      expectedHeadSha: commitSha,
    });
    /**
     * A provider reporting success is the provider's account of itself.
     * `pushLanded` compares the OBSERVED tip with what Relay committed, and an
     * unreported tip is unknown rather than agreement.
     */
    const landed = pushLanded({ expectedHeadSha: commitSha, observation: pushed });
    /**
     * THE ROW IS WRITTEN AFTER THE OUTCOME IS KNOWN, NEVER BEFORE.
     *
     * Written first, a refused push leaves a `pushed` row in the evidence while
     * the run's own `stage` says `committed` — and `deriveShipStage` reads the
     * EVIDENCE, so the two authorities disagree and the more optimistic one
     * wins. The deploy path already got this right with a distinct
     * `deployment_failed` stage; this leg did not.
     */
    if (!landed.landed) {
      return { stage, evidence, commitSha, verdict: null, stoppedBy: landed.reason };
    }
    evidence.push({
      stage: 'pushed', observedAt: pushed.observedAt, commitSha,
      /**
       * The provider's OBSERVED tip. No test distinguishes this from
       * `commitSha`, and none can: `pushLanded` only lets the run continue when
       * the two are equal, so on every reachable success path they are the same
       * string. Recorded rather than left for the next mutation run to find —
       * the same structural limit `deployedRevision` has, and the reason the
       * enforcement lives in `pushLanded` rather than here.
       */
      branch: pushed.branch, remoteRef: pushed.observedHeadSha, pullRequestRef: null,
      environment: null, deployedRevision: null, liveProbe: null, detail: landed.reason,
    });
    stage = 'pushed';

    const prGate = stillPermitted(request, 'pull_request_open', stage, null);
    if (prGate.ok && !unsupported('create_pr')) {
      const opened = await remote.openPullRequest({
        owner, repo: target.identity.name,
        head: target.workingBranch, base: target.baseBranch,
        title: renderPullRequestTitle(prEvidence),
        // Rendered from the SAME live permissions the run is acting under.
        body: renderPullRequestBody({
          target: prGate.target,
          permissions: prGate.target.permissions,
          evidence: prEvidence,
          judgement: request.judgement,
        }),
      });
      if (!opened.ok) {
        // No row. A pull request that was refused is not an open one.
        return {
          stage, evidence, commitSha, verdict: null,
          stoppedBy: opened.detail ?? 'The pull request was not opened.',
        };
      }
      evidence.push({
        stage: 'pull_request_open', observedAt: opened.observedAt, commitSha,
        branch: target.workingBranch, remoteRef: null, pullRequestRef: opened.reference,
        environment: null, deployedRevision: null, liveProbe: null, detail: opened.detail,
      });
      stage = 'pull_request_open';

      /**
       * MERGE IS NEVER IMPLIED. `merge_pr` is one of the two high-consequence
       * grants that may not be inferred, defaulted or carried over, so a
       * Mission without it stops here with its pull request open — the correct
       * and complete outcome, not a failure.
       */
      const mergeGate = stillPermitted(request, 'merged', stage, null);
      if (mergeGate.ok && !unsupported('merge_pr') && opened.reference !== null) {
        const merged = await remote.mergePullRequest({
          owner, repo: target.identity.name,
          reference: opened.reference,
        });
        /**
         * A MERGE THE PROVIDER REFUSED IS NOT A MERGE.
         *
         * This row used to be pushed unconditionally with only `stage` guarded,
         * so a provider answering `ok: false` produced a `merged` evidence row
         * with `detail: null`, `deriveShipStage` returning `merged`, and Project
         * Brain recording "reached merged" — on a run that returned
         * `stoppedBy: null`. Relay claiming a merge that did not happen is the
         * most serious thing this module could do, and an independent review
         * found it by driving a refusing provider.
         */
        if (!merged.ok) {
          /**
           * A REFUSED MERGE DOES NOT CANCEL AN AUTHORIZED DEPLOY.
           *
           * Returning here made a transient merge failure — GitHub answering
           * 500, a branch-protection rule, a race — abandon a staging deploy
           * that does not depend on the merge at all: the deploy ships
           * `commitSha` from the working branch, which is exactly the preview
           * flow the lifecycle says it wants to support. It also reproduced the
           * defect just repaired one stage up: a Mission holding `merge_pr` was
           * left WORSE OFF than one without it, which stops cleanly at
           * `pull_request_open` and deploys.
           *
           * The refusal is recorded on the row that is true — the pull request
           * IS open — and the run continues. `stoppedBy` is reserved for what
           * actually stops it.
           */
          const openRow = evidence[evidence.length - 1];
          if (openRow !== undefined && openRow.stage === 'pull_request_open') {
            evidence[evidence.length - 1] = {
              ...openRow,
              detail: merged.detail ?? 'The pull request was not merged.',
            };
          }
          // Stage stays `pull_request_open`: that is what is true.
        } else {
          evidence.push({
            stage: 'merged', observedAt: merged.observedAt, commitSha,
            branch: target.baseBranch, remoteRef: null, pullRequestRef: merged.reference,
            environment: null, deployedRevision: null, liveProbe: null, detail: merged.detail,
          });
          stage = 'merged';
        }
      }
    }
  }

  if (request.deployment === undefined) {
    // Committed and not deployed. A complete outcome, and the result says so
    // by reporting the stage it reached rather than an absent `verdict`.
    return { stage, evidence, commitSha, verdict: null, stoppedBy: null };
  }

  /* ------------------------------------------------------------- DEPLOY */

  const { provider, environment, artifactPath, liveUrl } = request.deployment;

  const deployGate = stillPermitted(request, 'deploying', stage, environment);
  if (!deployGate.ok) {
    return { stage, evidence, commitSha, verdict: null, stoppedBy: deployGate.reason };
  }
  stage = 'deploying';

  const observation = await provider.deploy({
    repositoryKey: deployGate.target.repositoryKey,
    environment,
    // The revision Relay COMMITTED, read back from git above.
    revision: commitSha,
    branch: deployGate.target.workingBranch,
    artifactPath,
    requestedAt: request.now(),
  });

  if (!observation.ok) {
    stage = 'deployment_failed';
    evidence.push({
      stage: 'deployment_failed',
      observedAt: observation.observedAt,
      commitSha,
      branch: deployGate.target.workingBranch,
      remoteRef: null,
      pullRequestRef: null,
      environment: observation.environment,
      deployedRevision: observation.deployedRevision,
      liveProbe: null,
      detail: observation.detail,
    });
    return { stage, evidence, commitSha, verdict: null, stoppedBy: observation.detail ?? 'The deploy failed.' };
  }

  /**
   * `deployed` IS THE TRANSITION AND NOT A SECOND AUTHORIZATION.
   *
   * The lifecycle requires `deployed` to follow only `deploying`, so it is
   * validated — but it is deliberately NOT revalidated against the
   * registration, and that is the domain's own rule rather than a shortcut:
   *
   *   "`deployed` is an OBSERVATION that the deploy completed, and re-demanding
   *    the permission there would mean a Mission whose grant expired mid-deploy
   *    could not record what had already happened."
   *
   * This originally called `stillPermitted` here. That looked more careful and
   * was worse: a repository deregistered while the deploy was in flight would
   * have suppressed the record of a deploy that REALLY HAPPENED, which is the
   * record's most important moment. Refusing to write down a real event is not
   * a safety property.
   */
  const transition = advanceShipStage({
    to: 'deployed',
    currentStage: stage,
    permissions: commitGate.target.permissions,
    environment,
  });
  if (!transition.ok) {
    return { stage, evidence, commitSha, verdict: null, stoppedBy: transition.problem.message };
  }
  const deployedGate = { target: deployGate.target };
  stage = 'deployed';

  /* --------------------------------------------------------- LIVE VERIFY */

  let liveProbe: LiveProbeResult | null = null;
  if (liveUrl !== null && provider.descriptor.canVerifyLive) {
    liveProbe = await provider.verifyLive({
      url: liveUrl,
      expectedRevision: commitSha,
      observedAt: request.now(),
    });
  }

  const deployEvidence: ShipStageEvidence = {
    stage: 'deployed',
    observedAt: observation.observedAt,
    commitSha,
    branch: deployedGate.target.workingBranch,
    remoteRef: null,
    pullRequestRef: null,
    environment: observation.environment,
    // What the PROVIDER reported. Never `commitSha`, which is what makes a
    // deploy of a stale build detectable at all.
    deployedRevision: observation.deployedRevision,
    liveProbe,
    detail: observation.detail,
  };
  evidence.push(deployEvidence);

  /* -------------------------------------------------------------- SHIPPED */

  const verdict = decideShipped({ committedSha: commitSha, deployment: deployEvidence, liveProbe });
  if (!verdict.shipped) {
    // Deployed and not shipped. Two different facts, and the gap between them
    // is the whole reason the live probe exists.
    return { stage, evidence, commitSha, verdict, stoppedBy: verdict.reason };
  }

  /**
   * `live_verified` IS A STAGE, AND THE RUNNER WAS SKIPPING IT.
   *
   * The table is `deployed → live_verified → shipped`. This went from
   * `deployed` straight to `shipped`, which `advanceShipStage` ALWAYS denies —
   * so a genuinely shipped run returned `stage: 'deployed'` with an internal
   * refusal string in `stoppedBy`, while `deriveShipStage` read the evidence
   * and said SHIPPED. Two authorities disagreeing on the SUCCESS path, and any
   * caller treating `stoppedBy !== null` as failure recorded a failed Mission
   * for a successful ship. The lines after the gate were dead code.
   *
   * The runner already PERFORMS the live verification; it simply never wrote
   * the stage down. Recording it is both the fix and the more truthful record —
   * "the running system was observed" is a fact worth having in the evidence,
   * separate from the conclusion drawn from it.
   */
  const liveGate = stillPermitted(request, 'live_verified', stage, environment);
  if (!liveGate.ok) {
    return { stage, evidence, commitSha, verdict, stoppedBy: liveGate.reason };
  }
  stage = 'live_verified';
  evidence.push({
    stage: 'live_verified',
    observedAt: liveProbe?.observedAt ?? request.now(),
    commitSha,
    branch: liveGate.target.workingBranch,
    remoteRef: null,
    pullRequestRef: null,
    environment: observation.environment,
    deployedRevision: observation.deployedRevision,
    liveProbe,
    detail: liveProbe?.detail ?? null,
  });

  /**
   * `shipped` IS NOT GATED, AND MUST NOT BE. The lifecycle is explicit that it
   * "is a conclusion, not an act — nothing may transition into it", so
   * `advanceShipStage({ to: 'shipped' })` ALWAYS denies. Asking it here turned
   * every successful ship into a stopped run carrying an internal refusal
   * string, while `deriveShipStage` read the evidence and said SHIPPED.
   *
   * `decideShipped` is the authority, and it has already answered above: it
   * required a commit, a deployment, a deployed revision matching that commit,
   * a reachable and healthy system, and a reported revision that matches. A
   * second gate could only ever disagree with a verdict already computed from
   * the evidence.
   */
  stage = 'shipped';
  evidence.push({
    stage: 'shipped',
    observedAt: request.now(),
    commitSha,
    branch: liveGate.target.workingBranch,
    remoteRef: null,
    pullRequestRef: null,
    environment: observation.environment,
    deployedRevision: observation.deployedRevision,
    liveProbe,
    detail: null,
  });

  return { stage, evidence, commitSha, verdict, stoppedBy: null };
}
