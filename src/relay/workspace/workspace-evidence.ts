import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import type { EvidenceRecord } from '../protocol/contracts';
import type { EvidenceId, IdFactory, ProjectId, RunId, TaskId, WorkspaceRefId } from '../protocol/ids';
import type { EventDraft, RelayEventKind } from '../protocol/envelopes';
import { sanitizeOutput } from './output-sanitizer';

/**
 * Workspace evidence and event builders (Prompt 7) — pure constructors.
 * Everything produced here is LIVE LOCAL infrastructure evidence
 * (provenance 'live', verifier 'relay-workspace'): real Git worktrees and
 * real policy-restricted processes, never live AI provider execution. All
 * excerpts pass the secret-shape sanitizer before storage.
 */

export const WORKSPACE_VERIFIER = 'relay-workspace';

export interface WorkspaceEvidenceContext {
  ids: IdFactory;
  now(): string;
  environment: { os: string; node: string; cwd: string };
}

export interface WorkspaceEvidenceInput {
  runId: RunId;
  taskId: TaskId;
  evidenceType: 'command' | 'diff' | 'health-check';
  outputExcerpt: string;
  repoRevision: string;
  passed: boolean;
  command?: string;
  exitCode?: number;
}

export function buildWorkspaceEvidence(ctx: WorkspaceEvidenceContext, input: WorkspaceEvidenceInput): EvidenceRecord {
  return {
    evidenceId: ctx.ids.next('evd') as EvidenceId,
    taskId: input.taskId,
    runId: input.runId,
    source: WORKSPACE_VERIFIER,
    evidenceType: input.evidenceType,
    command: input.command,
    exitCode: input.exitCode,
    outputExcerpt: sanitizeOutput(input.outputExcerpt).text.slice(0, 2000),
    executedAt: ctx.now(),
    environment: ctx.environment,
    repoRevision: input.repoRevision,
    verificationStatus: input.passed ? 'passed' : 'failed',
    verifier: WORKSPACE_VERIFIER,
    provenance: 'live',
  };
}

export interface WorkspaceEventInput {
  projectId: ProjectId;
  runId: RunId;
  taskId?: TaskId;
  kind: RelayEventKind;
  safeSummary: string;
  workspaceId: WorkspaceRefId;
  evidenceIds?: string[];
  payload?: Record<string, unknown>;
}

/** Normalized event draft. safeSummary never carries absolute paths —
 * workspaces are identified by id, branch, and short revision only. */
export function buildWorkspaceEvent(ctx: WorkspaceEvidenceContext, input: WorkspaceEventInput): EventDraft {
  return {
    protocolVersion: RELAY_PROTOCOL_VERSION,
    at: ctx.now(),
    projectId: input.projectId,
    runId: input.runId,
    taskId: input.taskId,
    source: 'system',
    kind: input.kind,
    provenance: 'live',
    classification: 'historical',
    safeSummary: sanitizeOutput(input.safeSummary).text.slice(0, 1000),
    payload: input.payload ?? {},
    refs: { workspaceId: input.workspaceId, ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}) },
  };
}

export const shortRevision = (revision: string): string => revision.slice(0, 10);
