import {
  DURABLE_MISSION_SCHEMA_VERSION,
  type DurableActionRecord,
  type DurableAgentAssignment,
  type DurableCheckpointReason,
  type DurableMissionRecord,
  type DurableMissionRecordDraft,
} from '../../mission/durable';
import type { RelayUsageSnapshot } from '../../usage';
import type {
  RelayEvent,
  RelayMission,
  RelayProject,
  StoredProjectSettings,
} from './contracts';

/**
 * PROJECTION: browser store state → the canonical durable mission record.
 *
 * Pure, and deliberately conservative. Everything it writes is something the
 * store already knows; nothing is inferred, and every unknown stays `null`.
 * In particular:
 *   - the Mission Contract is REFERENCED (id + revision), never copied;
 *   - findings, repairs, evidence and receipts are reference lists;
 *   - an in-flight action whose result never arrived is recorded with the
 *     outcome `unknown`, which is exactly what stops replay after a restart;
 *   - a cost Relay does not know stays `null` and never becomes zero.
 */

/**
 * The safe boundary a given canonical mission state represents. The mapping
 * is exhaustive over `RelayMissionState`, so a new mission state cannot
 * silently fall through to a wrong checkpoint reason.
 */
export function checkpointReasonForMission(mission: RelayMission): DurableCheckpointReason {
  switch (mission.state) {
    case 'verified_complete':
    case 'failed':
    case 'cancelled':
      return 'mission_terminal_state';
    case 'configured':
      return 'mission_contract_accepted';
    case 'ready':
    case 'architect_working':
      return 'mission_execution_began';
    case 'handoff_ready':
      return 'handoff_completed';
    case 'coding':
      return 'mission_execution_began';
    case 'claim_submitted':
      return 'bounded_task_completed';
    case 'relay_verifying':
    case 're_verifying':
      return 'test_result_recorded';
    case 'reviewer_reviewing':
      return 'reviewer_findings_recorded';
    case 'repair_required':
    case 'repair_in_progress':
      return 'repair_requested';
    case 'approved':
      return 'approval_received';
    default:
      return 'mission_execution_began';
  }
}

function assignmentsFor(
  settings: StoredProjectSettings | null,
  mission: RelayMission,
): DurableAgentAssignment[] {
  const draft = settings?.draft as
    | { promptArchitect?: string; codingAgent?: string; reviewer?: string | null }
    | undefined;
  const terminal = mission.terminal;
  // The runtime is only ACTUAL when the terminal state actually reports one.
  const codingActual = terminal?.runtime ?? null;
  return [
    {
      role: 'prompt_architect',
      displayName: draft?.promptArchitect ?? 'Prompt Architect',
      requestedRuntime: draft?.promptArchitect ?? 'unassigned',
      actualRuntime: mission.handoff !== undefined ? (mission.handoff.architectLabel ?? null) : null,
      environmentRef: null,
      grantedTools: [],
    },
    {
      role: 'coding_agent',
      displayName: draft?.codingAgent ?? 'Coding Agent',
      requestedRuntime: draft?.codingAgent ?? 'unassigned',
      actualRuntime: typeof codingActual === 'string' ? codingActual : null,
      environmentRef: null,
      grantedTools: terminal?.permissions?.allowedTools ?? [],
    },
    {
      role: 'reviewer',
      displayName: draft?.reviewer ?? 'None selected',
      requestedRuntime: draft?.reviewer ?? 'unassigned',
      actualRuntime: null,
      environmentRef: null,
      grantedTools: [],
    },
  ];
}

/**
 * The action Relay was in the middle of, if any.
 *
 * A terminal line that opened a command or test with no recorded result is
 * the honest definition of "we do not know whether this finished".
 */
function inFlightActionFor(mission: RelayMission): DurableActionRecord | null {
  const terminal = mission.terminal;
  if (terminal === undefined) return null;
  // Only a LIVE execution can have an unfinished action. A complete, failed
  // or cancelled execution has already reported its outcome.
  if (terminal.status !== 'live') return null;
  const lines = terminal.lines ?? [];
  const last = lines[lines.length - 1];
  if (last === undefined) return null;
  return {
    actionId: `${mission.id}:line:${last.sequence}`,
    kind: last.kind === 'verification' ? 'test' : 'command',
    summary: last.text.slice(0, 200),
    // Interrupted mid-flight: Relay cannot claim this finished.
    outcome: 'unknown',
    startedAt: last.at,
    completedAt: null,
  };
}

