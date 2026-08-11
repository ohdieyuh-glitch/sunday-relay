import type {
  BridgeError, BridgeResult, BrowserPairingOptions, PairingGrantResponse, RetryReviewerRequest, RetryReviewerResponse,
  ReviewerBridgeClient, ReviewerConnectionTestResponse, ReviewerInspectResponse,
  ReviewerReadinessResponse, ReviewerStatusResponse, StartReviewerRequest,
  StartReviewerResponse, StopReviewerResponse,
} from './bridge-contracts';
import {
  BRIDGE_API_BASE, DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_TIMEOUT_MS,
  redactBridgeSecrets, resolveBridgeTarget, resolveBridgeToken, type BridgeTarget,
} from './bridge-target';

/**
 * THE ONE REVIEWER BRIDGE CLIENT.
 *
 * Environment-neutral by construction: `fetch` is injected, so the CLI, a
 * future trusted surface and the tests all drive the SAME request framing,
 * authentication, timeout, parsing and error classification. The tests point
 * it at a real HTTP server rather than a stub, because framing and redaction
 * are exactly what a stub would stop proving.
 *
 * WHAT IT REFUSES TO DO: decide anything. It classifies transport and HTTP
 * failures and hands back the server's own structured payload. A verdict, a
 * finding's validity, independence and model trust are server decisions, and
 * this file contains no branch that could second-guess one.
 *
 * THE TOKEN travels in an `Authorization` header and nowhere else — never in
 * the URL (proxies log those), never in argv (the process table is world
 * readable), never in a message, and never in an error. `redactBridgeSecrets`
 * runs over anything a server sends back before it can be printed.
 */

