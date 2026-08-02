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
 * It is for DEVELOPMENT on a machine that genuinely has Hermes. In production
 * the bridge selects the remote transport and never reaches this file.
 *
 * One real difference from a remote run: the service keeps its runs in a
 * durable place, whereas this transport holds them in memory for the life of
 * the process. That is stated rather than hidden — `getReview` for an unknown
 * id reports the run as lost to a restart instead of inventing a state.
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
}

interface LocalRun {
  status: RemoteHermesReviewState['status'];
  outcome: HermesRunOutcome | null;
  controller: AbortController;
  cancelRequested: boolean;
}

export function createLocalHermesTransport(
  config: LocalTransportConfig,
): HermesReviewerTransport {
  const now = config.now ?? (() => new Date().toISOString());
  const env = config.env ?? process.env;
  // Volatile by construction. A restart loses these, and `getReview` says so.
  const runs = new Map<string, LocalRun>();
  const byIdempotencyKey = new Map<string, string>();

  const probeFor = () => {
    const profile = createIsolatedProfile();
    return { profile, probe: createProbe(profile.home) };
  };

  return {
    mode: 'local',

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
      const existing = byIdempotencyKey.get(input.idempotencyKey);
      if (existing !== undefined) {
        // A repeated key returns the run that already exists rather than
        // starting a second one.
        return { accepted: true, runId: existing, duplicate: true, failureKind: null, safeMessage: null };
      }
      const runId = input.runId.trim() === '' ? randomUUID() : input.runId;
      const controller = new AbortController();
      const run: LocalRun = { status: 'running', outcome: null, controller, cancelRequested: false };
      runs.set(runId, run);
      byIdempotencyKey.set(input.idempotencyKey, runId);

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
        run.outcome = outcome;
        run.status = run.cancelRequested ? 'cancelled'
          : outcome.kind === 'completed' ? 'completed'
            : outcome.kind === 'timed_out' ? 'timed_out'
              : outcome.kind === 'cancelled' ? 'cancelled' : 'failed';
      }).catch(() => {
        run.outcome = null;
        run.status = 'failed';
      });

      return { accepted: true, runId, duplicate: false, failureKind: null, safeMessage: null };
    },

    async getReview(runId: string): Promise<RemoteHermesReviewState> {
      const run = runs.get(runId);
      if (run === undefined) {
        // Truthful about volatility instead of inventing durable state.
        return {
          runId, status: 'failed', protocol: HERMES_SERVICE_PROTOCOL, reviewText: null,
          usage: { inputTokens: null, outputTokens: null, source: 'unavailable' },
          failureKind: 'service_unreachable',
          safeMessage: 'This Relay Bridge has no record of that review. Local runs are held in memory and do not survive a restart.',
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
          source: usage !== null && usage.source === 'harness_reported' ? 'harness_reported' : 'unavailable',
        },
        failureKind: run.status === 'timed_out' ? 'timed_out' : null,
        safeMessage: outcome !== null && 'safeMessage' in outcome ? outcome.safeMessage : null,
      };
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