/** Lines that genuinely report an OUTCOME, newest first. */
const OUTCOME_LINE_KINDS = new Set(['process', 'verification', 'inspection']);

function lastCompletedActionFor(mission: RelayMission): DurableActionRecord | null {
  const terminal = mission.terminal;
  if (terminal === undefined) return null;
  const lines = terminal.lines ?? [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!OUTCOME_LINE_KINDS.has(line.kind)) continue;
    return {
      actionId: `${mission.id}:line:${line.sequence}`,
      kind: line.kind === 'verification' ? 'test' : 'command',
      summary: line.text.slice(0, 200),
      startedAt: line.at,
      outcome: 'completed',
      completedAt: line.at,
    };
  }
  return null;
}

export interface DurableProjectionInput {
  readonly mission: RelayMission;
  readonly project: RelayProject;
  readonly settings: StoredProjectSettings | null;
  readonly events: readonly RelayEvent[];
  readonly usage: RelayUsageSnapshot | null;
  /** Carried forward so a restart does not reset the guard. */
  readonly previous: DurableMissionRecord | null;
  readonly interruptionReason: string | null;
  readonly now: string;
}

/** Build the draft for the current mission state. */
export function projectDurableMissionRecord(
  input: DurableProjectionInput,
): DurableMissionRecordDraft {
  const { mission, project, settings, events, usage, previous, now } = input;
  const terminal = mission.terminal;

  // Relay's own inspection when it exists; otherwise the agent's CLAIM.
  const filesReportedChanged =
    terminal?.changedFiles !== undefined && terminal.changedFiles.length > 0
      ? terminal.changedFiles
      : mission.claim?.filesChanged ?? [];
  const commandsReported = (terminal?.lines ?? [])
    .filter((line) => line.kind === 'command')
    .map((line) => line.text.slice(0, 200));

  const testStatus: 'passed' | 'failed' | 'not_run' | 'unknown' = (() => {
    const status = terminal?.test?.status;
    if (status === 'passed' || status === 'failed' || status === 'not_run') return status;
    return 'unknown';
  })();

  const findingRefs = (mission.review?.findings ?? []).map((f) => f.findingId);

  return {
    schemaVersion: DURABLE_MISSION_SCHEMA_VERSION,
    missionId: mission.id,
    projectId: project.id,
    // REFERENCE, never a copy of the contract's instructions.
    missionContractRef: `${project.id}:${mission.id}`,
    missionContractRevision: mission.missionRevision ?? 'r1',
    assignments: assignmentsFor(settings, mission),
    missionState: mission.state,
    stage: mission.phase ?? mission.currentRole ?? 'unknown',
    currentTaskRef: terminal?.executionId ?? null,
    lastCompletedAction: lastCompletedActionFor(mission),
    inFlightAction: inFlightActionFor(mission),
    evidence: {
      filesReportedChanged,
      commandsReported,
      testStatus,
      evidenceRefs: (mission.attestations ?? []).map((a) => a.attestationId),
      traceLedgerRefs: events.map((e) => e.id).slice(-50),
      executionCapsuleRefs: terminal?.executionId !== undefined ? [terminal.executionId] : [],
      findingRefs,
      repairRefs: [],
      handoffRefs: mission.handoffDigest !== undefined ? [mission.handoffDigest] : [],
      approvalRefs: events.filter((e) => e.category === 'manual_task').map((e) => e.id),
    },
    usage: {
      costReceiptRefs: [],
      // Relay does not know a cost here — and unknown must never become 0.
      knownCostMicros: null,
      currency: null,
      budgetStatus: null,
      usageProvenance: usage?.provenance ?? null,
    },
    interruptionReason: input.interruptionReason,
    provenance: mission.demo ? 'simulated' : usage?.provenance === 'live' ? 'live' : 'offline',
    createdAt: previous?.createdAt ?? mission.createdAt,
    updatedAt: now,
    checkpointReason: checkpointReasonForMission(mission),
    checkpointAt: now,
    // Never reset by a restart.
    recoveryGeneration: previous?.recoveryGeneration ?? 0,
    owner: previous?.owner ?? null,
  };
}
