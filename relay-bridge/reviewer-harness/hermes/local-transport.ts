import { randomUUID } from 'node:crypto';
import type { HarnessRuntimeEvidence } from '../../../src/relay/mission/reviewer-harness/harness-readiness';
import { createProbe } from './discovery';
import { createIsolatedProfile } from './isolated-profile';
import { localReadiness, verifiedReadiness } from './readiness';
import { DEFAULT_RUN_LIMITS, runHermesReviewer, type HermesRunOutcome } from './runner';
import { loadXaiConfig } from './xai-models';
import {
  HERMES_SERVICE_PROTOCOL,
  type HermesConnectionEvidence, type HermesReviewerTransport,
  type RemoteHermesCancelResult, type RemoteHermesReviewInput,
  type RemoteHermesReviewStart, type RemoteHermesReviewState,
} from './hermes-transport';
import { describeProvider, type HermesProviderConfig } from './hermes-provider';
import {
  ADMISSION_CEILINGS, evaluateAdmission, selectEvictions, type AdmissionCeilings,
} from './admission';

/**
 * THE LOCAL EXECUTABLE TRANSPORT — the historical behaviour, behind the seam.
 *
 * This is a thin wrapper and nothing more. Discovery, the isolated profile,
 * the argument builder, the process-group termination, redaction, output caps
 * and usage parsing all stay exactly where they were; this file only presents
 * them through `HermesReviewerTransport` so the bridge can hold local and
 * remote to one contract. Re-implementing any of it here would create a second,
 * subtly different copy of the safety logic, which is the failure mode this
 * whole refactor is trying to avoid.
 *
 * WHERE IT RUNS. Two places, and the second one is easy to miss: the BRIDGE
 * uses it for development on a machine that genuinely has Hermes, and the
 * Hermes Reviewer SERVICE uses it as its production engine —
 * `relay-hermes-service/main.ts` injects exactly this transport. There is
 * deliberately no second process runner, because two copies of safety logic
 * drift and the drifted one is always the one in production.
 *
 * RUN STORAGE IS IN MEMORY, ON BOTH SIDES OF THAT SEAM.
 *
 * A previous version of this docstring said "the service keeps its runs in a
 * durable place, whereas this transport holds them in memory". That was false
 * in the one way that matters: the service *is* this transport. Nothing here
 * is durable, on either host. `getReview` for an unknown id says so rather
 * than inventing a state, the README says so, and idempotency is explicitly
 * NOT restart-safe. Durable run truth lives in Relay Core, which already owns
 * it; a second durable store here would be a competing source of truth.
 *
 * WHAT IS BOUNDED (independent review, F1). Concurrent runs, the outstanding
 * worst-case wall clock, the number of retained terminal runs, and the
 * idempotency map — which is evicted WITH the run it points at, so it cannot
 * become the leak that survives the fix. See `admission.ts` for why those are
 * the only units this service can bound truthfully.
 *
 * THE CEILINGS ARE PER TRANSPORT INSTANCE, AND THAT IS A REQUIREMENT ON THE
 * CALLER. The counters are closure-local, so N instances enforce N × the
 * ceiling. `relay-hermes-service/main.ts` creates exactly one and holds it for
 * the process lifetime, which is what makes the bound real. The bridge's
 * `transport-factory.ts` NOW CACHES one per distinct configuration for the
 * process lifetime, so the same bound holds there.
 *
 * It did not, and this comment used to say the hazard was harmless "because no
 * bridge route calls `startReview`", leaving the correctness of a concurrency
 * bound resting on nobody adding a route. That is a landmine, not a design, so
 * the instance was hoisted before anyone needed it rather than after.
 *
 * Note also that ceilings are per PROCESS. N replicas of this service enforce
 * N × the ceiling between them; nothing here coordinates across containers and
 * nothing here claims to.
 */

