import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_ANALYTICAL_MODEL, MAX_REVIEWER_ATTEMPTS, MEASURED_ENGINE_STARTUP_MS,
  RECORDED_REVIEWER_OBSERVATIONS, REVIEWER_JOB_SHARE_MS, REVIEWER_REQUEST_TIMEOUT_SECONDS,
  impliedRequestsPerReview, resolveReviewerDeadline,
} from './reviewer-deadline';
import {
  JULIUS_NORMAL_REVIEW_STAGES, JULIUS_REVIEW_STAGES, REVIEW_TASK_ATTEMPTS,
  decideJuliusContinuation, planJuliusRepair, repairTaskTypeFor,
} from '../src/relay/mission/julius';
import { MAX_TASK_ATTEMPTS, taskAttemptCeiling } from '../src/relay/mission/julius/julius-task-pipeline';
import type { JuliusCardPolicy } from '../src/relay/mission/julius';

/**
 * THE REVIEWER'S ENVELOPE, AFTER THREE CONSTANTS STOPPED AGREEING WITH REALITY.
 *
 * The deadline policy was passing on three understatements, each of which kept
 * the next one invisible:
 *
 *   requestsPerReview: 2      Mission 4's review COMPLETED in 381 880 ms at
 *                             90 s per request with `api_max_retries: 0` and no
 *                             toolset. Two requests cover at most 198 000 ms.
 *   MAX_REVIEWER_ATTEMPTS: 6  Enforced by nothing — the real ceiling was
 *                             `MAX_TASK_ATTEMPTS` — and written for the two
 *                             review stages that existed at the time. There are
 *                             six registered stages now.
 *   basis: OBSERVED_CENSORED  Only because the analytical number (360 000) sat
 *                             BELOW the 400 093 ms high water, so it never bound
 *                             anything and its error never surfaced.
 *
 * Both numbers are now derived: the request count from the durations we have
 * watched, the attempt ceiling from what the pipeline actually grants. And the
 * pipeline grants a review ONE attempt, because the reviewer's failure mode is
 * a request that outran the engine's own per-request deadline and repeating it
 * verbatim reaches the same wall.
 *
 * WHAT IS NOT REDUCED — and section 8 is only about this — is the review. One
 * attempt is a whole review: the full deadline (which went UP), the bounded
 * in-adapter correction, every stage the reviewer serves, and its evidence.
 */

const ROOT = process.cwd();
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const policy: JuliusCardPolicy = {
  revision: 'card', autonomy: 'AUTONOMOUS', allowedProviders: ['xai'], capabilities: ['review'],
  network: false, filesystemMutation: false, fallback: false, automaticRetry: true,
  subagents: { allowed: false, maxDepth: 0, maxActive: 0, maxTotal: 0 },
  iterativeReview: { allowed: true, maxRounds: 2 }, concurrency: 1, approvals: [],
};

/** What the pipeline asks of the continuation for a task on its Nth attempt. */
const carryOn = (taskType: string, attempt: number, errorCode = 'TIMEOUT') =>
  decideJuliusContinuation(policy, {
    kind: 'RETRY', attempt, maxAttempts: taskAttemptCeiling(taskType),
    errorCode: errorCode as never,
  });

describe('1–2 · one pipeline attempt per review stage, and three across the run', () => {
  it('1 · every review stage gets exactly one, and no other task type is touched', () => {
    for (const stage of JULIUS_REVIEW_STAGES) {
      expect(taskAttemptCeiling(`review:${stage}`), `review:${stage}`).toBe(1);
      // And the first attempt is the last: a second is refused as exhausted,
      // which is the enforcement, not a preference.
      expect(carryOn(`review:${stage}`, 1).proceed, `review:${stage} must not repeat`).toBe(false);
      expect(carryOn(`review:${stage}`, 1).reasonCode).toBe('RETRY_ATTEMPTS_EXHAUSTED');
    }
    // Everything that is NOT a review keeps the generic ceiling untouched.
    for (const other of ['plan', 'implementation', 'repair:build', 'guidance']) {
      expect(taskAttemptCeiling(other), other).toBe(MAX_TASK_ATTEMPTS);
      expect(carryOn(other, 1).proceed, `${other} still retries`).toBe(true);
    }
    // AND THE PIPELINE ASKS. A ceiling proven in isolation and unreachable from
    // the dispatch path is exactly the arrangement `MAX_REVIEWER_ATTEMPTS` was.
    const pipeline = read('src/relay/mission/julius/julius-task-pipeline.ts');
    expect(pipeline).toContain('maxAttempts: taskAttemptCeiling(claim.taskType)');
    expect(pipeline, 'the generic ceiling must not be handed to a review again')
      .not.toContain('maxAttempts: MAX_TASK_ATTEMPTS');
  });

  it('2 · the normal non-repair path consumes exactly three reviewer attempts', () => {
    expect(JULIUS_NORMAL_REVIEW_STAGES).toEqual(['plan', 'build', 'guidance']);
    const spent = JULIUS_NORMAL_REVIEW_STAGES
      .map(stage => taskAttemptCeiling(`review:${stage}`))
      .reduce((total, each) => total + each, 0);
    expect(spent).toBe(3);
    // And that is the number the budget is computed from — the same value, not
    // a second one that happens to match.
    expect(MAX_REVIEWER_ATTEMPTS).toBe(spent);
  });
});

