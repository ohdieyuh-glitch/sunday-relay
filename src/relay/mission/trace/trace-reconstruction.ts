/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * Deterministic trace reconstruction (PURE).
 *
 * Folds the ordered ledger into an `AqualaTrace` summary. It reuses the
 * Milestone 1 engine for the four-status model rather than re-implementing
 * transition rules, and it reads capsule identity from the events the
 * Milestone 3 adapter emitted rather than re-deriving it.
 *
 * What it will NOT do, ever:
 *   - infer outcome from execution completion;
 *   - infer verification from a reviewer process finishing;
 *   - infer release from verification;
 *   - substitute a requested agent for an actual one;
 *   - turn absent cost receipts into a number.
 */

import {
  applyStatusTransition,
  createInitialAqualaOutcomeStatus,
  type AqualaOutcomeStatus,
  type AqualaStatusDimension,
} from '../status/status-model';
import { traceError, traceFail, traceOk, type TraceResult } from './trace-errors';
import { verifyTraceIntegrity } from './trace-integrity';
import type {
  AqualaTrace,
  AqualaTraceIdentitySummary,
} from './trace-summary';
import type {
  AqualaTraceEvent,
  AqualaTraceEventFamily,
  AqualaTraceManifest,
  AqualaTraceSourceProduct,
} from './trace-types';

const STATUS_EVENT_DIMENSIONS: Readonly<Record<string, AqualaStatusDimension>> = {
  mission_execution_status_changed: 'execution',
  mission_outcome_status_changed: 'outcome',
  mission_verification_status_changed: 'verification',
  mission_release_status_changed: 'release',
};

function readString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(metadata: Record<string, unknown>, key: string): boolean {
  return metadata[key] === true;
}

function pushUnique(target: string[], value: string | undefined): void {
  if (value && !target.includes(value)) target.push(value);
}

