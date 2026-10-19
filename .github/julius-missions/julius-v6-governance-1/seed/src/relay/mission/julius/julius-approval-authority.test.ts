/**
 * THE SPECIFICATION for `decideJuliusApproval` (src/relay/mission/julius/julius-lifecycle-runtime.ts).
 *
 * An approval records WHO decided it. So an identity that is blank, or that the approver authority refuses, must never be
 * recorded as the decider of an approval and must never be told an approval's decision or its run's state, in ANY branch
 * (a live run, a cancelled run, an approval that is already decided). What an AUTHORISED approver gets is unchanged.
 *
 * Run it with: node --import ./.julius/loader.mjs --test src/relay/mission/julius/julius-approval-authority.test.ts
 * It is the specification you implement against, not part of the deliverable: do not edit it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideJuliusApproval } from './julius-lifecycle-runtime';

const FOUNDER = 'github:founder#1';
const STRANGER = 'github:stranger#2';
const NOW = '2026-10-19T00:00:00.000Z';

function world(input: { runState: string; approvalState: string; decidedBy?: string | null; noRun?: boolean; noApproval?: boolean }) {
  const calls: string[] = [];
  const writes: unknown[] = [];
  let run: any = {
    runId: 'run-1', missionId: 'mission-1', projectId: 'prj-1', state: input.runState, cardRevision: '1',
    missionContractRevision: 1, projectBrainRevision: 1, version: 3,
  };
  let approval: any = {
    approvalId: 'approval-1', runId: 'run-1', projectId: 'prj-1', taskId: 'task-build', operation: 'DISPATCH_WORKER',
    policyRevision: '1', reasonCode: 'CARD_SCOPED_APPROVAL_REQUIRED', safeRationale: 'sign-off', state: input.approvalState,
    requestedAt: '2026-10-18T23:00:00.000Z', decidedAt: input.approvalState === 'PENDING' ? null : '2026-10-18T23:30:00.000Z',
    decidedBy: input.approvalState === 'PENDING' ? null : (input.decidedBy ?? FOUNDER),
    decisionReason: input.approvalState === 'PENDING' ? null : 'earlier decision', idempotencyKey: 'key-1',
  };
  const store: any = {
    loadRun: async () => { calls.push('loadRun'); return input.noRun ? null : run; },
    loadApproval: async () => { calls.push('loadApproval'); return input.noApproval ? null : approval; },
    pendingApprovals: async () => (approval.state === 'PENDING' ? [approval] : []),
    decideApproval: async (write: any) => {
      calls.push('decideApproval');
      writes.push(write);
      if (approval.state !== 'PENDING') return false;
      approval = { ...approval, state: write.state, decidedBy: write.decidedBy, decisionReason: write.decisionReason, decidedAt: write.decidedAt };
      return true;
    },
    transition: async (move: any) => { calls.push(`transition:${move.to}`); run = { ...run, state: move.to, version: run.version + 1 }; return run; },
    requestApproval: async () => { throw new Error('not used'); },
    cancelRunTasks: async () => 0,
    recordLifecycle: async () => true,
  };
  const approvers = { mayApprove: async (who: any) => { calls.push(`mayApprove:${who.approverId}:${who.operation}`); return who.approverId === FOUNDER; } };
  return {
    calls, writes,
    approval: () => approval,
    snapshot: () => JSON.stringify(approval),
    decide: (over: { approverId?: string; reason?: string; decision?: 'APPROVED' | 'DENIED' } = {}) => decideJuliusApproval(
      {
        runId: 'run-1', projectId: 'prj-1', approvalId: 'approval-1', decision: over.decision ?? 'APPROVED',
        approverId: over.approverId ?? FOUNDER, reason: over.reason ?? 'plan reviewed and approved',
      },
      { store, clock: { now: () => NOW }, approvers },
    ),
  };
}

const REFUSED_BLANK = { decided: false, reasonCode: 'APPROVER_REQUIRED' };
const REFUSED_STRANGER = { decided: false, reasonCode: 'APPROVER_NOT_AUTHORIZED' };

/* ---- what an unauthorised or blank identity gets: nothing recorded, nothing told ---- */

test('blank approver on a CANCELLED run is refused and the approval stays PENDING with no decider', async () => {
  const w = world({ runState: 'CANCELLED', approvalState: 'PENDING' });
  const before = w.snapshot();
  const outcome: any = await w.decide({ approverId: '   ' });
  assert.equal(outcome.decided, false);
  assert.equal(outcome.reasonCode, REFUSED_BLANK.reasonCode);
  assert.equal(w.writes.length, 0);
  assert.equal(w.snapshot(), before);
  assert.equal(w.approval().decidedBy, null);
});

test('blank reason on a CANCELLED run is refused the same way', async () => {
  const w = world({ runState: 'CANCELLED', approvalState: 'PENDING' });
  const before = w.snapshot();
  const outcome: any = await w.decide({ reason: '  ' });
  assert.equal(outcome.reasonCode, 'APPROVER_REQUIRED');
  assert.equal(w.writes.length, 0);
  assert.equal(w.snapshot(), before);
});

