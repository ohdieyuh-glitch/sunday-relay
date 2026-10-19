import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import { parseCommand, type CommandEnvelope, type EventDraft, type ReportEnvelope } from '../protocol/envelopes';
import type {
  AgentHandoffPackage, Blueprint, BudgetPolicy, CompletionPolicy, EvidenceRecord,
  FinalAuditReport, LoopPolicy, PermissionPolicy, RelayProject, RelayRun, RelayTask,
  ReviewerVerdictRecord, RevisionContract, StoppingCondition, TaskAssignment,
} from '../protocol/contracts';
import type { ClaimId, ContextVersion, EventId, EvidenceId, IdFactory, LedgerVersion, RunId, SessionRefId, TaskId } from '../protocol/ids';
import { transitionRun, type RunAction } from './run-machine';
import { compileManualTask, looksLikeSecret } from './manual-task';
import { appendEvent, currentLedgerVersion, listEvents } from '../ledger/ledger';
import { promoteClaim, recordClaim } from '../ledger/promotion';
import { assignTask } from '../coordination/ownership';
import { acquireFileClaim } from '../coordination/claims';
import { evaluateDispatchEligibility } from '../coordination/eligibility';
import { compileHandoff } from '../handoff/compiler';
import { compileRevisionContract } from '../handoff/revision';
import { evaluateCompletionPolicy } from '../verification/completion';
import { evaluateDispatchBudget, type BudgetDecision } from '../verification/budget';
import { evaluateAutomaticRepair, type RepairPlanFacts } from '../recovery/repair';
import { detectNoProgress, detectRepeatedFailure, failureFingerprint } from '../recovery/detection';
import { decideRecovery } from '../recovery/decision';
import type { RelayAdapters } from '../connectors/ports';
import type { RelayStores } from '../storage/interfaces';

/**
 * Relay workflow orchestrator (Prompt 4). A bounded STEP engine: each step
 * reads canonical state, determines exactly ONE next legal action from the
 * run's status×phase and stored artifacts, executes it through the real
 * subsystems (state machine, eligibility battery, compiler, adapters,
 * verification, promotion), persists commands/reports/events, and stops at
 * terminal or checkpoint states. No provider-specific logic lives here; the
 * adapters are ports. Nothing dispatches after terminal, while paused, or
 * past the one-repair limit — those rules live in the machine and are only
 * CONSUMED here.
 */

export interface OrchestratorConfig {
  completionPolicy: CompletionPolicy;
  permissionPolicy: PermissionPolicy;
  budget: BudgetPolicy;
  loopPolicy: LoopPolicy;
  stoppingCondition: StoppingCondition;
  /** Trusted input from the (future) workspace adapter / test fixture. */
  baseRevision: string;
  leaseMs: number;
  /** Supplied estimate per simulated agent step (null = genuinely unknown). */
  costEstimatePerStep: { usd?: number; tokens?: number } | null;
  /** Guided Mode: scenarios may auto-approve the blueprint as a recorded
   * system action; interactive use leaves it false and awaits the command. */
  autoAcceptBlueprint: boolean;
  /** Structured facts for the repair-condition evaluation (simulation
   * scenarios configure these; live adapters will derive them). */
  repairPlanFacts?: Partial<RepairPlanFacts>;
  /** Manual-task verification outcome per Done attempt (Prompt 6.1) —
   * deterministic scenario data; index = attempt number. Default: passed. */
  manualVerificationOutcomes?: Array<'passed' | 'failed' | 'unavailable'>;
}

export interface Orchestrator {
  setup(input: { projectName: string; objective: string; taskObjective: string; claimedFiles: string[]; equivalenceKey?: string }): RelayResult<{ project: RelayProject; run: RelayRun; task: RelayTask }>;
  /** Execute exactly one action. done=true when no further automatic action is legal. */
  step(runId: RunId): RelayResult<{ action: string; run: RelayRun; done: boolean }>;
  /** Bounded loop (never recurses; maxSteps is a hard stop, default 40). */
  runUntilStopped(runId: RunId, maxSteps?: number): RelayResult<{ run: RelayRun; actions: string[]; stopReason: string }>;
  /** External command path (pause/resume/cancel/respond-checkpoint/accept-blueprint). */
  command(raw: unknown): RelayResult<{ run: RelayRun }>;
}

