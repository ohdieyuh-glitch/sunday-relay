import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import type { ProjectId, RunId, TaskId, WorkspaceRefId } from '../../protocol/ids';
import type { ClaudeSessionRecord } from './contracts';

/**
 * Session manager (Prompt 8) — volatile, in-memory. Captures the Claude
 * session ID from the structured stream and stores ONLY the id plus
 * association (never auth tokens). Resume is EXPLICIT: it reuses the exact
 * captured id, the same workspace, and the same task; a resumed stream that
 * reports a different session id is rejected (never silently a new session).
 *
 * Because Relay storage is volatile, session resume works only while the
 * record lives in this process — durable cross-process resume is not claimed.
 */

export interface SessionAssociation {
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  workspaceId: WorkspaceRefId;
  adapterId: string;
}

export function createSessionManager(now: () => string) {
  const byTask = new Map<string, ClaudeSessionRecord>();
  const key = (a: SessionAssociation) => `${a.runId}|${a.taskId}`;

  return {
    /** Record a newly created session from attempt 1. */
    capture(association: SessionAssociation, claudeSessionId: string): RelayResult<ClaudeSessionRecord> {
      if (typeof claudeSessionId !== 'string' || claudeSessionId.trim() === '') {
        return fail(relayError('validation-failed', 'No Claude session id was captured — cannot record a session.'));
      }
      if (byTask.has(key(association))) {
        return fail(relayError('duplicate-command', 'A session is already recorded for this task (one live dispatch per task).'));
      }
      const record: ClaudeSessionRecord = {
        claudeSessionId, adapterId: association.adapterId,
        projectId: association.projectId, runId: association.runId,
        taskId: association.taskId, workspaceId: association.workspaceId,
        attempt: 1, createdAt: now(), status: 'created', provenance: 'live',
      };
      byTask.set(key(association), record);
      return ok({ ...record });
    },

    get(association: SessionAssociation): ClaudeSessionRecord | null {
      const record = byTask.get(key(association));
      return record ? { ...record } : null;
    },

    /** Prepare an explicit resume: returns the exact session id to resume,
     * only when the same task/workspace already has a captured session and
     * no second repair has been used. */
    prepareResume(association: SessionAssociation): RelayResult<{ claudeSessionId: string }> {
      const record = byTask.get(key(association));
      if (!record) return fail(relayError('not-found', 'No captured session to resume — will not start a new one silently.'));
      if (record.workspaceId !== association.workspaceId) {
        return fail(relayError('validation-failed', 'Resume workspace differs from the captured session workspace.'));
      }
      if (record.attempt >= 2) {
        return fail(relayError('revision-limit-exceeded', 'This session already used its single repair.'));
      }
      return ok({ claudeSessionId: record.claudeSessionId });
    },

    /** Confirm a resumed stream reported the EXPECTED session id, else fail
     * (the caller then checkpoints — never accepts a mismatched session). */
    confirmResume(association: SessionAssociation, reportedSessionId: string | null): RelayResult<ClaudeSessionRecord> {
      const record = byTask.get(key(association));
      if (!record) return fail(relayError('not-found', 'No captured session to confirm.'));
      if (reportedSessionId !== record.claudeSessionId) {
        return fail(relayError('validation-failed', 'Resumed session id does not match the captured session — refusing to continue.'));
      }
      record.attempt = 2;
      record.lastResumedAt = now();
      record.status = 'resumed';
      return ok({ ...record });
    },

    setStatus(association: SessionAssociation, status: ClaudeSessionRecord['status']): void {
      const record = byTask.get(key(association));
      if (record) record.status = status;
    },

    /** Serializable snapshot (ids + association only — never tokens). */
    list(): ClaudeSessionRecord[] {
      return [...byTask.values()].map((r) => ({ ...r }));
    },
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;
