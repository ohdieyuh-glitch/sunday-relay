import type {
  MissionRepositoryTarget,
  RepositoryPermission,
  RepositoryProblem,
} from './repository-contracts';
import type { DiffJudgement } from './repository-observation';
import { renderPermissionLine } from './repository-authorization';
import { SHIP_STAGE_REQUIREMENTS, deployPermissionFor, type DeployEnvironment, type ShipStage } from './repository-lifecycle';

/**
 * DRY RUN — produce the branch and the pull-request body, and perform nothing.
 *
 * `FUTURE_GOAL_CONFIGURABLE_REPOSITORY_TARGETS.md` names this as one of four
 * things that must be true before Relay writes to a repository anybody cares
 * about: *"A dry-run mode exists: produce the branch and the PR body, push
 * nothing. The first real repository Mission should be observable before it is
 * consequential."*
 *
 * THIS MODULE CANNOT PERFORM ANYTHING, and that is structural rather than
 * promised. It is pure domain: it imports no Node builtin, opens no socket and
 * touches no disk. It returns a DESCRIPTION of the remote operations a Mission
 * would attempt, in order, with the permission each one needs and whether the
 * Mission holds it. A dry run that could accidentally push would be worth less
 * than no dry run at all, so the capability is absent rather than guarded.
 *
 * The mission-layer purity guard in `relay-core-boundary.test.ts` greps raw text
 * for the process- and filesystem-API names, so this note deliberately does not
 * spell them. An earlier draft listed them to say it uses none and tripped the
 * guard — prose discussing a capability is not a capability, but the guard is a
 * security guard and narrowing it to accommodate a comment is the wrong trade.
 *
 * WHAT IT IS FOR, precisely: a founder can read what Relay is about to do to
 * their repository, in the order it will happen, before any of it happens — and
 * can see which steps would be REFUSED, which is the part a live run only
 * reveals after the money is spent.
 */

/** One remote operation a Mission would attempt, and whether it may. */
export interface PlannedOperation {
  /** The lifecycle stage this operation would reach. */
  readonly stage: ShipStage;
  /** Imperative, human-facing. Never a shell command — this is not a script. */
  readonly description: string;
  readonly permission: RepositoryPermission | null;
  /** True only when the Mission's live permissions include `permission`. */
  readonly authorized: boolean;
  /** Present when `authorized` is false. */
  readonly refusal: RepositoryProblem | null;
}

export interface DryRunPlan {
  readonly repositoryKey: string;
  readonly baseBranch: string;
  readonly workingBranch: string;
  /** The operations, in the order they would occur. */
  readonly operations: readonly PlannedOperation[];
  /**
   * The furthest stage this Mission could actually reach with the permissions it
   * holds. **Never `shipped`** — shipping is decided from live evidence by
   * `decideShipped`, and a plan has no evidence. A plan that predicted a ship
   * would be the plan asserting the outcome it exists to preview.
   */
  readonly furthestAuthorizedStage: ShipStage;
  /** Every operation that would be refused, so a founder sees them together. */
  readonly refusals: readonly RepositoryProblem[];
  /** The pull-request body, rendered. Empty when `create_pr` is not held. */
  readonly pullRequestBody: string;
  readonly pullRequestTitle: string;
  /** Stated in the plan so nobody has to infer it from the absence of an error. */
  readonly performed: false;
}

/**
 * What a Mission would do, in order.
 *
 * `deployEnvironment` is REQUIRED to include a deploy step and there is no
 * default — the same rule `advanceShipStage` enforces, for the same reason: a
 * plan that silently previewed a staging deploy for a caller who meant
 * production would be a preview of the wrong thing, which is worse than no
 * preview.
 */
