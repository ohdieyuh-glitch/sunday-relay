/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Deterministic command risk and human-approval calculation (PURE).
 *
 * Risk is DOMAIN-CONTROLLED: the interpreter never assigns final risk, and no
 * natural-language phrasing can lower it. Approval is calculated separately
 * from interpretation and separately from risk — some conditions require a
 * human regardless of the computed level.
 */

import type { RelayMissionCommandIntent, RelayMissionCommandRisk } from './command-types';

/** Deterministic facts the validator assembles from its analyses. */
export interface CommandRiskInput {
  intent: RelayMissionCommandIntent;
  secondaryIntents: RelayMissionCommandIntent[];
  activeWorkTargeted: boolean;
  partialWorkPresent: boolean;
  checkpointRequired: boolean;
  dependencyHighImpact: boolean;
  reviewInvalidated: boolean;
  ownershipTransfer: boolean;
  budgetIncreaseMaterial: boolean;
  permissionExpansion: boolean;
  productionWritesRequested: boolean;
  deploymentRequested: boolean;
  securityWeakening: boolean;
  evidenceDiscard: boolean;
  independentReviewBypass: boolean;
  hardBudgetBypass: boolean;
  releaseWithoutApproval: boolean;
}

export interface CommandRiskResult {
  risk: RelayMissionCommandRisk;
  factors: string[];
}

export function calculateCommandRisk(input: CommandRiskInput): CommandRiskResult {
  const critical: string[] = [];
  const high: string[] = [];
  const medium: string[] = [];
  const intents = [input.intent, ...input.secondaryIntents];

  if (input.productionWritesRequested) critical.push('permits production writes');
  if (input.deploymentRequested) critical.push('authorizes deployment');
  if (input.securityWeakening) critical.push('weakens security restrictions');
  if (input.evidenceDiscard) critical.push('discards evidence');
  if (input.independentReviewBypass) critical.push('bypasses independent review');
  if (input.hardBudgetBypass) critical.push('bypasses a hard budget limit');
  if (input.releaseWithoutApproval) critical.push('releases without required approval');

  if (intents.includes('cancel') && input.partialWorkPresent) {
    high.push('cancels active work with partial changes');
  }
  if (input.reviewInvalidated) high.push('invalidates an existing independent review');
  if (input.ownershipTransfer) high.push('changes workspace write ownership');
  if (input.budgetIncreaseMaterial) high.push('increases the mission budget materially');
  if (input.permissionExpansion) high.push('expands permissions');
  if (input.dependencyHighImpact) high.push('invalidates dependent tasks');

  if (intents.includes('pause') && input.activeWorkTargeted) {
    medium.push('pauses active work behind a checkpoint');
  }
  if (intents.includes('reassign')) medium.push('reassigns work between compatible agents');
  if (intents.includes('redirect')) medium.push('redirects output while preserving dependencies');
  if (intents.includes('cancel') && !input.partialWorkPresent && input.activeWorkTargeted) {
    medium.push('cancels active work that has no partial changes');
  }

  if (critical.length > 0) return { risk: 'critical', factors: critical };
  if (high.length > 0) return { risk: 'high', factors: high };
  if (medium.length > 0) return { risk: 'medium', factors: medium };
  return { risk: 'low', factors: ['no destructive, review, ownership, budget, or permission consequences'] };
}

export interface ApprovalRequirementResult {
  required: boolean;
  reasons: string[];
}

/**
 * Human approval is required when the command may lose work, weaken a
 * protection, or cross a configured gate — and always at high/critical risk.
 */
export function calculateApprovalRequirement(
  input: CommandRiskInput,
  risk: RelayMissionCommandRisk,
): ApprovalRequirementResult {
  const reasons: string[] = [];
  const intents = [input.intent, ...input.secondaryIntents];

  if (intents.includes('cancel') && input.partialWorkPresent) {
    reasons.push('may discard or lose partial work');
  }
  if (input.reviewInvalidated) reasons.push('invalidates an independent review');
  if (input.ownershipTransfer) reasons.push('transfers write ownership');
  if (input.budgetIncreaseMaterial) reasons.push('increases the budget materially');
  if (input.productionWritesRequested) reasons.push('expands production permissions');
  if (input.securityWeakening) reasons.push('changes protected security constraints');
  if (input.deploymentRequested || input.releaseWithoutApproval) {
    reasons.push('releases or deploys');
  }
  if (input.independentReviewBypass || input.hardBudgetBypass) {
    reasons.push('bypasses a configured gate');
  }
  if (reasons.length === 0 && (risk === 'high' || risk === 'critical')) {
    reasons.push(`${risk} risk always requires explicit human approval`);
  }
  return { required: reasons.length > 0, reasons };
}
