/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Reviewer-independence protection (PURE).
 *
 * Independence is STRUCTURAL — this module reuses the production rule
 * (`reviewerIsIndependent`, src/relay/mission/entitlement.ts): the same
 * agent, the same session, the same adapter lineage, or the same
 * independence group is NEVER independent, and a NEW SESSION of the same
 * execution identity is still the same party.
 *
 * The invariant protected here:
 *   - the original implementer MAY repair its own artifact;
 *   - the original implementer may NEVER independently approve that repair;
 *   - cancelling an active review preserves confirmed partial findings;
 *   - reassignment/artifact change makes prior approval stale — an
 *     independent re-review of the CURRENT artifact is always retained.
 */

import { reviewerIsIndependent } from '../entitlement';
import type {
  CommandAgentContext,
  RelayMissionCommandContext,
} from './command-context';
import { findAgent, findTask } from './command-context';
import type { RelayMissionCommandDraft } from './command-types';

export interface IndependenceAssessment {
  /** True when the command would DESTROY independence — must reject. */
  violation: boolean;
  /** True when the command touches review independence at all — surfaces in
      the preview even when the command is safe. */
  riskDetected: boolean;
  reasons: string[];
  /** Reviews this command invalidates or leaves incomplete. */
  invalidatedReviewIds: string[];
  /** Confirmed partial findings the command plan must preserve. */
  preservedFindingIds: string[];
  /** True when an independent re-review of the current artifact remains
      required after this command. */
  reReviewRequired: boolean;
}

function sameParty(a: CommandAgentContext, b: CommandAgentContext): boolean {
  return (
    a.executionIdentity === b.executionIdentity ||
    !reviewerIsIndependent({
      reviewerAgentId: a.agentId,
      reviewerSessionId: a.sessionId,
      reviewerAdapterId: a.adapterId,
      reviewerIndependenceGroup: a.independenceGroup,
      implementerAgentId: b.agentId,
      implementerSessionId: b.sessionId,
      implementerAdapterId: b.adapterId,
      implementerIndependenceGroup: b.independenceGroup,
    })
  );
}

export function evaluateReviewerIndependence(
  draft: Pick<
    RelayMissionCommandDraft,
    'intent' | 'secondaryIntents' | 'targetTaskIds' | 'targetAgentIds' | 'interpretedChanges'
  >,
  context: RelayMissionCommandContext,
): IndependenceAssessment {
  const reasons: string[] = [];
  const invalidatedReviewIds: string[] = [];
  const preservedFindingIds: string[] = [];
  let violation = false;
  let riskDetected = false;
  let reReviewRequired = false;

  const implementers = context.agents.filter((a) => a.rolesInMission.includes('implementer'));

  /* Reviews interrupted or invalidated by this command. */
  for (const change of draft.interpretedChanges) {
    if (change.entityType !== 'review') continue;
    const review = context.reviews.find((r) => r.reviewId === change.entityId);
    if (!review) continue;
    if (
      change.requestedState === 'incomplete' ||
      change.requestedState === 'invalidated' ||
      change.requestedState === 'stale'
    ) {
      riskDetected = true;
      reReviewRequired = true;
      invalidatedReviewIds.push(review.reviewId);
      preservedFindingIds.push(...review.findingIds);
      reasons.push(
        `review ${review.reviewId} will not complete — its ${review.findingIds.length} confirmed partial finding(s) are preserved and an independent re-review of the current artifact remains required`,
      );
    }
  }

  /* Ownership changes: who is being put in charge of what responsibility? */
  for (const change of draft.interpretedChanges) {
    if (change.entityType !== 'task' || !change.requestedState.startsWith('owner:')) continue;
    const task = findTask(context, change.entityId);
    const newOwnerId = change.requestedState.slice('owner:'.length);
    const newOwner = findAgent(context, newOwnerId);
    if (!task || !newOwner) continue;

    if (task.responsibility === 'review') {
      // Assigning review responsibility to any party that implemented the
      // artifact under review destroys independence — including a fresh
      // session of the same execution identity and non-launching wrappers
      // (an agent with no independent lineage receives no review credit).
      const conflicted = implementers.filter((impl) => sameParty(newOwner, impl));
      if (conflicted.length > 0) {
        violation = true;
        riskDetected = true;
        reasons.push(
          `${newOwner.displayName} is the same party as implementer ${conflicted[0].agentId} — the original implementer may never independently review or approve its own artifact`,
        );
      }
    }

    if (task.responsibility === 'repair') {
      const isImplementer = implementers.some((impl) => sameParty(newOwner, impl));
      riskDetected = riskDetected || isImplementer;
      reReviewRequired = true;
      reasons.push(
        isImplementer
          ? `${newOwner.displayName} repairs its own artifact — permitted, but the repair may only be approved by an INDEPENDENT re-review of the repaired artifact`
          : `repair reassigned to ${newOwner.displayName} — independent re-review of the repaired artifact remains required`,
      );
    }
  }

  /* Verification decisions: approval must come from an independent review of
     the CURRENT artifact (staleness itself is validated in the pipeline). */
  for (const change of draft.interpretedChanges) {
    if (
      change.entityType !== 'task' ||
      change.statusDimension !== 'verification' ||
      change.requestedState !== 'approved'
    ) {
      continue;
    }
    const supportingReview = context.reviews
      .filter((r) => r.taskId === change.entityId && r.status === 'completed')
      .at(-1);
    if (supportingReview && !supportingReview.independent) {
      violation = true;
      riskDetected = true;
      reasons.push(
        `review ${supportingReview.reviewId} is not independent — approval credit requires a structurally independent reviewer`,
      );
    }
  }

  return {
    violation,
    riskDetected,
    reasons,
    invalidatedReviewIds: [...new Set(invalidatedReviewIds)],
    preservedFindingIds: [...new Set(preservedFindingIds)],
    reReviewRequired,
  };
}
