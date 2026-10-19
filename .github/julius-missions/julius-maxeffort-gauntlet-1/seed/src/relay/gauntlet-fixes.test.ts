import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activateGauntlet, advanceGauntletCommand, cancelGauntlet, gauntletWorkId, openNextGauntletRound,
} from './mission/gauntlet/gauntlet-command.ts';
import { createGauntletMemoryStore } from './mission/gauntlet/gauntlet-memory-store.ts';

/**
 * THREE LATENT DEFECTS IN THE /gauntletloop COMMAND CONTROLLER: THE SPECIFICATION.
 *
 * The controller is real Relay code with documented intent. `advanceGauntletCommand` and `openNextGauntletRound` already treat a lost compare-and-set on `save` by RELOADING
 * the stored gauntlet and reporting what is stored; `GauntletStore.save` is documented as a compare-and-set on `version`. The tests pin the main behaviour of each fix; the acceptance
 * criteria in the contract state the wider invariants in words.
 *
 *   A. ACCOUNTING. The machine ADDS the usage it is given to the gauntlet's running totals, but the controller hands it the SUM of every phase already settled in the round, so
 *      the earlier phases of a round are counted again each time a later phase settles. A gauntlet halts on a spend or duration it never incurred.
 *   B. CANCEL. `cancelGauntlet` ignores the result of its own compare-and-set. If another writer moved the gauntlet on first, it still cancels the outstanding work and reports
 *      CANCELLED, although the stored gauntlet is not.
 *   C. ACTIVATE. `activateGauntlet` ignores the result of the compare-and-set that records the first round. If it loses, it still requests that round's work and reports a freshly
 *      started gauntlet at round 1 that is not what is stored.
 */

const LIMITS = { maxRounds: 6, maxRetries: 6, maxDurationMs: 1_000, maxUsdMicros: 250 };
const POLICY = { allowed: true, maxRounds: 6, requiresApproval: false };

const harness = (store = createGauntletMemoryStore()) => {
  /** Work ids requested, once each: the real work port is idempotent by the deterministic work id, so is this one. */
  const requested: string[] = [];
  const cancelled: string[] = [];
  /** A work id whose NEXT request throws: the process died after the state was saved and before this work was requested. */
  const crash: { on: string | null } = { on: null };
  let n = 0;
  const deps = {
    store,
    work: {
      requestWork: async (w: { workId: string }) => {
        if (crash.on === w.workId) { crash.on = null; throw new Error('PROCESS DIED'); }
        if (!requested.includes(w.workId)) requested.push(w.workId);
        return true;
      },
      cancelWork: async (id: string) => { cancelled.push(id); return true; },
      workOutcome: async () => null,
    },
    reviewer: { review: async () => ({ completed: true, blockingFindings: 0, findingIds: [], safeSummary: '' }) },
    clock: { now: () => '2026-10-19T00:00:00.000Z' },
    ids: { next: (kind: string) => `${kind}-${++n}` },
  };
  return { store, deps: deps as never, requested, cancelled, crash };
};

const COMMAND = {
  runId: 'run-1', projectId: 'prj-1', gauntletId: 'g1', subjectId: 'subject-1', activatedBy: 'founder', limits: LIMITS, policy: POLICY,
} as never;
const step = (phase: 'REVIEW' | 'REPAIR', usage: { durationMs: number; usdMicros: number }, blockingFindings = 1) => ({
  runId: 'run-1', gauntletId: 'g1', phase, usage,
  ...(phase === 'REVIEW' ? { review: { blockingFindings, findingIds: blockingFindings > 0 ? ['f1'] : [] } } : {}),
}) as never;
const stored = async (store: ReturnType<typeof createGauntletMemoryStore>) => (await store.load('run-1', 'g1'))!;
const out = (value: unknown) => value as Record<string, unknown> & { record?: Record<string, unknown> };

/* ---------------------------------------------------------------------------------------------------------------------------------- A: exact accounting */

test('A: control: the first phase of a gauntlet is counted once, and a review that clears clears', async () => {
  const h = harness();
  await activateGauntlet(COMMAND, h.deps);
  const r = out(await advanceGauntletCommand(step('REVIEW', { durationMs: 100, usdMicros: 100 }, 0), h.deps));
  assert.equal(r.state, 'CLEARED');
  assert.equal((await stored(h.store)).usedUsdMicros, 100);
});

