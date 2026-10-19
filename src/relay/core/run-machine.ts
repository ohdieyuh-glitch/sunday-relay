import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import type { CommandEnvelope, EventDraft } from '../protocol/envelopes';
import type {
  Blueprint, CompletionPolicy, FinalAuditReport, ManualTask, RelayRun,
  ReviewerVerdictRecord, RevisionContract, VerificationRecord,
} from '../protocol/contracts';
import type { EvidenceId, IdFactory, ReportId } from '../protocol/ids';
import type { ManualTaskStatus, Provenance, ProvenanceProfile } from '../protocol/enums';
import { ACTIVE_MANUAL_TASK_STATUSES, TERMINAL_RUN_STATUSES } from '../protocol/enums';

/**
 * Deterministic RelayRun state machine (PROTOCOL §2.3). Status × phase
 * model; run-level `blocked` does not exist (task-level blocked surfaces as
 * checkpoint_required; the audit outcome may record blocked). All rules are
 * centralized here: terminal protection, phase order, the one-repair limit,
 * checkpoint semantics, and the completion guard (a run can NEVER complete
 * from an agent-reported status alone — it requires Relay-produced passing
 * verification plus the required review verdict).
 *
 * Pure: no IO, no clock reads, no random ids — time and id factories are
 * injected; events are emitted as drafts (ledger assigns id + sequence).
 */

export type RunIntent =
  | { intent: 'begin' }
  /** manualTask (Prompt 6.1): a core-compiled Manual Task rides the raised
   * checkpoint; the machine mints the checkpoint id and binds it. */
  | { intent: 'raise-checkpoint'; reason: string; manualTask?: Omit<ManualTask, 'checkpointId'> }
  | { intent: 'record-blueprint'; blueprint: Blueprint }
  | { intent: 'record-report'; reportType: 'implementation' | 'repair'; reportId: ReportId; provenance: Provenance }
  | { intent: 'record-verification'; verification: VerificationRecord; provenance: Provenance }
  | { intent: 'record-verdict'; verdict: ReviewerVerdictRecord; reportId: ReportId }
  /** Applied by Relay Core after a Done claim — never by a client. */
  | { intent: 'record-manual-verification'; outcome: 'passed' | 'failed' | 'unavailable'; evidenceId?: EvidenceId }
  | { intent: 'record-audit'; audit: FinalAuditReport };

export type RunAction = CommandEnvelope | RunIntent;

export interface RunTransitionInput {
  run: RelayRun;
  action: RunAction;
  now: string;
  ids: IdFactory;
  correlationId?: string;
  /** Evidence for guarded transitions. */
  completionPolicy?: CompletionPolicy;
  revisionContract?: RevisionContract;
  /** Latest Relay-produced verification (completion guard input). */
  latestVerification?: VerificationRecord;
  /** Latest reviewer verdict (completion guard input). */
  latestVerdict?: ReviewerVerdictRecord;
}

export interface RunTransitionOutcome {
  run: RelayRun;
  events: EventDraft[];
  requiredActions: string[];
}

const isCommand = (a: RunAction): a is CommandEnvelope => 'commandType' in a;

function mergeProfile(current: ProvenanceProfile, incoming: Provenance): ProvenanceProfile {
  const incomingProfile: ProvenanceProfile =
    incoming === 'simulated' ? 'simulated' : incoming === 'live' ? 'live' : 'mixed';
  if (current === incomingProfile) return current;
  return 'mixed';
}

function draft(
  run: RelayRun,
  kind: EventDraft['kind'],
  safeSummary: string,
  extra: Partial<EventDraft> = {},
): EventDraft {
  return {
    protocolVersion: RELAY_PROTOCOL_VERSION,
    at: '',
    projectId: run.projectId,
    runId: run.runId,
    source: 'relay-core',
    kind,
    provenance: 'simulated',
    classification: 'historical',
    safeSummary,
    payload: {},
    ...extra,
  };
}

const illegal = (run: RelayRun, why: string) =>
  fail<RunTransitionOutcome>(
    relayError('illegal-transition', why, {
      entityIds: { runId: run.runId },
      details: [`status=${run.status}`, `phase=${run.phase}`],
    }),
  );

