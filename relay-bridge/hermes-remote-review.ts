import { buildReviewPrompt, validateHermesReview, type HermesOutcome, type ReviewPacket } from './hermes-reviewer';
import { SERVICE_MAX_TURNS } from '../relay-hermes-service/service';

/**
 * What the bridge ASKS the remote Reviewer for. The service clamps each of
 * these down to its own ceiling and never up, so these are requests rather
 * than grants — which is why they live here rather than being read back from
 * the service and echoed.
 */
export const REMOTE_REVIEW_LIMITS = Object.freeze({
  maxOutputBytes: 1_048_576,
  maxPromptBytes: 262_144,
});
import { isProductionDeployment } from './deployment-environment';

/**
 * THE REVIEWER, REACHED OVER HTTP.
 *
 * `runHermesReview` spawns a local Hermes process. That is correct on a
 * founder's laptop and impossible on a container, so a hosted bridge had no
 * Reviewer at all — the last half of "production-hosted three-role execution".
 *
 * This is the same seam the hosted Coding Agent already uses: one function,
 * two implementations, the SAME return type. `HermesOutcome` is unchanged, so
 * the mission's reviewer leg does not learn a second vocabulary and cannot
 * behave differently depending on where the reviewer ran.
 *
 * WHAT IT DOES NOT DO. It does not decide anything about the review. Findings,
 * blocking-ness and the verdict are read by the same `validateHermesReview`
 * the local path uses, so a remote reviewer cannot return a shape the local
 * one could not, and no verdict logic exists twice.
 *
 * INDEPENDENCE SURVIVES THE TRANSPORT. Moving the reviewer onto another host
 * does not make it more or less independent — independence is about WHO
 * reviews, and that is the role slot's business. What this must not do is
 * quietly become the coding agent's own service, so the origin is checked
 * against an allowlist the deployment sets, and a production bridge that has
 * not set one refuses rather than trusting whatever URL it was handed.
 */

export interface RemoteHermesConfig {
  readonly serviceUrl: string;
  readonly token: string;
  /** Origins this bridge will talk to. Required in production. */
  readonly trustedOrigins: readonly string[];
  readonly timeoutMs: number;
  /** How long to wait for a started review to finish, in milliseconds. */
  readonly reviewTimeoutMs: number;
  readonly pollIntervalMs: number;
}

export const REMOTE_HERMES_ENV = Object.freeze({
  mode: 'RELAY_HERMES_MODE',
  url: 'RELAY_HERMES_SERVICE_URL',
  token: 'RELAY_HERMES_SERVICE_TOKEN',
  trustedOrigins: 'RELAY_HERMES_TRUSTED_ORIGINS',
});

export type RemoteHermesRefusal =
  | 'not_remote_mode'
  | 'no_service_url'
  | 'no_token'
  | 'no_trusted_origins_in_production'
  | 'origin_not_trusted'
  | 'url_not_https_in_production';

export type RemoteHermesResolution =
  | { readonly ok: true; readonly config: RemoteHermesConfig }
  | { readonly ok: false; readonly refusal: RemoteHermesRefusal; readonly detail: string };

const originOf = (raw: string): string | null => {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
};

/**
 * Read the remote reviewer configuration, or say exactly what is missing.
 *
 * Fail-closed, and the production rules are checked against the ENVIRONMENT
 * rather than a flag — the shape the rest of this bridge already uses, because
 * a variable that can switch a safety off is a safety that is off.
 */
export function resolveRemoteHermes(env: NodeJS.ProcessEnv): RemoteHermesResolution {
  if ((env[REMOTE_HERMES_ENV.mode] ?? '').trim() !== 'remote') {
    return {
      ok: false,
      refusal: 'not_remote_mode',
      detail: `${REMOTE_HERMES_ENV.mode} is not "remote", so this bridge reviews locally.`,
    };
  }
  const serviceUrl = (env[REMOTE_HERMES_ENV.url] ?? '').trim();
  if (serviceUrl === '') {
    return { ok: false, refusal: 'no_service_url', detail: `${REMOTE_HERMES_ENV.url} is not set.` };
  }
  const token = (env[REMOTE_HERMES_ENV.token] ?? '').trim();
  if (token === '') {
    return { ok: false, refusal: 'no_token', detail: `${REMOTE_HERMES_ENV.token} is not set.` };
  }

  const trustedOrigins = (env[REMOTE_HERMES_ENV.trustedOrigins] ?? '')
    .split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
  const production = isProductionDeployment(env);

  if (production && trustedOrigins.length === 0) {
    return {
      ok: false,
      refusal: 'no_trusted_origins_in_production',
      detail: `A production bridge must list the Reviewer service origin in ${REMOTE_HERMES_ENV.trustedOrigins}; it will not trust an unlisted URL.`,
    };
  }

  const origin = originOf(serviceUrl);
  if (origin === null) {
    return { ok: false, refusal: 'no_service_url', detail: `${REMOTE_HERMES_ENV.url} is not a URL.` };
  }
  if (production && !origin.startsWith('https://')) {
    // A bearer token over plaintext is a published bearer token.
    return {
      ok: false,
      refusal: 'url_not_https_in_production',
      detail: 'A production bridge will not send its Reviewer credential over plaintext HTTP.',
    };
  }
  if (trustedOrigins.length > 0 && !trustedOrigins.includes(origin)) {
    return {
      ok: false,
      refusal: 'origin_not_trusted',
      detail: `The configured Reviewer service origin is not listed in ${REMOTE_HERMES_ENV.trustedOrigins}.`,
    };
  }

  return {
    ok: true,
    config: {
      serviceUrl,
      token,
      trustedOrigins,
      timeoutMs: 15_000,
      reviewTimeoutMs: 10 * 60_000,
      pollIntervalMs: 2_000,
    },
  };
}

