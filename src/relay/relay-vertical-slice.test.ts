import { describe, expect, it } from 'vitest';
import { createOrchestrator, type OrchestratorConfig } from './core/orchestrator';
import { createSimulatedAdapters, type ScenarioConfig } from './connectors/simulated';
import { createInMemoryRelayStores } from './storage/memory';
import { deterministicIds, fixedId, makePermissionPolicy, makePolicy, testClock } from './testing/factories';
import { listEvents } from './ledger/ledger';
import { projectLedger } from './ledger/projection';
import { RELAY_PROTOCOL_VERSION } from './protocol/version';
import type { RunId } from './protocol/ids';

/**
 * Prompt-4 vertical slice: the REAL Relay architecture end-to-end on
 * deterministic simulation adapters. No parallel demo architecture — every
 * scenario goes through the orchestrator, state machine, eligibility
 * battery, compiler, verification, completion, promotion, and audit.
 */

function harness(scenario: ScenarioConfig = {}, configOverrides: Partial<OrchestratorConfig> = {}) {
  const stores = createInMemoryRelayStores({ acknowledgeVolatile: true });
  const ids = deterministicIds();
  const clock = testClock('2026-07-22T03:00:00.000Z', 1000);
  const adapters = createSimulatedAdapters(scenario);
  const config: OrchestratorConfig = {
    completionPolicy: makePolicy({ acceptedProvenance: ['simulated'] }),
    permissionPolicy: makePermissionPolicy(),
    budget: { maxUsd: 1, warningAtFraction: 0.8, missingEstimate: 'checkpoint' },
    loopPolicy: { maxAutomaticRevisions: 1 },
    stoppingCondition: { description: 'stop after report', maxRuntimeMs: 60000 },
    baseRevision: 'rev-abc123',
    leaseMs: 3_600_000,
    costEstimatePerStep: { usd: 0.01 },
    autoAcceptBlueprint: true,
    ...configOverrides,
  };
  const orchestrator = createOrchestrator({ stores, adapters, ids, clock: { now: () => clock.now() }, config });
  return { stores, orchestrator, adapters, config };
}