test('an identity the authority refuses, on a CANCELLED run, is refused and is not recorded as the decider', async () => {
  const w = world({ runState: 'CANCELLED', approvalState: 'PENDING' });
  const before = w.snapshot();
  const outcome: any = await w.decide({ approverId: STRANGER });
  assert.equal(outcome.decided, false);
  assert.equal(outcome.reasonCode, REFUSED_STRANGER.reasonCode);
  assert.equal(w.writes.length, 0);
  assert.equal(w.snapshot(), before);
  assert.equal(w.approval().state, 'PENDING');
});

test('an identity the authority refuses, on an already-decided approval, learns neither the decision nor the run state', async () => {
  const w = world({ runState: 'READY', approvalState: 'APPROVED' });
  const before = w.snapshot();
  const outcome: any = await w.decide({ approverId: STRANGER });
  assert.equal(outcome.decided, false);
  assert.equal(outcome.reasonCode, REFUSED_STRANGER.reasonCode);
  assert.equal('state' in outcome, false);
  assert.equal('runState' in outcome, false);
  assert.equal('duplicate' in outcome, false);
  assert.doesNotMatch(JSON.stringify(outcome), /APPROVED|READY/u);
  assert.equal(w.snapshot(), before);
});

test('a blank identity on an already-decided approval is refused and learns nothing either', async () => {
  const w = world({ runState: 'READY', approvalState: 'DENIED' });
  const outcome: any = await w.decide({ approverId: '' });
  assert.equal(outcome.decided, false);
  assert.equal(outcome.reasonCode, 'APPROVER_REQUIRED');
  assert.doesNotMatch(JSON.stringify(outcome), /DENIED|READY/u);
  assert.equal(w.writes.length, 0);
});

test('the authority is asked, with the approval\'s own operation, before anything is written in the cancelled branch', async () => {
  const w = world({ runState: 'CANCELLED', approvalState: 'PENDING' });
  await w.decide({ approverId: STRANGER });
  assert.ok(w.calls.includes(`mayApprove:${STRANGER}:DISPATCH_WORKER`), w.calls.join(','));
  assert.equal(w.calls.includes('decideApproval'), false);
});

/* ---- what an AUTHORISED approver gets is exactly what it got before ---- */

test('an authorised approver on a CANCELLED run still records CANCELLED and is told RUN_CANCELLED', async () => {
  const w = world({ runState: 'CANCELLED', approvalState: 'PENDING' });
  const outcome: any = await w.decide();
  assert.equal(outcome.decided, false);
  assert.equal(outcome.reasonCode, 'RUN_CANCELLED');
  assert.equal(w.writes.length, 1);
  assert.equal(w.approval().state, 'CANCELLED');
  assert.equal(w.approval().decidedBy, FOUNDER);
});

test('an authorised approver on an already-decided approval is absorbed as a duplicate and the first decision is kept', async () => {
  const w = world({ runState: 'READY', approvalState: 'APPROVED', decidedBy: 'github:first#9' });
  const outcome: any = await w.decide({ decision: 'DENIED' });
  assert.deepEqual(outcome, { decided: true, state: 'APPROVED', runState: 'READY', duplicate: true });
  assert.equal(w.writes.length, 0);
  assert.equal(w.approval().decidedBy, 'github:first#9');
});

test('an authorised grant on a pending approval of a BLOCKED run records APPROVED and moves the run to READY', async () => {
  const w = world({ runState: 'BLOCKED', approvalState: 'PENDING' });
  const outcome: any = await w.decide();
  assert.deepEqual(outcome, { decided: true, state: 'APPROVED', runState: 'READY', duplicate: false });
  assert.equal(w.approval().decidedBy, FOUNDER);
  assert.ok(w.calls.includes('transition:READY'));
});

test('an authorised denial records DENIED and fails the run', async () => {
  const w = world({ runState: 'BLOCKED', approvalState: 'PENDING' });
  const outcome: any = await w.decide({ decision: 'DENIED', reason: 'not this change' });
  assert.deepEqual(outcome, { decided: true, state: 'DENIED', runState: 'FAILED', duplicate: false });
  assert.ok(w.calls.includes('transition:FAILED'));
});

/* ---- what did not change ---- */

test('a live run still refuses a blank identity and a refused identity, and writes nothing', async () => {
  const blank = world({ runState: 'BLOCKED', approvalState: 'PENDING' });
  assert.equal(((await blank.decide({ approverId: ' ' })) as any).reasonCode, 'APPROVER_REQUIRED');
  assert.equal(blank.writes.length, 0);
  const stranger = world({ runState: 'BLOCKED', approvalState: 'PENDING' });
  assert.equal(((await stranger.decide({ approverId: STRANGER })) as any).reasonCode, 'APPROVER_NOT_AUTHORIZED');
  assert.equal(stranger.writes.length, 0);
});

test('RUN_NOT_FOUND and APPROVAL_NOT_FOUND keep their place and meaning, even for an unauthorised caller', async () => {
  const noRun = world({ runState: 'BLOCKED', approvalState: 'PENDING', noRun: true });
  assert.equal(((await noRun.decide({ approverId: STRANGER })) as any).reasonCode, 'RUN_NOT_FOUND');
  const noApproval = world({ runState: 'BLOCKED', approvalState: 'PENDING', noApproval: true });
  assert.equal(((await noApproval.decide({ approverId: STRANGER })) as any).reasonCode, 'APPROVAL_NOT_FOUND');
});
