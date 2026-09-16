import { classifyJuliusBrainFailure, type JuliusBrainFailure, type JuliusBrainFailureClass } from './julius-brain-failure-model';

/**
 * RETRYING WITHOUT LYING, AND STOPPING WHEN IT IS POINTLESS.
 *
 * Every failed operation falls into exactly one class:
 *
 *   SAFE_TO_RETRY            the request never reached the Brain, or the server
 *                            rolled it back. Trying again cannot duplicate
 *                            anything: connection refused, a read that never
 *                            answered, 25006, a statement or lock timeout.
 *   RECONCILE_BEFORE_RETRY   the request may have applied — the connection or a
 *                            gateway was lost after it left. The Brain is read
 *                            first; only if it did not apply is it sent again,
 *                            under the same idempotency key.
 *   DO_NOT_RETRY             nothing about waiting changes the answer: TLS or
 *                            environment failures, a schema the code does not
 *                            know, an authorization denial, an unrecognised
 *                            error.
 *
 * AN AMBIGUOUS WRITE IS NEVER SENT BLIND. Without a way to reconcile, a
 * RECONCILE_BEFORE_RETRY failure is raised to the caller, not retried.
 *
 * THE BREAKER COUNTS INFRASTRUCTURE ONLY. A run being told "no" — an expired
 * session, a mode it may not use, a foreign artifact — never opens it; those are
 * answers, and a service that stops answering them is worse than one that does.
 * Configuration failures (TLS, schema) do not open it either: they do not heal
 * on their own, and they are raised with an alert instead.
 *
 * WHILE IT IS OPEN, calls fail fast with `JuliusBrainCircuitOpenError`. That is a
 * Brain that cannot be reached, and it means exactly what the failure model says
 * it means — a FRESH run proceeds unpreserved, a run that needs prior state
 * refuses. It never makes any attempt "preserved": preservation is only ever
 * read back from the Brain.
 */

export type JuliusBrainRetryClass = 'SAFE_TO_RETRY' | 'RECONCILE_BEFORE_RETRY' | 'DO_NOT_RETRY';

/** Failures that mean the Brain (or its database) is not answering, and may answer later. */
export const JULIUS_BRAIN_INFRASTRUCTURE_FAILURES: readonly JuliusBrainFailureClass[] = [
  'SERVICE_UNAVAILABLE', 'DATABASE_UNAVAILABLE', 'DATABASE_READ_ONLY', 'TRANSACTION_TIMEOUT', 'NETWORK_PARTIAL', 'OIDC_UNAVAILABLE',
];

export function classifyJuliusBrainRetry(failure: JuliusBrainFailure): JuliusBrainRetryClass {
  if (!failure.retryable) return 'DO_NOT_RETRY';
  return failure.outcome === 'UNKNOWN' ? 'RECONCILE_BEFORE_RETRY' : 'SAFE_TO_RETRY';
}

export class JuliusBrainCircuitOpenError extends Error {
  constructor(readonly openedAt: string, readonly opensAgainAt: string, readonly consecutiveFailures: number) {
    super(`julius_brain_circuit_open: the Brain has been failing since ${openedAt}; calls resume at ${opensAgainAt}`);
    this.name = 'JuliusBrainCircuitOpenError';
  }
}
/** An ambiguous write with no way to find out whether it applied. Raised, never retried. */
export class JuliusBrainReconciliationRequiredError extends Error {
  constructor(readonly failure: JuliusBrainFailure, readonly cause: unknown) {
    super(`julius_brain_reconciliation_required: the operation may have applied (${failure.failureClass}) and nothing can say whether it did`);
    this.name = 'JuliusBrainReconciliationRequiredError';
  }
}

export type JuliusBrainBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface JuliusBrainRetryAttemptReport {
  readonly operation: string;
  readonly attempt: number;
  readonly failure: JuliusBrainFailure;
  readonly retryClass: JuliusBrainRetryClass;
  readonly action: 'RETRY' | 'RECONCILED' | 'RAISED';
  readonly delayMs: number | null;
  readonly breaker: JuliusBrainBreakerState;
}