export function createOrchestrator(deps: {
  stores: RelayStores;
  adapters: RelayAdapters;
  ids: IdFactory;
  clock: { now(): string };
  config: OrchestratorConfig;
}): Orchestrator {
  const { stores, adapters, ids, clock, config } = deps;

  const persistEvents = (drafts: EventDraft[], idempotencyKey?: string): RelayResult<null> => {
    for (const draft of drafts) {
      const appended = appendEvent(stores.events, { draft, eventId: ids.next('evt') as EventId, idempotencyKey });
      if (!appended.ok) return appended;
    }
    return ok(null);
  };

  const persistUsage = (records: { usageId: string }[]) => {
    for (const u of records) stores.usage.put(u.usageId, u as never);
  };

  const applyTransition = (run: RelayRun, action: RunAction, extra: Parameters<typeof transitionRun>[0] extends infer T ? Partial<T> : never): RelayResult<RelayRun> => {
    const result = transitionRun({ run, action, now: clock.now(), ids, ...(extra as object) });
    if (!result.ok) return result;
    const persisted = persistEvents(result.value.events);
    if (!persisted.ok) return persisted;
    stores.runs.put(result.value.run.runId, result.value.run);
    return ok(result.value.run);
  };

  /* -------- per-run derived context -------- */
  interface RunContext {
    run: RelayRun;
    project: RelayProject;
    task: RelayTask | null;
    assignment: TaskAssignment | null;
    reviewerAssignment: TaskAssignment | null;
    blueprint: Blueprint | null;
    pkg: AgentHandoffPackage | null;
    implementationReport: ReportEnvelope | null;
    repairReport: ReportEnvelope | null;
    reviewReports: ReportEnvelope[];
    latestVerdict: ReviewerVerdictRecord | null;
    sessionRef: SessionRefId | null;
    revision: RevisionContract | null;
  }

  const artifactsByRun = new Map<string, { blueprint?: Blueprint; revision?: RevisionContract; verdicts: ReviewerVerdictRecord[]; claims: ClaimId[]; promotions: Array<{ claimId: ClaimId; decision: 'promoted' | 'rejected' | 'pending' }> }>();
  const bag = (runId: string) => {
    let entry = artifactsByRun.get(runId);
    if (!entry) {
      entry = { verdicts: [], claims: [], promotions: [] };
      artifactsByRun.set(runId, entry);
    }
    return entry;
  };

  function loadContext(runId: RunId): RelayResult<RunContext> {
    const run = stores.runs.get(runId);
    if (!run) return fail(relayError('not-found', 'Run not found.', { entityIds: { runId } }));
    const project = stores.projects.get(run.projectId);
    if (!project) return fail(relayError('not-found', 'Project not found.', { entityIds: { runId } }));
    const task = run.taskIds.length > 0 ? stores.tasks.get(run.taskIds[0]) : null;
    const assignments = stores.assignments.list().filter((a) => a.taskId === task?.taskId);
    const assignment = assignments.find((a) => a.role === 'coding-agent' && !a.endedAt) ?? null;
    const reviewerAssignment = assignments.find((a) => a.role === 'reviewer' && !a.endedAt) ?? null;
    const reports = stores.reports.list().filter((r) => r.runId === runId);
    const entry = bag(runId);
    return ok({
      run,
      project,
      task,
      assignment,
      reviewerAssignment,
      blueprint: entry.blueprint ?? null,
      pkg: stores.packages.list().find((p) => p.runId === runId && p.role === 'coding-agent') ?? null,
      implementationReport: reports.find((r) => r.reportType === 'implementation') ?? null,
      repairReport: reports.find((r) => r.reportType === 'repair') ?? null,
      reviewReports: reports.filter((r) => r.reportType === 'review'),
      latestVerdict: entry.verdicts[entry.verdicts.length - 1] ?? null,
      sessionRef: reports.find((r) => r.agentIdentity.sessionRef)?.agentIdentity.sessionRef ?? null,
      revision: entry.revision ?? null,
    });
  }

  const budgetNow = (run: RelayRun): BudgetDecision =>
    evaluateDispatchBudget({
      policy: config.budget,
      loopPolicy: run.loopPolicy,
      repairCount: run.repairCount,
      currentUsage: stores.usage.list().filter((u) => u.runId === run.runId),
      estimatedNextOperation: config.costEstimatePerStep,
      currentTime: clock.now(),
    });

  const raiseCheckpoint = (run: RelayRun, reason: string): RelayResult<RelayRun> =>
    applyTransition(run, { intent: 'raise-checkpoint', reason }, {});

  /* -------- Manual Task (Prompt 6.1) -------- */

  const manualEvent = (
    run: RelayRun, taskId: TaskId | undefined, kind: EventDraft['kind'],
    safeSummary: string, extra: Partial<EventDraft> = {},
  ): EventDraft => ({
    protocolVersion: RELAY_PROTOCOL_VERSION, at: clock.now(), projectId: run.projectId,
    runId: run.runId, taskId, source: 'relay-core', kind, provenance: 'simulated',
    classification: 'historical', safeSummary, payload: {}, ...extra,
  });

  /** An adapter asked for human action. The request is UNTRUSTED: record
   * it, let Relay Core validate/compile, and either raise the manual-task
   * checkpoint or reject without ever surfacing the raw request. */
  function handleManualActionRequest(
    run: RelayRun, task: RelayTask, request: unknown,
  ): RelayResult<{ action: string; run: RelayRun; done: boolean }> {
    const recorded = persistEvents([
      manualEvent(run, task.taskId, 'manual.action_requested',
        'Agent requested human action (recorded as an untrusted request).',
        { source: 'coding-agent', classification: 'unverified-claim' }),
    ]);
    if (!recorded.ok) return recorded;
    const compiled = compileManualTask({
      request, run, task,
      expectedRequestedBy: adapters.codingAgent.descriptor.adapterId,
      ids, now: clock.now(),
    });
    if (!compiled.ok) {
      const reasons = (compiled.error.details ?? [compiled.error.message])
        .slice(0, 10)
        .map((reason) => (looksLikeSecret(reason) ? '[redacted]' : reason));
      const rejectedEvent = persistEvents([
        manualEvent(run, task.taskId, 'manual.request_rejected',
          'Manual action request rejected — it will not be shown to the user.',
          { classification: 'derived', payload: { reasons } }),
      ]);
      if (!rejectedEvent.ok) return rejectedEvent;
      const checkpointed = raiseCheckpoint(
        run,
        'An agent requested human action, but the request was rejected as unsafe or malformed. Automatic work has stopped safely.',
      );
      if (!checkpointed.ok) return checkpointed;
      return ok({ action: 'checkpoint:manual-request-rejected', run: checkpointed.value, done: true });
    }
    const { manualTask } = compiled.value;
    const validated = persistEvents([
      manualEvent(run, task.taskId, 'manual.request_validated',
        'Manual action request validated — canonical manual task compiled.',
        { classification: 'derived', payload: { category: manualTask.category } }),
    ]);
    if (!validated.ok) return validated;
    const next = applyTransition(
      run,
      { intent: 'raise-checkpoint', reason: `Manual task required: ${manualTask.title}`, manualTask },
      {},
    );
    if (!next.ok) return next;
    return ok({ action: 'checkpoint:manual-task', run: next.value, done: true });
  }

  /** Done is a claim, not evidence: Relay runs the configured deterministic
   * verification (or discloses that none exists) and the machine decides. */
  function verifyManualTask(run: RelayRun): RelayResult<RelayRun> {
    const task = run.checkpoint?.manualTask;
    if (!task || task.status !== 'user_marked_done') return ok(run);
    const attempt = listEvents(stores.events, run.projectId).filter(
      (e) => e.kind === 'manual.verification_started' && e.refs?.manualTaskId === task.manualTaskId,
    ).length;
    const refs = { checkpointId: run.checkpoint!.checkpointId, manualTaskId: task.manualTaskId };
    const started = persistEvents([
      manualEvent(run, task.relayTaskId, 'manual.verification_started',
        'Relay verification of the manual task started.', { refs }),
    ]);
    if (!started.ok) return started;
    const outcome: 'passed' | 'failed' | 'unavailable' = !task.verificationAvailable
      ? 'unavailable'
      : config.manualVerificationOutcomes?.[attempt] ?? 'passed';
    let evidenceId: EvidenceId | undefined;
    if (outcome !== 'unavailable') {
      const record: EvidenceRecord = {
        evidenceId: ids.next('evd'),
        taskId: task.relayTaskId, runId: run.runId,
        source: adapters.verification.descriptor.adapterId,
        evidenceType: 'health-check',
        outputExcerpt: outcome === 'passed'
          ? 'SIMULATED manual-task check: the configured verification confirmed the result.'
          : 'SIMULATED manual-task check: the configured verification did not confirm the result.',
        executedAt: clock.now(),
        environment: { os: 'sim-linux', node: 'sim-20', cwd: '/simulated/workspace' },
        repoRevision: config.baseRevision,
        verificationStatus: outcome,
        verifier: adapters.verification.descriptor.adapterId,
        provenance: 'simulated',
      };
      stores.evidence.put(record.evidenceId, record);
      evidenceId = record.evidenceId;
    }
    return applyTransition(run, { intent: 'record-manual-verification', outcome, evidenceId }, {});
  }

  /** Budget gate before EVERY simulated agent dispatch. */
  function budgetGate(run: RelayRun, what: string): RelayResult<'allowed' | 'stopped'> {
    const decision = budgetNow(run);
    if (decision.outcome === 'allowed') return ok('allowed');
    if (decision.outcome === 'warning') {
      persistEvents([
        {
          protocolVersion: RELAY_PROTOCOL_VERSION, at: clock.now(), projectId: run.projectId, runId: run.runId,
          source: 'relay-core', kind: 'budget.warning', provenance: 'simulated', classification: 'derived',
          safeSummary: decision.safeSummary, payload: { before: what },
        },
      ]);
      return ok('allowed');
    }
    persistEvents([
      {
        protocolVersion: RELAY_PROTOCOL_VERSION, at: clock.now(), projectId: run.projectId, runId: run.runId,
        source: 'relay-core', kind: 'budget.exceeded', provenance: 'simulated', classification: 'derived',
        safeSummary: decision.safeSummary, payload: { before: what, reasons: decision.reasons },
      },
    ]);
    const checkpointed = raiseCheckpoint(run, `Budget stop before ${what}: ${decision.reasons[0] ?? decision.safeSummary}`);
    if (!checkpointed.ok) return checkpointed;
    return ok('stopped');
  }

  function makeVerdictRecord(report: ReportEnvelope, reviewerAssignment: TaskAssignment, codingAssignment: TaskAssignment | null): ReviewerVerdictRecord {
    const payload = report.payload as { verdict: 'approved' | 'changes_requested'; findings: ReviewerVerdictRecord['findings'] };
    // Independence is STRUCTURAL: adapter/session lineage, never report text.
    const independent = !!codingAssignment && reviewerAssignment.adapterId !== codingAssignment.adapterId;
    return {
      reportId: report.reportId,
      reviewerAssignmentId: reviewerAssignment.assignmentId,
      verdict: payload.verdict,
      findings: payload.findings,
      independent,
      provenance: report.provenance,
    };
  }

  const adapterContext = () => ({ ids, now: clock.now() });

  /* ------------------------------ steps ------------------------------ */

  function step(runId: RunId): RelayResult<{ action: string; run: RelayRun; done: boolean }> {
    const loaded = loadContext(runId);
    if (!loaded.ok) return loaded;
    const ctx = loaded.value;
    const { run } = ctx;

    if (['completed', 'failed', 'cancelled'].includes(run.status)) return ok({ action: 'none:terminal', run, done: true });
    if (run.status === 'paused') return ok({ action: 'none:paused', run, done: true });
    if (run.status === 'checkpoint_required') return ok({ action: 'none:checkpoint', run, done: true });

    if (run.status === 'created') {
      const next = applyTransition(run, { intent: 'begin' }, {});
      if (!next.ok) return next;
      return ok({ action: 'begin', run: next.value, done: false });
    }

    /* blueprint phase */
    if (run.phase === 'blueprint') {
      if (!ctx.blueprint) {
        const gate = budgetGate(run, 'architect dispatch');
        if (!gate.ok) return gate;
        if (gate.value === 'stopped') return ok({ action: 'checkpoint:budget', run: stores.runs.get(runId)!, done: true });
        const result = adapters.architect.createBlueprint({ project: ctx.project, run, objective: run.objective, context: adapterContext() });
        if (!result.ok) {
          const checkpointed = raiseCheckpoint(run, `Architect failed: ${result.error.message}`);
          if (!checkpointed.ok) return checkpointed;
          return ok({ action: 'checkpoint:architect-failed', run: checkpointed.value, done: true });
        }
        stores.reports.put(result.value.report.reportId, result.value.report);
        persistUsage(result.value.usage);
        const persisted = persistEvents(result.value.events);
        if (!persisted.ok) return persisted;
        const recorded = recordClaim({ store: stores.events, ids, report: result.value.report, at: clock.now() });
        if (!recorded.ok) return recorded;
        bag(runId).claims.push(recorded.value.claimId);
        bag(runId).blueprint = result.value.blueprint;
        const next = applyTransition(run, { intent: 'record-blueprint', blueprint: result.value.blueprint }, {});
        if (!next.ok) return next;
        return ok({ action: 'architect:blueprint', run: next.value, done: false });
      }
      if (config.autoAcceptBlueprint) {
        const accept: CommandEnvelope = {
          protocolVersion: RELAY_PROTOCOL_VERSION, commandId: `auto-accept-${runId}`, commandType: 'accept-blueprint',
          issuedAt: clock.now(), actor: { kind: 'system', id: 'scenario-auto-approve' },
          payload: { runId, blueprintId: ctx.blueprint.blueprintId }, provenance: 'simulated',
        };
        stores.commands.put(accept.commandId, accept);
        const next = applyTransition(run, accept, {});
        if (!next.ok) return next;
        return ok({ action: 'accept-blueprint:auto', run: next.value, done: false });
      }
      return ok({ action: 'await:accept-blueprint', run, done: true });
    }

    /* handoff phase: assign, claim, compile, eligibility, dispatch */
    if (run.phase === 'handoff') {
      if (!ctx.task) return fail(relayError('not-found', 'Run has no task.', { entityIds: { runId } }));
      let task = ctx.task;
      let assignment = ctx.assignment;
      if (!assignment) {
        const assigned = assignTask({
          task, existingAssignments: stores.assignments.list().filter((a) => a.taskId === task.taskId),
          role: 'coding-agent', adapterId: adapters.codingAgent.descriptor.adapterId,
          ids, now: clock.now(), leaseMs: config.leaseMs, provenance: 'simulated',
          idempotencyKey: `assign-${task.taskId}`,
        });
        if (!assigned.ok) return assigned;
        stores.assignments.put(assigned.value.assignment.assignmentId, assigned.value.assignment);
        stores.tasks.put(assigned.value.task.taskId, assigned.value.task);
        const persisted = persistEvents(assigned.value.events);
        if (!persisted.ok) return persisted;
        task = assigned.value.task;
        assignment = assigned.value.assignment;
      }
      for (const path of task.claimedFiles) {
        const claim = acquireFileClaim({ taskId: task.taskId, path, mode: 'write', existing: stores.fileClaims.list(), ids, now: clock.now(), leaseMs: config.leaseMs });
        if (!claim.ok) {
          const checkpointed = raiseCheckpoint(run, `File claim conflict: ${claim.error.message}`);
          if (!checkpointed.ok) return checkpointed;
          return ok({ action: 'checkpoint:file-claim', run: checkpointed.value, done: true });
        }
        if (!claim.value.idempotent) {
          stores.fileClaims.put(claim.value.claim.claimId, claim.value.claim);
          const persisted = persistEvents([
            { protocolVersion: RELAY_PROTOCOL_VERSION, at: clock.now(), projectId: run.projectId, runId, taskId: task.taskId, source: 'relay-core', kind: 'file_claim.created', provenance: 'simulated', classification: 'historical', safeSummary: `Exclusive write claim on ${path}.`, payload: { path } },
          ]);
          if (!persisted.ok) return persisted;
        }
      }
      let pkg = ctx.pkg;
      if (!pkg) {
        const ledgerVersion = currentLedgerVersion(stores.events, run.projectId);
        const compiled = compileHandoff({
          project: ctx.project, run, task, assignment, role: 'coding-agent',
          blueprint: ctx.blueprint ?? undefined,
          completionPolicy: config.completionPolicy, permissionPolicy: config.permissionPolicy,
          budget: config.budget, loopPolicy: config.loopPolicy, stoppingCondition: config.stoppingCondition,
          ledgerVersion, contextVersion: task.contextVersion, baseRevision: config.baseRevision,
          provenance: 'simulated', ids, now: clock.now(), idempotencyKey: `handoff-${task.taskId}`,
          priorCompilations: stores.compilations.list().map((record) => ({ record, pkg: stores.packages.get(record.packageId)!, idempotencyKey: stores.packages.get(record.packageId)?.idempotencyKey })),
        });
        if (!compiled.ok) return compiled;
        pkg = compiled.value.pkg;
        stores.packages.put(pkg.packageId, pkg);
        stores.compilations.put(compiled.value.record.recordId, compiled.value.record);
        const persisted = persistEvents(compiled.value.events);
        if (!persisted.ok) return persisted;
        return ok({ action: 'compile-handoff', run, done: false });
      }
      const gate = budgetGate(run, 'coding-agent dispatch');
      if (!gate.ok) return gate;
      if (gate.value === 'stopped') return ok({ action: 'checkpoint:budget', run: stores.runs.get(runId)!, done: true });
      const allEvents = listEvents(stores.events, run.projectId);
      const lastCanonical = allEvents.reduce((max, e) => (e.classification === 'canonical' ? e.sequence : max), 0);
      const eligibility = evaluateDispatchEligibility({
        project: ctx.project, run, task, assignment,
        allTasks: stores.tasks.list(), fileClaims: stores.fileClaims.list(), resourceClaims: stores.resourceClaims.list(),
        handoff: pkg, policy: config.completionPolicy, usage: stores.usage.list().filter((u) => u.runId === runId),
        costEstimate: config.costEstimatePerStep, currentLedgerVersion: currentLedgerVersion(stores.events, run.projectId),
        lastCanonicalLedgerVersion: lastCanonical,
        currentRepositoryRevision: config.baseRevision, currentTime: clock.now(),
      });
      if (eligibility.outcome !== 'eligible') {
        const reason = `Dispatch ${eligibility.outcome}: ${eligibility.failedChecks.map((c) => c.id).join(', ')}`;
        const persisted = persistEvents([
          { protocolVersion: RELAY_PROTOCOL_VERSION, at: clock.now(), projectId: run.projectId, runId, taskId: task.taskId, source: 'relay-core', kind: 'permission.denied', provenance: 'simulated', classification: 'derived', safeSummary: reason, payload: { failedChecks: eligibility.failedChecks.map((c) => ({ id: c.id, detail: c.detail })) } },
        ]);
        if (!persisted.ok) return persisted;
        const checkpointed = raiseCheckpoint(run, reason);
        if (!checkpointed.ok) return checkpointed;
        return ok({ action: `checkpoint:eligibility:${eligibility.outcome}`, run: checkpointed.value, done: true });
      }
      const dispatch: CommandEnvelope = {
        protocolVersion: RELAY_PROTOCOL_VERSION, commandId: `dispatch-${task.taskId}`, commandType: 'dispatch-task',
        issuedAt: clock.now(), actor: { kind: 'system', id: 'orchestrator' },
        payload: { runId, taskId: task.taskId, packageId: pkg.packageId }, provenance: 'simulated',
        idempotencyKey: `dispatch-${task.taskId}`,
      };
      stores.commands.put(dispatch.commandId, dispatch);
      const next = applyTransition(run, dispatch, {});
      if (!next.ok) return next;
      return ok({ action: 'dispatch-task', run: next.value, done: false });
    }

    /* implementation / repair phases: agent executes, report recorded */
    if (run.phase === 'implementation' || run.phase === 'repair') {
      const isRepair = run.phase === 'repair';
      const existing = isRepair ? ctx.repairReport : ctx.implementationReport;
      if (!ctx.task || !ctx.assignment || !ctx.pkg) return fail(relayError('not-found', 'Missing task/assignment/package.', { entityIds: { runId } }));
      if (!existing) {
        const gate = budgetGate(run, isRepair ? 'repair dispatch' : 'coding-agent dispatch');
        if (!gate.ok) return gate;
        if (gate.value === 'stopped') return ok({ action: 'checkpoint:budget', run: stores.runs.get(runId)!, done: true });
        const result = adapters.codingAgent.execute({
          pkg: ctx.pkg, task: ctx.task, assignment: ctx.assignment,
          revision: isRepair ? ctx.revision ?? undefined : undefined,
          resumeSessionRef: isRepair ? ctx.sessionRef ?? undefined : undefined,
          context: adapterContext(),
        });
        if (!result.ok) {
          const checkpointed = raiseCheckpoint(run, `Coding agent ${isRepair ? 'repair' : 'attempt'} failed: ${result.error.message}`);
          if (!checkpointed.ok) return checkpointed;
          return ok({ action: 'checkpoint:agent-failed', run: checkpointed.value, done: true });
        }
        stores.reports.put(result.value.report.reportId, result.value.report);
        stores.sessionRefs.put(result.value.sessionRef, { sessionRefId: result.value.sessionRef, adapterId: adapters.codingAgent.descriptor.adapterId, createdAt: clock.now(), description: 'simulated session (opaque reference, never a credential)' });
        persistUsage(result.value.usage);
        const persisted = persistEvents(result.value.events);
        if (!persisted.ok) return persisted;
        const recorded = recordClaim({ store: stores.events, ids, report: result.value.report, at: clock.now() });
        if (!recorded.ok) return recorded;
        bag(runId).claims.push(recorded.value.claimId);
        const next = applyTransition(run, { intent: 'record-report', reportType: isRepair ? 'repair' : 'implementation', reportId: result.value.report.reportId, provenance: result.value.report.provenance }, {});
        if (!next.ok) return next;
        // Manual Task (Prompt 6.1): the agent may have asked for human
        // action — handle inside this same step while the run is active.
        if (result.value.manualActionRequest !== undefined) {
          return handleManualActionRequest(next.value, ctx.task, result.value.manualActionRequest);
        }
        return ok({ action: isRepair ? 'agent:repair-report' : 'agent:implementation-report', run: next.value, done: false });
      }
      const request: CommandEnvelope = {
        protocolVersion: RELAY_PROTOCOL_VERSION, commandId: `verify-${run.phase}-${runId}`, commandType: 'request-verification',
        issuedAt: clock.now(), actor: { kind: 'system', id: 'orchestrator' },
        payload: { runId, taskId: ctx.task.taskId, policyId: config.completionPolicy.policyId, scope: isRepair ? 'final' : 'initial' }, provenance: 'simulated',
      };
      stores.commands.put(request.commandId, request);
      const next = applyTransition(run, request, {});
      if (!next.ok) return next;
      return ok({ action: `request-verification:${isRepair ? 'final' : 'initial'}`, run: next.value, done: false });
    }

    /* verification phases: Relay-controlled evidence */
    if (run.phase === 'verification' || run.phase === 'final_verification') {
      if (!ctx.task) return fail(relayError('not-found', 'Missing task.', { entityIds: { runId } }));
      const attempt = run.phase === 'verification' ? 1 : 2;
      const result = adapters.verification.verify({ task: ctx.task, run, policy: config.completionPolicy, baseRevision: config.baseRevision, attempt: attempt as 1 | 2, context: adapterContext() });
      if (!result.ok) return result;
      for (const record of result.value.records) stores.evidence.put(record.evidenceId, record);
      stores.evidenceBundles.put(result.value.bundle.bundleId, result.value.bundle);
      persistUsage(result.value.usage);
      // The machine's record-verification emits the authoritative
      // verification.completed — drop the adapter's duplicate of the concept.
      const persisted = persistEvents(result.value.events.filter((e) => e.kind !== 'verification.completed'));
      if (!persisted.ok) return persisted;
      const verification = {
        verificationId: ids.next('vrf'),
        taskId: ctx.task.taskId, runId, policyId: config.completionPolicy.policyId,
        bundleId: result.value.bundle.bundleId, at: clock.now(),
        outcome: result.value.bundle.overallStatus === 'passed' ? ('passed' as const) : result.value.bundle.overallStatus === 'unavailable' ? ('unavailable' as const) : ('failed' as const),
        checks: result.value.records.map((r) => ({ id: r.evidenceId, label: r.command ?? r.evidenceType, status: r.verificationStatus, detail: r.outputExcerpt })),
      };
      if (verification.outcome === 'unavailable') {
        const checkpointed = raiseCheckpoint(run, 'Required verification is unavailable — never treated as passed.');
        if (!checkpointed.ok) return checkpointed;
        return ok({ action: 'checkpoint:verification-unavailable', run: checkpointed.value, done: true });
      }
      const next = applyTransition(run, { intent: 'record-verification', verification, provenance: 'simulated' }, {});
      if (!next.ok) return next;
      return ok({ action: `verification:${verification.outcome}`, run: next.value, done: next.value.status !== 'active' });
    }

    /* review phases: independent reviewer */
    if (run.phase === 'review' || run.phase === 'final_review') {
      if (!ctx.task || !ctx.pkg || !ctx.implementationReport) return fail(relayError('not-found', 'Missing review inputs.', { entityIds: { runId } }));
      const attempt = run.phase === 'review' ? 1 : 2;
      let reviewerAssignment = ctx.reviewerAssignment;
      if (!reviewerAssignment) {
        const assigned = assignTask({
          task: { ...ctx.task, status: 'reviewing' }, existingAssignments: [],
          role: 'reviewer', adapterId: adapters.reviewer.descriptor.adapterId,
          ids, now: clock.now(), leaseMs: config.leaseMs, provenance: 'simulated',
        });
        if (!assigned.ok) return assigned;
        reviewerAssignment = assigned.value.assignment;
        stores.assignments.put(reviewerAssignment.assignmentId, reviewerAssignment);
      }
      const gate = budgetGate(run, 'reviewer dispatch');
      if (!gate.ok) return gate;
      if (gate.value === 'stopped') return ok({ action: 'checkpoint:budget', run: stores.runs.get(runId)!, done: true });
      const latestBundle = stores.evidenceBundles.list().filter((b) => b.runId === runId).at(-1) ?? null;
      const result = adapters.reviewer.review({
        pkg: ctx.pkg, task: ctx.task, reviewerAssignment,
        implementationReport: (run.phase === 'final_review' ? ctx.repairReport : ctx.implementationReport) ?? ctx.implementationReport,
        evidence: latestBundle, policy: config.completionPolicy, attempt: attempt as 1 | 2, context: adapterContext(),
      });
      if (!result.ok) return result;
      stores.reports.put(result.value.report.reportId, result.value.report);
      persistUsage(result.value.usage);
      const persisted = persistEvents(result.value.events);
      if (!persisted.ok) return persisted;
      const recorded = recordClaim({ store: stores.events, ids, report: result.value.report, at: clock.now() });
      if (!recorded.ok) return recorded;
      bag(runId).claims.push(recorded.value.claimId);
      const verdict = makeVerdictRecord(result.value.report, reviewerAssignment, ctx.assignment);
      bag(runId).verdicts.push(verdict);
      const next = applyTransition(run, { intent: 'record-verdict', verdict, reportId: result.value.report.reportId }, {});
      if (!next.ok) return next;

      if (verdict.verdict === 'changes_requested' && next.value.status === 'active' && next.value.phase === 'review') {
        return ok({ action: 'reviewer:changes-requested', run: next.value, done: false });
      }
      return ok({ action: `reviewer:${verdict.verdict}`, run: next.value, done: next.value.status !== 'active' });
    }

    /* audit phase: completion, promotion, final audit */
    if (run.phase === 'audit') {
      return finalize(ctx);
    }

    return fail(relayError('illegal-transition', `No legal orchestrator action for ${run.status}/${run.phase}.`, { entityIds: { runId } }));
  }

  /** After a changes_requested verdict in review phase, the next step()
   * lands here via phase 'review' with a standing verdict. */
  function maybeRepair(ctx: RunContext): RelayResult<{ action: string; run: RelayRun; done: boolean }> | null {
    const { run } = ctx;
    if (run.status !== 'active' || run.phase !== 'review') return null;
    const verdict = ctx.latestVerdict;
    if (!verdict || verdict.verdict !== 'changes_requested') return null;
    if (!ctx.task || !ctx.pkg) return fail(relayError('not-found', 'Missing repair inputs.', { entityIds: { runId: run.runId } }));

    const failedEvidence = stores.evidence.list().filter((e) => e.runId === run.runId && e.verificationStatus === 'failed');
    const budget = budgetNow(run);
    const plan: RepairPlanFacts = {
      narrow: true, unambiguous: true, sameAgentAvailable: true,
      sameSessionAvailable: ctx.sessionRef !== null,
      insideTaskObjective: true, filesTouched: [...ctx.task.claimedFiles],
      requiresProtectedFile: false, requiresNewPermission: false, requiresDestructiveCommand: false,
      requiresDeployment: false, requiresNewDependency: false, requiresNewCredentials: false,
      ...config.repairPlanFacts,
    };
    const decision = evaluateAutomaticRepair({
      run, task: ctx.task, verdict, failureEvidenceRefs: failedEvidence.map((e) => e.evidenceId),
      failedVerification: undefined, plan, budget,
      budgetWarningCheckpointActive: false,
      unresolvedDecisionConflict: config.repairPlanFacts?.insideTaskObjective === false ? true : false,
      findingConflictsWithCanonicalDecision: false,
    });
    const recovery = decideRecovery({
      run,
      repeatedFailure: detectRepeatedFailure(
        [],
        failedEvidence.length > 0
          ? { fingerprint: failureFingerprint({ category: 'verification', commandIdentity: failedEvidence[0].command, exitCode: failedEvidence[0].exitCode, repoRevision: failedEvidence[0].repoRevision, taskId: ctx.task.taskId }), repoRevision: failedEvidence[0].repoRevision, afterRepair: run.repairCount > 0 }
          : null,
      ),
      noProgress: detectNoProgress(null, null),
      budget,
      repairDecisionOutcome: decision.outcome,
      requiresProtectedFile: plan.requiresProtectedFile,
      requiresNewPermission: plan.requiresNewPermission,
      requiresDeployment: plan.requiresDeployment,
      credentialsMissing: plan.requiresNewCredentials,
      productOrArchitectureAmbiguity: false,
      sessionResumable: plan.sameSessionAvailable,
      requiredEnforcementUnsupported: false,
      evidenceSufficientForNarrowRepair: verdict.findings.length > 0,
    });

    if (recovery.outcome !== 'compile_revision') {
      const contract = compileRevisionContract({
        task: ctx.task, parentPackage: ctx.pkg, verdict, decision,
        failureEvidenceRefs: failedEvidence.map((e) => e.evidenceId),
        requiredCorrection: 'n/a', behaviorToPreserve: [], verificationToRerun: [],
        budgetRemaining: config.budget, stoppingCondition: config.stoppingCondition,
        ledgerVersion: currentLedgerVersion(stores.events, run.projectId),
        contextVersion: ctx.task.contextVersion, baseRevision: config.baseRevision,
        provenance: 'simulated', ids, now: clock.now(), idempotencyKey: `revision-${ctx.task.taskId}`,
      });
      void contract; // decision was not allowed → contract compilation refused (asserted by tests)
      const checkpointed = raiseCheckpoint(run, `Automatic repair not permitted (${recovery.outcome}): ${decision.failedConditions.join(', ') || recovery.reasons.join(', ')}`);
      if (!checkpointed.ok) return checkpointed;
      return ok({ action: `checkpoint:repair:${recovery.outcome}`, run: checkpointed.value, done: true });
    }

    const compiled = compileRevisionContract({
      task: ctx.task, parentPackage: ctx.pkg, verdict, decision,
      failureEvidenceRefs: failedEvidence.map((e) => e.evidenceId),
      requiredCorrection: verdict.findings.map((f) => f.recommendation ?? f.title).join('; '),
      behaviorToPreserve: ['previously passing checks stay passing'],
      verificationToRerun: config.completionPolicy.requiredEvidence.map((r) => r.command ?? r.evidenceType),
      budgetRemaining: config.budget, stoppingCondition: config.stoppingCondition,
      ledgerVersion: currentLedgerVersion(stores.events, run.projectId),
      contextVersion: ctx.task.contextVersion, baseRevision: config.baseRevision,
      provenance: 'simulated', ids, now: clock.now(), idempotencyKey: `revision-${ctx.task.taskId}`,
    });
    if (!compiled.ok) return compiled;
    bag(run.runId).revision = compiled.value.contract;
    stores.compilations.put(compiled.value.record.recordId, compiled.value.record);
    const dispatch: CommandEnvelope = {
      protocolVersion: RELAY_PROTOCOL_VERSION, commandId: `dispatch-revision-${ctx.task.taskId}`, commandType: 'dispatch-revision',
      issuedAt: clock.now(), actor: { kind: 'system', id: 'orchestrator' },
      payload: { runId: run.runId, taskId: ctx.task.taskId, revisionContract: compiled.value.contract as unknown as Record<string, unknown> },
      provenance: 'simulated',
    };
    stores.commands.put(dispatch.commandId, dispatch);
    const next = applyTransition(run, dispatch, { revisionContract: compiled.value.contract, latestVerdict: verdict });
    if (!next.ok) return next;
    return ok({ action: 'dispatch-revision', run: next.value, done: false });
  }

  function finalize(ctx: RunContext): RelayResult<{ action: string; run: RelayRun; done: boolean }> {
    const { run } = ctx;
    if (!ctx.task) return fail(relayError('not-found', 'Missing task.', { entityIds: { runId: run.runId } }));
    const latestBundle = stores.evidenceBundles.list().filter((b) => b.runId === run.runId).at(-1);
    const evidence = stores.evidence.list().filter((e) => e.runId === run.runId && e.repoRevision === config.baseRevision);
    const verdict = ctx.latestVerdict;
    const completion = evaluateCompletionPolicy({
      policy: config.completionPolicy, task: ctx.task,
      evidence, reviewerVerdict: verdict ?? undefined,
      resolvedFindingIds: ctx.repairReport ? ((ctx.repairReport.payload as { resolvedFindings?: Array<{ id: string }> }).resolvedFindings ?? []).map((r) => r.id) : [],
      currentRepositoryRevision: config.baseRevision, currentTime: clock.now(),
      enforcementCapabilities: adapters.verification.descriptor.enforcement,
    });
    if (completion.outcome !== 'satisfied') {
      const checkpointed = raiseCheckpoint(run, `Completion policy ${completion.outcome}: ${completion.safeSummary}`);
      if (!checkpointed.ok) return checkpointed;
      return ok({ action: `checkpoint:completion:${completion.outcome}`, run: checkpointed.value, done: true });
    }

    // Promote the recorded claims — each backed by the passing verification.
    const verification = {
      verificationId: ids.next('vrf'), taskId: ctx.task.taskId, runId: run.runId,
      policyId: config.completionPolicy.policyId, bundleId: latestBundle!.bundleId, at: clock.now(),
      outcome: 'passed' as const, checks: [],
    };
    const promotions = bag(run.runId).promotions;
    for (const claimId of bag(run.runId).claims) {
      const promoted = promoteClaim({ store: stores.events, ids, claimId, at: clock.now(), verification, idempotencyKey: `promote-${claimId}` });
      promotions.push({ claimId, decision: promoted.ok ? 'promoted' : 'pending' });
      if (!promoted.ok) return promoted;
    }

    const usageRecords = stores.usage.list().filter((u) => u.runId === run.runId);
    const assignments = stores.assignments.list().filter((a) => a.taskId === ctx.task!.taskId);
    const audit: FinalAuditReport = {
      auditId: ids.next('aud'), runId: run.runId, projectId: run.projectId, at: clock.now(),
      outcome: 'verified-complete', objective: run.objective,
      blueprintRef: ctx.blueprint?.blueprintId, taskRefs: [ctx.task.taskId],
      verificationRefs: run.verificationRefs, reviewRefs: run.reviewRefs,
      repairCount: run.repairCount, evidenceBundleRefs: latestBundle ? [latestBundle.bundleId] : [],
      usageSummary: { actualUsd: usageRecords.reduce((a, u) => a + (u.usd ?? 0), 0) || undefined, tokens: usageRecords.reduce((a, u) => a + (u.tokens ?? 0), 0) || undefined },
      checkpoints: run.checkpoint ? [{ id: run.checkpoint.checkpointId, reason: run.checkpoint.reason, response: run.checkpoint.response }] : [],
      provenanceProfile: run.provenanceProfile, unresolvedQuestions: [],
      identities: {
        architect: adapters.architect.descriptor.adapterId,
        codingAgent: adapters.codingAgent.descriptor.adapterId,
        reviewer: adapters.reviewer.descriptor.adapterId,
        verification: adapters.verification.descriptor.adapterId,
      },
      sessionRefs: ctx.sessionRef ? [ctx.sessionRef] : [],
      handoffPackageRefs: ctx.pkg ? [ctx.pkg.packageId] : [],
      blueprintVersion: ctx.blueprint?.version,
      ledgerVersion: currentLedgerVersion(stores.events, run.projectId),
      contextVersion: ctx.task.contextVersion as ContextVersion,
      baseRevision: config.baseRevision,
      ownershipHistory: assignments.map((a) => ({ assignmentId: a.assignmentId, adapterId: a.adapterId, role: a.role, endReason: a.endReason })),
      fileClaimPaths: stores.fileClaims.list().filter((c) => c.taskId === ctx.task!.taskId).map((c) => c.path),
      reportRefs: stores.reports.list().filter((r) => r.runId === run.runId).map((r) => r.reportId),
      completionPolicyId: config.completionPolicy.policyId,
      claimPromotions: promotions,
      remainingIssues: [],
      completionReason: 'CompletionPolicy satisfied with Relay-produced evidence and independent approval.',
      simulationNotice: run.provenanceProfile === 'live' ? undefined : 'SIMULATED workflow — no real repository was modified and no real commands were executed.',
      ...(run.checkpoint?.manualTask
        ? {
            manualTasks: [
              {
                manualTaskId: run.checkpoint.manualTask.manualTaskId,
                title: run.checkpoint.manualTask.title,
                category: run.checkpoint.manualTask.category,
                status: run.checkpoint.manualTask.status,
                responses: listEvents(stores.events, run.projectId)
                  .filter((e) => e.kind === 'manual.response_recorded' && e.refs?.manualTaskId === run.checkpoint!.manualTask!.manualTaskId)
                  .map((e) => String((e.payload as { response?: unknown }).response ?? '')),
                verification: run.checkpoint.manualTask.lastVerificationOutcome ?? 'none',
                resumedAfterCompletion: run.checkpoint.manualTask.status === 'completed',
                blocking: run.checkpoint.manualTask.status !== 'completed' && run.checkpoint.manualTask.status !== 'cancelled',
              },
            ],
          }
        : {}),
    };
    stores.audits.put(audit.auditId, audit);
    const latestVerification = { ...verification, checks: completion.requirements.map((r) => ({ id: r.requirement, label: r.requirement, status: 'passed' as const, detail: r.detail })) };
    const next = applyTransition(run, { intent: 'record-audit', audit }, { latestVerification, latestVerdict: verdict ?? undefined });
    if (!next.ok) return next;
    return ok({ action: 'final-audit:completed', run: next.value, done: true });
  }

  /* ---------------------------- public API --------------------------- */

  return {
    setup(input) {
      const at = clock.now();
      const project: RelayProject = { projectId: ids.next('prj'), name: input.projectName, createdAt: at, objective: input.objective, ledgerVersion: 0 as LedgerVersion };
      stores.projects.put(project.projectId, project);
      const run: RelayRun = {
        runId: ids.next('run'), projectId: project.projectId, createdAt: at, status: 'created', phase: 'blueprint',
        objective: input.objective, mode: 'guided', taskIds: [], budget: config.budget, loopPolicy: config.loopPolicy,
        repairCount: 0, provenanceProfile: 'simulated', verificationRefs: [], reviewRefs: [], failureRefs: [],
      };
      const task: RelayTask = {
        taskId: ids.next('tsk') as TaskId, projectId: project.projectId, runId: run.runId,
        objective: input.taskObjective, category: 'implementation', status: 'queued', ownerAssignmentId: null,
        dependencies: [], claimedFiles: input.claimedFiles, claimedResources: [],
        acceptanceCriteria: ['simulated targeted checks pass', 'independent review approves'],
        completionPolicyId: config.completionPolicy.policyId,
        contextVersion: 0 as ContextVersion, baseRevision: config.baseRevision,
        createdAt: at, updatedAt: at, priority: 1, equivalenceKey: input.equivalenceKey,
      };
      run.taskIds.push(task.taskId);
      stores.runs.put(run.runId, run);
      stores.tasks.put(task.taskId, task);
      const persisted = persistEvents([
        { protocolVersion: RELAY_PROTOCOL_VERSION, at, projectId: project.projectId, runId: run.runId, source: 'relay-core', kind: 'run.created', provenance: 'simulated', classification: 'canonical', safeSummary: `Run created: ${input.objective}`, payload: { objective: input.objective } },
        { protocolVersion: RELAY_PROTOCOL_VERSION, at, projectId: project.projectId, runId: run.runId, taskId: task.taskId, source: 'relay-core', kind: 'task.created', provenance: 'simulated', classification: 'canonical', safeSummary: `Task created: ${input.taskObjective}`, payload: { status: 'queued' } },
      ]);
      if (!persisted.ok) return persisted;
      return ok({ project, run, task });
    },

    step(runId) {
      const loaded = loadContext(runId);
      if (!loaded.ok) return loaded;
      const repair = maybeRepair(loaded.value);
      if (repair) return repair;
      return step(runId);
    },

    runUntilStopped(runId, maxSteps = 40) {
      const actions: string[] = [];
      for (let i = 0; i < maxSteps; i++) {
        const loaded = loadContext(runId);
        if (!loaded.ok) return loaded;
        const repair = maybeRepair(loaded.value);
        const result = repair ?? step(runId);
        if (!result.ok) return result;
        actions.push(result.value.action);
        if (result.value.done) {
          return ok({ run: result.value.run, actions, stopReason: result.value.action });
        }
      }
      const finalState = stores.runs.get(runId);
      if (!finalState) return fail(relayError('not-found', 'Run not found.', { entityIds: { runId } }));
      return ok({ run: finalState, actions, stopReason: 'max-steps-reached' });
    },

    command(raw) {
      const parsed = parseCommand(raw);
      if (!parsed.ok) return parsed;
      const cmd = parsed.value;
      const prior = stores.commands.get(cmd.commandId);
      if (prior) {
        // Duplicate delivery: same payload → return current state, no side
        // effect; different payload under the same id → conflict.
        if (JSON.stringify(prior.payload) !== JSON.stringify(cmd.payload)) {
          return fail(relayError('duplicate-command', 'Command id was already used with a different payload.', {}));
        }
        const runId = (cmd.payload as { runId?: RunId }).runId;
        const run = runId ? stores.runs.get(runId) : null;
        return run ? ok({ run }) : fail(relayError('not-found', 'Run not found.', {}));
      }
      stores.commands.put(cmd.commandId, cmd);
      const runId = (cmd.payload as { runId?: RunId }).runId;
      if (!runId) return fail(relayError('invalid-command', 'This command requires a runId payload.', {}));
      const run = stores.runs.get(runId);
      if (!run) return fail(relayError('not-found', 'Run not found.', { entityIds: { runId } }));
      const next = applyTransition(run, cmd, {});
      if (!next.ok) return next;
      // A Done claim immediately enters Relay-controlled verification; the
      // machine (never the client) decides whether the run resumes.
      if (cmd.commandType === 'respond-manual-task' && (cmd.payload as { response?: unknown }).response === 'done') {
        const verified = verifyManualTask(next.value);
        if (!verified.ok) return verified;
        return ok({ run: verified.value });
      }
      return ok({ run: next.value });
    },
  };
}