test('A: the totals are the sum of every reported usage, each counted exactly once, across reviews, repairs and rounds', async () => {
  const h = harness();
  await activateGauntlet(COMMAND, h.deps);
  await advanceGauntletCommand(step('REVIEW', { durationMs: 100, usdMicros: 100 }), h.deps);
  assert.equal((await stored(h.store)).usedUsdMicros, 100);
  await advanceGauntletCommand(step('REPAIR', { durationMs: 50, usdMicros: 50 }), h.deps);
  let g = await stored(h.store);
  assert.deepEqual([g.usedUsdMicros, g.usedDurationMs, g.state], [150, 150, 'READY']);
  await openNextGauntletRound({ runId: 'run-1', gauntletId: 'g1' }, h.deps);
  await advanceGauntletCommand(step('REVIEW', { durationMs: 60, usdMicros: 60 }), h.deps);
  g = await stored(h.store);
  assert.deepEqual([g.usedUsdMicros, g.usedDurationMs, g.state, g.haltReason], [210, 210, 'REPAIRING', null], 'real spend is 210 of 250: the gauntlet continues');
});

test('A: a gauntlet halts when the REAL total passes the ceiling, and not before', async () => {
  const h = harness();
  await activateGauntlet(COMMAND, h.deps);
  await advanceGauntletCommand(step('REVIEW', { durationMs: 10, usdMicros: 100 }), h.deps);
  await advanceGauntletCommand(step('REPAIR', { durationMs: 10, usdMicros: 50 }), h.deps);
  await openNextGauntletRound({ runId: 'run-1', gauntletId: 'g1' }, h.deps);
  await advanceGauntletCommand(step('REVIEW', { durationMs: 10, usdMicros: 60 }), h.deps);
  await advanceGauntletCommand(step('REPAIR', { durationMs: 10, usdMicros: 40 }), h.deps);
  let g = await stored(h.store);
  assert.deepEqual([g.usedUsdMicros, g.state, g.haltReason], [250, 'READY', null], 'exactly at the ceiling is not over it');
  await openNextGauntletRound({ runId: 'run-1', gauntletId: 'g1' }, h.deps);
  const last = out(await advanceGauntletCommand(step('REVIEW', { durationMs: 10, usdMicros: 1 }), h.deps));
  g = await stored(h.store);
  assert.deepEqual([g.usedUsdMicros, g.state, g.haltReason, last.haltReason], [251, 'HALTED', 'budget_limit', 'budget_limit']);
});

test('A: the duration ceiling is counted the same way, and the per-phase rows keep each phase\'s own usage', async () => {
  const h = harness();
  await activateGauntlet(COMMAND, h.deps);
  await advanceGauntletCommand(step('REVIEW', { durationMs: 400, usdMicros: 1 }), h.deps);
  await advanceGauntletCommand(step('REPAIR', { durationMs: 300, usdMicros: 1 }), h.deps);
  await openNextGauntletRound({ runId: 'run-1', gauntletId: 'g1' }, h.deps);
  await advanceGauntletCommand(step('REVIEW', { durationMs: 250, usdMicros: 1 }), h.deps);
  const g = await stored(h.store);
  assert.deepEqual([g.usedDurationMs, g.state], [950, 'REPAIRING'], '400 + 300 + 250 is 950 of 1000');
  const rows = await h.store.roundsFor('g1');
  const settled = rows.filter((r) => r.durationMs !== null).map((r) => [r.round, r.phase, r.durationMs, r.usdMicros]);
  assert.deepEqual(settled, [[1, 'REPAIR', 300, 1], [1, 'REVIEW', 400, 1], [2, 'REVIEW', 250, 1]], 'settled rows keep their own usage');
});

/* ---------------------------------------------------------------------------------------------------------------------------------------- B: cancel */

/** A store whose NEXT save first lets a competing writer move the stored gauntlet on, so that the caller's compare-and-set loses. */
const racing = (base: ReturnType<typeof createGauntletMemoryStore>, compete: (cur: Record<string, unknown>) => Record<string, unknown>) => {
  let armed = true;
  return {
    ...base,
    save: async (record: never, expectedVersion: number) => {
      if (armed) {
        armed = false;
        const cur = (await base.load('run-1', 'g1')) as unknown as Record<string, unknown>;
        await base.save({ ...compete(cur), version: (cur.version as number) + 1 } as never, cur.version as number);
      }
      return base.save(record, expectedVersion);
    },
  } as ReturnType<typeof createGauntletMemoryStore>;
};

