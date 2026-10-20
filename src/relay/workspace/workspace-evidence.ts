import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import type { EvidenceRecord } from '../protocol/contracts';
import type { EvidenceId, IdFactory, RunId, TaskId } from '../protocol/ids';
import type { EventDraft } from '../protocol/envelopes';
import type { RelayWorkspace } from './contracts';

/**
 * Workspace evidence + event production (Prompt 7). Everything the
 * workspace infrastructure does becomes an objective EvidenceRecord with
 * provenance 'live' (this is REAL local enforcement, distinguished from
 * simulated agent execution and from future live provider execution) and a
 * normalized event draft. No absolute filesystem paths and no secret
 * values enter user-facing summaries.
 */

export const WORKSPACE_VERIFIER = 'relay-workspace';

export interface WorkspaceEvidenceInput {
  ids: IdFactory;
  now: string;
  runId: RunId;
  taskId: TaskId;
  label: string;
  status: 'passed' | 'failed';
  excerpt: string;
  evidenceType?: EvidenceRecord['evidenceType'];
  sourceRevision: string;
  command?: string;
  exitCode?: number;
}

export function makeWorkspaceEvidence(input: WorkspaceEvidenceInput): EvidenceRecord {
  return {
    evidenceId: input.ids.next('evd') as EvidenceId,
    taskId: input.taskId,
    runId: input.runId,
    source: WORKSPACE_VERIFIER,
    evidenceType: input.evidenceType ?? 'health-check',
    command: input.command,
    exitCode: input.exitCode,
    outputExcerpt: `${input.label}: ${input.excerpt}`.slice(0, 2000),
    executedAt: input.now,
    // No absolute paths: the workspace id is the address, not the location.
    environment: { os: process.platform, node: process.versions.node, cwd: '[relay-workspace]' },
    repoRevision: input.sourceRevision,
    verificationStatus: input.status,
    verifier: WORKSPACE_VERIFIER,
    provenance: 'live',
  };
}

export function makeWorkspaceEvent(
  workspace: Pick<RelayWorkspace, 'projectId' | 'runId' | 'taskId' | 'workspaceId'>,
  now: string,
  kind: EventDraft['kind'],
  safeSummary: string,
  payload: Record<string, unknown> = {},
): EventDraft {
  return {
    protocolVersion: RELAY_PROTOCOL_VERSION,
    at: now,
    projectId: workspace.projectId,
    runId: workspace.runId,
    taskId: workspace.taskId,
    source: 'system',
    kind,
    provenance: 'live',
    classification: 'historical',
    safeSummary: safeSummary.slice(0, 1000),
    payload,
    refs: { workspaceId: workspace.workspaceId },
  };
}
