import type { Provenance } from '../protocol/enums';

/**
 * Reviewer entitlement + output release gate (Prompt 8.2) — PURE. Plan and
 * mode are SEPARATE. Relay Core owns the release state: substantive coding
 * output on Pro/Max is held for verification, then held for review, and only
 * reaches approved_for_release after the required INDEPENDENT review; release
 * happens only after CompletionPolicy passes. Autonomous cannot bypass the
 * Reviewer policy. Independence is structural (never the implementation
 * session). Truthful labels are mandatory — never claim a Reviewer ran when
 * it did not. The real Codex adapter is NOT implemented here (deterministic
 * Reviewer assignment; provenance labeled).
 */

export const ENTITLEMENTS = ['free', 'pro', 'max', 'enterprise'] as const;
export type RelayEntitlement = (typeof ENTITLEMENTS)[number];

export interface EntitlementPolicy {
  entitlement: RelayEntitlement;
  reviewerAvailable: boolean;
  reviewerRequiredForSubstantiveCoding: boolean;
  maxReviewRepairCycles: 0 | 1 | 2;
  specialistReviewers: boolean;
  autonomousWorkflows: boolean;
  label: string;
}

export function entitlementPolicy(entitlement: RelayEntitlement): EntitlementPolicy {
  switch (entitlement) {
    case 'free':
      return { entitlement, reviewerAvailable: false, reviewerRequiredForSubstantiveCoding: false, maxReviewRepairCycles: 0, specialistReviewers: false, autonomousWorkflows: false, label: 'Free' };
    case 'pro':
      return { entitlement, reviewerAvailable: true, reviewerRequiredForSubstantiveCoding: true, maxReviewRepairCycles: 1, specialistReviewers: false, autonomousWorkflows: true, label: 'Pro' };
    case 'max':
      return { entitlement, reviewerAvailable: true, reviewerRequiredForSubstantiveCoding: true, maxReviewRepairCycles: 1, specialistReviewers: true, autonomousWorkflows: true, label: 'Max' };
    case 'enterprise':
      return { entitlement, reviewerAvailable: true, reviewerRequiredForSubstantiveCoding: true, maxReviewRepairCycles: 2, specialistReviewers: true, autonomousWorkflows: true, label: 'Enterprise' };
  }
}

/* --------------------------- output visibility ---------------------- */

export const OUTPUT_VISIBILITIES = [
  'working', 'held_for_verification', 'held_for_review', 'revision_required',
  'approved_for_release', 'released', 'blocked',
] as const;
export type OutputVisibility = (typeof OUTPUT_VISIBILITIES)[number];

export interface ReleaseGateInput {
  entitlement: RelayEntitlement;
  substantiveCoding: boolean;
  implementationReported: boolean;
  verificationPassed: boolean;
  reviewerRequired: boolean;
  reviewOccurred: boolean;
  blockingFindingOpen: boolean;
  reviewApproved: boolean;
  reviewerIsIndependent: boolean;
  completionPolicySatisfied: boolean;
  runStatus: string;
}

/**
 * Deterministic release state. On Pro/Max substantive coding, output can NOT
 * reach released before an independent review approves AND CompletionPolicy
 * passes — an agent cannot release its own work.
 */
export function computeOutputVisibility(input: ReleaseGateInput): { visibility: OutputVisibility; reason: string } {
  const policy = entitlementPolicy(input.entitlement);
  if (input.runStatus === 'failed' || input.runStatus === 'cancelled') return { visibility: 'blocked', reason: 'Run did not complete.' };
  if (!input.implementationReported) return { visibility: 'working', reason: 'Implementation in progress.' };
  if (!input.verificationPassed) return { visibility: 'held_for_verification', reason: 'Held for Relay verification.' };

  const requiresReview = input.reviewerRequired && policy.reviewerRequiredForSubstantiveCoding && input.substantiveCoding;
  if (requiresReview) {
    if (input.blockingFindingOpen) return { visibility: 'revision_required', reason: 'A blocking finding requires repair.' };
    if (!input.reviewOccurred) return { visibility: 'held_for_review', reason: 'Held for the required independent review.' };
    if (!input.reviewApproved || !input.reviewerIsIndependent) return { visibility: 'held_for_review', reason: 'Awaiting an independent approving review.' };
  }
  if (!input.completionPolicySatisfied) return { visibility: 'approved_for_release', reason: 'Approved; awaiting the completion policy.' };
  return { visibility: 'released', reason: 'CompletionPolicy satisfied — released.' };
}

