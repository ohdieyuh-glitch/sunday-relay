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

export const REVIEWER_DEADLINE_POLICY_VERSION = 'julius-reviewer-deadline.v1';

export const RECORDED_REVIEWER_OBSERVATIONS = [
  { runId: '34470535718', taskId: 'run:c8910d0afb5608e0ea68aa72:plan:review', stage: 'plan', elapsedMs: 400_093, outcome: 'CUT_OFF' },
  { runId: '34470535718', taskId: 'run:c8910d0afb5608e0ea68aa72:plan:review', stage: 'plan', elapsedMs: 381_880, outcome: 'COMPLETED' },
  { runId: '34470535718', taskId: 'run:c8910d0afb5608e0ea68aa72:build:review', stage: 'build', elapsedMs: 218_324, outcome: 'COMPLETED' },
];

export const JOB_BUDGET_MS = 90 * 60_000;
export const REVIEWER_JOB_SHARE_MS = 50 * 60_000;
export const MAX_REVIEWER_ATTEMPTS = 6;
export const REVIEWER_DEADLINE_HEADROOM_RATIO = 0.2;
export const DEFAULT_ANALYTICAL_MODEL = { requestTimeoutSeconds: 90, requestsPerReview: 2, engineOverheadMs: 180_000 };

export function resolveReviewerDeadline(
  model = DEFAULT_ANALYTICAL_MODEL,
  observations = RECORDED_REVIEWER_OBSERVATIONS,
  headroomRatio = REVIEWER_DEADLINE_HEADROOM_RATIO,
) {
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
