import { describe, expect, it } from 'vitest';
import { createRelayApp, type RelayApp, type RelayAppOptions } from './core/app';
import { deterministicIds, testClock } from './testing/factories';

/**
 * Manual Task vertical slice (Prompt 6.1): the deterministic `manual`
 * scenario through the REAL Relay Core — request validation, checkpoint,
 * canonical task, user responses, verification, resume decision, Ledger
 * history, and Final Audit. No presentation-only fakes.
 */

const build = (overrides?: RelayAppOptions['overrides']): RelayApp => {
  const clock = testClock('2026-07-22T09:00:00.000Z', 1000);
  const created = createRelayApp({
    scenarioName: 'manual', ids: deterministicIds(), now: () => clock.now(), overrides,
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
};

const stopAtManualTask = (overrides?: RelayAppOptions['overrides']): RelayApp => {
  const app = build(overrides);
  const started = app.start('Demonstrate the manual task scenario.');
  if (!started.ok) throw new Error(started.error.message);
  const ran = app.continueRun();
  if (!ran.ok) throw new Error(ran.error.message);
  return app;
};

const kinds = (app: RelayApp): string[] => app.events(0).map((e) => e.kind);

describe('manual task lifecycle through Relay Core', () => {
  it('stops at checkpoint_required with a canonical validated task and no further dispatch', () => {
    const app = stopAtManualTask();
    const status = app.status()!;
    expect(status.status).toBe('checkpoint_required');
    expect(status.checkpoint?.reason).toContain('Manual task required');

    const view = app.manualTask()!;
    expect(view.title).toBe('Approve a protected setting');
    expect(view.status).toBe('pending');
    expect(view.validatedByRelay).toBe(true);
    expect(view.checkpointId).toBe(status.checkpoint?.checkpointId);
    expect(view.steps).toHaveLength(6);
    expect(view.availableResponses).toEqual(['done', 'help', 'cannot', 'cancel']);

    const history = kinds(app);
    for (const kind of ['manual.action_requested', 'manual.request_validated', 'run.checkpoint_required', 'manual.task_created']) {
      expect(history).toContain(kind);
    }

    // No agent dispatch while the manual task is pending: stepping is a no-op.
    const sessionsBefore = history.filter((k) => k.startsWith('agent.session')).length;
    const step = app.step();
    expect(step.ok && step.value.action).toBe('none:checkpoint');
    expect(kinds(app).filter((k) => k.startsWith('agent.session')).length).toBe(sessionsBefore);
  });

  it('done → passing verification → core-approved resume → completion with audited history', () => {
    const app = stopAtManualTask();
    const responded = app.respondManualTask('done');
    expect(responded.ok && responded.value.status).toBe('active');
    expect(app.manualTask()?.status).toBe('completed');
    expect(app.manualTask()?.verification.lastOutcome).toBe('passed');

    const finished = app.continueRun();
    expect(finished.ok && finished.value.status).toBe('completed');

    const audit = app.audit()!;
    expect(audit.outcome).toBe('verified-complete');
    expect(audit.manualTasks).toHaveLength(1);
    expect(audit.manualTasks![0]).toMatchObject({
      title: 'Approve a protected setting', category: 'protected_resource',
      status: 'completed', verification: 'passed', responses: ['done'],
      resumedAfterCompletion: true, blocking: false,
    });

    const history = kinds(app);
    const order = ['manual.response_recorded', 'manual.verification_started', 'manual.verification_passed', 'manual.task_completed', 'run.resumed', 'run.completed'];
    let cursor = -1;
    for (const kind of order) {
      const index = history.indexOf(kind, cursor + 1);
      expect(index, kind).toBeGreaterThan(cursor);
      cursor = index;
    }
    // Supporting evidence was recorded by Relay, not claimed by the user.
    expect(app.evidence().some((e) => e.type === 'health-check' && e.status === 'passed')).toBe(true);
    // No dispatch happened between the stop and the resume.
    const stop = history.indexOf('run.checkpoint_required');
    const resume = history.indexOf('run.resumed');
    expect(history.slice(stop, resume).some((k) => k.startsWith('agent.session'))).toBe(false);
  });

  it('failed verification keeps the run stopped and asks again; a later pass resumes', () => {
    const app = stopAtManualTask({ config: { manualVerificationOutcomes: ['failed', 'passed'] } });
    const first = app.respondManualTask('done');
    expect(first.ok && first.value.status).toBe('checkpoint_required');
    expect(app.manualTask()?.status).toBe('needs_more_information');
    expect(app.manualTask()?.verification.lastOutcome).toBe('failed');
    expect(kinds(app)).toContain('manual.verification_failed');

    const second = app.respondManualTask('done');
    expect(second.ok && second.value.status).toBe('active');
    expect(app.manualTask()?.status).toBe('completed');
    const finished = app.continueRun();
    expect(finished.ok && finished.value.status).toBe('completed');
  });

  it('unavailable verification is disclosed honestly and requires operator confirmation', () => {
    const fixture = {
      reason: 'This setting can affect production. Relay is not allowed to change it without you.',
      requestedAction: 'Approve a protected setting',
      category: 'protected_resource',
      applicationOrLocation: 'Project settings',
      proposedSteps: ['Open the project settings.', 'Review the requested change.', 'Choose "Approve."'],
      expectedResult: 'The change shows as approved.',
    };
    const app = stopAtManualTask({ scenario: { manualActionRequest: fixture } });
    expect(app.manualTask()?.verification.available).toBe(false);
    expect(app.manualTask()?.whatRelayWillDoNext).toContain('cannot check this automatically');

    const responded = app.respondManualTask('done');
    expect(responded.ok && responded.value.status).toBe('checkpoint_required');
    expect(app.manualTask()?.status).toBe('user_marked_done');
    expect(app.manualTask()?.verification.operatorConfirmationRequired).toBe(true);
    expect(kinds(app)).toContain('manual.verification_unavailable');

    const approved = app.respondCheckpoint('approve');
    expect(approved.ok && approved.value.status).toBe('active');
    expect(app.manualTask()?.status).toBe('completed');
  });

  it('help keeps the run stopped with deterministic guidance; cannot records the blocker', () => {
    const app = stopAtManualTask();
    const helped = app.respondManualTask('help');
    expect(helped.ok && helped.value.status).toBe('checkpoint_required');
    expect(app.manualTask()?.status).toBe('pending');
    expect(app.manualTask()?.helpText.join(' ')).toContain('stays safely stopped');

    const blocked = app.respondManualTask('cannot', 'I do not have access to this page.');
    expect(blocked.ok && blocked.value.status).toBe('checkpoint_required');
    expect(app.manualTask()?.status).toBe('cannot_complete');
    expect(app.manualTask()?.blockerNote).toContain('access');
    expect(app.manualTask()?.availableResponses).toEqual(['cancel']);
  });

  it('cancel uses canonical run cancellation and closes the task', () => {
    const app = stopAtManualTask();
    const cancelled = app.cancel('cancelled by user from the manual task prompt');
    expect(cancelled.ok && cancelled.value.status).toBe('cancelled');
    expect(app.manualTask()?.status).toBe('cancelled');
    expect(kinds(app)).toContain('manual.task_cancelled');
  });

  it('rejects an unsafe request without showing it to the user or leaking its content', () => {
    const secret = 'sk-FAKETESTNOTREAL0002';
    const app = stopAtManualTask({
      scenario: {
        manualActionRequest: {
          reason: 'Needs a person.',
          requestedAction: 'Add the provider key',
          category: 'provide_credential',
          applicationOrLocation: 'Provider dashboard',
          proposedSteps: ['Open the dashboard.', `Paste ${secret} in the field.`, 'Save it.'],
          expectedResult: 'The key is saved.',
        },
      },
    });
    expect(app.status()?.status).toBe('checkpoint_required');
    expect(app.manualTask()).toBeNull();
    expect(app.status()?.checkpoint?.reason).toContain('rejected as unsafe or malformed');
    expect(kinds(app)).toContain('manual.request_rejected');
    expect(kinds(app)).not.toContain('manual.task_created');
    // The untrusted content is never persisted into the feed or read models.
    const surface = JSON.stringify({ events: app.events(0), status: app.status(), brain: app.brain() });
    expect(surface).not.toContain(secret);
    expect(surface).not.toContain('Paste');
  });

  it('exposes exactly one manual task per run and none for scenarios without one', () => {
    const app = stopAtManualTask();
    expect(app.manualTask()).not.toBeNull();
    const plain = build();
    expect(plain.manualTask()).toBeNull();
  });
});