export interface ReviewerBridgeClientOptions {
  readonly bridgeUrl: string | undefined | null;
  readonly token: string | undefined | null;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

/** HTTP status → the closed error set. Anything unmapped is a server failure. */
function classifyStatus(status: number, serverKind: string | null): BridgeError {
  const known: Record<string, BridgeError['kind']> = {
    mission_not_found: 'mission_not_found',
    run_not_found: 'run_not_found',
    duplicate_run: 'duplicate_run',
    reviewer_not_ready: 'reviewer_not_ready',
    harness_not_installed: 'harness_not_installed',
    credentials_missing: 'credentials_missing',
    model_unverified: 'model_unverified',
    budget_blocked: 'budget_blocked',
    validation_failed: 'validation_failed',
    run_disconnected: 'run_disconnected',
    authorization_required: 'authorization_required',
  };
  // The server's own classification wins when it gives one — it knows why.
  if (serverKind !== null && serverKind in known) {
    return { kind: known[serverKind], message: '', status };
  }
  if (status === 401) {
    return {
      kind: 'authentication_failed',
      // Deliberately incurious: never reveal whether the token was absent,
      // malformed, expired or simply wrong.
      message: 'The Relay Bridge rejected the credential.',
      status,
    };
  }
  if (status === 403) {
    return { kind: 'authorization_required', message: 'This operation is not authorized.', status };
  }
  if (status === 404) {
    return { kind: 'mission_not_found', message: 'The Relay Bridge does not know this mission.', status };
  }
  if (status === 409) {
    return { kind: 'duplicate_run', message: 'A Reviewer run already exists for this authorization.', status };
  }
  if (status === 422) {
    return { kind: 'validation_failed', message: 'The Relay Bridge rejected the request as invalid.', status };
  }
  return { kind: 'server_failure', message: `The Relay Bridge returned an error (HTTP ${status}).`, status };
}

export function createReviewerBridgeClient(
  options: ReviewerBridgeClientOptions,
): BridgeResult<ReviewerBridgeClient> {
  const target = resolveBridgeTarget(options.bridgeUrl);
  if (!target.ok) return target;
  const token = resolveBridgeToken(options.token);
  if (!token.ok) return token;

  return {
    ok: true,
    value: buildClient(
      target.value,
      token.value,
      options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    ),
  };
}

function buildClient(
  target: BridgeTarget,
  token: string,
  doFetch: typeof fetch,
  timeoutMs: number,
  maxResponseBytes: number,
): ReviewerBridgeClient {
  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<BridgeResult<T>> {
    const url = `${target.baseUrl}${BRIDGE_API_BASE}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: {
          // The ONLY place the credential appears.
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        // A redirect could send the Authorization header to another origin.
        redirect: 'manual',
        cache: 'no-store',
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        error: aborted
          ? { kind: 'timeout', message: `The Relay Bridge did not answer within ${timeoutMs} ms.` }
          : { kind: 'unreachable', message: 'The Relay Bridge is not reachable.' },
      };
    } finally {
      clearTimeout(timer);
    }

    // `redirect: 'manual'` surfaces a 3xx rather than following it. Refuse —
    // a cross-origin hop would leak the bearer token.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return {
        ok: false,
        error: {
          kind: 'invalid_response',
          message: 'The Relay Bridge attempted a redirect. Relay does not follow one while authenticated.',
          status: res.status,
        },
      };
    }

    const declaredLength = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
      return {
        ok: false,
        error: { kind: 'invalid_response', message: 'The Relay Bridge response exceeded the size limit.' },
      };
    }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        error: { kind: 'invalid_response', message: 'The Relay Bridge did not return JSON.', status: res.status },
      };
    }

    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
      return {
        ok: false,
        error: { kind: 'invalid_response', message: 'The Relay Bridge response exceeded the size limit.' },
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: { kind: 'invalid_response', message: 'The Relay Bridge returned malformed JSON.', status: res.status },
      };
    }

    const envelope = (payload ?? {}) as { data?: unknown; error?: unknown; kind?: unknown };
    if (!res.ok) {
      const serverKind = typeof envelope.kind === 'string' ? envelope.kind : null;
      const classified = classifyStatus(res.status, serverKind);
      const serverMessage = typeof envelope.error === 'string' ? envelope.error : '';
      return {
        ok: false,
        error: {
          ...classified,
          // A server message is shown only after redaction, and never for an
          // authentication failure, where silence is the point.
          message: classified.kind === 'authentication_failed' || serverMessage === ''
            ? classified.message
            : redactBridgeSecrets(serverMessage, token),
        },
      };
    }

    if (envelope.data === undefined || envelope.data === null || typeof envelope.data !== 'object') {
      return {
        ok: false,
        error: { kind: 'invalid_response', message: 'The Relay Bridge response was missing its data envelope.' },
      };
    }
    return { ok: true, value: envelope.data as T };
  }

  return {
    createBrowserPairing: (origin: string, options?: BrowserPairingOptions) =>
      call<PairingGrantResponse>('POST', '/browser/pair', {
        origin,
        // Sent only when a control grant was explicitly asked for — the wire
        // stays identical to before for the read-only default.
        ...(options?.control === true
          ? { scope: 'control', participantId: options.participantId }
          : {}),
      }),
    getReviewerReadiness: () =>
      call<ReviewerReadinessResponse>('GET', '/reviewer/readiness'),
    testReviewerConnection: () =>
      call<ReviewerConnectionTestResponse>('POST', '/reviewer/test-connection'),
    startReviewerRun: (request: StartReviewerRequest) =>
      call<StartReviewerResponse>('POST', '/reviewer/start', request),
    getReviewerStatus: (missionId: string) =>
      call<ReviewerStatusResponse>('GET', `/reviewer/status/${encodeURIComponent(missionId)}`),
    inspectReviewerRun: (missionId: string) =>
      call<ReviewerInspectResponse>('GET', `/reviewer/inspect/${encodeURIComponent(missionId)}`),
    stopReviewerRun: (missionId: string) =>
      call<StopReviewerResponse>('POST', `/reviewer/stop/${encodeURIComponent(missionId)}`, { missionId }),
    retryReviewerRun: (request: RetryReviewerRequest) =>
      call<RetryReviewerResponse>('POST', '/reviewer/retry', request),
  };
}
