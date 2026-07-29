import { ok, type RelayResult } from '../protocol/errors';
import {
  TERMINAL_LIFECYCLE_STATES,
  type ProviderSessionReadiness, type ProviderSessionReference, type RecoveryPlan,
  type RecoveryPlanOutcome, type RunLifecycleState, type WorkspaceReconciliation,
} from './contracts';
import type { StateStore, LoadedRun } from './store';
import { acquireRunLock, inspectLock } from './lock';
import { reinspectWorkspace, type RecoveredWorkspaceInspection } from './recovery-inspector';

/**
 * Recovery application service (Prompt 8.5) — separate from the CLI, and it
 * NEVER launches a provider (it imports no adapter and spawns nothing but
 * read-only git inspection). It locates a persisted run, validates journal
 * and snapshot integrity, replays, re-inspects the workspace, checks
 * source-worktree protection, classifies provider-session references,
 * reconciles call accounting, marks stale evidence durably, and produces a
 * safe recovery plan. Any further LIVE call always requires explicit founder
 * authorization — a process restart authorizes nothing.
 */

export interface RecoveryReport {
  runId: string;
  plan: RecoveryPlan;
  loaded: LoadedRun | null;
  workspaceInspection: RecoveredWorkspaceInspection | null;
  quarantined: boolean;
  /** Safe projection summaries for the Live Terminal feed — never
   * reconstructed dialogue. */
  projectionEvents: Array<{ kind: string; safeSummary: string }>;
}

export function classifySessionReadiness(input: {
  session: ProviderSessionReference;
  lifecycle: RunLifecycleState;
  workspaceReconciliation: WorkspaceReconciliation;
}): ProviderSessionReadiness {
  const { session } = input;
  if (session.invalidated) return 'invalid';
  if (!session.initializationVerified || !session.providerSessionId) return 'invalid';
  if (!session.resumeEligible || session.attempt >= 2) return 'expired';
  if (input.workspaceReconciliation === 'missing' || input.workspaceReconciliation === 'source_changed') {
    return 'resume_unavailable';
  }
  if (input.workspaceReconciliation === 'drift') return 'manual_action_required';
  // A persisted reference is NOT proof the provider session survives — it
  // stays persisted_unverified until a live, founder-authorized preflight
  // (out of scope here) proves otherwise.
  return 'persisted_unverified';
}

const dogMap: Partial<Record<RecoveryPlanOutcome, string>> = {
  inspection_only: 'idle',
  ready_for_verification: 'verifying',
  ready_for_review: 'waiting_for_user',
  ready_for_repair_authorization: 'waiting_for_user',
  ready_for_exact_claude_resume: 'waiting_for_user',
  ready_for_exact_codex_resume: 'waiting_for_user',
  waiting_for_user: 'waiting_for_user',
  manual_action_required: 'waiting_for_user',
  stopped_safely: 'stopped_safely',
  unrecoverable: 'stopped_safely',
};

/** Relay Dog state derived from RECOVERED canonical state (never invented
 * activity): recovery_required → waiting_for_user; inspection/verification
 * work → verifying; exact-session resume offers → waiting_for_user;
 * unrecoverable → stopped_safely; verified_complete → complete. */
export function dogStateForRecovery(outcome: RecoveryPlanOutcome, lifecycle: RunLifecycleState): string {
  if (lifecycle === 'verified_complete' || lifecycle === 'released') return 'complete';
  if (lifecycle === 'recovery_required' && outcome === 'ready_for_verification') return 'verifying';
  return dogMap[outcome] ?? 'waiting_for_user';
}

