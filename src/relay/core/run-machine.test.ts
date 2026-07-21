import { describe, expect, it } from 'vitest';
import { transitionRun, type RunAction, type RunTransitionInput } from './run-machine';
import type { RelayRun } from '../protocol/contracts';
import {
  deterministicIds, fixedId, makeAudit, makeBlueprint, makeCommand,
  makeRevisionContract, makeVerdict, makeVerification, testClock,
} from '../testing/factories';

/** Drive a run through steps, asserting each transition succeeds. */
function drive(run: RelayRun, steps: Array<Partial<RunTransitionInput> & { action: RunAction }>): RelayRun {
  const ids = deterministicIds();
  const clock = testClock();
  let current = run;
  for (const [i, step] of steps.entries()) {
    const result = transitionRun({ run: current, now: clock.now(), ids, ...step });
    if (!result.ok) throw new Error(`step ${i} (${JSON.stringify(step.action).slice(0, 60)}): ${result.error.code} ${result.error.message}`);
    current = result.value.run;
  }
  return current;
}

const step = (run: RelayRun, action: RunAction, extra: Partial<RunTransitionInput> = {}) =>
  transitionRun({ run, action: action, now: '2026-07-21T23:00:00.000Z', ids: deterministicIds(), ...extra });

const cmd = makeCommand;
const blueprint = makeBlueprint();
const acceptBlueprint = cmd('accept-blueprint', { runId: fixedId('run'), blueprintId: blueprint.blueprintId });
const dispatchTask = cmd('dispatch-task', { runId: fixedId('run'), taskId: fixedId('tsk'), packageId: fixedId('pkg') });
const requestInitial = cmd('request-verification', { runId: fixedId('run'), taskId: fixedId('tsk'), policyId: fixedId('pol'), scope: 'initial' });
const requestFinal = cmd('request-verification', { runId: fixedId('run'), taskId: fixedId('tsk'), policyId: fixedId('pol'), scope: 'final' });

const HAPPY_PREFIX: Array<Partial<RunTransitionInput> & { action: RunAction }> = [
  { action: { intent: 'begin' } },
  { action: { intent: 'record-blueprint', blueprint } },
  { action: acceptBlueprint },
  { action: dispatchTask },
  { action: { intent: 'record-report', reportType: 'implementation', reportId: fixedId('rpt', 'impl'), provenance: 'simulated' } },
  { action: requestInitial },
  { action: { intent: 'record-verification', verification: makeVerification('passed'), provenance: 'simulated' } },
];

function newRun(overrides: Partial<RelayRun> = {}): RelayRun {
  return {
    runId: fixedId('run'), projectId: fixedId('prj'), createdAt: '2026-07-21T22:00:00.000Z',
    status: 'created', phase: 'blueprint', objective: 'obj', mode: 'guided', taskIds: [],
    budget: {}, loopPolicy: { maxAutomaticRevisions: 1 }, repairCount: 0,
    provenanceProfile: 'simulated', verificationRefs: [], reviewRefs: [], failureRefs: [],
    ...overrides,
  };
}

describe('B — full golden path', () => {
  it('created → blueprint → handoff → implementation → verification → review → audit → completed', () => {
    const approved = makeVerdict('approved');
    const done = drive(newRun(), [
      ...HAPPY_PREFIX,
      { action: { intent: 'record-verdict', verdict: approved, reportId: approved.reportId } },
      {
        action: { intent: 'record-audit', audit: makeAudit() },
        latestVerification: makeVerification('passed'),
        latestVerdict: approved,
      },
    ]);
    expect(done.status).toBe('completed');
    expect(done.finalAuditId).toBe(makeAudit().auditId);
    expect(done.provenanceProfile).toBe('simulated');
    expect(done.verificationRefs).toHaveLength(1);
  });

  it('emits phase_changed and canonical events along the way', () => {
    const ids = deterministicIds();
    const afterBegin = transitionRun({ run: newRun(), action: { intent: 'begin' }, now: '2026-07-21T23:00:00.000Z', ids });
    expect(afterBegin.ok).toBe(true);
    if (!afterBegin.ok) return;
    expect(afterBegin.value.events.map((e) => e.kind)).toEqual(['run.started', 'architect.started']);
    // every emitted draft is stamped with the injected time and no id/sequence
    for (const e of afterBegin.value.events) {
      expect(e.at).toBe('2026-07-21T23:00:00.000Z');
      expect('eventId' in e).toBe(false);
      expect('sequence' in e).toBe(false);
    }
  });
});

