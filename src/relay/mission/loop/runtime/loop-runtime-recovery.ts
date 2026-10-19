/**
 * SUNDAY RELAY — LOOP RECOVERY CLASSIFICATION.
 *
 * Relay restarted. Something was running. The only question that matters is
 * whether it is SAFE to carry on, and the honest answer is frequently "nobody
 * can tell" — so that is a first-class outcome here, not a gap.
 *
 * THE RULE THIS FILE ENFORCES. An operation whose outcome is unknown is NEVER
 * replayed automatically. A dispatch that started and was not seen to finish
 * may have spent money, written files, or called a provider; re-running it on
 * the assumption that it failed is how a crash turns into a double charge. Such
 * a run becomes `execution_outcome_unknown`, which requires a human to look.
 *
 * The one exception is stated as a precondition rather than a hope: replay is
 * safe only when the operation is PROVABLY idempotent, and Stage 2 has no
 * idempotent agent dispatch, so `mayAutoResume` returns false for every
 * uncertain classification. When such a dispatch exists it will have to say so
 * explicitly.
 *
 * Deliberately parallel to `DURABLE_RECOVERY_CLASSIFICATIONS`, which answers
 * the same question for a mission. The vocabularies differ because a Loop can
 * be uncertain in ways a mission cannot — mid-iteration, with a known ordinal
 * and an unknown outcome.
 *
 * PURE. No clock, no I/O.
 */

import { isTerminalLoopState } from './loop-runtime-state';
import type { RelayLoopRun } from './loop-runtime-types';

/* ------------------------------------------------------ classifications */

export const RELAY_LOOP_RECOVERY_CLASSIFICATIONS = [
  /** Nothing was in flight; the run may continue from the next iteration. */
  'safe_to_resume',
  /** Paused at a real safe checkpoint. Resume is a user action, not automatic. */
  'paused_by_user',
  /** An iteration was in flight and its outcome IS known from the journal. */
  'iteration_outcome_known',
  /** An iteration was in flight and its outcome is NOT known. Requires a human. */
  'execution_outcome_unknown',
  /** The adapter may still be running somewhere; Relay cannot see it. */
  'adapter_status_unavailable',
  /** The contract moved under the run — resuming would do unapproved work. */
  'contract_moved',
  /** The journal or snapshot did not verify. */
  'record_corrupt',
  /** Written by a newer build. */
  'unsupported_record_version',
  /** A limit or policy makes further work impossible. */
  'blocked',
  /** Already finished. Nothing to recover. */
  'completed',
  /** Ended without completing, and correctly stays ended. */
  'terminated',
] as const;
export type RelayLoopRecoveryClassification =
  (typeof RELAY_LOOP_RECOVERY_CLASSIFICATIONS)[number];

/** The classifications a Resume control may be offered for at all. */
export const RESUMABLE_LOOP_CLASSIFICATIONS: readonly RelayLoopRecoveryClassification[] = [
  'safe_to_resume',
  'paused_by_user',
  'iteration_outcome_known',
];

/** Classifications that must stay visible until a human acts. */
export const BLOCKING_LOOP_CLASSIFICATIONS: readonly RelayLoopRecoveryClassification[] = [
  'execution_outcome_unknown',
  'adapter_status_unavailable',
  'contract_moved',
  'record_corrupt',
  'unsupported_record_version',
  'blocked',
];

/* --------------------------------------------------------------- input */

export interface LoopRecoveryInput {
  readonly run: RelayLoopRun | null;
  /** Problems the journal replay reported. Non-empty means do not trust state. */
  readonly replayProblems: readonly string[];
  /** `false` when the live contract's digest no longer matches the run's. */
  readonly contractStillBinds: boolean;
  /** Whether the record's schema version is readable by this build. */
  readonly schemaSupported: boolean;
  /**
   * Whether the executing adapter can still be observed. `null` means Relay
   * did not ask or cannot know — which is NOT the same as "no", and is
   * classified as unavailable rather than assumed dead.
   */
  readonly adapterObservable: boolean | null;
}

export interface LoopRecoveryReport {
  readonly classification: RelayLoopRecoveryClassification;
  /** Plain sentence for a human. Deterministic; never adapter text. */
  readonly detail: string;
  /** Whether a Resume control may be OFFERED. Never whether to press it. */
  readonly resumable: boolean;
  /**
   * Whether the runtime may resume WITHOUT a human. False for every uncertain
   * classification — see the file header.
   */
  readonly mayAutoResume: boolean;
  /** The iteration whose outcome is uncertain, when one is. */
  readonly uncertainIterationId: string | null;
}