export interface LocalTransportConfig {
  readonly executable: string;
  readonly provider: HermesProviderConfig;
  readonly apiKey: string | null;
  readonly baseUrl?: string | null;
  /**
   * The environment this transport reports on. Passed in rather than read
   * from `process.env` at call time so the bridge reports on the environment
   * it was BUILT with — and so a test can inject one.
   */
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => string;
  /** Injected in tests so the whole pipeline runs against a fake executable. */
  readonly spawnImpl?: Parameters<typeof runHermesReviewer>[0]['spawnImpl'];
  /**
   * Aggregate ceilings. Overridable ONLY for tests — nothing reads these from
   * a request or from the environment, because a caller that could raise the
   * ceiling is not bounded by it.
   */
  readonly ceilings?: AdmissionCeilings;
}

/**
 * What makes two creation requests "the same request" for idempotency.
 * Deliberately includes the prompt and the effective limits: a key replayed
 * with different evidence, or a different budget, is a different review.
 */
function requestFingerprint(input: RemoteHermesReviewInput): string {
  return JSON.stringify([
    input.runId,
    input.prompt,
    input.limits.timeoutMs, input.limits.maxOutputBytes,
    input.limits.maxTurns, input.limits.maxPromptBytes,
  ]);
}

interface LocalRun {
  status: RemoteHermesReviewState['status'];
  outcome: HermesRunOutcome | null;
  controller: AbortController;
  cancelRequested: boolean;
  /** The effective timeout this run reserved from the wall-clock budget. */
  reservedTimeoutMs: number;
  /**
   * Whether this run's capacity has been returned.
   *
   * RELEASED EXACTLY ONCE. Completion, failure, timeout, cancellation and
   * shutdown can all arrive for the same run — a user cancel followed by the
   * process settling is the ordinary case, not an edge one. Releasing twice
   * would decrement the active count below the truth and hand out a slot that
   * does not exist, which is a capacity bound that quietly stops bounding.
   */
  released: boolean;
  /** Idempotency keys pointing at this run; evicted with it. */
  readonly keys: Set<string>;
}

