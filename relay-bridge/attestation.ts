/**
 * EXECUTION ATTESTATION — who was REQUESTED vs who ACTUALLY ran.
 *
 * A role is only credited when its process/request verifiably launched AND
 * completed. A fallback can never silently satisfy a required role, and a
 * simulated run is recorded as `simulated` — never as a paid or authenticated
 * one. `verified_complete` requires a valid attestation for all three roles.
 */

import { createHash } from 'node:crypto';

export type AttestationRole = 'prompt_architect' | 'coding_agent' | 'reviewer';

export type BillingPath = 'api_billed' | 'subscription' | 'portal' | 'local' | 'simulated' | 'unknown';

export interface ExecutionAttestation {
  attestationId: string;
  missionId: string;
  /** The mission revision this role executed against. A role attested against
      a different revision can never satisfy the current mission. */
  missionRevision?: string;
  role: AttestationRole;
  requestedActor: string;
  actualActor: string;
  requestedRuntime: string;
  actualRuntime: string;
  provider?: string;
  /** The model Relay asked for. Configuration, stated as configuration. */
  requestedModel?: string;
  /**
   * The model the provider/runtime itself reported answered. Evidence, never
   * inferred: it is absent when the runtime reported none, and it is NEVER
   * defaulted from `requestedModel` — a single `model` field used to carry
   * both facts, which is how a requested model came to be attested as the
   * one that actually reviewed (defect 3, HOSTED_MISSION_EVIDENCE.md).
   */
  actualModel?: string;
  billingPath: BillingPath;
  launchVerified: boolean;
  completionVerified: boolean;
  fallbackOccurred: boolean;
  externalExecutionIdRedacted?: string;
  inputDigest: string;
  outputDigest?: string;
  startedAt: string;
  completedAt?: string;
  terminalReason?: string;
}

export const digest = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

export function buildAttestation(input: Omit<ExecutionAttestation, 'attestationId'>): ExecutionAttestation {
  return {
    attestationId: `att_${input.role}_${digest(`${input.missionId}:${input.role}:${input.startedAt}`)}`,
    ...input,
  };
}

/** A role counts as genuinely executed only when it launched AND completed
    without a fallback standing in for it. */
export function attestsRealExecution(a: ExecutionAttestation | undefined): boolean {
  return Boolean(a && a.launchVerified && a.completionVerified && !a.fallbackOccurred);
}

/** True only when the role actually consumed a billable API request. */
export function isPaidApiCall(a: ExecutionAttestation | undefined): boolean {
  return Boolean(a && attestsRealExecution(a) && a.billingPath === 'api_billed');
}

/**
 * THE REGISTRY'S BILLING WORD, TRANSLATED INTO THE ATTESTATION'S.
 *
 * Two unions describe the same fact with different vocabularies: an occupant
 * is registered `api`, and the attestation that names it says `api_billed`,
 * which is the value `isPaidApiCall` tests for. Translated, never aliased.
 *
 * This lives here because it was previously an inline ternary in the coding
 * leg and a hard-coded literal in the reviewer leg, and the literal was wrong:
 * every hosted review attested `subscription` while the occupant that ran was
 * registered `api`. Two legs deciding one fact by different means is how they
 * came to disagree, so now there is one means.
 *
 * An occupant Relay could not resolve yields `unknown` — never a default, and
 * never the cheaper-sounding of the two.
 */
export function occupantBillingPath(
  registered: 'subscription' | 'api' | 'none' | 'unknown' | undefined,
): Extract<BillingPath, 'api_billed' | 'subscription' | 'simulated' | 'unknown'> {
  switch (registered) {
    case 'api': return 'api_billed';
    case 'none': return 'simulated';
    case 'subscription': return 'subscription';
    default: return 'unknown';
  }
}

/**
 * THE OPERATOR'S OWN DECLARATION, WHICH WAS DOCUMENTED AND THEN IGNORED.
 *
 * `.env.example` offers `RELAY_HERMES_BILLING_MODE` under the heading "the
 * reviewer's provider, model and billing mode are separate facts and must each
 * be reported truthfully. Do not infer billing" — and nothing has ever read it.
 * A documented control that does nothing is its own false claim: an operator
 * who set it correctly still got the literal.
 *
 * It outranks the registry because the registry describes a product and the
 * operator knows their own account; an occupant registered `api` really can be
 * run against a subscription. What Relay may never do is INVENT the answer,
 * which is exactly what it was doing.
 *
 * An unset variable returns null so the caller falls back to the registry, and
 * an unrecognized value returns `'unknown'` rather than being ignored — a
 * misspelling must not silently read as agreement with whatever the fallback
 * would have said.
 */
export function declaredBillingPath(
  declared: string | undefined,
): Extract<BillingPath, 'api_billed' | 'subscription' | 'portal' | 'local' | 'unknown'> | null {
  const value = (declared ?? '').trim().toLowerCase();
  if (value === '') return null;
  switch (value) {
    case 'api_billed': return 'api_billed';
    case 'subscription': return 'subscription';
    case 'portal': return 'portal';
    case 'local': return 'local';
    default: return 'unknown';
  }
}

/**
 * ONE PHRASE PER BILLING PATH, for the event line a founder actually reads.
 *
 * The reviewer launch event ended "· subscription-backed." regardless of what
 * was true, beside two placeholders ("configured provider · configured model")
 * that name nothing. A sentence with no information in it still asserted the
 * one thing it should not have.
 */