export interface JuliusBrainRetryRunner {
  /**
   * Run one operation under the policy. `reconcile` answers whether an ambiguous
   * attempt applied: `{ applied: true, value }` ends it, `{ applied: false }`
   * allows exactly one more send.
   */
  run<T>(input: {
    readonly operation: string;
    readonly attempt: () => Promise<T>;
    readonly reconcile?: () => Promise<{ readonly applied: true; readonly value: T } | { readonly applied: false }>;
  }): Promise<T>;
  breaker(): { readonly state: JuliusBrainBreakerState; readonly consecutiveFailures: number; readonly openedAt: string | null };
}

export function createJuliusBrainRetryRunner(deps: {
  readonly clock: { now(): string };
  /** Injected so tests are deterministic; production passes a real timer. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1). Injected for the same reason. */
  readonly random?: () => number;
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly breaker?: { readonly failureThreshold: number; readonly openMs: number };
  readonly onAttempt?: (report: JuliusBrainRetryAttemptReport) => void;
}): JuliusBrainRetryRunner {
  const attempts = Math.max(1, deps.attempts ?? 3);
  const baseDelayMs = deps.baseDelayMs ?? 200;
  const maxDelayMs = deps.maxDelayMs ?? 5_000;
  const threshold = deps.breaker?.failureThreshold ?? 5;
  const openMs = deps.breaker?.openMs ?? 30_000;
  const random = deps.random ?? Math.random;
  const at = () => Date.parse(deps.clock.now());

  let consecutive = 0;
  let openedAt: number | null = null;
  /** Full jitter: a retry storm from many runs does not land in step. */
  const delayFor = (attempt: number) => Math.round(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) * random());

  const state = (): JuliusBrainBreakerState => {
    if (openedAt === null) return 'CLOSED';
    return at() - openedAt >= openMs ? 'HALF_OPEN' : 'OPEN';
  };

  return {
    breaker: () => ({ state: state(), consecutiveFailures: consecutive, openedAt: openedAt === null ? null : new Date(openedAt).toISOString() }),

    async run({ operation, attempt, reconcile }) {
      if (state() === 'OPEN') throw new JuliusBrainCircuitOpenError(new Date(openedAt!).toISOString(), new Date(openedAt! + openMs).toISOString(), consecutive);
      for (let tries = 1; ; tries += 1) {
        try {
          const value = await attempt();
          consecutive = 0;
          openedAt = null; // a successful probe closes it
          return value;
        } catch (error) {
          const failure = classifyJuliusBrainFailure(error);
          const retryClass = classifyJuliusBrainRetry(failure);
          const infrastructure = JULIUS_BRAIN_INFRASTRUCTURE_FAILURES.includes(failure.failureClass);
          if (infrastructure) {
            consecutive += 1;
            if (consecutive >= threshold && openedAt === null) openedAt = at();
            else if (openedAt !== null) openedAt = at(); // a failed probe re-opens for a full window
          }
          const report = (action: JuliusBrainRetryAttemptReport['action'], delayMs: number | null) => deps.onAttempt?.({ operation, attempt: tries, failure, retryClass, action, delayMs, breaker: state() });

          if (retryClass === 'RECONCILE_BEFORE_RETRY') {
            if (reconcile === undefined) { report('RAISED', null); throw new JuliusBrainReconciliationRequiredError(failure, error); }
            const found = await reconcile();
            if (found.applied) { report('RECONCILED', null); consecutive = 0; openedAt = null; return found.value; }
            report('RECONCILED', null);
            if (tries >= attempts || state() === 'OPEN') throw error;
            const delayMs = delayFor(tries);
            await deps.sleep(delayMs);
            continue;
          }
          if (retryClass === 'DO_NOT_RETRY' || tries >= attempts || state() === 'OPEN') { report('RAISED', null); throw error; }
          const delayMs = delayFor(tries);
          report('RETRY', delayMs);
          await deps.sleep(delayMs);
        }
      }
    },
  };
}
