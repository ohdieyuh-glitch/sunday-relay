/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 1
 * Compact status projection for the existing UI vocabulary.
 *
 * A PURE read-model: four-dimension status in, display data out. It follows
 * the workspace's presentation idiom (ALL-CAPS labels, small tone set like
 * the terminal's truth badges) but is intentionally NOT wired into the Live
 * Terminal or Demo Simulation — broad integration during this milestone would
 * risk the original interface, so this stays an isolated, documented
 * projection (see docs/relay/MISSION_STATUS_MODEL.md). A future Mission
 * Operations interface (Milestone 6) consumes it; nothing renders it today.
 *
 * The projection never collapses the four dimensions: there is no single
 * "COMPLETE" — a caller always receives all four chips plus derived
 * accountability flags.
 */

import { deriveReleaseEligibility, DEFAULT_RELEASE_POLICY } from './status-model';
import type {
  AqualaExecutionStatus,
  AqualaMissionOutcomeStatus,
  AqualaOutcomeStatus,
  AqualaReleasePolicy,
  AqualaReleaseStatus,
  AqualaStatusDimension,
  AqualaVerificationStatus,
} from './status-model';

/* ------------------------------------------------------------- types */

/** Small display tone set, in the spirit of the terminal's truth badges. */
export type AqualaStatusTone = 'idle' | 'active' | 'positive' | 'attention' | 'blocked';

export interface AqualaStatusChip {
  dimension: AqualaStatusDimension;
  /** Machine value, e.g. "changes_required". */
  status: string;
  /** ALL-CAPS display label in the existing workspace idiom. */
  label: string;
  tone: AqualaStatusTone;
}

export interface AqualaStatusProjection {
  /** Always exactly four chips, in fixed dimension order. */
  chips: [AqualaStatusChip, AqualaStatusChip, AqualaStatusChip, AqualaStatusChip];
  /** Compact one-line summary, e.g.
      "RUNNING · OUTCOME UNKNOWN · UNVERIFIED · NOT ELIGIBLE". */
  headline: string;
  /** True only when review demands changes or the outcome is violated. */
  blocked: boolean;
  /** True when the release dimension waits on an explicit human approval. */
  awaitingHumanApproval: boolean;
  /** The model's own release-gate derivation for the given policy. */
  releaseGatesMet: boolean;
  releaseGatesUnmet: string[];
}

/* ------------------------------------------------------------ tables */

const EXECUTION_DISPLAY: Record<AqualaExecutionStatus, { label: string; tone: AqualaStatusTone }> = {
  not_started: { label: 'NOT STARTED', tone: 'idle' },
  starting: { label: 'STARTING', tone: 'active' },
  running: { label: 'RUNNING', tone: 'active' },
  waiting: { label: 'WAITING', tone: 'idle' },
  completed: { label: 'COMPLETE', tone: 'positive' },
  failed: { label: 'FAILED', tone: 'blocked' },
  cancelled: { label: 'STOPPED SAFELY', tone: 'attention' },
};

const OUTCOME_DISPLAY: Record<AqualaMissionOutcomeStatus, { label: string; tone: AqualaStatusTone }> = {
  unknown: { label: 'OUTCOME UNKNOWN', tone: 'idle' },
  partial: { label: 'PARTIALLY SATISFIED', tone: 'attention' },
  satisfied: { label: 'SATISFIED', tone: 'positive' },
  violated: { label: 'VIOLATED', tone: 'blocked' },
};

const VERIFICATION_DISPLAY: Record<AqualaVerificationStatus, { label: string; tone: AqualaStatusTone }> = {
  unverified: { label: 'UNVERIFIED', tone: 'idle' },
  reviewing: { label: 'REVIEWING', tone: 'active' },
  changes_required: { label: 'CHANGES REQUIRED', tone: 'attention' },
  approved: { label: 'APPROVED', tone: 'positive' },
  verified: { label: 'VERIFIED', tone: 'positive' },
};

const RELEASE_DISPLAY: Record<AqualaReleaseStatus, { label: string; tone: AqualaStatusTone }> = {
  not_eligible: { label: 'NOT ELIGIBLE', tone: 'idle' },
  human_approval_required: { label: 'HUMAN APPROVAL REQUIRED', tone: 'attention' },
  eligible: { label: 'ELIGIBLE', tone: 'positive' },
  released: { label: 'RELEASED', tone: 'positive' },
  rolled_back: { label: 'ROLLED BACK', tone: 'blocked' },
};

/* -------------------------------------------------------- projection */

export function projectAqualaStatus(
  status: AqualaOutcomeStatus,
  policy: AqualaReleasePolicy = DEFAULT_RELEASE_POLICY,
): AqualaStatusProjection {
  const execution = EXECUTION_DISPLAY[status.executionStatus];
  const outcome = OUTCOME_DISPLAY[status.outcomeStatus];
  const verification = VERIFICATION_DISPLAY[status.verificationStatus];
  const release = RELEASE_DISPLAY[status.releaseStatus];

  const chips: AqualaStatusProjection['chips'] = [
    { dimension: 'execution', status: status.executionStatus, ...execution },
    { dimension: 'outcome', status: status.outcomeStatus, ...outcome },
    { dimension: 'verification', status: status.verificationStatus, ...verification },
    { dimension: 'release', status: status.releaseStatus, ...release },
  ];

  const eligibility = deriveReleaseEligibility(status, policy);

  return {
    chips,
    headline: chips.map(chip => chip.label).join(' · '),
    blocked:
      status.verificationStatus === 'changes_required' || status.outcomeStatus === 'violated',
    awaitingHumanApproval: status.releaseStatus === 'human_approval_required',
    releaseGatesMet: eligibility.gatesMet,
    releaseGatesUnmet: eligibility.unmet,
  };
}