test('B: control: cancelling an active gauntlet cancels only its outstanding work and reports CANCELLED', async () => {
  const h = harness();
  await activateGauntlet(COMMAND, h.deps);
  await advanceGauntletCommand(step('REVIEW', { durationMs: 1, usdMicros: 1 }), h.deps);
  const r = out(await cancelGauntlet({ runId: 'run-1', gauntletId: 'g1', actor: 'founder', reason: 'stop' }, h.deps));
  assert.deepEqual([r.advanced, r.activation], [true, 'CANCELLED']);
  assert.deepEqual(h.cancelled, [gauntletWorkId('g1', 1, 'REPAIR')], 'the completed review is not cancelled; the outstanding repair is');
  assert.equal((await stored(h.store)).activation, 'CANCELLED');
});

test('B: a cancel that loses the race to another writer cancels NOTHING and does not claim CANCELLED', async () => {
  const base = createGauntletMemoryStore();
  const h = harness(base);
  await activateGauntlet(COMMAND, h.deps);
  const competing = racing(base, (cur) => ({ ...cur, state: 'CLEARED', activation: 'CLEARED' }));
  const r = out(await cancelGauntlet({ runId: 'run-1', gauntletId: 'g1', actor: 'founder', reason: 'stop' }, { ...(h.deps as object), store: competing } as never));
  const now = await stored(base);
  assert.deepEqual([now.state, now.activation], ['CLEARED', 'CLEARED'], 'the stored gauntlet is the competing writer\'s');
  assert.deepEqual(h.cancelled, [], 'the work of a gauntlet that was not cancelled is not cancelled');
  assert.equal(r.activation === 'CANCELLED', false, 'the outcome does not say CANCELLED');
  assert.ok(r.advanced === false ? typeof r.reasonCode === 'string' : r.activation === 'CLEARED', 'either a refusal with a reason code, or the stored truth');
});

/* ---------------------------------------------------------------------------------------------------------------------------------------- C: activate */

test('C: control: a first activation requests the first review once and a second one resumes', async () => {
  const h = harness();
  const first = out(await activateGauntlet(COMMAND, h.deps));
  assert.deepEqual([first.activated, first.resumed, first.firstWorkId], [true, false, gauntletWorkId('g1', 1, 'REVIEW')]);
  assert.deepEqual(h.requested, [gauntletWorkId('g1', 1, 'REVIEW')]);
  const second = out(await activateGauntlet(COMMAND, h.deps));
  assert.deepEqual([second.activated, second.resumed], [true, true]);
  assert.equal(h.requested.length, 1, 'resuming requests nothing');
});

test('C: an activation whose first-round save loses the race requests NO work and does not report a fresh round 1', async () => {
  const base = createGauntletMemoryStore();
  const h = harness(base);
  const competing = racing(base, (cur) => ({ ...cur, state: 'RUNNING', round: 1 }));
  const r = out(await activateGauntlet(COMMAND, { ...(h.deps as object), store: competing } as never));
  const now = await stored(base);
  assert.deepEqual([now.state, now.round], ['RUNNING', 1], 'the stored gauntlet is the competing writer\'s');
  assert.deepEqual(h.requested, [], 'the loser requests no work for a round it did not start');
  assert.equal((await base.roundsFor('g1')).length, 0, 'and records no round row');
  assert.ok(r.activated === false ? typeof r.reasonCode === 'string' : r.resumed === true && r.record?.round === 1 && r.record?.state === 'RUNNING', 'either a refusal with a reason code, or the stored truth as a resume');
});

/* ------------------------------------------------------------------------------------------------------------------------ D: a crash loses nothing */

/**
 * The controller's header: "A gauntlet that runs ten rounds does so across ten calls, and a process that dies between any two of them loses nothing." Work ids are deterministic
 * and the work port is idempotent by id, so a step may be REDELIVERED. A crash between a state change and the request of the successor work must not strand the gauntlet.
 */
const settleInput = (phase: 'REVIEW' | 'REPAIR', blockingFindings = 1) => step(phase, { durationMs: 1, usdMicros: 10 }, blockingFindings);
const rowsOf = async (store: ReturnType<typeof createGauntletMemoryStore>, round: number, phase: string) => (await store.roundsFor('g1')).filter((r) => r.round === round && r.phase === phase);

