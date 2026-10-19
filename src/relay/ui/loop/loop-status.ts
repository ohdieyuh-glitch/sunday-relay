/**
 * SUNDAY RELAY — LOOP STATUS PRESENTATION.
 *
 * WHAT THIS IS NOT: a second state model. `RelayLoopState` in the domain is
 * the one canonical Loop state set, and nothing here invents a Loop state or
 * decides one. This module answers a narrower, purely presentational question:
 *
 *   given the real Loop state, the real feature availability and the real
 *   validation result, what does the surface SHOW right now?
 *
 * Those are three different facts and a user needs one word. A Loop can be
 * `draft` in the domain while the engine is disabled and the contract is
 * invalid — three separate truths, and showing "draft" alone would hide the
 * two that actually explain why nothing is happening.
 *
 * THE RULE THAT KEEPS IT HONEST. `running`, `reviewing`, `repairing` and
 * `completed` are deliberately ABSENT from this vocabulary. There is no Loop
 * runtime in this build, so no surface may render a word that implies one.
 * When the runtime lands, those states arrive here by extending
 * `RELAY_LOOP_PRESENTATION_STATUSES` — not by a surface inventing a label.
 *
 * PURE. No React, no clock, no I/O.
 */

import type { RelayLoopState } from '../../mission';

/**
 * What a surface may say today. Ordered from least to most ready, so a
 * reviewer can see at a glance that nothing here claims execution.
 */
export const RELAY_LOOP_PRESENTATION_STATUSES = [
  /** Authored, not yet checked. */
  'draft',
  /** Validation in progress. */
  'validating',
  /** The contract is valid and the user has not confirmed it. */
  'awaiting_confirmation',
  /** The contract is well-formed but something the user can fix is wrong. */
  'invalid',
  /** A feature flag is off. Nothing is wrong with the request. */
  'feature_disabled',
  /** Something real is blocking that is not a feature flag. */
  'unavailable',
  /** Valid, permitted, confirmed — the next step is preflight, not execution. */
  'ready_for_preflight',
] as const;
export type RelayLoopPresentationStatus = (typeof RELAY_LOOP_PRESENTATION_STATUSES)[number];

/** The label a surface prints. Uppercase matches the workspace's editorial
 *  register (MANUAL TASKS, STOPPED SAFELY) rather than sentence case. */
export const RELAY_LOOP_STATUS_LABEL: Readonly<Record<RelayLoopPresentationStatus, string>> =
  Object.freeze({
    draft: 'DRAFT',
    validating: 'VALIDATING',
    awaiting_confirmation: 'AWAITING CONFIRMATION',
    invalid: 'NEEDS CHANGES',
    feature_disabled: 'NOT ENABLED',
    unavailable: 'UNAVAILABLE',
    ready_for_preflight: 'READY FOR PREFLIGHT',
  });

/**
 * One sentence saying what the status MEANS for the user's next action.
 * Screen readers announce this alongside the label, so the status is never
 * conveyed by colour or a single word alone.
 */
export const RELAY_LOOP_STATUS_DESCRIPTION: Readonly<Record<RelayLoopPresentationStatus, string>> =
  Object.freeze({
    draft: 'This Loop has been drafted. Nothing has started.',
    validating: 'Relay is checking this contract. Nothing has started.',
    awaiting_confirmation: 'Review the agents and limits below. Nothing starts until you confirm.',
    invalid: 'This contract cannot run yet. The problems listed below must be resolved.',
    feature_disabled: 'This capability is not enabled in this build. Nothing has started.',
    unavailable: 'This Loop cannot run yet. The blockers listed below explain why.',
    ready_for_preflight:
      'This contract is valid and permitted. The next step is preflight — no work has started.',
  });

/**
 * A non-colour tone hint. Surfaces pair it with a shape or text marker, never
 * colour alone, so the status survives a monochrome or colour-blind reading.
 */
export const RELAY_LOOP_STATUS_TONE: Readonly<
  Record<RelayLoopPresentationStatus, 'neutral' | 'attention' | 'ready'>
> = Object.freeze({
  draft: 'neutral',
  validating: 'neutral',
  awaiting_confirmation: 'attention',
  invalid: 'attention',
  feature_disabled: 'neutral',
  unavailable: 'attention',
  ready_for_preflight: 'ready',
});

export interface LoopPresentationInput {
  /** The canonical Loop state, when a contract exists. `null` while a command
   *  has been parsed but no contract has been compiled yet. */
  readonly state: RelayLoopState | null;
  /** Whether every gate the command needs is open. */
  readonly available: boolean;
  /** True when the ONLY thing blocking is a feature flag — worth its own word,
   *  because "we have not shipped that" and "you did something wrong" are
   *  different messages. */
  readonly blockedOnlyByFeatureFlags: boolean;
  /** Contract validation problems, if a contract was compiled. */
  readonly validationProblems: readonly string[];
  /** Whether the user has confirmed the drafted contract. */
  readonly confirmed: boolean;
}

/**
 * Derive what to show.
 *
 * Order matters and is deliberate: a feature being off is reported BEFORE
 * validation problems, because telling a user to fix a contract for a
 * capability that does not exist wastes their time.
 */
export function deriveLoopPresentationStatus(
  input: LoopPresentationInput,
): RelayLoopPresentationStatus {
  if (input.blockedOnlyByFeatureFlags) return 'feature_disabled';
  if (!input.available) return 'unavailable';
  if (input.validationProblems.length > 0) return 'invalid';
  if (input.state === null) return 'validating';
  if (input.confirmed) return 'ready_for_preflight';
  if (input.state === 'draft') return 'awaiting_confirmation';
  return 'draft';
}

/**
 * Statuses that would claim work is happening.
 *
 * EMPTY, deliberately. There is no Loop runtime in this build, so no status a
 * surface can render may imply one. When the runtime lands, `running`,
 * `reviewing`, `repairing` and `completed` join both this set and the
 * vocabulary above — and the test that pins this to empty is what forces that
 * to be a deliberate change rather than a slip.
 */
export const EXECUTION_IMPLYING_STATUSES: readonly RelayLoopPresentationStatus[] = [];

export function statusImpliesExecution(status: RelayLoopPresentationStatus): boolean {
  return EXECUTION_IMPLYING_STATUSES.includes(status);
}
