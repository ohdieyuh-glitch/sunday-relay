import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_ANALYTICAL_MODEL, JOB_BUDGET_MS, MAX_REVIEWER_ATTEMPTS, RECORDED_REVIEWER_OBSERVATIONS,
  REVIEWER_DEADLINE_HEADROOM_RATIO, REVIEWER_JOB_SHARE_MS, ReviewerDeadlineUnsatisfiable,
  resolveReviewerDeadline, reviewerHighWater, reviewerOperativeTimeoutMs,
} from './reviewer-deadline';
import { loadHermesConfig } from './hermes-reviewer';
import { ARCHITECT_WORKER, CODER_WORKER, reviewerWorker } from './julius/live-composition';
import { DEFAULT_HOSTED_LIMITS } from './hosted-coding-agent/hosted-envelope';
import { DEFAULT_TIMEOUT_MS as ARCHITECT_OPERATIVE_TIMEOUT_MS } from '../src/relay/connectors/gpt-architect/config';

// NOT `import.meta`: the bridge tsconfig forbids it, and `npm run typecheck`
// runs a second pass over relay-bridge that is easy to miss locally.
const ROOT = process.cwd();
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

describe('the reviewer deadline is derived once and nothing keeps a private copy', () => {
  /**
   * THE FINDING THIS FILE EXISTS FOR. Paid Mission 4 was cut off at 400_093 ms
   * by a window the workflow set to 400_000, while the live composition
   * declared 240_000 on the very same worker and nothing enforced it. Two
   * numbers for one limit, 160 s apart, and the inert one was the one written
   * where a reader would look.
   */
  it('gives the transport and the declared worker deadline THE SAME value', () => {
    const operative = loadHermesConfig({} as NodeJS.ProcessEnv).timeoutMs;
    const declared = reviewerWorker('xai').timeoutMs;
    expect(declared).toBe(operative);
    expect(declared).toBe(resolveReviewerDeadline().operativeTimeoutMs);
  });

  it('cannot be steered by an environment variable any more', () => {
    // The old `RELAY_HERMES_TIMEOUT_MS` is the second source that made the two
    // disagree. Setting it must now change nothing at all.
    const withEnv = loadHermesConfig({ RELAY_HERMES_TIMEOUT_MS: '1234' } as unknown as NodeJS.ProcessEnv).timeoutMs;
    expect(withEnv).toBe(reviewerOperativeTimeoutMs());
  });

  /**
   * EVERY ROLE, not just the one that failed. The structural test that found the
   * reviewer's 240_000 immediately found two more: the coder declared 600_000
   * against a runtime that aborts at 360_000, and the architect restated
   * `300_000` as a second literal beside the connector default it happened to
   * match. A number that agrees by coincidence is one edit from disagreeing.
   */
  it('declares, for every role, exactly the deadline that role is actually bounded by', () => {
    expect(ARCHITECT_WORKER.timeoutMs).toBe(ARCHITECT_OPERATIVE_TIMEOUT_MS);
    expect(CODER_WORKER.timeoutMs).toBe(DEFAULT_HOSTED_LIMITS.maxRuntimeMs);
    expect(reviewerWorker('xai').timeoutMs).toBe(reviewerOperativeTimeoutMs());
  });

  it('leaves no decorative timeout literal in the composition or the transport', () => {
    for (const file of ['relay-bridge/julius/live-composition.ts', 'relay-bridge/hermes-reviewer.ts']) {
      const source = read(file);
      // A literal assigned to timeoutMs is exactly the shape that rotted before.
      const literals = [...source.matchAll(/timeoutMs:\s*([0-9][0-9_]*)/g)].map(match => match[1]);
      expect(literals, `${file} must take its deadline from the operative source, not a literal`).toEqual([]);
    }
    expect(read('relay-bridge/julius/live-composition.ts')).toContain('reviewerOperativeTimeoutMs()');
    expect(read('relay-bridge/hermes-reviewer.ts')).toContain('reviewerOperativeTimeoutMs()');
  });

  it('no longer reads or requires the retired environment variable', () => {
    for (const file of ['relay-bridge/hermes-reviewer.ts', '.github/workflows/julius-first-live-mission.yml']) {
      expect(read(file), `${file} still sets or reads RELAY_HERMES_TIMEOUT_MS`)
        .not.toMatch(/^(?!\s*#).*(?:env\.RELAY_HERMES_TIMEOUT_MS|RELAY_HERMES_TIMEOUT_MS:\s*')/m);
    }
  });
});

describe('the derivation is deterministic, bounded and says what it is standing on', () => {
  it('derives the operative deadline from the four declared inputs', () => {
    const deadline = resolveReviewerDeadline();
    expect(deadline.analyticalWorstCaseMs).toBe(
      DEFAULT_ANALYTICAL_MODEL.requestTimeoutSeconds * DEFAULT_ANALYTICAL_MODEL.requestsPerReview * 1000
      + DEFAULT_ANALYTICAL_MODEL.engineOverheadMs);
    expect(deadline.floorMs).toBe(Math.max(deadline.analyticalWorstCaseMs, deadline.observedHighWaterMs ?? 0));
    expect(deadline.operativeTimeoutMs).toBe(Math.ceil(deadline.floorMs * (1 + REVIEWER_DEADLINE_HEADROOM_RATIO)));
    expect(deadline.headroomMs).toBe(deadline.operativeTimeoutMs - deadline.floorMs);
    expect(deadline.hardCeilingMs).toBe(Math.floor(REVIEWER_JOB_SHARE_MS / MAX_REVIEWER_ATTEMPTS));
  });

  it('is a pure function of its inputs', () => {
    expect(resolveReviewerDeadline()).toEqual(resolveReviewerDeadline());
  });

  /**
   * THE HONESTY REQUIREMENT. Mission 4's largest number, 400_093 ms, came from
   * a review Relay STOPPED. Its true duration was never observed and can never
   * be recovered, so it is a lower bound. Reporting it as a measurement would
   * understate exactly the thing it is evidence of.
   */
  /**
   * THE MODEL NOW DOMINATES, AND THAT IS THE REPAIR. Correcting
   * `requestsPerReview` from an asserted 2 to the observed floor of 5 raised
   * `analyticalWorstCaseMs` to 630 000 — above the 400 093 ms high water — so
   * the default basis is ANALYTICAL. It was `OBSERVED_CENSORED` only because
   * the model understated the engine, which is precisely how the understatement
   * stayed invisible: the number that should have exposed it was covering it.
   *
   * The censoring rule itself is unchanged and is proven below against a model
   * small enough for an observation to bind, which is the only arrangement in
   * which the rule is observable at all.
   */
  const TINY_MODEL = { requestTimeoutSeconds: 10, requestsPerReview: 2, engineOverheadMs: 0 } as const;

  it('still reports the cut-off high water, and reports it as a lower bound', () => {
    const deadline = resolveReviewerDeadline();
    expect(deadline.observedHighWaterMs).toBe(400_093);
    expect(deadline.observedHighWaterCensored).toBe(true);
    expect(deadline.basis, 'the corrected model now exceeds every observation').toBe('ANALYTICAL');
    const censored = RECORDED_REVIEWER_OBSERVATIONS.find(o => o.elapsedMs === 400_093);
    expect(censored?.outcome).toBe('CUT_OFF');
  });

  it('reports a cut-off high water as CENSORED when it is what binds', () => {
    const deadline = resolveReviewerDeadline({ model: TINY_MODEL });
    expect(deadline.observedHighWaterMs).toBe(400_093);
    expect(deadline.observedHighWaterCensored).toBe(true);
    expect(deadline.basis).toBe('OBSERVED_CENSORED');
  });

  it('says OBSERVED_COMPLETED when the high water is a real measurement', () => {
    const deadline = resolveReviewerDeadline({
      model: TINY_MODEL,
      observations: RECORDED_REVIEWER_OBSERVATIONS.filter(o => o.outcome === 'COMPLETED'),
    });
    expect(deadline.observedHighWaterMs).toBe(381_880);
    expect(deadline.observedHighWaterCensored).toBe(false);
    expect(deadline.basis).toBe('OBSERVED_COMPLETED');
  });

  /** UNKNOWN STAYS UNKNOWN: no observation means null, never a zero or a guess. */
  it('reports an unobserved high water as null and falls back to the model alone', () => {
    const deadline = resolveReviewerDeadline({ observations: [] });
    expect(deadline.observedHighWaterMs).toBeNull();
    expect(deadline.observedHighWaterCensored).toBe(false);
    expect(deadline.basis).toBe('ANALYTICAL');
    expect(deadline.floorMs).toBe(deadline.analyticalWorstCaseMs);
    expect(reviewerHighWater([])).toEqual({ ms: null, censored: false });
  });

  it('learns from a longer observation instead of ignoring it', () => {
    const longer = resolveReviewerDeadline({
      // Longer than the corrected analytical worst case, so the observation is
      // what binds — the point of the test, at the scale the policy now runs at.
      observations: [{ runId: 'r', taskId: 't', stage: 'plan', elapsedMs: 700_000, outcome: 'COMPLETED' }],
    });
    expect(longer.operativeTimeoutMs).toBeGreaterThan(resolveReviewerDeadline().operativeTimeoutMs);
    expect(longer.basis).toBe('OBSERVED_COMPLETED');
  });

  /**
   * REFUSED, NOT CLAMPED. Clamping would hand back a deadline already known to
   * be shorter than a review has taken — the exact failure this replaced.
   */
  it('refuses rather than clamping when the floor cannot fit under the job ceiling', () => {
    expect(() => resolveReviewerDeadline({
      observations: [{ runId: 'r', taskId: 't', stage: 'plan', elapsedMs: 20 * 60_000, outcome: 'COMPLETED' }],
    })).toThrow(ReviewerDeadlineUnsatisfiable);
    try {
      resolveReviewerDeadline({ observations: [{ runId: 'r', taskId: 't', stage: 'plan', elapsedMs: 20 * 60_000, outcome: 'COMPLETED' }] });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('reviewer_deadline_unsatisfiable');
      // It must name BOTH numbers and the levers, so the refusal is actionable.
      expect((error as Error).message).toContain('REVIEWER_JOB_SHARE_MS');
      expect((error as Error).message).toContain('MAX_REVIEWER_ATTEMPTS');
    }
  });

  it('rejects a nonsense model or headroom instead of quietly producing a number', () => {
    expect(() => resolveReviewerDeadline({ headroomRatio: -0.1 })).toThrow('invalid_headroom_ratio');
    expect(() => resolveReviewerDeadline({ model: { ...DEFAULT_ANALYTICAL_MODEL, requestsPerReview: -1 } }))
      .toThrow('invalid_analytical_requestsPerReview');
  });
});

describe('the job is the real ceiling, and the workflow is held to it', () => {
  it('keeps the worst case reviewer spend inside its declared share of the job', () => {
    const deadline = resolveReviewerDeadline();
    expect(deadline.worstCaseReviewerSpendMs).toBe(deadline.operativeTimeoutMs * MAX_REVIEWER_ATTEMPTS);
    expect(deadline.worstCaseReviewerSpendMs).toBeLessThanOrEqual(REVIEWER_JOB_SHARE_MS);
    expect(REVIEWER_JOB_SHARE_MS).toBeLessThan(JOB_BUDGET_MS);
  });

  it('pins the live mission workflow timeout to JOB_BUDGET_MS', () => {
    const workflow = read('.github/workflows/julius-first-live-mission.yml');
    const declared = /^\s*timeout-minutes:\s*(\d+)\s*$/m.exec(workflow);
    expect(declared, 'the live mission job must declare a timeout').not.toBeNull();
    expect(Number(declared![1]) * 60_000).toBe(JOB_BUDGET_MS);
  });

  /**
   * THE ORDER THE BOOTSTRAP ENFORCES. The engine's own deadline must land
   * inside Relay's window or Relay cuts first and every distinct provider fault
   * reaches the record as one indistinguishable shape (paid run 34311556047).
   */
  it('leaves the engine deadline strictly inside the derived window', () => {
    const workflow = read('.github/workflows/julius-first-live-mission.yml');
    const requestSeconds = Number(/HERMES_REQUEST_TIMEOUT_SECONDS:\s*'(\d+)'/.exec(workflow)![1]);
    expect(requestSeconds).toBe(DEFAULT_ANALYTICAL_MODEL.requestTimeoutSeconds);
    const engineDeadlineMs = requestSeconds * DEFAULT_ANALYTICAL_MODEL.requestsPerReview * 1000;
    expect(engineDeadlineMs).toBeLessThan(resolveReviewerDeadline().operativeTimeoutMs);
  });

  it('makes the bootstrap read the policy instead of modelling its own worst case', () => {
    const bootstrap = read('.github/julius-live-hermes.sh');
    expect(bootstrap).toContain('scripts/julius-reviewer-deadline.mjs');
    expect(bootstrap).not.toMatch(/^SLOPE=/m);
    expect(bootstrap).not.toMatch(/^CONSTANT_MS=/m);
  });
});

describe('the shell-side mirror cannot drift from the TypeScript derivation', () => {
  /**
   * `julius-live-hermes.sh` runs before anything imports the bridge, so the
   * numbers are mirrored in a plain .mjs. Mirrors rot; this executes the real
   * file and compares every field, the same arrangement
   * `julius-live-contract-check.mjs` uses for the architect reservation.
   */
  it('emits byte-identical values to resolveReviewerDeadline()', () => {
    const emitted = execFileSync(process.execPath, [join(ROOT, 'scripts/julius-reviewer-deadline.mjs')], { encoding: 'utf8' });
    expect(JSON.parse(emitted)).toEqual(resolveReviewerDeadline());
  });

  it('mirrors every recorded observation, including whether it was censored', async () => {
    const mirror = await import(join(ROOT, 'scripts/julius-reviewer-deadline.mjs'));
    expect(mirror.RECORDED_REVIEWER_OBSERVATIONS).toEqual(RECORDED_REVIEWER_OBSERVATIONS);
    expect(mirror.JOB_BUDGET_MS).toBe(JOB_BUDGET_MS);
    expect(mirror.REVIEWER_JOB_SHARE_MS).toBe(REVIEWER_JOB_SHARE_MS);
    expect(mirror.MAX_REVIEWER_ATTEMPTS).toBe(MAX_REVIEWER_ATTEMPTS);
    expect(mirror.REVIEWER_DEADLINE_HEADROOM_RATIO).toBe(REVIEWER_DEADLINE_HEADROOM_RATIO);
    expect(mirror.DEFAULT_ANALYTICAL_MODEL).toEqual(DEFAULT_ANALYTICAL_MODEL);
  });
});