export function billingPhrase(path: BillingPath): string {
  switch (path) {
    case 'api_billed': return 'api-billed';
    case 'subscription': return 'subscription-backed';
    case 'portal': return 'portal-billed';
    case 'local': return 'not billed';
    case 'simulated': return 'simulated — no spend';
    default: return 'billing not established';
  }
}

/** Was the role performed by the actor we asked for? */
export function actorMatches(a: ExecutionAttestation | undefined): boolean {
  return Boolean(a && a.requestedActor === a.actualActor && a.requestedRuntime === a.actualRuntime);
}

export interface CompletionInputs {
  attestations: Partial<Record<AttestationRole, ExecutionAttestation>>;
  handoffStored: boolean;
  handoffDeliveredAutomatically: boolean;
  scopePreserved: boolean;
  deterministicTestsPassed: boolean;
  protectedPathsUntouched: boolean;
  reviewerApproved: boolean;
  blockingFindings: number;
  /** The digest Hermes reviewed must equal the digest Relay verified. */
  reviewedArtifactDigest?: string;
  currentArtifactDigest?: string;
  /** The live three-role mission passes TRUE. There is no completion path in
      which an independent review is optional for that mission. */
  requiresIndependentReview?: boolean;
  /** Every role must have executed against this exact mission revision. */
  missionRevision?: string;
  /** The handoff Relay persisted vs the handoff actually compiled for the
      Coding Agent — completion requires them to be the same object. */
  persistedHandoffDigest?: string;
  deliveredHandoffDigest?: string;
  /** True when a dispatch outcome could not be determined. Never retried
      automatically and never completed. */
  dispatchUncertain?: boolean;
}

export type CompletionDecision =
  | { state: 'verified_complete' }
  | { state: 'review_blocked'; reason: string }
  | { state: 'review_incomplete'; reason: string }
  | { state: 'reviewer_launch_failed'; reason: string }
  | { state: 'dispatch_status_uncertain'; reason: string }
  | { state: 'verification_failed'; reason: string };

/**
 * The single completion authority. Passing tests are NOT sufficient — every
 * role must be genuinely attested, the scope preserved, and the review must
 * both approve AND match the exact artifact that was verified.
 */
export function decideCompletion(i: CompletionInputs): CompletionDecision {
  const architect = i.attestations.prompt_architect;
  const coder = i.attestations.coding_agent;
  const reviewer = i.attestations.reviewer;
  const requiresIndependentReview = i.requiresIndependentReview ?? true;

  if (i.dispatchUncertain) {
    return {
      state: 'dispatch_status_uncertain',
      reason: 'A role dispatch outcome is unknown; completion requires an explicit founder decision.',
    };
  }
  if (!attestsRealExecution(architect)) {
    return { state: 'verification_failed', reason: 'The Prompt Architect did not produce an attested execution.' };
  }
  if (!attestsRealExecution(coder)) {
    return { state: 'verification_failed', reason: 'The Coding Agent did not produce an attested execution.' };
  }
  if (!i.handoffStored || !i.handoffDeliveredAutomatically) {
    return { state: 'verification_failed', reason: 'The handoff was not stored and delivered automatically.' };
  }
  if (
    i.persistedHandoffDigest !== undefined &&
    i.deliveredHandoffDigest !== undefined &&
    i.persistedHandoffDigest !== i.deliveredHandoffDigest
  ) {
    return {
      state: 'verification_failed',
      reason: 'The handoff delivered to the Coding Agent is not the handoff Relay persisted.',
    };
  }
  if (!i.scopePreserved || !i.protectedPathsUntouched) {
    return { state: 'verification_failed', reason: 'The change left the controlled scope.' };
  }
  if (!i.deterministicTestsPassed) {
    return { state: 'verification_failed', reason: 'Relay-run verification did not pass.' };
  }
  if (i.missionRevision !== undefined) {
    const roles: Array<[string, ExecutionAttestation | undefined]> = [
      ['Prompt Architect', architect],
      ['Coding Agent', coder],
      ...(requiresIndependentReview ? ([['Reviewer', reviewer]] as Array<[string, ExecutionAttestation | undefined]>) : []),
    ];
    for (const [label, a] of roles) {
      if (a && a.missionRevision !== undefined && a.missionRevision !== i.missionRevision) {
        return { state: 'verification_failed', reason: `The ${label} executed against a different mission revision.` };
      }
    }
  }
  if (!requiresIndependentReview) {
    return { state: 'verified_complete' };
  }
  if (!reviewer || !reviewer.launchVerified) {
    return { state: 'reviewer_launch_failed', reason: 'The reviewer never launched, so the mission cannot be verified complete.' };
  }
  if (!attestsRealExecution(reviewer)) {
    return { state: 'review_incomplete', reason: 'The reviewer launched but returned no valid review.' };
  }
  if (i.blockingFindings > 0 || !i.reviewerApproved) {
    return { state: 'review_blocked', reason: 'The reviewer did not approve the implementation.' };
  }
  if (i.currentArtifactDigest && !i.reviewedArtifactDigest) {
    return { state: 'review_incomplete', reason: 'The review is not bound to the artifact Relay verified.' };
  }
  if (
    i.reviewedArtifactDigest &&
    i.currentArtifactDigest &&
    i.reviewedArtifactDigest !== i.currentArtifactDigest
  ) {
    return { state: 'review_incomplete', reason: 'The artifact changed after review; the review is stale.' };
  }
  return { state: 'verified_complete' };
}
