import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  SupervisedPersistenceBoundary, SupervisedPersistenceHooks,
} from '../connectors/supervised/contracts';
import type { PersistedEventKind } from './contracts';
import { sha256Hex } from './integrity';
import { acquireRunLock, type AcquiredLock } from './lock';
import { resolveRunDir } from './paths';
import type { StateStore } from './store';

/**
 * Supervised → durable-persistence bridge (Prompt 8.5). Adapts the
 * supervised runner's boundary hooks onto the run store: initializes the
 * run + acquires the run lock on `run_initialized`, maps each boundary to
 * its journal kind, enriches inspection boundaries with claimed-file
 * content digests, builds bounded evidence manifests, and releases the
 * lock on a clean terminal boundary. A crash simply leaves the lock held —
 * recovery classifies it stale by owner-process liveness.
 *
 * A store failure THROWS: a persistence integrity problem aborts the run
 * rather than being silently ignored.
 */

const KIND_BY_BOUNDARY: Record<SupervisedPersistenceBoundary, PersistedEventKind> = {
  run_initialized: 'run.initialized',
  workspace_created: 'workspace.created',
  provider_launch_authorized: 'provider_launch.authorized',
  implementer_initialization_verified: 'implementer.initialization_verified',
  implementer_report_received: 'implementer.report_received',
  workspace_inspected: 'workspace.inspected',
  verification_completed: 'verification.completed',
  reviewer_initialization_verified: 'reviewer.initialization_verified',
  review_received: 'review.received',
  finding_created: 'finding.created',
  repair_created: 'repair.created',
  session_resume_authorized: 'session_resume.authorized',
  repair_received: 'repair.received',
  re_verification_completed: 're_verification.completed',
  re_review_received: 're_review.received',
  completion_evaluated: 'completion.evaluated',
  verified_complete: 'run.verified_complete',
  stopped_safely: 'run.stopped_safely',
  cleanup_completed: 'cleanup.completed',
};

const TERMINAL_BOUNDARIES: ReadonlySet<SupervisedPersistenceBoundary> =
  new Set(['verified_complete', 'stopped_safely']);

export interface SupervisedRunRecorder extends SupervisedPersistenceHooks {
  readonly runId: string | null;
  /** Explicit release for abnormal orchestration paths (idempotent). */
  release(): void;
}

export function createSupervisedRunRecorder(input: {
  store: StateStore;
  now: () => string;
  /** Called AFTER a boundary is durably recorded — the offline restart
   * drill uses this to exit the process at an exact boundary. */
  afterRecord?: (boundary: SupervisedPersistenceBoundary) => void;
}): SupervisedRunRecorder {
  const { store, now } = input;
  let ctx: { runId: string; projectId: string; missionId: string; taskId: string } | null = null;
  let lock: AcquiredLock | null = null;
  let workspacePath: string | null = null;
  let claimedFiles: string[] = [];
  let attempt = 1;
  let evidenceCount = 0;

  const digestClaimedFiles = (): Record<string, string> => {
    const digests: Record<string, string> = {};
    if (!workspacePath) return digests;
    for (const file of claimedFiles) {
      const abs = join(workspacePath, file);
      if (existsSync(abs)) digests[file] = sha256Hex(readFileSync(abs, 'utf8'));
    }
    return digests;
  };

  const recorder: SupervisedRunRecorder = {
    get runId() { return ctx?.runId ?? null; },

    record(boundary, payload) {
      if (boundary === 'run_initialized') {
        const runId = String(payload.runId ?? '');
        ctx = {
          runId,
          projectId: String(payload.projectId ?? ''),
          missionId: String(payload.missionId ?? ''),
          taskId: String(payload.taskId ?? ''),
        };
        const created = store.initRun({
          runId, projectId: ctx.projectId,
          displayName: String(payload.displayName ?? 'Supervised run'), at: now(),
        });
        if (!created.ok) throw new Error(`Persistence init failed: ${created.error.message}`);
        const runDir = resolveRunDir(store.root, 'runs', runId);
        if (!runDir.ok) throw new Error(runDir.error.message);
        const acquired = acquireRunLock(runDir.value, 'supervised-run', now);
        if (!acquired.ok) throw new Error(`Run lock unavailable: ${acquired.error.message}`);
        lock = acquired.value.lock;
      }
      if (!ctx) return; // boundaries before initialization have nothing to attach to

      if (typeof payload.attempt === 'number') attempt = payload.attempt;
      const enriched: Record<string, unknown> = { ...payload };
      if (boundary === 'workspace_created') {
        workspacePath = String(payload.canonicalPath ?? '') || null;
        claimedFiles = Array.isArray(payload.claimedFiles)
          ? (payload.claimedFiles as unknown[]).filter((f): f is string => typeof f === 'string') : [];
      }
      if (boundary === 'workspace_inspected') {
        enriched.claimedFileDigests = digestClaimedFiles();
      }
      if (boundary === 'verification_completed' || boundary === 're_verification_completed') {
        evidenceCount += 1;
        enriched.evidence = {
          evidenceId: `evd-${ctx.runId}-${evidenceCount}`,
          evidenceType: 'command',
          command: String(payload.command ?? ''),
          safeArgs: [],
          exitStatus: typeof payload.exitStatus === 'number' ? payload.exitStatus : null,
          workspaceRevision: String(payload.workspaceRevision ?? ''),
          resultDigest: sha256Hex(JSON.stringify({
            command: payload.command, passed: payload.passed, revision: payload.workspaceRevision,
          })),
          at: now(),
          criterionIds: Array.isArray(payload.criterionIds) ? payload.criterionIds : [],
          sourceActor: String(payload.sourceActor ?? 'relay-workspace'),
          verificationAuthority: String(payload.verificationAuthority ?? 'relay-workspace'),
          status: 'current',
        };
      }

      const appended = store.appendEvent(ctx.runId, {
        at: now(),
        projectId: ctx.projectId,
        missionId: ctx.missionId,
        taskId: ctx.taskId,
        runId: ctx.runId,
        attemptId: `attempt-${attempt}`,
        kind: KIND_BY_BOUNDARY[boundary],
        actor: typeof payload.actor === 'string' ? payload.actor : 'relay-supervised',
        ...(typeof payload.revision === 'string' ? { workspaceRevision: payload.revision } :
          typeof payload.workspaceRevision === 'string' ? { workspaceRevision: payload.workspaceRevision } : {}),
        payload: enriched,
      });
      if (!appended.ok) {
        throw new Error(`Persistence append failed at ${boundary}: ${appended.error.message}`);
      }
      if (TERMINAL_BOUNDARIES.has(boundary)) recorder.release();
      input.afterRecord?.(boundary);
    },

    release() {
      lock?.release();
      lock = null;
    },
  };
  return recorder;
}