export interface RemoteReviewDeps {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => string;
  /** Injected so a test does not wait in real time. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Run one review against the dedicated service.
 *
 * `runId` and `idempotencyKey` are the SAME value on purpose: a redelivered
 * request must not start a second paid review, and the service already keys
 * deduplication on the idempotency key.
 */
export async function runRemoteHermesReview(input: {
  readonly packet: ReviewPacket;
  readonly config: RemoteHermesConfig;
  readonly runId: string;
  readonly deps?: RemoteReviewDeps;
}): Promise<HermesOutcome> {
  const deps = input.deps ?? {};
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date().toISOString());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const startedAt = now();

  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${input.config.token}`,
  };

  const start = await safeFetch(doFetch, `${input.config.serviceUrl}/v1/reviews`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      runId: input.runId,
      idempotencyKey: input.runId,
      prompt: buildReviewPrompt(input.packet),
      /**
       * THE LIMITS THE SERVICE REQUIRES, not an empty object.
       *
       * This sent `limits: {}`. The service demands four positive safe
       * integers and refuses anything else with 422 — so every remote review
       * was rejected before Hermes was ever asked to read a diff, and the
       * mission reported only "The Reviewer service refused the review (422)".
       *
       * That refusal is the service being strict about its own contract, which
       * is right: a limit it cannot read is not a bound, and accepting an
       * empty object would have meant running unbounded under the appearance
       * of a ceiling.
       *
       * `maxTurns` is SERVICE_MAX_TURNS because the adapter is genuinely
       * one-shot — the isolated profile pins `agent.max_turns: 1` and there is
       * no flag to raise it. Asking for more would be a fake control. The
       * others are the bridge's own configured bounds; the service clamps them
       * down to its ceilings and never up, so asking for less is honoured and
       * asking for more is not.
       */
      limits: {
        timeoutMs: input.config.reviewTimeoutMs,
        maxOutputBytes: REMOTE_REVIEW_LIMITS.maxOutputBytes,
        maxTurns: SERVICE_MAX_TURNS,
        maxPromptBytes: REMOTE_REVIEW_LIMITS.maxPromptBytes,
      },
    }),
  }, input.config.timeoutMs);

  if (start === null) {
    return { kind: 'launch_failed', safeMessage: 'The Reviewer service could not be reached.' };
  }
  if (!start.ok) {
    // A refusal the service made is not a launch failure: it answered.
    return {
      kind: 'review_incomplete',
      safeMessage: `The Reviewer service refused the review (${String(start.status)}).`,
      startedAt,
      completedAt: now(),
    };
  }

  const deadline = Date.now() + input.config.reviewTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      // UNKNOWN, not failed. The service may still be reviewing, and saying
      // it failed would be a claim about somebody else's process.
      return {
        kind: 'review_incomplete',
        safeMessage: 'The Reviewer service did not return a verdict within the time allowed. Whether it finished is unknown.',
        startedAt,
        completedAt: now(),
      };
    }
    await sleep(input.config.pollIntervalMs);

    const poll = await safeFetch(
      doFetch,
      `${input.config.serviceUrl}/v1/reviews/${encodeURIComponent(input.runId)}`,
      { method: 'GET', headers },
      input.config.timeoutMs,
    );
    if (poll === null || !poll.ok) continue;

    const state = poll.body as {
      status?: string; reviewText?: string | null; failureKind?: string | null; safeMessage?: string | null;
    };
    if (state.status === 'running' || state.status === 'queued' || state.status === undefined) continue;

    if (state.status !== 'completed' || typeof state.reviewText !== 'string') {
      return {
        kind: 'review_incomplete',
        safeMessage: state.safeMessage ?? `The Reviewer service ended in "${state.status ?? 'unknown'}".`,
        startedAt,
        completedAt: now(),
      };
    }

    // THE SAME VALIDATOR AS THE LOCAL PATH. A remote reviewer cannot return a
    // shape the local one could not, and no verdict logic exists twice.
    const result = validateHermesReview(state.reviewText);
    if (result === null) {
      return {
        kind: 'review_incomplete',
        safeMessage: 'The Reviewer service returned a review Relay could not read.',
        startedAt,
        completedAt: now(),
      };
    }
    return { kind: 'reviewed', result, startedAt, completedAt: now(), model: null, provider: null };
  }
}

async function safeFetch(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    const response = await doFetch(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
