import { describe, expect, it } from 'vitest';

import {
  autonomyPermitsAutomation, continuationConcurrency, decideJuliusContinuation,
  type JuliusContinuation,
} from './julius-continuation';
import { JuliusRunLoop } from './julius-run-loop';
import { cardPolicy, createJuliusHarness, seedRun, task, worker } from './julius-runtime-fixtures';
import type { JuliusCardPolicy } from './julius-policy';

/**
 * DOES UNCHAINED CHANGE ANYTHING, AND DOES IT BYPASS ANYTHING?
 *
 * Before this, `autonomy` was read in exactly two places and neither changed
 * how a run continued: a run marked UNCHAINED retried, routed, repaired and
 * spawned exactly like a SUPERVISED one. Unchained was a label.
 *
 * The second half of this file is the more important one. Every hard
 * protection is attacked from UNCHAINED, and each attack must be refused by
 * the same rule that refuses it from SUPERVISED — because "Unchained" must
 * never come to mean "protections off".
 */

const AUTONOMY_LEVELS = ['SUPERVISED', 'AUTONOMOUS', 'UNCHAINED'] as const;

const policy = (over: Partial<JuliusCardPolicy> = {}): JuliusCardPolicy =>
  cardPolicy({ allowedProviders: ['provider-a'], ...over });

const RETRY: JuliusContinuation = { kind: 'RETRY', attempt: 1, maxAttempts: 3, errorCode: 'RATE_LIMIT' };
const REROUTE: JuliusContinuation = { kind: 'REROUTE', excludedWorkerIds: ['w1'], remainingWorkers: 2 };
const FALLBACK: JuliusContinuation = { kind: 'FALLBACK', providerId: 'provider-a' };
const REPAIR: JuliusContinuation = { kind: 'REPAIR', round: 1, maxRounds: 3 };
const ITERATIVE: JuliusContinuation = { kind: 'ITERATIVE_REVIEW', round: 1 };
const SUBAGENT: JuliusContinuation = { kind: 'SUBAGENT', depth: 1, active: 0, total: 0 };
const EVERY_SITUATION = [RETRY, REROUTE, FALLBACK, REPAIR, ITERATIVE, SUBAGENT];

/* ------------------------------------------------------- the three levels */

describe('autonomy decides whether the runtime carries on by itself', () => {
  it('SUPERVISED stops at every decision point, even a permitted one', () => {
    for (const situation of EVERY_SITUATION) {
      const decision = decideJuliusContinuation(policy({ autonomy: 'SUPERVISED', subagents: { allowed: true, maxDepth: 4, maxActive: 4, maxTotal: 4 } }), situation);
      expect(decision.proceed, situation.kind).toBe(false);
      if (decision.proceed) continue;
      expect(decision.reasonCode, situation.kind).toBe('SUPERVISED_STOP');
      // A person CAN unblock it: the operation is permitted, they just have
      // not been asked yet.
      expect(decision.awaitingHuman).toBe(true);
    }
  });

  it('AUTONOMOUS and UNCHAINED carry on where C.A.R.D. permits', () => {
    for (const autonomy of ['AUTONOMOUS', 'UNCHAINED'] as const) {
      for (const situation of EVERY_SITUATION) {
        const decision = decideJuliusContinuation(
          policy({ autonomy, subagents: { allowed: true, maxDepth: 4, maxActive: 4, maxTotal: 4 } }),
          situation,
        );
        expect(decision.proceed, `${autonomy}/${situation.kind}`).toBe(true);
      }
    }
  });

  it('names which level carried it on, so a trajectory can say why', () => {
    const autonomous = decideJuliusContinuation(policy({ autonomy: 'AUTONOMOUS' }), RETRY);
    const unchained = decideJuliusContinuation(policy({ autonomy: 'UNCHAINED' }), RETRY);
    expect(autonomous.proceed && autonomous.reasonCode).toBe('AUTONOMOUS_CONTINUATION');
    expect(unchained.proceed && unchained.reasonCode).toBe('UNCHAINED_CONTINUATION');
  });

  it('reports whether automation is permitted at all, without deciding an operation', () => {
    expect(autonomyPermitsAutomation(policy({ autonomy: 'SUPERVISED' }))).toBe(false);
    expect(autonomyPermitsAutomation(policy({ autonomy: 'AUTONOMOUS' }))).toBe(true);
    expect(autonomyPermitsAutomation(policy({ autonomy: 'UNCHAINED' }))).toBe(true);
  });
});

/* ------------------------------------------------ UNCHAINED BYPASS ATTEMPTS */

