import { buildReviewPrompt, classifyUnreadableReview, describeUnreadableReview, reviewDiagnostics, validateHermesReview, type HermesOutcome, type HermesReviewShape, type ReviewPacket } from './hermes-reviewer';
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
import { safeText } from './redact';

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
 * WHAT THE REVIEW SERVICE SAID ABOUT ITSELF, as a review shape.
 *
 * This path answered two different questions with one word each: a start
 * refusal was `review_provider_http_error` unless it was a 401, and every
 * terminal state carrying no review text was `review_process_exit`. Both are
 * claims about the model provider and about a reviewer process — neither of
 * which is what `capacity_exhausted`, `shutting_down`, `validation_failed` or
 * `timed_out` describe. An independent review found the timeout case first:
 * the service says `timed_out`, and Julius recorded WORKER_EXECUTION_FAILURE
 * rather than TIMEOUT — defeating the durable diagnosis this taxonomy exists
 * to provide, on the one shape it names most plainly.
 *
 * The service's own `failureKind` is authoritative when it sent one; its
 * status is read second. `null` means it said nothing this function can read,
 * and the caller keeps its own fallback rather than inventing a cause — the
 * same rule the local path follows for an unreadable review.
 */
export function classifyRemoteReviewFailure(input: {
  readonly status?: string | null;
  readonly failureKind?: string | null;
}): HermesReviewShape | null {
  switch (input.failureKind) {
    case 'timed_out': return 'review_timeout';
    case 'authentication_failed':
    case 'credentials_missing': return 'review_authentication_failed';
    case 'capacity_exhausted':
    case 'shutting_down': return 'review_service_unavailable';
    case 'validation_failed':
    case 'review_refused': return 'review_request_rejected';
    default: break;
  }
  // A terminal status the service reports without a failure kind. `cancelled`
  // and `failed` stay unclassified: the caller's process-exit fallback is the
  // honest reading of "it stopped and did not say why".
  return input.status === 'timed_out' ? 'review_timeout' : null;
}

/** The service's `failureKind`, when the body is an object that carries one. */
function declaredFailureKind(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const kind = (body as { failureKind?: unknown }).failureKind;
  return typeof kind === 'string' ? kind : null;
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
    const admissionShape = classifyRemoteReviewFailure({ failureKind: declaredFailureKind(start.body) })
      ?? (start.status === 401 || start.status === 403 ? 'review_authentication_failed'
        : start.status === 400 || start.status === 422 ? 'review_request_rejected'
          : start.status === 429 || start.status === 503 ? 'review_service_unavailable'
            : 'review_provider_http_error');
    // A refusal the service made is not a launch failure: it answered.
    return {
      kind: 'review_incomplete',
      safeMessage: `The Reviewer service refused the review (${String(start.status)}).`,
      /**
       * WHAT IT SAID, THEN WHAT IT RETURNED. A refusal at ADMISSION is the
       * service's own answer about its own state, and calling all of them
       * `review_provider_http_error` sent an operator to a provider that had
       * not been called: a 503 is capacity, a 422 is these limits. The status
       * codes are the fallback for a body that named no kind, and only a
       * refusal that is none of those remains an upstream error.
       */
      shape: admissionShape,
      /**
       * NOTHING RAN, so there is no exit code, no byte count and no review to
       * read the shape of. The service refused at admission; every measurement
       * below is honestly absent rather than zero.
       */
      diagnostics: reviewDiagnostics({
        transport: 'remote', shape: admissionShape,
        timedOut: admissionShape === 'review_timeout',
      }),
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
        shape: 'review_timeout',
        // Our deadline, not the service's process. Whether it finished is
        // unknown, so nothing about its output is claimed.
        diagnostics: reviewDiagnostics({ transport: 'remote', shape: 'review_timeout', timedOut: true }),
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
      usage?: { inputTokens?: number | null; outputTokens?: number | null; model?: string | null } | null;
    };
    if (state.status === 'running' || state.status === 'queued' || state.status === undefined) continue;

    if (state.status !== 'completed' || typeof state.reviewText !== 'string') {
      const terminalShape = classifyRemoteReviewFailure({ status: state.status, failureKind: state.failureKind })
        ?? 'review_process_exit';
      return {
        kind: 'review_incomplete',
        safeMessage: state.safeMessage ?? `The Reviewer service ended in "${state.status ?? 'unknown'}".`,
        /**
         * The service ended without a review text, and it usually says why.
         * `timed_out` recorded as a process exit is the review's own deadline
         * reported as a crash — the local path has named that `review_timeout`
         * since this taxonomy existed, and the two readers must not describe
         * one cause with two words. Process exit remains the fallback for a
         * terminal state carrying no kind at all.
         */
        shape: terminalShape,
        // The service ran a process we cannot see; its exit code is its own
        // and is not reported over this wire, so it stays null.
        diagnostics: reviewDiagnostics({
          transport: 'remote', shape: terminalShape,
          timedOut: terminalShape === 'review_timeout',
        }),
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
        safeMessage: `The Reviewer service returned a review Relay could not read. ${describeUnreadableReview(state.reviewText)}`,
        // THE SAME CLASSIFIER AS THE LOCAL PATH, on the same text, so the two
        // reviewers cannot disagree about what an unreadable review was.
        shape: classifyUnreadableReview(state.reviewText),
        // The one remote branch that HAS the text, so its structure is
        // measurable — and only its structure is kept.
        diagnostics: reviewDiagnostics({
          transport: 'remote',
          shape: classifyUnreadableReview(state.reviewText),
          provider: null,
          servedModel: typeof state.usage?.model === 'string' ? state.usage.model : null,
          outputBytesObserved: Buffer.byteLength(state.reviewText, 'utf8'),
          outputByteLimit: REMOTE_REVIEW_LIMITS.maxOutputBytes,
          text: state.reviewText,
        }),
        startedAt,
        completedAt: now(),
      };
    }
    /**
     * THE SERVED MODEL, FROM THE SERVICE'S OWN USAGE REPORT.
     *
     * This return used to hardcode `model: null, provider: null` — and the
     * poll above did not even read `usage` — so every hosted review reached
     * the mission with no observed model, and the mission then "resolved" one
     * from preflight configuration. That is the laundering documented as
     * defect 3 in HOSTED_MISSION_EVIDENCE.md: the requested model wearing the
     * served model's clothes.
     *
     * The service forwards what Hermes itself wrote to its usage file. Absent
     * stays absent — a review whose provider named no model is attested with
     * no model, never with the configured one.
     */
    const usage = state.usage;
    const servedModel =
      usage !== null && usage !== undefined && typeof usage.model === 'string' && usage.model.trim() !== ''
        ? safeText(usage.model)
        : null;
    return {
      kind: 'reviewed',
      result,
      startedAt,
      completedAt: now(),
      // The bridge asks the remote service for a review, not for a specific
      // model — the service's own configuration decides. What the bridge
      // requested is therefore nothing, and the mission layer reports the
      // preflight-known requested model on its own requested axis.
      requestedModel: null,
      servedModel,
      provider: null,
    };
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