describe('3–4 · a repair is a new task, and disagreement is not failure', () => {
  it('3 · a repair is minted as its own task with its own parent, not a further attempt', () => {
    const original = {
      taskId: 'run:m:build:review', missionId: 'mission', parentTaskId: null, dependencyIds: [],
      requiredEvidenceTypes: ['REVIEW_FINDING' as const], taskType: 'review:build',
      role: 'INDEPENDENT_REVIEWER' as const, ordinal: 3, state: 'ACTIVE' as const,
    };
    const plan = planJuliusRepair({
      runId: 'run', originalTask: original,
      decision: { action: 'REPAIR', evidenceIds: ['e1'] } as never,
      findings: [{
        findingId: 'f1', taskId: original.taskId, blocking: true, status: 'OPEN',
        evidenceIds: ['e1'],
      }] as never,
      priorRounds: 0,
      policy: { maxRepairRounds: 2 } as never,
      budgetReservationId: 'res-1', now: '2026-09-11T20:00:00.000Z',
    });
    expect(plan.task.taskId, 'a NEW task id, not the review it followed').not.toBe(original.taskId);
    expect(plan.task.parentTaskId, 'lineage is recorded, not collapsed').toBe(original.taskId);
    expect(plan.task.taskType).toBe(repairTaskTypeFor(original.taskType));
    expect(plan.round).toBe(1);
    // A new task starts a new attempt counter, which is the whole distinction:
    // a repair round is not a retry of the review that asked for it.
    expect(plan.task.state).toBe('RUNNABLE');
  });

  it('4 · a reviewer that asks for changes has REVIEWED — it is not a dispatch failure', () => {
    // `changes_required` is the codebase's word for CHALLENGE / REPAIR_REQUIRED
    // / BLOCK: a substantive verdict about the work. The adapter returns
    // SUCCEEDED with failing evidence, so Julius routes a repair from the
    // evidence rather than retrying the review.
    const adapter = read('relay-bridge/julius/live-workers.ts');
    const reviewReturn = /const reviewUsage: HermesUsage[\s\S]{0,2000}?status: 'SUCCEEDED',/u.exec(adapter);
    expect(reviewReturn, 'the reviewer success return must be findable').not.toBeNull();
    // The only verdict that is NOT a review is the one that says so.
    expect(adapter).toContain("outcome.result.verdict === 'unable_to_review'");
    expect(adapter).toContain("'Hermes was unable to review the change.', 'reviewer_unable_to_review'");
    // And a non-approved verdict drives the repair path rather than parking the
    // run on inconclusive evidence.
    expect(adapter).toContain("blocking.length === 0 && outcome.result.verdict === 'approved'");
  });
});

describe('5 · a deterministic failure does not repeat itself', () => {
  it('5 · a review that timed out is not automatically dispatched again', () => {
    // The reviewer's observed failure is a request that outran the engine's own
    // per-request deadline. The packet, the prompt, the engine and the deadline
    // are identical on a second attempt, so it reaches the same wall — and
    // spends the job's reviewer share doing it. TIMEOUT is still classified
    // retryable, which is true of the ERROR; what changed is that the review
    // has no second attempt to spend on it.
    expect(carryOn('review:plan', 1, 'TIMEOUT').proceed).toBe(false);
    expect(carryOn('review:plan', 1, 'PROVIDER_UNAVAILABLE').proceed).toBe(false);
    expect(carryOn('review:plan', 1, 'RATE_LIMIT').proceed).toBe(false);
    // A non-retryable code was already refused, and still is, for its own reason.
    expect(carryOn('review:plan', 1, 'AUTH_CONFIGURATION').reasonCode).toBe('RETRY_ATTEMPTS_EXHAUSTED');
    // Transient noise remains the adapter's business, INSIDE this one deadline:
    // the reviewer keeps its bounded in-adapter correction.
    expect(read('relay-bridge/julius/live-workers.ts')).toContain('const REVIEW_ATTEMPT_LIMIT = 2;');
  });
});

