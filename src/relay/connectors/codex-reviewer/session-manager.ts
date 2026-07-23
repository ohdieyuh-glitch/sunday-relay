import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import type { ProjectId, RunId, TaskId, WorkspaceRefId } from '../../protocol/ids';
import type { CodexSessionRecord } from './contracts';

/**
 * Codex Reviewer session manager (Prompt 8.3) — in-memory capture + EXACT
 * resume. Stores the Codex session/thread UUID + association ONLY (never auth
 * tokens). A re-review resumes the exact captured session by id against the
 * same review, mission, and task; a wrong or missing session id is rejected,
 * and a second attempt is refused (single-repair scope this phase). Volatile:
 * durable cross-process reviewer recovery remains unavailable.
 */

export interface ReviewerSessionAssociation {
  reviewId: string;
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  workspaceId: WorkspaceRefId;
  adapterId: string;
}

const key = (a: ReviewerSessionAssociation): string => `${a.reviewId}|${a.runId}|${a.taskId}`;

export function createReviewerSessionManager(now: () => string): {
  capture(association: ReviewerSessionAssociation, codexSessionId: string): RelayResult<CodexSessionRecord>;
  get(association: ReviewerSessionAssociation): CodexSessionRecord | null;
  prepareResume(association: ReviewerSessionAssociation): RelayResult<{ codexSessionId: string }>;
  confirmResume(association: ReviewerSessionAssociation, reportedSessionId: string | null): RelayResult<CodexSessionRecord>;
  setStatus(association: ReviewerSessionAssociation, status: CodexSessionRecord['status']): void;
  list(): CodexSessionRecord[];
} {
  const store = new Map<string, CodexSessionRecord>();

  return {
    capture(association, codexSessionId): RelayResult<CodexSessionRecord> {
      if (!codexSessionId || !codexSessionId.trim()) {
        return fail(relayError('validation-failed', 'A Codex session id is required to capture the reviewer session.'));
      }
      const k = key(association);
      if (store.has(k)) return fail(relayError('duplicate-command', 'A reviewer session is already captured for this review.'));
      const record: CodexSessionRecord = {
        codexSessionId, adapterId: association.adapterId, reviewId: association.reviewId,
        projectId: association.projectId, runId: association.runId, taskId: association.taskId,
        workspaceId: association.workspaceId, attempt: 1, createdAt: now(), status: 'created', provenance: 'live',
      };
      store.set(k, record);
      return ok(record);
    },
    get(association): CodexSessionRecord | null {
      return store.get(key(association)) ?? null;
    },
    prepareResume(association): RelayResult<{ codexSessionId: string }> {
      const record = store.get(key(association));
      if (!record) return fail(relayError('not-found', 'No captured reviewer session to resume.'));
      if (record.workspaceId !== association.workspaceId) {
        return fail(relayError('validation-failed', 'Re-review must resume in the repaired workspace association.'));
      }
      if (record.attempt >= 2) return fail(relayError('revision-limit-exceeded', 'Exact-session re-review already used its single attempt.'));
      return ok({ codexSessionId: record.codexSessionId });
    },
    confirmResume(association, reportedSessionId): RelayResult<CodexSessionRecord> {
      const record = store.get(key(association));
      if (!record) return fail(relayError('not-found', 'No captured reviewer session to confirm.'));
      if (!reportedSessionId || reportedSessionId !== record.codexSessionId) {
        return fail(relayError('validation-failed', 'Resumed session identity does not match the captured reviewer session — rejected.'));
      }
      record.attempt = 2;
      record.lastResumedAt = now();
      record.status = 'resumed';
      return ok(record);
    },
    setStatus(association, status): void {
      const record = store.get(key(association));
      if (record) record.status = status;
    },
    list(): CodexSessionRecord[] {
      return [...store.values()];
    },
  };
}

export type ReviewerSessionManager = ReturnType<typeof createReviewerSessionManager>;