export function planDryRun(input: {
  readonly target: MissionRepositoryTarget;
  /** The Mission's LIVE permissions — see `revalidateRepositoryTarget`. */
  readonly permissions: readonly RepositoryPermission[];
  readonly deployEnvironment?: DeployEnvironment | null;
  readonly judgement: DiffJudgement | null;
  readonly evidence: PullRequestEvidence;
}): DryRunPlan {
  const { target, permissions } = input;
  const held = (permission: RepositoryPermission | null): boolean =>
    permission === null || permissions.includes(permission);

  const step = (stage: ShipStage, description: string, permission: RepositoryPermission | null): PlannedOperation => ({
    stage,
    description,
    permission,
    authorized: held(permission),
    refusal: held(permission)
      ? null
      : {
        refusal: 'permission_not_granted',
        message: `"${stage}" needs "${String(permission)}", which this Mission does not hold.`,
      },
  });

  const operations: PlannedOperation[] = [
    step(
      'committed',
      input.judgement === null
        ? `Commit the accepted changes to ${target.workingBranch}. No diff has been judged yet, so the file list is not known.`
        : `Commit ${String(input.judgement.committablePaths.length)} file(s) to ${target.workingBranch}: `
          + `${input.judgement.committablePaths.join(', ')}.`,
      SHIP_STAGE_REQUIREMENTS.committed.permission,
    ),
    step(
      'pushed',
      `Push ${target.workingBranch} to the remote. The base branch ${target.baseBranch} is never pushed to.`,
      SHIP_STAGE_REQUIREMENTS.pushed.permission,
    ),
    step(
      'pull_request_open',
      `Open a pull request from ${target.workingBranch} into ${target.baseBranch}, carrying the Mission's evidence.`,
      SHIP_STAGE_REQUIREMENTS.pull_request_open.permission,
    ),
    step('merged', 'Merge that pull request.', SHIP_STAGE_REQUIREMENTS.merged.permission),
  ];

  const environment = input.deployEnvironment ?? null;
  if (environment !== null) {
    operations.push(
      step(
        'deployed',
        `Deploy to ${environment}.`,
        // The environment decides the permission, never the stage table. A
        // single stage with two possible permissions is exactly the shape that
        // would let the staging grant preview a production deploy.
        deployPermissionFor(environment),
      ),
      step(
        'live_verified',
        'Observe the deployed system and compare the revision it reports with the one committed.',
        SHIP_STAGE_REQUIREMENTS.live_verified.permission,
      ),
    );
  }

  /**
   * THE FURTHEST STAGE, walked from the front and stopping at the first refusal.
   *
   * Not "the last authorized operation": a Mission that may commit and deploy
   * but may not push cannot reach the deploy, because the deploy follows the
   * push. Taking the last authorized entry would report a stage the Mission
   * cannot arrive at.
   */
  let furthest: ShipStage = 'verified_complete';
  for (const operation of operations) {
    if (!operation.authorized) break;
    furthest = operation.stage;
  }

  const canOpenPr = held('create_pr');
  return {
    repositoryKey: target.repositoryKey,
    baseBranch: target.baseBranch,
    workingBranch: target.workingBranch,
    operations,
    furthestAuthorizedStage: furthest,
    refusals: operations.map((o) => o.refusal).filter((r): r is RepositoryProblem => r !== null),
    pullRequestTitle: canOpenPr ? renderPullRequestTitle(input.evidence) : '',
    // Rendered only when the Mission could actually open one. A body for a pull
    // request that cannot be opened reads as a plan to open it.
    pullRequestBody: canOpenPr ? renderPullRequestBody({ target, permissions, evidence: input.evidence, judgement: input.judgement }) : '',
    performed: false,
  };
}

/* ------------------------------------------------------- the PR body */

/**
 * THE EVIDENCE A PULL REQUEST CARRIES.
 *
 * The design document is specific: *"The PR body carries the Mission's evidence:
 * the attestations, the Reviewer's verdict and findings, the artifact digest, and
 * what Relay verified itself. A reviewer on GitHub should see the same evidence
 * Relay saw."*
 *
 * Every field is nullable, and none is defaulted. A Mission whose reviewer did
 * not run renders "no independent review was performed" — not an empty section,
 * and never a blank that reads as approval.
 */
export interface PullRequestEvidence {
  readonly missionId: string;
  readonly objective: string;
  /** Digest of the artifact Relay verified. Null when there is none. */
  readonly artifactDigest: string | null;
  /** The digest the Reviewer actually read. Null when no review ran. */
  readonly reviewedArtifactDigest: string | null;
  readonly reviewerVerdict: 'approved' | 'changes_required' | 'unable_to_review' | null;
  readonly reviewerFindings: readonly { readonly severity: string; readonly requirement: string }[];
  /** What Relay checked ITSELF, in its own words. Never the agent's claim. */
  readonly relayVerification: readonly string[];
  /** One line per role: who was requested, who ran, which model answered. */
  readonly attestations: readonly {
    readonly role: string;
    readonly requestedActor: string;
    readonly actualActor: string;
    readonly requestedModel: string | null;
    readonly servedModel: string | null;
    readonly completionVerified: boolean;
    readonly fallbackOccurred: boolean;
  }[];
  readonly baselineSha: string | null;
}

export const renderPullRequestTitle = (evidence: PullRequestEvidence): string =>
  `${evidence.objective} (Relay mission ${evidence.missionId})`;

/**
 * Render the body.
 *
 * THREE RULES, each of which the repository has been burned by elsewhere:
 *
 *   1. **An absent fact says it is absent.** No section is omitted to hide a
 *      gap: a missing reviewer verdict renders a sentence saying no review ran.
 *      A body with no "Review" heading reads as a body from before reviews
 *      existed; a body whose Review section says "none" cannot be misread.
 *   2. **Requested and served are separate, here too.** This is a founder-facing
 *      surface, and it is the exact surface defect 3 was about.
 *   3. **The digests are printed side by side.** `artifactDigest` and
 *      `reviewedArtifactDigest` differing means the Reviewer read something
 *      other than what is being merged, and a reader can only notice that if
 *      both are shown.
 */