describe('C — one-revision lifecycle', () => {
  const changes = makeVerdict('changes_requested');

  it('review → repair → final verification → final review → audit → completed', () => {
    const approvedAfterRepair = makeVerdict('approved');
    const done = drive(newRun(), [
      ...HAPPY_PREFIX,
      { action: { intent: 'record-verdict', verdict: changes, reportId: changes.reportId } },
      {
        action: cmd('dispatch-revision', { runId: fixedId('run'), taskId: fixedId('tsk'), revisionContract: makeRevisionContract() }),
        revisionContract: makeRevisionContract(),
        latestVerdict: changes,
      },
      { action: { intent: 'record-report', reportType: 'repair', reportId: fixedId('rpt', 'repair'), provenance: 'simulated' } },
      { action: requestFinal },
      { action: { intent: 'record-verification', verification: makeVerification('passed'), provenance: 'simulated' } },
      { action: { intent: 'record-verdict', verdict: approvedAfterRepair, reportId: approvedAfterRepair.reportId } },
      {
        action: { intent: 'record-audit', audit: makeAudit({ repairCount: 1 }) },
        latestVerification: makeVerification('passed'),
        latestVerdict: approvedAfterRepair,
      },
    ]);
    expect(done.status).toBe('completed');
    expect(done.repairCount).toBe(1);
  });

  it('F — second automatic revision is rejected (limit 1) and zero-revision policy rejects the first', () => {
    const atReview = drive(newRun(), [
      ...HAPPY_PREFIX,
      { action: { intent: 'record-verdict', verdict: changes, reportId: changes.reportId } },
    ]);
    const used = { ...atReview, repairCount: 1 as const };
    const second = step(used, cmd('dispatch-revision', { runId: fixedId('run'), taskId: fixedId('tsk'), revisionContract: makeRevisionContract() }), {
      revisionContract: makeRevisionContract(),
      latestVerdict: changes,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('revision-limit-exceeded');

    const zeroPolicy = { ...atReview, loopPolicy: { maxAutomaticRevisions: 0 as const } };
    const first = step(zeroPolicy, cmd('dispatch-revision', { runId: fixedId('run'), taskId: fixedId('tsk'), revisionContract: makeRevisionContract() }), {
      revisionContract: makeRevisionContract(),
      latestVerdict: changes,
    });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.code).toBe('revision-limit-exceeded');
  });

  it('F — revision requires a standing blocking finding and a matching contract', () => {
    const atReview = drive(newRun(), [
      ...HAPPY_PREFIX,
      { action: { intent: 'record-verdict', verdict: changes, reportId: changes.reportId } },
    ]);
    const noVerdict = step(atReview, cmd('dispatch-revision', { runId: fixedId('run'), taskId: fixedId('tsk'), revisionContract: makeRevisionContract() }), {
      revisionContract: makeRevisionContract(),
    });
    expect(noVerdict.ok).toBe(false);
    if (!noVerdict.ok) expect(noVerdict.error.code).toBe('evidence-required');

    const wrongFinding = step(atReview, cmd('dispatch-revision', { runId: fixedId('run'), taskId: fixedId('tsk'), revisionContract: makeRevisionContract() }), {
      revisionContract: makeRevisionContract({ findingsTargeted: ['R99'] }),
      latestVerdict: changes,
    });
    expect(wrongFinding.ok).toBe(false);
  });

  it('D/F — an unsatisfied auto-repair condition escalates to checkpoint_required instead of repairing', () => {
    const atReview = drive(newRun(), [
      ...HAPPY_PREFIX,
      { action: { intent: 'record-verdict', verdict: changes, reportId: changes.reportId } },
    ]);
    const result = step(atReview, cmd('dispatch-revision', { runId: fixedId('run'), taskId: fixedId('tsk'), revisionContract: makeRevisionContract() }), {
      revisionContract: makeRevisionContract({}, ['no-protected-file']),
      latestVerdict: changes,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.run.status).toBe('checkpoint_required');
    expect(result.value.run.repairCount).toBe(0);
    expect(result.value.events.some((e) => e.kind === 'run.checkpoint_required')).toBe(true);
  });

  it('honest failure: failed final verification stops at checkpoint_required — never a second repair', () => {
    const approved = makeVerdict('approved');
    void approved;
    const afterRepairVerify = drive(newRun(), [
      ...HAPPY_PREFIX,
      { action: { intent: 'record-verdict', verdict: changes, reportId: changes.reportId } },
      {
        action: cmd('dispatch-revision', { runId: fixedId('run'), taskId: fixedId('tsk'), revisionContract: makeRevisionContract() }),
        revisionContract: makeRevisionContract(),
        latestVerdict: changes,
      },
      { action: { intent: 'record-report', reportType: 'repair', reportId: fixedId('rpt', 'repair'), provenance: 'simulated' } },
      { action: requestFinal },
    ]);
    const failedVerify = step(afterRepairVerify, { intent: 'record-verification', verification: makeVerification('failed'), provenance: 'simulated' });
    expect(failedVerify.ok).toBe(true);
    if (!failedVerify.ok) return;
    expect(failedVerify.value.run.status).toBe('checkpoint_required');
    expect(failedVerify.value.requiredActions).toContain('record-failure');
  });
});

describe('D — pause / resume / cancel / checkpoints', () => {
  it('pauses from active, resumes from paused, rejects invalid resume', () => {
    const active = drive(newRun(), [{ action: { intent: 'begin' } }]);
    const paused = step(active, cmd('pause-run', { runId: fixedId('run') }));
    expect(paused.ok && paused.value.run.status).toBe('paused');
    if (!paused.ok) return;
    const resumed = step(paused.value.run, cmd('resume-run', { runId: fixedId('run') }));
    expect(resumed.ok && resumed.value.run.status).toBe('active');
    const invalidResume = step(active, cmd('resume-run', { runId: fixedId('run') }));
    expect(invalidResume.ok).toBe(false);
    if (!invalidResume.ok) expect(invalidResume.error.code).toBe('illegal-transition');
  });

  it('checkpoint approve resumes; reject cancels; cancellation works while paused and checkpointed', () => {
    const changes = makeVerdict('changes_requested');
    const atReview = drive(newRun(), [
      ...HAPPY_PREFIX,
      { action: { intent: 'record-verdict', verdict: changes, reportId: changes.reportId } },
    ]);
    const escalated = step(atReview, cmd('dispatch-revision', { runId: fixedId('run'), taskId: fixedId('tsk'), revisionContract: makeRevisionContract() }), {
      revisionContract: makeRevisionContract({}, ['within-budget']),
      latestVerdict: changes,
    });
    if (!escalated.ok) throw new Error('setup failed');
    const checkpointed = escalated.value.run;
    const ckpId = checkpointed.checkpoint!.checkpointId;

    const approved = step(checkpointed, cmd('respond-checkpoint', { runId: fixedId('run'), checkpointId: ckpId, response: 'approve' }));
    expect(approved.ok && approved.value.run.status).toBe('active');

    const rejected = step(checkpointed, cmd('respond-checkpoint', { runId: fixedId('run'), checkpointId: ckpId, response: 'reject' }));
    expect(rejected.ok && rejected.value.run.status).toBe('cancelled');

    const cancelledWhileCheckpointed = step(checkpointed, cmd('cancel-run', { runId: fixedId('run'), reason: 'stop' }));
    expect(cancelledWhileCheckpointed.ok && cancelledWhileCheckpointed.value.run.status).toBe('cancelled');

    const active = drive(newRun(), [{ action: { intent: 'begin' } }]);
    const paused = step(active, cmd('pause-run', { runId: fixedId('run') }));
    if (!paused.ok) throw new Error('setup failed');
    const cancelledWhilePaused = step(paused.value.run, cmd('cancel-run', { runId: fixedId('run'), reason: 'stop' }));
    expect(cancelledWhilePaused.ok && cancelledWhilePaused.value.run.status).toBe('cancelled');

    const wrongCkp = step(checkpointed, cmd('respond-checkpoint', { runId: fixedId('run'), checkpointId: fixedId('ckp', 'other'), response: 'approve' }));
    expect(wrongCkp.ok).toBe(false);
  });
});

describe('E — terminal-state protection', () => {
  const terminalRuns = (['completed', 'failed', 'cancelled'] as const).map((status) => newRun({ status }));

  it('terminal runs reject every mutation with a structured immutable error', () => {
    for (const run of terminalRuns) {
      for (const action of [
        { intent: 'begin' } as RunAction,
        cmd('cancel-run', { runId: fixedId('run'), reason: 'again' }),
        cmd('pause-run', { runId: fixedId('run') }),
      ]) {
        const result = step(run, action);
        expect(result.ok, `${run.status} must be frozen`).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('immutable');
          expect(result.error.entityIds?.runId).toBe(run.runId);
        }
      }
    }
  });

  it('cancelled cannot complete; completion cannot come from agent claims alone', () => {
    const audit = { intent: 'record-audit', audit: makeAudit() } as RunAction;
    expect(step(newRun({ status: 'cancelled' }), audit).ok).toBe(false);

    const atAudit = newRun({ status: 'active', phase: 'audit' });
    const noEvidence = step(atAudit, audit); // no verification supplied
    expect(noEvidence.ok).toBe(false);
    if (!noEvidence.ok) expect(noEvidence.error.code).toBe('evidence-required');

    const failedVerification = step(atAudit, audit, {
      latestVerification: makeVerification('failed'),
      latestVerdict: makeVerdict('approved'),
    });
    expect(failedVerification.ok).toBe(false);

    const selfReview = step(atAudit, audit, {
      latestVerification: makeVerification('passed'),
      latestVerdict: makeVerdict('approved', { independent: false }),
    });
    expect(selfReview.ok).toBe(false);
  });

  it('a non-independent verdict is rejected at record time (reviewer-independence)', () => {
    const atReview = drive(newRun(), [...HAPPY_PREFIX]);
    const selfVerdict = makeVerdict('approved', { independent: false });
    const result = step(atReview, { intent: 'record-verdict', verdict: selfVerdict, reportId: selfVerdict.reportId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('reviewer-independence');
  });
});

describe('provenance profile derivation', () => {
  it('imported blueprint yields mixed; all-simulated stays simulated', () => {
    const imported = makeBlueprint({ source: 'imported', provenance: 'imported' });
    const run = drive(newRun(), [
      { action: { intent: 'begin' } },
      { action: { intent: 'record-blueprint', blueprint: imported } },
    ]);
    expect(run.provenanceProfile).toBe('mixed');

    const simulated = drive(newRun(), [
      { action: { intent: 'begin' } },
      { action: { intent: 'record-blueprint', blueprint: makeBlueprint() } },
    ]);
    expect(simulated.provenanceProfile).toBe('simulated');
  });
});