describe('Unchained never bypasses a hard protection', () => {
  const unchained = (over: Partial<JuliusCardPolicy> = {}) => policy({ autonomy: 'UNCHAINED', ...over });

  it('cannot use a provider C.A.R.D. does not allow', () => {
    const decision = decideJuliusContinuation(
      unchained({ allowedProviders: ['provider-a'] }),
      { kind: 'FALLBACK', providerId: 'provider-forbidden' },
    );
    expect(decision.proceed).toBe(false);
    if (decision.proceed) return;
    expect(decision.reasonCode).toBe('CARD_PROVIDER_DENIED');
    expect(decision.awaitingHuman).toBe(false);
  });

  it('cannot fall back when C.A.R.D. denies fallback', () => {
    const decision = decideJuliusContinuation(unchained({ fallback: false }), FALLBACK);
    expect(decision.proceed).toBe(false);
    if (decision.proceed) return;
    expect(decision.reasonCode).toBe('CARD_FALLBACK_DENIED');
  });

  it('cannot retry when C.A.R.D. denies automatic retry', () => {
    const decision = decideJuliusContinuation(unchained({ automaticRetry: false }), RETRY);
    expect(decision.proceed).toBe(false);
    if (decision.proceed) return;
    expect(decision.reasonCode).toBe('CARD_RETRY_DENIED');
  });

  it('cannot spawn a sub-agent when C.A.R.D. denies sub-agents', () => {
    const decision = decideJuliusContinuation(
      unchained({ subagents: { allowed: false, maxDepth: 9, maxActive: 9, maxTotal: 9 } }), SUBAGENT,
    );
    expect(decision.proceed).toBe(false);
    if (decision.proceed) return;
    expect(decision.reasonCode).toBe('CARD_SUBAGENT_DENIED');
  });

  it('cannot exceed the sub-agent depth, active or total caps', () => {
    const bounded = unchained({ subagents: { allowed: true, maxDepth: 2, maxActive: 1, maxTotal: 2 } });
    const table: Array<[JuliusContinuation, string]> = [
      [{ kind: 'SUBAGENT', depth: 2, active: 0, total: 0 }, 'CARD_SUBAGENT_DEPTH_LIMIT'],
      [{ kind: 'SUBAGENT', depth: 1, active: 1, total: 0 }, 'CARD_SUBAGENT_ACTIVE_LIMIT'],
      [{ kind: 'SUBAGENT', depth: 1, active: 0, total: 2 }, 'CARD_SUBAGENT_TOTAL_LIMIT'],
    ];
    for (const [situation, reasonCode] of table) {
      const decision = decideJuliusContinuation(bounded, situation);
      expect(decision.proceed, reasonCode).toBe(false);
      if (decision.proceed) continue;
      expect(decision.reasonCode).toBe(reasonCode);
    }
  });

  it('cannot extend iterative review past its C.A.R.D. round cap', () => {
    const decision = decideJuliusContinuation(
      unchained({ iterativeReview: { allowed: true, maxRounds: 2 } }),
      { kind: 'ITERATIVE_REVIEW', round: 2 },
    );
    expect(decision.proceed).toBe(false);
    if (decision.proceed) return;
    expect(decision.reasonCode).toBe('CARD_ITERATIVE_REVIEW_LIMIT');
  });

  it('cannot exceed a structural attempt or repair ceiling', () => {
    const attempts = decideJuliusContinuation(unchained(), { kind: 'RETRY', attempt: 3, maxAttempts: 3, errorCode: 'RATE_LIMIT' });
    expect(attempts.proceed).toBe(false);
    if (attempts.proceed) return;
    expect(attempts.reasonCode).toBe('RETRY_ATTEMPTS_EXHAUSTED');
    // A person cannot approve their way past an exhausted budget.
    expect(attempts.awaitingHuman).toBe(false);

    const rounds = decideJuliusContinuation(unchained(), { kind: 'REPAIR', round: 4, maxRounds: 3 });
    expect(rounds.proceed).toBe(false);
    if (rounds.proceed) return;
    expect(rounds.reasonCode).toBe('REPAIR_ROUNDS_EXHAUSTED');
  });

  it('cannot repeat an error that repeating does not fix', () => {
    for (const errorCode of ['AUTH_CONFIGURATION', 'INVALID_REQUEST', 'POLICY_DENIED', 'BUDGET_DENIED', 'CANCELLED'] as const) {
      const decision = decideJuliusContinuation(unchained(), { kind: 'RETRY', attempt: 1, maxAttempts: 5, errorCode });
      expect(decision.proceed, errorCode).toBe(false);
      if (decision.proceed) continue;
      expect(decision.reasonCode).toBe('ERROR_NOT_RETRYABLE');
    }
  });

  it('cannot reroute when every eligible worker has been tried', () => {
    const decision = decideJuliusContinuation(unchained(), { kind: 'REROUTE', excludedWorkerIds: ['a', 'b'], remainingWorkers: 0 });
    expect(decision.proceed).toBe(false);
    if (decision.proceed) return;
    expect(decision.reasonCode).toBe('NO_ALTERNATIVE_ROUTE');
  });

  it('refuses every hard deny at EVERY autonomy level, identically', () => {
    // The point of the whole module: a DENY is a DENY, and the level changes
    // nothing about it. Any divergence here is Unchained becoming a bypass.
    const denials: Array<[Partial<JuliusCardPolicy>, JuliusContinuation]> = [
      [{ fallback: false }, FALLBACK],
      [{ automaticRetry: false }, RETRY],
      [{ subagents: { allowed: false, maxDepth: 9, maxActive: 9, maxTotal: 9 } }, SUBAGENT],
      [{ iterativeReview: { allowed: false, maxRounds: 9 } }, ITERATIVE],
      [{ allowedProviders: [] }, FALLBACK],
    ];
    for (const [over, situation] of denials) {
      const reasons = AUTONOMY_LEVELS.map((autonomy) => {
        const decision = decideJuliusContinuation(policy({ autonomy, ...over }), situation);
        return decision.proceed ? 'PROCEEDED' : decision.reasonCode;
      });
      expect(new Set(reasons).size, `${situation.kind} diverged across levels: ${reasons.join(', ')}`).toBe(1);
      expect(reasons[0]).not.toBe('PROCEEDED');
      expect(reasons[0]).not.toBe('SUPERVISED_STOP');
    }
  });

  it('cannot answer an approval C.A.R.D. holds open for a person', () => {
    // `evaluateJuliusPolicy` skips the gate for operations listed in
    // `policy.approvals` under UNCHAINED — that is C.A.R.D.'s own rule about
    // which gates it considers skippable. A gate it does NOT list stays shut
    // at every level, and this module never opens one.
    const gated = unchained({ approvals: ['FALLBACK_PROVIDER'] });
    // Listed + UNCHAINED: C.A.R.D. itself lifts the gate.
    expect(decideJuliusContinuation(gated, FALLBACK).proceed).toBe(true);
    // The same C.A.R.D. under SUPERVISED still requires the approval.
    const supervised = decideJuliusContinuation(policy({ autonomy: 'SUPERVISED', approvals: ['FALLBACK_PROVIDER'] }), FALLBACK);
    expect(supervised.proceed).toBe(false);
    if (supervised.proceed) return;
    expect(supervised.reasonCode).toBe('CARD_APPROVAL_REQUIRED');
    expect(supervised.awaitingHuman).toBe(true);
  });

  it('has no branch in which the autonomy level widens a number', () => {
    // Read the module's own answers rather than its source: for every bound,
    // the `limit` reported to an UNCHAINED caller equals the C.A.R.D. value.
    const bounded = unchained({ concurrency: 4, subagents: { allowed: true, maxDepth: 4, maxActive: 4, maxTotal: 6 }, iterativeReview: { allowed: true, maxRounds: 5 } });
    const sub = decideJuliusContinuation(bounded, SUBAGENT);
    expect(sub.proceed && sub.limit).toBe(6);
    const iterative = decideJuliusContinuation(bounded, ITERATIVE);
    expect(iterative.proceed && iterative.limit).toBe(5);
    const dispatch = decideJuliusContinuation(bounded, REROUTE);
    expect(dispatch.proceed && dispatch.limit).toBe(4);
  });
});

