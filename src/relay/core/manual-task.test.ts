import { describe, expect, it } from 'vitest';
import { compileManualTask, looksLikeSecret, looksLikeStackTrace, validateManualTaskText } from './manual-task';
import { transitionRun } from './run-machine';
import { deterministicIds, fixedId, makeCommand, makeRun, makeTask } from '../testing/factories';
import type { ManualTask, RelayRun } from '../protocol/contracts';

const T0 = '2026-07-21T22:00:00.000Z';
const T1 = '2026-07-21T22:01:00.000Z';

const validRequest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  requestId: fixedId('mrq'),
  projectId: fixedId('prj'),
  runId: fixedId('run'),
  relayTaskId: fixedId('tsk'),
  requestedBy: 'sim-coding-agent',
  reason: 'This setting can affect production. Relay is not allowed to change it without you.',
  requestedAction: 'Approve a protected setting',
  category: 'protected_resource',
  applicationOrLocation: 'Project settings',
  proposedSteps: ['Open the project settings.', 'Open "Access."', 'Choose "Approve."'],
  expectedResult: 'The change shows as approved.',
  verificationMethod: 'simulated-setting-check',
  requestedPermissions: [],
  createdAt: T0,
  ...overrides,
});

const compile = (request: unknown, run = makeRun({ status: 'active', phase: 'implementation' })) =>
  compileManualTask({
    request, run, task: makeTask(), expectedRequestedBy: 'sim-coding-agent',
    ids: deterministicIds(), now: T0,
  });

const expectRejected = (request: unknown, fragment: string, run?: RelayRun) => {
  const result = compile(request, run);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.details?.join('\n') ?? result.error.message).toContain(fragment);
  }
};