export function renderPullRequestBody(input: {
  readonly target: MissionRepositoryTarget;
  readonly permissions: readonly RepositoryPermission[];
  readonly evidence: PullRequestEvidence;
  readonly judgement: DiffJudgement | null;
}): string {
  const { target, evidence, judgement } = input;
  const lines: string[] = [];

  lines.push(`## ${evidence.objective}`, '');
  lines.push(`Produced by Sunday Relay mission \`${evidence.missionId}\`.`, '');

  lines.push('### What Relay verified itself', '');
  if (evidence.relayVerification.length === 0) {
    // Never an empty section. An absent fact says it is absent.
    lines.push('Relay recorded no verification evidence for this mission.', '');
  } else {
    for (const line of evidence.relayVerification) lines.push(`- ${line}`);
    lines.push('');
  }

  lines.push('### Independent review', '');
  if (evidence.reviewerVerdict === null) {
    lines.push('**No independent review was performed.**', '');
  } else {
    lines.push(`**Verdict: ${evidence.reviewerVerdict}**`, '');
    if (evidence.reviewerFindings.length === 0) {
      lines.push('No findings.', '');
    } else {
      for (const finding of evidence.reviewerFindings) {
        lines.push(`- \`${finding.severity}\` — ${finding.requirement}`);
      }
      lines.push('');
    }
  }

  lines.push('### Artifact', '');
  lines.push(`- Verified artifact: ${evidence.artifactDigest ?? '_none recorded_'}`);
  lines.push(`- Artifact the reviewer read: ${evidence.reviewedArtifactDigest ?? '_no review ran_'}`);
  if (
    evidence.artifactDigest !== null
    && evidence.reviewedArtifactDigest !== null
    && evidence.artifactDigest !== evidence.reviewedArtifactDigest
  ) {
    // Stated, not left for a reader to spot by comparing two hex strings.
    lines.push('', '> **The reviewer read a different artifact than the one being merged.**');
  }
  lines.push(`- Baseline: ${evidence.baselineSha ?? '_not recorded_'}`, '');

  lines.push('### Who ran', '');
  if (evidence.attestations.length === 0) {
    lines.push('No execution attestations were recorded.', '');
  } else {
    lines.push('| Role | Requested | Actually ran | Model requested | Model served | Completed |', '|---|---|---|---|---|---|');
    for (const a of evidence.attestations) {
      lines.push(
        `| ${a.role} | ${a.requestedActor} | ${a.actualActor}${a.fallbackOccurred ? ' **(fallback)**' : ''} `
        + `| ${a.requestedModel ?? '_unknown_'} | ${a.servedModel ?? '_not reported_'} `
        + `| ${a.completionVerified ? 'yes' : 'no'} |`,
      );
    }
    lines.push('');
  }

  lines.push('### Scope this mission was authorized for', '');
  lines.push(`- Repository: \`${target.repositoryKey}\``);
  lines.push(`- Base: \`${target.baseBranch}\` → working branch: \`${target.workingBranch}\``);
  lines.push(`- Permissions: ${renderPermissionLine(input.permissions)}`);
  lines.push(`- Write scope: ${target.scope.write.length === 0 ? 'read-only' : target.scope.write.map((p) => `\`${p}\``).join(', ')}`);
  lines.push(`- Protected paths: ${target.protectedPaths.map((p) => `\`${p}\``).join(', ')}`);
  if (judgement !== null) {
    lines.push(
      `- Files changed: ${String(judgement.ceilings.filesChanged)} `
      + `(ceiling ${String(target.ceilings.maxFilesChanged)}) · lines removed: `
      + `${judgement.ceilings.linesRemoved === null ? 'unknown' : String(judgement.ceilings.linesRemoved)} `
      + `(ceiling ${String(target.ceilings.maxLinesRemoved)})`,
    );
  }
  lines.push('');

  /**
   * THE FOOTER SAYS WHAT RELAY DID NOT DO.
   *
   * A pull request that lists three attestations and a passing review reads as
   * an endorsement, and the one thing a human reviewer on the far side needs to
   * know is that Relay's approval is not theirs. `merge_pr` being held does not
   * change this sentence: Relay merging on authorization is still not a human
   * having read the diff.
   */
  lines.push('---', '');
  lines.push(
    '_Relay verified the above itself and had it reviewed independently. That is not a substitute for '
    + 'your review of this diff — Relay can prove what it did, not that it was the right thing to do._',
  );
  return lines.join('\n');
}
