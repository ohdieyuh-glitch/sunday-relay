#!/usr/bin/env node
/**
 * THE REVIEWER DEADLINE, FOR CALLERS THAT CANNOT IMPORT TYPESCRIPT.
 *
 * `.github/julius-live-hermes.sh` runs during the live mission's preflight,
 * before anything imports the bridge, and it needs the same number the bridge
 * will use. It used to compute its own worst case from a hardcoded `SLOPE=2`
 * and `CONSTANT_MS=180000` and compare that against a literal supplied by the
 * workflow environment — three numbers, one limit, and Paid Mission 4 ran past
 * all of them.
 *
 * The constants below MIRROR `relay-bridge/reviewer-deadline.ts`. Mirrors rot,
 * so `reviewer-deadline.test.ts` executes this file and fails if a single field
 * of its output differs from the TypeScript derivation. That is the same
 * arrangement `julius-live-contract-check.mjs` already uses for
 * `ARCHITECT_OUTPUT_TOKEN_RESERVATION`.
 *
 * Prints one JSON object to stdout and nothing else, so a shell can read it.
 */

export const REVIEWER_DEADLINE_POLICY_VERSION = 'julius-reviewer-deadline.v2';

export const RECORDED_REVIEWER_OBSERVATIONS = [
  { runId: '34470535718', taskId: 'run:c8910d0afb5608e0ea68aa72:plan:review', stage: 'plan', elapsedMs: 400_093, outcome: 'CUT_OFF' },
  { runId: '34470535718', taskId: 'run:c8910d0afb5608e0ea68aa72:plan:review', stage: 'plan', elapsedMs: 381_880, outcome: 'COMPLETED' },
  { runId: '34470535718', taskId: 'run:c8910d0afb5608e0ea68aa72:build:review', stage: 'build', elapsedMs: 218_324, outcome: 'COMPLETED' },
];

export const JOB_BUDGET_MS = 120 * 60_000;
export const REVIEWER_JOB_SHARE_MS = 50 * 60_000;

/* Mirrors the DOMAIN's own numbers: the review stages a normal mission runs,
   and the pipeline attempts each one gets. Both live in
   `src/relay/mission/julius/julius-review-stage.ts`; the parity test compares
   the product, so neither can move here alone. */
export const JULIUS_NORMAL_REVIEW_STAGES = ['plan', 'build', 'guidance'];
export const REVIEW_TASK_ATTEMPTS = 1;
export const MAX_REVIEWER_ATTEMPTS = JULIUS_NORMAL_REVIEW_STAGES.length * REVIEW_TASK_ATTEMPTS;

export const REVIEWER_DEADLINE_HEADROOM_RATIO = 0.2;
export const REVIEWER_REQUEST_TIMEOUT_SECONDS = 480;
export const MEASURED_ENGINE_STARTUP_MS = 18_000;

/** A FLOOR read off the durations we have watched — see the TypeScript for why
    it subtracts the MEASURED startup rather than the padded overhead. */
export function impliedRequestsPerReview(
  requestTimeoutSeconds = REVIEWER_REQUEST_TIMEOUT_SECONDS,
  observations = RECORDED_REVIEWER_OBSERVATIONS,
  startupMs = MEASURED_ENGINE_STARTUP_MS,
) {
  const perRequestMs = requestTimeoutSeconds * 1000;
  if (!Number.isFinite(perRequestMs) || perRequestMs <= 0) throw new Error('invalid_request_timeout');
  let floor = 1;
  for (const observation of observations) {
    const waiting = observation.elapsedMs - startupMs;
    if (waiting <= 0) continue;
    floor = Math.max(floor, Math.ceil(waiting / perRequestMs));
  }
  return floor;
}

export const DEFAULT_ANALYTICAL_MODEL = Object.freeze({
  requestTimeoutSeconds: REVIEWER_REQUEST_TIMEOUT_SECONDS,
  requestsPerReview: impliedRequestsPerReview(),
  engineOverheadMs: 180_000,
});

/**
 * ONE ARGUMENT OBJECT, exactly as the TypeScript takes.
 *
 * This mirror used to take `(model, observations, headroomRatio)` positionally
 * while `reviewer-deadline.ts` took `{model, observations, headroomRatio}`. The
 * parity test compared only the DEFAULT-argument output, so the two agreed on
 * the one call nobody parameterises and disagreed on every other — a mirror
 * that "cannot drift" had drifted in its interface.
 */
export function resolveReviewerDeadline({
  model = DEFAULT_ANALYTICAL_MODEL,
  observations = RECORDED_REVIEWER_OBSERVATIONS,
  headroomRatio = REVIEWER_DEADLINE_HEADROOM_RATIO,
} = {}) {
  const analyticalWorstCaseMs = model.requestTimeoutSeconds * model.requestsPerReview * 1000 + model.engineOverheadMs;
  let high = null;
  for (const observation of observations) if (high === null || observation.elapsedMs > high.elapsedMs) high = observation;
  const observedHighWaterMs = high === null ? null : high.elapsedMs;
  const observedHighWaterCensored = high !== null && high.outcome === 'CUT_OFF';
  const floorMs = Math.max(analyticalWorstCaseMs, observedHighWaterMs ?? 0);
  const basis = observedHighWaterMs !== null && observedHighWaterMs > analyticalWorstCaseMs
    ? (observedHighWaterCensored ? 'OBSERVED_CENSORED' : 'OBSERVED_COMPLETED')
    : 'ANALYTICAL';
  const operativeTimeoutMs = Math.ceil(floorMs * (1 + headroomRatio));
  const hardCeilingMs = Math.floor(REVIEWER_JOB_SHARE_MS / MAX_REVIEWER_ATTEMPTS);
  if (operativeTimeoutMs > hardCeilingMs) {
    throw new Error(`reviewer_deadline_unsatisfiable: ${operativeTimeoutMs} ms required, job allows ${hardCeilingMs} ms`);
  }
  return {
    policyVersion: REVIEWER_DEADLINE_POLICY_VERSION,
    operativeTimeoutMs,
    analyticalWorstCaseMs,
    requestsPerReview: model.requestsPerReview,
    observedHighWaterMs,
    observedHighWaterCensored,
    floorMs,
    headroomMs: operativeTimeoutMs - floorMs,
    hardCeilingMs,
    basis,
    worstCaseReviewerSpendMs: operativeTimeoutMs * MAX_REVIEWER_ATTEMPTS,
  };
}

/**
 * Prints the whole object, or ONE field when given its name.
 *
 * The field form exists so `julius-live-hermes.sh` never has to build a program
 * at run time to pick a value out of JSON: `relay-repository-boundary.mjs`
 * refuses a deployment-capable path that runs an entry it cannot read, and it
 * is right to. The shell calls this file, by path, with a field name.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const deadline = resolveReviewerDeadline();
  const field = process.argv[2];
  if (field === undefined) {
    process.stdout.write(`${JSON.stringify(deadline)}\n`);
  } else if (Object.hasOwn(deadline, field)) {
    process.stdout.write(`${String(deadline[field])}\n`);
  } else {
    process.stderr.write(`unknown_reviewer_deadline_field:${field}\n`);
    process.exit(1);
  }
}