describe('ManualActionRequest validation and compilation', () => {
  it('compiles a valid request into a canonical, relay-validated ManualTask', () => {
    const result = compile(validRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = result.value.manualTask;
    expect(result.value.idempotent).toBe(false);
    expect(task.title).toBe('Approve a protected setting');
    expect(task.status).toBe('pending');
    expect(task.validatedByRelay).toBe(true);
    expect(task.verificationAvailable).toBe(true);
    expect(task.whatRelayWillDoNext).toContain('Relay will check the result');
    expect(task.helpText.length).toBeGreaterThan(0);
    expect(task.manualTaskId.startsWith('mtk_')).toBe(true);
  });

  it('rejects wrong project/run/task association and unknown requesters', () => {
    expectRejected(validRequest({ projectId: fixedId('prj', 'other') }), 'project does not match');
    expectRejected(validRequest({ runId: fixedId('run', 'other') }), 'run does not match');
    expectRejected(validRequest({ relayTaskId: fixedId('tsk', 'other') }), 'task does not match');
    expectRejected(validRequest({ requestedBy: 'imposter-adapter' }), 'not the adapter assigned');
  });

  it('rejects requests while the run is not active', () => {
    expectRejected(validRequest(), 'not in a state', makeRun({ status: 'paused', phase: 'implementation' }));
  });

  it('rejects malformed shapes, unknown fields, and hidden reasoning', () => {
    expectRejected({ nonsense: true }, 'is required');
    expectRejected(validRequest({ sneaky: 'field' }), 'not a recognized field');
    expectRejected(validRequest({ metadata: { chainOfThought: 'x' } }), 'not a recognized field');
    const withHidden = validRequest();
    (withHidden as Record<string, unknown>).reasoning = 'secret plan';
    expectRejected(withHidden, 'not a recognized field');
    expectRejected(validRequest({ category: 'made-up' }), 'must be one of');
  });

  it('rejects secret-shaped values and raw stack traces anywhere in the request', () => {
    expectRejected(validRequest({ proposedSteps: ['Open settings.', 'Paste sk-FAKETESTNOTREAL0001 there.', 'Save it.'] }), 'secret-shaped');
    expectRejected(validRequest({ expectedResult: 'AKIAFAKETESTNOTREAL0 becomes active.' }), 'secret-shaped');
    expectRejected(validRequest({ reason: 'It failed at handler (/srv/app/index.js:10:5) somehow.' }), 'stack trace');
  });

  it('rejects safety bypasses, destructive walk-throughs, and credentials into Relay', () => {
    expectRejected(validRequest({ proposedSteps: ['Open settings.', 'Disable the security checks.', 'Save.'] }), 'weaken required protection');
    expectRejected(validRequest({ proposedSteps: ['Open a terminal.', 'Run rm -rf on the folder.', 'Confirm.'] }), 'destructive');
    expectRejected(validRequest({ proposedSteps: ['Copy the key.', 'Paste the key into Relay chat.', 'Save.'] }), 'secure field');
  });

  it('rejects untruthful permissions and unknown verification methods', () => {
    expectRejected(validRequest({ requestedPermissions: ['admin-everything'] }), 'not truthful');
    expectRejected(validRequest({ verificationMethod: 'mystery-check' }), 'not one Relay knows');
  });

  it('enforces the extreme-simplicity constraints deterministically', () => {
    expectRejected(validRequest({ requestedAction: 'Resolve external infrastructure authentication prerequisite blockers now please' }), 'words or fewer');
    expectRejected(validRequest({ reason: 'One. Two. Three sentences is too many for this.' }), 'one or two short sentences');
    expectRejected(validRequest({ proposedSteps: ['Open settings.', 'Save.'] }), '3 to 6');
    expectRejected(validRequest({ proposedSteps: ['A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'G.'] }), '3 to 6');
    expectRejected(validRequest({ proposedSteps: ['Open settings.', 'Open the page. Then edit everything and validate it all.', 'Save.'] }), 'one short action sentence');
    expectRejected(validRequest({ proposedSteps: ['Open settings.', `Do ${'x'.repeat(95)}.`, 'Save.'] }), 'chars');
    expectRejected(validRequest({ reason: 'Complete the orchestration prerequisite first.' }), 'jargon');
    expectRejected(validRequest({ proposedSteps: ['Open settings.', 'Find run_abc123def456 in the list.', 'Save.'] }), 'internal id');
  });

  it('keeps one active manual task per run: equivalent merges, different rejects', () => {
    const active: ManualTask = {
      ...(compile(validRequest()) as { ok: true; value: { manualTask: Omit<ManualTask, 'checkpointId'> } }).value.manualTask,
      checkpointId: fixedId('ckp'),
    };
    const run = makeRun({
      status: 'active', phase: 'implementation',
      checkpoint: { checkpointId: fixedId('ckp'), runId: fixedId('run'), reason: 'x', requestedAt: T0, manualTask: active },
    });
    const merged = compile(validRequest(), run);
    expect(merged.ok).toBe(true);
    if (merged.ok) expect(merged.value.idempotent).toBe(true);
    expectRejected(validRequest({ requestedAction: 'Sign in to the dashboard', category: 'sign_in' }), 'one active manual task', run);
  });

  it('credential categories get a compiled security notice; verification honesty is explicit', () => {
    const signIn = compile(validRequest({ category: 'sign_in', requestedAction: 'Sign in to the dashboard' }));
    expect(signIn.ok).toBe(true);
    if (signIn.ok) expect(signIn.value.manualTask.securityNotice).toContain('Never type secret values');
    const noVerify = validRequest();
    delete (noVerify as Record<string, unknown>).verificationMethod;
    const unverifiable = compile(noVerify);
    expect(unverifiable.ok).toBe(true);
    if (unverifiable.ok) {
      expect(unverifiable.value.manualTask.verificationAvailable).toBe(false);
      expect(unverifiable.value.manualTask.whatRelayWillDoNext).toContain('cannot check this automatically');
    }
  });

  it('exposes narrow deterministic text validators (no reading-level model)', () => {
    expect(looksLikeSecret('paste sk-FAKETESTNOTREAL0001')).toBe(true);
    expect(looksLikeSecret('open the settings page')).toBe(false);
    expect(looksLikeStackTrace('at run (/app/x.js:1:2)')).toBe(true);
    expect(validateManualTaskText({
      title: 'Approve the change', whyRelayStopped: 'Relay cannot do this alone.',
      steps: ['Open settings.', 'Choose "Approve."', 'Return to Relay.'], expectedResult: 'Approved.',
    })).toEqual([]);
  });
});

describe('Manual Task run-machine transitions', () => {
  const ids = deterministicIds();
  const compiled = () => {
    const result = compile(validRequest());
    if (!result.ok) throw new Error('fixture must compile');
    return result.value.manualTask;
  };

  const raised = () => {
    const run = makeRun({ status: 'active', phase: 'implementation' });
    const outcome = transitionRun({
      run, action: { intent: 'raise-checkpoint', reason: 'Manual task required: Approve a protected setting', manualTask: compiled() },
      now: T0, ids,
    });
    if (!outcome.ok) throw new Error(outcome.error.message);
    return outcome.value.run;
  };

  const respond = (run: RelayRun, response: 'done' | 'help' | 'cannot', note?: string) =>
    transitionRun({
      run,
      action: makeCommand('respond-manual-task', {
        runId: run.runId,
        checkpointId: run.checkpoint!.checkpointId,
        manualTaskId: run.checkpoint!.manualTask!.manualTaskId,
        response,
        ...(note ? { note } : {}),
      }),
      now: T1, ids,
    });

  it('raise-checkpoint binds the manual task to the minted checkpoint and records creation', () => {
    const run = makeRun({ status: 'active', phase: 'implementation' });
    const outcome = transitionRun({ run, action: { intent: 'raise-checkpoint', reason: 'r', manualTask: compiled() }, now: T0, ids });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const task = outcome.value.run.checkpoint?.manualTask;
    expect(outcome.value.run.status).toBe('checkpoint_required');
    expect(task?.checkpointId).toBe(outcome.value.run.checkpoint?.checkpointId);
    expect(outcome.value.events.map((e) => e.kind)).toContain('manual.task_created');
    expect(outcome.value.events.find((e) => e.kind === 'manual.task_created')?.classification).toBe('canonical');
  });

  it('done records a claim (not completion) and demands verification', () => {
    const outcome = respond(raised(), 'done');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.run.status).toBe('checkpoint_required');
    expect(outcome.value.run.checkpoint?.manualTask?.status).toBe('user_marked_done');
    expect(outcome.value.requiredActions).toContain('verify-manual-task');
    const event = outcome.value.events.find((e) => e.kind === 'manual.response_recorded');
    expect(event?.safeSummary).toContain('claim, not evidence');
    expect(event?.provenance).toBe('manual');
  });

  it('help keeps everything stopped and unchanged; cannot records the blocker', () => {
    const help = respond(raised(), 'help');
    expect(help.ok).toBe(true);
    if (help.ok) {
      expect(help.value.run.status).toBe('checkpoint_required');
      expect(help.value.run.checkpoint?.manualTask?.status).toBe('pending');
      expect(help.value.requiredActions).toEqual([]);
    }
    const cannot = respond(raised(), 'cannot', 'I do not have access to this page.');
    expect(cannot.ok).toBe(true);
    if (cannot.ok) {
      expect(cannot.value.run.status).toBe('checkpoint_required');
      expect(cannot.value.run.checkpoint?.manualTask?.status).toBe('cannot_complete');
      expect(cannot.value.run.checkpoint?.manualTask?.blockerNote).toContain('access');
    }
  });

  it('rejects mismatched ids and responses the task status does not accept', () => {
    const run = raised();
    const wrongTask = transitionRun({
      run,
      action: makeCommand('respond-manual-task', {
        runId: run.runId, checkpointId: run.checkpoint!.checkpointId,
        manualTaskId: fixedId('mtk', 'other'), response: 'done',
      }),
      now: T1, ids,
    });
    expect(wrongTask.ok).toBe(false);
    const doneOnce = respond(run, 'done');
    if (!doneOnce.ok) throw new Error('done must apply');
    const doneTwice = respond(doneOnce.value.run, 'done');
    expect(doneTwice.ok).toBe(false);
  });

  it('verification passed completes and resumes; failed keeps stopped; unavailable stays honest', () => {
    const claimed = respond(raised(), 'done');
    if (!claimed.ok) throw new Error('done must apply');
    const base = claimed.value.run;

    const passed = transitionRun({ run: base, action: { intent: 'record-manual-verification', outcome: 'passed' }, now: T1, ids });
    expect(passed.ok).toBe(true);
    if (passed.ok) {
      expect(passed.value.run.status).toBe('active');
      expect(passed.value.run.checkpoint?.manualTask?.status).toBe('completed');
      expect(passed.value.run.checkpoint?.response).toBe('approve');
      expect(passed.value.events.map((e) => e.kind)).toEqual(
        expect.arrayContaining(['manual.verification_passed', 'manual.task_completed', 'run.resumed']),
      );
    }

    const failed = transitionRun({ run: base, action: { intent: 'record-manual-verification', outcome: 'failed' }, now: T1, ids });
    expect(failed.ok).toBe(true);
    if (failed.ok) {
      expect(failed.value.run.status).toBe('checkpoint_required');
      expect(failed.value.run.checkpoint?.manualTask?.status).toBe('needs_more_information');
    }

    const unavailable = transitionRun({ run: base, action: { intent: 'record-manual-verification', outcome: 'unavailable' }, now: T1, ids });
    expect(unavailable.ok).toBe(true);
    if (unavailable.ok) {
      expect(unavailable.value.run.status).toBe('checkpoint_required');
      expect(unavailable.value.run.checkpoint?.manualTask?.status).toBe('user_marked_done');
      expect(unavailable.value.run.checkpoint?.manualTask?.lastVerificationOutcome).toBe('unavailable');
    }
  });

  it('verification never applies without a Done claim', () => {
    const outcome = transitionRun({ run: raised(), action: { intent: 'record-manual-verification', outcome: 'passed' }, now: T1, ids });
    expect(outcome.ok).toBe(false);
  });

  it('operator approval completes a verified-unavailable claim but never fakes completion of a pending task', () => {
    const claimed = respond(raised(), 'done');
    if (!claimed.ok) throw new Error('done must apply');
    const unavailable = transitionRun({ run: claimed.value.run, action: { intent: 'record-manual-verification', outcome: 'unavailable' }, now: T1, ids });
    if (!unavailable.ok) throw new Error('unavailable must apply');
    const approveCommand = (run: RelayRun) =>
      transitionRun({
        run,
        action: makeCommand('respond-checkpoint', { runId: run.runId, checkpointId: run.checkpoint!.checkpointId, response: 'approve' }),
        now: T1, ids,
      });
    const confirmed = approveCommand(unavailable.value.run);
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.value.run.checkpoint?.manualTask?.status).toBe('completed');

    const overridden = approveCommand(raised());
    expect(overridden.ok).toBe(true);
    if (overridden.ok) {
      expect(overridden.value.run.checkpoint?.manualTask?.status).toBe('cancelled');
      expect(overridden.value.events.map((e) => e.kind)).toContain('manual.task_cancelled');
    }
  });

  it('canonical cancel-run cancels the manual task with the run', () => {
    const run = raised();
    const cancelled = transitionRun({
      run,
      action: makeCommand('cancel-run', { runId: run.runId, reason: 'operator stop' }),
      now: T1, ids,
    });
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.value.run.status).toBe('cancelled');
      expect(cancelled.value.run.checkpoint?.manualTask?.status).toBe('cancelled');
      expect(cancelled.value.events.map((e) => e.kind)).toContain('manual.task_cancelled');
    }
  });
});