/* --------------------------- reviewer profile ----------------------- */

export interface ReviewerProfile {
  agentId: string;
  agentType: string;
  adapterId: string;
  supportedReviewRoles: string[];
  specialties: string[];
  independenceGroup: string;
  availability: 'available' | 'unavailable' | 'entitlement_locked';
  provenance: Provenance;
}

/** Independence is STRUCTURAL: never the implementation session, its adapter
 * lineage, its external session id, or the report author. */
export function reviewerIsIndependent(input: {
  reviewerAgentId: string; reviewerSessionId: string | null; reviewerAdapterId: string; reviewerIndependenceGroup: string;
  implementerAgentId: string; implementerSessionId: string | null; implementerAdapterId: string; implementerIndependenceGroup: string;
}): boolean {
  if (input.reviewerAgentId === input.implementerAgentId) return false;
  if (input.reviewerSessionId && input.reviewerSessionId === input.implementerSessionId) return false;
  if (input.reviewerAdapterId === input.implementerAdapterId) return false;
  if (input.reviewerIndependenceGroup === input.implementerIndependenceGroup) return false;
  return true;
}

/** Deterministic Reviewer assignment (no real Codex this phase). Returns a
 * labeled profile; unavailable/locked when the entitlement does not include
 * an independent Reviewer. */
export function assignReviewer(entitlement: RelayEntitlement, provenance: Provenance): ReviewerProfile {
  const policy = entitlementPolicy(entitlement);
  if (!policy.reviewerAvailable) {
    return { agentId: 'none', agentType: 'reviewer', adapterId: 'none', supportedReviewRoles: [], specialties: [], independenceGroup: 'none', availability: 'entitlement_locked', provenance };
  }
  return {
    agentId: 'sim-reviewer', agentType: 'reviewer', adapterId: 'sim-reviewer',
    supportedReviewRoles: ['coding'], specialties: policy.specialistReviewers ? ['security', 'coding'] : ['coding'],
    independenceGroup: 'reviewers', availability: 'available', provenance,
  };
}

/* --------------------------- reviewer package ----------------------- */

export interface ReviewerPackage {
  missionObjective: string;
  requirements: string[];
  acceptanceCriteria: string[];
  changedFiles: string[];
  diffSummary: string;
  verificationEvidence: Array<{ command: string; status: string }>;
  knownRisks: string[];
  protectedPaths: string[];
  securityConstraints: string[];
  reviewRubric: string[];
  findingSchema: string;
  blockingThreshold: string;
}

/** Build the Reviewer's role-specific package — objective, criteria, actual
 * diff, evidence, rubric ONLY. Never the transcript, hidden reasoning, raw
 * credentials, unrelated Project Brain content, or implementation session
 * state. */
export function buildReviewerPackage(input: {
  missionObjective: string; requirements: string[]; acceptanceCriteria: string[];
  changedFiles: string[]; verificationEvidence: Array<{ command: string; status: string }>;
  knownRisks?: string[]; protectedPaths?: string[]; securityConstraints?: string[];
}): ReviewerPackage {
  return {
    missionObjective: input.missionObjective, requirements: [...input.requirements],
    acceptanceCriteria: [...input.acceptanceCriteria], changedFiles: [...input.changedFiles],
    diffSummary: `${input.changedFiles.length} file(s) changed`,
    verificationEvidence: input.verificationEvidence.map((e) => ({ command: e.command, status: e.status })),
    knownRisks: [...(input.knownRisks ?? [])], protectedPaths: [...(input.protectedPaths ?? [])],
    securityConstraints: [...(input.securityConstraints ?? ['no secret exposure', 'no scope expansion'])],
    reviewRubric: ['correctness', 'security', 'scope adherence', 'evidence sufficiency'],
    findingSchema: '{ id, severity, title, description, requiredAction, blocking }',
    blockingThreshold: 'any high/critical finding blocks release',
  };
}