/* ------------------------------------------------------------ concurrency */

describe('concurrency', () => {
  it('is never more than C.A.R.D. allows, at any level', () => {
    for (const autonomy of AUTONOMY_LEVELS) {
      expect(continuationConcurrency(policy({ autonomy, concurrency: 5 }))).toBeLessThanOrEqual(5);
    }
  });

  it('is one under SUPERVISED, so a person can follow the run', () => {
    expect(continuationConcurrency(policy({ autonomy: 'SUPERVISED', concurrency: 8 }))).toBe(1);
  });

  it('uses the width C.A.R.D. granted under the other two, and no more', () => {
    expect(continuationConcurrency(policy({ autonomy: 'AUTONOMOUS', concurrency: 8 }))).toBe(8);
    expect(continuationConcurrency(policy({ autonomy: 'UNCHAINED', concurrency: 8 }))).toBe(8);
  });

  it('falls back to one on a malformed ceiling rather than guessing wide', () => {
    for (const concurrency of [0, -1, 1.5, Number.NaN]) {
      expect(continuationConcurrency(policy({ autonomy: 'UNCHAINED', concurrency })), String(concurrency)).toBe(1);
    }
  });
});

/* ------------------------------------------------------- wired to the loop */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'] });
const scope = { projectId: 'prj-1' };