const terminal = (run: RelayRun) =>
  fail<RunTransitionOutcome>(
    relayError('immutable', `Run is terminal (${run.status}) and cannot be mutated.`, {
      entityIds: { runId: run.runId },
    }),
  );

const manualTaskIsActive = (task: ManualTask | undefined): task is ManualTask =>
  !!task && (ACTIVE_MANUAL_TASK_STATUSES as readonly string[]).includes(task.status);

export function transitionRun(input: RunTransitionInput): RelayResult<RunTransitionOutcome> {
  const { run, action, now, ids, correlationId } = input;
  const events: EventDraft[] = [];
  const requiredActions: string[] = [];

  if ((TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status)) {
    return terminal(run);
  }

  const stamp = (d: EventDraft): EventDraft => ({ ...d, at: now, correlationId });

  /* ---------- commands ---------- */
  if (isCommand(action)) {
    const payload = action.payload as Record<string, unknown>;
    switch (action.commandType) {
      case 'pause-run': {
        if (run.status !== 'active') return illegal(run, 'Only an active run can pause.');
        const next: RelayRun = { ...run, status: 'paused', pausedAt: now };
        events.push(stamp(draft(run, 'run.paused', 'Run paused by operator.', { provenance: 'manual' })));
        return ok({ run: next, events, requiredActions });
      }
      case 'resume-run': {
        if (run.status !== 'paused') {
          return illegal(run, 'Resume is only valid from paused (checkpoints resume via respond-checkpoint).');
        }
        const next: RelayRun = { ...run, status: 'active', pausedAt: undefined };
        events.push(stamp(draft(run, 'run.resumed', 'Run resumed.', { provenance: 'manual' })));
        return ok({ run: next, events, requiredActions });
      }
      case 'cancel-run': {
        const reason = String(payload.reason ?? '');
        let checkpoint = run.checkpoint;
        // The canonical cancel also closes an active Manual Task honestly.
        if (checkpoint && manualTaskIsActive(checkpoint.manualTask)) {
          checkpoint = {
            ...checkpoint,
            manualTask: { ...checkpoint.manualTask, status: 'cancelled', updatedAt: now, cancelledAt: now },
          };
          events.push(
            stamp(
              draft(run, 'manual.task_cancelled', 'Manual task cancelled with the run.', {
                provenance: 'manual',
                refs: { checkpointId: checkpoint.checkpointId, manualTaskId: checkpoint.manualTask!.manualTaskId },
              }),
            ),
          );
        }
        const next: RelayRun = { ...run, status: 'cancelled', completedAt: now, checkpoint };
        events.push(
          stamp(draft(run, 'run.cancelled', `Run cancelled: ${reason}`, { provenance: 'manual', payload: { reason } })),
        );
        return ok({ run: next, events, requiredActions });
      }
      case 'respond-checkpoint': {
        if (run.status !== 'checkpoint_required' || !run.checkpoint) {
          return illegal(run, 'No checkpoint is awaiting a response.');
        }
        if (payload.checkpointId !== run.checkpoint.checkpointId) {
          return illegal(run, 'Checkpoint id does not match the pending checkpoint.');
        }
        const response = payload.response as 'approve' | 'reject';
        let manualTask = run.checkpoint.manualTask;
        // Operator decision resolves an active Manual Task honestly:
        // approving a verified-unavailable Done claim completes it; anything
        // else closed by the operator is recorded as closed, never done.
        if (manualTaskIsActive(manualTask)) {
          if (response === 'approve' && manualTask.status === 'user_marked_done') {
            manualTask = { ...manualTask, status: 'completed', updatedAt: now, completedAt: now };
            events.push(
              stamp(
                draft(run, 'manual.task_completed', 'Operator confirmed the manual task result.', {
                  provenance: 'manual',
                  refs: { checkpointId: run.checkpoint.checkpointId, manualTaskId: manualTask.manualTaskId },
                }),
              ),
            );
          } else {
            manualTask = { ...manualTask, status: 'cancelled', updatedAt: now, cancelledAt: now };
            events.push(
              stamp(
                draft(run, 'manual.task_cancelled', 'Manual task closed without completion by operator decision.', {
                  provenance: 'manual',
                  refs: { checkpointId: run.checkpoint.checkpointId, manualTaskId: manualTask.manualTaskId },
                }),
              ),
            );
          }
        }
        const responded = { ...run.checkpoint, respondedAt: now, response, manualTask };
        events.push(
          stamp(
            draft(run, 'run.checkpoint_responded', `Checkpoint ${response}d by operator.`, {
              provenance: 'manual',
              payload: { response },
              refs: { checkpointId: run.checkpoint.checkpointId },
            }),
          ),
        );
        if (response === 'approve') {
          const next: RelayRun = { ...run, status: 'active', checkpoint: responded };
          events.push(stamp(draft(run, 'run.resumed', 'Run resumed after checkpoint approval.', { provenance: 'manual' })));
          return ok({ run: next, events, requiredActions });
        }
        const next: RelayRun = { ...run, status: 'cancelled', checkpoint: responded, completedAt: now };
        events.push(stamp(draft(run, 'run.cancelled', 'Run cancelled: checkpoint rejected.', { provenance: 'manual' })));
        return ok({ run: next, events, requiredActions });
      }
      case 'respond-manual-task': {
        if (run.status !== 'checkpoint_required' || !run.checkpoint?.manualTask) {
          return illegal(run, 'No manual task is awaiting a response.');
        }
        const checkpoint = run.checkpoint;
        const task = checkpoint.manualTask!;
        if (payload.checkpointId !== checkpoint.checkpointId || payload.manualTaskId !== task.manualTaskId) {
          return illegal(run, 'Manual task id does not match the pending manual task.');
        }
        const response = payload.response as 'done' | 'help' | 'cannot';
        const note = typeof payload.note === 'string' ? payload.note : undefined;
        const respondable: ManualTaskStatus[] = ['pending', 'needs_more_information'];
        if (response !== 'help' && !respondable.includes(task.status)) {
          return illegal(run, `Manual task is ${task.status} and does not accept "${response}".`);
        }
        if (response === 'help' && !manualTaskIsActive(task)) {
          return illegal(run, 'Manual task is no longer active.');
        }
        const refs = { checkpointId: checkpoint.checkpointId, manualTaskId: task.manualTaskId };
        const summaries: Record<typeof response, string> = {
          done: 'User marked the manual task done — recorded as a claim, not evidence.',
          help: 'User asked for help — the run remains safely stopped.',
          cannot: 'User cannot complete the manual task — blocker recorded; the run remains safely stopped.',
        };
        events.push(
          stamp(
            draft(run, 'manual.response_recorded', summaries[response], {
              provenance: 'manual',
              payload: { response, ...(note ? { note } : {}) },
              refs,
            }),
          ),
        );
        const updated: ManualTask =
          response === 'done'
            ? { ...task, status: 'user_marked_done', updatedAt: now }
            : response === 'cannot'
              ? { ...task, status: 'cannot_complete', updatedAt: now, blockerNote: note }
              : { ...task, updatedAt: now };
        const next: RelayRun = { ...run, checkpoint: { ...checkpoint, manualTask: updated } };
        // Done is a claim: the run STAYS stopped until Relay Core verifies.
        if (response === 'done') requiredActions.push('verify-manual-task');
        return ok({ run: next, events, requiredActions });
      }
      case 'accept-blueprint': {
        if (run.status !== 'active' || run.phase !== 'blueprint') {
          return illegal(run, 'accept-blueprint is only valid in the active blueprint phase.');
        }
        if (!run.blueprintId || payload.blueprintId !== run.blueprintId) {
          return illegal(run, 'No matching blueprint has been recorded for this run.');
        }
        const next: RelayRun = { ...run, phase: 'handoff' };
        events.push(
          stamp(
            draft(run, 'architect.blueprint_accepted', 'Blueprint accepted by operator.', {
              provenance: 'manual',
              classification: 'canonical',
              refs: { blueprintId: run.blueprintId },
            }),
          ),
          stamp(draft(run, 'run.phase_changed', 'Phase: blueprint → handoff.', { payload: { from: 'blueprint', to: 'handoff' } })),
        );
        requiredActions.push('create-task-from-blueprint', 'compile-handoff');
        return ok({ run: next, events, requiredActions });
      }
      case 'dispatch-task': {
        if (run.status !== 'active' || run.phase !== 'handoff') {
          return illegal(run, 'dispatch-task is only valid in the active handoff phase.');
        }
        const next: RelayRun = { ...run, phase: 'implementation' };
        events.push(
          stamp(
            draft(run, 'handoff.dispatched', 'Responsibility contract dispatched to the implementer.', {
              payload: { taskId: payload.taskId, packageId: payload.packageId },
            }),
          ),
          stamp(draft(run, 'run.phase_changed', 'Phase: handoff → implementation.', { payload: { from: 'handoff', to: 'implementation' } })),
        );
        return ok({ run: next, events, requiredActions });
      }
      case 'request-verification': {
        const scope = payload.scope as 'initial' | 'final';
        if (run.status !== 'active') return illegal(run, 'Verification requires an active run.');
        if (scope === 'initial' && run.phase !== 'implementation') {
          return illegal(run, 'Initial verification follows the implementation phase.');
        }
        if (scope === 'final' && run.phase !== 'repair') {
          return illegal(run, 'Final verification follows the repair phase.');
        }
        const to = scope === 'initial' ? 'verification' : 'final_verification';
        const next: RelayRun = { ...run, phase: to };
        events.push(
          stamp(draft(run, 'verification.started', `Deterministic verification started (${scope}).`, { payload: { scope } })),
          stamp(draft(run, 'run.phase_changed', `Phase: ${run.phase} → ${to}.`, { payload: { from: run.phase, to } })),
        );
        return ok({ run: next, events, requiredActions });
      }
      case 'dispatch-revision': {
        if (run.status !== 'active' || run.phase !== 'review') {
          return illegal(run, 'dispatch-revision is only valid in the active review phase.');
        }
        const contract = input.revisionContract;
        if (!contract) {
          return fail(relayError('evidence-required', 'dispatch-revision requires a RevisionContract.', { entityIds: { runId: run.runId } }));
        }
        if (run.repairCount >= run.loopPolicy.maxAutomaticRevisions) {
          return fail(
            relayError('revision-limit-exceeded', `Loop policy allows ${run.loopPolicy.maxAutomaticRevisions} automatic revision(s); ${run.repairCount} already used. Never a second automatic repair.`, {
              entityIds: { runId: run.runId },
            }),
          );
        }
        const verdict = input.latestVerdict;
        if (!verdict || verdict.verdict !== 'changes_requested' || verdict.findings.length === 0) {
          return fail(
            relayError('evidence-required', 'A revision requires a standing changes_requested verdict with findings.', {
              entityIds: { runId: run.runId },
            }),
          );
        }
        const findingIds = new Set(verdict.findings.map((f) => f.id));
        const unknown = contract.findingsTargeted.filter((f) => !findingIds.has(f));
        if (unknown.length > 0) {
          return fail(
            relayError('evidence-required', `Revision targets unknown finding id(s): ${unknown.join(', ')}.`, {
              entityIds: { runId: run.runId },
            }),
          );
        }
        const unsatisfied = contract.conditionsChecked.filter((c) => !c.satisfied);
        if (unsatisfied.length > 0) {
          const checkpointId = ids.next('ckp');
          const reason = `Automatic repair conditions unsatisfied: ${unsatisfied.map((c) => c.condition).join('; ')}`;
          const next: RelayRun = {
            ...run,
            status: 'checkpoint_required',
            checkpoint: { checkpointId, runId: run.runId, reason, requestedAt: now },
          };
          events.push(
            stamp(
              draft(run, 'run.checkpoint_required', reason, {
                refs: { checkpointId },
                payload: { unsatisfied: unsatisfied.map((c) => c.condition) },
              }),
            ),
          );
          return ok({ run: next, events, requiredActions });
        }
        const next: RelayRun = { ...run, phase: 'repair', repairCount: (run.repairCount + 1) as 0 | 1 };
        events.push(
          stamp(
            draft(run, 'handoff.dispatched', 'Revision contract dispatched (automatic repair 1 of 1).', {
              payload: { packageId: contract.packageId, findingsTargeted: contract.findingsTargeted },
            }),
          ),
          stamp(draft(run, 'run.phase_changed', 'Phase: review → repair.', { payload: { from: 'review', to: 'repair' } })),
        );
        return ok({ run: next, events, requiredActions });
      }
      default:
        return illegal(run, `Command ${action.commandType} is not a run transition.`);
    }
  }

  /* ---------- internal intents ---------- */
  switch (action.intent) {
    case 'raise-checkpoint': {
      // Core-raised checkpoint (budget stop, adapter failure, unsatisfiable
      // completion, manual task, ...) — legal from any active state.
      if (run.status !== 'active') return illegal(run, 'Checkpoints are raised from an active run.');
      const checkpointId = ids.next('ckp');
      const manualTask: ManualTask | undefined = action.manualTask
        ? { ...action.manualTask, checkpointId }
        : undefined;
      const next: RelayRun = {
        ...run,
        status: 'checkpoint_required',
        checkpoint: {
          checkpointId, runId: run.runId, reason: action.reason, requestedAt: now,
          ...(manualTask ? { manualTask } : {}),
        },
      };
      events.push(
        stamp(
          draft(run, 'run.checkpoint_required', action.reason, {
            refs: { checkpointId, ...(manualTask ? { manualTaskId: manualTask.manualTaskId } : {}) },
          }),
        ),
      );
      if (manualTask) {
        events.push(
          stamp(
            draft(run, 'manual.task_created', `Manual task created: ${manualTask.title}`, {
              classification: 'canonical',
              payload: { category: manualTask.category, title: manualTask.title },
              refs: { checkpointId, manualTaskId: manualTask.manualTaskId },
            }),
          ),
        );
      }
      return ok({ run: next, events, requiredActions });
    }
    case 'begin': {
      if (run.status !== 'created') return illegal(run, 'begin is only valid on a created run.');
      const next: RelayRun = { ...run, status: 'active', phase: 'blueprint' };
      events.push(
        stamp(draft(run, 'run.started', 'Run started — awaiting blueprint.', {})),
        stamp(draft(run, 'architect.started', 'Architect phase opened.', {})),
      );
      return ok({ run: next, events, requiredActions });
    }
    case 'record-blueprint': {
      if (run.status !== 'active' || run.phase !== 'blueprint') {
        return illegal(run, 'Blueprints are only recorded in the active blueprint phase.');
      }
      const bp = action.blueprint;
      const kind = bp.source === 'imported' ? 'architect.blueprint_imported' : 'architect.blueprint_created';
      const next: RelayRun = {
        ...run,
        blueprintId: bp.blueprintId,
        provenanceProfile: mergeProfile(run.provenanceProfile, bp.provenance),
      };
      events.push(
        stamp(
          draft(run, kind, `Blueprint v${bp.version} recorded from ${bp.architectIdentity.displayName}.`, {
            provenance: bp.provenance,
            classification: bp.source === 'imported' ? 'external-artifact' : 'unverified-claim',
            refs: { blueprintId: bp.blueprintId },
          }),
        ),
      );
      requiredActions.push('accept-blueprint');
      return ok({ run: next, events, requiredActions });
    }
    case 'record-report': {
      const expectedPhase = action.reportType === 'implementation' ? 'implementation' : 'repair';
      if (run.status !== 'active' || run.phase !== expectedPhase) {
        return illegal(run, `${action.reportType} reports are only recorded in the active ${expectedPhase} phase.`);
      }
      const next: RelayRun = { ...run, provenanceProfile: mergeProfile(run.provenanceProfile, action.provenance) };
      events.push(
        stamp(
          draft(run, 'agent.report_created', `${action.reportType} report received (unverified claim).`, {
            provenance: action.provenance,
            classification: 'unverified-claim',
            refs: { reportId: action.reportId },
          }),
        ),
      );
      requiredActions.push(action.reportType === 'implementation' ? 'request-verification:initial' : 'request-verification:final');
      return ok({ run: next, events, requiredActions });
    }
    case 'record-verification': {
      const v = action.verification;
      if (run.status !== 'active' || (run.phase !== 'verification' && run.phase !== 'final_verification')) {
        return illegal(run, 'Verification results are only recorded in a verification phase.');
      }
      const isFinal = run.phase === 'final_verification';
      const nextRefs = [...run.verificationRefs, v.verificationId];
      events.push(
        stamp(
          draft(run, 'verification.completed', `Verification ${v.outcome} (${v.checks.length} check(s)).`, {
            provenance: action.provenance,
            classification: 'verified-evidence',
            payload: { outcome: v.outcome, verificationId: v.verificationId },
          }),
        ),
      );
      if (v.outcome !== 'passed' && isFinal) {
        // Honest failure after the single repair: no second automatic repair;
        // run stops at checkpoint_required (task/audit may record blocked).
        const checkpointId = ids.next('ckp');
        const reason = 'Final verification failed after the single automatic repair.';
        const next: RelayRun = {
          ...run,
          verificationRefs: nextRefs,
          status: 'checkpoint_required',
          checkpoint: { checkpointId, runId: run.runId, reason, requestedAt: now },
        };
        events.push(stamp(draft(run, 'run.checkpoint_required', reason, { refs: { checkpointId } })));
        requiredActions.push('record-failure');
        return ok({ run: next, events, requiredActions });
      }
      const to = isFinal ? 'final_review' : 'review';
      const next: RelayRun = { ...run, verificationRefs: nextRefs, phase: to };
      events.push(stamp(draft(run, 'run.phase_changed', `Phase: ${run.phase} → ${to}.`, { payload: { from: run.phase, to } })));
      return ok({ run: next, events, requiredActions });
    }
    case 'record-verdict': {
      if (run.status !== 'active' || (run.phase !== 'review' && run.phase !== 'final_review')) {
        return illegal(run, 'Verdicts are only recorded in a review phase.');
      }
      const verdict = action.verdict;
      if (!verdict.independent) {
        return fail(
          relayError('reviewer-independence', 'Verdict comes from a non-independent assignment (self-review) and cannot gate this run.', {
            entityIds: { runId: run.runId },
          }),
        );
      }
      const isFinal = run.phase === 'final_review';
      const nextRefs = [...run.reviewRefs, action.reportId];
      events.push(
        stamp(
          draft(run, 'reviewer.verdict_created', `Independent review: ${verdict.verdict}, ${verdict.findings.length} finding(s).`, {
            provenance: verdict.provenance,
            classification: 'unverified-claim',
            payload: { verdict: verdict.verdict, findingCount: verdict.findings.length },
            refs: { reportId: action.reportId },
          }),
        ),
      );
      if (verdict.verdict === 'approved') {
        const next: RelayRun = { ...run, reviewRefs: nextRefs, phase: 'audit' };
        events.push(stamp(draft(run, 'run.phase_changed', `Phase: ${run.phase} → audit.`, { payload: { from: run.phase, to: 'audit' } })));
        requiredActions.push('record-audit');
        return ok({ run: next, events, requiredActions });
      }
      if (isFinal) {
        const checkpointId = ids.next('ckp');
        const reason = 'Re-review still requests changes after the single automatic repair.';
        const next: RelayRun = {
          ...run,
          reviewRefs: nextRefs,
          status: 'checkpoint_required',
          checkpoint: { checkpointId, runId: run.runId, reason, requestedAt: now },
        };
        events.push(stamp(draft(run, 'run.checkpoint_required', reason, { refs: { checkpointId } })));
        return ok({ run: next, events, requiredActions });
      }
      const next: RelayRun = { ...run, reviewRefs: nextRefs };
      requiredActions.push('evaluate-repair-conditions');
      return ok({ run: next, events, requiredActions });
    }
    case 'record-manual-verification': {
      // Relay Core's judgment on a Done claim. The user's word alone never
      // completes a Manual Task; only this transition (or explicit operator
      // confirmation via respond-checkpoint) can.
      if (run.status !== 'checkpoint_required' || !run.checkpoint?.manualTask) {
        return illegal(run, 'No manual task is awaiting verification.');
      }
      const checkpoint = run.checkpoint;
      const task = checkpoint.manualTask!;
      if (task.status !== 'user_marked_done') {
        return illegal(run, 'Manual verification requires a recorded Done claim.');
      }
      const refs = {
        checkpointId: checkpoint.checkpointId,
        manualTaskId: task.manualTaskId,
        ...(action.evidenceId ? { evidenceIds: [action.evidenceId] } : {}),
      };
      if (action.outcome === 'passed') {
        const completed: ManualTask = {
          ...task, status: 'completed', updatedAt: now, completedAt: now, lastVerificationOutcome: 'passed',
        };
        events.push(
          stamp(draft(run, 'manual.verification_passed', 'Manual-task verification passed.', { classification: 'verified-evidence', refs })),
          stamp(draft(run, 'manual.task_completed', `Manual task completed: ${task.title}`, { classification: 'canonical', refs })),
        );
        if (completed.canResumeAfterCompletion) {
          const responded = { ...checkpoint, respondedAt: now, response: 'approve' as const, manualTask: completed };
          const next: RelayRun = { ...run, status: 'active', checkpoint: responded };
          events.push(stamp(draft(run, 'run.resumed', 'Run resumed after verified manual-task completion.', {})));
          return ok({ run: next, events, requiredActions });
        }
        const next: RelayRun = { ...run, checkpoint: { ...checkpoint, manualTask: completed } };
        return ok({ run: next, events, requiredActions });
      }
      if (action.outcome === 'failed') {
        const next: RelayRun = {
          ...run,
          checkpoint: {
            ...checkpoint,
            manualTask: { ...task, status: 'needs_more_information', updatedAt: now, lastVerificationOutcome: 'failed' },
          },
        };
        events.push(
          stamp(draft(run, 'manual.verification_failed', 'Manual-task verification failed — the run stays safely stopped.', { refs })),
        );
        return ok({ run: next, events, requiredActions });
      }
      const next: RelayRun = {
        ...run,
        checkpoint: {
          ...checkpoint,
          manualTask: { ...task, updatedAt: now, lastVerificationOutcome: 'unavailable' },
        },
      };
      events.push(
        stamp(
          draft(run, 'manual.verification_unavailable', 'Manual-task verification is unavailable — operator confirmation required before resuming.', { refs }),
        ),
      );
      return ok({ run: next, events, requiredActions });
    }
    case 'record-audit': {
      if (run.status !== 'active' || run.phase !== 'audit') {
        return illegal(run, 'The final audit is only recorded in the audit phase.');
      }
      // Completion guard: NEVER from an agent-reported status alone.
      const verification = input.latestVerification;
      const verdict = input.latestVerdict;
      if (!verification || verification.outcome !== 'passed') {
        return fail(
          relayError('evidence-required', 'Completion requires Relay-produced passing verification — agent claims are not evidence.', {
            entityIds: { runId: run.runId },
          }),
        );
      }
      if (!verdict || verdict.verdict !== 'approved' || !verdict.independent) {
        return fail(
          relayError('evidence-required', 'Completion requires an approving independent review verdict.', {
            entityIds: { runId: run.runId },
          }),
        );
      }
      const next: RelayRun = {
        ...run,
        status: 'completed',
        completedAt: now,
        finalAuditId: action.audit.auditId,
      };
      events.push(
        stamp(
          draft(run, 'audit.report_created', `Final audit recorded: ${action.audit.outcome}.`, {
            classification: 'canonical',
            payload: { auditId: action.audit.auditId, outcome: action.audit.outcome },
          }),
        ),
        stamp(draft(run, 'run.completed', 'Run verified complete.', { classification: 'canonical' })),
      );
      return ok({ run: next, events, requiredActions });
    }
    default:
      return illegal(run, 'Unknown intent.');
  }
}


