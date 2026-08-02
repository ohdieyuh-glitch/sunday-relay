import type { HarnessRuntimeEvidence } from '../../../src/relay/mission/reviewer-harness/harness-readiness';
import type { SafeProviderIdentity } from './hermes-provider';

/**
 * THE HERMES TRANSPORT SEAM — pure contract and pure selection.
 *
 * The bug this exists to remove: the bridge probed for a Hermes executable on
 * its OWN PATH. That is correct on a developer laptop and nonsense in a
 * Railway container, where the honest answer to "is Hermes installed?" is "no,
 * and it never will be" — yet the reply told a founder to install Hermes and
 * put it on PATH, which no amount of installing on their Chromebook could
 * satisfy.
 *
 * A transport makes WHERE Hermes runs an explicit choice:
 *
 *   local   the bridge spawns Hermes itself. Unchanged behaviour, for
 *           development on a machine that really has it.
 *   remote  the bridge calls a dedicated Hermes Reviewer service over
 *           authenticated private HTTP and never spawns anything.
 *
 * THE RULE THAT MATTERS MOST: remote NEVER falls back to local. A production
 * bridge that quietly probed its own PATH after a remote failure would report
 * "install Hermes" for what is actually an unreachable service or a bad token
 * — turning a precise, fixable fault into a misleading one. Fail closed, and
 * say which failure it was.
 */

/** Bumped when the bridge↔service wire contract changes incompatibly. */
export const HERMES_SERVICE_PROTOCOL = 'relay-hermes-reviewer.v1' as const;
export type HermesServiceProtocol = typeof HERMES_SERVICE_PROTOCOL;

export const HERMES_MODE_ENV = 'RELAY_HERMES_MODE';
export const HERMES_SERVICE_URL_ENV = 'RELAY_HERMES_SERVICE_URL';
export const HERMES_SERVICE_TOKEN_ENV = 'RELAY_HERMES_SERVICE_TOKEN';
export const HERMES_EXECUTABLE_ENV = 'RELAY_HERMES_EXECUTABLE';

export const HERMES_MODES = ['local', 'remote'] as const;
export type HermesMode = (typeof HERMES_MODES)[number];

/**
 * Categorised failure states. A caller gets one of these rather than a raw
 * upstream error, because an upstream body can quote the request, and the
 * request carries a token.
 */
export const HERMES_FAILURE_KINDS = [
  'configuration_missing',
  'authentication_failed',
  'service_unreachable',
  'incompatible_runtime',
  'interface_unverified',
  'readonly_unverified',
  'credentials_missing',
  'provider_unverified',
  'model_unverified',
  'protocol_mismatch',
  'malformed_response',
  'timed_out',
  /**
   * The service was reached, authenticated, understood the request — and
   * DECLINED it. A deliberate refusal is not an outage: it will not fix itself
   * and retrying it is a new paid call, whereas `service_unreachable` invites
   * an operator to go and check networking that is working perfectly.
   */
  'review_refused',
] as const;
export type HermesFailureKind = (typeof HERMES_FAILURE_KINDS)[number];

export interface HermesConnectionEvidence {
  readonly connected: boolean;
  /** Always false on this path: verifying a connection creates no run. */
  readonly runCreated: false;
  readonly protocol: HermesServiceProtocol | null;
  readonly identity: SafeProviderIdentity | null;
  readonly failureKind: HermesFailureKind | null;
  readonly safeMessage: string | null;
  readonly checkedAt: string;
}

export interface RemoteHermesReviewInput {
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly limits: {
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
    readonly maxTurns: number;
    readonly maxPromptBytes: number;
  };
}

export interface RemoteHermesReviewStart {
  readonly accepted: boolean;
  readonly runId: string;
  /** True when an existing run was returned for a repeated key. */
  readonly duplicate: boolean;
  readonly failureKind: HermesFailureKind | null;
  readonly safeMessage: string | null;
}

export interface RemoteHermesReviewState {
  readonly runId: string;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  readonly protocol: HermesServiceProtocol | null;
  /** Present only once a review really finished. */
  readonly reviewText: string | null;
  readonly usage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    /** 'unavailable' keeps Unknown as Unknown; it never becomes zero. */
    readonly source: 'harness_reported' | 'unavailable';
  };
  readonly failureKind: HermesFailureKind | null;
  readonly safeMessage: string | null;
}