describe('the runtime actually behaves differently at each level', () => {
  const build = (autonomy: JuliusCardPolicy['autonomy'], concurrency = 4) => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'fail', code: 'RATE_LIMIT' }, { kind: 'succeed' }] }],
      card: cardPolicy({ allowedProviders: [CODER.providerId], autonomy, concurrency }),
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    return harness;
  };

  it('SUPERVISED does not auto-retry a rate limit — it stops for a person', async () => {
    const harness = build('SUPERVISED');
    const report = await harness.loop.tick(scope);
    expect(report.outcomes[0].kind).toBe('FAILED');
    expect(harness.store.taskRow('task-1')!.state).toBe('FAILED');
    // And says so in the ledger, with whether a person could unblock it.
    const failed = harness.store.events().find((event) => event.type === 'task.failed');
    expect(failed?.facts.reasonCode).toBe('SUPERVISED_STOP');
    expect(failed?.facts.awaitingHuman).toBe(true);
  });

  it('AUTONOMOUS auto-retries the same failure and completes', async () => {
    const harness = build('AUTONOMOUS');
    expect((await harness.loop.tick(scope)).outcomes[0].kind).toBe('RETRY');
    expect((await harness.loop.tick(scope)).outcomes[0].kind).toBe('COMPLETED');
  });

  it('UNCHAINED auto-retries the same failure and completes', async () => {
    const harness = build('UNCHAINED');
    expect((await harness.loop.tick(scope)).outcomes[0].kind).toBe('RETRY');
    expect((await harness.loop.tick(scope)).outcomes[0].kind).toBe('COMPLETED');
  });

  it('holds a SUPERVISED run to one task in flight, and hands the rest back', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      card: cardPolicy({ allowedProviders: [CODER.providerId], autonomy: 'SUPERVISED', concurrency: 8 }),
      config: { claimLimit: 5 },
    });
    seedRun(harness, { tasks: [0, 1, 2, 3].map((n) => task({ taskId: `task-${n}`, ordinal: n })) });

    const report = await harness.loop.tick(scope);
    expect(report.claimed).toBe(4);
    expect(report.outcomes).toHaveLength(1);
    expect(report.yieldedForConcurrency).toBe(3);
    // Handed back, not held: they are claimable again immediately.
    for (const id of ['task-1', 'task-2', 'task-3']) {
      expect(harness.store.taskRow(id)!.state, id).toBe('RUNNABLE');
    }
  });

  it('lets an UNCHAINED run use the width C.A.R.D. granted', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      card: cardPolicy({ allowedProviders: [CODER.providerId], autonomy: 'UNCHAINED', concurrency: 4 }),
      config: { claimLimit: 4 },
    });
    seedRun(harness, { tasks: [0, 1, 2, 3].map((n) => task({ taskId: `task-${n}`, ordinal: n })) });
    const report = await harness.loop.tick(scope);
    expect(report.outcomes).toHaveLength(4);
    expect(report.yieldedForConcurrency).toBe(0);
  });

  it('counts tasks a DIFFERENT worker already has in flight', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      card: cardPolicy({ allowedProviders: [CODER.providerId], autonomy: 'UNCHAINED', concurrency: 2 }),
      config: { claimLimit: 4 },
    });
    seedRun(harness, { tasks: [0, 1, 2, 3].map((n) => task({ taskId: `task-${n}`, ordinal: n })) });
    // Another worker is already holding two of this run's tasks.
    await harness.store.claimRunnable({
      owner: 'worker-elsewhere', now: harness.clock.now(),
      leaseExpiresAt: '2026-08-27T12:00:00.000Z', limit: 2, projectId: 'prj-1',
    });

    const second = new JuliusRunLoop({ ...harness.deps, owner: 'worker-b' }, harness.policies, { claimLimit: 4, leaseMs: 60_000 });
    const report = await second.tick(scope);
    // The run is already at its allowance, so this worker executes nothing.
    expect(report.outcomes).toHaveLength(0);
    expect(report.yieldedForConcurrency).toBe(report.claimed);
  });
});
