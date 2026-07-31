import {
  BLOCKING_CLASSIFICATIONS,
  RESUMABLE_CLASSIFICATIONS,
  type DurableMissionRecord,
  type DurableRecoveryClassification,
} from './durable-contracts';
import type { DurableReadResult } from './durable-record';

/**
 * RECOVERY VALIDATION — pure classification of a discovered incomplete
 * mission. No storage, no clock beyond the injected `now`, no execution.
 *
 * The rule that shapes everything: RELAY NEVER CLAIMS MORE THAN IT KNOWS.
 * An action whose completion is unknown is not replayed and not assumed
 * finished — it downgrades the mission to `cannot_resume_safely`, which the
 * customer sees as "inspect before continuing". A restart authorizes
 * nothing, exactly as the Node recovery service already guarantees for runs.
 */

export interface RecoveryEnvironment {
  /** Contract revisions this build can still resolve. */
  readonly knownContractRevisions?: readonly string[];
  /** Environment references that still exist. */
  readonly knownEnvironmentRefs?: readonly string[];
  /** True when a runtime is actually attached and reachable. In the offline
      build this is FALSE, so recovery never claims a live reconnection. */
  readonly runtimeAvailable: boolean;
  /** False when the budget cannot fund any further work. */
  readonly budgetSufficient: boolean;
  /** True when another session already holds a live claim on this mission. */
  readonly duplicateExecutionDetected?: boolean;
  /** The session asking to recover — used for lease comparison. */
  readonly sessionId: string;
  /** ISO now, injected. */
  readonly now: string;
}

export interface RecoveryAssessment {
  readonly classification: DurableRecoveryClassification;
  /** One truthful sentence for the recovery surface and the notification. */
  readonly summary: string;
  /** Everything that was checked and what it found — for Inspect. */
  readonly diagnostics: readonly string[];
  /** May the UI offer Resume at all? */
  readonly canResume: boolean;
  /** Must this stay on screen until the user acts? */
  readonly blocking: boolean;
  /** Present only for a readable record. */
  readonly record: DurableMissionRecord | null;
  /**
   * ALWAYS false in this milestone for the offline build: recovery restores
   * saved state, it never reconnects a runtime. Kept explicit so no surface
   * can imply otherwise by accident.
   */
  readonly runtimeReconnected: boolean;
}

/** Canonical terminal mission states (`RelayMissionState`), plus the run
    lifecycle's own terminal words so a Node-written record classifies too. */
const TERMINAL_STATES: ReadonlySet<string> = new Set([
  'verified_complete', 'failed', 'cancelled',
  'released', 'stopped_safely', 'canceled', 'quarantined',
]);

/** A lease still held by ANOTHER session, and not yet expired. */
function foreignLeaseHeld(record: DurableMissionRecord, env: RecoveryEnvironment): boolean {
  const owner = record.owner;
  if (owner === null) return false;
  if (owner.sessionId === env.sessionId) return false;
  const expires = Date.parse(owner.expiresAt);
  const now = Date.parse(env.now);
  if (!Number.isFinite(expires) || !Number.isFinite(now)) return false;
  return expires > now;
}

/**
 * Classify a stored record (or a failed read) into exactly one customer
 * outcome. Order is deliberate: unreadable records first, then safety
 * blockers, then the states the customer can act on.
 */
