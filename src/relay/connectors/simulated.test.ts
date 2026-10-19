import { describe, expect, it } from 'vitest';
import { createSimulatedAdapters } from './simulated';
import { deterministicIds, fixedId, makeAssignment, makePackage, makePolicy, makeProject, makeRun, makeTask } from '../testing/factories';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';

const ctx = () => ({ ids: deterministicIds(), now: '2026-07-22T03:00:00.000Z' });

describe('simulation adapter contracts', () => {
  it('every adapter declares simulated provenance, truthful enforcement, and its role', () => {
    const adapters = createSimulatedAdapters({});
    for (const [name, adapter] of Object.entries(adapters)) {
      expect(adapter.descriptor.provenance, name).toBe('simulated');
      expect(adapter.descriptor.simulatedPolicies.length, name).toBeGreaterThan(0);
      expect(adapter.descriptor.adapterId, name).toContain('sim-');
    }
    expect(adapters.reviewer.descriptor.adapterId).not.toBe(adapters.codingAgent.descriptor.adapterId);
  });

  it('architect produces a schema-valid simulated blueprint that never claims repository inspection', () => {
    const adapters = createSimulatedAdapters({});
    const result = adapters.architect.createBlueprint({ project: makeProject(), run: makeRun(), objective: 'obj', context: ctx() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.report.protocolVersion).toBe(RELAY_PROTOCOL_VERSION);
    expect(result.value.report.provenance).toBe('simulated');
    expect(result.value.blueprint.provenance).toBe('simulated');
    expect(result.value.blueprint.content.approach).toContain('no real repository inspected');
    // deterministic
    const again = adapters.architect.createBlueprint({ project: makeProject(), run: makeRun(), objective: 'obj', context: ctx() });
    if (again.ok) expect(again.value.blueprint.content).toEqual(result.value.blueprint.content);
  });

  it('architect malformed-scenario output is rejected by the same schema gate as real input', () => {
    const adapters = createSimulatedAdapters({ malformedBlueprint: true });
    const result = adapters.architect.createBlueprint({ project: makeProject(), run: makeRun(), objective: 'obj', context: ctx() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-report');
  });

  it('coding agent validates ownership/targeting, mints a session, and labels claims as simulated', () => {
    const adapters = createSimulatedAdapters({});
    const good = adapters.codingAgent.execute({ pkg: makePackage(), task: makeTask(), assignment: makeAssignment(), context: ctx() });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.value.report.provenance).toBe('simulated');
    expect(String(good.value.report.payload.notes)).toContain('SIMULATED');
    expect(good.value.sessionRef).toContain('ses_');

    const wrongTarget = adapters.codingAgent.execute({ pkg: makePackage({ targetAdapterId: 'someone-else' }), task: makeTask(), assignment: makeAssignment(), context: ctx() });
    expect(wrongTarget.ok).toBe(false);
    const wrongTask = adapters.codingAgent.execute({ pkg: makePackage({ taskId: fixedId('tsk', 'other') }), task: makeTask(), assignment: makeAssignment(), context: ctx() });
    expect(wrongTask.ok).toBe(false);
    const malformed = createSimulatedAdapters({ malformedAgentReport: true }).codingAgent.execute({ pkg: makePackage(), task: makeTask(), assignment: makeAssignment(), context: ctx() });
    expect(malformed.ok).toBe(false);
  });

  it('reviewer requires a matching independent assignment and maps insufficient evidence to a finding', () => {
    const adapters = createSimulatedAdapters({ reviewerAttempt1: 'insufficient_evidence' });
    const wrong = adapters.reviewer.review({
      pkg: makePackage(), task: makeTask(), reviewerAssignment: makeAssignment({ adapterId: 'sim-coding-agent', role: 'reviewer' }),
      implementationReport: null as never, evidence: null, policy: makePolicy(), attempt: 1, context: ctx(),
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('reviewer-independence');

    const result = adapters.reviewer.review({
      pkg: makePackage(), task: makeTask(), reviewerAssignment: makeAssignment({ adapterId: 'sim-reviewer', role: 'reviewer' }),
      implementationReport: null as never, evidence: null, policy: makePolicy(), attempt: 1, context: ctx(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.value.report.payload as { verdict: string; findings: Array<{ id: string }> };
    expect(payload.verdict).toBe('changes_requested'); // protocol enum authoritative
    expect(payload.findings[0].id).toBe('R-EVIDENCE');
  });

  it('verification produces revision-pinned simulated evidence — never live, never from agent claims', () => {
    const adapters = createSimulatedAdapters({ failingCheckAttempt1: 'npx vitest run' });
    const result = adapters.verification.verify({
      task: makeTask(), run: makeRun(), policy: makePolicy(), baseRevision: 'rev-abc123', attempt: 1, context: ctx(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const record of result.value.records) {
      expect(record.provenance).toBe('simulated');
      expect(record.repoRevision).toBe('rev-abc123');
      expect(record.verifier).toBe('sim-verification');
      expect(record.outputExcerpt).toContain('SIMULATED');
    }
    expect(result.value.bundle.overallStatus).toBe('failed');
    const unavailable = createSimulatedAdapters({ verificationUnavailable: true }).verification.verify({
      task: makeTask(), run: makeRun(), policy: makePolicy(), baseRevision: 'rev-abc123', attempt: 1, context: ctx(),
    });
    if (unavailable.ok) expect(unavailable.value.bundle.overallStatus).toBe('unavailable');
  });

  it('no adapter output contains credential-shaped material', () => {
    const adapters = createSimulatedAdapters({ usdPerStep: 0.01 });
    const blueprint = adapters.architect.createBlueprint({ project: makeProject(), run: makeRun(), objective: 'obj', context: ctx() });
    const agent = adapters.codingAgent.execute({ pkg: makePackage(), task: makeTask(), assignment: makeAssignment(), context: ctx() });
    const serialized = JSON.stringify([blueprint, agent]);
    expect(/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY/.test(serialized)).toBe(false);
  });
});