/* ------------------------------------------------------------ classify */

/**
 * Classify a run found after a restart.
 *
 * Order is deliberate: structural distrust (corruption, version, moved
 * contract) is decided before anything is read out of the state, because a run
 * whose record cannot be trusted has no state worth interpreting.
 */
export function classifyLoopRecovery(input: LoopRecoveryInput): LoopRecoveryReport {
  const report = (
    classification: RelayLoopRecoveryClassification,
    detail: string,
    uncertainIterationId: string | null = null,
  ): LoopRecoveryReport => ({
    classification,
    detail,
    resumable: RESUMABLE_LOOP_CLASSIFICATIONS.includes(classification),
    // Nothing here ever auto-resumes. Stage 2 has no provably idempotent
    // dispatch, so the safe answer and the honest answer are the same one.
    mayAutoResume: false,
    uncertainIterationId,
  });

  if (!input.schemaSupported) {
    return report(
      'unsupported_record_version',
      'This Loop run was written by a newer build of Relay and cannot be read safely. It was not resumed and nothing was replayed.',
    );
  }
  if (input.replayProblems.length > 0 || input.run === null) {
    return report(
      'record_corrupt',
      `This Loop run's journal did not replay cleanly, so its state cannot be vouched for. ${
        input.replayProblems[0] ?? 'The journal could not be reduced.'
      }`,
    );
  }

  const run = input.run;

  if (run.state === 'completed') {
    return report('completed', 'This Loop completed. There is nothing to recover.');
  }
  if (isTerminalLoopState(run.state)) {
    return report(
      'terminated',
      `This Loop ended in ${run.state.replace(/_/g, ' ')} and stays ended. Continuing the work requires a new run.`,
    );
  }

  if (!input.contractStillBinds) {
    return report(
      'contract_moved',
      'The Loop Contract changed after this run started. Resuming would do work nobody approved, so the run is held for inspection.',
    );
  }

  // An iteration in flight is the interesting case. What matters is not that
  // it was running, but whether the journal recorded how it ended.
  const inFlight = run.currentIterationId === null
    ? null
    : run.iterations.find((it) => it.iterationId === run.currentIterationId) ?? null;

  if (inFlight !== null) {
    const execution = inFlight.execution;
    if (execution === null) {
      // Started, never dispatched. Nothing external happened, so the iteration
      // can simply be re-entered.
      return report(
        'safe_to_resume',
        `Iteration ${inFlight.ordinal} was opened but no agent was dispatched, so nothing external happened and it can be started again.`,
      );
    }
    if (execution.outcome === 'unknown') {
      if (input.adapterObservable === true) {
        return report(
          'iteration_outcome_known',
          `Iteration ${inFlight.ordinal} is still being executed by an adapter Relay can observe, so its outcome can be read rather than guessed.`,
          inFlight.iterationId,
        );
      }
      if (input.adapterObservable === null) {
        return report(
          'adapter_status_unavailable',
          `Iteration ${inFlight.ordinal} was dispatched and Relay cannot determine whether the agent is still running. It was not replayed, because repeating a dispatch that may have already run is not safe.`,
          inFlight.iterationId,
        );
      }
      return report(
        'execution_outcome_unknown',
        `Iteration ${inFlight.ordinal} was dispatched and Relay never recorded how it ended. It will not be replayed automatically — that operation may already have run.`,
        inFlight.iterationId,
      );
    }
    return report(
      'iteration_outcome_known',
      `Iteration ${inFlight.ordinal} finished as ${execution.outcome} before the interruption, so the run can continue from the next iteration.`,
      null,
    );
  }

  if (run.state === 'paused') {
    return report('paused_by_user', 'This Loop is paused at a safe checkpoint. It resumes when you say so.');
  }
  if (run.blockers.length > 0) {
    return report(
      'blocked',
      `This Loop cannot continue yet: ${run.blockers[0].detail}`,
    );
  }
  if (run.state === 'recovery_required') {
    return report(
      'execution_outcome_unknown',
      run.interruptionReason
        ?? 'This Loop was marked as requiring recovery and has not been inspected.',
    );
  }

  return report(
    'safe_to_resume',
    'No iteration was in flight when Relay stopped, so this Loop can continue from the next one.',
  );
}