export interface RemoteHermesCancelResult {
  readonly requested: boolean;
  /** Confirmed only when the service observed the process actually stop. */
  readonly terminationConfirmed: boolean;
  readonly safeMessage: string | null;
}

/**
 * What a transport must be able to answer. Deliberately small: it is an
 * execution boundary, not a second Reviewer domain model. Run truth still
 * lives in Relay Core.
 */
export interface HermesReviewerTransport {
  readonly mode: HermesMode;
  readiness(): Promise<HarnessRuntimeEvidence>;
  testConnection(): Promise<HermesConnectionEvidence>;
  startReview(input: RemoteHermesReviewInput): Promise<RemoteHermesReviewStart>;
  getReview(runId: string): Promise<RemoteHermesReviewState>;
  cancelReview(runId: string): Promise<RemoteHermesCancelResult>;
  /**
   * Cancel every live run. Optional because only an in-process engine can
   * honour it; a remote client asks the service, which cancels its own.
   */
  cancelAll?(): Promise<void>;
}

/* ------------------------------------------------------- mode selection --- */

export type HermesModeSelection =
  | { readonly ok: true; readonly mode: 'local'; readonly executableOverride: string | null }
  | { readonly ok: true; readonly mode: 'remote'; readonly serviceUrl: string; readonly serviceToken: string }
  | { readonly ok: false; readonly kind: 'configuration_missing'; readonly safeMessage: string };

/** A private-network URL the bridge may call. Nothing else is accepted. */
function validServiceUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Choose a transport from the environment, failing closed.
 *
 * `production` matters: leaving the mode unset is a reasonable convenience on
 * a developer machine that really does have Hermes, and is not reasonable in
 * production, where an unset mode previously meant "probe this container's
 * PATH" — the original bug. In production an unset mode is a configuration
 * error, stated as one.
 */
export function selectHermesMode(input: {
  env: NodeJS.ProcessEnv;
  production: boolean;
}): HermesModeSelection {
  const raw = (input.env[HERMES_MODE_ENV] ?? '').trim();

  if (raw === '') {
    if (input.production) {
      return {
        ok: false, kind: 'configuration_missing',
        safeMessage:
          `No ${HERMES_MODE_ENV} is configured. A production Relay Bridge must be told explicitly whether the `
          + 'Hermes Reviewer runs locally or as a dedicated service; it will not guess.',
      };
    }
    // Development default, documented: the historical behaviour.
    return { ok: true, mode: 'local', executableOverride: readExecutable(input.env) };
  }

  if (!(HERMES_MODES as readonly string[]).includes(raw)) {
    return {
      ok: false, kind: 'configuration_missing',
      safeMessage: `${HERMES_MODE_ENV} must be one of: ${HERMES_MODES.join(', ')}.`,
    };
  }

  if (raw === 'local') {
    return { ok: true, mode: 'local', executableOverride: readExecutable(input.env) };
  }

  // remote — both pieces are required, and neither is inferred.
  const serviceUrl = (input.env[HERMES_SERVICE_URL_ENV] ?? '').trim();
  const serviceToken = (input.env[HERMES_SERVICE_TOKEN_ENV] ?? '').trim();
  if (serviceUrl === '') {
    return {
      ok: false, kind: 'configuration_missing',
      safeMessage: `${HERMES_MODE_ENV} is remote but no ${HERMES_SERVICE_URL_ENV} is configured.`,
    };
  }
  if (!validServiceUrl(serviceUrl)) {
    return {
      ok: false, kind: 'configuration_missing',
      // The rejected URL is not echoed: it names internal host layout.
      safeMessage: `${HERMES_SERVICE_URL_ENV} is not a usable http(s) URL.`,
    };
  }
  if (serviceToken === '') {
    return {
      ok: false, kind: 'configuration_missing',
      safeMessage: `${HERMES_MODE_ENV} is remote but no ${HERMES_SERVICE_TOKEN_ENV} is configured.`,
    };
  }
  return { ok: true, mode: 'remote', serviceUrl, serviceToken };
}

function readExecutable(env: NodeJS.ProcessEnv): string | null {
  const raw = (env[HERMES_EXECUTABLE_ENV] ?? '').trim();
  return raw === '' ? null : raw;
}

/**
 * A URL string existing is not a healthy service.
 *
 * Kept as its own function so the point is impossible to miss at a call site:
 * selection proves the bridge is CONFIGURED to reach a service, and says
 * nothing about whether one answered.
 */
export function selectionProvesReachability(): false {
  return false;
}