test('D: a settlement redelivered after a crash BEFORE its successor was requested schedules the successor, once, and counts the usage once', async () => {
  const h = harness();
  await activateGauntlet(COMMAND, h.deps);
  h.crash.on = gauntletWorkId('g1', 1, 'REPAIR');
  await assert.rejects(advanceGauntletCommand(settleInput('REVIEW'), h.deps), /PROCESS DIED/);
  const again = out(await advanceGauntletCommand(settleInput('REVIEW'), h.deps));
  assert.equal(again.advanced, true, 'a redelivery is an ordinary event, not an alarm');
  const g = await stored(h.store);
  assert.deepEqual([g.state, g.round, g.usedUsdMicros, g.usedDurationMs], ['REPAIRING', 1, 10, 1], 'repairing, and the usage counted exactly once');
  assert.ok(h.requested.includes(gauntletWorkId('g1', 1, 'REPAIR')), 'the repair work was requested');
  assert.equal((await rowsOf(h.store, 1, 'REPAIR')).length, 1, 'one repair row');
  assert.equal((await rowsOf(h.store, 1, 'REVIEW')).length, 1, 'one review row');
});

test('D: a settlement redelivered AFTER everything succeeded changes nothing and is not an error', async () => {
  const h = harness();
  await activateGauntlet(COMMAND, h.deps);
  await advanceGauntletCommand(settleInput('REVIEW'), h.deps);
  const before = { g: await stored(h.store), requested: [...h.requested], rows: (await h.store.roundsFor('g1')).length };
  const again = out(await advanceGauntletCommand(settleInput('REVIEW'), h.deps));
  assert.equal(again.advanced, true);
  const after = await stored(h.store);
  assert.deepEqual([after.state, after.round, after.usedUsdMicros, after.usedDurationMs, after.version], [before.g.state, before.g.round, before.g.usedUsdMicros, before.g.usedDurationMs, before.g.version], 'nothing about the stored gauntlet moved');
  assert.deepEqual(h.requested, before.requested, 'no new work');
  assert.equal((await h.store.roundsFor('g1')).length, before.rows, 'no new rows');
});

test('D: opening the next round after a crash BEFORE its review was requested requests that review on the retry', async () => {
  const h = harness();
  await activateGauntlet(COMMAND, h.deps);
  await advanceGauntletCommand(settleInput('REVIEW'), h.deps);
  await advanceGauntletCommand(settleInput('REPAIR'), h.deps);
  h.crash.on = gauntletWorkId('g1', 2, 'REVIEW');
  await assert.rejects(openNextGauntletRound({ runId: 'run-1', gauntletId: 'g1' }, h.deps), /PROCESS DIED/);
  const again = out(await openNextGauntletRound({ runId: 'run-1', gauntletId: 'g1' }, h.deps));
  assert.equal(again.advanced, true);
  const g = await stored(h.store);
  assert.deepEqual([g.state, g.round], ['RUNNING', 2], 'the round was opened once, not twice');
  assert.ok(h.requested.includes(gauntletWorkId('g1', 2, 'REVIEW')), 'the round 2 review was requested');
  assert.equal((await rowsOf(h.store, 2, 'REVIEW')).length, 1, 'one row for it');
});

test('D: a second /gauntletloop after a crash BEFORE the first review was requested requests it, and does not start a second gauntlet', async () => {
  const h = harness();
  h.crash.on = gauntletWorkId('g1', 1, 'REVIEW');
  await assert.rejects(activateGauntlet(COMMAND, h.deps), /PROCESS DIED/);
  const resumed = out(await activateGauntlet(COMMAND, h.deps));
  assert.deepEqual([resumed.activated, resumed.resumed], [true, true]);
  assert.ok(h.requested.includes(gauntletWorkId('g1', 1, 'REVIEW')), 'the first review was requested by the resume');
  assert.equal(h.store.all().length, 1, 'one gauntlet');
  assert.equal((await rowsOf(h.store, 1, 'REVIEW')).length, 1, 'one row for the first review');
});

test('D: control: recovery does not request work that no state implies (a cleared gauntlet, a gauntlet waiting for its repair to settle)', async () => {
  const h = harness();
  await activateGauntlet(COMMAND, h.deps);
  await advanceGauntletCommand(settleInput('REVIEW', 0), h.deps);
  const cleared = [...h.requested];
  await activateGauntlet(COMMAND, h.deps);
  await openNextGauntletRound({ runId: 'run-1', gauntletId: 'g1' }, h.deps);
  assert.deepEqual(h.requested, cleared, 'a cleared gauntlet schedules nothing, on resume or on open');
});