export function recoverRun(input: {
  store: StateStore;
  reference: string;
  now: () => string;
  /** Recovery validates + plans only; set true to also durably mark
   * recovery_required / stale evidence (requires the run lock to be free). */
  persistMarkers?: boolean;
}): RelayResult<RecoveryReport> {
  const { store, reference, now } = input;
  const diagnostics: string[] = [];
  const projectionEvents: RecoveryReport['projectionEvents'] = [];
  const emit = (kind: string, safeSummary: string): void => { projectionEvents.push({ kind, safeSummary }); };

  const loaded = store.loadRun(reference);
  if (!loaded.ok) return loaded;
  const run = loaded.value;
  emit('persistence.loaded', `Durable state loaded for run (${run.journal.events.length} journal events).`);
  diagnostics.push(...run.journal.diagnostics, ...run.snapshotDiagnostics);

  const unrecoverable = (reason: string, quarantine: boolean): RelayResult<RecoveryReport> => {
    diagnostics.push(reason);
    let quarantined = false;
    if (quarantine) {
      const q = store.quarantineRun(reference, reason, now());
      quarantined = q.ok;
      emit('run.quarantined', 'Corrupted run state quarantined — nothing was silently discarded.');
    }
    return ok({
      runId: reference,
      plan: {
        outcome: 'unrecoverable', lifecycle: 'corrupted', nextPermittedActions: ['inspect the quarantined records'],
        requiresFounderAuthorizationForLiveCalls: true, workspaceReconciliation: 'not_applicable',
        staleEvidenceIds: [], openFindingIds: [], pendingRepairIds: [], sessionReadiness: {},
        callBudget: run.state?.callBudget ?? { maxCalls: 0, consumed: 0, remaining: 0, byProvider: {}, automaticRetryProhibited: true },
        snapshotSource: run.snapshotSource, diagnostics,
      },
      loaded: run, workspaceInspection: null, quarantined, projectionEvents,
    });
  };

  /* 1-2. journal + snapshot validation. Tampering/corruption → quarantine,
   * never silent continuation. */
  if (run.journal.integrity === 'corrupt' || run.state === null) {
    return unrecoverable(
      `journal integrity failure: ${run.journal.corruptReason ?? run.replayProblems.join('; ')}`, true);
  }
  emit('persistence.validated', `Journal validated (${run.journal.integrity}); snapshot source: ${run.snapshotSource}.`);
  if (run.snapshotSource !== 'current') emit('snapshot.replayed', 'State reconstructed by journal replay.');

  const state = run.state;
  const lifecycle = state.run.lifecycle;
  const terminal = TERMINAL_LIFECYCLE_STATES.includes(lifecycle);

  /* Crash detection: a non-terminal run, or a lock left by a dead owner. */
  const lock = inspectLock(run.runDir);
  const uncleanShutdown = !terminal || lock.status === 'stale_owner_dead';
  if (lock.status === 'held_by_live_owner') {
    diagnostics.push(`run is locked by a live process (pid ${lock.owner?.pid}) — read-only recovery inspection only`);
  }
  if (uncleanShutdown && !terminal) {
    emit('run.recovery_required', 'Run did not shut down cleanly — recovery required before any further work.');
  }

  /* 3-4. workspace re-inspection + source-worktree protection. */
  let workspaceInspection: RecoveredWorkspaceInspection | null = null;
  let reconciliation: WorkspaceReconciliation = 'not_applicable';
  if (state.workspace) {
    if (state.workspace.cleanupStatus === 'cleaned') {
      reconciliation = terminal ? 'not_applicable' : 'missing';
    } else {
      workspaceInspection = reinspectWorkspace(state.workspace);
      if (!workspaceInspection.workspaceExists) reconciliation = 'missing';
      else if (workspaceInspection.sourceExists && !workspaceInspection.sourceMatchesPersisted) reconciliation = 'source_changed';
      else if (!workspaceInspection.digestsMatchPersisted) reconciliation = 'drift';
      else reconciliation = 'match';
      emit('workspace.reconciled', `Workspace re-inspected: ${reconciliation}.`);
    }
  }

  /* 5. provider-session reference classification (no provider contact). */
  const sessionReadiness: RecoveryPlan['sessionReadiness'] = {};
  for (const session of state.sessions) {
    sessionReadiness[session.provider] = classifySessionReadiness({
      session, lifecycle, workspaceReconciliation: reconciliation,
    });
    if (sessionReadiness[session.provider] === 'persisted_unverified') {
      emit('provider_session.persisted_unverified',
        `${session.provider} session reference persisted — availability UNVERIFIED until a founder-authorized preflight.`);
    }
  }

  /* 6. call accounting — the replayed journal is authoritative; a restart
   * can never reset consumption. */
  const callBudget = state.callBudget;
  if (!run.snapshotConsistent && run.snapshotSource !== 'replay_only') {
    diagnostics.push('snapshot disagreed with the journal — journal replay wins');
  }

  /* Evidence staleness: any drift/source change makes prior evidence stale. */
  const staleEvidenceIds = (reconciliation === 'drift' || reconciliation === 'source_changed')
    ? state.evidence.filter((e) => e.status === 'current').map((e) => e.evidenceId)
    : [];
  if (staleEvidenceIds.length > 0) {
    emit('evidence.marked_stale', `${staleEvidenceIds.length} evidence record(s) marked stale after workspace reconciliation.`);
  }

  const openFindings = state.findings.filter((f) => f.blocking && f.status !== 'resolved');
  const pendingRepairs = state.repairs.filter((r) => r.status !== 'resolved');

  /* 7. derive the plan. Never a provider launch; explicit authorization is
   * always required before any further live call. */
  let outcome: RecoveryPlanOutcome;
  const actions: string[] = [];
  if (reconciliation === 'source_changed') {
    outcome = 'stopped_safely';
    actions.push('source repository changed — stop; founder must re-baseline explicitly');
  } else if (terminal) {
    outcome = lifecycle === 'stopped_safely' || lifecycle === 'canceled' ? 'stopped_safely' : 'inspection_only';
    actions.push('inspect the completed record; no resume is proposed');
  } else if (reconciliation === 'missing') {
    outcome = 'manual_action_required';
    actions.push('workspace is missing — founder decision required (no state is invented)');
  } else if (reconciliation === 'drift') {
    outcome = 'ready_for_verification';
    actions.push('re-inspect and re-verify the drifted workspace before anything else');
  } else if (lifecycle === 'held_for_rereview') {
    // The repair phase already progressed past the finding — lifecycle wins
    // over the ledger's still-open finding (it resolves only on re-review).
    outcome = 'ready_for_exact_codex_resume';
    actions.push('founder may authorize resuming the exact Codex session for the re-review');
  } else if (lifecycle === 'held_for_reverification') {
    outcome = 'ready_for_verification';
    actions.push('Relay re-verification must run before the re-review');
  } else if (lifecycle === 'repair_authorized' || lifecycle === 'repair_running') {
    outcome = 'ready_for_exact_claude_resume';
    actions.push('founder may authorize resuming the exact Claude session for the bounded repair');
  } else if (openFindings.length > 0 && pendingRepairs.some((r) => r.status === 'assigned')) {
    outcome = 'ready_for_repair_authorization';
    actions.push('founder may authorize the single bounded repair (exact Claude session resume)');
  } else if (lifecycle === 'held_for_verification' || lifecycle === 'held_for_inspection') {
    outcome = 'ready_for_verification';
    actions.push('Relay verification must run next');
  } else if (lifecycle === 'held_for_review' || lifecycle === 'approved_for_release') {
    outcome = lifecycle === 'held_for_review' ? 'ready_for_review' : 'inspection_only';
    actions.push(lifecycle === 'held_for_review'
      ? 'founder may authorize the independent review launch'
      : 'evaluate the completion policy');
  } else if (lifecycle === 'implementation_running' || lifecycle === 'initialized') {
    outcome = 'waiting_for_user';
    actions.push('implementation was interrupted — founder decides whether to restart it (never automatic)');
  } else {
    outcome = 'waiting_for_user';
    actions.push('founder decision required');
  }
  if ((callBudget.remaining ?? 0) <= 0) {
    actions.push('live-call budget is exhausted — no further calls are possible');
  }

  const plan: RecoveryPlan = {
    outcome, lifecycle,
    nextPermittedActions: actions,
    requiresFounderAuthorizationForLiveCalls: true,
    workspaceReconciliation: reconciliation,
    staleEvidenceIds,
    openFindingIds: openFindings.map((f) => f.findingId),
    pendingRepairIds: pendingRepairs.map((r) => r.repairId),
    sessionReadiness,
    callBudget,
    snapshotSource: run.snapshotSource,
    diagnostics,
  };
  emit('recovery.plan_created', `Recovery plan: ${outcome} (lifecycle ${lifecycle}).`);
  emit('run.recovery_ready', 'Recovery validation complete — awaiting explicit decisions.');

  /* Durable markers — mutation, so it takes the run lock (reclaiming a
   * crash-stale lock under the documented dead-owner condition). A live
   * owner keeps recovery read-only. */
  if (input.persistMarkers && lock.status !== 'held_by_live_owner' && !terminal) {
    const acquired = acquireRunLock(run.runDir, 'recovery-markers', now);
    if (!acquired.ok) {
      plan.diagnostics.push(`recovery markers skipped: ${acquired.error.message}`);
    } else {
      plan.diagnostics.push(...acquired.value.diagnostics);
      try {
        const markProblems: string[] = [];
        if (state.run.lifecycle !== 'recovery_required') {
          const marked = store.appendEvent(reference, {
            at: now(), projectId: state.project.projectId, missionId: state.mission.missionId,
            taskId: state.task.taskId, runId: reference, attemptId: `attempt-${state.task.attemptLineage.at(-1) ?? 1}`,
            kind: 'run.recovery_required', actor: 'relay-recovery',
            payload: { priorLifecycle: lifecycle, lifecycleAfter: 'recovery_required', phase: 'recovery' },
          });
          if (!marked.ok) markProblems.push(marked.error.message);
        }
        if (staleEvidenceIds.length > 0) {
          const staled = store.appendEvent(reference, {
            at: now(), projectId: state.project.projectId, missionId: state.mission.missionId,
            taskId: state.task.taskId, runId: reference, attemptId: `attempt-${state.task.attemptLineage.at(-1) ?? 1}`,
            kind: 'evidence.marked_stale', actor: 'relay-recovery',
            payload: { evidenceIds: staleEvidenceIds, reason: `workspace ${reconciliation}` },
          });
          if (!staled.ok) markProblems.push(staled.error.message);
        }
        plan.diagnostics.push(...markProblems);
      } finally {
        acquired.value.lock.release();
      }
    }
  }

  return ok({ runId: reference, plan, loaded: run, workspaceInspection, quarantined: false, projectionEvents });
}