export function assessRecovery(
  read: DurableReadResult,
  env: RecoveryEnvironment,
): RecoveryAssessment {
  const diagnostics: string[] = [];

  if (!read.ok) {
    if (read.reason === 'not_found') {
      return {
        classification: 'cannot_resume_safely',
        summary: 'No saved mission record was found.',
        diagnostics: ['No durable record exists for this mission.'],
        canResume: false,
        blocking: false,
        record: null,
        runtimeReconnected: false,
      };
    }
    const classification: DurableRecoveryClassification =
      read.reason === 'unsupported_version' ? 'unsupported_record_version' : 'record_corrupt';
    return {
      classification,
      summary:
        classification === 'unsupported_record_version'
          ? 'This saved mission was written by a newer version of Relay and was not loaded.'
          : 'The saved mission record did not pass integrity validation and was not loaded.',
      // The record is NEVER deleted — the detail says what failed so the
      // customer can inspect or export it.
      diagnostics: [read.detail, 'The stored record was left untouched for inspection.'],
      canResume: false,
      blocking: true,
      record: null,
      runtimeReconnected: false,
    };
  }

  const record = read.record;
  diagnostics.push(`Record schema ${record.schemaVersion} validated (checksum verified).`);
  if (read.migrated) diagnostics.push('Record was migrated forward from an older supported schema.');

  const finish = (
    classification: DurableRecoveryClassification,
    summary: string,
  ): RecoveryAssessment => ({
    classification,
    summary,
    diagnostics,
    canResume: RESUMABLE_CLASSIFICATIONS.includes(classification),
    blocking: BLOCKING_CLASSIFICATIONS.includes(classification),
    record,
    // Restoring saved state is not a runtime connection. Ever.
    runtimeReconnected: false,
  });

  if (TERMINAL_STATES.has(record.missionState)) {
    diagnostics.push(`Mission state ${record.missionState} is terminal — nothing to resume.`);
    return finish('completed', 'This mission had already finished before the interruption.');
  }

  // Identity and reference validation.
  const knownRevisions = env.knownContractRevisions;
  if (knownRevisions !== undefined && !knownRevisions.includes(record.missionContractRevision)) {
    diagnostics.push(
      `Mission Contract revision ${record.missionContractRevision} no longer resolves.`,
    );
    return finish(
      'cannot_resume_safely',
      'The Mission Contract revision this mission ran against is no longer available.',
    );
  }
  diagnostics.push(`Mission Contract ${record.missionContractRef} @ ${record.missionContractRevision} resolved.`);

  const knownEnvs = env.knownEnvironmentRefs;
  const missingEnv = record.assignments
    .map((a) => a.environmentRef)
    .filter((ref): ref is string => ref !== null)
    .find((ref) => knownEnvs !== undefined && !knownEnvs.includes(ref));
  if (missingEnv !== undefined) {
    diagnostics.push(`Environment ${missingEnv} could not be confirmed.`);
    return finish(
      'environment_requires_inspection',
      'The environment this mission used could not be confirmed and needs inspection.',
    );
  }

  if (env.duplicateExecutionDetected === true || foreignLeaseHeld(record, env)) {
    diagnostics.push('Another session currently holds this mission.');
    return finish(
      'cannot_resume_safely',
      'Another Relay session is already working on this mission.',
    );
  }

  if (!env.budgetSufficient) {
    diagnostics.push('Budget state cannot fund further work.');
    return finish('budget_blocked', 'This mission cannot continue until its budget allows it.');
  }

  // THE CENTRAL SAFETY RULE: an in-flight action with an unconfirmed outcome
  // is never replayed automatically.
  const inFlight = record.inFlightAction;
  if (inFlight !== null && inFlight.outcome === 'unknown') {
    diagnostics.push(
      `Action ${inFlight.actionId} (${inFlight.kind}) was interrupted with an unknown outcome — it will not be repeated automatically.`,
    );
    return finish(
      'cannot_resume_safely',
      `Relay cannot tell whether "${inFlight.summary}" finished, so it will not repeat it. Inspect the mission to decide.`,
    );
  }
  if (inFlight !== null) {
    diagnostics.push(`In-flight action ${inFlight.actionId} resolved as ${inFlight.outcome}.`);
  }
  if (record.lastCompletedAction !== null) {
    diagnostics.push(
      `Last confirmed action: ${record.lastCompletedAction.summary} (${record.lastCompletedAction.outcome}).`,
    );
  }

  // The checkpoint reason is the authority for WHY the mission stopped —
  // it was recorded at the safe boundary, by the machine, not inferred here.
  if (
    record.checkpointReason === 'approval_requested' ||
    record.missionState === 'repair_required'
  ) {
    return finish('awaiting_approval', 'This mission is waiting for your approval to continue.');
  }
  if (record.checkpointReason === 'mission_paused') {
    return finish('paused', 'This mission was paused and its state was saved.');
  }

  if (!env.runtimeAvailable) {
    diagnostics.push('No runtime is attached — saved state can be restored, but nothing reconnects.');
    // The saved state is fully restorable; the mission simply cannot execute
    // until a runtime exists. That is `ready_to_resume` for state, and the
    // surface must label execution as unavailable.
    return finish(
      'ready_to_resume',
      'Relay saved this mission and can restore it. No runtime is attached, so execution stays unavailable.',
    );
  }

  return finish('ready_to_resume', 'Relay restored the latest safe checkpoint for this mission.');
}

/**
 * Whether the mission's execution controls may actually START work. Distinct
 * from `canResume`, which only means "the saved state can be restored".
 * Restoring state is free; starting paid execution needs a real runtime AND
 * an explicit user confirmation.
 */
export function executionMayStart(
  assessment: RecoveryAssessment,
  env: RecoveryEnvironment,
): boolean {
  return assessment.canResume && env.runtimeAvailable && !assessment.blocking;
}