export function createLocalHermesTransport(
  config: LocalTransportConfig,
): HermesReviewerTransport {
  const now = config.now ?? (() => new Date().toISOString());
  const env = config.env ?? process.env;
  const ceilings = config.ceilings ?? ADMISSION_CEILINGS;
  // Volatile by construction. A restart loses these, and `getReview` says so.
  // BOUNDED by construction too: see `releaseCapacity` and `evictIfNeeded`.
  const runs = new Map<string, LocalRun>();
  const byIdempotencyKey = new Map<string, { runId: string; fingerprint: string }>();
  /** Insertion order of run ids, used to evict the oldest terminal runs. */
  const runOrder: string[] = [];

  let activeCount = 0;
  let activeTimeoutBudgetMs = 0;
  /**
   * Set by `cancelAll`, never cleared.
   *
   * `cancelAll` returns every slot up front so the counters stay honest, but
   * the process groups it aborted are still alive — SIGTERM first, SIGKILL
   * only after a grace period. Without this flag the transport would happily
   * admit a full set of new runs on top of them, and up to twice the ceiling
   * in credential-holding process groups would exist at once.
   *
   * Nothing bad happens today, because `main.ts` flips its module-global
   * lifecycle to `shutting_down` before it calls `cancelAll`, and the route
   * refuses new reviews from that moment. But that invariant lived in a
   * different file, enforced by the ORDER of two lines; reversing them, or
   * calling `cancelAll` from anywhere else, would silently over-subscribe.
   * An invariant about a counter belongs where the counter is.
   */
  let draining = false;

  /**
   * "Active" for eviction purposes is deliberately WIDER than "holding
   * capacity": a run counts as active while it is still running OR still
   * holding a slot. Shutdown releases capacity up front so the counters are
   * honest, and a run whose process has not settled yet must still never be
   * evicted — its `AbortController` is the only handle on that process group.
   */
  const isActive = (runId: string): boolean => {
    const run = runs.get(runId);
    if (run === undefined) return false;
    return run.status === 'running' || !run.released;
  };

  /**
   * Return one run's capacity, at most once. Called from every terminal path:
   * the settle handler (completion, timeout, failure, cancellation), the
   * rejection handler, and shutdown.
   */
  const releaseCapacity = (run: LocalRun): void => {
    if (run.released) return;
    run.released = true;
    activeCount -= 1;
    activeTimeoutBudgetMs -= run.reservedTimeoutMs;
  };

  /**
   * Drop the oldest terminal runs beyond the retention ceiling, and the
   * idempotency entries that point at them. An ACTIVE run is never evicted —
   * `selectEvictions` re-checks that per candidate rather than trusting the
   * order list, because dropping a live run would strand its AbortController
   * and leave a Hermes process group that shutdown can no longer reach.
   */
  const evictIfNeeded = (): void => {
    const doomed = selectEvictions(runOrder, isActive, ceilings);
    for (const runId of doomed) {
      const run = runs.get(runId);
      // Belt and braces: `selectEvictions` already excluded active runs, and
      // this refuses again at the point of deletion. The cost of the redundant
      // check is nothing; the cost of being wrong is an unreachable process.
      if (run === undefined || isActive(runId)) continue;
      for (const key of run.keys) byIdempotencyKey.delete(key);
      runs.delete(runId);
      const at = runOrder.indexOf(runId);
      if (at >= 0) runOrder.splice(at, 1);
    }
  };

  const probeFor = () => {
    const profile = createIsolatedProfile();
    return { profile, probe: createProbe(profile.home) };
  };

  return {
    mode: 'local',
    // What THIS engine enforces, so the service reports a fact rather than a
    // module constant it happens to import.
    ceilings,

    async readiness(): Promise<HarnessRuntimeEvidence> {
      const { profile, probe } = probeFor();
      try {
        // Unchanged: the existing offline readiness, which contacts no provider.
        return localReadiness({
          executable: config.executable,
          probe,
          xai: loadXaiConfig(env),
          now,
        });
      } finally {
        profile.dispose();
      }
    },

    async testConnection(): Promise<HermesConnectionEvidence> {
      const { profile, probe } = probeFor();
      try {
        const result = await verifiedReadiness({
          executable: config.executable,
          probe,
          xai: loadXaiConfig(env),
          now,
        });
        const connected = result.evidence.modelVerified;
        return {
          connected,
          // Verifying a connection never creates a run.
          runCreated: false,
          protocol: HERMES_SERVICE_PROTOCOL,
          identity: describeProvider(
            config.provider,
            connected ? result.evidence.verifiedModelId : null,
          ),
          failureKind: connected ? null : 'provider_unverified',
          safeMessage: connected ? null : (result.evidence.failureReason ?? 'The Hermes Reviewer is not connected.'),
          checkedAt: now(),
        };
      } finally {
        profile.dispose();
      }
    },

    async startReview(input: RemoteHermesReviewInput): Promise<RemoteHermesReviewStart> {
      // Refused before idempotency, before admission, before anything: once
      // this engine has begun draining it starts nothing, including a replay.
      if (draining) {
        return {
          accepted: false, runId: input.runId, duplicate: false,
          failureKind: 'shutting_down',
          safeMessage: 'This Hermes Reviewer engine is draining and is starting no further reviews.',
        };
      }
      const fingerprint = requestFingerprint(input);
      const existing = byIdempotencyKey.get(input.idempotencyKey);
      if (existing !== undefined) {
        // A KEY IS A PROMISE ABOUT ONE REQUEST.
        // Returning the earlier run for a DIFFERENT request would answer a
        // question nobody asked, and hide that two reviews were conflated.
        if (existing.fingerprint !== fingerprint) {
          return {
            accepted: false, runId: existing.runId, duplicate: false,
            failureKind: 'review_refused',
            safeMessage:
              'That idempotency key was already used for a materially different review request.',
          };
        }
        // A repeated key with the same request returns the run that already
        // exists rather than starting a second one.
        return { accepted: true, runId: existing.runId, duplicate: true, failureKind: null, safeMessage: null };
      }

      const runId = input.runId.trim() === '' ? randomUUID() : input.runId;
      // A RUN RECORD IS NEVER REPLACED.
      //
      // `runs.set(runId, …)` used to overwrite silently, so a second request
      // reusing a run id destroyed the first record — and with it the only
      // reference to that run's AbortController. `cancelAll()` could then
      // never reach it, so a shutdown left its Hermes process group alive:
      // the exact orphan this service promises cannot happen.
      if (runs.has(runId)) {
        return {
          accepted: false, runId, duplicate: false,
          failureKind: 'review_refused',
          safeMessage: 'That run id is already in use on this service, and a run record is never replaced.',
        };
      }

      /* ------------------------------------------------ ADMISSION --------
       * ATOMIC BY CONSTRUCTION.
       *
       * From the `evaluateAdmission` call to the counter increments below
       * there is NO `await`. On a single-threaded runtime that makes
       * check-and-reserve one uninterrupted step, so two concurrent callers
       * cannot both observe the last free slot. An `await` anywhere in this
       * block — even an innocuous one — would reintroduce exactly the race
       * this shape exists to close, which is why the spawn happens strictly
       * after the reservation and nothing is looked up in between.
       *
       * AND IT HAPPENS BEFORE ANY SPAWN. `runHermesReviewer` is what puts the
       * provider credential into a child environment; a refused request must
       * never reach it. Ordering the reservation first is what makes "no
       * credential exposure or process spawn before admission" true rather
       * than merely intended.
       * ------------------------------------------------------------------ */
      const reservedTimeoutMs = input.limits.timeoutMs;
      const verdict = evaluateAdmission({ activeCount, activeTimeoutBudgetMs }, reservedTimeoutMs, ceilings);
      if (!verdict.admitted) {
        return {
          accepted: false, runId, duplicate: false,
          // NOT every refusal is capacity. Hardcoding `capacity_exhausted`
          // here told a caller with an unusable timeout that its request was
          // "temporary and clears as running reviews finish" and could be
          // "sent again unchanged" — an invitation to retry forever something
          // that can never succeed. The policy already distinguishes them;
          // flattening the distinction one line later is the same defect as
          // publishing a ceiling that cannot fire.
          failureKind: verdict.reason === 'unusable_timeout_request'
            ? 'validation_failed'
            : 'capacity_exhausted',
          safeMessage: verdict.safeMessage,
        };
      }

      const controller = new AbortController();
      const run: LocalRun = {
        status: 'running', outcome: null, controller, cancelRequested: false,
        reservedTimeoutMs, released: false, keys: new Set([input.idempotencyKey]),
      };
      runs.set(runId, run);
      runOrder.push(runId);
      byIdempotencyKey.set(input.idempotencyKey, { runId, fingerprint });
      activeCount += 1;
      activeTimeoutBudgetMs += reservedTimeoutMs;

      /** Every terminal path funnels through here, so capacity is returned
       *  once and the retention ceiling is applied at the same moment. */
      const settle = (status: RemoteHermesReviewState['status'], outcome: HermesRunOutcome | null): void => {
        run.outcome = outcome;
        run.status = status;
        releaseCapacity(run);
        evictIfNeeded();
      };

      // A fresh isolated profile per run — never a persistent personal one.
      void runHermesReviewer({
        executable: config.executable,
        prompt: input.prompt,
        model: config.provider.requestedModel,
        provider: config.provider.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl ?? null,
        limits: { ...DEFAULT_RUN_LIMITS, ...input.limits },
        signal: controller.signal,
        now,
        spawnImpl: config.spawnImpl,
      }).then((outcome) => {
        settle(
          run.cancelRequested ? 'cancelled'
            : outcome.kind === 'completed' ? 'completed'
              : outcome.kind === 'timed_out' ? 'timed_out'
                : outcome.kind === 'cancelled' ? 'cancelled' : 'failed',
          outcome,
        );
      }).catch(() => {
        settle('failed', null);
      });

      return { accepted: true, runId, duplicate: false, failureKind: null, safeMessage: null };
    },

    async getReview(runId: string): Promise<RemoteHermesReviewState> {
      const run = runs.get(runId);
      if (run === undefined) {
        // Truthful about volatility instead of inventing durable state — and
        // truthful about ALL THREE ways a record can be absent. Naming only
        // the restart would now be a guess: since retention became bounded, an
        // old completed run can also have been evicted, and neither of those
        // is the same as an id that never existed. Relay Core holds the
        // durable record; this service never did.
        //
        // `unknown`, NOT `failed`. This used to answer
        // `status: 'failed', failureKind: 'service_unreachable'`, and both
        // fields were false for the commonest case: a review that COMPLETED
        // and was later evicted. Nothing failed and the service was perfectly
        // reachable — it answered. The prose below said so while the two
        // machine-readable fields said the opposite, and a caller reads the
        // fields.
        return {
          runId, status: 'unknown', protocol: HERMES_SERVICE_PROTOCOL, reviewText: null,
          usage: { inputTokens: null, outputTokens: null, model: null, source: 'unavailable' },
          failureKind: null,
          safeMessage:
            'There is no in-memory record of that review here: it was never created, it was lost to a restart, '
            + 'or it finished long enough ago to be evicted from the bounded retention window. '
            + 'This is not a report that the review failed — an evicted review most likely completed. '
            + 'Run truth is held by Relay Core, not by this service.',
        };
      }
      const outcome = run.outcome;
      const usage = outcome !== null && 'usage' in outcome ? outcome.usage : null;
      return {
        runId,
        status: run.status,
        protocol: HERMES_SERVICE_PROTOCOL,
        // A verdict exists only for a genuinely completed run.
        reviewText: run.status === 'completed' && outcome !== null && outcome.kind === 'completed'
          ? outcome.stdout
          : null,
        usage: {
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          // The served model the runner parsed from Hermes' own usage report.
          // This projection used to copy the token counts and drop the model —
          // the PRODUCER half of the hosted chain, and one of the four layers
          // that each lost the one field proving which model actually reviewed.
          model: usage?.model ?? null,
          source: usage !== null && usage.source === 'harness_reported' ? 'harness_reported' : 'unavailable',
        },
        failureKind: run.status === 'timed_out' ? 'timed_out' : null,
        safeMessage: outcome !== null && 'safeMessage' in outcome ? outcome.safeMessage : null,
      };
    },

    /**
     * Cancel every live run. Used by the service on SIGTERM so a container
     * restart never leaves an orphaned Hermes process group behind, and never
     * lets an interrupted review look like a finished one.
     */
    async cancelAll(): Promise<void> {
      // Before any abort: from here this engine admits nothing, whatever the
      // caller does next. See `draining`.
      draining = true;
      for (const [, run] of runs) {
        if (run.status === 'running') {
          run.cancelRequested = true;
          run.controller.abort();
          // Capacity is returned at SHUTDOWN, not left pinned until a child
          // that may never settle finally does. `releaseCapacity` is
          // idempotent, so the later `settle` for the same run is a no-op and
          // the count is decremented exactly once. Eviction is not triggered
          // here: these runs are still executing, and `isActive` keeps them.
          releaseCapacity(run);
        }
      }
    },

    async cancelReview(runId: string): Promise<RemoteHermesCancelResult> {
      const run = runs.get(runId);
      if (run === undefined) {
        return { requested: false, terminationConfirmed: false, safeMessage: 'No such review.' };
      }
      run.cancelRequested = true;
      run.controller.abort();
      return {
        requested: true,
        // Confirmed only once the run actually settled — a request is not a
        // confirmed termination.
        terminationConfirmed: run.outcome !== null,
        safeMessage: null,
      };
    },
  };
}