function readStringArray(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Reconstructs the summary. Fails deterministically when the ledger itself is
 * incoherent — an invalid chain produces a FAILED integrity report rather
 * than a summary that pretends the trace is trustworthy.
 */
export function reconstructTrace(
  manifest: AqualaTraceManifest,
  events: readonly AqualaTraceEvent[],
): TraceResult<AqualaTrace> {
  if (events.length === 0) {
    return traceFail(
      traceError(
        'TRACE_RECONSTRUCTION_FAILED',
        'a trace cannot be reconstructed with no events',
        'load the trace events before reconstructing',
        { traceId: manifest.traceId },
      ),
    );
  }

  const integrity = verifyTraceIntegrity(manifest, events);

  const capsuleIds: string[] = [];
  const runIds: string[] = [];
  const workspaceIds: string[] = [];
  const commandIds: string[] = [];
  const evidenceIds: string[] = [];
  const reviewIds: string[] = [];
  const findingIds: string[] = [];
  const repairIds: string[] = [];
  const approvalIds: string[] = [];
  const costReceiptIds: string[] = [];
  const passportIds: string[] = [];
  const selectedModels: string[] = [];
  const selectedAgents: string[] = [];
  const selectedTools: string[] = [];
  const rationaleReferences: string[] = [];
  const sourceProducts: AqualaTraceSourceProduct[] = [];
  const eventCountsByFamily: Partial<Record<AqualaTraceEventFamily, number>> = {};
  const identities = new Map<string, AqualaTraceIdentitySummary>();

  let status: AqualaOutcomeStatus = createInitialAqualaOutcomeStatus();
  let missionRevision: number | undefined;
  let taskRevision: number | undefined;
  let projectBrainRevision: number | undefined;
  let handoffCompilerVersion: string | undefined;
  let policyPackVersion: string | undefined;
  let userIntent: string | undefined;
  let objectiveReference: string | undefined;
  let issuedAt: string | undefined;
  let completedAt: string | undefined;
  let sealedAt: string | undefined;

  for (const event of events) {
    eventCountsByFamily[event.eventFamily] = (eventCountsByFamily[event.eventFamily] ?? 0) + 1;
    if (!sourceProducts.includes(event.sourceProduct)) sourceProducts.push(event.sourceProduct);

    pushUnique(capsuleIds, event.capsuleId);
    pushUnique(runIds, event.runId);
    pushUnique(commandIds, event.commandId);
    if (event.missionRevision !== undefined) missionRevision = event.missionRevision;
    if (event.taskRevision !== undefined) taskRevision = event.taskRevision;

    const metadata = event.metadata;

    switch (event.eventType) {
      case 'trace_completed':
        completedAt = event.occurredAt;
        break;
      case 'trace_sealed':
        sealedAt = event.occurredAt;
        break;
      case 'execution_capsule_prepared': {
        pushUnique(workspaceIds, readString(metadata, 'workspaceId'));
        pushUnique(passportIds, readString(metadata, 'passportId'));
        handoffCompilerVersion = readString(metadata, 'handoffCompilerVersion') ?? handoffCompilerVersion;
        policyPackVersion = readString(metadata, 'policyPackVersion') ?? policyPackVersion;
        if (event.capsuleId) {
          identities.set(event.capsuleId, {
            capsuleId: event.capsuleId,
            requestedAgentId: readString(metadata, 'requestedAgentId'),
            launchVerified: false,
            fallbackOccurred: false,
            fallbackAuthorized: false,
          });
        }
        break;
      }
      case 'agent_launch_verified':
      case 'agent_fallback_authorized': {
        if (!event.capsuleId) break;
        const existing = identities.get(event.capsuleId);
        const authorizedFallback = event.eventType === 'agent_fallback_authorized';
        identities.set(event.capsuleId, {
          capsuleId: event.capsuleId,
          requestedAgentId: readString(metadata, 'requestedAgentId') ?? existing?.requestedAgentId,
          actualAgentId: readString(metadata, 'actualAgentId'),
          observedAgentId: readString(metadata, 'actualAgentId'),
          launchVerified: true,
          fallbackOccurred: authorizedFallback || readBoolean(metadata, 'fallbackOccurred'),
          fallbackAuthorized: authorizedFallback,
        });
        break;
      }
      case 'agent_launch_failed': {
        if (!event.capsuleId) break;
        const existing = identities.get(event.capsuleId);
        identities.set(event.capsuleId, {
          capsuleId: event.capsuleId,
          requestedAgentId: readString(metadata, 'requestedAgentId') ?? existing?.requestedAgentId,
          launchVerified: false,
          fallbackOccurred: false,
          fallbackAuthorized: false,
        });
        break;
      }
      case 'agent_fallback_rejected': {
        if (!event.capsuleId) break;
        const existing = identities.get(event.capsuleId);
        identities.set(event.capsuleId, {
          capsuleId: event.capsuleId,
          requestedAgentId: readString(metadata, 'requestedAgentId') ?? existing?.requestedAgentId,
          // An unauthorized substitution is OBSERVED, never actual.
          observedAgentId: readString(metadata, 'observedAgentId'),
          launchVerified: false,
          fallbackOccurred: true,
          fallbackAuthorized: false,
        });
        break;
      }
      case 'evidence_reference_linked':
        pushUnique(evidenceIds, readString(metadata, 'evidenceId'));
        break;
      case 'review_reference_linked':
        pushUnique(reviewIds, readString(metadata, 'reviewId'));
        break;
      case 'finding_reference_linked':
        pushUnique(findingIds, readString(metadata, 'findingId'));
        break;
      case 'repair_reference_linked':
        pushUnique(repairIds, readString(metadata, 'repairId'));
        break;
      case 'approval_reference_linked':
      case 'command_approval_received':
        pushUnique(approvalIds, readString(metadata, 'approvalId'));
        break;
      case 'cost_receipt_reference_linked':
        pushUnique(costReceiptIds, readString(metadata, 'costReceiptId'));
        break;
      case 'workspace_reference_linked':
        pushUnique(workspaceIds, readString(metadata, 'workspaceId'));
        break;
      case 'trace_created':
        userIntent = readString(metadata, 'userIntent');
        objectiveReference = readString(metadata, 'objectiveReference');
        issuedAt = event.occurredAt;
        projectBrainRevision = readNumber(metadata, 'projectBrainRevision');
        break;
      default:
        break;
    }

    // Routing facts, wherever a routing-family event records them.
    if (event.eventFamily === 'routing') {
      for (const model of readStringArray(metadata, 'selectedModels')) pushUnique(selectedModels, model);
      for (const agent of readStringArray(metadata, 'selectedAgents')) pushUnique(selectedAgents, agent);
      for (const tool of readStringArray(metadata, 'selectedTools')) pushUnique(selectedTools, tool);
      for (const ref of readStringArray(metadata, 'rationaleReferences')) {
        pushUnique(rationaleReferences, ref);
      }
    }

    /* ---- the four-status model, through the REAL Milestone 1 engine ---- */
    const dimension = STATUS_EVENT_DIMENSIONS[event.eventType];
    if (dimension) {
      const nextStatus = readString(metadata, 'nextStatus');
      if (!nextStatus) {
        return traceFail(
          traceError(
            'TRACE_RECONSTRUCTION_FAILED',
            `${event.eventType} at sequence ${event.sequence} records no next status`,
            'investigate the malformed status event',
            { traceId: manifest.traceId, eventId: event.eventId, sequence: event.sequence },
          ),
        );
      }
      const applied = applyStatusTransition(status, {
        dimension,
        nextStatus,
        reason: readString(metadata, 'reason') ?? event.eventType,
        actorId: event.actorId,
        actorType: 'relay',
        eventId: event.eventId,
        projectId: event.projectId,
        missionId: event.missionId ?? manifest.missionId ?? '',
        missionRevision: event.missionRevision ?? 0,
        ...(event.artifactRevision ? { artifactRevision: event.artifactRevision } : {}),
        currentArtifactRevision: event.artifactRevision,
        occurredAt: event.occurredAt,
      });
      if (!applied.ok) {
        return traceFail(
          traceError(
            'TRACE_RECONSTRUCTION_FAILED',
            `status event at sequence ${event.sequence} is not a legal transition: ${applied.error.reason}`,
            'investigate the contradictory status history',
            { traceId: manifest.traceId, eventId: event.eventId, sequence: event.sequence },
          ),
        );
      }
      status = applied.status;
    }
  }

  const summary: AqualaTrace = {
    traceId: manifest.traceId,
    schemaVersion: manifest.schemaVersion,
    projectId: manifest.projectId,
    ...(manifest.missionId ? { missionId: manifest.missionId } : {}),
    ...(manifest.taskId ? { taskId: manifest.taskId } : {}),
    sourceProducts,
    request: {
      ...(userIntent ? { userIntent } : {}),
      ...(objectiveReference ? { objectiveReference } : {}),
      ...(issuedAt ? { issuedAt } : {}),
    },
    context: {
      ...(projectBrainRevision !== undefined ? { projectBrainRevision } : {}),
      ...(missionRevision !== undefined ? { missionRevision } : {}),
      ...(taskRevision !== undefined ? { taskRevision } : {}),
      ...(handoffCompilerVersion ? { handoffCompilerVersion } : {}),
    },
    routing: { selectedModels, selectedAgents, selectedTools, rationaleReferences },
    policy: {
      ...(policyPackVersion ? { policyPackVersion } : {}),
      passportIds,
      approvalIds,
    },
    execution: {
      capsuleIds,
      runIds,
      workspaceIds,
      commandIds,
      identities: [...identities.values()],
    },
    verification: {
      reviewIds,
      findingIds,
      repairIds,
      evidenceIds,
      executionStatus: status.executionStatus,
      outcomeStatus: status.outcomeStatus,
      verificationStatus: status.verificationStatus,
      releaseStatus: status.releaseStatus,
    },
    economics: {
      costReceiptIds,
      // Never inferred, never zero — Milestone 5 supplies real amounts.
      directModelCostUsd: null,
      agentExecutionCostUsd: null,
      reviewCostUsd: null,
      repairCostUsd: null,
      retryCostUsd: null,
      totalCostUsd: null,
      runtimeMs: null,
      status: costReceiptIds.length === 0 ? 'not_available' : 'partial',
    },
    eventCountsByFamily,
    eventCount: events.length,
    firstEventAt: events[0]?.occurredAt,
    lastEventAt: events[events.length - 1]?.occurredAt,
    integrity,
    lifecycleStatus: integrity.valid ? manifest.lifecycleStatus : 'integrity_failed',
    createdAt: manifest.createdAt,
    ...(completedAt ? { completedAt } : {}),
    ...(sealedAt ? { sealedAt } : {}),
  };

  return traceOk(summary);
}