function setupAndRun(scenario: ScenarioConfig = {}, configOverrides: Partial<OrchestratorConfig> = {}, claimedFiles = ['src/sim/feature.ts']) {
  const h = harness(scenario, configOverrides);
  const setup = h.orchestrator.setup({
    projectName: 'Sim project', objective: 'Ship the simulated feature safely.',
    taskObjective: 'Implement the simulated feature.', claimedFiles, equivalenceKey: 'impl:sim-feature',
  });
  if (!setup.ok) throw new Error(setup.error.message);
  const result = h.orchestrator.runUntilStopped(setup.value.run.runId);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message} ${(result.error.details ?? []).join('; ')}`);
  return { ...h, setup: setup.value, result: result.value };
}

describe('direct success (no repair)', () => {
  it('completes with evidence-backed promotion, monotonic ledger, and a truthful audit', () => {
    const { stores, result, setup } = setupAndRun({ reviewerAttempt1: 'approved', usdPerStep: 0.01 });
    expect(result.run.status).toBe('completed');
    expect(result.run.repairCount).toBe(0);
    expect(result.stopReason).toBe('final-audit:completed');

    const events = listEvents(stores.events, setup.project.projectId);
    events.forEach((e, i) => expect(e.sequence).toBe(i + 1)); // gap-free monotonic
    expect(events.every((e) => e.provenance === 'simulated' || e.source === 'relay-core')).toBe(true);

    const projection = projectLedger(events);
    expect(projection.canonical.promotedClaimIds.length).toBeGreaterThan(0);
    expect(projection.runStatuses[setup.run.runId]).toBe('completed');

    const audit = stores.audits.list()[0];
    expect(audit.outcome).toBe('verified-complete');
    expect(audit.provenanceProfile).toBe('simulated');
    expect(audit.simulationNotice).toContain('SIMULATED');
    expect(audit.identities?.reviewer).toBe('sim-reviewer');
    expect(audit.claimPromotions?.every((p) => p.decision === 'promoted')).toBe(true);
    expect(audit.completionPolicyId).toBe(fixedId('pol'));
  });
});

describe('SCENARIO 1 — golden path with one repair', () => {
  it('one failing check → changes_requested → one repair in the SAME session → re-verify → approve → complete', () => {
    const { stores, result, setup } = setupAndRun({
      failingCheckAttempt1: 'npx vitest run',
      reviewerAttempt1: 'changes_requested',
      reviewerAttempt2: 'approved',
    });
    expect(result.run.status).toBe('completed');
    expect(result.run.repairCount).toBe(1); // exactly one automatic repair
    expect(result.actions).toContain('dispatch-revision');
    expect(result.actions.filter((a) => a === 'dispatch-revision')).toHaveLength(1);

    // Same simulated session resumed for the repair.
    const reports = stores.reports.list().filter((r) => r.runId === setup.run.runId);
    const implementation = reports.find((r) => r.reportType === 'implementation')!;
    const repair = reports.find((r) => r.reportType === 'repair')!;
    expect(repair.agentIdentity.sessionRef).toBe(implementation.agentIdentity.sessionRef);

    // Reviewer independent of the coding agent (adapter lineage).
    expect(reports.find((r) => r.reportType === 'review')!.agentIdentity.adapterId).toBe('sim-reviewer');

    // File claims never expanded; ownership preserved.
    const claims = stores.fileClaims.list();
    expect(claims.map((c) => c.path)).toEqual(['src/sim/feature.ts']);
    const events = listEvents(stores.events, setup.project.projectId);
    events.forEach((e, i) => expect(e.sequence).toBe(i + 1));
    expect(events.some((e) => e.kind === 'agent.session_resumed')).toBe(true);

    // The unsupported attempt-1 claim was NOT promoted before evidence:
    // promotions happen only at audit, after final verification passed.
    const promotionEvents = events.filter((e) => e.kind === 'ledger.claim_promoted');
    const auditEvent = events.find((e) => e.kind === 'audit.report_created')!;
    expect(promotionEvents.length).toBeGreaterThan(0);
    for (const p of promotionEvents) expect(p.sequence).toBeLessThan(auditEvent.sequence + 1);
    const verificationCompleted = events.filter((e) => e.kind === 'verification.completed');
    expect(verificationCompleted).toHaveLength(2); // initial + final
    expect(promotionEvents[0].sequence).toBeGreaterThan(verificationCompleted[1].sequence);

    const audit = stores.audits.list()[0];
    expect(audit.repairCount).toBe(1);
    expect(audit.simulationNotice).toBeDefined();
  });
});

describe('SCENARIO 2 — checkpoint escalation', () => {
  it('a failing founder condition (protected file) checkpoints instead of repairing', () => {
    const { stores, result } = setupAndRun({
      failingCheckAttempt1: 'npx vitest run',
      reviewerAttempt1: 'changes_requested',
    }, { repairPlanFacts: { requiresProtectedFile: true } });
    expect(result.run.status).toBe('checkpoint_required');
    expect(result.run.repairCount).toBe(0); // no repair dispatched
    expect(result.actions).not.toContain('dispatch-revision');
    expect(result.run.checkpoint?.reason).toContain('blocked');
    expect(stores.reports.list().filter((r) => r.reportType === 'repair')).toHaveLength(0);
    expect(stores.audits.list()).toHaveLength(0); // no false success
  });
});

describe('SCENARIO 3 — duplicate and stale work prevention', () => {
  it('an equivalent active task denies dispatch before the coding agent is ever invoked', () => {
    const h = harness({});
    const a = h.orchestrator.setup({ projectName: 'P', objective: 'obj A', taskObjective: 'task A', claimedFiles: ['src/a.ts'], equivalenceKey: 'impl:same' });
    if (!a.ok) throw new Error('setup A failed');
    const b = h.orchestrator.setup({ projectName: 'P', objective: 'obj B', taskObjective: 'task B', claimedFiles: ['src/b.ts'], equivalenceKey: 'impl:same' });
    if (!b.ok) throw new Error('setup B failed');

    const runA = h.orchestrator.runUntilStopped(a.value.run.runId, 6); // stop mid-flight with task A active
    expect(runA.ok).toBe(true);
    const runB = h.orchestrator.runUntilStopped(b.value.run.runId);
    expect(runB.ok).toBe(true);
    if (!runB.ok) return;
    expect(runB.value.run.status).toBe('checkpoint_required');
    expect(runB.value.stopReason).toContain('eligibility');
    // Coding agent never invoked for run B:
    expect(h.stores.reports.list().filter((r) => r.runId === b.value.run.runId && r.reportType === 'implementation')).toHaveLength(0);
    // The denial is recorded in the ledger with structured references:
    const denied = listEvents(h.stores.events, b.value.project.projectId).find((e) => e.kind === 'permission.denied' && e.runId === b.value.run.runId);
    expect(denied).toBeDefined();
    expect(JSON.stringify(denied!.payload)).toContain('no-duplicate-work');
  });

  it('a stale base revision checkpoints before dispatch (no side effect)', () => {
    const h = harness({});
    const s = h.orchestrator.setup({ projectName: 'P', objective: 'obj', taskObjective: 'task', claimedFiles: ['src/x.ts'] });
    if (!s.ok) throw new Error('setup failed');
    // Advance the run to handoff, then move the repository under it.
    const first = h.orchestrator.runUntilStopped(s.value.run.runId, 4);
    expect(first.ok).toBe(true);
    h.config.baseRevision = 'rev-moved';
    const resumed = h.orchestrator.runUntilStopped(s.value.run.runId);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.run.status).toBe('checkpoint_required');
    expect(h.stores.reports.list().filter((r) => r.reportType === 'implementation')).toHaveLength(0);
  });
});

describe('SCENARIO 4 — honest failure', () => {
  it('verification still failing after the single repair stops the run — never completion, never a second repair', () => {
    const { stores, result } = setupAndRun({
      failingCheckAttempt1: 'npx vitest run',
      stillFailingAfterRepair: true,
      reviewerAttempt1: 'changes_requested',
    });
    expect(result.run.status).toBe('checkpoint_required');
    expect(result.run.repairCount).toBe(1);
    expect(result.actions.filter((a) => a === 'dispatch-revision')).toHaveLength(1); // never two
    expect(result.run.checkpoint?.reason).toContain('Final verification failed');
    expect(stores.audits.list()).toHaveLength(0); // no success report
    // Unverified claims stay unverified: nothing was promoted.
    const projection = projectLedger(listEvents(stores.events, result.run.projectId));
    expect(projection.canonical.promotedClaimIds).toHaveLength(0);
    for (const claim of Object.values(projection.claims)) expect(claim.status).toBe('recorded');
  });

  it('unavailable verification is never treated as passed', () => {
    const { stores, result } = setupAndRun({ verificationUnavailable: true });
    expect(result.run.status).toBe('checkpoint_required');
    expect(result.run.checkpoint?.reason).toContain('unavailable');
    expect(stores.audits.list()).toHaveLength(0);
  });

  it('a live-required policy rejects simulated evidence at completion', () => {
    const { stores, result } = setupAndRun({ reviewerAttempt1: 'approved' }, {
      completionPolicy: makePolicy({ acceptedProvenance: undefined }), // live-only
    });
    expect(result.run.status).toBe('checkpoint_required');
    expect(result.run.checkpoint?.reason).toContain('Completion policy');
    expect(stores.audits.list()).toHaveLength(0);
  });
});

describe('budget behavior', () => {
  it('hard budget stop before dispatch: budget.exceeded event + checkpoint, no agent invocation', () => {
    const { stores, result } = setupAndRun({ usdPerStep: 0.5 }, { budget: { maxUsd: 0.6, missingEstimate: 'allow' }, costEstimatePerStep: { usd: 0.5 } });
    expect(result.run.status).toBe('checkpoint_required');
    const events = listEvents(stores.events, result.run.projectId);
    expect(events.some((e) => e.kind === 'budget.exceeded')).toBe(true);
  });

  it('warning threshold emits budget.warning but proceeds to completion', () => {
    const { stores, result } = setupAndRun(
      { reviewerAttempt1: 'approved', usdPerStep: 0.05 },
      { budget: { maxUsd: 1, warningAtFraction: 0.05 }, costEstimatePerStep: { usd: 0.04 } },
    );
    expect(result.run.status).toBe('completed');
    expect(listEvents(stores.events, result.run.projectId).some((e) => e.kind === 'budget.warning')).toBe(true);
  });
});

describe('pause / resume / cancel / idempotency / terminal protection', () => {
  const cmd = (commandId: string, commandType: string, payload: Record<string, unknown>) => ({
    protocolVersion: RELAY_PROTOCOL_VERSION, commandId, commandType, issuedAt: '2026-07-22T03:30:00.000Z',
    actor: { kind: 'user', id: 'founder' }, payload, provenance: 'manual',
  });

  it('pause stops stepping; resume continues to completion; duplicate command delivery is idempotent', () => {
    const h = harness({ reviewerAttempt1: 'approved' });
    const s = h.orchestrator.setup({ projectName: 'P', objective: 'obj', taskObjective: 'task', claimedFiles: ['src/x.ts'] });
    if (!s.ok) throw new Error('setup failed');
    const runId = s.value.run.runId as RunId;
    h.orchestrator.step(runId); // begin
    const paused = h.orchestrator.command(cmd('pause-1', 'pause-run', { runId }));
    expect(paused.ok && paused.value.run.status).toBe('paused');
    const whilePaused = h.orchestrator.step(runId);
    expect(whilePaused.ok && whilePaused.value.action).toBe('none:paused');

    const replay = h.orchestrator.command(cmd('pause-1', 'pause-run', { runId }));
    expect(replay.ok).toBe(true); // duplicate delivery, no side effect
    const conflicting = h.orchestrator.command(cmd('pause-1', 'pause-run', { runId: fixedId('run', 'other') }));
    expect(conflicting.ok).toBe(false);

    const resumed = h.orchestrator.command(cmd('resume-1', 'resume-run', { runId }));
    expect(resumed.ok && resumed.value.run.status).toBe('active');
    const finished = h.orchestrator.runUntilStopped(runId);
    expect(finished.ok && finished.value.run.status).toBe('completed');
  });

  it('cancellation stops the workflow; terminal runs reject further commands and steps', () => {
    const h = harness({});
    const s = h.orchestrator.setup({ projectName: 'P', objective: 'obj', taskObjective: 'task', claimedFiles: ['src/x.ts'] });
    if (!s.ok) throw new Error('setup failed');
    const runId = s.value.run.runId as RunId;
    h.orchestrator.step(runId);
    const cancelled = h.orchestrator.command(cmd('cancel-1', 'cancel-run', { runId, reason: 'operator stop' }));
    expect(cancelled.ok && cancelled.value.run.status).toBe('cancelled');
    const after = h.orchestrator.step(runId);
    expect(after.ok && after.value.action).toBe('none:terminal');
    const lateCommand = h.orchestrator.command(cmd('pause-2', 'pause-run', { runId }));
    expect(lateCommand.ok).toBe(false);
    if (!lateCommand.ok) expect(lateCommand.error.code).toBe('immutable');
  });

  it('checkpoint approval resumes the workflow after an escalated repair', () => {
    const h = harness({ failingCheckAttempt1: 'npx vitest run', reviewerAttempt1: 'changes_requested', reviewerAttempt2: 'approved' }, { repairPlanFacts: { requiresNewPermission: true } });
    const s = h.orchestrator.setup({ projectName: 'P', objective: 'obj', taskObjective: 'task', claimedFiles: ['src/x.ts'] });
    if (!s.ok) throw new Error('setup failed');
    const runId = s.value.run.runId as RunId;
    const stopped = h.orchestrator.runUntilStopped(runId);
    expect(stopped.ok && stopped.value.run.status).toBe('checkpoint_required');
    if (!stopped.ok) return;
    const ckp = stopped.value.run.checkpoint!.checkpointId;
    const approved = h.orchestrator.command(cmd('ckp-1', 'respond-checkpoint', { runId, checkpointId: ckp, response: 'approve' }));
    expect(approved.ok && approved.value.run.status).toBe('active');
  });
});