describe('6–7 · the share admits the normal path, and the constant is the enforced one', () => {
  it('6 · the corrected deadline fits three attempts inside the 50-minute share', () => {
    const deadline = resolveReviewerDeadline();
    // 756 000 at a 90 s request; 792 000 since the tool-less reviewer's request
    // became 480 s (paid qualification 34753589938): 1 request x 480 s + 180 s
    // overhead = 660 000, plus 20% headroom.
    expect(deadline.operativeTimeoutMs).toBe(792_000);
    expect(deadline.hardCeilingMs).toBe(Math.floor(REVIEWER_JOB_SHARE_MS / MAX_REVIEWER_ATTEMPTS));
    expect(deadline.operativeTimeoutMs).toBeLessThanOrEqual(deadline.hardCeilingMs);
    // The whole normal review path, worst case, against the share it is given.
    expect(deadline.worstCaseReviewerSpendMs).toBe(792_000 * 3);
    expect(deadline.worstCaseReviewerSpendMs).toBeLessThanOrEqual(REVIEWER_JOB_SHARE_MS);
    // And it went UP: the old 480 112 ms was affordable only because the model
    // under it was wrong.
    expect(deadline.operativeTimeoutMs).toBeGreaterThan(480_112);
  });

  it('7 · both constants are derived, and the engine guard reads the derivation', () => {
    // The request count comes from what we watched, AT THE REQUEST SIZE IN FORCE…
    expect(impliedRequestsPerReview()).toBe(1);
    expect(impliedRequestsPerReview(90), 'at the old 90 s request the same observations implied five').toBe(5);
    expect(DEFAULT_ANALYTICAL_MODEL.requestsPerReview).toBe(impliedRequestsPerReview());
    // …and ONE request at that size holds every review ever watched, the one
    // cut off still running included: a tool-less review is one request, and
    // the cap no longer ends a review that is merely long.
    const completed = RECORDED_REVIEWER_OBSERVATIONS.find(o => o.elapsedMs === 381_880)!;
    expect(completed.outcome).toBe('COMPLETED');
    for (const observation of RECORDED_REVIEWER_OBSERVATIONS) {
      expect(MEASURED_ENGINE_STARTUP_MS + REVIEWER_REQUEST_TIMEOUT_SECONDS * 1000, `${observation.elapsedMs} ms`)
        .toBeGreaterThanOrEqual(observation.elapsedMs);
    }

    // The attempt ceiling comes from what the pipeline enforces.
    expect(MAX_REVIEWER_ATTEMPTS).toBe(JULIUS_NORMAL_REVIEW_STAGES.length * REVIEW_TASK_ATTEMPTS);
    const source = read('relay-bridge/reviewer-deadline.ts');
    expect(source, 'the attempt ceiling must not be a literal again')
      .toContain('JULIUS_NORMAL_REVIEW_STAGES.length * REVIEW_TASK_ATTEMPTS');
    expect(source).not.toMatch(/MAX_REVIEWER_ATTEMPTS\s*=\s*[0-9]/u);

    // And the bootstrap bounds the engine with the same number rather than a
    // `x 2` of its own, which is what made its ordering check pass on margin
    // that did not exist.
    const bootstrap = read('.github/julius-live-hermes.sh');
    expect(bootstrap).toContain('requests_per_review="$(node scripts/julius-reviewer-deadline.mjs requestsPerReview)"');
    expect(bootstrap).not.toMatch(/HERMES_REQUEST_TIMEOUT_SECONDS \* 2 \* 1000/u);

    // THE MIRROR AND THE ORIGINAL AGREE ON A PARAMETERISED CALL, not only on
    // the default one. The mirror took `(model, observations, headroomRatio)`
    // positionally while the TypeScript took one object, and the parity test
    // compared only the no-argument output — so they agreed on the single call
    // nobody parameterises and diverged on every other.
    const emitted = JSON.parse(execFileSync(
      process.execPath,
      ['--input-type=module', '-e', [
        `const m = await import(${JSON.stringify(join(ROOT, 'scripts/julius-reviewer-deadline.mjs'))});`,
        'process.stdout.write(JSON.stringify(m.resolveReviewerDeadline({ headroomRatio: 0.5 })));',
      ].join('')],
      { encoding: 'utf8' },
    )) as Record<string, unknown>;
    expect(emitted).toEqual(resolveReviewerDeadline({ headroomRatio: 0.5 }));
  });
});

describe('8 · the review itself is not made smaller to fit', () => {
  it('8 · every stage, the bounded correction, and a LONGER deadline all survive', () => {
    // The envelope was corrected by telling the truth about the engine, not by
    // asking the reviewer for less. Each of these would be a way to make the
    // arithmetic fit by reducing the work, and none of them is taken.
    const composition = read('relay-bridge/julius/live-composition.ts');
    for (const stage of JULIUS_REVIEW_STAGES) {
      expect(composition, `the reviewer must still serve review:${stage}`).toContain(`'review:${stage}'`);
    }
    // The deadline each review gets went UP by more than half.
    expect(resolveReviewerDeadline().operativeTimeoutMs / 480_112).toBeGreaterThan(1.5);
    // The engine's per-request room went UP, not down: a tool-less review is one
    // request that reasons and writes the whole verdict, and 90 s was sized for a
    // loop of short tool calls. The reviewer keeps its in-adapter correction.
    expect(REVIEWER_REQUEST_TIMEOUT_SECONDS).toBe(480);
    expect(read('relay-bridge/julius/live-workers.ts')).toContain('const REVIEW_ATTEMPT_LIMIT = 2;');
    // Reviewer depth is untouched in the packet the reviewer is handed: the
    // stage rubric, the findings and the evidence contract are all unchanged.
    // Seven since the disagreement's own stage joined them: plan, build,
    // guidance, rebuttal and the three repairs. Depth per review is unchanged.
    expect(JULIUS_REVIEW_STAGES).toHaveLength(7);
  });
});
